import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RemoteOpsState,
  TerminalOutputBuffer,
  defaultPasswordRef,
  normalizeGroupName,
  summarizeError,
  validateEnvironment,
} from "../lib/index.js";

test("environment validation normalizes names and rejects unsafe identifiers", () => {
  assert.equal(normalizeGroupName("生产/华东"), "生产-华东");
  assert.equal(normalizeGroupName("  "), "default");
  assert.equal(normalizeGroupName("group... "), "group");
  assert.equal(defaultPasswordRef("prod-east"), "DSH_REMOTE_OPS_PROD_EAST_PASSWORD");

  assert.equal(validateEnvironment({ id: "prod-1", name: "生产", host: "10.0.0.1", username: "root" }).ok, true);
  assert.equal(validateEnvironment({ id: "bad id", name: "x", host: "10.0.0.1", username: "root" }).ok, false);
  assert.equal(validateEnvironment({ id: "prod-1", name: "生产", host: "10.0.0.1", username: "root", port: 0 }).ok, false);
  assert.equal(validateEnvironment({ id: "prod-1", name: "生产", host: "10.0.0.1", username: "root", passwordRef: "REMOTE_OPS_PROD_1_PASSWORD" }).ok, true);
  assert.equal(validateEnvironment({ id: "prod-1", name: "生产", host: "10.0.0.1", username: "root", passwordRef: "not a ref" }).ok, false);
  assert.match(summarizeError(Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" })), /ECONNREFUSED/);
});

test("terminal output buffer provides bounded absolute deltas", async () => {
  const buffer = new TerminalOutputBuffer(32, 16);
  buffer.append("你好");
  const first = buffer.readFrom();
  assert.equal(first.reset, true);
  assert.equal(first.text, "你好");
  buffer.append("\r\nnext");
  const delta = buffer.readFrom(first.nextOffset);
  assert.equal(delta.reset, false);
  assert.equal(delta.text, "\r\nnext");
  assert.equal(delta.nextOffset, buffer.endOffset);

  buffer.append("x".repeat(40));
  assert.ok(buffer.byteLength <= 16);
  assert.equal(buffer.readFrom(0).reset, true);
  assert.equal(buffer.readFrom(buffer.endOffset).text, "");

  const waitingOffset = buffer.endOffset;
  const changed = buffer.waitForChange(waitingOffset, 500);
  setTimeout(() => buffer.append("z"), 5);
  await changed;
  assert.equal(buffer.readFrom(waitingOffset).text, "z");

  const abortController = new AbortController();
  const aborted = buffer.waitForChange(buffer.endOffset, 500, abortController.signal);
  abortController.abort();
  await aborted;
});

function fakeRemoteSession() {
  return {
    output: "",
    outputBuffer: new TerminalOutputBuffer(),
    status: () => ({ kind: "running" }),
    writeInput: (text) => ({ accepted: true, bytes: Buffer.byteLength(String(text), "utf8") }),
    signal: async () => ({ delivered: true, targetPgid: 1 }),
  };
}

class FakeTerminal {
  constructor() {
    this.output = new EventEmitter();
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
    this.writes = [];
  }

  async write(text) { this.writes.push(String(text)); }

  async signalForeground() { return 1234; }

  async terminate() {
    this.output.emit("end");
    this.resolveDone({ exitCode: 0, signal: null });
  }
}

function fakeContext() {
  const terminals = [];
  return {
    terminals,
    subprocess: {
      resolveExecutable: async (value) => value,
      spawnTerminal: async () => {
        const terminal = new FakeTerminal();
        terminals.push(terminal);
        return terminal;
      },
    },
    credentials: {
      values: new Map(),
      async set(ref, value) { this.values.set(ref, value); },
      async resolve(ref) { return { value: this.values.get(ref) }; },
    },
  };
}

test("opening one environment concurrently reserves one PTY and returns one session", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-remote-ops-open-test-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const context = fakeContext();
  const owner = { id: "agent-open" };
  const state = new RemoteOpsState(context);
  let spawnCount = 0;
  context.terminals = {
    spawn: async (_owner, request) => {
      spawnCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      const sessionId = `pty-${spawnCount}`;
      state.backendSessions.set(sessionId, fakeRemoteSession());
      return { sessionId };
    },
    list: () => [],
  };
  try {
    await state.ready;
    await state.saveEnvironment({ id: "prod-1", name: "生产环境", host: "10.0.0.1", username: "root", group: "default", port: 22 });
    const [first, second] = await Promise.all([state.open(owner, "prod-1"), state.open(owner, "prod-1")]);
    assert.equal(spawnCount, 1);
    assert.equal(first.sessionId, second.sessionId);
  } finally {
    state.disposed = true;
    await state.localSession?.close().catch(() => {});
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("host-owned existing environment sessions are visible and reusable", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-remote-ops-host-session-test-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const context = fakeContext();
  const owner = { id: "agent-existing" };
  const existing = { sessionId: "pty-existing", name: "prod-1", type: "ssh", status: { kind: "running" } };
  const state = new RemoteOpsState(context);
  let spawnCount = 0;
  context.terminals = {
    list: () => [existing],
    spawn: async () => { spawnCount += 1; throw new Error("spawn should not be called for an existing PTY"); },
    read: () => ({ text: "", totalLines: 0, lineBegin: 0, lineEnd: 0, truncated: false }),
    startSend: () => ({ done: Promise.resolve({ waitReason: "inferred_idle", output: "", viewport: "", sessionStatus: existing.status, truncated: false }) }),
  };
  try {
    await state.ready;
    await state.saveEnvironment({ id: "prod-1", name: "生产环境", host: "10.0.0.1", username: "root", group: "default", port: 22 });
    const record = await state.open(owner, "prod-1");
    assert.equal(record.sessionId, existing.sessionId);
    assert.equal(spawnCount, 0);
    assert.equal(state.snapshot(owner).sessions.some((item) => item.sessionId === existing.sessionId), true);
  } finally {
    state.disposed = true;
    await state.localSession?.close().catch(() => {});
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("terminal send result reports exact submitted text and submit behavior", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-remote-ops-send-test-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const context = fakeContext();
  const owner = { id: "agent-send" };
  const state = new RemoteOpsState(context);
  const remote = fakeRemoteSession();
  context.terminals = {
    startSend: (_owner, _sessionId, request) => {
      context.lastSendRequest = request;
      return { done: Promise.resolve({ waitReason: "inferred_idle", output: "", viewport: "", sessionStatus: { kind: "running" }, truncated: false }) };
    },
  };
  try {
    await state.ready;
    await state.saveEnvironment({ id: "prod-1", name: "生产环境", host: "10.0.0.1", username: "root", group: "default", port: 22 });
    state.sessions.set("pty-send", { sessionId: "pty-send", ownerId: owner.id, owner, environment: state.findEnvironment("prod-1"), session: remote });
    const result = await state.send(owner, "pty-send", { text: "echo  两个  空格", submit: true });
    assert.equal(context.lastSendRequest.text, "echo  两个  空格");
    assert.equal(result.submittedText, "echo  两个  空格");
    assert.equal(result.submit, true);
  } finally {
    state.disposed = true;
    await state.localSession?.close().catch(() => {});
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("environment and quick-command persistence survives a state reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-remote-ops-test-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const ctx = fakeContext();
  let firstState;
  let secondState;
  try {
    firstState = new RemoteOpsState(ctx);
    await firstState.ready;
    await firstState.createGroup("生产/华东");
    await firstState.saveEnvironment({ id: "prod-1", name: "生产环境", host: "10.0.0.1", username: "root", group: "生产-华东", port: 22 });
    await firstState.createQuickGroup("排查");
    await firstState.saveQuickCommand({ id: "health", name: "健康检查", command: "uname -a\nfree -h", group: "排查" });
    await firstState.storePassword("DSH_REMOTE_OPS_PROD_1_PASSWORD", "secret");

    assert.deepEqual(firstState.groupList(), ["生产-华东"]);
    assert.equal(firstState.findEnvironment("prod-1").host, "10.0.0.1");
    assert.equal(firstState.quickCommands[0].command, "uname -a\nfree -h");
    assert.equal(await ctx.credentials.resolve("DSH_REMOTE_OPS_PROD_1_PASSWORD").then((value) => value.value), "secret");

    firstState.disposed = true;
    await firstState.localSession?.close();
    secondState = new RemoteOpsState(ctx);
    await secondState.ready;
    assert.deepEqual(secondState.groupList(), ["生产-华东"]);
    assert.equal(secondState.findEnvironment("生产环境").id, "prod-1");
    assert.deepEqual(secondState.quickGroupList(), ["排查"]);
    assert.equal(secondState.quickCommands[0].command, "uname -a\nfree -h");
  } finally {
    if (secondState) {
      secondState.disposed = true;
      await secondState.localSession?.close().catch(() => {});
    }
    if (firstState) {
      firstState.disposed = true;
      await firstState.localSession?.close().catch(() => {});
    }
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

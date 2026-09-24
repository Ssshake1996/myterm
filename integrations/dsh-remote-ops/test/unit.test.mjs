import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client as SshClient } from "ssh2";
import {
  RemoteOpsState,
  TerminalOutputBuffer,
  buildSshShellOptions,
  defaultPasswordRef,
  MAX_SESSIONS_PER_ENVIRONMENT,
  normalizeGroupName,
  summarizeError,
  toLosslessJson,
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

test("saved environments generate an internal id and default the name to the host", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-remote-ops-environment-name-test-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const state = new RemoteOpsState(fakeContext());
  try {
    await state.ready;
    const saved = await state.saveEnvironment({ host: "10.0.0.8", username: "root", group: "default", port: 22 });
    assert.equal(saved.name, "10.0.0.8");
    assert.equal(typeof saved.id, "string");
    assert.ok(saved.id.length > 0);
    assert.equal(validateEnvironment(saved).ok, true);
    await assert.rejects(
      () => state.saveEnvironment({ host: "10.0.0.9", name: "10.0.0.8", username: "root", group: "default", port: 22 }),
      /REMOTE_ENV_NAME_EXISTS/,
    );
  } finally {
    state.disposed = true;
    await state.localSession?.close().catch(() => {});
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("environment list output is lossless JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-remote-ops-lossless-output-test-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const state = new RemoteOpsState(fakeContext());
  try {
    await state.ready;
    await state.saveEnvironment({ host: "10.0.0.8", username: "root", group: "default", port: 22 });
    const output = toLosslessJson(state.snapshot({ id: "agent-json" }));
    assert.doesNotThrow(() => JSON.stringify(output));
    assert.equal(Object.hasOwn(output, "localError"), false);
    assert.equal(Object.hasOwn(output.environments[0], "passwordRef"), false);
    assert.equal(output.environments[0].name, "10.0.0.8");
  } finally {
    state.disposed = true;
    await state.localSession?.close().catch(() => {});
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("generated PTY names resolve through the SSH backend to their saved environment", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dsh-remote-ops-session-name-test-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const state = new RemoteOpsState(fakeContext());
  const channel = new EventEmitter();
  channel.stderr = new EventEmitter();
  channel.write = () => true;
  channel.end = () => {};
  let connectionConfig;
  t.mock.method(SshClient.prototype, "connect", function (config) {
    connectionConfig = config;
    queueMicrotask(() => this.emit("ready"));
    return this;
  });
  t.mock.method(SshClient.prototype, "shell", (_window, _options, callback) => callback(null, channel));
  try {
    await state.ready;
    await state.saveEnvironment({ id: "prod-1", name: "生产环境", host: "10.0.0.1", username: "root", group: "default", port: 22 });
    const session = await state.spawnBackend({ name: "dsh-remote-ops-prod-1-mu3fti1j-1", sessionId: "session-1" });
    assert.equal(session.environment.id, "prod-1");
    assert.deepEqual(connectionConfig, { host: "10.0.0.1", port: 22, username: "root", readyTimeout: 15_000, keepaliveInterval: 10_000, keepaliveCountMax: 3 });
    assert.equal(state.findEnvironmentBySessionName("dsh-remote-ops-unknown-mu3fti1j-1"), undefined);
    await session.close();
  } finally {
    state.disposed = true;
    await state.localSession?.close().catch(() => {});
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("SSH shell requests locale through channel environment without typing a setup command", () => {
  assert.deepEqual(buildSshShellOptions(), {
    window: { term: "xterm-256color", rows: 40, cols: 160 },
    options: { env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", LC_CTYPE: "C.UTF-8" } },
  });
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

async function terminalFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "dsh-terminal-sync-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const ctx = fakeContext();
  const state = new RemoteOpsState(ctx);
  await state.ready;
  t.after(async () => {
    state.disposed = true;
    await state.localSession?.close();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });
  return { ctx, state, terminal: ctx.terminals[0] };
}

test("local send waits for fresh output and returns a resumable bounded delta, not old history", async (t) => {
  const { state, terminal } = await terminalFixture(t);
  terminal.output.emit("data", Buffer.from("old history\r\n"));
  terminal.write = async (text) => {
    terminal.writes.push(text);
    setTimeout(() => terminal.output.emit("data", Buffer.from("fresh result\r\n")), 10);
  };
  const result = await state.send({ id: "agent" }, "local-cmd", { text: "echo  fresh", quietMs: 40, timeoutSeconds: 1 });
  assert.deepEqual(terminal.writes, ["echo  fresh\r"]);
  assert.equal(result.output, "fresh result\r\n");
  assert.equal(result.waitReason, "inferred_idle");
  assert.equal(result.completion, "unknown");
  assert.equal(Object.hasOwn(result, "viewport"), false);
  assert.equal(typeof result.streamId, "string");
  assert.equal(result.nextOffset, state.localSession.outputBuffer.endOffset);
  terminal.output.emit("data", Buffer.from("late output"));
  const continuation = await state.readTerminal({ id: "agent" }, "local-cmd", { cursor: result.nextOffset, streamId: result.streamId });
  assert.equal(continuation.text, "late output");
  const ui = await state.terminalOutput(undefined, "local-cmd", result.nextOffset, 0, undefined, result.streamId);
  assert.equal(ui.text, continuation.text);
  assert.equal(ui.nextOffset, continuation.nextOffset);
});

test("cursor pages drain retained output without skipping or splitting unicode", () => {
  const buffer = new TerminalOutputBuffer();
  buffer.append("a😀中".repeat(30));
  let cursor = 0;
  let result = "";
  do {
    const page = buffer.readFrom(cursor, 7);
    assert.equal(page.reset, false);
    assert.equal(page.truncated, false);
    assert.equal(page.text.isWellFormed(), true);
    assert.ok(page.nextOffset > cursor);
    result += page.text;
    cursor = page.nextOffset;
    assert.equal(page.hasMore, cursor < buffer.endOffset);
  } while (cursor < buffer.endOffset);
  assert.equal(result, buffer.value);
});

test("read cursor resets across terminal replacement even when the output length is unchanged", async (t) => {
  const { state } = await terminalFixture(t);
  state.localSession.outputBuffer.append("old");
  const first = await state.terminalOutput(undefined, "local-cmd");
  state.localSession.outputBuffer = new TerminalOutputBuffer();
  state.localSession.outputBuffer.append("new");
  const second = await state.terminalOutput(undefined, "local-cmd", first.nextOffset, 0, undefined, first.streamId);
  assert.equal(second.reset, true);
  assert.equal(second.text, "new");
  assert.notEqual(second.streamId, first.streamId);
});

test("terminal read long-polls without submitting more input and enforces owner isolation", async (t) => {
  const { state, terminal } = await terminalFixture(t);
  const first = await state.readTerminal({ id: "agent" }, "local-cmd");
  const waiting = state.readTerminal({ id: "agent" }, "local-cmd", { cursor: first.nextOffset, streamId: first.streamId, waitMs: 500 });
  setTimeout(() => terminal.output.emit("data", Buffer.from("ready")), 10);
  assert.equal((await waiting).text, "ready");
  assert.deepEqual(terminal.writes, []);
  state.sessions.set("ssh-private", { sessionId: "ssh-private", ownerId: "other", session: fakeRemoteSession(), environment: { name: "private" } });
  await assert.rejects(state.readTerminal({ id: "agent" }, "ssh-private"), { code: "FOREIGN_SESSION" });
  await assert.rejects(state.readTerminal({ id: "agent" }, "local-cmd", { cursor: -1 }), { code: "REMOTE_OFFSET_INVALID" });
});

test("send output consumption is incremental and a silent terminal never reports command completion", async (t) => {
  const { state, terminal } = await terminalFixture(t);
  const session = state.localSession;
  const operation = session.startSend({ text: "slow", submit: true, quietMs: 1000, timeoutMs: 80 });
  assert.throws(() => session.startSend({ text: "duplicate", submit: true }), { code: "SEND_ACTIVE" });
  terminal.output.emit("data", Buffer.from("one"));
  assert.equal(operation.readOutput().delta, "one");
  assert.equal(operation.readOutput().delta, "");
  terminal.output.emit("data", Buffer.from("two"));
  assert.equal(operation.readOutput().delta, "two");
  const result = await operation.done;
  assert.equal(result.waitReason, "timeout");
  assert.equal(result.completion, "unknown");
  assert.equal(result.viewport, "");
  assert.equal(session.active, undefined);
});

test("active send releases waiters on abort and session exit", async (t) => {
  const { state } = await terminalFixture(t);
  const session = state.localSession;
  const controller = new AbortController();
  const operation = session.startSend({ text: "wait", submit: true, signal: controller.signal, timeoutMs: 5000 });
  controller.abort();
  assert.equal((await operation.done).waitReason, "cancelled");
  assert.equal(session.active, undefined);
  const next = session.startSend({ text: "wait", submit: true, timeoutMs: 5000 });
  await session.close();
  assert.equal((await next.done).waitReason, "session_exit");
});

test("send retains final output from the exited local process instead of reading its replacement", async (t) => {
  const { state, terminal } = await terminalFixture(t);
  terminal.write = async () => { terminal.output.emit("data", Buffer.from("goodbye")); await terminal.terminate(); };
  const result = await state.send({ id: "agent" }, "local-cmd", { text: "exit", timeoutSeconds: 1 });
  assert.equal(result.output, "goodbye");
  assert.equal(result.status.kind, "exited");
  assert.equal(result.waitReason, "session_exit");
});

test("sending by environment reuses a unique connection and refuses ambiguous connections", async (t) => {
  const { state, ctx } = await terminalFixture(t);
  const owner = { id: "agent" };
  const environment = await state.saveEnvironment({ host: "localhost", username: "test", name: "target" });
  const remote = fakeRemoteSession();
  const record = { sessionId: "ssh-one", ownerId: owner.id, owner, environment, session: remote };
  state.sessions.set(record.sessionId, record);
  ctx.terminals.startSend = (_owner, id) => {
    assert.equal(id, "ssh-one");
    remote.outputBuffer.append("result");
    return { done: Promise.resolve({ waitReason: "inferred_idle", sessionStatus: remote.status() }) };
  };
  const result = await state.send(owner, undefined, { environment: environment.name, text: "echo result" });
  assert.equal(result.sessionId, "ssh-one");
  assert.equal(result.output, "result");
  state.sessions.set("ssh-two", { ...record, sessionId: "ssh-two" });
  await assert.rejects(state.send(owner, undefined, { environment: environment.name, text: "ambiguous" }), { code: "REMOTE_SESSION_REQUIRED" });
  await assert.rejects(state.send(owner, undefined, { text: "missing target" }), { code: "REMOTE_SESSION_REQUIRED" });
});

test("registered terminal tools can read the same local CMD as the UI", async (t) => {
  const { apply } = await import("../lib/index.js");
  const root = await mkdtemp(join(tmpdir(), "dsh-terminal-tools-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const ctx = fakeContext();
  const registered = new Map();
  const routes = new Map();
  const effects = [];
  ctx.tools = { register: (definition) => registered.set(definition.name, definition) };
  ctx.systemPrompt = { section() {} };
  ctx.agents = { get: () => ({ id: "tool-owner" }) };
  ctx.connection = { fetch: { register: (route) => routes.set(route.path, route) } };
  ctx.terminals.registerBackend = () => {};
  ctx.effect = (effect) => { const cleanup = effect(); if (typeof cleanup === "function") effects.push(cleanup); };
  apply(ctx);
  t.after(async () => {
    for (const cleanup of effects) await cleanup();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });
  const exec = { agent: { id: "tool-owner" } };
  await registered.get("remote_environment_list").execute({}, exec);
  ctx.terminals[0].output.emit("data", Buffer.from("shared CMD"));
  const output = await registered.get("remote_terminal_read").execute({ session: "local-cmd" }, exec);
  const route = routes.get("/api/dsh-remote-ops/terminal");
  const response = await route.fetch(new Request("http://localhost/api/dsh-remote-ops/terminal?session=local-cmd"));
  const frame = await response.json();
  assert.equal(output.text, frame.text);
  assert.equal(output.streamId, frame.streamId);
  assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
  assert.equal((await registered.get("remote_terminal_signal").execute({ session: "local-cmd", signal: "SIGINT" }, exec)).delivered, true);
  const controller = new AbortController();
  const sending = registered.get("remote_terminal_send").execute({ session: "local-cmd", text: "slow", quietMs: 1000, timeoutSeconds: 2 }, { ...exec, signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  assert.equal((await sending).waitReason, "cancelled");
});

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

test("environment sessions use unique PTY names and stop at three owner connections", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-remote-ops-session-limit-test-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const context = fakeContext();
  const owner = { id: "agent-session-limit" };
  const hostSessions = [];
  const state = new RemoteOpsState(context);
  let spawnCount = 0;
  context.terminals = {
    list: () => hostSessions,
    spawn: async (_owner, request) => {
      spawnCount += 1;
      const sessionId = `pty-limit-${spawnCount}`;
      state.backendSessions.set(sessionId, fakeRemoteSession());
      hostSessions.push({ sessionId, name: request.name, type: "ssh", status: { kind: "running" } });
      return { sessionId };
    },
    kill: async (_owner, sessionId) => {
      const index = hostSessions.findIndex((item) => item.sessionId === sessionId);
      if (index >= 0) hostSessions.splice(index, 1);
    },
  };
  try {
    await state.ready;
    await state.saveEnvironment({ id: "prod-1", name: "生产环境", host: "10.0.0.1", username: "root", group: "default", port: 22 });
    const opened = [];
    for (let index = 0; index < MAX_SESSIONS_PER_ENVIRONMENT; index += 1) opened.push(await state.open(owner, "prod-1"));
    assert.equal(opened.length, 3);
    assert.equal(new Set(opened.map((item) => item.sessionId)).size, MAX_SESSIONS_PER_ENVIRONMENT);
    assert.equal(new Set(hostSessions.map((item) => item.name)).size, MAX_SESSIONS_PER_ENVIRONMENT);
    assert.ok(hostSessions.every((item) => item.name !== "prod-1"));
    await assert.rejects(() => state.open(owner, "prod-1"), (error) => error.code === "REMOTE_SESSION_LIMIT" && /3/.test(error.message));
    assert.equal(spawnCount, MAX_SESSIONS_PER_ENVIRONMENT);
    assert.throws(() => state.getSession(owner, "prod-1"), (error) => error.code === "REMOTE_SESSION_REQUIRED");
  } finally {
    state.disposed = true;
    await state.localSession?.close().catch(() => {});
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("releasing one environment session removes only that connection and stale PTYs stop running", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-remote-ops-session-release-test-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const context = fakeContext();
  const owner = { id: "agent-session-release" };
  const hostSessions = [];
  const state = new RemoteOpsState(context);
  let spawnCount = 0;
  context.terminals = {
    list: () => hostSessions,
    spawn: async (_owner, request) => {
      spawnCount += 1;
      const sessionId = `pty-release-${spawnCount}`;
      state.backendSessions.set(sessionId, fakeRemoteSession());
      hostSessions.push({ sessionId, name: request.name, type: "ssh", status: { kind: "running" } });
      return { sessionId };
    },
    kill: async (_owner, sessionId) => {
      const index = hostSessions.findIndex((item) => item.sessionId === sessionId);
      if (index >= 0) hostSessions.splice(index, 1);
    },
  };
  try {
    await state.ready;
    await state.saveEnvironment({ id: "prod-1", name: "生产环境", host: "10.0.0.1", username: "root", group: "default", port: 22 });
    const first = await state.open(owner, "prod-1");
    const second = await state.open(owner, "prod-1");
    const third = await state.open(owner, "prod-1");
    const before = state.snapshot(owner);
    assert.equal(before.environments.find((item) => item.id === "prod-1").connectionCount, 3);
    await state.close(owner, second.sessionId);
    assert.equal(state.snapshot(owner).sessions.filter((item) => item.environmentId === "prod-1").length, 2);
    assert.ok(state.sessions.has(first.sessionId));
    assert.ok(state.sessions.has(third.sessionId));
    hostSessions.splice(hostSessions.findIndex((item) => item.sessionId === first.sessionId), 1);
    const afterHostExit = state.snapshot(owner);
    assert.equal(afterHostExit.sessions.some((item) => item.sessionId === first.sessionId), false);
    assert.equal(afterHostExit.environments.find((item) => item.id === "prod-1").connectionCount, 1);
  } finally {
    state.disposed = true;
    await state.localSession?.close().catch(() => {});
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("SFTP local listing exposes files and directories for the transfer workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-remote-ops-sftp-local-test-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const state = new RemoteOpsState(fakeContext());
  try {
    await state.ready;
    const localRoot = join(root, "local");
    await mkdir(join(localRoot, "folder"), { recursive: true });
    await writeFile(join(localRoot, "hello.txt"), "hello", "utf8");
    const result = await state.listLocalFiles(localRoot);
    assert.deepEqual(result.entries.map((item) => [item.name, item.type]).sort(), [["folder", "d"], ["hello.txt", "-"]]);
    assert.equal(result.entries.find((item) => item.name === "hello.txt").size, 5);
  } finally {
    state.disposed = true;
    await state.localSession?.close().catch(() => {});
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("host-owned existing environment sessions remain visible without blocking a new connection", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-remote-ops-host-session-test-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const context = fakeContext();
  const owner = { id: "agent-existing" };
  const existing = { sessionId: "pty-existing", name: "prod-1", type: "ssh", status: { kind: "running" } };
  const hostSessions = [existing];
  const state = new RemoteOpsState(context);
  let spawnCount = 0;
  context.terminals = {
    list: () => hostSessions,
    spawn: async (_owner, request) => {
      spawnCount += 1;
      const sessionId = "pty-new";
      state.backendSessions.set(sessionId, fakeRemoteSession());
      hostSessions.push({ sessionId, name: request.name, type: "ssh", status: { kind: "running" } });
      return { sessionId };
    },
    read: () => ({ text: "", totalLines: 0, lineBegin: 0, lineEnd: 0, truncated: false }),
    startSend: () => ({ done: Promise.resolve({ waitReason: "inferred_idle", output: "", viewport: "", sessionStatus: existing.status, truncated: false }) }),
  };
  try {
    await state.ready;
    await state.saveEnvironment({ id: "prod-1", name: "生产环境", host: "10.0.0.1", username: "root", group: "default", port: 22 });
    const record = await state.open(owner, "prod-1");
    assert.equal(record.sessionId, "pty-new");
    assert.equal(spawnCount, 1);
    assert.equal(state.snapshot(owner).sessions.some((item) => item.sessionId === existing.sessionId), true);
    assert.equal(state.snapshot(owner).sessions.some((item) => item.sessionId === record.sessionId), true);
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

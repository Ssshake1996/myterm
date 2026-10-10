import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Client as SshClient } from "ssh2";
import { SshTerminalSession, buildSshShellOptions } from "../lib/terminal-sessions.js";
import { OWNER, fixture } from "./helpers.mjs";

function fakeSsh({ onWrite } = {}) {
  const client = new EventEmitter();
  client.end = () => {};
  const channel = new EventEmitter();
  channel.stderr = new EventEmitter();
  channel.windows = [];
  channel.writes = [];
  channel.write = (text) => { channel.writes.push(String(text)); onWrite?.(String(text), channel); return true; };
  channel.end = () => {};
  channel.setWindow = (...size) => channel.windows.push(size);
  return { client, channel };
}
const environment = { id: "dev-1", name: "device-1", host: "10.0.0.9", username: "admin" };

test("an environment's PTY size reaches the shell request and the session reports it", async (t) => {
  assert.deepEqual(buildSshShellOptions().window, { term: "xterm-256color", rows: 40, cols: 160 });
  assert.deepEqual(buildSshShellOptions({ terminal: { cols: 200 } }).window, { term: "xterm-256color", rows: 40, cols: 200 });
  const { state } = await fixture(t, () => "");
  const { channel } = fakeSsh();
  let requested;
  t.mock.method(SshClient.prototype, "connect", function () { queueMicrotask(() => this.emit("ready")); return this; });
  t.mock.method(SshClient.prototype, "shell", (window, _options, callback) => { requested = window; callback(null, channel); });
  await state.saveEnvironment({ ...environment, terminal: { rows: 50, cols: 200 } });
  const session = await state.spawnBackend({ name: "dsh-remote-ops-dev-1-abc-1", sessionId: "s-1" });
  assert.deepEqual(requested, { term: "xterm-256color", rows: 50, cols: 200 });
  assert.deepEqual(session.size, { rows: 50, cols: 200 });
  await session.close();
});

test("resize changes the remote PTY, keeps the other dimension, validates ranges and refuses a closed session", () => {
  const { client, channel } = fakeSsh();
  const session = new SshTerminalSession(client, channel, environment);
  assert.deepEqual(session.size, { rows: 40, cols: 160 });
  assert.deepEqual(session.resize(50, 200), { rows: 50, cols: 200 });
  assert.deepEqual(session.resize(undefined, 120), { rows: 50, cols: 120 });
  assert.deepEqual(session.resize(30), { rows: 30, cols: 120 });
  assert.deepEqual(channel.windows, [[50, 200, 0, 0], [50, 120, 0, 0], [30, 120, 0, 0]]);
  for (const [rows, cols] of [[5, 100], [300, 100], [40, 10], [40, 9000], [4.5, 100], ["40", 100]]) assert.throws(() => session.resize(rows, cols), { code: "TERMINAL_OPTION_INVALID" }, `${rows}x${cols}`);
  assert.equal(channel.windows.length, 3, "rejected sizes never reach the channel");
  delete channel.setWindow;
  assert.throws(() => session.resize(40, 100), { code: "TERMINAL_RESIZE_UNSUPPORTED" });
  channel.emit("close");
  assert.throws(() => session.resize(40, 100), { code: "REMOTE_SESSION_EXITED" });
});

test("a dropped connection keeps its reason, never crashes on late transport errors and tells the caller how to recover", () => {
  const { client, channel } = fakeSsh();
  const session = new SshTerminalSession(client, channel, environment);
  const closes = [];
  session.onClose = (info) => closes.push(info);
  assert.doesNotThrow(() => client.emit("error", new Error("Keepalive timeout")));
  assert.doesNotThrow(() => client.emit("error", new Error("read ECONNRESET")), "a second error must not become an uncaught exception either");
  channel.emit("close");
  channel.emit("close");
  client.emit("close");
  assert.equal(closes.length, 1, "observers are told exactly once");
  assert.deepEqual(closes[0], { reason: "Keepalive timeout", requested: false, exitCode: null, signal: null });
  assert.deepEqual(session.status(), { kind: "exited", exitCode: null, signal: null, reason: "Keepalive timeout" });
  for (const attempt of [() => session.startSend({ text: "x" }), () => session.write("x"), () => session.writeInput("x"), () => session.signal("SIGINT")]) {
    assert.throws(attempt, (error) => {
      assert.equal(error.code, "REMOTE_SESSION_EXITED");
      assert.match(error.message, /SSH connection to device-1 has exited \(Keepalive timeout\)/);
      assert.match(error.message, /Nothing was replayed/);
      assert.match(error.message, /remote_terminal_open \(environment "device-1"\)/);
      return true;
    });
  }
});

test("a normal remote exit reports its exit code and a requested release is flagged as such", async () => {
  const exited = fakeSsh();
  const session = new SshTerminalSession(exited.client, exited.channel, environment);
  const seen = [];
  session.onClose = (info) => seen.push(info);
  exited.channel.emit("exit", 0);
  exited.channel.emit("close");
  assert.equal(session.status().reason, "remote shell exited with code 0");
  assert.equal(seen[0].requested, false);
  const released = fakeSsh();
  const own = new SshTerminalSession(released.client, released.channel, environment);
  const ownSeen = [];
  own.onClose = (info) => ownSeen.push(info);
  await own.close();
  released.channel.emit("close");
  assert.equal(ownSeen[0].requested, true);
});

test("the state remembers unexpected disconnects per owner and ignores requested releases", async (t) => {
  const { state } = await fixture(t, () => "");
  const drop = fakeSsh();
  const dropped = new SshTerminalSession(drop.client, drop.channel, environment);
  const record = { sessionId: "ssh-drop", ownerId: OWNER.id, owner: OWNER, environment, session: dropped };
  state.sessions.set(record.sessionId, record);
  dropped.onClose = (info) => state.recordDisconnect(record, info);
  drop.client.emit("error", new Error("read ECONNRESET"));
  drop.channel.emit("close");
  const release = fakeSsh();
  const released = new SshTerminalSession(release.client, release.channel, { ...environment, id: "dev-2", name: "device-2" });
  const second = { sessionId: "ssh-release", ownerId: OWNER.id, owner: OWNER, environment: { ...environment, id: "dev-2", name: "device-2" }, session: released };
  state.sessions.set(second.sessionId, second);
  released.onClose = (info) => state.recordDisconnect(second, info);
  await released.close();
  release.channel.emit("close");
  const snapshot = state.snapshot(OWNER);
  assert.equal(snapshot.disconnects.length, 1);
  assert.equal(snapshot.disconnects[0].sessionId, "ssh-drop");
  assert.equal(snapshot.disconnects[0].environment, "device-1");
  assert.equal(snapshot.disconnects[0].reason, "read ECONNRESET");
  assert.equal(snapshot.sessions.some((entry) => entry.sessionId === "ssh-drop"), false, "an exited connection is no longer listed as live");
  assert.equal(state.events.get(OWNER.id).some((event) => event.kind === "ssh.disconnected" && event.reason === "read ECONNRESET"), true);
  assert.equal(Object.hasOwn(state.snapshot({ id: "someone-else" }), "disconnects"), false);
  for (let index = 0; index < 15; index += 1) state.recordDisconnect(record, { reason: `r${index}` });
  assert.equal(state.snapshot(OWNER).disconnects.length, 10, "only the latest ten are kept");
});

test("a send that ends because the connection dropped carries a reconnect hint, and later sends explain themselves", async (t) => {
  const { state, ctx } = await fixture(t, () => "");
  const { client, channel } = fakeSsh({ onWrite: (text, ch) => { if (text === "drop\r") { ch.emit("data", Buffer.from("bye\r\n")); ch.emit("exit", 255); ch.emit("close"); } } });
  const session = new SshTerminalSession(client, channel, environment);
  state.sessions.set("ssh-live", { sessionId: "ssh-live", ownerId: OWNER.id, owner: OWNER, environment, session });
  ctx.terminals = { list: () => [], startSend: (_owner, _id, request) => session.startSend(request) };
  const result = await state.send(OWNER, "ssh-live", { text: "drop", quietMs: 30, timeoutSeconds: 5 });
  assert.equal(result.waitReason, "session_exit");
  assert.equal(result.sessionStatus.kind, "exited");
  assert.equal(result.reconnect.environment, "device-1");
  assert.equal(result.reconnect.reason, "remote shell exited with code 255");
  assert.match(result.reconnect.hint, /Nothing is replayed automatically/);
  await assert.rejects(state.send(OWNER, "ssh-live", { text: "again" }), (error) => error.code === "REMOTE_SESSION_EXITED" && /remote_terminal_open/.test(error.message));
  assert.equal(channel.writes.includes("again\r"), false, "nothing was typed into a dead connection");
});

test("state.resize works for SSH, refuses local and adopted terminals, and frames report the size to the UI", async (t) => {
  const { state } = await fixture(t, () => "");
  const { client, channel } = fakeSsh();
  const session = new SshTerminalSession(client, channel, environment);
  state.sessions.set("ssh-size", { sessionId: "ssh-size", ownerId: OWNER.id, owner: OWNER, environment, session });
  const resized = await state.resize(OWNER, "ssh-size", 50, 200);
  assert.deepEqual({ rows: resized.rows, cols: resized.cols, environment: resized.environment }, { rows: 50, cols: 200, environment: "device-1" });
  assert.deepEqual((await state.terminalOutput(OWNER, "ssh-size")).size, { rows: 50, cols: 200 });
  assert.deepEqual((await state.terminalOutput(OWNER, "local-cmd")).size, { rows: 40, cols: 160 });
  await assert.rejects(state.resize(OWNER, "local-cmd", 50, 200), { code: "TERMINAL_RESIZE_UNSUPPORTED" });
  await assert.rejects(state.resize(OWNER, "ssh-size"), { code: "TERMINAL_OPTION_INVALID" });
  await assert.rejects(state.resize(OWNER, "ssh-missing", 50, 200), { code: "REMOTE_SESSION_NOT_FOUND" });
  state.sessions.set("ssh-adopted", { sessionId: "ssh-adopted", ownerId: OWNER.id, owner: OWNER, environment, session: { status: () => ({ kind: "running" }), outputBuffer: session.outputBuffer } });
  await assert.rejects(state.resize(OWNER, "ssh-adopted", 50, 200), { code: "TERMINAL_RESIZE_UNSUPPORTED" });
  assert.equal(state.events.get(OWNER.id).some((event) => event.kind === "ssh.resize" && event.cols === 200), true);
});

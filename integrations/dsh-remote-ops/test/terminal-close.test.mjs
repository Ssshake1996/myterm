import test from "node:test";
import assert from "node:assert/strict";
import { withConnections } from "../lib/state/connections.js";
import { withCommands } from "../lib/state/commands.js";
import { withSnapshots } from "../lib/state/snapshots.js";
import { withTerminalIo } from "../lib/state/terminal-io.js";
import { registerTools } from "../lib/tools.js";

const TestState = withTerminalIo(withCommands(withConnections(withSnapshots(class {}))));

const owner = { id: "conversation-a" };
const fixture = () => {
  const state = Object.assign(new TestState(), { ready: Promise.resolve(), sessions: new Map(), commands: new Map() });
  const killed = [];
  state.ctx = { terminals: { async kill(_owner, id) { killed.push(id); state.sessions.get(id).session.closed = true; } } };
  const add = (id, ownerId = owner.id) => {
    const session = { closed: false, status() { return { kind: this.closed ? "exited" : "running" }; }, outputBuffer: { notify() {} } };
    const record = { sessionId: id, ownerId, environment: { id: "environment", name: id }, session };
    state.sessions.set(id, record); return record;
  };
  const job = (id, target, jobOwner = owner.id) => {
    const controller = new AbortController();
    const done = new Promise(resolve => controller.signal.addEventListener("abort", () => resolve({ status: "cancelled" }), { once: true }));
    const value = { owner: jobOwner, target, controller, done, status: "running", actor: "agent" };
    state.commands.set(id, value); return value;
  };
  return { state, killed, add, job };
};

test("batch closes only selected SSH IDs, preserving local, foreign and newly opened sessions", async () => {
  const { state, killed, add } = fixture();
  add("ssh-a"); add("ssh-new"); add("foreign", "conversation-b");
  const local = { closed: false }; state.localSession = local;
  const result = await state.closeMany(owner, ["ssh-a", "already-gone"]);
  assert.deepEqual(killed, ["ssh-a"]);
  assert.ok(result.results.every(item => item.closed));
  assert.equal(result.results[1].alreadyClosed, true);
  assert.deepEqual([...state.sessions.keys()], ["ssh-new", "foreign"]);
  assert.equal(local.closed, false);
});

test("mixed foreign/local and malformed selections reject before any close", async () => {
  const { state, killed, add } = fixture(); add("ssh-a"); add("foreign", "conversation-b");
  for (const targets of [["ssh-a", "local-cmd"], ["ssh-a", "foreign"], ["ssh-a", "ssh-a"], [], "ssh-a", [null]]) {
    await assert.rejects(state.closeMany(owner, targets));
    assert.equal(killed.length, 0);
  }
  await assert.rejects(state.closeMany(undefined, ["ssh-a"]), { code: "REMOTE_SESSION_REQUIRED" });
});

test("batch preserves failed connections and reports partial success without retrying", async () => {
  const { state, killed, add } = fixture(); add("good"); const bad = add("bad");
  state.ctx.terminals.kill = async (_owner, id) => { killed.push(id); if (id === "bad") throw new Error("close refused"); };
  const result = await state.closeMany(owner, ["good", "bad"]);
  assert.equal(result.results[0].closed, true);
  assert.equal(result.results[1].closed, false);
  assert.match(result.results[1].error, /close refused/);
  assert.equal(state.sessions.get("bad"), bad);
  assert.equal(bad.session.closing, false);
  assert.deepEqual(killed.sort(), ["bad", "good"]);
});

test("close cancels the associated independent command, blocks new input, and coalesces duplicates", async () => {
  const { state, add, job } = fixture(); const record = add("ssh-a");
  const active = job("active", "ssh-a"), other = job("other", "ssh-b"), local = job("local", "local-cmd");
  let release, kills = 0;
  state.ctx.terminals.kill = () => { kills++; return new Promise(resolve => { release = resolve; }); };
  const first = state.close(owner, "ssh-a"), second = state.close(owner, "ssh-a");
  assert.equal(record.session.closing, true);
  assert.equal(active.controller.signal.aborted, true);
  assert.equal(other.controller.signal.aborted, false); assert.equal(local.controller.signal.aborted, false);
  await assert.rejects(state.execute(owner, "ssh-a", { command: "echo no" }), { code: "REMOTE_SESSION_CLOSING" });
  await assert.rejects(state.input(owner, "ssh-a", "no"), { code: "REMOTE_SESSION_CLOSING" });
  release();
  const results = await Promise.all([first, second]);
  assert.equal(kills, 1); assert.equal(results[0].cancelledCommands, 1);
  assert.equal(results[0].terminationConfirmed, false);
  assert.equal(state.sessions.has("ssh-a"), false);
});

test("clearing a disconnected tab also cancels its orphaned exec without touching another owner", async () => {
  const { state, job } = fixture(); const orphan = job("orphan", "gone"), foreign = job("foreign", "foreign-gone", "conversation-b");
  const result = await state.closeMany(owner, ["gone"]);
  assert.equal(result.results[0].cancelledCommands, 1);
  assert.equal(orphan.controller.signal.aborted, true); assert.equal(foreign.controller.signal.aborted, false);
});

test("a failed channel close keeps the closing guard until command cancellation settles", async () => {
  const { state, add } = fixture(); const record = add("ssh-a");
  let finish;
  state.cancelCommandsFor = () => new Promise(resolve => { finish = resolve; });
  state.ctx.terminals.kill = async () => { throw new Error("channel close failed"); };
  const task = state.close(owner, "ssh-a");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(record.session.closing, true);
  finish(1);
  await assert.rejects(task, /channel close failed/);
  assert.equal(record.session.closing, false); assert.equal(state.sessions.get("ssh-a"), record);
});

test("the existing close tool also cancels its command and returns the termination caveat", async () => {
  const { state, add, job } = fixture(); add("ssh-a"); const active = job("active", "ssh-a");
  const tools = new Map(); state.toolWarnings = [];
  registerTools({ tools: { register: tool => tools.set(tool.name, tool) }, systemPrompt: { section() {} } }, state);
  const result = await tools.get("remote_terminal_close").execute({ session: "ssh-a" }, { agent: owner });
  assert.equal(active.controller.signal.aborted, true); assert.equal(result.closed, true);
  assert.equal(result.cancelledCommands, 1); assert.equal(result.terminationConfirmed, false);
});

test("terminal operation distinguishes known execution from connection/output activity", () => {
  const { state, add, job } = fixture(); const { session } = add("ssh-a");
  const status = () => state.terminalOperation(session, "ssh-a", owner.id);
  const initial = status(); assert.equal(initial.kind, "idle");
  session.lastActivity = Date.now(); assert.equal(status().revision, initial.revision);
  job("foreign", "ssh-a", "conversation-b"); assert.equal(status().kind, "idle");
  session.pendingSend = {}; session.pendingSendActor = "agent";
  assert.equal(status().kind, "waiting"); assert.equal(status().actor, "agent");
  session.pendingSend = undefined;
  job("exec", "ssh-a"); assert.equal(status().kind, "command");
  state.commands.delete("exec"); assert.equal(status().kind, "idle");
  assert.ok(status().revision > initial.revision);
  session.closing = true; assert.equal(status().kind, "closing");
  session.closing = false; session.closed = true; assert.equal(status().kind, "disconnected");
});

test("a disconnected Windows PTY retains its active exec until cancelled, then leaves reconciliation", async () => {
  const { state, killed, add, job } = fixture(); const record = add("ssh-a"); record.session.closed = true;
  job("active", "ssh-a"); state.ctx.terminals.list = () => []; state.event = () => {};
  state.reconcileHostSessions(owner);
  assert.equal(state.sessions.get("ssh-a"), record);
  assert.equal(state.terminalOperation(record.session, "ssh-a", owner.id).kind, "command");
  const result = await state.closeMany(owner, ["ssh-a"]);
  assert.equal(result.results[0].cancelledCommands, 1); assert.equal(result.results[0].closed, true);
  assert.deepEqual(killed, [], "the exited PTY does not need another host kill");
  state.commands.clear(); const finished = add("finished"); finished.session.closed = true;
  state.reconcileHostSessions(owner); assert.equal(state.sessions.has("finished"), false);
});

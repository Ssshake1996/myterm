import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteOpsState } from "../lib/index.js";
import {
  AUTO_SIGINT_MARKER, compileConfirmPattern, detectContamination, detectPrompt, resolveAssistOptions, stripAnsi,
} from "../lib/cli-assist.js";

const OWNER = { id: "agent" };
const MORE = "--More--(Quit : q|Q)(Next Record : Enter)(Next Page : Space)(To End : G)";
const PARAM_ERROR = "admin:/>show host_group general host_id=3\r\n                                     ^\r\n[host_group_id=?]           [host_group_name=?]\r\nadmin:/>";

class ScriptedTerminal {
  constructor(script) {
    this.script = script;
    this.output = new EventEmitter();
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
    this.writes = [];
    this.signals = [];
  }
  async write(text) {
    this.writes.push(String(text));
    const reply = this.script(String(text), this.writes);
    if (reply) setTimeout(() => this.output.emit("data", Buffer.from(reply)), 5);
  }
  async signalForeground(signal) { this.signals.push(signal); return 1; }
  async terminate() { this.output.emit("end"); this.resolveDone({ exitCode: 0, signal: null }); }
}

async function fixture(t, script) {
  const root = await mkdtemp(join(tmpdir(), "dsh-cli-assist-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const terminal = new ScriptedTerminal(script);
  const ctx = {
    subprocess: { resolveExecutable: async (value) => value, spawnTerminal: async () => terminal },
    credentials: { async set() {}, async resolve() { return {}; } },
  };
  const state = new RemoteOpsState(ctx);
  await state.ready;
  t.after(async () => {
    state.disposed = true;
    await state.localSession?.close().catch(() => {});
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });
  return { state, terminal };
}

const send = (state, args) => state.send(OWNER, "local-cmd", { quietMs: 30, timeoutSeconds: 5, ...args });

test("prompt and contamination detectors follow the documented patterns", () => {
  const options = { autoConfirm: true, confirmPattern: compileConfirmPattern(), autoQuitMore: true };
  assert.equal(detectPrompt("Are you sure you really want to perform the operation?(y/n) ", options), "confirm");
  assert.equal(detectPrompt("\u001b[1mcontinue?(Y/N)\u001b[0m", options), "confirm");
  assert.equal(detectPrompt("(y/n) done\r\nadmin:/>", options), undefined);
  assert.equal(detectPrompt(`rows\r\n${MORE}`, options), "quit-more");
  assert.equal(detectPrompt(`rows\r\n${MORE}`, { ...options, autoQuitMore: false }), undefined);
  assert.equal(detectContamination(PARAM_ERROR), true);
  assert.equal(detectContamination("admin:/>show host\r\nname=a\r\nadmin:/>"), false);
  assert.equal(stripAnsi("\u001b[31mred\u001b[0m\u001b]0;title\u0007"), "red");
  assert.deepEqual(resolveAssistOptions({ actor: "manual", autoConfirm: true, autoQuitMore: true }), { autoConfirm: false, confirmPattern: undefined, autoQuitMore: false, autoSigint: false });
  assert.equal(resolveAssistOptions({}).autoSigint, true);
  assert.equal(resolveAssistOptions({ autoSigint: false }).autoSigint, false);
  assert.throws(() => compileConfirmPattern("("), { code: "AUTO_CONFIRM_PATTERN_INVALID" });
});

test("autoConfirm answers both confirmation layers and records the steps", async (t) => {
  const { state, terminal } = await fixture(t, (text, writes) => {
    if (text === "delete x\r") return "WARNING: You are about to delete x\r\nHave you read warning message carefully?(y/n)";
    if (text === "y\r" && writes.filter((item) => item === "y\r").length === 1) return "\r\nAre you sure you really want to perform the operation?(y/n)";
    if (text === "y\r") return "\r\nSuccess\r\nadmin:/>";
  });
  const result = await send(state, { text: "delete x", autoConfirm: true });
  assert.deepEqual(terminal.writes, ["delete x\r", "y\r", "y\r"]);
  assert.match(result.output, /Success/);
  assert.match(result.output, /Have you read warning message carefully/);
  assert.deepEqual(result.autoActions, [{ type: "confirm", count: 1 }, { type: "confirm", count: 2 }]);
  assert.equal(result.waitReason, "inferred_idle");
  assert.equal(result.completion, "unknown");
  assert.deepEqual((state.events.get("agent") ?? []).filter((item) => item.kind === "terminal.auto.confirm").map((item) => item.count), [1, 2]);
});

test("autoConfirm is opt-in and never answers for manual sends", async (t) => {
  const { state, terminal } = await fixture(t, (text) => text === "delete x\r" ? "Sure?(y/n)" : "");
  const plain = await send(state, { text: "delete x" });
  assert.deepEqual(terminal.writes, ["delete x\r"]);
  assert.equal(Object.hasOwn(plain, "autoActions"), false);
  await send(state, { text: "delete x", autoConfirm: true, actor: "manual" });
  assert.deepEqual(terminal.writes, ["delete x\r", "delete x\r"]);
});

test("autoConfirm stops after three answers and leaves the prompt to the caller", async (t) => {
  const { state, terminal } = await fixture(t, () => "again?(y/n)");
  const result = await send(state, { text: "loop", autoConfirm: true });
  assert.deepEqual(terminal.writes, ["loop\r", "y\r", "y\r", "y\r"]);
  assert.equal(result.autoActions.length, 3);
  assert.match(result.output, /again\?\(y\/n\)$/);
});

test("confirmPattern customises the prompt and invalid patterns fail before any write", async (t) => {
  const { state, terminal } = await fixture(t, (text) => text === "format\r" ? "Proceed [yes/no]: " : text === "y\r" ? "ok" : "");
  assert.deepEqual((await send(state, { text: "format", autoConfirm: true })).autoActions ?? [], []);
  const custom = await send(state, { text: "format", autoConfirm: true, confirmPattern: "\\[yes/no\\]:\\s*$" });
  assert.deepEqual(custom.autoActions, [{ type: "confirm", count: 1 }]);
  const writes = terminal.writes.length;
  await assert.rejects(send(state, { text: "format", autoConfirm: true, confirmPattern: "(" }), { code: "AUTO_CONFIRM_PATTERN_INVALID" });
  assert.equal(terminal.writes.length, writes);
});

test("autoQuitMore sends q without Enter and returns the remaining output", async (t) => {
  const { state, terminal } = await fixture(t, (text) => text === "show lun\r" ? `lun1\r\nlun2\r\n${MORE}` : text === "q" ? "\r\nadmin:/>" : "");
  const result = await send(state, { text: "show lun", autoQuitMore: true });
  assert.deepEqual(terminal.writes, ["show lun\r", "q"]);
  assert.deepEqual(result.autoActions, [{ type: "quit-more", count: 1 }]);
  assert.match(result.output, /admin:\/>$/);
  const untouched = await send(state, { text: "show lun" });
  assert.equal(terminal.writes.at(-1), "show lun\r");
  assert.equal(Object.hasOwn(untouched, "autoActions"), false);
});

test("a parameter-error hint triggers one SIGINT and a visible marker", async (t) => {
  const { state, terminal } = await fixture(t, (text) => text.startsWith("show host_group") ? PARAM_ERROR : "");
  const result = await send(state, { text: "show host_group general host_id=3" });
  assert.deepEqual(terminal.signals, ["SIGINT"]);
  assert.deepEqual(result.autoActions, [{ type: "sigint" }]);
  assert.ok(result.output.endsWith(`\n${AUTO_SIGINT_MARKER}`));
  assert.equal(state.localSession.outputBuffer.value.includes(AUTO_SIGINT_MARKER), false);
});

test("autoSigint can be disabled and ordinary output never triggers it", async (t) => {
  const { state, terminal } = await fixture(t, (text) => text.startsWith("bad") ? PARAM_ERROR : "fine\r\nadmin:/>");
  const disabled = await send(state, { text: "bad", autoSigint: false });
  assert.deepEqual(terminal.signals, []);
  assert.equal(disabled.output.includes(AUTO_SIGINT_MARKER), false);
  await send(state, { text: "good" });
  assert.deepEqual(terminal.signals, []);
});

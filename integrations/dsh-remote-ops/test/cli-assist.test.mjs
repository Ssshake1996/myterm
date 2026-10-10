import test from "node:test";
import assert from "node:assert/strict";
import { RemoteOpsState, validateEnvironment } from "../lib/index.js";
import { OWNER, ScriptedTerminal, fixture } from "./helpers.mjs";
import { LocalCmdTerminalSession } from "../lib/terminal-sessions.js";
import {
  AUTO_SIGINT_MARKER, buildPromptRules, compileAnswers, compileConfirmPattern, detectContamination, detectPrompt, matchPromptRule, resolveAssistOptions, stripAnsi,
} from "../lib/cli-assist.js";
import { normalizeCliProfile, normalizeTerminalSize, validateCliProfile, validateTerminalSize } from "../lib/cli-profile.js";

const MORE = "--More--(Quit : q|Q)(Next Record : Enter)(Next Page : Space)(To End : G)";
const PARAM_ERROR = "admin:/>show host_group general host_id=3\r\n                                     ^\r\n[host_group_id=?]           [host_group_name=?]\r\nadmin:/>";

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
  assert.deepEqual(resolveAssistOptions({ actor: "manual", autoConfirm: true, autoQuitMore: true }), { autoConfirm: false, confirmPattern: undefined, autoQuitMore: false, autoSigint: false, stripAnsi: false, headTailChars: 0, answers: [] });
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

function addRemote(state, ctx, script, environment) {
  const terminal = new ScriptedTerminal(script);
  const session = new LocalCmdTerminalSession(terminal, environment);
  const record = { sessionId: "ssh-profile", ownerId: OWNER.id, owner: OWNER, environment, session };
  state.sessions.set(record.sessionId, record);
  ctx.terminals = { list: () => [], startSend: (_owner, _id, request) => session.startSend(request) };
  return { terminal, session };
}
const device = (cliProfile) => ({ id: "dev-1", name: "device-1", host: "10.0.0.9", username: "admin", port: 22, ...(cliProfile ? { cliProfile } : {}) });
const sendRemote = (state, args) => state.send(OWNER, "ssh-profile", { quietMs: 30, timeoutSeconds: 5, ...args });

test("environment profile supplies defaults and call arguments override it", async (t) => {
  const { state, ctx } = await fixture(t, () => "");
  const { terminal } = addRemote(state, ctx, (text) => text === "delete\r" ? "Sure?(y/n)" : text === "y\r" ? "done" : "", device({ autoConfirm: true }));
  const profiled = await sendRemote(state, { text: "delete" });
  assert.deepEqual(terminal.writes, ["delete\r", "y\r"]);
  assert.deepEqual(profiled.autoActions, [{ type: "confirm", count: 1 }]);
  const overridden = await sendRemote(state, { text: "delete", autoConfirm: false });
  assert.deepEqual(terminal.writes.slice(2), ["delete\r"]);
  assert.equal(Object.hasOwn(overridden, "autoActions"), false);
});

test("environment profile controls SIGINT, ANSI stripping and the confirm pattern", async (t) => {
  const { state, ctx } = await fixture(t, () => "");
  const colored = (text) => text === "show\r" ? "\u001b[31mred\u001b[0m table\r\n" : text === "wipe\r" ? "Proceed [yes/no]: " : text === "y\r" ? "ok" : text.startsWith("bad") ? PARAM_ERROR : "";
  const { terminal } = addRemote(state, ctx, colored, device({ autoSigint: false, stripAnsi: true, autoConfirm: true, confirmPattern: "\\[yes/no\\]:\\s*$" }));
  const shown = await sendRemote(state, { text: "show" });
  assert.equal(shown.output.includes("\u001b"), false);
  assert.match(shown.output, /red table/);
  assert.equal(shown.ansiStripped, true);
  const raw = await sendRemote(state, { text: "show", stripAnsi: false });
  assert.match(raw.output, /\u001b\[31mred/);
  assert.equal((await sendRemote(state, { text: "wipe" })).autoActions[0].type, "confirm");
  await sendRemote(state, { text: "bad" });
  assert.deepEqual(terminal.signals, [], "profile disabled the automatic SIGINT");
  await sendRemote(state, { text: "bad", autoSigint: true });
  assert.deepEqual(terminal.signals, ["SIGINT"]);
});

test("reads honour stripAnsi and head/tail summaries, and the omitted range can be read back", async (t) => {
  const { state, ctx } = await fixture(t, () => "");
  const lines = Array.from({ length: 150 }, (_, index) => `\u001b[32mrow ${String(index).padStart(3, "0")}\u001b[0m ${"#".repeat(30)}\r\n`).join("");
  addRemote(state, ctx, (text) => text === "dump\r" ? lines : "", device({ stripAnsi: true }));
  const sent = await sendRemote(state, { text: "dump", headTailChars: 400, maxChars: 100000 });
  assert.equal(sent.summarized, true);
  assert.equal(sent.output.includes("\u001b"), false);
  assert.match(sent.output, /row 000/);
  assert.match(sent.output, /row 149/);
  assert.ok(sent.output.length < 1200);
  assert.equal(sent.omitted.startOffset < sent.omitted.endOffset, true);
  const receipt = (await state.terminalOutput(OWNER, "ssh-profile")).toolReceipt;
  assert.equal(receipt.truncated, true, "a summarized send must not be recorded as a fully returned range");
  const back = await state.readTerminal(OWNER, "ssh-profile", { cursor: sent.omitted.startOffset, streamId: sent.streamId, maxChars: sent.omitted.endOffset - sent.omitted.startOffset, stripAnsi: false });
  assert.equal(back.text.length, sent.omitted.endOffset - sent.omitted.startOffset);
  assert.match(back.text, /\u001b\[32mrow/);
  const stripped = await state.readTerminal(OWNER, "ssh-profile", { cursor: sent.omitted.startOffset, streamId: sent.streamId, maxChars: sent.omitted.endOffset - sent.omitted.startOffset });
  assert.equal(stripped.text.includes("\u001b"), false, "profile stripAnsi applies to reads too");
});

test("line history reads can be stripped and summarized too, without offsets", async (t) => {
  const { state, terminal } = await fixture(t, () => "");
  terminal.output.emit("data", Buffer.from(Array.from({ length: 300 }, (_, index) => `\u001b[33mhistory ${index}\u001b[0m`).join("\r\n")));
  const history = await state.readTerminal(OWNER, "local-cmd", { offset: 0, count: 500, stripAnsi: true, headTailChars: 400 });
  assert.equal(history.summarized, true);
  assert.equal(history.ansiStripped, true);
  assert.equal(history.text.includes("\u001b"), false);
  assert.match(history.text, /history 0/);
  assert.match(history.text, /history 299/);
  assert.match(history.text, /browse them with offset\/count/);
  assert.equal(Object.hasOwn(history.omitted, "startOffset"), false);
  const plain = await state.readTerminal(OWNER, "local-cmd", { offset: 0, count: 5 });
  assert.match(plain.text, /\u001b\[33m/);
  assert.equal(Object.hasOwn(plain, "summarized"), false);
});

test("output options are validated before anything is typed", async (t) => {
  const { state, terminal } = await fixture(t, () => "");
  await assert.rejects(send(state, { text: "x", headTailChars: 50 }), { code: "TERMINAL_OPTION_INVALID" });
  await assert.rejects(send(state, { text: "x", headTailChars: 1e9 }), { code: "TERMINAL_OPTION_INVALID" });
  assert.deepEqual(terminal.writes, []);
  assert.equal((await send(state, { text: "x", headTailChars: 0 })).output, "");
});

test("answers are honoured only when compiled, answer in order up to times, then stop", async (t) => {
  const { state, terminal } = await fixture(t, (text, writes) => {
    if (text === "install\r") return "Accept license? [a/b]: ";
    if (text === "a\r") return "Proceed with install? (yes/no) ";
    if (text === "yes\r") return writes.filter((item) => item === "yes\r").length < 2 ? "Proceed with install? (yes/no) " : "installed\r\nadmin:/>";
  });
  const answers = compileAnswers([{ pattern: "license\\? \\[a/b\\]:", text: "a" }, { pattern: "\\(yes/no\\)", text: "yes", times: 3 }]);
  const result = await send(state, { text: "install", answers });
  assert.deepEqual(terminal.writes, ["install\r", "a\r", "yes\r", "yes\r"]);
  assert.deepEqual(result.autoActions, [{ type: "answer", count: 1, answer: 0 }, { type: "answer", count: 1, answer: 1 }, { type: "answer", count: 2, answer: 1 }]);
  assert.match(result.output, /installed/);
  const before = terminal.writes.length;
  await send(state, { text: "install", answers: [{ pattern: "license", text: "a" }] });
  assert.equal(terminal.writes.length, before + 1, "JSON answers without a compiled RegExp are ignored");
});

test("prompt rules are prioritized and an exhausted rule stops instead of falling through", () => {
  const rules = buildPromptRules({ autoQuitMore: true, autoConfirm: true, confirmPattern: compileConfirmPattern(), answers: compileAnswers([{ pattern: "continue\\?\\s*$", text: "go", times: 2 }]) });
  assert.deepEqual(rules.map((rule) => rule.key), ["quit-more", "confirm", "answer:0"]);
  assert.equal(matchPromptRule("Really? (y/n)", rules).kind, "confirm");
  assert.equal(matchPromptRule("continue? ", rules).kind, "answer");
  assert.equal(matchPromptRule("nothing here", rules), undefined);
  assert.equal(matchPromptRule("   \r\n", rules), undefined);
  assert.throws(() => compileAnswers([{ pattern: "(", text: "x" }]), { code: "ANSWER_PATTERN_INVALID" });
  assert.throws(() => compileAnswers([{ pattern: "a", text: "x", times: 9 }]), { code: "TERMINAL_OPTION_INVALID" });
  assert.throws(() => compileAnswers("nope"), { code: "TERMINAL_OPTION_INVALID" });
  assert.deepEqual(compileAnswers(undefined), []);
});

test("cliProfile and terminal size validate strictly and normalize away defaults", () => {
  assert.deepEqual(validateCliProfile(undefined), []);
  assert.deepEqual(validateCliProfile({ autoConfirm: true, confirmPattern: "\\(y/n\\)", headTailChars: 2000 }), []);
  assert.match(validateCliProfile({ bogus: 1 }).join(), /cliProfile\.bogus is not supported/);
  assert.match(validateCliProfile({ autoConfirm: "yes" }).join(), /autoConfirm must be a boolean/);
  assert.match(validateCliProfile({ confirmPattern: "(" }).join(), /confirmPattern/);
  assert.match(validateCliProfile({ headTailChars: 12 }).join(), /headTailChars/);
  assert.deepEqual(validateCliProfile([]), ["cliProfile must be an object"]);
  assert.deepEqual(normalizeCliProfile({ autoConfirm: false, autoSigint: true, stripAnsi: false, headTailChars: 0, confirmPattern: "" }), undefined);
  assert.deepEqual(normalizeCliProfile({ autoConfirm: true, autoSigint: false, headTailChars: 800, confirmPattern: "ok\\?", extra: 1 }), { autoConfirm: true, autoSigint: false, confirmPattern: "ok\\?", headTailChars: 800 });
  assert.deepEqual(normalizeCliProfile({ autoConfirm: "yes", confirmPattern: "(", headTailChars: 3 }), undefined);
  assert.deepEqual(validateTerminalSize({ rows: 50, cols: 200 }), []);
  assert.equal(validateTerminalSize({ rows: 5 }).length, 1);
  assert.equal(validateTerminalSize({ cols: 9000 }).length, 1);
  assert.equal(validateTerminalSize({ depth: 1 }).length, 1);
  assert.deepEqual(normalizeTerminalSize({ rows: 40, cols: 160 }), undefined);
  assert.deepEqual(normalizeTerminalSize({ rows: 50, cols: 160 }), { rows: 50 });
  const base = { id: "e1", name: "e1", host: "h", username: "u" };
  assert.equal(validateEnvironment({ ...base, cliProfile: { autoConfirm: true }, terminal: { rows: 30, cols: 120 } }).ok, true);
  assert.equal(validateEnvironment({ ...base, cliProfile: { autoConfirm: 1 } }).ok, false);
  assert.equal(validateEnvironment({ ...base, terminal: { rows: 1 } }).ok, false);
});

test("saving an environment stores a normalized profile, keeps it when omitted, clears it when emptied and survives reload", async (t) => {
  const { state, ctx } = await fixture(t, () => "");
  const saved = await state.saveEnvironment({ id: "dev-1", name: "device-1", host: "10.0.0.9", username: "admin", cliProfile: { autoConfirm: true, autoSigint: true, stripAnsi: false, bogus: 1 }, terminal: { rows: 40, cols: 200 } });
  assert.deepEqual(saved.cliProfile, { autoConfirm: true });
  assert.deepEqual(saved.terminal, { cols: 200 });
  const renamed = await state.saveEnvironment({ id: "dev-1", name: "device-1", host: "10.0.0.10", username: "admin" });
  assert.deepEqual(renamed.cliProfile, { autoConfirm: true }, "omitting the field keeps the stored profile");
  const reloaded = new RemoteOpsState(ctx);
  await reloaded.ready;
  t.after(async () => { reloaded.disposed = true; await reloaded.localSession?.close().catch(() => {}); });
  assert.deepEqual(reloaded.findEnvironment("dev-1").cliProfile, { autoConfirm: true });
  assert.deepEqual(reloaded.findEnvironment("dev-1").terminal, { cols: 200 });
  const cleared = await state.saveEnvironment({ id: "dev-1", name: "device-1", host: "10.0.0.10", username: "admin", cliProfile: { autoConfirm: false, autoSigint: true }, terminal: {} });
  assert.equal(Object.hasOwn(cleared, "cliProfile"), false);
  assert.equal(Object.hasOwn(cleared, "terminal"), false);
});

test("a stored environment with an unusable profile is kept and the bad parts are dropped", async (t) => {
  const { state, ctx } = await fixture(t, () => "");
  const group = state.groupList()[0] ?? "default";
  await state.saveEnvironment({ id: "dev-2", name: "device-2", host: "10.0.0.11", username: "admin", group });
  const file = state.envFile(group);
  const stored = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));
  stored[0].cliProfile = { autoConfirm: "maybe", confirmPattern: "(", headTailChars: 3, stripAnsi: true };
  stored[0].terminal = { rows: 3, cols: "wide" };
  await (await import("node:fs/promises")).writeFile(file, JSON.stringify(stored));
  const reloaded = new RemoteOpsState(ctx);
  await reloaded.ready;
  t.after(async () => { reloaded.disposed = true; await reloaded.localSession?.close().catch(() => {}); });
  const environment = reloaded.findEnvironment("dev-2");
  assert.ok(environment, "an invalid optional field must not hide the environment");
  assert.deepEqual(environment.cliProfile, { stripAnsi: true });
  assert.equal(Object.hasOwn(environment, "terminal"), false);
});

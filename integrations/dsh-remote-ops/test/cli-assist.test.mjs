import test from "node:test";
import assert from "node:assert/strict";
import { RemoteOpsState, validateEnvironment } from "../lib/index.js";
import { OWNER, ScriptedTerminal, fixture } from "./helpers.mjs";
import { LocalCmdTerminalSession } from "../lib/terminal-sessions.js";
import {
  AUTO_SIGINT_MARKER, buildPromptRules, compileAnswers, detectContamination, matchPromptRule, resolveAssistOptions, stripAnsi,
} from "../lib/cli-assist.js";
import { normalizeCliProfile, normalizeTerminalSize, validateCliProfile, validateTerminalSize } from "../lib/cli-profile.js";

const MORE = "--More--(Quit : q|Q)(Next Record : Enter)(Next Page : Space)(To End : G)";
const PARAM_ERROR = "admin:/>show host_group general host_id=3\r\n                                     ^\r\n[host_group_id=?]           [host_group_name=?]\r\nadmin:/>";

const send = (state, args) => state.send(OWNER, "local-cmd", { quietMs: 30, timeoutSeconds: 5, ...args });


test("pager and contamination detection follow the documented patterns", () => {
  const pager = buildPromptRules({ autoQuitMore: true, answers: [] });
  assert.equal(matchPromptRule(`rows\r\n${MORE}`, pager)?.kind, "quit-more");
  assert.equal(matchPromptRule(`\u001b[1m${MORE}\u001b[0m`, pager)?.kind, "quit-more");
  assert.equal(matchPromptRule(`rows\r\n${MORE}\r\nadmin:/>`, pager), undefined, "a pager line that is no longer last is not matched");
  assert.equal(matchPromptRule(`rows\r\n${MORE}`, buildPromptRules({ autoQuitMore: false, answers: [] })), undefined);
  assert.equal(matchPromptRule("Are you sure you really want to perform the operation?(y/n) ", pager), undefined, "no built-in rule answers a (y/n) prompt");
  assert.equal(detectContamination(PARAM_ERROR), true);
  assert.equal(detectContamination("admin:/>show host\r\nname=a\r\nadmin:/>"), false);
  assert.equal(stripAnsi("\u001b[31mred\u001b[0m\u001b]0;title\u0007"), "red");
  assert.deepEqual(resolveAssistOptions({ actor: "manual", autoQuitMore: true }), { autoQuitMore: false, autoSigint: false, stripAnsi: false, headTailChars: 0, answers: [] });
  assert.equal(resolveAssistOptions({}).autoSigint, true);
  assert.equal(resolveAssistOptions({ autoSigint: false }).autoSigint, false);
  assert.deepEqual(Object.keys(resolveAssistOptions({})).sort(), ["answers", "autoQuitMore", "autoSigint", "headTailChars", "stripAnsi"], "there is no automatic confirmation option");
});

test("a (y/n) confirmation is never answered automatically, whatever options are passed", async (t) => {
  const { state, terminal } = await fixture(t, (text) => text === "delete x\r" ? "WARNING: you are about to delete x\r\nHave you read warning message carefully?(y/n)" : "");
  const plain = await send(state, { text: "delete x" });
  assert.match(plain.output, /\(y\/n\)$/, "the prompt is returned to the caller");
  assert.equal(Object.hasOwn(plain, "autoActions"), false);
  const legacyOptions = [{ autoConfirm: true }, { autoConfirm: true, confirmPattern: "\\(y/n\\)\\s*$" }, { autoConfirm: true, autoQuitMore: true, autoSigint: true, stripAnsi: true }];
  for (const options of legacyOptions) {
    const result = await send(state, { text: "delete x", ...options });
    assert.equal(Object.hasOwn(result, "autoActions"), false, JSON.stringify(options));
  }
  assert.deepEqual(terminal.writes, ["delete x\r", "delete x\r", "delete x\r", "delete x\r"], "only the commands themselves were typed, never y or yes");
});

test("automatic behaviour never applies to manual sends", async (t) => {
  const { state, terminal } = await fixture(t, (text) => text === "show\r" ? `rows\r\n${MORE}` : "");
  await send(state, { text: "show", autoQuitMore: true, actor: "manual" });
  assert.deepEqual(terminal.writes, ["show\r"]);
  await state.control(OWNER, "local-cmd", "release");
  const automatic = await send(state, { text: "show", autoQuitMore: true });
  assert.deepEqual(automatic.autoActions, [{ type: "quit-more", count: 1 }]);
});

test("autoQuitMore stops after three attempts and leaves the pager to the caller", async (t) => {
  const { state, terminal } = await fixture(t, () => MORE);
  const result = await send(state, { text: "show", autoQuitMore: true });
  assert.deepEqual(terminal.writes, ["show\r", "q", "q", "q"]);
  assert.equal(result.autoActions.length, 3);
  assert.ok(result.output.endsWith("(To End : G)"));
});

test("scripted answers are the only way to type a reply, and invalid answer patterns fail before any write", async (t) => {
  const { state, terminal } = await fixture(t, (text) => text === "format\r" ? "Proceed [yes/no]: " : text === "yes\r" ? "ok" : "");
  const answers = compileAnswers([{ pattern: "\\[yes/no\\]:\\s*$", text: "yes" }]);
  assert.deepEqual((await send(state, { text: "format" })).autoActions ?? [], [], "nothing answers without an explicit answer rule");
  const answered = await send(state, { text: "format", answers });
  assert.deepEqual(answered.autoActions, [{ type: "answer", count: 1, answer: 0 }]);
  const writes = terminal.writes.length;
  assert.throws(() => compileAnswers([{ pattern: "(", text: "yes" }]), { code: "ANSWER_PATTERN_INVALID" });
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
  const { terminal } = addRemote(state, ctx, (text) => text === "show\r" ? `rows\r\n${MORE}` : text === "q" ? "\r\nadmin:/>" : "", device({ autoQuitMore: true }));
  const profiled = await sendRemote(state, { text: "show" });
  assert.deepEqual(terminal.writes, ["show\r", "q"]);
  assert.deepEqual(profiled.autoActions, [{ type: "quit-more", count: 1 }]);
  const overridden = await sendRemote(state, { text: "show", autoQuitMore: false });
  assert.deepEqual(terminal.writes.slice(2), ["show\r"]);
  assert.equal(Object.hasOwn(overridden, "autoActions"), false);
});

test("environment profile controls SIGINT and ANSI stripping", async (t) => {
  const { state, ctx } = await fixture(t, () => "");
  const colored = (text) => text === "show\r" ? "\u001b[31mred\u001b[0m table\r\n" : text.startsWith("bad") ? PARAM_ERROR : "";
  const { terminal } = addRemote(state, ctx, colored, device({ autoSigint: false, stripAnsi: true }));
  const shown = await sendRemote(state, { text: "show" });
  assert.equal(shown.output.includes("\u001b"), false);
  assert.match(shown.output, /red table/);
  assert.equal(shown.ansiStripped, true);
  const raw = await sendRemote(state, { text: "show", stripAnsi: false });
  assert.match(raw.output, /\u001b\[31mred/);
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
  const rules = buildPromptRules({ autoQuitMore: true, answers: compileAnswers([{ pattern: "continue\\?\\s*$", text: "go", times: 2 }]) });
  assert.deepEqual(rules.map((rule) => rule.key), ["quit-more", "answer:0"]);
  assert.equal(matchPromptRule("Really? (y/n)", rules), undefined, "a (y/n) prompt matches no rule unless the caller declared one");
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
  assert.deepEqual(validateCliProfile({ autoQuitMore: true, stripAnsi: true, headTailChars: 2000 }), []);
  assert.match(validateCliProfile({ bogus: 1 }).join(), /cliProfile\.bogus is not supported/);
  assert.match(validateCliProfile({ autoConfirm: true }).join(), /cliProfile\.autoConfirm was removed: the plugin no longer answers \(y\/n\) prompts automatically/);
  assert.match(validateCliProfile({ confirmPattern: "\\(y/n\\)" }).join(), /cliProfile\.confirmPattern was removed/);
  assert.match(validateCliProfile({ autoQuitMore: "yes" }).join(), /autoQuitMore must be a boolean/);
  assert.match(validateCliProfile({ headTailChars: 12 }).join(), /headTailChars/);
  assert.deepEqual(validateCliProfile([]), ["cliProfile must be an object"]);
  assert.deepEqual(normalizeCliProfile({ autoQuitMore: false, autoSigint: true, stripAnsi: false, headTailChars: 0 }), undefined);
  assert.deepEqual(normalizeCliProfile({ autoQuitMore: true, autoSigint: false, headTailChars: 800, autoConfirm: true, confirmPattern: "ok\\?", extra: 1 }), { autoQuitMore: true, autoSigint: false, headTailChars: 800 });
  assert.deepEqual(normalizeCliProfile({ autoQuitMore: "yes", headTailChars: 3 }), undefined);
  assert.deepEqual(validateTerminalSize({ rows: 50, cols: 200 }), []);
  assert.equal(validateTerminalSize({ rows: 5 }).length, 1);
  assert.equal(validateTerminalSize({ cols: 9000 }).length, 1);
  assert.equal(validateTerminalSize({ depth: 1 }).length, 1);
  assert.deepEqual(normalizeTerminalSize({ rows: 40, cols: 160 }), undefined);
  assert.deepEqual(normalizeTerminalSize({ rows: 50, cols: 160 }), { rows: 50 });
  const base = { id: "e1", name: "e1", host: "h", username: "u" };
  assert.equal(validateEnvironment({ ...base, cliProfile: { autoQuitMore: true }, terminal: { rows: 30, cols: 120 } }).ok, true);
  assert.equal(validateEnvironment({ ...base, cliProfile: { autoQuitMore: 1 } }).ok, false);
  assert.equal(validateEnvironment({ ...base, cliProfile: { autoConfirm: true } }).ok, false, "the removed option is rejected, not silently accepted");
  assert.equal(validateEnvironment({ ...base, terminal: { rows: 1 } }).ok, false);
});
test("saving an environment stores a normalized profile, keeps it when omitted, clears it when emptied and survives reload", async (t) => {
  const { state, ctx } = await fixture(t, () => "");
  const saved = await state.saveEnvironment({ id: "dev-1", name: "device-1", host: "10.0.0.9", username: "admin", cliProfile: { autoQuitMore: true, autoSigint: true, stripAnsi: false, bogus: 1 }, terminal: { rows: 40, cols: 200 } });
  assert.deepEqual(saved.cliProfile, { autoQuitMore: true });
  assert.deepEqual(saved.terminal, { cols: 200 });
  const renamed = await state.saveEnvironment({ id: "dev-1", name: "device-1", host: "10.0.0.10", username: "admin" });
  assert.deepEqual(renamed.cliProfile, { autoQuitMore: true }, "omitting the field keeps the stored profile");
  const reloaded = new RemoteOpsState(ctx);
  await reloaded.ready;
  t.after(async () => { reloaded.disposed = true; await reloaded.localSession?.close().catch(() => {}); });
  assert.deepEqual(reloaded.findEnvironment("dev-1").cliProfile, { autoQuitMore: true });
  assert.deepEqual(reloaded.findEnvironment("dev-1").terminal, { cols: 200 });
  const cleared = await state.saveEnvironment({ id: "dev-1", name: "device-1", host: "10.0.0.10", username: "admin", cliProfile: { autoQuitMore: false, autoSigint: true }, terminal: {} });
  assert.equal(Object.hasOwn(cleared, "cliProfile"), false);
  assert.equal(Object.hasOwn(cleared, "terminal"), false);
});


test("a stored environment with an unusable profile is kept and the bad parts are dropped", async (t) => {
  const { state, ctx } = await fixture(t, () => "");
  const group = state.groupList()[0] ?? "default";
  await state.saveEnvironment({ id: "dev-2", name: "device-2", host: "10.0.0.11", username: "admin", group });
  const file = state.envFile(group);
  const stored = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));
  stored[0].cliProfile = { autoQuitMore: "maybe", headTailChars: 3, stripAnsi: true };
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

test("an environment saved by v0.2.24/v0.2.25 with autoConfirm loads without it and never answers a confirmation", async (t) => {
  const { state, ctx } = await fixture(t, () => "");
  const group = state.groupList()[0] ?? "default";
  await state.saveEnvironment({ id: "dev-3", name: "device-3", host: "10.0.0.12", username: "admin", group });
  const file = state.envFile(group);
  const stored = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));
  stored[0].cliProfile = { autoConfirm: true, confirmPattern: "\\(y/n\\)\\s*$", stripAnsi: true };
  await (await import("node:fs/promises")).writeFile(file, JSON.stringify(stored));
  const reloaded = new RemoteOpsState(ctx);
  await reloaded.ready;
  t.after(async () => { reloaded.disposed = true; await reloaded.localSession?.close().catch(() => {}); });
  const environment = reloaded.findEnvironment("dev-3");
  assert.deepEqual(environment.cliProfile, { stripAnsi: true }, "the removed options are dropped on load");
  const { terminal } = addRemote(reloaded, ctx, (text) => text === "wipe\r" ? "Erase everything?(y/n)" : "", environment);
  const result = await reloaded.send(OWNER, "ssh-profile", { text: "wipe", quietMs: 30, timeoutSeconds: 5 });
  assert.deepEqual(terminal.writes, ["wipe\r"], "the stored autoConfirm no longer types y");
  assert.match(result.output, /\(y\/n\)$/);
});

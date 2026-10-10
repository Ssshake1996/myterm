import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";
import { runScript, compileSteps, MAX_SCRIPT_STEPS } from "../lib/terminal-script.js";
import { OWNER, fixture } from "./helpers.mjs";

const PROMPT = "admin:/>";
const run = (state, steps, extra = {}) => runScript(state, OWNER, { session: "local-cmd", steps, sendOptions: { quietMs: 30, timeoutSeconds: 5 }, ...extra });

// A tiny device: every command ends with the prompt; delete asks two (y/n) questions.
const device = (text, writes) => {
  if (text === "show version\r") return `v1.2.3\r\n${PROMPT}`;
  if (text === "delete lun 3\r") return "WARNING: you are about to delete lun 3\r\nHave you read warning message carefully?(y/n)";
  if (text === "y\r") return writes.filter((item) => item === "y\r").length === 1 ? "\r\nAre you sure you really want to perform the operation?(y/n)" : `\r\nSuccess\r\n${PROMPT}`;
  if (text === "show status\r") return `status=ok\r\n${PROMPT}`;
  if (text === "boom\r") return `ERROR: operation failed\r\n${PROMPT}`;
  return "";
};

test("a script of command, double confirmation and verification runs in one call", async (t) => {
  const { state, terminal } = await fixture(t, device);
  const result = await run(state, [
    { text: "show version", expect: "admin:/>$" },
    { text: "delete lun 3", answers: [{ pattern: "\\(y/n\\)\\s*$", text: "y", times: 2 }], expect: "Success\\s+admin:/>$", failOn: "ERROR" },
    { text: "show status", expect: "status=ok" },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.executed, 3);
  assert.equal(result.total, 3);
  assert.equal(result.completion, "unknown");
  assert.equal(result.sessionId, "local-cmd");
  assert.deepEqual(terminal.writes, ["show version\r", "delete lun 3\r", "y\r", "y\r", "show status\r"]);
  assert.deepEqual(result.steps.map((step) => step.expectMatched), [true, true, true]);
  assert.deepEqual(result.steps[1].autoActions, [{ type: "answer", count: 1, answer: 0 }, { type: "answer", count: 2, answer: 0 }]);
  assert.match(result.steps[1].output, /Success/);
  assert.equal(result.steps.every((step) => step.ok), true);
  assert.equal(Object.hasOwn(result.steps[0], "rawOutput"), false, "internal raw capture must not leak into results");
  assert.equal(Object.hasOwn(result, "stopped"), false);
  assert.equal((state.events.get("agent") ?? []).filter((event) => event.kind === "terminal.script").length, 1);
});

test("a failed expect stops the script and the remaining steps are never typed", async (t) => {
  const { state, terminal } = await fixture(t, device);
  const result = await run(state, [
    { text: "show version", expect: "v9\\.9" },
    { text: "show status" },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.executed, 1);
  assert.deepEqual(result.stopped, { index: 0, reason: "expect_mismatch", pattern: "v9\\.9" });
  assert.equal(result.steps[0].ok, false);
  assert.equal(result.steps[0].expectMatched, false);
  assert.deepEqual(terminal.writes, ["show version\r"]);
});

test("failOn sees the whole output even when the summary hides the middle", async (t) => {
  const filler = Array.from({ length: 120 }, (_, index) => `line ${index} ${"-".repeat(30)}`).join("\r\n");
  const { state, terminal } = await fixture(t, (text) => text === "report\r" ? `${filler}\r\nERROR: disk failure\r\n${filler}\r\n${PROMPT}` : "");
  const result = await run(state, [{ text: "report", failOn: "ERROR" }, { text: "next" }], { sendOptions: { quietMs: 30, timeoutSeconds: 5, headTailChars: 300, maxChars: 100000 } });
  assert.equal(result.steps[0].summarized, true);
  assert.equal(result.steps[0].output.includes("ERROR"), false, "the model-visible summary omitted the error line");
  assert.deepEqual(result.stopped, { index: 0, reason: "fail_pattern", pattern: "ERROR" });
  assert.deepEqual(terminal.writes, ["report\r"]);
});

test("invalid scripts are rejected before anything is typed", async (t) => {
  const { state, terminal } = await fixture(t, device);
  await assert.rejects(run(state, [{ text: "show version" }, { text: "x", expect: "(" }]), { code: "SCRIPT_PATTERN_INVALID" });
  await assert.rejects(run(state, [{ text: "show version" }, { text: "x", answers: [{ pattern: "(", text: "y" }] }]), { code: "ANSWER_PATTERN_INVALID" });
  await assert.rejects(run(state, [{ text: "show version" }, { text: "x", answers: [{ pattern: "a", text: "y", times: 99 }] }]), /steps\[1\]/);
  await assert.rejects(run(state, [{ text: "show version" }, { text: 5 }]), { code: "SCRIPT_INVALID" });
  await assert.rejects(run(state, [{ text: "x", timeoutSeconds: 9999 }]), { code: "SCRIPT_INVALID" });
  await assert.rejects(run(state, []), { code: "SCRIPT_INVALID" });
  await assert.rejects(run(state, "show version"), { code: "SCRIPT_INVALID" });
  await assert.rejects(run(state, Array.from({ length: MAX_SCRIPT_STEPS + 1 }, () => ({ text: "x" }))), { code: "SCRIPT_INVALID" });
  await assert.rejects(runScript(state, OWNER, { steps: [{ text: "x" }] }), { code: "REMOTE_SESSION_REQUIRED" });
  assert.deepEqual(terminal.writes, []);
  assert.equal(compileSteps([{ text: "ok" }])[0].submit, true);
  assert.equal(compileSteps([{ text: "q", submit: false }])[0].submit, false);
});

test("an error before the first step is thrown, a later error is reported with the executed steps", async (t) => {
  const { state } = await fixture(t, device);
  await assert.rejects(runScript(state, OWNER, { session: "ssh-missing", steps: [{ text: "x" }] }), { code: "REMOTE_SESSION_NOT_FOUND" });
  state.localSession.inputHolder = "manual";
  await assert.rejects(run(state, [{ text: "show version" }]), { code: "TERMINAL_MANUAL_CONTROL" });
  state.localSession.inputHolder = "available";
  const result = await run(state, [
    { text: "show version" },
    { text: "show status" },
  ], { sendOptions: { quietMs: 30, timeoutSeconds: 5, autoConfirm: true, confirmPattern: "(" } }).catch((error) => error);
  assert.equal(result.code, "AUTO_CONFIRM_PATTERN_INVALID", "script-level option errors surface before any step is typed");
});

test("a step that ends the session stops the script and says so", async (t) => {
  const { state, terminal } = await fixture(t, (text) => text === "reboot\r" ? "Rebooting...\r\n" : text === "show version\r" ? `v1\r\n${PROMPT}` : "");
  terminal.write = async (text) => {
    terminal.writes.push(String(text));
    if (text === "reboot\r") { terminal.output.emit("data", Buffer.from("Rebooting...\r\n")); await terminal.terminate(); }
    else if (text === "show version\r") terminal.output.emit("data", Buffer.from(`v1\r\n${PROMPT}`));
  };
  const result = await run(state, [{ text: "show version" }, { text: "reboot" }, { text: "show version" }]);
  assert.equal(result.ok, false);
  assert.equal(result.executed, 2);
  assert.equal(result.stopped.reason, "session_exit");
  assert.equal(result.stopped.index, 1);
  assert.equal(result.steps[1].sessionStatus.kind, "exited");
  assert.equal(terminal.writes.filter((item) => item === "show version\r").length, 1);
});

test("a step that never settles stops the script with a timeout instead of typing the next step", async (t) => {
  const { state, terminal } = await fixture(t, () => "");
  const result = await run(state, [{ text: "tail -f log", quietMs: 5000, timeoutSeconds: 1 }, { text: "show version" }]);
  assert.equal(result.stopped.reason, "timeout");
  assert.equal(result.executed, 1);
  assert.deepEqual(terminal.writes, ["tail -f log\r"]);
});

test("cancelling between steps stops before the next step is typed", async (t) => {
  const { state, terminal } = await fixture(t, device);
  const controller = new AbortController();
  terminal.output.on("data", () => setTimeout(() => controller.abort(), 0));
  const result = await run(state, [{ text: "show version" }, { text: "show status" }], { signal: controller.signal });
  assert.equal(result.ok, false);
  assert.ok(["cancelled"].includes(result.stopped.reason));
  assert.equal(terminal.writes.includes("show status\r"), false);
});

function pluginWith(register) {
  const tools = new Map(), cleanups = [];
  const ctx = {
    subprocess: { resolveExecutable: async (value) => value, spawnTerminal: async () => ({ output: { on() {} }, done: new Promise(() => {}), write: async () => {}, terminate: async () => {} }) },
    credentials: { async set() {}, async resolve() { return {}; } },
    tools: { register: (definition) => register(definition, tools) },
    systemPrompt: { section() {} }, agents: { get: () => undefined },
    connection: { fetch: { register() {} } }, terminals: { registerBackend() {} },
    effect: (effect) => { const cleanup = effect(); if (typeof cleanup === "function") cleanups.push(cleanup); return cleanup; },
  };
  apply(ctx);
  return { tools, cleanups };
}

test("the script tool is registered with a nested schema and a rejected schema never stops the plugin", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "dsh-script-tools-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const all = [];
  t.after(async () => {
    for (const cleanup of all.flatMap((entry) => entry.cleanups)) await cleanup();
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });
  const normal = pluginWith((definition, tools) => tools.set(definition.name, definition));
  all.push(normal);
  const script = normal.tools.get("remote_terminal_script");
  assert.ok(script);
  assert.equal(script.parameters.steps.type, "array");
  assert.equal(script.parameters.steps.required, true);
  const step = script.parameters.steps.items;
  assert.equal(step.additionalProperties, false);
  assert.equal(step.properties.text.required, true);
  assert.equal(step.properties.answers.items.properties.pattern.required, true);
  assert.equal(script.parameters.autoConfirm.type, "boolean");
  assert.equal(script.parameters.stripAnsi.type, "boolean");
  const rejecting = pluginWith((definition, tools) => { if (definition.name === "remote_terminal_script") throw new Error("host rejected the schema"); tools.set(definition.name, definition); });
  all.push(rejecting);
  assert.equal(rejecting.tools.has("remote_terminal_script"), false);
  assert.ok(rejecting.tools.has("remote_terminal_send"), "other tools stay available");
  const diagnostics = await rejecting.tools.get("remote_diagnostics").execute({}, { agent: { id: "diag" } });
  assert.deepEqual(diagnostics.toolWarnings.map((warning) => warning.tool), ["remote_terminal_script"]);
  assert.match(diagnostics.toolWarnings[0].error, /host rejected the schema/);
});

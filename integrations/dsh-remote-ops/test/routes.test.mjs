import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.js";

class IdleTerminal {
  constructor() { this.output = new EventEmitter(); this.done = new Promise((resolve) => { this.resolveDone = resolve; }); this.writes = []; }
  async write(text) { this.writes.push(String(text)); }
  async signalForeground() { return 1; }
  async terminate() { this.output.emit("end"); this.resolveDone({ exitCode: 0, signal: null }); }
}

async function pluginFixture(t, agents = new Map()) {
  const root = await mkdtemp(join(tmpdir(), "dsh-routes-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const routes = new Map(), tools = new Map(), cleanups = [], terminals = [];
  const ctx = {
    subprocess: { resolveExecutable: async (value) => value, spawnTerminal: async () => { const terminal = new IdleTerminal(); terminals.push(terminal); return terminal; } },
    credentials: { async set() {}, async resolve() { return {}; } },
    tools: { register: (definition) => tools.set(definition.name, definition) },
    systemPrompt: { section() {} },
    agents: { get: (id) => agents.get(id) },
    connection: { fetch: { register: (route) => routes.set(route.path, route) } },
    terminals: { registerBackend() {} },
    effect: (effect) => { const cleanup = effect(); if (typeof cleanup === "function") cleanups.push(cleanup); return cleanup; },
  };
  apply(ctx);
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });
  const post = async (body) => {
    const response = await routes.get("/api/dsh-remote-ops/action").fetch(new Request("http://localhost/api/dsh-remote-ops/action", { method: "POST", body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
  return { ctx, routes, tools, terminals, post };
}

test("action route keeps owner-free actions available without a Harness session", async (t) => {
  const { post } = await pluginFixture(t);
  const created = await post({ action: "group.create", name: "核心网" });
  assert.equal(created.status, 200);
  assert.deepEqual(created.body, { group: "核心网" });
  const saved = await post({ action: "environment.save", environment: { name: "device-a", host: "10.0.0.5", username: "admin", group: "核心网", port: 22 } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.saved, true);
  assert.equal(saved.body.environment.name, "device-a");
  const invalid = await post({ action: "environment.save", environment: { name: "bad", host: "", username: "" } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "REMOTE_ENV_INVALID");
});

test("action route rejects unknown actions and owner-required actions without an owner", async (t) => {
  const { post } = await pluginFixture(t, new Map([["live", { id: "live" }]]));
  const unknown = await post({ sessionId: "live", action: "no-such-action" });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /Unknown action: no-such-action/);
  assert.equal((await post({ sessionId: "live", action: "__proto__" })).status, 400);
  assert.equal((await post({ sessionId: "live", action: "constructor" })).status, 400);
  const ownerless = await post({ action: "open", environment: "anything" });
  assert.equal(ownerless.status, 400);
  assert.equal(ownerless.body.code, "REMOTE_SESSION_REQUIRED");
});

test("action route sends to the shared local terminal as manual input without an owner", async (t) => {
  const { post, terminals } = await pluginFixture(t);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const sent = await post({ action: "input", session: "local-cmd", text: "echo hi\r" });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.accepted, true);
  assert.equal(terminals[0].writes.at(-1), "echo hi\r");
  const signalled = await post({ action: "signal", session: "local-cmd", signal: "SIGINT" });
  assert.equal(signalled.status, 200);
  assert.equal(signalled.body.delivered, true);
});

test("action route reports a failure shape that includes the failing stage", async (t) => {
  const { post } = await pluginFixture(t, new Map([["live", { id: "live" }]]));
  const failed = await post({ sessionId: "live", action: "close", session: "ssh-missing" });
  assert.equal(failed.status, 400);
  assert.equal(failed.body.stage, "close");
  assert.equal(failed.body.code, "REMOTE_SESSION_NOT_FOUND");
});

// The host's schema DSL requires every explicit object node to declare additionalProperties and only allows required: true.
function assertSchemaNode(node, path) {
  if (node === null || typeof node !== "object") return;
  if (node.required !== undefined) assert.equal(node.required, true, `${path}.required must be true when present`);
  if (node.type === "object") {
    assert.equal(typeof node.additionalProperties, "boolean", `${path} must declare additionalProperties`);
    for (const [key, child] of Object.entries(node.properties ?? {})) assertSchemaNode(child, `${path}.${key}`);
  }
  if (node.type === "array" && node.items) assertSchemaNode(node.items, `${path}[]`);
}

test("every registered tool parameter follows the host schema DSL", async (t) => {
  const { tools } = await pluginFixture(t);
  assert.ok(tools.size >= 29);
  for (const [name, definition] of tools) for (const [key, node] of Object.entries(definition.parameters ?? {})) assertSchemaNode(node, `${name}.${key}`);
});

test("terminal tools expose output options and the environment profile, and ignore undeclared arguments", async (t) => {
  const { tools, post } = await pluginFixture(t);
  for (const name of ["remote_terminal_send", "remote_terminal_read", "remote_terminal_batch", "remote_quick_command_run"]) {
    assert.equal(tools.get(name).parameters.stripAnsi.type, "boolean", `${name} stripAnsi`);
    assert.equal(tools.get(name).parameters.headTailChars.type, "number", `${name} headTailChars`);
  }
  const create = tools.get("remote_environment_create");
  assert.equal(create.parameters.cliProfile.type, "object");
  assert.equal(create.parameters.terminal.properties.rows.type, "number");
  const exec = { agent: { id: "tool-agent" } };
  const created = await create.execute({ name: "dev", host: "10.1.1.1", username: "admin", cliProfile: { autoQuitMore: true, autoSigint: true }, terminal: { rows: 50 } }, exec);
  assert.deepEqual(created.environment.cliProfile, { autoQuitMore: true });
  assert.deepEqual(created.environment.terminal, { rows: 50 });
  await assert.rejects(create.execute({ name: "bad", host: "10.1.1.2", username: "admin", cliProfile: { autoQuitMore: "yes" } }, exec), { code: "REMOTE_ENV_INVALID" });
  await assert.rejects(create.execute({ name: "legacy", host: "10.1.1.3", username: "admin", cliProfile: { autoConfirm: true } }, exec), /cliProfile\.autoConfirm was removed/);
});

test("an undeclared actor argument cannot let a model bypass the manual input guard", async (t) => {
  const { tools, post } = await pluginFixture(t);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await post({ action: "input", session: "local-cmd", text: "draft " })).status, 200);
  const exec = { agent: { id: "tool-agent" } };
  await assert.rejects(tools.get("remote_terminal_send").execute({ session: "local-cmd", text: "echo injected", actor: "manual", quietMs: 20, timeoutSeconds: 1 }, exec), { code: "TERMINAL_MANUAL_CONTROL" });
  await assert.rejects(tools.get("remote_terminal_send").execute({ session: "local-cmd", text: "echo injected", quietMs: 20, timeoutSeconds: 1 }, exec), { code: "TERMINAL_MANUAL_CONTROL" });
});

test("the terminal tools never answer a (y/n) prompt and tell callers that still pass the removed options", async (t) => {
  const { tools, terminals } = await pluginFixture(t);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const exec = { agent: { id: "tool-agent" } };
  for (const name of ["remote_terminal_send", "remote_terminal_batch", "remote_quick_command_run", "remote_terminal_script"]) {
    assert.equal(Object.hasOwn(tools.get(name).parameters, "autoConfirm"), false, `${name} must not offer autoConfirm`);
    assert.equal(Object.hasOwn(tools.get(name).parameters, "confirmPattern"), false, `${name} must not offer confirmPattern`);
  }
  terminals[0].output.emit("data", Buffer.from("Erase everything?(y/n)"));
  const sent = await tools.get("remote_terminal_send").execute({ session: "local-cmd", text: "wipe", autoConfirm: true, confirmPattern: "\\(y/n\\)", quietMs: 30, timeoutSeconds: 2 }, exec);
  assert.deepEqual(terminals[0].writes, ["wipe\r"], "only the command was typed");
  assert.equal(Object.hasOwn(sent, "autoActions"), false);
  assert.match(sent.notices[0], /autoConfirm\/confirmPattern no longer exist/);
  const plain = await tools.get("remote_terminal_send").execute({ session: "local-cmd", text: "echo ok", quietMs: 30, timeoutSeconds: 2 }, exec);
  assert.equal(Object.hasOwn(plain, "notices"), false, "no notice when the removed options are not used");
  const scripted = await tools.get("remote_terminal_script").execute({ session: "local-cmd", steps: [{ text: "wipe again" }], autoConfirm: true, quietMs: 30, timeoutSeconds: 2 }, exec);
  assert.match(scripted.notices[0], /no longer exist/);
  assert.equal(terminals[0].writes.filter((text) => /^y(es)?\r?$/i.test(text)).length, 0);
});

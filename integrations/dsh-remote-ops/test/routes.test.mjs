import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.js";
import { PLUGIN_VERSION } from "../lib/version.js";

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
  // The state route waits for plugin initialization, including the local terminal.
  const initialized = await routes.get("/api/dsh-remote-ops/state").fetch(new Request("http://localhost/api/dsh-remote-ops/state"));
  assert.equal(initialized.status, 200);
  assert.equal(terminals.length, 1);
  return { ctx, routes, tools, terminals, post, root };
}

test("update route stores an HTTP source, reads local status and checks only after explicit POST", async t => {
  const { routes } = await pluginFixture(t), route = routes.get("/api/dsh-remote-ops/update");
  let reads = 0, available = false;
  const server = createServer((_req,res) => { reads++;res.setHeader('Content-Type','application/json');res.end(available ? JSON.stringify({schemaVersion:1,package:'@dsh/remote-ops',version:PLUGIN_VERSION,asset:'unused.tgz',checksum:'unused.txt'}) : 'invalid'); });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const call = body => route.fetch(new Request("http://localhost/api/dsh-remote-ops/update", body ? { method: "POST", body: JSON.stringify(body) } : {}));
  const initial = await call(); assert.equal(initial.headers.get("Cache-Control"), "no-store"); assert.equal((await initial.json()).checkedAt, null);
  const saved = await call({ action: "settings", settings: { source: "custom", url: `http://127.0.0.1:${server.address().port}/feed/` } }); assert.equal(saved.status, 200);assert.equal(reads,0);
  const unavailable = await call({ action: "check" }); assert.equal((await unavailable.json()).code, "UPDATE_METADATA_INVALID");
  available = true;
  const checked = await call({ action: "check" }); assert.equal((await checked.json()).updateAvailable, false);
  const installed = await call({ action: "install" }); assert.equal((await installed.json()).updated, false);
  assert.equal((await call({ action: "unexpected" })).status, 400);
  assert.equal((await call({action:'settings',settings:{source:'filesystem',path:'/releases'}})).status,400);
  assert.equal((await call({action:'settings',settings:{source:'sftp',path:'/releases',environment:'ssh'}})).status,400);
});

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

const passwordRoute = routes => {
  const route = routes.get("/api/dsh-remote-ops/environment-password");
  assert.ok(route, "the environment form needs a dedicated authenticated reveal route");
  assert.deepEqual(route.methods, ["POST"]);
  return async body => route.fetch(new Request("http://localhost/api/dsh-remote-ops/environment-password", { method: "POST", body: JSON.stringify(body) }));
};

test("password reveal resolves only the selected saved environment, is uncached and does not rewrite credentials", async t => {
  const { ctx, routes, tools, post } = await pluginFixture(t);
  let current = "fixture-original", reads = 0, writes = 0;
  ctx.credentials = { resolve: async ref => { assert.equal(ref, "DEVICE_PASSWORD"); reads++; return { value: current }; }, set: async () => { writes++; } };
  const saved = await post({ action: "environment.save", environment: { id: "reveal-one", name: "device", host: "host", username: "admin", passwordRef: "DEVICE_PASSWORD" } });
  assert.equal(saved.status, 200);
  const read = passwordRoute(routes);
  assert.equal(reads, 0);
  const first = await read({ environment: "reveal-one" });
  assert.equal(first.status, 200); assert.equal(first.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await first.json(), { password: "fixture-original" });
  current = "fixture-rotated";
  assert.deepEqual(await (await read({ environment: "reveal-one" })).json(), { password: current });
  assert.equal(reads, 2); assert.equal(writes, 0);
  assert.ok(![...tools.keys()].some(name => /password|credential.*read/u.test(name)), "there must be no Agent password-reveal tool");
  const listed = await tools.get("remote_environment_list").execute({}, { agent: { id: "test-agent" } });
  assert.equal(listed.environments[0].passwordRef, "configured"); assert.ok(!JSON.stringify(listed).includes(current));
  const catalog = await routes.get("/api/dsh-remote-ops/state").fetch(new Request("http://localhost/api/dsh-remote-ops/state"));
  assert.ok(!(await catalog.text()).includes(current)); assert.equal(reads, 2);
  await post({ action: "environment.save", environment: { id: "reveal-one", name: "renamed", host: "host", username: "admin" } });
  assert.equal(writes, 0); assert.deepEqual(await (await read({ environment: "reveal-one" })).json(), { password: current });
});

test("password reveal rejects credential references, names and malformed selections before resolving", async t => {
  const { ctx, routes, post } = await pluginFixture(t);
  ctx.credentials.resolve = async () => assert.fail("invalid selection must not resolve any credential");
  await post({ action: "environment.save", environment: { id: "env-id", name: "device-name", host: "host", username: "admin", passwordRef: "DEVICE_PASSWORD" } });
  const read = passwordRoute(routes);
  for (const body of [null, [], {}, { environment: 3 }, { environment: "" }, { environment: "env-id", passwordRef: "OTHER_SECRET" }, { passwordRef: "OTHER_SECRET" }]) assert.equal((await read(body)).status, 400);
  for (const environment of ["device-name", "OTHER_SECRET", "missing"]) assert.equal((await read({ environment })).status, 404);
});

test("missing or unavailable passwords report actionable messages without leaking provider error details", async t => {
  const { ctx, routes, post } = await pluginFixture(t);
  await post({ action: "environment.save", environment: { id: "no-ref", host: "key-only", username: "admin" } });
  await post({ action: "environment.save", environment: { id: "has-ref", host: "password", username: "admin", passwordRef: "DEVICE_PASSWORD" } });
  const read = passwordRoute(routes);
  assert.equal((await (await read({ environment: "no-ref" })).json()).code, "REMOTE_PASSWORD_NOT_CONFIGURED");
  ctx.credentials.resolve = async () => undefined;
  assert.equal((await (await read({ environment: "has-ref" })).json()).code, "REMOTE_PASSWORD_NOT_FOUND");
  ctx.credentials.resolve = async () => { throw new Error("PROVIDER_PRIVATE_DETAIL fixture-sensitive-value"); };
  const failure = await read({ environment: "has-ref" });
  assert.equal(failure.status, 503); assert.equal(failure.headers.get("Cache-Control"), "no-store");
  const text = await failure.text(); assert.match(text, /REMOTE_PASSWORD_UNAVAILABLE/); assert.ok(!text.includes("PRIVATE_DETAIL")); assert.ok(!text.includes("sensitive-value"));
  ctx.credentials = {};
  assert.equal((await read({ environment: "has-ref" })).status, 503);
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

test("batch close route requires the current conversation and rejects local terminal IDs", async t => {
  const { post, terminals } = await pluginFixture(t, new Map([["live", { id: "live" }]]));
  const ownerless = await post({ action: "close-many", sessions: ["gone"] });
  assert.equal(ownerless.status, 400); assert.equal(ownerless.body.code, "REMOTE_SESSION_REQUIRED");
  const local = await post({ sessionId: "live", action: "close-many", sessions: ["local-cmd"] });
  assert.equal(local.status, 400); assert.equal(local.body.stage, "close-many");
  assert.equal(local.body.code, "REMOTE_CLOSE_INVALID");
  const cleared = await post({ sessionId: "live", action: "close-many", sessions: ["gone"] });
  assert.equal(cleared.status, 200); assert.equal(cleared.body.results[0].alreadyClosed, true);
  await post({ action: "input", session: "local-cmd", text: "echo still-local\r" });
  assert.equal(terminals[0].writes.at(-1), "echo still-local\r");
});

// Registered tools use JSON Schema; required is an array on the containing object.
function assertSchemaNode(node, path) {
  if (node === null || typeof node !== "object") return;
  if (node.required !== undefined) assert.ok(Array.isArray(node.required) && node.required.every(key => typeof key === "string"), `${path}.required must list field names`);
  if (node.type === "object") {
    assert.equal(typeof node.additionalProperties, "boolean", `${path} must declare additionalProperties`);
    for (const [key, child] of Object.entries(node.properties ?? {})) assertSchemaNode(child, `${path}.${key}`);
  }
  if (node.type === "array" && node.items) assertSchemaNode(node.items, `${path}[]`);
  for (const branch of node.oneOf ?? []) assertSchemaNode(branch, path);
}

test("every registered tool parameter follows the host JSON Schema contract", async (t) => {
  const { tools } = await pluginFixture(t);
  assert.ok(tools.size >= 29);
  for (const [name, definition] of tools) {
    assert.equal(definition.parameters.type, "object", name);
    assertSchemaNode(definition.parameters, name);
  }
});

test("terminal tools expose output options and the environment profile, and ignore undeclared arguments", async (t) => {
  const { tools, post } = await pluginFixture(t);
  for (const name of ["remote_terminal_send", "remote_terminal_read", "remote_terminal_batch", "remote_quick_command_run"]) {
    assert.equal(tools.get(name).parameters.properties.stripAnsi.type, "boolean", `${name} stripAnsi`);
    assert.equal(tools.get(name).parameters.properties.headTailChars.type, "number", `${name} headTailChars`);
  }
  const create = tools.get("remote_environment_create");
  assert.equal(create.parameters.properties.cliProfile.type, "object");
  assert.equal(create.parameters.properties.terminal.properties.rows.type, "number");
  const exec = { agent: { id: "tool-agent" } };
  const created = await create.execute({ name: "dev", host: "10.1.1.1", username: "admin", cliProfile: { autoQuitMore: true, autoSigint: true }, terminal: { rows: 50 } }, exec);
  assert.deepEqual(created.environment.cliProfile, { autoQuitMore: true });
  assert.deepEqual(created.environment.terminal, { rows: 50 });
  await assert.rejects(create.execute({ name: "bad", host: "10.1.1.2", username: "admin", cliProfile: { autoQuitMore: "yes" } }, exec), { code: "REMOTE_ENV_INVALID" });
  await assert.rejects(create.execute({ name: "legacy", host: "10.1.1.3", username: "admin", cliProfile: { autoConfirm: true } }, exec), /cliProfile\.autoConfirm was removed/);
});

test("tool arguments cannot change receipt attribution in the shared terminal", async t => {
  const {tools,post}=await pluginFixture(t);
  assert.equal((await post({action:'input',session:'local-cmd',text:'echo human\r'})).status,200);
  const exec={agent:{id:'tool-agent'}};
  await tools.get('remote_terminal_send').execute({session:'local-cmd',text:'echo agent',actor:'manual',quietMs:20,timeoutSeconds:1},exec);
  const read=await tools.get('remote_terminal_read').execute({session:'local-cmd'},exec);
  assert.equal(read.toolReceipt.source,'send');assert.equal(read.control.holder,'shared');
});

test("the terminal tools never answer a (y/n) prompt and tell callers that still pass the removed options", async (t) => {
  const { tools, terminals } = await pluginFixture(t);
  const exec = { agent: { id: "tool-agent" } };
  for (const name of ["remote_terminal_send", "remote_terminal_batch", "remote_quick_command_run", "remote_terminal_script"]) {
    assert.equal(Object.hasOwn(tools.get(name).parameters.properties, "autoConfirm"), false, `${name} must not offer autoConfirm`);
    assert.equal(Object.hasOwn(tools.get(name).parameters.properties, "confirmPattern"), false, `${name} must not offer confirmPattern`);
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

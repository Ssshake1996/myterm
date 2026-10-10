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

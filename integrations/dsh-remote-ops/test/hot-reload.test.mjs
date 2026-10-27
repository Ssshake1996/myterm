import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { HotReload, HOT_RELOAD_PROTOCOL, peekHandoff, reloadBlockers, runtimeOperation, retainDownload, registerRuntimeFetch, registerRuntimeTool, stageRuntime } from "../lib/hot-reload.js";
import { RemoteOpsState } from "../lib/state/index.js";

async function fixture(t, protocol = HOT_RELOAD_PROTOCOL) {
  const root = await mkdtemp(join(tmpdir(), "remote-ops-reload-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function pkg(name, version, dependencies = {}, code = "export default 'fresh';") {
    const path = join(root, "node_modules", name);
    await mkdir(join(path, "lib"), { recursive: true });
    await writeFile(join(path, "package.json"), JSON.stringify({ name, version, type: "module", main: "lib/index.js", dependencies }));
    await writeFile(join(path, "lib/index.js"), code);
  }
  await pkg("@dsh/remote-ops", "99.0.0", { "reload-fixture": "1.0.0" }, `import fresh from 'reload-fixture'; export const HOT_RELOAD_PROTOCOL=${protocol};export {fresh};`);
  await pkg("reload-fixture", "1.0.0");
  return { root, pkg };
}

test("version staging isolates hoisted ESM dependencies and never copies unrelated plugins", async t => {
  const { root, pkg } = await fixture(t);
  await pkg("unrelated-plugin", "1.0.0");
  const first = await stageRuntime(root, "99.0.0");
  assert.equal((await import(first)).fresh, "fresh");
  await pkg("reload-fixture", "2.0.0", {}, "export default 'changed';");
  const second = await stageRuntime(root, "99.0.0");
  assert.notEqual(first, second);
  assert.equal((await import(second)).fresh, "changed");
  const runtime = dirname(dirname(dirname(dirname(fileURLToPath(first)))));
  await assert.rejects(readFile(join(runtime, "unrelated-plugin/package.json")), { code: "ENOENT" });
  await assert.rejects(stageRuntime(root, "../escape"), /UPDATE_VERSION_INVALID/);
  await assert.rejects(stageRuntime(root, "99.0.1"), /UPDATE_INSTALL_UNVERIFIED/);
});

test("admission counts live operations, rejects new mutations during activation, and excludes status polls", async () => {
  const state = {}; let release;
  const work = runtimeOperation(state, () => new Promise(r => release = r));
  assert.equal(state.runtimeCalls, 1); state.reloadGate = true;
  await assert.rejects(runtimeOperation(state, () => assert.fail("must not dispatch")), /UPDATE_RELOADING/);
  release(); await work; assert.equal(state.runtimeCalls, 0);
  let route, tool;
  const ctx = { connection: { fetch: { register: value => route = value } }, tools: { register: value => tool = value } };
  registerRuntimeFetch(ctx, state, { fetch: async () => Response.json({ ok: true }) });
  assert.equal((await route.fetch(new Request("http://localhost/state"))).status, 200);
  const denied = await route.fetch(new Request("http://localhost/action", { method: "POST" }));
  assert.equal(denied.status, 503); assert.equal((await denied.json()).code, "UPDATE_RELOADING");
  registerRuntimeTool(ctx, state, { execute: () => assert.fail("must not dispatch") });
  await assert.rejects(tool.execute(), /UPDATE_RELOADING/);
});

test("idle barrier covers every conversation, background requests, transfers and browser installation", () => {
  const state = { ctx: { agents: { list: () => [{ id: "other-conversation", status: "running" }] } }, runtimeCalls: 1, commands: new Map([[1, {}]]), openings: new Map([[1, {}]]), localSession: { pendingSend: {} }, transfers: { jobs: new Map([[1, { status: "queued" }]]) }, browser: { installation: { status: "installing" }, sessions: new Map([[1, { job: { status: "running" } }]]) }, api: { owners: new Map([[1, { records: new Map([[1, { state: "running" }]]) }]]) } };
  assert.equal(reloadBlockers(state).length, 9);
  assert.deepEqual(reloadBlockers({}), []);
});

test("streaming downloads keep the barrier until completion or cancellation, without double releasing", async () => {
  const state = {}, stream = new PassThrough(); retainDownload(state, stream);
  assert.equal(state.runtimeCalls, 1); stream.resume();
  await new Promise(resolve => { stream.once("close", resolve); stream.end("download data"); });
  assert.equal(state.runtimeCalls, 0);
  const cancelled = new PassThrough(); retainDownload(state, cancelled);
  await new Promise(resolve => { cancelled.once("close", resolve); cancelled.destroy(new Error("cancelled")); });
  assert.equal(state.runtimeCalls, 0);
});

async function reloader(t, { fail = false, protocol } = {}) {
  const { root } = await fixture(t, protocol);
  const state = { ctx: { agents: { list: () => [] } }, release: { currentVersion: "98.0.0" }, commands: new Map(), sessions: new Map(), localSession: { marker: "live-terminal" } };
  let activationCount = 0, failedStartup = false;
  const entry = { options: { name: "old-module" }, fiber: { state: 2, await: async () => { if (failedStartup) throw new Error("retained startup error"); } }, update: async options => {
    Object.assign(entry.options, options);
    if (options.disabled) return;
    activationCount++;
    if (fail && options.name !== "old-module") { failedStartup = true; throw new Error("candidate startup failed"); }
    failedStartup = false;
    const handoff = peekHandoff({ fiber: { entry } });
    handoff.adopted = true; handoff.state.release.currentVersion = options.name === "old-module" ? "98.0.0" : "99.0.0";
  } };
  const reload = new HotReload(state, { fiber: { entry }, loader: {}, hmr: { runExclusive: work => work() }, profileContext: { dir: root } });
  reload.version = "99.0.0"; t.after(() => reload.stop());
  return { state, entry, reload, count: () => activationCount };
}

test("active work defers activation; idle handoff keeps object identity and live handles", async t => {
  const { state, entry, reload, count } = await reloader(t);
  const terminal = state.localSession;
  state.commands.set("busy", {}); await reload.tick(); assert.equal(count(), 0); assert.equal(state.updatePhase, "waiting");
  reload.stop(); state.commands.clear(); await reload.tick();
  assert.equal(count(), 1); assert.equal(state.updatePhase, "applied"); assert.equal(state.release.currentVersion, "99.0.0");
  assert.equal(state.localSession, terminal); assert.equal(state.reloadGate, false); assert.equal(peekHandoff({ fiber: { entry } }), undefined);
});

test("failed activation restores the old runtime once, retains state and allows explicit retry", async t => {
  const { state, reload, count } = await reloader(t, { fail: true });
  await reload.tick(); assert.equal(count(), 2); assert.equal(state.updatePhase, "reload-failed");
  assert.equal(state.release.currentVersion, "98.0.0"); assert.equal(state.localSession.marker, "live-terminal"); assert.equal(state.reloadGate, false);
  assert.match(state.updateError, /已恢复旧运行版本/); assert.equal(reload.timer, undefined);
});

test("incompatible state protocol does not unload the running plugin", async t => {
  const { state, reload, count } = await reloader(t, { protocol: 999 });
  await reload.tick(); assert.equal(count(), 0); assert.equal(state.updatePhase, "restart-required");
});

test("command receipts still work after a runtime prototype handoff without private class branding", () => {
  const state = Object.create(RemoteOpsState.prototype);
  state.commandHistory = new Map([["kept", { requestId: "kept", owner: "dialog", target: "local-cmd", status: "completed" }]]);
  assert.equal(state.commandJob({ id: "dialog" }, "kept").status, "completed");
});

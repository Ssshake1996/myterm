import { cp, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { sessionError } from "./common.js";

// Bump when in-memory state can no longer be adopted by another plugin version.
export const HOT_RELOAD_PROTOCOL = 1;
const HANDOFFS = Symbol.for("dsh.remote-ops.hot-reload.v1");
const handoffs = () => globalThis[HANDOFFS] ??= new Map();
export function peekHandoff(ctx) { return handoffs().get(ctx.fiber?.entry); }

export async function runtimeOperation(state, work) {
  if (state.reloadGate) throw sessionError("UPDATE_RELOADING", "Remote Ops 正在切换版本，请稍后重试；本次操作未执行");
  state.runtimeCalls = (state.runtimeCalls ?? 0) + 1;
  try { return await work(); } finally { state.runtimeCalls--; }
}

export function retainDownload(state, stream) {
  state.runtimeCalls = (state.runtimeCalls ?? 0) + 1;
  let finished = false;
  const release = () => { if (!finished) { finished = true; state.runtimeCalls--; } };
  stream.once("end", release); stream.once("error", release); stream.once("close", release);
}

export function registerRuntimeTool(ctx, state, definition) {
  return ctx.tools.register({ ...definition, execute: (...args) => runtimeOperation(state, () => definition.execute(...args)) });
}

export function registerRuntimeFetch(ctx, state, definition) {
  return ctx.connection.fetch.register({ ...definition, fetch: request => {
    const path = new URL(request.url).pathname;
    // Observations and terminal long polls must not prevent the idle barrier.
    if (request.method === "GET" && path !== "/api/dsh-remote-ops/browser-file" || path === "/api/dsh-remote-ops/update") return definition.fetch(request);
    return runtimeOperation(state, () => definition.fetch(request)).catch(error => {
      if (error.code !== "UPDATE_RELOADING") throw error;
      return Response.json({ code: error.code, error: error.message }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "1" } });
    });
  } });
}

export function reloadBlockers(state) {
  const busy = [];
  if (state.runtimeCalls) busy.push("正在处理操作");
  if (state.ctx?.agents?.list?.().some(agent => agent.status === "running")) busy.push("对话任务执行中");
  if (state.commands?.size) busy.push("终端命令执行中");
  if (state.openings?.size || state.localStarting) busy.push("终端连接中");
  if ([state.localSession, ...[...(state.sessions?.values() ?? [])].map(r => r.session)].some(s => s?.active || s?.pendingSend)) busy.push("终端等待回显");
  if ([...(state.transfers?.jobs?.values() ?? [])].some(j => ["queued", "running"].includes(j.status))) busy.push("文件传输中");
  if (state.browser?.openings?.size || [...(state.browser?.sessions?.values() ?? [])].some(r => r.job && !["completed", "failed", "unknown", "stopped"].includes(r.job.status))) busy.push("网页任务执行中");
  if (state.browser?.installation?.status === "installing") busy.push("浏览器安装中");
  if ([...(state.api?.owners?.values() ?? [])].some(o => [...o.records.values()].some(r => r.state === "running"))) busy.push("API 请求执行中");
  return busy;
}

// Snapshot exactly this package's dependency closure. Hoisted installs overwrite
// the same path; a query string on index.js does not invalidate its ESM imports.
export async function stageRuntime(profileDir, expectedVersion) {
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) throw new Error("UPDATE_VERSION_INVALID");
  const source = await realpath(join(profileDir, "node_modules/@dsh/remote-ops"));
  const root = join(profileDir, ".remote-ops-runtime", `${expectedVersion}-${randomUUID()}`);
  const installed = new Map();
  async function locate(from, name) {
    for (let dir = from; ; dir = dirname(dir)) {
      const candidate = join(dir, "node_modules", name);
      try { if ((await stat(join(candidate, "package.json"))).isFile()) return await realpath(candidate); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (dir === dirname(dir)) throw new Error(`UPDATE_DEPENDENCY_MISSING: ${name}`);
    }
  }
  async function copyPackage(from, target, ancestors = new Map()) {
    const pkg = JSON.parse(await readFile(join(from, "package.json"), "utf8"));
    if (!pkg.name || !pkg.version) throw new Error("UPDATE_PACKAGE_INVALID: missing package identity");
    if (ancestors.has(from)) return;
    const chain = new Map(ancestors).set(from, target);
    await mkdir(dirname(target), { recursive: true });
    await cp(from, target, { recursive: true, dereference: true, filter: path => relative(from, path).split(/[\\/]/)[0] !== "node_modules" });
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw new Error("UPDATE_PACKAGE_INVALID: dependency name");
      let dependency;
      try { dependency = await locate(from, name); } catch (error) { if (pkg.optionalDependencies?.[name] && error.message.startsWith("UPDATE_DEPENDENCY_MISSING")) continue; throw error; }
      if (chain.has(dependency) || installed.get(name) === dependency) continue;
      const to = installed.has(name) ? join(target, "node_modules", name) : join(root, "node_modules", name);
      if (!installed.has(name)) installed.set(name, dependency);
      await copyPackage(dependency, to, chain);
    }
  }
  const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  if (pkg.name !== "@dsh/remote-ops" || pkg.version !== expectedVersion) throw new Error("UPDATE_INSTALL_UNVERIFIED: installed package identity changed");
  const target = join(root, "node_modules/@dsh/remote-ops");
  installed.set(pkg.name, source);
  await copyPackage(source, target);
  return pathToFileURL(join(target, "lib/index.js")).href;
}

export class HotReload {
  constructor(state, ctx) {
    this.state = state; this.ctx = ctx; this.entry = ctx.fiber?.entry;
    this.loader = ctx.loader; this.hmr = ctx.hmr; this.profileDir = ctx.profileContext?.dir;
    this.supported = Boolean(this.entry?.update && this.hmr?.runExclusive && this.profileDir);
    const activeName = this.entry?.options.name;
    const snapshotPrefix = this.profileDir && pathToFileURL(join(this.profileDir, ".remote-ops-runtime")).href + "/";
    // Profile recomposition reintroduces the package alias. Keep this live row
    // on its committed graph; changing other host settings must not roll it back
    // to Node's cached alias or to the initial browser artifact metadata.
    if (snapshotPrefix && activeName?.startsWith(snapshotPrefix)) ctx.on?.("loader/patch-context", (entry, next) => {
      if (entry === this.entry && !entry.disabled && entry.options.name === "@dsh/remote-ops") entry.options.name = activeName;
      next();
    }, { global: true });
  }
  schedule(version) {
    if (!this.supported) return false;
    if (this.version !== version) this.target = undefined;
    this.version = version; this.state.updatePhase = "waiting";
    this.state.updateError = null; this.state.updateFailure = null;
    this.timer ??= setTimeout(() => { this.timer = undefined; void this.tick(); }, 1000);
    this.timer.unref?.();
    return true;
  }
  stop() { clearTimeout(this.timer); this.timer = undefined; }
  async tick() {
    const state = this.state;
    if (state.disposed || this.running) return;
    if (state.updatePromise || reloadBlockers(state).length) { this.schedule(this.version); return; }
    this.running = true;
    try {
      state.updatePhase = "preparing";
      this.target ??= await stageRuntime(this.profileDir, this.version);
      const candidate = await import(this.target);
      if (candidate.HOT_RELOAD_PROTOCOL !== HOT_RELOAD_PROTOCOL) {
        state.updatePhase = "restart-required"; state.updateError = "此版本的运行状态格式不兼容，请在任务结束后重启 DSH"; return;
      }
      await this.hmr.runExclusive(async () => {
        if (state.disposed || reloadBlockers(state).length || state.updatePromise) { this.schedule(this.version); return; }
        // Atomic admission barrier: no new mutation enters before old routes go away.
        state.reloadGate = true; state.updatePhase = "reloading";
        const previous = this.entry.options.name;
        const handoff = { state, adopted: false, version: this.version };
        handoffs().set(this.entry, handoff);
        try {
          await this.switchTo(this.target);
          if (!handoff.adopted || state.release.currentVersion !== this.version) throw new Error("New runtime did not accept the version and state handoff");
          state.updatePhase = "applied"; state.updateError = null; state.reloadGate = false;
        } catch (error) {
          // Restore the old module graph, including live handles, without replaying work.
          handoff.adopted = false;
          await this.switchTo(previous);
          state.reloadGate = false; state.updatePhase = "reload-failed";
          state.updateError = `热加载失败，已恢复旧运行版本：${error.message}`;
        } finally { handoffs().delete(this.entry); }
      });
    } catch (error) {
      state.reloadGate = false; state.updatePhase = "reload-failed"; state.updateError = `热加载未完成：${error.message}`;
    } finally { this.running = false; }
  }
  async switchTo(name) {
    await this.entry.update({ disabled: true });
    // A failed candidate's await() rethrows its startup error even after it has
    // fully disposed. That old error must not prevent mounting the fallback.
    await this.entry.fiber?.await().catch(() => {});
    await this.entry.update({ name, disabled: false });
    await this.entry.fiber?.await();
    if (this.entry.fiber?.state !== 2) throw new Error("Plugin did not enter the ready state");
  }
}

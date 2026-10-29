import { PLUGIN_NAME, PLUGIN_VERSION } from "./version.js";
import { randomUUID } from "node:crypto";
import { HotReload, peekHandoff } from "./hot-reload.js";
import { TransferManager } from "./transfers.js";
export { HOT_RELOAD_PROTOCOL } from "./hot-reload.js";
import { RemoteOpsState } from "./state/index.js";
import { registerWorkspaceRoutes } from "./workspace-routes.js";
import { registerTools } from "./tools.js";
import { registerRoutes } from "./routes.js";
import { join } from "node:path";
import { BrowserWorkspace } from "./browser-workspace.js";
import { registerBrowserRoutes } from "./browser-routes.js";
import { registerBrowserTools } from "./browser-tools.js";
import { registerBundledSkills } from "./skills.js";
import { registerLogRoutes } from "./log-routes.js";
import { ApiWorkspace } from "./api-workspace.js";
import { registerApiTools } from "./api-tools.js";
import { registerApiRoutes } from "./api-routes.js";
import { DesktopWorkspace } from "./desktop-workspace.js";
import { connectDesktop } from "./desktop-transport.js";
import { registerDesktopTools } from "./desktop-tools.js";
import { registerDesktopRoutes } from "./desktop-routes.js";

export const name = PLUGIN_NAME;
export const inject = ["connection", "systemPrompt", "tools", "terminals", "agents", "credentials", "subprocess"];

export { MAX_SESSIONS_PER_ENVIRONMENT } from "./constants.js";
export { TerminalOutputBuffer } from "./output-buffer.js";
export { buildSshShellOptions } from "./terminal-sessions.js";
export { defaultPasswordRef, normalizeGroupName, summarizeError, toLosslessJson, validateEnvironment } from "./common.js";
export { RemoteOpsState } from "./state/index.js";

export function apply(ctx) {
  const handoff = peekHandoff(ctx);
  const state = handoff?.state ?? new RemoteOpsState(ctx);
  if (handoff) {
    Object.setPrototypeOf(state, RemoteOpsState.prototype);
    state.ctx = ctx; state.disposed = false; state.runtimeId = randomUUID();
    Object.setPrototypeOf(state.browser, BrowserWorkspace.prototype);
    Object.setPrototypeOf(state.api, ApiWorkspace.prototype);
    if (state.desktop) { Object.setPrototypeOf(state.desktop, DesktopWorkspace.prototype); state.desktop.state = state; state.desktop.connector = connectDesktop; }
    Object.setPrototypeOf(state.transfers, TransferManager.prototype);
    state.browser.credentials = ctx.credentials; state.api.credentials = ctx.credentials;
    state.release = { ...state.release, currentVersion: PLUGIN_VERSION, updateAvailable: false };
  }
  ctx.inject?.(["pluginManager"], ready => ready.effect(() => {
    state.updateManager = ready.pluginManager;
    return () => { state.updateManager = undefined; };
  }, "dsh-remote-ops update manager"));
  ctx.inject?.(["loader", "hmr"], ready => ready.effect(() => {
    const reload = new HotReload(state, ready);
    state.hotReload = reload;
    return () => { reload.stop(); if (state.hotReload === reload) state.hotReload = undefined; };
  }, "dsh-remote-ops hot reload"));
  registerSessionActivation(ctx, state);
  state.browser ??= new BrowserWorkspace({ root: join(state.base, "browser"), credentials: ctx.credentials });
  state.api ??= new ApiWorkspace({ root: join(state.base, "api"), credentials: ctx.credentials });
  state.desktop ??= new DesktopWorkspace(state);
  ctx.effect(() => async () => {
    if (peekHandoff(ctx)?.state === state) return;
    state.disposed = true;
    state.updateDownloadAbort?.abort();
    if (state.updateInstallId) await state.updateManager?.cancelInstall(state.updateInstallId).catch(() => {});
    await Promise.allSettled([state.updatePromise, state.releaseCheckPromise].filter(Boolean));
    await state.api.dispose();
    await state.desktop.dispose();
    await state.browser.dispose();
    for (const job of state.commands.values()) job.controller.abort();
    await Promise.allSettled([...state.commands.values()].map((job) => job.done));
    state.commandHistory?.clear();
    await state.transfers.close();
    await state.localSession?.close("dsh-remote-ops disposed").catch(() => {});
    for (const record of state.sessions.values()) await ctx.terminals.kill(record.owner, record.sessionId, "dsh-remote-ops disposed").catch(() => {});
    state.sessions.clear();
    state.terminalLogs?.clear();
    state.logExports?.clear();
  }, "dsh-remote-ops cleanup");
  registerWorkspaceRoutes(ctx, state);
  ctx.effect(() => ctx.terminals.registerBackend({ type: "ssh", spawn: (spec) => state.spawnBackend(spec) }), "dsh-remote-ops SSH backend");
  registerTools(ctx, state);
  registerRoutes(ctx, state);
  registerLogRoutes(ctx, state);
  registerBrowserRoutes(ctx, state);
  registerBrowserTools(ctx, state);
  registerApiTools(ctx, state);
  registerApiRoutes(ctx, state);
  registerDesktopTools(ctx, state);
  registerDesktopRoutes(ctx, state);
  registerBundledSkills(ctx);
  if (handoff) handoff.adopted = true;
}

export function registerSessionActivation(ctx, state) {
  ctx.inject?.(['sessionController'], ready => {
    ready.effect(() => {
      const controller = ready.sessionController;
      state.sessionController = controller;
      return () => { if (state.sessionController === controller) state.sessionController = undefined; };
    }, 'dsh-remote-ops session activation');
  });
}

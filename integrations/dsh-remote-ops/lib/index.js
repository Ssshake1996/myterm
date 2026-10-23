import { PLUGIN_NAME } from "./version.js";
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

export const name = PLUGIN_NAME;
export const inject = ["connection", "systemPrompt", "tools", "terminals", "agents", "credentials", "subprocess"];

export { MAX_SESSIONS_PER_ENVIRONMENT } from "./constants.js";
export { TerminalOutputBuffer } from "./output-buffer.js";
export { buildSshShellOptions } from "./terminal-sessions.js";
export { defaultPasswordRef, normalizeGroupName, summarizeError, toLosslessJson, validateEnvironment } from "./common.js";
export { RemoteOpsState } from "./state/index.js";

export function apply(ctx) {
  const state = new RemoteOpsState(ctx);
  registerSessionActivation(ctx, state);
  state.browser = new BrowserWorkspace({ root: join(state.base, "browser"), credentials: ctx.credentials });
  state.api = new ApiWorkspace({ root: join(state.base, "api"), credentials: ctx.credentials });
  ctx.effect(() => async () => {
    state.disposed = true;
    await state.api.dispose();
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
  registerBundledSkills(ctx);
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

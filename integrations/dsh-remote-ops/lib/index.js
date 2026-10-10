import { PLUGIN_NAME } from "./version.js";
import { RemoteOpsState } from "./state.js";
import { registerWorkspaceRoutes } from "./workspace-routes.js";
import { registerTools } from "./tools.js";
import { registerRoutes } from "./routes.js";

export const name = PLUGIN_NAME;
export const inject = ["connection", "systemPrompt", "tools", "terminals", "agents", "credentials", "subprocess"];

export { MAX_SESSIONS_PER_ENVIRONMENT } from "./constants.js";
export { TerminalOutputBuffer } from "./output-buffer.js";
export { buildSshShellOptions } from "./terminal-sessions.js";
export { defaultPasswordRef, normalizeGroupName, summarizeError, toLosslessJson, validateEnvironment } from "./common.js";
export { RemoteOpsState } from "./state.js";

export function apply(ctx) {
  const state = new RemoteOpsState(ctx);
  ctx.effect(() => async () => {
    state.disposed = true;
    for (const job of state.commands.values()) job.controller.abort();
    await Promise.allSettled([...state.commands.values()].map((job) => job.done));
    await state.transfers.close();
    await state.localSession?.close("dsh-remote-ops disposed").catch(() => {});
    for (const record of state.sessions.values()) await ctx.terminals.kill(record.owner, record.sessionId, "dsh-remote-ops disposed").catch(() => {});
    state.sessions.clear();
  }, "dsh-remote-ops cleanup");
  registerWorkspaceRoutes(ctx, state);
  ctx.effect(() => ctx.terminals.registerBackend({ type: "ssh", spawn: (spec) => state.spawnBackend(spec) }), "dsh-remote-ops SSH backend");
  registerTools(ctx, state);
  registerRoutes(ctx, state);
}

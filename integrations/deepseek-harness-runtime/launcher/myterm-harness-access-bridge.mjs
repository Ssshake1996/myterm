import process from "node:process";

export const name = "myterm-harness-access-bridge";
export const inject = ["permissionPresets", "sessions", "tools"];

const HOST_TOOL_PREFIX = "mcp__myterm-host-tools__";
const DEFAULT_PRESET = "workspace-write";

export function apply(ctx) {
  const desiredPreset = process.env.MYTERM_HARNESS_ACCESS_PRESET || DEFAULT_PRESET;
  ctx.permissionPresets.resolve(desiredPreset);

  const syncPreset = (session) => {
    if (ctx.permissionPresets.current(session) !== desiredPreset) {
      ctx.permissionPresets.set(session, desiredPreset);
    }
  };

  ctx.on("session/created", syncPreset);
  for (const session of ctx.sessions.list()) syncPreset(session);

  ctx.on("tools/pre-execute", async (execution, next) => {
    if (!execution.name.startsWith(HOST_TOOL_PREFIX)) return next();
    if (execution.agent === undefined) {
      return {
        kind: "deny",
        reason: `tool "${execution.name}" has no Harness agent session`,
      };
    }

    const preset = ctx.permissionPresets.current(execution.agent.session);
    const access = ctx.permissionPresets.resolve(preset);
    if (access.sandbox === "danger-full-access" && access.approval === "never") {
      return next();
    }
    return {
      kind: "ask",
      reason: `Harness access preset "${preset}" requires approval for remote host tool "${execution.name}"`,
    };
  });
}

import { randomUUID } from "node:crypto";
import { executeCommand } from "../commands.js";
import { LOCAL_SESSION_ID, LOCAL_SESSION_NAME } from "../constants.js";
import { sessionError } from "../common.js";

// Independent non-interactive commands that never touch the visible terminal.
export const withCommands = (Base) => class CommandsLayer extends Base {
  async execute(owner, target, args) {
    await this.ready;
    if (!owner?.id || this.disposed) throw sessionError("COMMAND_OWNER_REQUIRED", "An active Harness session is required");
    const record = target === LOCAL_SESSION_ID ? null : this.getSession(owner, target);
    if (record && (record.session.status().kind === "exited" || !record.session.client?.exec)) throw sessionError("COMMAND_CHANNEL_UNAVAILABLE", "This connection cannot open an independent SSH exec channel");
    const targetId = record?.sessionId ?? LOCAL_SESSION_ID, requestId = args.requestId ?? randomUUID();
    if (typeof requestId !== "string" || !requestId || requestId.length > 100) throw sessionError("COMMAND_ID_INVALID", "Invalid command request id");
    if (this.commands.has(requestId) || this.commands.size >= 8 || [...this.commands.values()].some(job => job.target === targetId)) throw sessionError("COMMAND_BUSY", "An independent command is already running for this target or the limit was reached");
    const controller = new AbortController(), abort = () => controller.abort();
    args.signal?.addEventListener("abort", abort, { once: true });
    if (args.signal?.aborted) abort();
    const job = { owner: owner.id, target: targetId, controller };
    this.commands.set(requestId, job);
    try {
      job.done = executeCommand({ subprocess: this.ctx.subprocess, client: record?.session.client, command: args.command, cwd: this.base, signal: controller.signal, timeoutMs: (args.timeoutSeconds ?? 30) * 1000, maxBytes: args.maxBytes ?? 65536 });
      const value = await job.done;
      this.event(owner, "command.execute", { sessionId: targetId, status: value.status, exitCode: value.exitCode, durationMs: value.durationMs });
      return { ...value, requestId, sessionId: targetId, targetName: record ? record.environment.name : LOCAL_SESSION_NAME };
    } finally { args.signal?.removeEventListener("abort", abort); this.commands.delete(requestId); }
  }

  cancelCommand(owner, requestId) {
    const job = this.commands.get(requestId);
    if (!job || job.owner !== owner?.id) throw sessionError("COMMAND_NOT_FOUND", "No running command for this Harness session");
    job.controller.abort();
    return { requestId, cancellationRequested: true };
  }
};

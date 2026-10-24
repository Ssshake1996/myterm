import { createHash, randomUUID } from "node:crypto";
import { executeCommand, validateCommand } from "../commands.js";
import { LOCAL_SESSION_ID, LOCAL_SESSION_NAME } from "../constants.js";
import { sessionError } from "../common.js";
import { buildWindowsCommand, isWindowsEnvironment } from "../windows-shell.js";
import { closeSshClient } from "../ssh-connection.js";

// Independent non-interactive commands that never touch the visible terminal.
export const withCommands = (Base) => class CommandsLayer extends Base {
  async execute(owner, target, args) {
    await this.ready;
    return this.#beginCommand(owner, target, args).done;
  }

  #beginCommand(owner, target, args, retained = false) {
    if (!owner?.id || this.disposed) throw sessionError("COMMAND_OWNER_REQUIRED", "An active Harness session is required");
    validateCommand(args.command, (args.timeoutSeconds ?? 30) * 1000, args.maxBytes ?? 65536);
    const record = target === LOCAL_SESSION_ID ? null : this.getSession(owner, target);
    if (record && (record.session.status().kind === "exited" || !record.session.client?.exec)) throw sessionError("COMMAND_CHANNEL_UNAVAILABLE", "This connection cannot open an independent SSH exec channel");
    const shell = args.shell ?? record?.environment.shell ?? "server-default";
    const useWindows = shell !== "server-default";
    if ((useWindows || args.parameters != null || args.workingDirectory != null) && (!record || record.environment.platform === "posix" || !isWindowsEnvironment({ ...record.environment, shell }))) throw sessionError("WINDOWS_COMMAND_INVALID", "Windows script options require a Windows SSH connection and an explicit Windows shell");
    const execution = useWindows || args.parameters != null || args.workingDirectory != null
      ? buildWindowsCommand({ command: args.command, shell, parameters: args.parameters, workingDirectory: args.workingDirectory })
      : { command: args.command, encoding: record?.environment.encoding ?? "utf-8" };
    const targetId = record?.sessionId ?? LOCAL_SESSION_ID, requestId = args.requestId ?? randomUUID();
    if (typeof requestId !== "string" || !requestId || requestId.length > 100) throw sessionError("COMMAND_ID_INVALID", "Invalid command request id");
    if (this.commands.has(requestId) || this.commands.size >= 8 || [...this.commands.values()].some(job => job.target === targetId)) throw sessionError("COMMAND_BUSY", "An independent command is already running for this target or the limit was reached");
    const controller = new AbortController(), abort = () => controller.abort();
    args.signal?.addEventListener("abort", abort, { once: true });
    if (args.signal?.aborted) abort();
    const job = { owner: owner.id, target: targetId, requestId, controller, targetName: record ? record.environment.name : LOCAL_SESSION_NAME, status: "running", startedAt: new Date().toISOString() };
    this.commands.set(requestId, job);
    if (retained) { this.commandHistory.set(requestId, job); this.#pruneCommandJobs(); }
    const run = async () => {
      let dedicated;
      try {
        // Win32 OpenSSH on desktop can fail to initialize exec processes when they
        // share the interactive PTY's connection. Authenticate a separate connection
        // using this session's original environment and the same host-key policy.
        if (record && isWindowsEnvironment({ ...record.environment, shell })) dedicated = (await this.connectSshEnvironment(record.environment, controller.signal)).client;
        return await executeCommand({ subprocess: this.ctx.subprocess, client: dedicated ?? record?.session.client, ...execution, cwd: this.base, signal: controller.signal, timeoutMs: (args.timeoutSeconds ?? 30) * 1000, maxBytes: args.maxBytes ?? 65536 });
      } finally { closeSshClient(dedicated); }
    };
    job.done = run().then(value => {
      job.status = value.status;
      job.result = { ...value, shell, requestId, sessionId: targetId, targetName: job.targetName };
      this.event(owner, "command.execute", { sessionId: targetId, status: value.status, exitCode: value.exitCode, durationMs: value.durationMs });
      return job.result;
    }).catch(error => {
      job.status = "failed"; job.failure = `${error.code ?? "COMMAND_FAILED"}: ${error.message}`;
      throw error;
    }).finally(() => {
      job.finishedAt = new Date().toISOString();
      args.signal?.removeEventListener("abort", abort);
      this.commands.delete(requestId);
      if (retained) this.#pruneCommandJobs();
    });
    return job;
  }

  #pruneCommandJobs() {
    this.commandHistory ??= new Map();
    for (const [id, job] of this.commandHistory) if (job.finishedAt && (Date.now() - Date.parse(job.finishedAt) > 10 * 60_000 || this.commandHistory.size > 32)) this.commandHistory.delete(id);
  }

  #publicCommandJob(job, includeResult = true) {
    return { requestId: job.requestId, sessionId: job.target, targetName: job.targetName, status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt ?? null, ...(includeResult ? { result: job.result ?? null } : {}), failure: job.failure ?? "" };
  }

  async startCommand(owner, target, args) {
    await this.ready;
    if (!owner?.id || this.disposed) throw sessionError("COMMAND_OWNER_REQUIRED", "An active Harness session is required");
    this.#pruneCommandJobs();
    const digest = createHash("sha256").update(JSON.stringify([target, args.command, args.timeoutSeconds ?? 30, args.maxBytes ?? 65536, args.shell ?? null, args.parameters ?? null, args.workingDirectory ?? null])).digest("hex");
    const existing = this.commandHistory.get(args.requestId);
    if (existing) {
      if (existing.owner !== owner.id) throw sessionError("COMMAND_NOT_FOUND", "No command for this Harness session");
      if (existing.digest !== digest) throw sessionError("COMMAND_ID_CONFLICT", "This request id already belongs to a different command");
      return this.#publicCommandJob(existing);
    }
    const job = this.#beginCommand(owner, target, { ...args, signal: undefined }, true);
    job.digest = digest;
    // The route acknowledges the job. Closing/reloading its view does not own cancellation.
    void job.done.catch(() => {});
    return this.#publicCommandJob(job);
  }

  commandJob(owner, requestId) {
    this.#pruneCommandJobs();
    const job = this.commandHistory.get(requestId);
    if (!owner?.id || !job || job.owner !== owner.id) throw sessionError("COMMAND_NOT_FOUND", "No command for this Harness session; results expire after ten minutes or a DSH restart");
    return this.#publicCommandJob(job);
  }

  commandJobsFor(owner, target) {
    this.#pruneCommandJobs();
    return [...this.commandHistory.values()].filter(job => job.owner === owner?.id && (!target || job.target === target)).map(job => this.#publicCommandJob(job, false));
  }

  cancelCommand(owner, requestId) {
    const job = this.commands.get(requestId);
    if (!job || job.owner !== owner?.id) throw sessionError("COMMAND_NOT_FOUND", "No running command for this Harness session");
    job.controller.abort();
    return { requestId, cancellationRequested: true };
  }
};

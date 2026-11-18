import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { LOCAL_SESSION_ID, LOCAL_SESSION_NAME } from "../constants.js";
import { sessionError, summarizeError } from "../common.js";
import { LocalCmdTerminalSession } from "../terminal-sessions.js";
import { LOCAL_SHELLS, listLocalShells, localOptions, localShellArgv } from "../local-shells.js";

// The shared local terminal that exists before any Agent does.
export const withLocalTerminal = (Base) => class LocalTerminalLayer extends Base {
  localTerminalEntries() {
    this.localSessions ??= new Map();
    if (this.localSession && !this.localSessions.has(LOCAL_SESSION_ID)) this.localSessions.set(LOCAL_SESSION_ID, this.localSession);
    return [...this.localSessions.entries()];
  }

  getLocalSession(target) {
    const session = this.localTerminalEntries().find(([id]) => id === target)?.[1];
    if (!session) throw sessionError("LOCAL_SESSION_NOT_FOUND", "Local terminal no longer exists; list sessions and open one explicitly");
    return session;
  }

  async loadLocalSettings() {
    if (this.localSettings) return this.localSettings;
    try { this.localSettings = localOptions(JSON.parse(await readFile(join(this.base, "local-terminal.json"), "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") this.localSettingsWarning = "本地终端设置读取失败，已使用默认 Shell"; this.localSettings = localOptions(); }
    return this.localSettings;
  }

  async localShellCatalog(refresh = false) {
    await this.ready;
    if (refresh) this.localShellCache = undefined;
    this.localShellCache ??= listLocalShells(this.ctx.subprocess, this.base).catch(error => { this.localShellCache = undefined; throw error; });
    return { shells: await this.localShellCache, settings: await this.loadLocalSettings(), sessions: this.localSnapshots() };
  }

  async saveLocalSettings(value) {
    await this.ready;
    const settings = localOptions(value);
    const catalog = await this.localShellCatalog(true);
    if (!catalog.shells.some(item => item.available && item.shell === settings.shell && (settings.shell !== "wsl" || item.distribution === settings.distribution))) throw sessionError("LOCAL_SHELL_UNAVAILABLE", "请选择此 DSH 主机上的可用终端");
    const file = join(this.base, "local-terminal.json"), temp = file + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temp, JSON.stringify(settings, null, 2) + "\n", "utf8");
      await rename(temp, file);
      this.localSettings = settings;
    } finally { await rm(temp, { force: true }); }
    return { settings };
  }

  async ensureLocalSession() {
    if (this.localSession) return this.localSession;
    if (this.localStarting) return this.localStarting;
    this.localStarting = this.startLocalSession().catch((error) => {
      this.localError = summarizeError(error);
      throw error;
    }).finally(() => { this.localStarting = undefined; });
    return this.localStarting;
  }

  async startLocalSession(options, id = LOCAL_SESSION_ID) {
    if (this.disposed) throw sessionError("LOCAL_SESSION_DISPOSED", "Remote Ops is shutting down");
    await mkdir(this.base, { recursive: true });
    const settings = localOptions(options ?? await this.loadLocalSettings());
    const requested = settings.shell === "cmd" ? process.env.ComSpec?.trim() || "cmd.exe" : settings.shell === "sh" ? process.env.SHELL?.trim() || "/bin/sh" : LOCAL_SHELLS[settings.shell].executable;
    const executable = await this.ctx.subprocess.resolveExecutable(requested);
    const cwd = settings.shell === "wsl" ? this.base : settings.cwd || this.base;
    const terminal = await this.ctx.subprocess.spawnTerminal({
      argv: localShellArgv(settings, executable), cwd,
      env: { TERM: "xterm-256color", ...(settings.shell === "cmd" ? { PROMPT: "$P$G" } : {}) },
      terminalType: "xterm-256color",
      rows: 40,
      cols: 160,
      graceMs: 3_000,
    });
    if (this.disposed) { await terminal.terminate(); throw sessionError("LOCAL_SESSION_DISPOSED", "Remote Ops is shutting down"); }
    const baseName = settings.shell === "cmd" ? LOCAL_SESSION_NAME : settings.shell === "sh" ? "本地 Shell" : settings.shell === "wsl" ? "WSL · " + (settings.distribution || "默认") : LOCAL_SHELLS[settings.shell].name;
    const names = new Set(this.localTerminalEntries().filter(([key]) => key !== id).map(([, session]) => session.environment.name));
    let name = baseName, number = 2;
    while (names.has(name)) name = baseName + " · " + number++;
    const environment = { id, name, host: "localhost", username: process.env.USERNAME || process.env.USER || "local", port: 0 };
    const session = new LocalCmdTerminalSession(terminal, environment);
    session.localOptions = settings;
    session.localExecutable = executable;
    session.workingDirectory = settings.shell === "wsl" ? settings.cwd || "~" : cwd;
    session.onClose = () => session.outputBuffer.notify();
    this.localSessions.set(id, session);
    if (id === LOCAL_SESSION_ID) { this.localSession = session; this.localError = this.localSettingsWarning || ""; }
    this.trackTerminalLog(undefined, id, session, environment);
    return session;
  }

  openLocalTerminal(value = {}) {
    this.localOpeningCount = (this.localOpeningCount ?? 0) + 1;
    const operation = (this.localOpenQueue ?? Promise.resolve()).then(async () => {
      await this.ready;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw sessionError("LOCAL_OPTIONS_INVALID", "Local terminal options must be an object");
      if (value.reuse != null && typeof value.reuse !== "boolean") throw sessionError("LOCAL_OPTIONS_INVALID", "reuse must be a boolean");
      const defaults = await this.loadLocalSettings();
      const shell = value.shell ?? defaults.shell;
      const sameShell = shell === defaults.shell && (!value.distribution || value.distribution === defaults.distribution);
      const options = localOptions({ ...(sameShell ? defaults : {}), ...value, shell });
      if (options.shell === "wsl") {
        const catalog = await this.localShellCatalog();
        if (!options.distribution) options.distribution = catalog.shells.find(item => item.shell === "wsl" && item.available)?.distribution || "";
        if (!catalog.shells.some(item => item.shell === "wsl" && item.available && item.distribution === options.distribution)) throw sessionError("LOCAL_SHELL_UNAVAILABLE", "WSL 发行版不可用，请重新检测本地终端");
      }
      const entries = this.localTerminalEntries();
      const existing = value.reuse !== false && entries.find(([, session]) => session.status().kind === "running" && !session.closing && !session.active && !session.pendingSend && ![...this.commands.values()].some(job => job.target === session.environment.id && job.status === "running") && JSON.stringify(session.localOptions ?? localOptions()) === JSON.stringify(options));
      if (existing) return { ...this.localSnapshot(existing[0], existing[1]), reused: true };
      if (entries.length >= 32) throw sessionError("LOCAL_SESSION_LIMIT", "请先关闭部分本地终端，最多保留 32 个标签");
      const id = "local-shell-" + randomUUID();
      const session = await this.startLocalSession(options, id);
      return { ...this.localSnapshot(id, session), reused: false };
    }).finally(() => { this.localOpeningCount--; });
    this.localOpenQueue = operation.catch(() => {});
    return operation;
  }

  async closeLocalTerminal(target) {
    if (target === LOCAL_SESSION_ID) throw sessionError("LOCAL_DEFAULT_PINNED", "默认本地终端保留在工作区，可在退出后重新打开");
    const session = this.getLocalSession(target);
    if (session.reopening) throw sessionError("LOCAL_SESSION_BUSY", "Local terminal is reopening; retry after it is ready");
    session.closing = true;
    try {
      for (const job of this.commands.values()) if (job.target === target) job.controller.abort();
      await session.close();
      await Promise.allSettled([...this.commands.values()].filter(job => job.target === target).map(job => job.done));
      this.localSessions.delete(target);
      return { closed: true, sessionId: target };
    } finally { session.closing = false; session.outputBuffer.notify(); }
  }

  async reopenLocalTerminal(target) {
    await this.ready;
    if (this.localStarting) throw sessionError("LOCAL_SESSION_BUSY", "Local terminal is opening");
    const session = this.getLocalSession(target);
    if (session.closing) throw sessionError("REMOTE_SESSION_CLOSING", "This terminal is closing; no new process was opened");
    if (session.status().kind !== "exited") throw sessionError("LOCAL_SESSION_RUNNING", "Only an exited local terminal can be reopened");
    session.reopening = true;
    this.localStarting = this.startLocalSession(session.localOptions, target);
    try { return this.localSnapshot(target, await this.localStarting); }
    finally { this.localStarting = undefined; session.reopening = false; }
  }
};

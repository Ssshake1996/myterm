import { mkdir } from "node:fs/promises";
import { LOCAL_SESSION_ID, LOCAL_SESSION_NAME } from "../constants.js";
import { sessionError, summarizeError } from "../common.js";
import { LocalCmdTerminalSession } from "../terminal-sessions.js";

// The shared local terminal that exists before any Agent does.
export const withLocalTerminal = (Base) => class LocalTerminalLayer extends Base {
  async ensureLocalSession() {
    if (this.localSession?.status().kind === "running") return this.localSession;
    if (this.localStarting) return this.localStarting;
    this.localStarting = this.startLocalSession().catch((error) => {
      this.localError = summarizeError(error);
      throw error;
    }).finally(() => { this.localStarting = undefined; });
    return this.localStarting;
  }

  async startLocalSession() {
    if (this.disposed) throw sessionError("LOCAL_SESSION_DISPOSED", "Remote Ops is shutting down");
    await mkdir(this.base, { recursive: true });
    const windows = process.platform === "win32";
    const requested = windows ? (process.env.ComSpec?.trim() || "cmd.exe") : (process.env.SHELL?.trim() || "/bin/sh");
    const executable = await this.ctx.subprocess.resolveExecutable(requested);
    const terminal = await this.ctx.subprocess.spawnTerminal({
      argv: windows ? [executable, "/D", "/Q", "/K", "chcp 65001>nul"] : [executable, "-i"],
      cwd: this.base,
      env: windows ? { PROMPT: "$P$G", TERM: "xterm-256color" } : { TERM: "xterm-256color" },
      rows: 40,
      cols: 160,
      graceMs: 3_000,
    });
    const environment = { id: LOCAL_SESSION_ID, name: windows ? LOCAL_SESSION_NAME : "本地 Shell", host: "localhost", username: process.env.USERNAME || process.env.USER || "local", port: 0 };
    const session = new LocalCmdTerminalSession(terminal, environment);
    session.onClose = () => {
      if (this.localSession !== session) return;
      this.localSession = undefined;
      if (!this.disposed) setTimeout(() => { void this.ensureLocalSession().catch((error) => { this.localError = summarizeError(error); }); }, 200);
    };
    this.localSession = session;
    this.localError = "";
    return session;
  }
};

import { Buffer } from "node:buffer";
import { TerminalOutputBuffer } from "./output-buffer.js";
import { normalizeTerminalEncoding, sessionError, summarizeError } from "./common.js";
import { DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS, TERMINAL_COLS_RANGE, TERMINAL_ROWS_RANGE } from "./cli-profile.js";

export function buildSshShellOptions(environment) {
  return {
    window: { term: "xterm-256color", rows: environment?.terminal?.rows ?? DEFAULT_TERMINAL_ROWS, cols: environment?.terminal?.cols ?? DEFAULT_TERMINAL_COLS },
    options: { env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", LC_CTYPE: "C.UTF-8" } },
  };
}

class SendOperation {
  constructor(session, request) {
    this.session = session;
    this.request = request;
    this.startedAt = Date.now();
    this.startOffset = session.outputBuffer.endOffset;
    this.readOffset = this.startOffset;
    this.cancelled = false;
    this.output = { consume: () => this.readOutput().delta };
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.session.active = this;
    this.session.outputBuffer.notify();
    this.timer = setTimeout(() => this.finish("timeout"), Math.min(request.timeoutMs ?? 30_000, 300_000));
    this.onAbort = () => this.cancel();
    request.signal?.addEventListener("abort", this.onAbort, { once: true });
    this.write();
  }

  async write() {
    try {
      if (this.request.signal?.aborted) throw this.request.signal.reason ?? new Error("aborted");
      const text = `${this.request.text ?? ""}${this.request.submit ? "\r" : ""}`;
      if (text) await this.session.write(text);
      this.session.lastActivity = Date.now();
      this.poll();
    } catch (error) {
      this.fail(error);
    }
  }

  poll() {
    if (this.settled || this.cancelled || this.session.closed) return;
    const quietMs = this.request.quietMs ?? 700;
    if (Date.now() - this.session.lastActivity >= quietMs) return this.finish("inferred_idle");
    this.pollTimer = setTimeout(() => this.poll(), Math.max(1, Math.min(100, quietMs - (Date.now() - this.session.lastActivity))));
  }

  finish(waitReason) {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    clearTimeout(this.pollTimer);
    this.request.signal?.removeEventListener("abort", this.onAbort);
    if (this.session.active === this) this.session.active = undefined;
    this.session.lastWaitReason = waitReason;
    this.session.outputBuffer.notify();
    const unread = this.readOutput();
    this.resolve({
      waitReason,
      completion: "unknown",
      viewport: unread.delta,
      truncated: unread.truncated,
      sessionStatus: this.session.status(),
      startedAt: this.startedAt,
      finishedAt: Date.now(),
    });
  }

  fail(error) {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    clearTimeout(this.pollTimer);
    this.request.signal?.removeEventListener("abort", this.onAbort);
    if (this.session.active === this) this.session.active = undefined;
    this.session.outputBuffer.notify();
    this.reject(error);
  }

  cancel() {
    if (this.settled) return false;
    this.cancelled = true;
    try { void Promise.resolve(this.session.write("\u0003")).catch(() => {}); } catch { /* session may already be closed */ }
    this.finish("cancelled");
    return true;
  }

  get donePromise() { return this.promise; }
  get done() { return this.promise; }
  readOutput() {
    const result = this.session.outputBuffer.readFrom(this.readOffset);
    this.readOffset = result.nextOffset;
    return { delta: result.text, truncated: result.truncated };
  }
}

export class SshTerminalSession {
  constructor(client, channel, environment, window = {}) {
    this.client = client;
    this.channel = channel;
    this.environment = environment;
    this.outputBuffer = new TerminalOutputBuffer();
    this.decoder = new TextDecoder(normalizeTerminalEncoding(environment.encoding), { fatal: false });
    this.closed = false;
    this.exitCode = undefined;
    this.lastActivity = Date.now();
    this.motd = "";
    this.rows = window.rows ?? DEFAULT_TERMINAL_ROWS;
    this.cols = window.cols ?? DEFAULT_TERMINAL_COLS;
    this.closeReason = undefined;
    this.closeRequested = false;
    this.closeNotified = false;
    this.onClose = undefined;
    channel.on("data", (chunk) => this.append(this.decoder.decode(chunk, { stream: true })));
    channel.stderr?.on("data", (chunk) => this.append(this.decoder.decode(chunk, { stream: true })));
    channel.on("exit", (code, signal) => { this.exitCode = code ?? null; this.exitSignal = signal ?? null; });
    channel.on("close", () => this.markClosed());
    // A permanent error listener also keeps a late keepalive/transport error from crashing the host process.
    client.on?.("error", (error) => { this.closeReason ??= summarizeError(error); });
    client.on?.("close", () => this.markClosed());
  }

  get size() { return { rows: this.rows, cols: this.cols }; }

  markClosed() {
    this.closed = true;
    this.outputBuffer.notify();
    this.active?.finish("session_exit");
    if (this.closeNotified) return;
    this.closeNotified = true;
    if (!this.closeReason && this.exitSignal) this.closeReason = `remote shell terminated by signal ${this.exitSignal}`;
    else if (!this.closeReason && typeof this.exitCode === "number") this.closeReason = `remote shell exited with code ${this.exitCode}`;
    try { this.onClose?.({ reason: this.closeReason, requested: this.closeRequested, exitCode: this.exitCode ?? null, signal: this.exitSignal ?? null }); } catch { /* an observer must never break session teardown */ }
  }

  exitedError() {
    const name = this.environment?.name ?? "SSH";
    return sessionError("REMOTE_SESSION_EXITED", `SSH connection to ${name} has exited${this.closeReason ? ` (${this.closeReason})` : ""}. Nothing was replayed; open a new connection with remote_terminal_open (environment ${JSON.stringify(name)}) and re-run only the commands you still need`);
  }

  resize(rows, cols) {
    if (this.closed) throw this.exitedError();
    const nextRows = rows === undefined || rows === null ? this.rows : rows;
    const nextCols = cols === undefined || cols === null ? this.cols : cols;
    const [minRows, maxRows] = TERMINAL_ROWS_RANGE, [minCols, maxCols] = TERMINAL_COLS_RANGE;
    if (!Number.isInteger(nextRows) || nextRows < minRows || nextRows > maxRows) throw sessionError("TERMINAL_OPTION_INVALID", `rows must be an integer ${minRows}-${maxRows}`);
    if (!Number.isInteger(nextCols) || nextCols < minCols || nextCols > maxCols) throw sessionError("TERMINAL_OPTION_INVALID", `cols must be an integer ${minCols}-${maxCols}`);
    if (typeof this.channel.setWindow !== "function") throw sessionError("TERMINAL_RESIZE_UNSUPPORTED", "This SSH channel cannot change the PTY size");
    this.channel.setWindow(nextRows, nextCols, 0, 0);
    this.rows = nextRows;
    this.cols = nextCols;
    return this.size;
  }

  append(text) {
    if (!text) return;
    this.outputBuffer.append(text);
    this.lastActivity = Date.now();
  }

  get output() { return this.outputBuffer.value; }

  startSend(request) {
    if (this.closed) throw this.exitedError();
    if (this.active) throw sessionError("SEND_ACTIVE", "SSH session already has an active send");
    return new SendOperation(this, request);
  }

  write(text) {
    if (this.closed) throw this.exitedError();
    const value = String(text ?? "");
    if (!value) return;
    this.channel.write(value, "utf8");
  }

  writeInput(text) {
    if (this.closed) throw this.exitedError();
    const value = String(text ?? "");
    if (!value) return { accepted: true, bytes: 0 };
    this.channel.write(value, "utf8");
    this.lastActivity = Date.now();
    return { accepted: true, bytes: Buffer.byteLength(value, "utf8") };
  }

  read(request = {}) {
    const lines = this.output.split(/\r?\n/);
    const totalLines = this.output ? lines.length : 0;
    const offset = request.offset ?? 0;
    const count = request.count ?? 500;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
    const end = Math.max(0, totalLines - offset);
    const selected = lines.slice(Math.max(0, end - count), end).join("\n");
    return { text: selected, totalLines, lineBegin: offset, lineEnd: offset + (selected ? selected.split("\n").length : 0), truncated: false };
  }

  status() {
    return this.closed ? { kind: "exited", exitCode: this.exitCode ?? null, signal: this.exitSignal ?? null, ...(this.closeReason ? { reason: this.closeReason } : {}) } : { kind: "running" };
  }

  signal(signal) {
    if (this.closed) throw this.exitedError();
    if (signal === "SIGINT" || signal === "INT") this.channel.write("\u0003");
    else if (typeof this.channel.signal === "function") this.channel.signal(signal);
    return { delivered: true, targetPgid: undefined };
  }

  async close(reason = "closed by agent") {
    if (this.closed) return;
    this.closeRequested = true;
    this.closed = true;
    this.outputBuffer.notify();
    this.active?.finish("session_exit");
    try { this.channel.end(); } catch { /* noop */ }
    try { this.client.end(); } catch { /* noop */ }
  }
}

export class LocalCmdTerminalSession {
  get size() { return { rows: DEFAULT_TERMINAL_ROWS, cols: DEFAULT_TERMINAL_COLS }; }

  constructor(terminal, environment) {
    this.terminal = terminal;
    this.environment = environment;
    this.outputBuffer = new TerminalOutputBuffer();
    this.decoder = new TextDecoder("utf-8", { fatal: false });
    this.active = undefined;
    this.closed = false;
    this.exitCode = undefined;
    this.exitSignal = undefined;
    this.lastActivity = Date.now();
    this.motd = "";
    terminal.output.on("data", (chunk) => this.append(this.decoder.decode(Buffer.from(chunk), { stream: true })));
    terminal.output.on("end", () => {
      const tail = this.decoder.decode();
      if (tail) this.append(tail);
      this.finishExit();
    });
    terminal.done.then((outcome) => {
      this.exitCode = outcome?.exitCode ?? null;
      this.exitSignal = outcome?.signal ?? null;
      this.finishExit();
    }, (error) => {
      this.transportError = error;
      this.finishExit();
    });
  }

  append(text) {
    if (!text) return;
    this.outputBuffer.append(text);
    this.lastActivity = Date.now();
  }

  get output() { return this.outputBuffer.value; }

  finishExit() {
    if (this.closed) return;
    this.closed = true;
    this.outputBuffer.notify();
    this.active?.finish("session_exit");
    this.onClose?.();
  }

  startSend(request) {
    if (this.closed) throw sessionError("LOCAL_SESSION_EXITED", "Local CMD session has exited");
    if (this.active) throw sessionError("SEND_ACTIVE", "Local CMD already has an active send");
    return new SendOperation(this, request);
  }

  async write(text) {
    if (this.closed) throw sessionError("LOCAL_SESSION_EXITED", "Local CMD session has exited");
    const value = String(text ?? "");
    if (!value) return;
    await this.terminal.write(value);
  }

  async writeInput(text) {
    if (this.closed) throw sessionError("LOCAL_SESSION_EXITED", "Local CMD session has exited");
    const value = String(text ?? "");
    if (!value) return { accepted: true, bytes: 0 };
    await this.terminal.write(value);
    this.lastActivity = Date.now();
    return { accepted: true, bytes: Buffer.byteLength(value, "utf8") };
  }

  read(request = {}) {
    const lines = this.output.split(/\r?\n/);
    const totalLines = this.output ? lines.length : 0;
    const offset = request.offset ?? 0;
    const count = request.count ?? 500;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
    const end = Math.max(0, totalLines - offset);
    const selected = lines.slice(Math.max(0, end - count), end).join("\n");
    return { text: selected, totalLines, lineBegin: offset, lineEnd: offset + (selected ? selected.split("\n").length : 0), truncated: false };
  }

  status() {
    return this.closed ? { kind: "exited", exitCode: this.exitCode ?? null, signal: this.exitSignal ?? null } : { kind: "running" };
  }

  async signal(signal) {
    if (this.closed) throw sessionError("LOCAL_SESSION_EXITED", "Local CMD session has exited");
    try {
      const targetPgid = await this.terminal.signalForeground(signal === "INT" ? "SIGINT" : signal);
      return { delivered: true, targetPgid };
    } catch (error) {
      throw sessionError("LOCAL_SIGNAL_FAILED", `Unable to signal local CMD: ${summarizeError(error)}`);
    }
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.terminal.terminate().catch((error) => {
      throw sessionError("LOCAL_SESSION_CLOSE_FAILED", "Unable to close local CMD session", error);
    });
    await this.closePromise;
  }
}

export class AdoptedTerminalSession {
  constructor(ctx, owner, snapshot) {
    this.ctx = ctx;
    this.owner = owner;
    this.sessionId = snapshot.sessionId;
    this.snapshot = snapshot;
    this.outputBuffer = new TerminalOutputBuffer();
    this.refreshPromise = undefined;
  }

  get output() { return this.outputBuffer.value; }

  status() {
    const current = this.ctx.terminals.list(this.owner).find((item) => item.sessionId === this.sessionId);
    return current?.status ?? this.snapshot.status;
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = Promise.resolve(this.ctx.terminals.read(this.owner, this.sessionId, { offset: 0, count: 2_000 })).then((result) => {
      const text = String(result?.text ?? "");
      if (text === this.outputBuffer.value) return false;
      this.outputBuffer = new TerminalOutputBuffer();
      this.outputBuffer.append(text);
      return true;
    }).finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  async waitForChange(waitMs, signal) {
    const deadline = Date.now() + Math.max(0, waitMs);
    do {
      if (await this.refresh()) return;
      if (signal?.aborted || Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
    } while (!signal?.aborted);
  }

  writeInput(text) {
    const value = String(text ?? "");
    if (!value) return { accepted: true, bytes: 0 };
    const operation = this.ctx.terminals.startSend(this.owner, this.sessionId, { text: value, submit: false });
    void operation.done.catch(() => {});
    return { accepted: true, bytes: Buffer.byteLength(value, "utf8") };
  }

  signal(signal) { return this.ctx.terminals.signal(this.owner, this.sessionId, signal); }
}

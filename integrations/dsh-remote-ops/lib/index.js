import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { Buffer } from "node:buffer";
import { Client as SshClient } from "ssh2";

export const name = "dsh-remote-ops";
export const inject = ["connection", "systemPrompt", "tools", "terminals", "agents", "credentials"];

const ROOT = "remote-ops";
const MAX_SCROLLBACK_BYTES = 4 * 1024 * 1024;
const MAX_SFTP_BYTES = 2 * 1024 * 1024;
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
function resolveRemoteHome() { const configured = process.env.DSH_HOME?.trim(); return configured ? configured.replace(/^~(?=[\\/])/, homedir()) : join(homedir(), ".dsh"); }

export function normalizeGroupName(value) {
  const normalized = String(value ?? "default")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 64);
  return normalized || "default";
}

export function summarizeError(error) {
  if (error === null || error === undefined) return "Unknown error";
  if (typeof error === "string") return error;
  const code = error.code ? ` [${error.code}]` : "";
  return `${error.message ?? String(error)}${code}`;
}

export function validateEnvironment(value) {
  const errors = [];
  if (!value || typeof value !== "object") return { ok: false, errors: ["environment must be an object"] };
  for (const field of ["id", "name", "host", "username"]) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0) errors.push(`${field} is required`);
  }
  if (typeof value.id === "string" && !ID_RE.test(value.id)) errors.push("id must contain only letters, numbers, dot, underscore or hyphen");
  if (value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)) errors.push("port must be 1-65535");
  if (value.privateKeyPath !== undefined && typeof value.privateKeyPath !== "string") errors.push("privateKeyPath must be a string");
  if (value.passwordRef !== undefined && typeof value.passwordRef !== "string") errors.push("passwordRef must be a string");
  return { ok: errors.length === 0, errors };
}

function ownerId(owner) {
  const id = owner?.id;
  if (typeof id !== "string" || !id) throw new Error("REMOTE_AGENT_REQUIRED: an active Harness agent is required");
  return id;
}

function sessionError(code, message, cause) {
  const error = new Error(`${code}: ${message}${cause ? `; ${summarizeError(cause)}` : ""}`);
  error.code = code;
  return error;
}

class SendOperation {
  constructor(session, request) {
    this.session = session;
    this.request = request;
    this.startedAt = Date.now();
    this.startOffset = session.output.length;
    this.cancelled = false;
    this.output = { consume: () => session.output.slice(this.startOffset) };
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.timer = setTimeout(() => this.finish("timeout"), Math.min(request.timeoutMs ?? 30_000, 300_000));
    this.write();
  }

  async write() {
    try {
      if (this.request.signal?.aborted) throw this.request.signal.reason ?? new Error("aborted");
      const text = `${this.request.text ?? ""}${this.request.submit ? "\r" : ""}`;
      if (text) this.session.channel.write(text);
      this.session.active = this;
      this.session.lastActivity = Date.now();
      this.poll();
    } catch (error) {
      this.fail(error);
    }
  }

  poll() {
    if (this.cancelled || this.session.closed) return;
    const quietMs = this.request.quietMs ?? 700;
    if (Date.now() - this.session.lastActivity >= quietMs) return this.finish("inferred_idle");
    this.pollTimer = setTimeout(() => this.poll(), 100);
  }

  finish(waitReason) {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    clearTimeout(this.pollTimer);
    if (this.session.active === this) this.session.active = undefined;
    this.resolve({
      waitReason,
      output: this.session.output.slice(this.startOffset),
      viewport: this.session.output.slice(Math.max(0, this.session.output.length - 64 * 1024)),
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
    if (this.session.active === this) this.session.active = undefined;
    this.reject(error);
  }

  cancel() {
    if (this.settled) return false;
    this.cancelled = true;
    try { this.session.channel.write("\u0003"); } catch { /* channel may already be closed */ }
    this.finish("cancelled");
    return true;
  }

  get donePromise() { return this.promise; }
  get done() { return this.promise; }
  readOutput() { return { delta: this.session.output.slice(this.startOffset), truncated: false }; }
}

class SshTerminalSession {
  constructor(client, channel, environment) {
    this.client = client;
    this.channel = channel;
    this.environment = environment;
    this.output = "";
    this.active = undefined;
    this.closed = false;
    this.exitCode = undefined;
    this.lastActivity = Date.now();
    this.motd = "";
    channel.on("data", (chunk) => this.append(chunk.toString("utf8")));
    channel.stderr?.on("data", (chunk) => this.append(chunk.toString("utf8")));
    channel.on("exit", (code, signal) => { this.exitCode = code ?? null; this.exitSignal = signal ?? null; });
    channel.on("close", () => {
      this.closed = true;
      if (this.active) this.active.finish("session_exit");
    });
  }

  append(text) {
    if (!text) return;
    this.output += text;
    this.lastActivity = Date.now();
    if (Buffer.byteLength(this.output, "utf8") > MAX_SCROLLBACK_BYTES) {
      const chars = Array.from(this.output);
      while (Buffer.byteLength(chars.join(""), "utf8") > MAX_SCROLLBACK_BYTES) chars.splice(0, Math.max(1, Math.floor(chars.length * 0.1)));
      this.output = chars.join("");
    }
  }

  startSend(request) {
    if (this.closed) throw sessionError("REMOTE_SESSION_EXITED", "SSH session has exited");
    if (this.active) throw sessionError("SEND_ACTIVE", "SSH session already has an active send");
    return new SendOperation(this, request);
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

  signal(signal) {
    if (this.closed) throw sessionError("REMOTE_SESSION_EXITED", "SSH session has exited");
    if (signal === "SIGINT" || signal === "INT") this.channel.write("\u0003");
    else if (typeof this.channel.signal === "function") this.channel.signal(signal);
    return { delivered: true, targetPgid: undefined };
  }

  async close(reason = "closed by agent") {
    if (this.closed) return;
    this.closed = true;
    try { this.channel.end(); } catch { /* noop */ }
    try { this.client.end(); } catch { /* noop */ }
  }
}

class RemoteOpsState {
  constructor(ctx) {
    this.ctx = ctx;
    this.base = join(resolveRemoteHome(), ROOT);
    this.environments = new Map();
    this.quickCommands = [];
    this.sessions = new Map();
    this.events = new Map();
    this.backendSessions = new Map();
    this.ready = this.load();
  }

  async load() {
    await mkdir(this.base, { recursive: true });
    const files = await (await import("node:fs/promises")).readdir(this.base).catch(() => []);
    for (const file of files.filter((x) => x.endsWith("-environments.json"))) {
      const group = file.slice(0, -"-environments.json".length);
      const data = await this.readJson(join(this.base, file), []);
      if (Array.isArray(data)) this.environments.set(normalizeGroupName(group), data.filter((item) => validateEnvironment(item).ok));
    }
    this.quickCommands = await this.readJson(join(this.base, "quick-commands.json"), []);
    if (!Array.isArray(this.quickCommands)) this.quickCommands = [];
  }

  async readJson(path, fallback) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; } }
  envFile(group) { return join(this.base, `${normalizeGroupName(group)}-environments.json`); }

  async saveGroup(group) { await mkdir(this.base, { recursive: true }); await writeFile(this.envFile(group), `${JSON.stringify(this.environments.get(group) ?? [], null, 2)}\n`, "utf8"); }
  async saveQuickCommands() { await writeFile(join(this.base, "quick-commands.json"), `${JSON.stringify(this.quickCommands, null, 2)}\n`, "utf8"); }

  allEnvironments() { return [...this.environments.entries()].flatMap(([group, values]) => values.map((value) => ({ ...value, group }))); }
  catalog() {
    return {
      environments: this.allEnvironments().map((value) => ({ ...value, passwordRef: value.passwordRef ? "configured" : undefined, active: false })),
      quickCommands: this.quickCommands,
      sessions: [],
      events: [],
      bound: false,
    };
  }
  findEnvironment(idOrName) { return this.allEnvironments().find((value) => value.id === idOrName || value.name === idOrName); }
  event(owner, kind, data = {}) {
    const id = ownerId(owner);
    const list = this.events.get(id) ?? [];
    list.push({ at: new Date().toISOString(), kind, ...data });
    while (list.length > 100) list.shift();
    this.events.set(id, list);
  }
  snapshot(owner) {
    const id = ownerId(owner);
    const sessions = [...this.sessions.values()].filter((x) => x.ownerId === id).map((x) => ({ sessionId: x.sessionId, environmentId: x.environment.id, name: x.environment.name, status: x.session.status() }));
    return { environments: this.allEnvironments().map((x) => ({ ...x, passwordRef: x.passwordRef ? "configured" : undefined, active: sessions.some((s) => s.environmentId === x.id) })), quickCommands: this.quickCommands, sessions, events: this.events.get(id) ?? [] };
  }

  async resolvePassword(environment) {
    if (!environment.passwordRef) return undefined;
    const credentials = this.ctx.credentials;
    if (!credentials?.resolve) throw sessionError("REMOTE_CREDENTIALS_UNAVAILABLE", "Harness credentials service is not available");
    const result = await credentials.resolve(environment.passwordRef);
    return result?.value;
  }

  async spawnBackend(spec) {
    await this.ready;
    const environment = this.findEnvironment(spec.name);
    if (!environment) throw sessionError("REMOTE_ENV_NOT_FOUND", `Environment not found: ${spec.name}`);
    const client = new SshClient();
    const config = { host: environment.host, port: environment.port ?? 22, username: environment.username, readyTimeout: environment.readyTimeoutMs ?? 15_000, keepaliveInterval: 10_000, keepaliveCountMax: 3 };
    try {
      if (environment.privateKeyPath) config.privateKey = await readFile(environment.privateKeyPath);
      const password = await this.resolvePassword(environment);
      if (password) config.password = password;
      const channel = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(sessionError("SSH_CONNECT_TIMEOUT", `SSH connection timed out: ${environment.host}:${config.port}`)), config.readyTimeout);
        client.once("ready", () => client.shell({ term: "xterm-256color", rows: 40, cols: 160 }, (error, stream) => { clearTimeout(timer); if (error) reject(error); else resolve(stream); }));
        client.once("error", (error) => { clearTimeout(timer); reject(error); });
        client.connect(config);
      });
      const session = new SshTerminalSession(client, channel, environment);
      this.backendSessions.set(spec.sessionId, session);
      return session;
    } catch (error) {
      try { client.end(); } catch { /* noop */ }
      throw sessionError("SSH_CONNECT_FAILED", `${environment.name} (${environment.host}:${config.port})`, error);
    }
  }

  async open(owner, environmentId) {
    await this.ready;
    const environment = this.findEnvironment(environmentId);
    if (!environment) throw sessionError("REMOTE_ENV_NOT_FOUND", `Environment not found: ${environmentId}`);
    const id = ownerId(owner);
    const existing = [...this.sessions.values()].find((x) => x.ownerId === id && x.environment.id === environment.id && x.session.status().kind !== "exited");
    if (existing) return existing;
    const spawned = await this.ctx.terminals.spawn(owner, { type: "ssh", name: environment.id });
    const session = this.backendSessions.get(spawned.sessionId);
    if (!session) throw new Error("SSH backend did not return a session");
    const record = { sessionId: spawned.sessionId, ownerId: id, owner, environment, session };
    this.sessions.set(record.sessionId, record);
    this.event(owner, "ssh.open", { sessionId: record.sessionId, environment: environment.name });
    return record;
  }

  getSession(owner, sessionIdOrEnvironment) {
    const id = ownerId(owner);
    const record = this.sessions.get(sessionIdOrEnvironment) ?? [...this.sessions.values()].find((x) => x.ownerId === id && x.environment.id === sessionIdOrEnvironment);
    if (!record) throw sessionError("REMOTE_SESSION_NOT_FOUND", `No SSH session for ${sessionIdOrEnvironment}`);
    if (record.ownerId !== id) throw sessionError("FOREIGN_SESSION", "SSH session belongs to another agent");
    return record;
  }

  async deleteEnvironment(owner, idOrName) {
    await this.ready;
    const target = this.findEnvironment(idOrName);
    if (!target) throw sessionError("REMOTE_ENV_NOT_FOUND", idOrName);
    for (const record of [...this.sessions.values()]) {
      if (record.environment.id === target.id && record.ownerId === ownerId(owner)) {
        await this.ctx.terminals.kill(owner, record.sessionId, "environment deleted").catch(() => {});
        this.sessions.delete(record.sessionId);
      }
    }
    for (const [group, list] of this.environments) {
      const next = list.filter((x) => x.id !== target.id);
      if (next.length !== list.length) {
        this.environments.set(group, next);
        await this.saveGroup(group);
      }
    }
    return { deleted: true, environment: target.name };
  }

  async send(owner, target, args) {
    const record = target ? this.getSession(owner, target) : await this.open(owner, args.environment);
    const operation = this.ctx.terminals.startSend(owner, record.sessionId, { text: args.text ?? args.command ?? "", submit: args.submit ?? args.newline ?? true, quietMs: args.quietMs, timeoutMs: (args.timeoutSeconds ?? 30) * 1000, signal: args.signal });
    const result = await operation.done;
    this.event(owner, "ssh.send", { sessionId: record.sessionId, environment: record.environment.name, inputChars: String(args.text ?? args.command ?? "").length, waitReason: result.waitReason });
    return { sessionId: record.sessionId, environment: record.environment.name, ...result };
  }

  async sftp(owner, environmentId, action, args) {
    await this.ready;
    const environment = this.findEnvironment(environmentId);
    if (!environment) throw sessionError("REMOTE_ENV_NOT_FOUND", `Environment not found: ${environmentId}`);
    const client = new SshClient();
    try {
      const config = { host: environment.host, port: environment.port ?? 22, username: environment.username, readyTimeout: environment.readyTimeoutMs ?? 15_000 };
      if (environment.privateKeyPath) config.privateKey = await readFile(environment.privateKeyPath);
      const password = await this.resolvePassword(environment); if (password) config.password = password;
      await new Promise((resolve, reject) => { client.once("ready", resolve); client.once("error", reject); client.connect(config); });
      const sftp = await new Promise((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)));
      const call = (method, ...values) => new Promise((resolve, reject) => sftp[method](...values, (error, value) => error ? reject(error) : resolve(value)));
      if (action === "list") { const entries = await call("readdir", args.path ?? "."); return { path: args.path ?? ".", entries: entries.map((entry) => ({ name: entry.filename, type: (entry.attrs?.mode & 0o170000) === 0o040000 ? "d" : "-", size: entry.attrs?.size ?? 0, modifyTime: entry.attrs?.mtime })) }; }
      if (action === "read") { const chunks = []; let size = 0; await new Promise((resolve, reject) => { const stream = sftp.createReadStream(args.path); stream.on("data", (chunk) => { size += chunk.length; if (size > MAX_SFTP_BYTES) { stream.destroy(sessionError("SFTP_READ_LIMIT", `File exceeds ${MAX_SFTP_BYTES} bytes`)); return; } chunks.push(chunk); }); stream.once("error", reject); stream.once("close", resolve); }); return { path: args.path, content: Buffer.concat(chunks).toString("utf8") }; }
      if (action === "write") { await new Promise((resolve, reject) => { const stream = sftp.createWriteStream(args.path); stream.once("error", reject); stream.once("close", resolve); stream.end(Buffer.from(args.content ?? "", "utf8")); }); return { path: args.path, written: Buffer.byteLength(args.content ?? "", "utf8") }; }
      if (action === "mkdir") { const parts = String(args.path).split(/[\\/]+/).filter(Boolean); let current = String(args.path).startsWith("/") ? "" : "."; for (const part of parts) { current += `/${part}`; await call("mkdir", current).catch(() => {}); } return { path: args.path, created: true }; }
      if (action === "delete") { const stat = await call("stat", args.path); if ((stat.mode & 0o170000) === 0o040000) await call("rmdir", args.path); else await call("unlink", args.path); return { path: args.path, deleted: true }; }
      if (action === "rename") { await call("rename", args.from, args.to); return { from: args.from, to: args.to, renamed: true }; }
      throw new Error(`Unsupported SFTP action: ${action}`);
    } finally { client.end(); }
  }
}

const output = { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] };
const stringParam = (description, required = false) => ({ type: "string", description, ...(required ? { required: true } : {}) });
const numberParam = (description) => ({ type: "number", description });
const boolParam = (description) => ({ type: "boolean", description });

function registerTool(ctx, definition) {
  ctx.tools.register({ ...definition, output });
}

export function apply(ctx) {
  const state = new RemoteOpsState(ctx);
  ctx.effect(() => async () => {
    for (const record of state.sessions.values()) await ctx.terminals.kill(record.owner, record.sessionId, "dsh-remote-ops disposed").catch(() => {});
    state.sessions.clear();
  }, "dsh-remote-ops cleanup");
  ctx.effect(() => ctx.terminals.registerBackend({ type: "ssh", spawn: (spec) => state.spawnBackend(spec) }), "dsh-remote-ops SSH backend");

  ctx.systemPrompt.section({
    name: "dsh-remote-ops",
    order: 410,
    text: "Remote operations are provided by dsh-remote-ops. Use remote_environment_list when the target is ambiguous. Use remote_terminal_open/send/read for SSH work and preserve command spaces exactly. Prefer one complete command or a short batch when the command is known; use incremental reads only when live terminal state is needed. For multiple SSH targets, name each target explicitly, execute sequentially, observe the result, and only then continue. Product CLI knowledge may come from MCP, but MCP results are knowledge/validation, not a substitute for executing through the remote terminal. Never invent credentials or claim a connection succeeded without an observed result.",
  });

  const owner = (exec) => exec.agent;
  registerTool(ctx, { name: "remote_environment_list", description: "List saved SSH environments and active owner-scoped sessions.", parameters: {}, execute: async (_args, exec) => { await state.ready; return state.snapshot(owner(exec)); } });
  registerTool(ctx, { name: "remote_environment_create", description: "Create or replace one saved SSH environment. Use passwordRef instead of plaintext passwords.", parameters: { id: stringParam("Stable environment id", true), name: stringParam("Display name", true), host: stringParam("SSH host", true), username: stringParam("SSH username", true), group: stringParam("Environment group"), port: numberParam("SSH port"), privateKeyPath: stringParam("Local private key path"), passwordRef: stringParam("Harness credential reference") }, execute: async (args, exec) => { await state.ready; const value = { ...args, group: normalizeGroupName(args.group) }; const validation = validateEnvironment(value); if (!validation.ok) throw sessionError("REMOTE_ENV_INVALID", validation.errors.join(", ")); const list = state.environments.get(value.group) ?? []; const next = list.filter((x) => x.id !== value.id); next.push(value); state.environments.set(value.group, next); await state.saveGroup(value.group); state.event(owner(exec), "environment.create", { environment: value.name }); return { saved: true, environment: { ...value, passwordRef: value.passwordRef ? "configured" : undefined } }; } });
  registerTool(ctx, { name: "remote_environment_delete", description: "Delete a saved SSH environment and close its owner sessions.", parameters: { environment: stringParam("Environment id or name", true) }, execute: async (args, exec) => state.deleteEnvironment(owner(exec), args.environment) });
  registerTool(ctx, { name: "remote_terminal_open", description: "Open or reuse an SSH terminal for an environment.", parameters: { environment: stringParam("Environment id or name", true) }, execute: async (_args, exec) => { const record = await state.open(owner(exec), _args.environment); return { sessionId: record.sessionId, environment: record.environment.name, status: record.session.status(), viewport: record.session.output.slice(-64 * 1024) }; } });
  registerTool(ctx, { name: "remote_terminal_send", description: "Send a complete command or interactive input to an owner-scoped SSH terminal and wait for output.", parameters: { session: stringParam("Session id or environment id"), environment: stringParam("Environment id or name when opening on demand"), text: stringParam("Input text; preserve every separator", true), submit: boolParam("Append Enter; defaults true"), quietMs: numberParam("Quiet completion window in milliseconds"), timeoutSeconds: numberParam("Timeout in seconds") }, execute: async (args, exec) => state.send(owner(exec), args.session, args) });
  registerTool(ctx, { name: "remote_terminal_read", description: "Read bounded retained output from an SSH terminal.", parameters: { session: stringParam("Session id or environment id", true), offset: numberParam("Newest-relative line offset"), count: numberParam("Line count") }, execute: async (args, exec) => { const record = state.getSession(owner(exec), args.session); return { sessionId: record.sessionId, environment: record.environment.name, ...ctx.terminals.read(owner(exec), record.sessionId, args) }; } });
  registerTool(ctx, { name: "remote_terminal_signal", description: "Send an interrupt or allowed signal to the SSH foreground process.", parameters: { session: stringParam("Session id or environment id", true), signal: stringParam("Signal such as SIGINT or SIGTERM", true) }, execute: async (args, exec) => { const record = state.getSession(owner(exec), args.session); return { sessionId: record.sessionId, ...ctx.terminals.signal(owner(exec), record.sessionId, args.signal) }; } });
  registerTool(ctx, { name: "remote_terminal_close", description: "Close an owner-scoped SSH terminal.", parameters: { session: stringParam("Session id", true) }, execute: async (args, exec) => { const record = state.getSession(owner(exec), args.session); await ctx.terminals.kill(owner(exec), record.sessionId, "agent request"); state.sessions.delete(record.sessionId); return { closed: true, sessionId: record.sessionId }; } });
  registerTool(ctx, { name: "remote_terminal_batch", description: "Execute complete commands sequentially on one or more explicit SSH environments and return each result.", parameters: { targets: { type: "array", required: true, items: { type: "string" }, description: "Environment ids or names" }, commands: { type: "array", required: true, items: { type: "string" }, description: "Complete commands in order" }, timeoutSeconds: numberParam("Per-command timeout") }, execute: async (args, exec) => { const results = []; for (const target of args.targets) { const targetResults = []; for (const command of args.commands) targetResults.push(await state.send(owner(exec), undefined, { environment: target, text: command, submit: true, timeoutSeconds: args.timeoutSeconds })); results.push({ target, results: targetResults }); } return { results }; } });
  registerTool(ctx, { name: "remote_quick_command_list", description: "List saved quick commands.", parameters: {}, execute: async () => { await state.ready; return { commands: state.quickCommands }; } });
  registerTool(ctx, { name: "remote_quick_command_run", description: "Run a saved quick command on one explicit environment.", parameters: { commandId: stringParam("Quick command id", true), environment: stringParam("Environment id or name", true) }, execute: async (args, exec) => { await state.ready; const command = state.quickCommands.find((x) => x.id === args.commandId); if (!command) throw sessionError("REMOTE_QUICK_COMMAND_NOT_FOUND", args.commandId); return state.send(owner(exec), undefined, { environment: args.environment, text: command.command, submit: true }); } });
  registerTool(ctx, { name: "remote_sftp_list", description: "List a remote SFTP directory.", parameters: { environment: stringParam("Environment id or name", true), path: stringParam("Remote path") }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "list", args) });
  registerTool(ctx, { name: "remote_sftp_read", description: "Read a bounded UTF-8 remote SFTP file.", parameters: { environment: stringParam("Environment id or name", true), path: stringParam("Remote path", true) }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "read", args) });
  registerTool(ctx, { name: "remote_sftp_write", description: "Write a UTF-8 remote SFTP file.", parameters: { environment: stringParam("Environment id or name", true), path: stringParam("Remote path", true), content: stringParam("UTF-8 file content", true) }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "write", args) });
  registerTool(ctx, { name: "remote_sftp_mkdir", description: "Create a remote SFTP directory.", parameters: { environment: stringParam("Environment id or name", true), path: stringParam("Remote path", true) }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "mkdir", args) });
  registerTool(ctx, { name: "remote_sftp_delete", description: "Delete a remote SFTP file or directory.", parameters: { environment: stringParam("Environment id or name", true), path: stringParam("Remote path", true) }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "delete", args) });
  registerTool(ctx, { name: "remote_sftp_rename", description: "Rename a remote SFTP file or directory.", parameters: { environment: stringParam("Environment id or name", true), from: stringParam("Existing path", true), to: stringParam("New path", true) }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "rename", args) });
  registerTool(ctx, { name: "remote_diagnostics", description: "Read recent remote operation diagnostics for this Agent.", parameters: {}, execute: async (_args, exec) => ({ events: state.events.get(ownerId(owner(exec))) ?? [] }) });

  ctx.effect(() => ctx.connection.fetch.register({ path: "/api/dsh-remote-ops/state", methods: ["GET"], requestBody: "buffered", fetch: async (request) => { const sessionId = new URL(request.url).searchParams.get("sessionId"); const agent = sessionId ? ctx.agents.get(sessionId) : undefined; await state.ready; return Response.json(agent ? { ...state.snapshot(agent), bound: true } : state.catalog(), { headers: { "Cache-Control": "no-store" } }); } }), "dsh-remote-ops state route");
  ctx.effect(() => ctx.connection.fetch.register({ path: "/api/dsh-remote-ops/action", methods: ["POST"], requestBody: "buffered", fetch: async (request) => { const body = await request.json(); const agent = ctx.agents.get(body.sessionId); if (!agent) return Response.json({ error: "REMOTE_SESSION_NOT_ACTIVE" }, { status: 404 }); try { let value; if (body.action === "open") value = await state.open(agent, body.environment); else if (body.action === "send") value = await state.send(agent, body.session, body); else if (body.action === "sftp") value = await state.sftp(agent, body.environment, body.operation, body); else if (body.action === "environment.delete") value = await state.deleteEnvironment(agent, body.environment); else throw new Error(`Unknown action: ${body.action}`); return Response.json(value ?? { ok: true }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ error: summarizeError(error), code: error?.code }, { status: 400 }); } } }), "dsh-remote-ops action route");

}

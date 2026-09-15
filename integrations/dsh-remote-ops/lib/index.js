import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client as SshClient } from "ssh2";
import { PLUGIN_NAME, PLUGIN_VERSION, RELEASE_REPOSITORY } from "./version.js";

export const name = PLUGIN_NAME;
export const inject = ["connection", "systemPrompt", "tools", "terminals", "agents", "credentials", "subprocess"];

const ROOT = "remote-ops";
const LOCAL_SESSION_ID = "local-cmd";
const LOCAL_SESSION_NAME = "本地 CMD";
const MAX_SCROLLBACK_BYTES = 4 * 1024 * 1024;
const RETAINED_SCROLLBACK_BYTES = 3 * 1024 * 1024;
const UI_SCROLLBACK_CHARS = 256 * 1024;
const MAX_SFTP_BYTES = 2 * 1024 * 1024;
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const TERMINAL_ENCODINGS = new Set(["utf-8", "gb18030", "big5", "windows-1252", "iso-8859-1"]);
function normalizeTerminalEncoding(value) {
  const normalized = String(value ?? "utf-8").trim().toLowerCase();
  return TERMINAL_ENCODINGS.has(normalized) ? normalized : "utf-8";
}
const CREDENTIAL_REF_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function defaultPasswordRef(environmentId) {
  const suffix = String(environmentId ?? "").trim().replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `DSH_REMOTE_OPS_${suffix || "ENV"}_PASSWORD`;
}
function resolveRemoteHome() { const configured = process.env.DSH_HOME?.trim(); return configured ? configured.replace(/^~(?=[\\/])/, homedir()) : join(homedir(), ".dsh"); }

export class TerminalOutputBuffer {
  constructor(maxBytes = MAX_SCROLLBACK_BYTES, retainedBytes = RETAINED_SCROLLBACK_BYTES) {
    this.maxBytes = maxBytes;
    this.retainedBytes = Math.min(retainedBytes, maxBytes);
    this.value = "";
    this.byteLength = 0;
    this.startOffset = 0;
    this.revision = 0;
    this.waiters = new Set();
  }

  get length() { return this.value.length; }
  get endOffset() { return this.startOffset + this.value.length; }
  slice(start, end) { return this.value.slice(start, end); }

  append(value) {
    const text = String(value ?? "");
    if (!text) return;
    this.value += text;
    this.byteLength += Buffer.byteLength(text, "utf8");
    this.revision += 1;
    if (this.byteLength > this.maxBytes) {
      const encoded = Buffer.from(this.value, "utf8");
      let byteStart = Math.max(0, encoded.length - this.retainedBytes);
      while (byteStart < encoded.length && (encoded[byteStart] & 0xc0) === 0x80) byteStart += 1;
      const retained = encoded.subarray(byteStart).toString("utf8");
      this.startOffset += this.value.length - retained.length;
      this.value = retained;
      this.byteLength = Buffer.byteLength(retained, "utf8");
    }
    this.notify();
  }

  tail(maxChars = UI_SCROLLBACK_CHARS) {
    return this.value.slice(Math.max(0, this.value.length - maxChars));
  }

  readFrom(offset, maxChars = UI_SCROLLBACK_CHARS) {
    const endOffset = this.endOffset;
    const minimumOffset = Math.max(this.startOffset, endOffset - maxChars);
    const validOffset = Number.isSafeInteger(offset) && offset >= minimumOffset && offset <= endOffset;
    const startOffset = validOffset ? offset : minimumOffset;
    return {
      text: this.value.slice(startOffset - this.startOffset),
      startOffset,
      nextOffset: endOffset,
      reset: !validOffset,
      revision: this.revision,
    };
  }

  notify() {
    for (const finish of this.waiters) finish();
    this.waiters.clear();
  }

  waitForChange(offset, timeoutMs = 20_000, signal) {
    if (!Number.isSafeInteger(offset) || offset !== this.endOffset || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        this.waiters.delete(finish);
        resolve();
      };
      timer = setTimeout(finish, timeoutMs);
      signal?.addEventListener("abort", finish, { once: true });
      this.waiters.add(finish);
    });
  }
}

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
  if (typeof value.passwordRef === "string" && value.passwordRef !== "" && !CREDENTIAL_REF_RE.test(value.passwordRef)) errors.push("passwordRef must be a valid Harness credential reference");
  if (value.encoding !== undefined && !TERMINAL_ENCODINGS.has(String(value.encoding).trim().toLowerCase())) errors.push("encoding must be one of utf-8, gb18030, big5, windows-1252 or iso-8859-1");
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

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
const UPDATE_CACHE_MS = 10 * 60 * 1000;

function parseVersion(value) {
  const match = VERSION_RE.exec(String(value ?? "").trim());
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), value: `${match[1]}.${match[2]}.${match[3]}` } : undefined;
}

function compareVersions(left, right) {
  const a = parseVersion(left) ?? { major: 0, minor: 0, patch: 0 };
  const b = parseVersion(right) ?? { major: 0, minor: 0, patch: 0 };
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

async function fetchLatestRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json", "User-Agent": PLUGIN_NAME }, signal: controller.signal });
    if (!response.ok) throw sessionError("UPDATE_CHECK_FAILED", `GitHub release API returned HTTP ${response.status}`);
    const payload = await response.json();
    const version = parseVersion(String(payload.tag_name ?? "").replace(/^dsh-remote-ops-v/, ""));
    if (!version) throw sessionError("UPDATE_METADATA_INVALID", "Latest release tag does not contain a valid plugin version");
    const assetName = `dsh-remote-ops-v${version.value}.tgz`;
    const asset = Array.isArray(payload.assets) ? payload.assets.find((item) => item?.name === assetName && typeof item.browser_download_url === "string") : undefined;
    if (!asset) throw sessionError("UPDATE_ASSET_MISSING", `Latest release does not contain ${assetName}`);
    return { currentVersion: PLUGIN_VERSION, latestVersion: version.value, updateAvailable: compareVersions(version.value, PLUGIN_VERSION) > 0, releaseUrl: payload.html_url, assetUrl: asset.browser_download_url, assetName, publishedAt: payload.published_at ?? null };
  } catch (error) {
    if (error?.name === "AbortError") throw sessionError("UPDATE_CHECK_TIMEOUT", "GitHub release check timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function findProfileRoot() {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let current = resolve(start);
    for (let depth = 0; depth < 10; depth += 1) {
      const manifest = await readFile(join(current, "package.json"), "utf8").then((value) => JSON.parse(value)).catch(() => undefined);
      if (manifest?.dsh?.profile?.bundles && manifest?.dependencies?.["@dsh/remote-ops"]) return current;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw sessionError("UPDATE_PROFILE_NOT_FOUND", "Unable to locate the active DSH profile package.json");
}

function runPnpm(cwd, args) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const append = (target, chunk) => {
      const value = target + chunk.toString("utf8");
      return value.length > 24_000 ? value.slice(-24_000) : value;
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", reject);
    child.once("close", (code, signal) => resolvePromise({ code: code ?? 1, signal, stdout, stderr }));
  });
}

class SendOperation {
  constructor(session, request) {
    this.session = session;
    this.request = request;
    this.startedAt = Date.now();
    this.startOffset = session.outputBuffer.endOffset;
    this.cancelled = false;
    this.output = { consume: () => session.outputBuffer.readFrom(this.startOffset, Number.MAX_SAFE_INTEGER).text };
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.session.active = this;
    this.timer = setTimeout(() => this.finish("timeout"), Math.min(request.timeoutMs ?? 30_000, 300_000));
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
      output: this.session.outputBuffer.readFrom(this.startOffset, Number.MAX_SAFE_INTEGER).text,
      viewport: this.session.outputBuffer.tail(64 * 1024),
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
    try { void this.session.write("\u0003"); } catch { /* session may already be closed */ }
    this.finish("cancelled");
    return true;
  }

  get donePromise() { return this.promise; }
  get done() { return this.promise; }
  readOutput() { return { delta: this.session.outputBuffer.readFrom(this.startOffset, Number.MAX_SAFE_INTEGER).text, truncated: false }; }
}

class SshTerminalSession {
  constructor(client, channel, environment) {
    this.client = client;
    this.channel = channel;
    this.environment = environment;
    this.outputBuffer = new TerminalOutputBuffer();
    this.decoder = new TextDecoder(normalizeTerminalEncoding(environment.encoding), { fatal: false });
    this.closed = false;
    this.exitCode = undefined;
    this.lastActivity = Date.now();
    this.motd = "";
    channel.on("data", (chunk) => this.append(this.decoder.decode(chunk, { stream: true })));
    channel.stderr?.on("data", (chunk) => this.append(this.decoder.decode(chunk, { stream: true })));
    channel.on("exit", (code, signal) => { this.exitCode = code ?? null; this.exitSignal = signal ?? null; });
    channel.on("close", () => {
      this.closed = true;
      this.outputBuffer.notify();
      if (this.active) this.active.finish("session_exit");
    });
  }

  append(text) {
    if (!text) return;
    this.outputBuffer.append(text);
    this.lastActivity = Date.now();
  }

  get output() { return this.outputBuffer.value; }

  startSend(request) {
    if (this.closed) throw sessionError("REMOTE_SESSION_EXITED", "SSH session has exited");
    if (this.active) throw sessionError("SEND_ACTIVE", "SSH session already has an active send");
    return new SendOperation(this, request);
  }

  write(text) {
    if (this.closed) throw sessionError("REMOTE_SESSION_EXITED", "SSH session has exited");
    const value = String(text ?? "");
    if (!value) return;
    this.channel.write(value, "utf8");
  }

  writeInput(text) {
    if (this.closed) throw sessionError("REMOTE_SESSION_EXITED", "SSH session has exited");
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

class LocalCmdTerminalSession {
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
    this.onClose?.();
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

class AdoptedTerminalSession {
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

export class RemoteOpsState {
  constructor(ctx) {
    this.ctx = ctx;
    this.base = join(resolveRemoteHome(), ROOT);
    this.environmentRoot = join(this.base, "environments");
    this.quickRoot = join(this.base, "quick-commands");
    this.environments = new Map();
    this.quickCommands = [];
    this.quickGroups = new Set();
    this.sessions = new Map();
    this.events = new Map();
    this.backendSessions = new Map();
    this.directEnvironments = new Map();
    this.openings = new Map();
    this.localSession = undefined;
    this.localStarting = undefined;
    this.localError = "";
    this.disposed = false;
    this.release = { currentVersion: PLUGIN_VERSION, latestVersion: PLUGIN_VERSION, updateAvailable: false };
    this.releaseCheckedAt = 0;
    this.releaseCheckPromise = undefined;
    this.ready = this.load();
  }

  async load() {
    await mkdir(this.base, { recursive: true });
    await mkdir(this.environmentRoot, { recursive: true });
    await mkdir(this.quickRoot, { recursive: true });
    const environmentDirs = await readdir(this.environmentRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of environmentDirs.filter((item) => item.isDirectory())) {
      const group = normalizeGroupName(entry.name);
      const data = await this.readJson(this.envFile(group), []);
      this.environments.set(group, Array.isArray(data) ? data.filter((item) => validateEnvironment(item).ok) : []);
    }
    const quickDirs = await readdir(this.quickRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of quickDirs.filter((item) => item.isDirectory())) {
      const group = normalizeGroupName(entry.name);
      this.quickGroups.add(group);
      const data = await this.readJson(this.quickFile(group), []);
      if (Array.isArray(data)) this.quickCommands.push(...data.filter((item) => item && typeof item.id === "string"));
    }
    await this.ensureLocalSession().catch((error) => { this.localError = summarizeError(error); });
  }

  async readJson(path, fallback) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; } }
  groupDir(group) { return join(this.environmentRoot, normalizeGroupName(group)); }
  envFile(group) { const safe = normalizeGroupName(group); return join(this.groupDir(safe), `environments.${safe}.json`); }
  quickGroupDir(group) { return join(this.quickRoot, normalizeGroupName(group)); }
  quickFile(group) { const safe = normalizeGroupName(group); return join(this.quickGroupDir(safe), `commands.${safe}.json`); }

  async saveGroup(group) { const safe = normalizeGroupName(group); await mkdir(this.groupDir(safe), { recursive: true }); await writeFile(this.envFile(safe), `${JSON.stringify(this.environments.get(safe) ?? [], null, 2)}\n`, "utf8"); }
  async saveQuickGroup(group) { const safe = normalizeGroupName(group); await mkdir(this.quickGroupDir(safe), { recursive: true }); const values = this.quickCommands.filter((item) => normalizeGroupName(item.group) === safe); await writeFile(this.quickFile(safe), `${JSON.stringify(values, null, 2)}\n`, "utf8"); }

  groupList() { return [...this.environments.keys()].sort((a, b) => a.localeCompare(b)); }
  quickGroupList() { return [...this.quickGroups].sort((a, b) => a.localeCompare(b)); }
  async createGroup(name) { const group = normalizeGroupName(name); if (this.environments.has(group)) throw sessionError("REMOTE_GROUP_EXISTS", `Environment group already exists: ${group}`); this.environments.set(group, []); await this.saveGroup(group); return { group }; }
  async renameGroup(from, to) { const source = normalizeGroupName(from); const target = normalizeGroupName(to); if (!this.environments.has(source)) throw sessionError("REMOTE_GROUP_NOT_FOUND", source); if (source === target) return { group: target }; if (this.environments.has(target)) throw sessionError("REMOTE_GROUP_EXISTS", target); this.environments.set(target, (this.environments.get(source) ?? []).map((item) => ({ ...item, group: target }))); this.environments.delete(source); await this.saveGroup(target); await rm(this.groupDir(source), { recursive: true, force: true }); return { group: target }; }
  async deleteGroup(name) { const group = normalizeGroupName(name); const values = this.environments.get(group); if (!values) throw sessionError("REMOTE_GROUP_NOT_FOUND", group); if (values.length) throw sessionError("REMOTE_GROUP_NOT_EMPTY", `Environment group is not empty: ${group}`); this.environments.delete(group); await rm(this.groupDir(group), { recursive: true, force: true }); return { deleted: true, group }; }
  async saveEnvironment(value) { const group = normalizeGroupName(value.group); const previous = this.findEnvironment(value.id); const previousGroups = []; for (const [name, list] of this.environments) { const next = list.filter((item) => item.id !== value.id); if (next.length !== list.length) { this.environments.set(name, next); previousGroups.push(name); } } if (!this.environments.has(group)) this.environments.set(group, []); const saved = { ...previous, ...value, group }; this.environments.set(group, [...this.environments.get(group), saved]); for (const name of new Set([...previousGroups, group])) await this.saveGroup(name); return this.findEnvironment(value.id); }
  async createQuickGroup(name) { const group = normalizeGroupName(name); if (this.quickGroups.has(group)) throw sessionError("REMOTE_QUICK_GROUP_EXISTS", `Quick command group already exists: ${group}`); this.quickGroups.add(group); await this.saveQuickGroup(group); return { group }; }
  async renameQuickGroup(from, to) { const source = normalizeGroupName(from); const target = normalizeGroupName(to); if (!this.quickGroups.has(source)) throw sessionError("REMOTE_QUICK_GROUP_NOT_FOUND", source); if (this.quickGroups.has(target)) throw sessionError("REMOTE_QUICK_GROUP_EXISTS", target); this.quickGroups.delete(source); this.quickGroups.add(target); this.quickCommands = this.quickCommands.map((item) => normalizeGroupName(item.group) === source ? { ...item, group: target } : item); await this.saveQuickGroup(target); await rm(this.quickGroupDir(source), { recursive: true, force: true }); return { group: target }; }
  async deleteQuickGroup(name) { const group = normalizeGroupName(name); if (!this.quickGroups.has(group)) throw sessionError("REMOTE_QUICK_GROUP_NOT_FOUND", group); if (this.quickCommands.some((item) => normalizeGroupName(item.group) === group)) throw sessionError("REMOTE_QUICK_GROUP_NOT_EMPTY", `Quick command group is not empty: ${group}`); this.quickGroups.delete(group); await rm(this.quickGroupDir(group), { recursive: true, force: true }); return { deleted: true, group }; }
  async saveQuickCommand(value) { const group = normalizeGroupName(value.group); const previous = this.quickCommands.find((item) => item.id === value.id); this.quickGroups.add(group); this.quickCommands = [...this.quickCommands.filter((item) => item.id !== value.id), { ...value, group }]; for (const name of new Set([group, previous?.group].filter(Boolean))) await this.saveQuickGroup(name); return value; }
  async deleteQuickCommand(id) { const value = this.quickCommands.find((item) => item.id === id); if (!value) throw sessionError("REMOTE_QUICK_COMMAND_NOT_FOUND", id); this.quickCommands = this.quickCommands.filter((item) => item.id !== id); await this.saveQuickGroup(value.group); return { deleted: true, id }; }

  async checkForUpdate(force = false) {
    if (!force && Date.now() - this.releaseCheckedAt < UPDATE_CACHE_MS) return this.release;
    if (this.releaseCheckPromise) return this.releaseCheckPromise;
    this.releaseCheckPromise = fetchLatestRelease().then((value) => { this.release = value; this.releaseCheckedAt = Date.now(); return value; }).finally(() => { this.releaseCheckPromise = undefined; });
    return this.releaseCheckPromise;
  }

  async upgrade() {
    const release = await this.checkForUpdate(true);
    if (!release.updateAvailable) return { ...release, updated: false, restartRequired: false };
    const profileRoot = await findProfileRoot();
    const result = await runPnpm(profileRoot, ["add", release.assetUrl, "--save-prod"]);
    if (result.code !== 0) throw sessionError("UPDATE_INSTALL_FAILED", `pnpm add ${release.assetName} exited with code ${result.code}`, result.stderr || result.stdout);
    this.release = { ...release, updated: true, restartRequired: true, profileRoot: "active DSH profile" };
    return { ...this.release, command: `pnpm add ${release.assetName} --save-prod`, output: result.stdout || result.stderr };
  }

  allEnvironments() { return [...this.environments.entries()].flatMap(([group, values]) => values.map((value) => ({ ...value, group }))); }
  localSnapshot() {
    const session = this.localSession;
    if (!session || session.status().kind === "exited") return undefined;
    return { sessionId: LOCAL_SESSION_ID, name: session.environment.name, kind: "local", status: session.status(), workingDirectory: this.base };
  }
  catalog() {
    const local = this.localSnapshot();
    return {
      groups: this.groupList(),
      environments: this.allEnvironments().map((value) => ({ ...value, passwordRef: value.passwordRef ? "configured" : undefined, active: false })),
      quickGroups: this.quickGroupList(),
      quickCommands: this.quickCommands,
      sessions: local ? [local] : [],
      events: [],
      bound: false,
      localError: this.localError || undefined,
      pluginName: PLUGIN_NAME,
      pluginVersion: PLUGIN_VERSION,
      update: this.release,
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
    this.reconcileHostSessions(owner);
    const local = this.localSnapshot();
    const remoteSessions = [...this.sessions.values()].filter((x) => x.ownerId === id && x.session.status().kind !== "exited").map((x) => ({ sessionId: x.sessionId, environmentId: x.environment.id, name: x.environment.name, kind: "ssh", status: x.session.status() }));
    const sessions = [...(local ? [local] : []), ...remoteSessions];
    return { groups: this.groupList(), environments: this.allEnvironments().map((x) => ({ ...x, passwordRef: x.passwordRef ? "configured" : undefined, active: remoteSessions.some((s) => s.environmentId === x.id) })), quickGroups: this.quickGroupList(), quickCommands: this.quickCommands, sessions, events: this.events.get(id) ?? [], localError: this.localError || undefined, pluginName: PLUGIN_NAME, pluginVersion: PLUGIN_VERSION, update: this.release };
  }

  async terminalOutput(owner, target, offset, waitMs = 0, signal) {
    let session;
    let environmentId;
    let name;
    let kind;
    if (target === LOCAL_SESSION_ID) {
      session = await this.ensureLocalSession();
      name = session.environment.name;
      kind = "local";
    } else {
      const record = this.getSession(owner, target);
      session = record.session;
      environmentId = record.environment.id;
      name = record.environment.name;
      kind = "ssh";
    }
    if (session instanceof AdoptedTerminalSession) {
      await session.refresh();
      if (waitMs > 0 && session.outputBuffer.readFrom(offset).text === "") await session.waitForChange(waitMs, signal);
    } else if (waitMs > 0) await session.outputBuffer.waitForChange(offset, waitMs, signal);
    return {
      sessionId: target,
      environmentId,
      name,
      kind,
      status: session.status(),
      ...session.outputBuffer.readFrom(offset),
    };
  }

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

  async resolvePassword(environment) {
    if (!environment.passwordRef) return undefined;
    const credentials = this.ctx.credentials;
    if (!credentials?.resolve) throw sessionError("REMOTE_CREDENTIALS_UNAVAILABLE", "Harness credentials service is not available");
    const result = await credentials.resolve(environment.passwordRef);
    return result?.value;
  }

  async storePassword(reference, password) {
    const ref = String(reference ?? "").trim();
    if (!CREDENTIAL_REF_RE.test(ref)) throw sessionError("REMOTE_CREDENTIAL_REF_INVALID", `Invalid Harness credential reference: ${ref || "<empty>"}`);
    const secret = String(password ?? "");
    if (!secret) throw sessionError("REMOTE_PASSWORD_EMPTY", "SSH password cannot be empty");
    const credentials = this.ctx.credentials;
    if (!credentials?.set) throw sessionError("REMOTE_CREDENTIALS_UNAVAILABLE", "Harness credentials service is not available");
    await credentials.set(ref, secret);
    return ref;
  }

  async spawnBackend(spec) {
    await this.ready;
    const environment = spec.environment ?? this.directEnvironments.get(spec.name) ?? this.findEnvironment(spec.name);
    if (!environment) throw sessionError("REMOTE_ENV_NOT_FOUND", `Environment not found: ${spec.name}`);
    const client = new SshClient();
    const config = { host: environment.host, port: environment.port ?? 22, username: environment.username, readyTimeout: environment.readyTimeoutMs ?? 15_000, keepaliveInterval: 10_000, keepaliveCountMax: 3 };
    try {
      if (environment.privateKeyPath) config.privateKey = await readFile(environment.privateKeyPath);
      const password = await this.resolvePassword(environment);
      if (password) config.password = password;
      const channel = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(sessionError("SSH_CONNECT_TIMEOUT", `SSH connection timed out: ${environment.host}:${config.port}`)), config.readyTimeout);
        client.once("ready", () => client.shell({ term: "xterm-256color", rows: 40, cols: 160 }, (error, stream) => { clearTimeout(timer); if (error) reject(error); else { stream.write("export LANG=C.UTF-8 LC_ALL=C.UTF-8 LC_CTYPE=C.UTF-8\r"); resolve(stream); } }));
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
    const key = `${id}:${environment.id}`;
    const existingOpening = this.openings.get(key);
    if (existingOpening) return existingOpening;
    const opening = (async () => {
      const existing = [...this.sessions.values()].find((x) => x.ownerId === id && x.environment.id === environment.id && x.session.status().kind !== "exited");
      if (existing) return existing;
      const adopted = this.reconcileHostSessions(owner).find((x) => x.environment.id === environment.id);
      if (adopted) return adopted;
      const spawned = await this.ctx.terminals.spawn(owner, { type: "ssh", name: environment.id });
      const session = this.backendSessions.get(spawned.sessionId);
      if (!session) throw new Error("SSH backend did not return a session");
      const record = { sessionId: spawned.sessionId, ownerId: id, owner, environment, session };
      this.sessions.set(record.sessionId, record);
      this.event(owner, "ssh.open", { sessionId: record.sessionId, environment: environment.name });
      return record;
    })();
    this.openings.set(key, opening);
    try { return await opening; } finally { if (this.openings.get(key) === opening) this.openings.delete(key); }
  }

  reconcileHostSessions(owner) {
    if (typeof this.ctx.terminals?.list !== "function") return [];
    const id = ownerId(owner);
    const hostSessions = this.ctx.terminals.list(owner);
    const liveIds = new Set();
    for (const snapshot of hostSessions) {
      if (snapshot?.type !== "ssh" || snapshot.status?.kind === "exited") continue;
      const environment = this.findEnvironment(snapshot.name);
      if (!environment) continue;
      liveIds.add(snapshot.sessionId);
      const current = this.sessions.get(snapshot.sessionId);
      if (current) continue;
      this.sessions.set(snapshot.sessionId, { sessionId: snapshot.sessionId, ownerId: id, owner, environment, session: new AdoptedTerminalSession(this.ctx, owner, snapshot), adopted: true });
      this.event(owner, "ssh.reconciled", { sessionId: snapshot.sessionId, environment: environment.name });
    }
    for (const [sessionId, record] of this.sessions) {
      if (record.ownerId === id && record.adopted && !liveIds.has(sessionId)) this.sessions.delete(sessionId);
    }
    return [...this.sessions.values()].filter((record) => record.ownerId === id && record.session.status().kind !== "exited");
  }

  async openDirect(owner, spec) {
    await this.ready;
    const host = String(spec?.host ?? "").trim();
    const username = String(spec?.username ?? "").trim();
    const port = Number(spec?.port ?? 22);
    if (!host || !username || !Number.isInteger(port) || port < 1 || port > 65535) throw sessionError("REMOTE_SSH_COMMAND_INVALID", "SSH command must include a valid host, username and port");
    const id = ownerId(owner);
    const existing = [...this.sessions.values()].find((x) => x.ownerId === id && x.environment.host === host && x.environment.username === username && Number(x.environment.port ?? 22) === port && x.session.status().kind !== "exited");
    if (existing) return existing;
    const environment = { id: `direct-${Date.now().toString(36)}`, name: `${username}@${host}:${port}`, host, username, port };
    if (spec.privateKeyPath) environment.privateKeyPath = String(spec.privateKeyPath).trim();
    const validation = validateEnvironment(environment);
    if (!validation.ok) throw sessionError("REMOTE_SSH_COMMAND_INVALID", validation.errors.join(", "));
    this.directEnvironments.set(environment.id, environment);
    let spawned;
    try { spawned = await this.ctx.terminals.spawn(owner, { type: "ssh", name: environment.id }); } finally { this.directEnvironments.delete(environment.id); }
    const session = this.backendSessions.get(spawned.sessionId);
    if (!session) throw new Error("SSH backend did not return a session");
    const record = { sessionId: spawned.sessionId, ownerId: id, owner, environment, session, direct: true };
    this.sessions.set(record.sessionId, record);
    this.event(owner, "ssh.open.direct", { sessionId: record.sessionId, environment: environment.name });
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
    const ownerKey = owner ? ownerId(owner) : undefined;
    for (const record of [...this.sessions.values()]) {
      if (record.environment.id === target.id && (!ownerKey || record.ownerId === ownerKey)) {
        await this.ctx.terminals.kill(record.owner, record.sessionId, "environment deleted").catch(() => {});
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
    if (target === LOCAL_SESSION_ID) {
      const session = await this.ensureLocalSession();
      const submittedText = String(args.text ?? args.command ?? "");
      const submit = args.submit ?? args.newline ?? true;
      const text = `${submittedText}${submit ? "\r" : ""}`;
      const result = await session.writeInput(text);
      return { sessionId: LOCAL_SESSION_ID, environment: session.environment.name, submittedText, submit, status: session.status(), viewport: session.outputBuffer.tail(64 * 1024), ...result };
    }
    const record = target ? this.getSession(owner, target) : await this.open(owner, args.environment);
    const submittedText = String(args.text ?? args.command ?? "");
    const submit = args.submit ?? args.newline ?? true;
    const operation = this.ctx.terminals.startSend(owner, record.sessionId, { text: submittedText, submit, quietMs: args.quietMs, timeoutMs: (args.timeoutSeconds ?? 30) * 1000, signal: args.signal });
    const result = await operation.done;
    this.event(owner, "ssh.send", { sessionId: record.sessionId, environment: record.environment.name, inputChars: submittedText.length, waitReason: result.waitReason });
    return { sessionId: record.sessionId, environment: record.environment.name, submittedText, submit, ...result };
  }

  async input(owner, target, text) {
    if (target === LOCAL_SESSION_ID) {
      const session = await this.ensureLocalSession();
      const result = await session.writeInput(text);
      return { sessionId: LOCAL_SESSION_ID, environment: session.environment.name, ...result };
    }
    const record = this.getSession(owner, target);
    const result = record.session.writeInput(text);
    this.event(owner, "ssh.input", { sessionId: record.sessionId, environment: record.environment.name, inputBytes: result.bytes });
    return { sessionId: record.sessionId, environment: record.environment.name, ...result };
  }

  async signal(owner, target, signal) {
    if (target === LOCAL_SESSION_ID) {
      const session = await this.ensureLocalSession();
      return { sessionId: LOCAL_SESSION_ID, ...await session.signal(signal) };
    }
    const record = this.getSession(owner, target);
    return { sessionId: record.sessionId, ...await record.session.signal(signal) };
  }

  async close(owner, target) {
    const record = this.getSession(owner, target);
    await this.ctx.terminals.kill(owner, record.sessionId, "closed by user");
    this.sessions.delete(record.sessionId);
    return { closed: true, sessionId: record.sessionId };
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
    state.disposed = true;
    await state.localSession?.close("dsh-remote-ops disposed").catch(() => {});
    for (const record of state.sessions.values()) await ctx.terminals.kill(record.owner, record.sessionId, "dsh-remote-ops disposed").catch(() => {});
    state.sessions.clear();
  }, "dsh-remote-ops cleanup");
  ctx.effect(() => ctx.terminals.registerBackend({ type: "ssh", spawn: (spec) => state.spawnBackend(spec) }), "dsh-remote-ops SSH backend");

  ctx.systemPrompt.section({
    name: "dsh-remote-ops",
    order: 410,
    text: "Remote operations are provided by dsh-remote-ops. Use remote_environment_list when the target is ambiguous. Use remote_terminal_open/send/read for SSH work and preserve command spaces exactly. Prefer one complete command or a short batch when the command is known; use incremental reads only when live terminal state is needed. remote_terminal_send returns submittedText and submit so you can verify the exact bytes requested; do not resend a command merely because the terminal echoes it in the viewport. Use remote_terminal_input for raw interactive keys such as Tab, arrows, passwords, and Ctrl+C without waiting for a result. For multiple SSH targets, name each target explicitly, execute sequentially, observe the result, and only then continue. Product CLI knowledge may come from MCP, but MCP results are knowledge/validation, not a substitute for executing through the remote terminal. Never invent credentials or claim a connection succeeded without an observed result.",
  });

  const owner = (exec) => exec.agent;
  registerTool(ctx, { name: "remote_environment_list", description: "List saved SSH environments and active owner-scoped sessions.", parameters: {}, execute: async (_args, exec) => { await state.ready; return state.snapshot(owner(exec)); } });
  registerTool(ctx, { name: "remote_environment_create", description: "Create or replace one saved SSH environment. Use passwordRef instead of plaintext passwords.", parameters: { id: stringParam("Stable environment id", true), name: stringParam("Display name", true), host: stringParam("SSH host", true), username: stringParam("SSH username", true), group: stringParam("Environment group"), port: numberParam("SSH port"), privateKeyPath: stringParam("Local private key path"), passwordRef: stringParam("Harness credential reference") }, execute: async (args, exec) => { await state.ready; const value = { ...args, group: normalizeGroupName(args.group) }; const validation = validateEnvironment(value); if (!validation.ok) throw sessionError("REMOTE_ENV_INVALID", validation.errors.join(", ")); const saved = await state.saveEnvironment(value); state.event(owner(exec), "environment.create", { environment: value.name }); return { saved: true, environment: { ...saved, passwordRef: saved.passwordRef ? "configured" : undefined } }; } });
  registerTool(ctx, { name: "remote_environment_group_create", description: "Create an empty saved SSH environment group.", parameters: { group: stringParam("Environment group", true) }, execute: async (args) => state.createGroup(args.group) });
  registerTool(ctx, { name: "remote_environment_group_rename", description: "Rename a saved SSH environment group.", parameters: { group: stringParam("Existing group", true), name: stringParam("New group name", true) }, execute: async (args) => state.renameGroup(args.group, args.name) });
  registerTool(ctx, { name: "remote_environment_group_delete", description: "Delete an empty saved SSH environment group.", parameters: { group: stringParam("Environment group", true) }, execute: async (args) => state.deleteGroup(args.group) });
  registerTool(ctx, { name: "remote_environment_delete", description: "Delete a saved SSH environment and close its owner sessions.", parameters: { environment: stringParam("Environment id or name", true) }, execute: async (args, exec) => state.deleteEnvironment(owner(exec), args.environment) });
  registerTool(ctx, { name: "remote_terminal_open", description: "Open or reuse an SSH terminal for an environment.", parameters: { environment: stringParam("Environment id or name", true) }, execute: async (_args, exec) => { const record = await state.open(owner(exec), _args.environment); return { sessionId: record.sessionId, environment: record.environment.name, status: record.session.status(), viewport: record.session.output.slice(-64 * 1024) }; } });
  registerTool(ctx, { name: "remote_terminal_send", description: "Send one complete command to an owner-scoped SSH terminal and wait for output. The result echoes submittedText and submit; preserve every separator in text and do not resend only because the terminal echoes the command.", parameters: { session: stringParam("Session id or environment id"), environment: stringParam("Environment id or name when opening on demand"), text: stringParam("Input text; preserve every separator", true), submit: boolParam("Append Enter; defaults true"), quietMs: numberParam("Quiet completion window in milliseconds"), timeoutSeconds: numberParam("Timeout in seconds") }, execute: async (args, exec) => state.send(owner(exec), args.session, args) });
  registerTool(ctx, { name: "remote_terminal_input", description: "Write raw terminal input immediately without waiting. Use for Tab completion, arrow keys, password prompts, interactive programs, or control characters.", parameters: { session: stringParam("Session id or environment id", true), text: stringParam("Raw UTF-8 terminal input", true) }, execute: async (args, exec) => state.input(owner(exec), args.session, args.text) });
  registerTool(ctx, { name: "remote_terminal_read", description: "Read bounded retained output from an SSH terminal.", parameters: { session: stringParam("Session id or environment id", true), offset: numberParam("Newest-relative line offset"), count: numberParam("Line count") }, execute: async (args, exec) => { const record = state.getSession(owner(exec), args.session); return { sessionId: record.sessionId, environment: record.environment.name, ...ctx.terminals.read(owner(exec), record.sessionId, args) }; } });
  registerTool(ctx, { name: "remote_terminal_signal", description: "Send an interrupt or allowed signal to the SSH foreground process.", parameters: { session: stringParam("Session id or environment id", true), signal: stringParam("Signal such as SIGINT or SIGTERM", true) }, execute: async (args, exec) => { const record = state.getSession(owner(exec), args.session); return { sessionId: record.sessionId, ...ctx.terminals.signal(owner(exec), record.sessionId, args.signal) }; } });
  registerTool(ctx, { name: "remote_terminal_close", description: "Close an owner-scoped SSH terminal.", parameters: { session: stringParam("Session id", true) }, execute: async (args, exec) => { const record = state.getSession(owner(exec), args.session); await ctx.terminals.kill(owner(exec), record.sessionId, "agent request"); state.sessions.delete(record.sessionId); return { closed: true, sessionId: record.sessionId }; } });
  registerTool(ctx, { name: "remote_terminal_batch", description: "Execute complete commands sequentially on one or more explicit SSH environments and return each result.", parameters: { targets: { type: "array", required: true, items: { type: "string" }, description: "Environment ids or names" }, commands: { type: "array", required: true, items: { type: "string" }, description: "Complete commands in order" }, timeoutSeconds: numberParam("Per-command timeout") }, execute: async (args, exec) => { const results = []; for (const target of args.targets) { const targetResults = []; for (const command of args.commands) targetResults.push(await state.send(owner(exec), undefined, { environment: target, text: command, submit: true, timeoutSeconds: args.timeoutSeconds })); results.push({ target, results: targetResults }); } return { results }; } });
  registerTool(ctx, { name: "remote_quick_command_list", description: "List saved quick commands and groups.", parameters: {}, execute: async () => { await state.ready; return { groups: state.quickGroupList(), commands: state.quickCommands }; } });
  registerTool(ctx, { name: "remote_quick_command_save", description: "Create or replace a saved quick command. The command can contain multiple lines.", parameters: { id: stringParam("Stable command id", true), name: stringParam("Display name", true), command: stringParam("Complete command text", true), group: stringParam("Quick command group") }, execute: async (args) => state.saveQuickCommand({ ...args, group: normalizeGroupName(args.group) }) });
  registerTool(ctx, { name: "remote_quick_command_delete", description: "Delete a saved quick command.", parameters: { commandId: stringParam("Quick command id", true) }, execute: async (args) => state.deleteQuickCommand(args.commandId) });
  registerTool(ctx, { name: "remote_quick_command_group_create", description: "Create an empty quick command group.", parameters: { group: stringParam("Quick command group", true) }, execute: async (args) => state.createQuickGroup(args.group) });
  registerTool(ctx, { name: "remote_quick_command_group_delete", description: "Delete an empty quick command group.", parameters: { group: stringParam("Quick command group", true) }, execute: async (args) => state.deleteQuickGroup(args.group) });
  registerTool(ctx, { name: "remote_quick_command_run", description: "Run a saved quick command on one explicit environment.", parameters: { commandId: stringParam("Quick command id", true), environment: stringParam("Environment id or name", true) }, execute: async (args, exec) => { await state.ready; const command = state.quickCommands.find((x) => x.id === args.commandId); if (!command) throw sessionError("REMOTE_QUICK_COMMAND_NOT_FOUND", args.commandId); return state.send(owner(exec), undefined, { environment: args.environment, text: command.command, submit: true }); } });
  registerTool(ctx, { name: "remote_sftp_list", description: "List a remote SFTP directory.", parameters: { environment: stringParam("Environment id or name", true), path: stringParam("Remote path") }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "list", args) });
  registerTool(ctx, { name: "remote_sftp_read", description: "Read a bounded UTF-8 remote SFTP file.", parameters: { environment: stringParam("Environment id or name", true), path: stringParam("Remote path", true) }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "read", args) });
  registerTool(ctx, { name: "remote_sftp_write", description: "Write a UTF-8 remote SFTP file.", parameters: { environment: stringParam("Environment id or name", true), path: stringParam("Remote path", true), content: stringParam("UTF-8 file content", true) }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "write", args) });
  registerTool(ctx, { name: "remote_sftp_mkdir", description: "Create a remote SFTP directory.", parameters: { environment: stringParam("Environment id or name", true), path: stringParam("Remote path", true) }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "mkdir", args) });
  registerTool(ctx, { name: "remote_sftp_delete", description: "Delete a remote SFTP file or directory.", parameters: { environment: stringParam("Environment id or name", true), path: stringParam("Remote path", true) }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "delete", args) });
  registerTool(ctx, { name: "remote_sftp_rename", description: "Rename a remote SFTP file or directory.", parameters: { environment: stringParam("Environment id or name", true), from: stringParam("Existing path", true), to: stringParam("New path", true) }, execute: async (args, exec) => state.sftp(owner(exec), args.environment, "rename", args) });
  registerTool(ctx, { name: "remote_diagnostics", description: "Read recent remote operation diagnostics for this Agent.", parameters: {}, execute: async (_args, exec) => ({ events: state.events.get(ownerId(owner(exec))) ?? [] }) });

  ctx.effect(() => ctx.connection.fetch.register({ path: "/api/dsh-remote-ops/state", methods: ["GET"], requestBody: "buffered", fetch: async (request) => { const sessionId = new URL(request.url).searchParams.get("sessionId"); const agent = sessionId ? ctx.agents.get(sessionId) : undefined; await state.ready; return Response.json(agent ? { ...state.snapshot(agent), bound: true } : state.catalog(), { headers: { "Cache-Control": "no-store" } }); } }), "dsh-remote-ops state route");
  ctx.effect(() => ctx.connection.fetch.register({ path: "/api/dsh-remote-ops/terminal", methods: ["GET"], requestBody: "buffered", fetch: async (request) => { const url = new URL(request.url); const target = url.searchParams.get("session"); const sessionId = url.searchParams.get("sessionId"); const rawOffset = url.searchParams.get("offset"); const waitMs = Math.max(0, Math.min(25_000, Number(url.searchParams.get("waitMs") ?? 0) || 0)); if (!target) return Response.json({ error: "REMOTE_SESSION_REQUIRED" }, { status: 400 }); const offset = rawOffset === null ? undefined : Number(rawOffset); if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) return Response.json({ error: "REMOTE_OFFSET_INVALID" }, { status: 400 }); const agent = sessionId ? ctx.agents.get(sessionId) : undefined; if (target !== LOCAL_SESSION_ID && !agent) return Response.json({ error: "REMOTE_SESSION_NOT_ACTIVE" }, { status: 404 }); try { await state.ready; return Response.json(await state.terminalOutput(agent, target, offset, waitMs, request.signal), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ error: summarizeError(error), code: error?.code }, { status: 400, headers: { "Cache-Control": "no-store" } }); } } }), "dsh-remote-ops terminal route");
  ctx.effect(() => ctx.connection.fetch.register({ path: "/api/dsh-remote-ops/update", methods: ["GET", "POST"], requestBody: "buffered", fetch: async (request) => { try { await state.ready; if (request.method === "POST") return Response.json(await state.upgrade(), { headers: { "Cache-Control": "no-store" } }); return Response.json(await state.checkForUpdate(), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ error: summarizeError(error), code: error?.code }, { status: 400, headers: { "Cache-Control": "no-store" } }); } } }), "dsh-remote-ops update route");
  ctx.effect(() => ctx.connection.fetch.register({ path: "/api/dsh-remote-ops/action", methods: ["POST"], requestBody: "buffered", fetch: async (request) => { const body = await request.json(); await state.ready; const localActions = new Set(["group.create", "group.rename", "group.delete", "environment.save", "environment.delete", "quick-group.create", "quick-group.rename", "quick-group.delete", "quick.save", "quick.delete"]); const localTerminalAction = body.session === LOCAL_SESSION_ID && ["send", "input", "signal"].includes(body.action); const agent = body.sessionId ? ctx.agents.get(body.sessionId) : undefined; if (!agent && !localActions.has(body.action) && !localTerminalAction) return Response.json({ error: "REMOTE_SESSION_NOT_ACTIVE" }, { status: 404 }); try { let value; if (body.action === "group.create") value = await state.createGroup(body.name); else if (body.action === "group.rename") value = await state.renameGroup(body.group, body.name); else if (body.action === "group.delete") value = await state.deleteGroup(body.group); else if (body.action === "environment.save") { const environment = { ...body.environment, group: normalizeGroupName(body.environment?.group) }; const password = typeof body.password === "string" ? body.password : ""; const validation = validateEnvironment(environment); if (!validation.ok) throw sessionError("REMOTE_ENV_INVALID", validation.errors.join(", ")); if (password) { const previous = state.findEnvironment(environment.id); const reference = String(environment.passwordRef ?? "").trim() || previous?.passwordRef || defaultPasswordRef(environment.id); environment.passwordRef = await state.storePassword(reference, password); } value = { saved: true, environment: await state.saveEnvironment(environment) }; } else if (body.action === "environment.delete") value = await state.deleteEnvironment(agent, body.environment); else if (body.action === "quick-group.create") value = await state.createQuickGroup(body.name); else if (body.action === "quick-group.rename") value = await state.renameQuickGroup(body.group, body.name); else if (body.action === "quick-group.delete") value = await state.deleteQuickGroup(body.group); else if (body.action === "quick.save") value = await state.saveQuickCommand({ ...body.command, group: normalizeGroupName(body.command?.group) }); else if (body.action === "quick.delete") value = await state.deleteQuickCommand(body.commandId); else if (body.action === "open") { const opened = await state.open(agent, body.environment); value = { sessionId: opened.sessionId, environment: opened.environment.name, status: opened.session.status(), viewport: opened.session.output.slice(-64 * 1024) }; } else if (body.action === "open-command") { const opened = await state.openDirect(agent, body.environment); value = { sessionId: opened.sessionId, environment: opened.environment.name, status: opened.session.status(), viewport: opened.session.output.slice(-64 * 1024), direct: true }; } else if (body.action === "send") value = await state.send(agent, body.session, body); else if (body.action === "input") value = await state.input(agent, body.session, body.text); else if (body.action === "signal") value = await state.signal(agent, body.session, body.signal); else if (body.action === "close") value = await state.close(agent, body.session); else if (body.action === "sftp") value = await state.sftp(agent, body.environment, body.operation, body); else throw new Error(`Unknown action: ${body.action}`); return Response.json(value ?? { ok: true }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ error: summarizeError(error), code: error?.code }, { status: 400 }); } } }), "dsh-remote-ops action route");

}

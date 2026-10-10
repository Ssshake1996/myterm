import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Client as SshClient } from "ssh2";
import { PLUGIN_NAME, PLUGIN_VERSION } from "./version.js";
import { TransferManager, HostFiles, SftpFiles } from "./transfers.js";
import { describeFailure } from "./diagnostics.js";
import { executeCommand } from "./commands.js";
import { DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS, normalizeCliProfile, normalizeTerminalSize, resolveRenderOptions } from "./cli-profile.js";
import { readPage, renderOutput } from "./output-render.js";
import { performSend } from "./terminal-send.js";
import {
  AGENT_OUTPUT_CHARS, CREDENTIAL_REF_RE, LOCAL_SESSION_ID, LOCAL_SESSION_NAME, MAX_SESSIONS_PER_ENVIRONMENT, MAX_SFTP_BYTES, ROOT,
  SESSION_NAME_PREFIX, UI_SCROLLBACK_CHARS,
} from "./constants.js";
import { newEnvironmentId, newSessionName, normalizeGroupName, ownerId, resolveRemoteHome, sessionError, summarizeError, validateEnvironment } from "./common.js";
import { UPDATE_CACHE_MS, fetchLatestRelease, findProfileRoot, runPnpm } from "./release.js";
import { AdoptedTerminalSession, LocalCmdTerminalSession, SshTerminalSession, buildSshShellOptions } from "./terminal-sessions.js";

function sanitizeStoredEnvironment(item) {
  if (!item || typeof item !== "object") return item;
  const { cliProfile, terminal, ...rest } = item;
  const profile = normalizeCliProfile(cliProfile), size = normalizeTerminalSize(terminal);
  return { ...rest, ...(profile ? { cliProfile: profile } : {}), ...(size ? { terminal: size } : {}) };
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
    this.quickWrites = Promise.resolve();
    this.quickReceipts = new Map();
    this.sessions = new Map();
    this.events = new Map();
    this.backendSessions = new Map();
    this.directEnvironments = new Map();
    this.openings = new Map();
    this.commands = new Map();
    this.localSession = undefined;
    this.toolWarnings = [];
    this.disconnects = new Map();
    this.localStarting = undefined;
    this.localError = "";
    this.disposed = false;
    this.release = { currentVersion: PLUGIN_VERSION, latestVersion: PLUGIN_VERSION, updateAvailable: false };
    this.releaseCheckedAt = 0;
    this.releaseCheckPromise = undefined;
    this.transfers = new TransferManager((endpoint, signal) => this.connectFiles(endpoint, signal));
    this.ready = this.load();
  }

  async load() {
    const executable = process.argv[1];
    if (executable) {
      const manifest = await readFile(join(dirname(executable), "..", "package.json"), "utf8").then(JSON.parse).catch(() => null);
      this.harnessVersion = manifest?.name === "@deepseek-ai/dsh" ? manifest.version : null;
    }
    await mkdir(this.base, { recursive: true });
    await mkdir(this.environmentRoot, { recursive: true });
    await mkdir(this.quickRoot, { recursive: true });
    const environmentDirs = await readdir(this.environmentRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of environmentDirs.filter((item) => item.isDirectory())) {
      const group = normalizeGroupName(entry.name);
      const data = await this.readJson(this.envFile(group), []);
      this.environments.set(group, Array.isArray(data) ? data.map(sanitizeStoredEnvironment).filter((item) => validateEnvironment(item).ok) : []);
    }
    const quickDirs = await readdir(this.quickRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of quickDirs.filter((item) => item.isDirectory())) {
      const group = normalizeGroupName(entry.name);
      this.quickGroups.add(group);
      const data = await this.readJson(this.quickFile(group), []);
      if (Array.isArray(data)) for (const item of data.filter(item => item && typeof item.id === "string")) {
        this.quickCommands.push({ pinned: true, confirm: false, order: this.quickCommands.length, revision: randomUUID(), ...item, group });
      }
    }
    await this.ensureLocalSession().catch((error) => { this.localError = summarizeError(error); });
  }

  async readJson(path, fallback) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; } }
  groupDir(group) { return join(this.environmentRoot, normalizeGroupName(group)); }
  envFile(group) { const safe = normalizeGroupName(group); return join(this.groupDir(safe), `environments.${safe}.json`); }
  quickGroupDir(group) { return join(this.quickRoot, normalizeGroupName(group)); }
  quickFile(group) { const safe = normalizeGroupName(group); return join(this.quickGroupDir(safe), `commands.${safe}.json`); }

  async saveGroup(group) { const safe = normalizeGroupName(group); await mkdir(this.groupDir(safe), { recursive: true }); await writeFile(this.envFile(safe), `${JSON.stringify(this.environments.get(safe) ?? [], null, 2)}\n`, "utf8"); }
  async saveQuickGroup(group) {
    const safe = normalizeGroupName(group);
    const content = `${JSON.stringify(this.quickCommands.filter(item => normalizeGroupName(item.group) === safe), null, 2)}\n`;
    const write = this.quickWrites.catch(() => {}).then(async () => {
      await mkdir(this.quickGroupDir(safe), { recursive: true });
      await writeFile(this.quickFile(safe), content, "utf8");
    });
    this.quickWrites = write;
    await write;
  }

  normalizeEnvironment(value) {
    const input = value && typeof value === "object" ? value : {};
    const host = String(input.host ?? "").trim();
    return { ...input, id: String(input.id ?? "").trim() || newEnvironmentId(host), name: String(input.name ?? "").trim() || host, host, username: String(input.username ?? "").trim(), group: normalizeGroupName(input.group) };
  }

  groupList() { return [...this.environments.keys()].sort((a, b) => a.localeCompare(b)); }
  quickGroupList() { return [...this.quickGroups].sort((a, b) => a.localeCompare(b)); }
  async createGroup(name) { const group = normalizeGroupName(name); if (this.environments.has(group)) throw sessionError("REMOTE_GROUP_EXISTS", `Environment group already exists: ${group}`); this.environments.set(group, []); await this.saveGroup(group); return { group }; }
  async renameGroup(from, to) { const source = normalizeGroupName(from); const target = normalizeGroupName(to); if (!this.environments.has(source)) throw sessionError("REMOTE_GROUP_NOT_FOUND", source); if (source === target) return { group: target }; if (this.environments.has(target)) throw sessionError("REMOTE_GROUP_EXISTS", target); this.environments.set(target, (this.environments.get(source) ?? []).map((item) => ({ ...item, group: target }))); this.environments.delete(source); await this.saveGroup(target); await rm(this.groupDir(source), { recursive: true, force: true }); return { group: target }; }
  async deleteGroup(name) { const group = normalizeGroupName(name); const values = this.environments.get(group); if (!values) throw sessionError("REMOTE_GROUP_NOT_FOUND", group); if (values.length) throw sessionError("REMOTE_GROUP_NOT_EMPTY", `Environment group is not empty: ${group}`); this.environments.delete(group); await rm(this.groupDir(group), { recursive: true, force: true }); return { deleted: true, group }; }
  async saveEnvironment(value) {
    const normalized = this.normalizeEnvironment(value);
    const group = normalized.group;
    const previous = this.findEnvironment(normalized.id);
    const duplicate = this.allEnvironments().find((item) => item.id !== normalized.id && item.name === normalized.name);
    if (duplicate) throw sessionError("REMOTE_ENV_NAME_EXISTS", `Environment name already exists: ${normalized.name}`);
    const previousGroups = [];
    for (const [name, list] of this.environments) {
      const next = list.filter((item) => item.id !== normalized.id);
      if (next.length !== list.length) { this.environments.set(name, next); previousGroups.push(name); }
    }
    if (!this.environments.has(group)) this.environments.set(group, []);
    const saved = { ...previous, ...normalized, group };
    // A supplied profile/size replaces the stored one; an empty (all-default) value clears it; an absent field keeps it.
    for (const [key, normalize] of [["cliProfile", normalizeCliProfile], ["terminal", normalizeTerminalSize]]) {
      if (!Object.hasOwn(normalized, key)) continue;
      const clean = normalize(normalized[key]);
      if (clean) saved[key] = clean; else delete saved[key];
    }
    this.environments.set(group, [...this.environments.get(group), saved]);
    for (const name of new Set([...previousGroups, group])) await this.saveGroup(name);
    return this.findEnvironment(normalized.id);
  }
  async createQuickGroup(name) { const group = normalizeGroupName(name); if (this.quickGroups.has(group)) throw sessionError("REMOTE_QUICK_GROUP_EXISTS", `Quick command group already exists: ${group}`); this.quickGroups.add(group); await this.saveQuickGroup(group); return { group }; }
  async renameQuickGroup(from, to) { const source = normalizeGroupName(from); const target = normalizeGroupName(to); if (!this.quickGroups.has(source)) throw sessionError("REMOTE_QUICK_GROUP_NOT_FOUND", source); if (this.quickGroups.has(target)) throw sessionError("REMOTE_QUICK_GROUP_EXISTS", target); this.quickGroups.delete(source); this.quickGroups.add(target); this.quickCommands = this.quickCommands.map((item) => normalizeGroupName(item.group) === source ? { ...item, group: target, revision: randomUUID() } : item); await this.saveQuickGroup(target); await rm(this.quickGroupDir(source), { recursive: true, force: true }); return { group: target }; }
  async deleteQuickGroup(name) { const group = normalizeGroupName(name); if (!this.quickGroups.has(group)) throw sessionError("REMOTE_QUICK_GROUP_NOT_FOUND", group); if (this.quickCommands.some((item) => normalizeGroupName(item.group) === group)) throw sessionError("REMOTE_QUICK_GROUP_NOT_EMPTY", `Quick command group is not empty: ${group}`); this.quickGroups.delete(group); await rm(this.quickGroupDir(group), { recursive: true, force: true }); return { deleted: true, group }; }
  async saveQuickCommand(value) {
    const id = String(value.id ?? "").trim(), name = String(value.name ?? "").trim(), command = String(value.command ?? "");
    if (!id || id.length > 128 || !name || name.length > 100 || !command.trim() || command.length > 65536 || command.includes("\0")) throw sessionError("QUICK_COMMAND_INVALID", "Command ID, name (1-100 characters), and command (1-65536 characters) are required");
    const previous = this.quickCommands.find(item => item.id === id);
    if (value.expectedRevision && value.expectedRevision !== previous?.revision) throw sessionError("QUICK_COMMAND_CHANGED", "Command changed or was deleted; reload before saving");
    const group = normalizeGroupName(value.group ?? previous?.group);
    const saved = { id, name, command, group, pinned: value.pinned ?? previous?.pinned ?? true, confirm: value.confirm ?? previous?.confirm ?? false, order: previous?.order ?? Math.max(-1, ...this.quickCommands.map(item => item.order)) + 1, revision: randomUUID() };
    if (typeof saved.pinned !== "boolean" || typeof saved.confirm !== "boolean") throw sessionError("QUICK_COMMAND_INVALID", "pinned and confirm must be boolean");
    this.quickGroups.add(group);
    this.quickCommands = [...this.quickCommands.filter(item => item.id !== id), saved];
    for (const name of new Set([group, previous?.group].filter(Boolean))) await this.saveQuickGroup(name);
    return saved;
  }
  async moveQuickCommand(id, direction) {
    if (direction !== -1 && direction !== 1) throw sessionError("QUICK_COMMAND_INVALID", "Move direction must be -1 or 1");
    const ordered = this.quickCommands.slice().sort((a, b) => a.order - b.order);
    const index = ordered.findIndex(item => item.id === id);
    if (index < 0) throw sessionError("REMOTE_QUICK_COMMAND_NOT_FOUND", id);
    const next = ordered[index + direction];
    if (next) {
      [ordered[index].order, next.order] = [next.order, ordered[index].order];
      for (const group of new Set([ordered[index].group, next.group])) await this.saveQuickGroup(group);
    }
    return { moved: Boolean(next), id };
  }
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
    return { sessionId: LOCAL_SESSION_ID, name: session.environment.name, kind: "local", status: session.status(), workingDirectory: this.base, ownerId: "shared", lastActivity: session.lastActivity, control: this.controlSnapshot(session) };
  }
  catalog() {
    const local = this.localSnapshot();
    return {
      groups: this.groupList(),
      environments: this.allEnvironments().map((value) => ({ ...value, passwordRef: value.passwordRef ? "configured" : undefined, active: false, running: false, status: "idle", connectionCount: 0, maxConnections: MAX_SESSIONS_PER_ENVIRONMENT })),
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
  findEnvironmentBySessionName(name) {
    const value = String(name ?? "");
    return this.findEnvironment(value) ?? [...this.allEnvironments()].sort((left, right) => right.id.length - left.id.length).find((environment) => value.startsWith(`${SESSION_NAME_PREFIX}${environment.id}-`));
  }
  activeRemoteSessions(ownerKey, environmentId) {
    return [...this.sessions.values()].filter((record) => record.ownerId === ownerKey && record.environment.id === environmentId && record.session.status().kind !== "exited");
  }
  // Only connections that dropped on their own are remembered; a release requested by the user or agent is not a disconnect.
  recordDisconnect(record, info = {}) {
    if (info.requested || this.disposed) return;
    const entry = { sessionId: record.sessionId, environmentId: record.environment.id, environment: record.environment.name, at: new Date().toISOString(), reason: info.reason ?? null };
    const list = this.disconnects.get(record.ownerId) ?? [];
    list.push(entry);
    while (list.length > 10) list.shift();
    this.disconnects.set(record.ownerId, list);
    this.event(record.owner, "ssh.disconnected", { sessionId: record.sessionId, environment: record.environment.name, reason: entry.reason });
  }

  async resize(owner, target, rows, cols) {
    if (rows === undefined && cols === undefined) throw sessionError("TERMINAL_OPTION_INVALID", "Pass rows and/or cols");
    if (target === LOCAL_SESSION_ID) throw sessionError("TERMINAL_RESIZE_UNSUPPORTED", "The shared local terminal has a fixed 40x160 size chosen by the DSH host; resizing applies to SSH connections");
    const record = this.getSession(owner, target);
    if (typeof record.session.resize !== "function") throw sessionError("TERMINAL_RESIZE_UNSUPPORTED", "This connection is held by the DSH host (adopted after a plugin reload) and cannot be resized; open a new connection");
    const size = record.session.resize(rows, cols);
    record.session.outputBuffer.notify();
    this.event(owner, "ssh.resize", { sessionId: record.sessionId, environment: record.environment.name, ...size });
    return { sessionId: record.sessionId, environment: record.environment.name, ...size, note: "Applied to the remote PTY; full-screen programs repaint at the new size, the stream already printed is not reflowed" };
  }

  connectionSnapshot(record) {
    return { sessionId: record.sessionId, environmentId: record.environment.id, name: record.environment.name,
      kind: "ssh", status: record.session.status(),
      ownerId: record.ownerId, lastActivity: record.session.lastActivity ?? null, control: this.controlSnapshot(record.session), direct: Boolean(record.direct) };
  }
  toolReceipt(owner, session) {
    if (!owner) return null;
    const receipt = session.toolReceipts?.get(ownerId(owner));
    if (!receipt || receipt.streamId !== session.outputBuffer.streamId) return null;
    return { ...receipt, newOutput: receipt.nextOffset === null ? null : receipt.nextOffset < session.outputBuffer.endOffset };
  }
  recordToolReceipt(owner, session, result, source) {
    if (!owner) return;
    session.toolReceipts ??= new Map();
    session.toolReceipts.set(ownerId(owner), { at: new Date().toISOString(), source, streamId: result.streamId ?? session.outputBuffer.streamId,
      startOffset: result.startOffset ?? null, nextOffset: result.nextOffset ?? null,
      lineBegin: result.lineBegin ?? null, lineEnd: result.lineEnd ?? null, truncated: Boolean(result.truncated) });
    if (session.toolReceipts.size > 100) session.toolReceipts.delete(session.toolReceipts.keys().next().value);
    session.outputBuffer.notify();
  }
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
    const remoteSessions = [...this.sessions.values()].filter((x) => x.ownerId === id && x.session.status().kind !== "exited").map(x => this.connectionSnapshot(x));
    const sessions = [...(local ? [local] : []), ...remoteSessions];
    const environments = this.allEnvironments().map((x) => {
      const connectionCount = remoteSessions.filter((session) => session.environmentId === x.id).length;
      return { ...x, passwordRef: x.passwordRef ? "configured" : undefined, active: connectionCount > 0, running: connectionCount > 0, status: connectionCount > 0 ? "running" : "idle", connectionCount, maxConnections: MAX_SESSIONS_PER_ENVIRONMENT };
    });
    return { groups: this.groupList(), environments, quickGroups: this.quickGroupList(), quickCommands: this.quickCommands, sessions, events: this.events.get(id) ?? [], ...(this.disconnects.get(id)?.length ? { disconnects: this.disconnects.get(id) } : {}), localError: this.localError || undefined, pluginName: PLUGIN_NAME, pluginVersion: PLUGIN_VERSION, update: this.release };
  }

  async terminalOutput(owner, target, offset, waitMs = 0, signal, streamId, maxChars = UI_SCROLLBACK_CHARS, pageOptions = {}) {
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
      if ((!streamId || streamId === session.outputBuffer.streamId) && waitMs > 0 && session.outputBuffer.readFrom(offset).text === "") await session.waitForChange(waitMs, signal);
    } else if ((!streamId || streamId === session.outputBuffer.streamId) && waitMs > 0 && session.status().kind !== "exited") await session.outputBuffer.waitForChange(offset, waitMs, signal);
    const replaced = Boolean(streamId && streamId !== session.outputBuffer.streamId);
    return {
      sessionId: target,
      environmentId,
      name,
      kind,
      status: session.status(),
      size: session.size ?? { rows: DEFAULT_TERMINAL_ROWS, cols: DEFAULT_TERMINAL_COLS },
      activity: session.active ? "waiting" : session.lastWaitReason ?? "unobserved",
      control: this.controlSnapshot(session),
      toolReceipt: this.toolReceipt(owner, session),
      completion: "unknown",
      format: "terminal-stream",
      ...readPage(session.outputBuffer, replaced ? undefined : offset, maxChars, pageOptions),
      ...(replaced ? { reset: true, truncated: true } : {}),
    };
  }

  async readTerminal(owner, target, args = {}) {
    await this.ready;
    if (args.cursor !== undefined && (!Number.isSafeInteger(args.cursor) || args.cursor < 0)) throw sessionError("REMOTE_OFFSET_INVALID", "cursor must be a non-negative integer");
    const record = target === LOCAL_SESSION_ID ? undefined : this.getSession(owner, target);
    const session = record ? record.session : await this.ensureLocalSession();
    const render = resolveRenderOptions(args, record?.environment?.cliProfile);
    const rendering = render.stripAnsi || render.headTailChars;
    if (args.offset !== undefined || args.count !== undefined) {
      const result = record ? await this.ctx.terminals.read(owner, record.sessionId, args) : session.read(args);
      this.recordToolReceipt(owner, session, result, "history");
      const shown = rendering ? renderOutput({ text: result.text }, render) : undefined;
      return { sessionId: target, ...result, ...(shown ? { text: shown.text, ...(shown.ansiStripped ? { ansiStripped: true } : {}), ...(shown.summarized ? { summarized: true, omitted: shown.omitted } : {}) } : {}), status: session.status(), format: "terminal-stream", completion: "unknown" };
    }
    const waitMs = Math.max(0, Math.min(25_000, Number(args.waitMs) || 0));
    const maxChars = Math.max(2, Math.min(UI_SCROLLBACK_CHARS, Number(args.maxChars) || AGENT_OUTPUT_CHARS));
    const raw = await this.terminalOutput(owner, target, args.cursor, waitMs, args.signal, args.streamId, maxChars, render);
    const shown = rendering ? renderOutput(raw, render) : undefined;
    const result = shown ? { ...raw, text: shown.text, nextOffset: shown.nextOffset, hasMore: shown.hasMore, ...(shown.ansiStripped ? { ansiStripped: true } : {}), ...(shown.summarized ? { summarized: true, omitted: shown.omitted } : {}) } : raw;
    this.recordToolReceipt(owner, session, shown?.summarized ? { ...result, truncated: true } : result, "read");
    return result;
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
    const environment = spec.environment ?? this.directEnvironments.get(spec.name) ?? this.findEnvironment(spec.name) ?? this.findEnvironmentBySessionName(spec.name);
    if (!environment) throw sessionError("REMOTE_ENV_NOT_FOUND", `Environment not found: ${spec.name}`);
    const client = new SshClient();
    const config = { host: environment.host, port: environment.port ?? 22, username: environment.username, readyTimeout: environment.readyTimeoutMs ?? 15_000, keepaliveInterval: 10_000, keepaliveCountMax: 3 };
    try {
      if (environment.privateKeyPath) config.privateKey = await readFile(environment.privateKeyPath);
      const password = await this.resolvePassword(environment);
      if (password) config.password = password;
      const shell = buildSshShellOptions(environment);
      const channel = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(sessionError("SSH_CONNECT_TIMEOUT", `SSH connection timed out: ${environment.host}:${config.port}`)), config.readyTimeout);
        client.once("ready", () => { client.shell(shell.window, shell.options, (error, stream) => { clearTimeout(timer); if (error) reject(error); else resolve(stream); }); });
        client.once("error", (error) => { clearTimeout(timer); reject(error); });
        client.connect(config);
      });
      const session = new SshTerminalSession(client, channel, environment, shell.window);
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
      this.reconcileHostSessions(owner);
      const active = this.activeRemoteSessions(id, environment.id);
      if (active.length >= MAX_SESSIONS_PER_ENVIRONMENT) throw sessionError("REMOTE_SESSION_LIMIT", `Environment ${environment.name} already has ${active.length} active connections; maximum is ${MAX_SESSIONS_PER_ENVIRONMENT}`);
      const spawned = await this.ctx.terminals.spawn(owner, { type: "ssh", name: newSessionName(environment.id), environment });
      const session = this.backendSessions.get(spawned.sessionId);
      if (!session) throw new Error("SSH backend did not return a session");
      const record = { sessionId: spawned.sessionId, ownerId: id, owner, environment, session };
      this.sessions.set(record.sessionId, record);
      session.onClose = (info) => this.recordDisconnect(record, info);
      this.event(owner, "ssh.open", { sessionId: record.sessionId, environment: environment.name });
      return record;
    })();
    this.openings.set(key, opening);
    try { return await opening; } finally { if (this.openings.get(key) === opening) this.openings.delete(key); }
  }

  async resolveOwner(sessionId) {
    if (!sessionId) throw sessionError("REMOTE_SESSION_REQUIRED", "Select an existing Harness session before SSH or SFTP operations");
    const live = this.ctx.agents?.get(sessionId);
    if (live) return live;
    if (!this.ctx.sessionController?.resolveAgent) throw sessionError("REMOTE_OWNER_UNAVAILABLE", "This Harness host cannot activate the selected session without a message");
    const result = await this.ctx.sessionController.resolveAgent(sessionId);
    if (!result.agent) throw sessionError(result.error?.code ?? "REMOTE_OWNER_UNAVAILABLE", result.error?.message ?? "Harness could not resume the selected session", result.error);
    return result.agent;
  }

  async enter(owner, environmentId) {
    await this.ready;
    this.reconcileHostSessions(owner);
    const environment = this.findEnvironment(environmentId);
    if (!environment) throw sessionError("REMOTE_ENV_NOT_FOUND", `Environment not found: ${environmentId}`);
    const records = this.activeRemoteSessions(ownerId(owner), environment.id);
    if (records.length > 1) return { choices: records.map(x => this.connectionSnapshot(x)) };
    const record = records[0] ?? await this.open(owner, environment.id);
    return { sessionId: record.sessionId, reused: records.length === 1 };
  }

  controlSnapshot(session) {
    return { holder: session.inputHolder ?? "available", waiting: Boolean(session.pendingSend || session.active) };
  }

  async dispatchQuick(owner, body) {
    await this.ready;
    if (typeof body.requestId !== "string" || !body.requestId || body.requestId.length > 128) throw sessionError("QUICK_REQUEST_INVALID", "A unique requestId is required");
    const ownerKey = body.session === LOCAL_SESSION_ID ? "local" : ownerId(owner);
    const key = JSON.stringify([ownerKey, body.requestId]);
    const fingerprint = JSON.stringify([body.session, body.streamId, body.commandId, body.revision, body.confirmed === true]);
    const now = Date.now();
    // Receipts cover concurrent calls and transport retries for ten minutes, without retaining terminal output.
    for (const [id, entry] of this.quickReceipts) if (entry.finishedAt && now - entry.finishedAt > 600000) this.quickReceipts.delete(id);
    const previous = this.quickReceipts.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw sessionError("QUICK_REQUEST_CONFLICT", "requestId already belongs to a different dispatch");
      return previous.result;
    }
    if (this.quickReceipts.size >= 1024) throw sessionError("QUICK_REQUEST_LIMIT", "Too many recent dispatches; wait before submitting another command");
    const command = this.quickCommands.find(item => item.id === body.commandId);
    if (!command || !body.revision || command.revision !== body.revision) throw sessionError("QUICK_COMMAND_CHANGED", "Command changed or was deleted; reload before dispatch");
    if (command.confirm && body.confirmed !== true) throw sessionError("QUICK_CONFIRM_REQUIRED", "Review the command and terminal before dispatch");
    const record = body.session === LOCAL_SESSION_ID ? undefined : this.getSession(owner, body.session);
    if (record && record.sessionId !== body.session) throw sessionError("REMOTE_SESSION_NOT_FOUND", "An exact terminal session ID is required");
    const session = record?.session ?? this.localSession;
    if (!session || session.status().kind === "exited") throw sessionError("REMOTE_SESSION_EXITED", "Terminal is closed; reconnect explicitly before dispatch");
    if (!body.streamId || body.streamId !== session.outputBuffer.streamId) throw sessionError("TERMINAL_STREAM_CHANGED", "Terminal was replaced; review the new terminal before dispatch");
    this.claimInput(session, "manual", body.streamId);
    const entry = { fingerprint, finishedAt: 0 };
    this.quickReceipts.set(key, entry);
    entry.result = Promise.resolve().then(async () => {
      const receipt = { requestId: body.requestId, commandId: command.id, sessionId: body.session, streamId: body.streamId, completion: "unknown" };
      try {
        await session.writeInput(`${command.command.replace(/\r\n|\n/g, "\r").replace(/\r+$/, "")}\r`);
        return { ...receipt, status: "written" };
      } catch (error) {
        return { ...receipt, status: "unknown", error: describeFailure(error, "quick.dispatch.write") };
      } finally { entry.finishedAt = Date.now(); }
    });
    return entry.result;
  }

  claimInput(session, actor, streamId) {
    if (streamId && streamId !== session.outputBuffer.streamId) throw sessionError("TERMINAL_STREAM_CHANGED", "Terminal was replaced; review the new output before typing");
    if (actor !== "manual" && session.inputHolder === "manual") throw sessionError("TERMINAL_MANUAL_CONTROL", "User is editing this terminal; wait for them to release input control");
    if (actor === "manual" && session.inputHolder === "agent" && (session.pendingSend || session.active)) throw sessionError("TERMINAL_AGENT_ACTIVE", "Agent is sending; take over explicitly before typing");
    session.inputHolder = actor === "manual" ? "manual" : "agent";
    session.outputBuffer.notify();
  }

  async control(owner, target, action) {
    const session = target === LOCAL_SESSION_ID ? await this.ensureLocalSession() : this.getSession(owner, target).session;
    if (!["takeover", "release", "stop-wait"].includes(action)) throw sessionError("TERMINAL_CONTROL_INVALID", `Unknown input control action: ${action}`);
    const pending = session.pendingSend;
    const operation = session.active ?? pending;
    if (action !== "release" && operation) {
      if (typeof operation.finish !== "function") throw sessionError("TERMINAL_CONTROL_UNAVAILABLE", "This adopted backend cannot stop waiting without interrupting; use the explicit interrupt action");
      operation.finish("wait_stopped");
      await operation.done;
      if (session.pendingSend === pending) session.pendingSend = undefined;
    }
    if (action === "takeover") session.inputHolder = "manual";
    if (action === "release") session.inputHolder = "available";
    session.outputBuffer.notify();
    return this.controlSnapshot(session);
  }

  reconcileHostSessions(owner) {
    if (typeof this.ctx.terminals?.list !== "function") return [];
    const id = ownerId(owner);
    const hostSessions = this.ctx.terminals.list(owner);
    const liveIds = new Set();
    for (const snapshot of hostSessions) {
      if (snapshot?.type !== "ssh" || snapshot.status?.kind === "exited") continue;
      const environment = this.findEnvironmentBySessionName(snapshot.name);
      if (!environment) continue;
      liveIds.add(snapshot.sessionId);
      const current = this.sessions.get(snapshot.sessionId);
      if (current) continue;
      this.sessions.set(snapshot.sessionId, { sessionId: snapshot.sessionId, ownerId: id, owner, environment, session: new AdoptedTerminalSession(this.ctx, owner, snapshot), adopted: true });
      this.event(owner, "ssh.reconciled", { sessionId: snapshot.sessionId, environment: environment.name });
    }
    for (const [sessionId, record] of this.sessions) {
      if (record.ownerId === id && !record.direct && !liveIds.has(sessionId)) {
        this.sessions.delete(sessionId);
        this.event(owner, "ssh.reconciled.closed", { sessionId, environment: record.environment.name });
      }
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
    session.onClose = (info) => this.recordDisconnect(record, info);
    this.event(owner, "ssh.open.direct", { sessionId: record.sessionId, environment: environment.name });
    return record;
  }

  getSession(owner, sessionIdOrEnvironment) {
    const id = ownerId(owner);
    const exact = this.sessions.get(sessionIdOrEnvironment);
    const record = exact ?? (() => {
      const matches = [...this.sessions.values()].filter((x) => x.ownerId === id && x.environment.id === sessionIdOrEnvironment && x.session.status().kind !== "exited");
      if (matches.length > 1) throw sessionError("REMOTE_SESSION_REQUIRED", `Environment ${sessionIdOrEnvironment} has ${matches.length} active connections; use an explicit session id`);
      return matches[0];
    })();
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

  send(owner, target, args) { return performSend(this, owner, target, args); }

  async input(owner, target, text, actor = "agent", streamId) {
    if (target === LOCAL_SESSION_ID) {
      const session = await this.ensureLocalSession();
      this.claimInput(session, actor, streamId);
      const result = await session.writeInput(text);
      return { sessionId: LOCAL_SESSION_ID, environment: session.environment.name, ...result };
    }
    const record = this.getSession(owner, target);
    this.claimInput(record.session, actor, streamId);
    const result = await record.session.writeInput(text);
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

  async listLocalFiles(pathValue = this.base) {
    const path = resolve(String(pathValue || this.base));
    const directory = await readdir(path, { withFileTypes: true });
    const entries = await Promise.all(directory.map(async (entry) => {
      const entryPath = join(path, entry.name);
      const details = await stat(entryPath);
      return { name: entry.name, type: entry.isDirectory() ? "d" : "-", size: entry.isFile() ? details.size : 0, modifyTime: details.mtimeMs, path: entryPath };
    }));
    entries.sort((left, right) => Number(right.type === "d") - Number(left.type === "d") || left.name.localeCompare(right.name));
    return { path, entries };
  }

  async connectFiles(endpoint, signal) {
    if (endpoint.kind === "host") return new HostFiles();
    if (endpoint.kind !== "ssh") throw sessionError("SFTP_ENDPOINT_INVALID", "Select the DSH host or an SSH environment");
    const environment = this.findEnvironment(endpoint.environment);
    if (!environment) throw sessionError("REMOTE_ENV_NOT_FOUND", `Environment not found: ${endpoint.environment}`);
    const client = new SshClient();
    try {
      const config = { host: environment.host, port: environment.port ?? 22, username: environment.username, readyTimeout: environment.readyTimeoutMs ?? 15_000 };
      if (environment.privateKeyPath) config.privateKey = await readFile(environment.privateKeyPath);
      const password = await this.resolvePassword(environment); if (password) config.password = password;
      const sftp = await new Promise((resolve, reject) => {
        const abort = () => { client.destroy(); reject(signal.reason ?? new Error("aborted")); };
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
        const finish = (error, value) => { signal?.removeEventListener("abort", abort); if (error) reject(error); else resolve(value); };
        client.once("error", finish);
        client.once("ready", () => client.sftp(finish));
        client.connect(config);
      });
      return new SftpFiles(client, sftp, signal);
    } catch (error) { client.end(); throw sessionError("SFTP_CONNECT_FAILED", "Unable to open SFTP channel", error); }
  }

  async listFiles(endpoint, signal) {
    const files = await this.connectFiles(endpoint, signal);
    try {
      const path = await files.canonical(endpoint.path || (endpoint.kind === "host" ? this.base : "."));
      const entries = [];
      for (const name of await files.list(path)) {
        const details = await files.stat(files.join(path, name));
        entries.push({ name, type: details?.type === "directory" ? "d" : details?.type === "file" ? "-" : "l", size: details?.size ?? 0 });
      }
      entries.sort((a, b) => Number(b.type === "d") - Number(a.type === "d") || a.name.localeCompare(b.name));
      return { path, entries };
    } finally { files.close(); }
  }

  async sftp(owner, environmentId, action, args) {
    await this.ready;
    const environment = this.findEnvironment(environmentId);
    if (!environment) throw sessionError("REMOTE_ENV_NOT_FOUND", `Environment not found: ${environmentId}`);
    if (action === "upload" || action === "download") {
      const upload = action === "upload";
      const remote = String(args.remotePath).replace(/\\/g, "/");
      const slash = remote.lastIndexOf("/");
      const local = resolve(String(args.localPath));
      const from = upload ? { kind: "host", path: dirname(local) } : { kind: "ssh", environment: environment.id, path: slash < 0 ? "." : remote.slice(0, slash) || "/" };
      const to = upload ? { kind: "ssh", environment: environment.id, path: slash < 0 ? "." : remote.slice(0, slash) || "/" } : { kind: "host", path: dirname(local) };
      const localName = basename(local), remoteName = remote.slice(slash + 1);
      if (!upload) await mkdir(dirname(local), { recursive: true });
      const task = this.transfers.start(ownerId(owner), { source: from, target: to, names: [upload ? localName : remoteName], targetName: upload ? remoteName : localName, conflict: args.overwrite ? "overwrite" : "error" });
      const abort = () => this.transfers.cancel(ownerId(owner), task.id);
      if (args.signal?.aborted) abort(); else args.signal?.addEventListener("abort", abort, { once: true });
      let result;
      try { result = await this.transfers.wait(ownerId(owner), task.id); } finally { args.signal?.removeEventListener("abort", abort); }
      if (result.status !== "completed") throw sessionError(result.error.code, result.error.message, result.error);
      return { localPath: local, remotePath: remote, [upload ? "uploaded" : "downloaded"]: result.bytes };
    }
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

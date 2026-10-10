import { readFile } from "node:fs/promises";
import { Client as SshClient } from "ssh2";
import { CREDENTIAL_REF_RE, LOCAL_SESSION_ID, MAX_SESSIONS_PER_ENVIRONMENT } from "../constants.js";
import { newSessionName, ownerId, sessionError, validateEnvironment } from "../common.js";
import { AdoptedTerminalSession, SshTerminalSession, buildSshShellOptions } from "../terminal-sessions.js";

// SSH connections: spawning, opening, reconciling with the host, credentials, resize and disconnect records.
export const withConnections = (Base) => class ConnectionsLayer extends Base {
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

  async close(owner, target) {
    const record = this.getSession(owner, target);
    await this.ctx.terminals.kill(owner, record.sessionId, "closed by user");
    this.sessions.delete(record.sessionId);
    return { closed: true, sessionId: record.sessionId };
  }
};

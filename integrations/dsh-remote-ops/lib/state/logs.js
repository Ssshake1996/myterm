import { createHash, randomUUID } from "node:crypto";
import { setImmediate as yieldToIo } from "node:timers/promises";
import { LOCAL_SESSION_ID, MAX_SCROLLBACK_BYTES } from "../constants.js";
import { ownerId, sessionError } from "../common.js";
import { readPage } from "../output-render.js";
import { logText, zipLogs } from "../log-archive.js";

const ARCHIVE_BYTES = 16 * 1024 * 1024, EXPORT_BYTES = 32 * 1024 * 1024, EXPORT_TTL = 60 * 60 * 1000;
const ownerKey = owner => owner ? ownerId(owner) : null;
const visible = (record, owner) => record.ownerId === null || record.ownerId === ownerKey(owner);
const safeName = name => String(name).replace(/[\x00-\x1f<>:"/\\|?*]/gu, "_").replace(/[. ]+$/u, "").slice(0, 60) || "terminal";
const closed = (state, record) => record.session.status().kind === "exited" || (record.sessionId === LOCAL_SESSION_ID ? state.localSession !== record.session : !state.sessions.has(record.sessionId));
const metadata = (state, record) => {
  const buffer = record.session.outputBuffer;
  return { logId: record.logId, sessionId: record.sessionId, name: record.name, kind: record.kind, host: record.host, port: record.port,
    shared: record.ownerId === null, archived: closed(state, record), status: record.session.status(), streamId: buffer.streamId,
    startedAt: buffer.createdAt, lastOutputAt: buffer.updatedAt, retainedBytes: buffer.byteLength,
    startOffset: buffer.startOffset, endOffset: buffer.endOffset, truncated: buffer.startOffset > 0 || record.adopted,
    scope: record.adopted ? "host-recent-history" : "retained-terminal-output" };
};
const getLog = (state, owner, id) => {
  const record = state.terminalLogs?.get(id);
  if (!record || !visible(record, owner)) throw sessionError("TERMINAL_LOG_NOT_FOUND", "Log is unavailable in this conversation; call remote_terminal_logs to refresh logId");
  return record;
};
const transcript = (item, raw, exportedAt) => [
  "Remote Ops terminal transcript", `Terminal: ${logText(item.name)}`, `Target: ${logText(item.host)}:${item.port}`, `Session: ${item.sessionId}`, `Log: ${item.logId}`,
  `Stream: ${item.streamId}`, `Started: ${item.startedAt}`, `Last output: ${item.lastOutputAt}`, `Exported: ${exportedAt}`,
  `Raw offsets: ${item.startOffset}-${item.endOffset}`, `Truncated: ${item.truncated ? "yes (earlier output is unavailable)" : "no"}`,
  "Source: retained terminal output; raw input is not logged. Progress frames are separated by newlines; this is not a VT screen replay.",
  "Command completion: unknown; terminal output and shell status alone are not exit-status evidence.", "", logText(raw), "",
].join("\n");

export const withLogs = Base => class LogsLayer extends Base {
  trackTerminalLog(owner, sessionId, session, environment, adopted = false) {
    this.terminalLogs ??= new Map();
    if (!session.remoteLogId) session.remoteLogId = session.outputBuffer.streamId;
    if (!this.terminalLogs.has(session.remoteLogId)) this.terminalLogs.set(session.remoteLogId, {
      logId: session.remoteLogId, ownerId: sessionId === LOCAL_SESSION_ID ? null : ownerKey(owner), sessionId, session,
      name: environment.name, host: environment.host, port: environment.port ?? 22, kind: sessionId === LOCAL_SESSION_ID ? "local" : "ssh", adopted,
    });
    this.pruneTerminalLogs();
  }

  pruneTerminalLogs() {
    const archived = [...(this.terminalLogs?.values() ?? [])].filter(record => closed(this, record));
    let bytes = archived.reduce((sum, record) => sum + record.session.outputBuffer.byteLength, 0), count = archived.length;
    for (const record of archived) {
      if (count <= 32 && bytes <= ARCHIVE_BYTES) break;
      this.terminalLogs.delete(record.logId); count--; bytes -= record.session.outputBuffer.byteLength;
      this.logEvictions ??= new Map();
      this.logEvictions.set(record.ownerId, (this.logEvictions.get(record.ownerId) ?? 0) + 1);
    }
  }

  async listTerminalLogs(owner) {
    await this.ready;
    if (owner) {
      this.reconcileHostSessions(owner);
      for (const record of this.sessions.values()) if (record.ownerId === ownerKey(owner)) {
        if (record.adopted) await record.session.refresh();
        this.trackTerminalLog(owner, record.sessionId, record.session, record.environment, Boolean(record.adopted));
      }
    }
    if (this.localSession) this.trackTerminalLog(undefined, LOCAL_SESSION_ID, this.localSession, this.localSession.environment);
    this.pruneTerminalLogs();
    return { logs: [...(this.terminalLogs?.values() ?? [])].filter(record => visible(record, owner)).map(record => metadata(this, record)),
      retention: { storage: "process-memory", maxBytesPerTerminal: MAX_SCROLLBACK_BYTES, maxArchivedBytes: ARCHIVE_BYTES, maxArchivedLogs: 32, survivesRestart: false },
      evictedLogs: (this.logEvictions?.get(null) ?? 0) + (owner ? this.logEvictions?.get(ownerKey(owner)) ?? 0 : 0) };
  }

  async readTerminalLog(owner, args) {
    await this.listTerminalLogs(owner);
    const record = getLog(this, owner, args.logId), buffer = record.session.outputBuffer;
    if (args.streamId != null && args.streamId !== buffer.streamId) throw sessionError("TERMINAL_STREAM_CHANGED", "Log stream changed; refresh its metadata before reading");
    const cursor = args.cursor ?? buffer.startOffset, limit = args.maxChars ?? 16384;
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > buffer.endOffset || !Number.isSafeInteger(limit) || limit < 2 || limit > 65536) throw sessionError("TERMINAL_LOG_INVALID", "cursor must be within the raw stream; maxChars must be an integer 2-65536");
    const frame = readPage(buffer, Math.max(cursor, buffer.startOffset), limit, { stripAnsi: true });
    return { ...metadata(this, record), ...frame, text: logText(frame.text), truncated: buffer.startOffset > 0 || record.adopted,
      gap: cursor < buffer.startOffset, ansiStripped: true, format: "terminal-transcript", completion: "unknown" };
  }

  async exportTerminalLogs(owner, args = {}) {
    if (this.logExportBusy) throw sessionError("TERMINAL_LOG_BUSY", "A log export is being prepared; retry when it finishes");
    this.logExportBusy = true;
    try {
      const catalog = await this.listTerminalLogs(owner);
      if (args.all != null && typeof args.all !== "boolean") throw sessionError("TERMINAL_LOG_INVALID", "all must be a boolean");
      if (args.all === true && args.logIds != null) throw sessionError("TERMINAL_LOG_INVALID", "Choose all=true or logIds, not both");
      const ids = args.all === true ? catalog.logs.map(item => item.logId) : args.logIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > 32 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) throw sessionError("TERMINAL_LOG_INVALID", "Pass logIds as an array of 1-32 distinct IDs, or all=true when at most 32 logs are available");
      const format = args.format ?? (ids.length === 1 ? "txt" : "zip");
      if (!["txt", "zip"].includes(format) || format === "txt" && ids.length !== 1) throw sessionError("TERMINAL_LOG_INVALID", "format must be txt for one log, or zip for one or more logs");
      // Validate every owner before creating anything. Freeze each raw buffer before compression awaits.
      const records = ids.map(id => getLog(this, owner, id));
      if (records.reduce((sum, record) => sum + record.session.outputBuffer.byteLength, 0) > EXPORT_BYTES) throw sessionError("TERMINAL_LOG_TOO_LARGE", "Export exceeds 32 MiB of retained output; export fewer logs at a time");
      const exportedAt = new Date().toISOString();
      const snapshots = records.map(record => ({ item: metadata(this, record), raw: record.session.outputBuffer.value }));
      const entries = snapshots.map(({ item }, index) => ({ ...item, file: `${String(index + 1).padStart(2, "0")}-${safeName(item.name)}-${item.logId.slice(0, 8)}.txt` }));
      const manifest = { version: 1, exportedAt, format, retention: catalog.retention, evictedLogs: catalog.evictedLogs, logs: entries };
      const files = [];
      for (const [index, { item, raw }] of snapshots.entries()) {
        files.push({ name: entries[index].file, text: transcript(item, raw, exportedAt) });
        await yieldToIo();
      }
      const data = format === "txt" ? Buffer.from(files[0].text, "utf8") : await zipLogs([...files, { name: "manifest.json", text: JSON.stringify(manifest, null, 2) + "\n" }]);
      if (data.length > EXPORT_BYTES) throw sessionError("TERMINAL_LOG_TOO_LARGE", "Package exceeds 32 MiB; export fewer logs at a time");
      const id = randomUUID(), filename = format === "txt" ? entries[0].file : `remote-ops-logs-${exportedAt.replace(/[:.]/gu, "-")}.zip`;
      this.logExports ??= new Map();
      this.pruneLogExports(data.length);
      const downloadPath = `/api/dsh-remote-ops/log-download?exportId=${id}${owner ? `&sessionId=${encodeURIComponent(ownerKey(owner))}` : ""}`;
      const info = { exportId: id, filename, contentType: format === "txt" ? "text/plain; charset=utf-8" : "application/zip", bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"), exportedAt, expiresAt: new Date(Date.now() + EXPORT_TTL).toISOString(),
        downloadPath, downloadUrl: this.logDownloadOrigin ? new URL(downloadPath, this.logDownloadOrigin).href : null, manifest };
      this.logExports.set(id, { ownerId: ownerKey(owner), data, info });
      return info;
    } finally { this.logExportBusy = false; }
  }

  pruneLogExports(incomingBytes = 0) {
    let bytes = [...(this.logExports?.values() ?? [])].reduce((sum, item) => sum + item.data.length, 0);
    for (const [id, entry] of this.logExports ?? []) {
      if (Date.parse(entry.info.expiresAt) > Date.now() && this.logExports.size + (incomingBytes ? 1 : 0) <= 10 && bytes + incomingBytes <= EXPORT_BYTES) continue;
      this.logExports.delete(id); bytes -= entry.data.length;
    }
  }

  getLogExport(owner, id) {
    this.pruneLogExports();
    const entry = this.logExports?.get(id);
    if (!entry || entry.ownerId !== ownerKey(owner)) throw sessionError("TERMINAL_LOG_EXPORT_NOT_FOUND", "Export expired or is unavailable in this conversation; create a new export");
    return entry;
  }
};

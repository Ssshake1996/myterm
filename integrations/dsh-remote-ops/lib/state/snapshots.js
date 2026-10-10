import { PLUGIN_NAME, PLUGIN_VERSION } from "../version.js";
import { LOCAL_SESSION_ID, MAX_SESSIONS_PER_ENVIRONMENT } from "../constants.js";
import { ownerId } from "../common.js";

// What the UI and the model see: snapshots, the catalog, diagnostics events and tool receipts.
export const withSnapshots = (Base) => class SnapshotsLayer extends Base {
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

  controlSnapshot(session) {
    return { holder: session.inputHolder ?? "available", waiting: Boolean(session.pendingSend || session.active) };
  }
};

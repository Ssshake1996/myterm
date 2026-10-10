import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describeFailure } from "../diagnostics.js";
import { LOCAL_SESSION_ID } from "../constants.js";
import { normalizeGroupName, ownerId, sessionError } from "../common.js";

// Quick command groups and commands: persistence, ordering and the direct-dispatch button path.
export const withQuickCommands = (Base) => class QuickCommandsLayer extends Base {
  quickGroupDir(group) { return join(this.quickRoot, normalizeGroupName(group)); }

  quickFile(group) { const safe = normalizeGroupName(group); return join(this.quickGroupDir(safe), `commands.${safe}.json`); }

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

  quickGroupList() { return [...this.quickGroups].sort((a, b) => a.localeCompare(b)); }

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
};

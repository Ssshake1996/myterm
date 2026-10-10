import { DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS, resolveRenderOptions } from "../cli-profile.js";
import { readPage, renderOutput } from "../output-render.js";
import { performSend } from "../terminal-send.js";
import { AGENT_OUTPUT_CHARS, LOCAL_SESSION_ID, UI_SCROLLBACK_CHARS } from "../constants.js";
import { sessionError } from "../common.js";
import { AdoptedTerminalSession } from "../terminal-sessions.js";

// Reading and writing terminals: output frames, reads, input coordination, send, raw input and signals.
export const withTerminalIo = (Base) => class TerminalIoLayer extends Base {
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
};

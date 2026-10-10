import { AGENT_OUTPUT_CHARS, LOCAL_SESSION_ID, UI_SCROLLBACK_CHARS } from "./constants.js";
import { ownerId, sessionError, summarizeError } from "./common.js";
import {
  AUTO_SIGINT_MARKER, AUTO_SIGINT_SETTLE_MS, CONTAMINATION_TAIL_CHARS, PROMPT_TAIL_CHARS,
  buildPromptRules, detectContamination, matchPromptRule, resolveAssistOptions, stripAnsi,
} from "./cli-assist.js";
import { readPage, renderOutput } from "./output-render.js";
import { AdoptedTerminalSession } from "./terminal-sessions.js";

async function resolveSendTarget(state, owner, target, args) {
  if (!target && !args.environment) throw sessionError("REMOTE_SESSION_REQUIRED", "Pass session (SSH session id or local-cmd), or environment when opening on demand");
  if (!target && args.environment) {
    state.reconcileHostSessions(owner);
    const environment = state.findEnvironment(args.environment);
    if (environment && state.activeRemoteSessions(ownerId(owner), environment.id).length) target = state.getSession(owner, environment.id).sessionId;
  }
  const record = target === LOCAL_SESSION_ID
    ? { sessionId: LOCAL_SESSION_ID, session: await state.ensureLocalSession() }
    : target ? state.getSession(owner, target) : await state.open(owner, args.environment);
  return { target, record };
}

// Text printed since `scanFrom`, limited to the end of the stream where a prompt would sit.
function promptTail(session, streamId, scanFrom) {
  const buffer = session.outputBuffer;
  return buffer.streamId === streamId && scanFrom >= buffer.startOffset && scanFrom <= buffer.endOffset
    ? buffer.slice(Math.max(scanFrom, buffer.endOffset - PROMPT_TAIL_CHARS) - buffer.startOffset)
    : buffer.tail(PROMPT_TAIL_CHARS);
}

export async function performSend(state, owner, target, args) {
  await state.ready;
  resolveAssistOptions(args);
  const resolved = await resolveSendTarget(state, owner, target, args);
  target = resolved.target;
  const record = resolved.record;
  const session = record.session;
  const environment = record.environment ?? session.environment;
  const options = resolveAssistOptions(args, environment?.cliProfile);
  const rules = buildPromptRules(options);
  if (session instanceof AdoptedTerminalSession) await session.refresh();
  state.claimInput(session, args.actor, args.streamId);
  const startOffset = session.outputBuffer.endOffset;
  const streamId = session.outputBuffer.streamId;
  const submittedText = String(args.text ?? args.command ?? "");
  const submit = args.submit ?? args.newline ?? true;
  const quietMs = Math.max(0, Math.min(10_000, Number(args.quietMs ?? 700) || 0));
  const timeoutMs = Math.max(1, Math.min(300_000, (Number(args.timeoutSeconds ?? 30) || 30) * 1000));
  const deadline = Date.now() + timeoutMs;
  const runSend = async (request) => {
    const operation = target === LOCAL_SESSION_ID ? session.startSend(request) : state.ctx.terminals.startSend(owner, record.sessionId, request);
    session.pendingSend = operation;
    try { return await operation.done; } finally { if (session.pendingSend === operation) session.pendingSend = undefined; session.outputBuffer.notify(); }
  };
  let result = await runSend({ text: submittedText, submit, quietMs, timeoutMs, signal: args.signal });

  const autoActions = [];
  let sigintCleared = false;
  const noteAuto = (type, extra = {}) => {
    autoActions.push({ type, ...extra });
    if (owner) state.event(owner, `terminal.auto.${type}`, { sessionId: record.sessionId, environment: environment.name, ...extra });
  };
  if (rules.length) {
    const counts = new Map();
    let scanFrom = startOffset;
    while (result.waitReason === "inferred_idle" && !args.signal?.aborted && session.status().kind !== "exited") {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      if (session instanceof AdoptedTerminalSession) await session.refresh();
      const rule = matchPromptRule(promptTail(session, streamId, scanFrom), rules);
      const count = (counts.get(rule?.key) ?? 0) + 1;
      if (!rule || count > rule.limit) break;
      counts.set(rule.key, count);
      noteAuto(rule.kind, { count, ...(rule.kind === "answer" ? { answer: rule.index } : {}) });
      scanFrom = session.outputBuffer.endOffset;
      result = await runSend({ text: rule.text, submit: rule.submit, quietMs: rule.quietMs ?? quietMs, timeoutMs: remainingMs, signal: args.signal });
    }
  }
  if (options.autoSigint && result.waitReason !== "cancelled" && session.status().kind !== "exited" && session.outputBuffer.streamId === streamId) {
    const buffer = session.outputBuffer;
    const sentText = buffer.slice(Math.max(startOffset, buffer.startOffset, buffer.endOffset - CONTAMINATION_TAIL_CHARS) - buffer.startOffset);
    if (detectContamination(sentText)) {
      try {
        await state.signal(owner, record.sessionId, "SIGINT");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, AUTO_SIGINT_SETTLE_MS));
        noteAuto("sigint");
        sigintCleared = true;
      } catch (error) {
        noteAuto("sigint", { error: summarizeError(error) });
      }
    }
  }

  if (session instanceof AdoptedTerminalSession) await session.refresh();
  const replaced = streamId !== session.outputBuffer.streamId;
  const maxChars = Math.max(2, Math.min(UI_SCROLLBACK_CHARS, Number(args.maxChars) || AGENT_OUTPUT_CHARS));
  const page = readPage(session.outputBuffer, replaced ? undefined : startOffset, maxChars, options);
  const rendered = options.stripAnsi || options.headTailChars ? renderOutput(page, options) : undefined;
  const delta = {
    sessionId: record.sessionId, name: environment.name,
    kind: target === LOCAL_SESSION_ID ? "local" : "ssh", status: session.status(), completion: "unknown", format: "terminal-stream",
    ...page,
    ...(replaced ? { reset: true, truncated: true } : {}),
    ...(rendered ? { text: rendered.text, nextOffset: rendered.nextOffset, hasMore: rendered.hasMore } : {}),
  };
  if (owner) state.event(owner, target === LOCAL_SESSION_ID ? "local.send" : "ssh.send", { sessionId: record.sessionId, environment: delta.name, inputChars: submittedText.length, waitReason: result.waitReason });
  if (args.actor !== "manual") state.recordToolReceipt(owner, session, { ...delta, truncated: Boolean(delta.truncated || rendered?.summarized) }, "send");
  const { text, ...metadata } = delta;
  const output = sigintCleared ? `${text}${text && !/\n$/.test(text) ? "\n" : ""}${AUTO_SIGINT_MARKER}` : text;
  const viewport = args.includeViewport ? session.outputBuffer.tail(AGENT_OUTPUT_CHARS) : undefined;
  return {
    ...metadata, environment: delta.name, submittedText, submit, output, waitReason: result.waitReason, sessionStatus: result.sessionStatus,
    ...(rendered?.ansiStripped ? { ansiStripped: true } : {}),
    ...(rendered?.summarized ? { summarized: true, omitted: rendered.omitted } : {}),
    ...(autoActions.length ? { autoActions } : {}),
    ...(viewport !== undefined ? { viewport: options.stripAnsi ? stripAnsi(viewport) : viewport } : {}),
    ...(args.collectRaw === true ? { rawOutput: session.outputBuffer.readFrom(replaced ? undefined : startOffset, UI_SCROLLBACK_CHARS).text } : {}),
  };
}

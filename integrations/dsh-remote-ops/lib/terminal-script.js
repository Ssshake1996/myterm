import { stripAnsi } from "./ansi.js";
import { compileAnswers } from "./cli-assist.js";
import { compileUserPattern } from "./cli-profile.js";
import { sessionError, summarizeError } from "./common.js";

export const MAX_SCRIPT_STEPS = 20;
export const MAX_SCRIPT_SECONDS = 900;
const EXPECT_TAIL_CHARS = 2048;
const STOP_WAIT_REASONS = new Set(["timeout", "cancelled", "wait_stopped", "session_exit"]);
const STEP_RESULT_FIELDS = ["submittedText", "submit", "output", "waitReason", "sessionStatus", "autoActions", "streamId", "startOffset", "nextOffset", "endOffset", "hasMore", "reset", "truncated", "ansiStripped", "summarized", "omitted"];

function numberField(step, key, index, min, max) {
  if (step[key] === undefined) return undefined;
  const value = Number(step[key]);
  if (!Number.isFinite(value) || value < min || value > max) throw sessionError("SCRIPT_INVALID", `steps[${index}].${key} must be a number ${min}-${max}`);
  return value;
}

// Everything is compiled and checked before the first character is typed, so a typo in step 7 never leaves steps 1-6 half applied.
export function compileSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_SCRIPT_STEPS) throw sessionError("SCRIPT_INVALID", `steps must contain 1-${MAX_SCRIPT_STEPS} entries`);
  return steps.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) throw sessionError("SCRIPT_INVALID", `steps[${index}] must be an object`);
    if (typeof step.text !== "string") throw sessionError("SCRIPT_INVALID", `steps[${index}].text is required`);
    let answers;
    try { answers = compileAnswers(step.answers); } catch (error) { throw sessionError(error.code ?? "SCRIPT_INVALID", `steps[${index}]: ${String(error.message).replace(/^[A-Z_]+: /, "")}`); }
    return {
      index,
      text: step.text,
      submit: step.submit !== false,
      quietMs: numberField(step, "quietMs", index, 0, 10_000),
      timeoutSeconds: numberField(step, "timeoutSeconds", index, 1, 300),
      expect: step.expect === undefined ? undefined : compileUserPattern(step.expect, `steps[${index}].expect`, "SCRIPT_PATTERN_INVALID"),
      failOn: step.failOn === undefined ? undefined : compileUserPattern(step.failOn, `steps[${index}].failOn`, "SCRIPT_PATTERN_INVALID"),
      answers,
    };
  });
}

// Runs steps in order on one exact session through the normal send flow (so profiles, auto answers and output
// options all apply) and stops at the first step that errors, times out, fails a check or ends the session.
export async function runScript(state, owner, args) {
  await state.ready;
  if (typeof args.session !== "string" || !args.session) throw sessionError("REMOTE_SESSION_REQUIRED", "Pass an exact SSH session id or local-cmd as session");
  const steps = compileSteps(args.steps);
  const budgetMs = Math.max(1, Math.min(MAX_SCRIPT_SECONDS, Number(args.totalTimeoutSeconds ?? 300) || 300)) * 1000;
  const deadline = Date.now() + budgetMs;
  const results = [];
  let stopped;
  let target = { sessionId: args.session };
  for (const step of steps) {
    const remainingMs = deadline - Date.now();
    if (args.signal?.aborted) { stopped = { index: step.index, reason: "cancelled" }; break; }
    if (remainingMs <= 0) { stopped = { index: step.index, reason: "script_timeout" }; break; }
    let sent;
    try {
      sent = await state.send(owner, args.session, {
        ...args.sendOptions,
        text: step.text,
        submit: step.submit,
        ...(step.quietMs !== undefined ? { quietMs: step.quietMs } : {}),
        timeoutSeconds: Math.min(step.timeoutSeconds ?? args.sendOptions?.timeoutSeconds ?? 30, Math.max(1, Math.ceil(remainingMs / 1000))),
        answers: step.answers,
        collectRaw: true,
        signal: args.signal,
      });
    } catch (error) {
      if (!results.length) throw error;
      stopped = { index: step.index, reason: "error", code: error?.code, error: summarizeError(error) };
      break;
    }
    target = { sessionId: sent.sessionId, name: sent.name, kind: sent.kind };
    const record = { index: step.index, ok: true };
    for (const key of STEP_RESULT_FIELDS) if (sent[key] !== undefined) record[key] = sent[key];
    const seen = stripAnsi(sent.rawOutput ?? sent.output ?? "");
    results.push(record);
    if (step.failOn?.test(seen)) {
      record.ok = false;
      stopped = { index: step.index, reason: "fail_pattern", pattern: step.failOn.source };
      break;
    }
    if (step.expect) {
      record.expectMatched = step.expect.test(seen.slice(-EXPECT_TAIL_CHARS).replace(/\s+$/, ""));
      if (!record.expectMatched) {
        record.ok = false;
        stopped = { index: step.index, reason: "expect_mismatch", pattern: step.expect.source };
        break;
      }
    }
    if (STOP_WAIT_REASONS.has(sent.waitReason) || sent.sessionStatus?.kind === "exited") {
      record.ok = false;
      stopped = { index: step.index, reason: sent.waitReason === "inferred_idle" ? "session_exit" : sent.waitReason };
      break;
    }
  }
  const result = {
    ...target,
    completion: "unknown",
    ok: !stopped,
    total: steps.length,
    executed: results.length,
    ...(stopped ? { stopped } : {}),
    steps: results,
  };
  if (owner) state.event(owner, "terminal.script", { sessionId: target.sessionId, steps: steps.length, executed: results.length, ok: result.ok, ...(stopped ? { stopReason: stopped.reason, stopIndex: stopped.index } : {}) });
  return result;
}

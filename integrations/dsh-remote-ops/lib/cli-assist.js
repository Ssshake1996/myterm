import { stripAnsi } from "./ansi.js";
import { compileConfirmPattern, compileUserPattern, resolveRenderOptions } from "./cli-profile.js";
import { sessionError } from "./errors.js";

export { stripAnsi } from "./ansi.js";
export { DEFAULT_CONFIRM_PATTERN, compileConfirmPattern } from "./cli-profile.js";

export const MORE_PATTERN = /--More--[^\r\n]*$/;
export const CONTAMINATION_PATTERN = /\n\s+\^\s*\n\s*\[.*\=.*\]/m;
export const AUTO_SIGINT_MARKER = "[auto-sigint: command line cleared]";
export const MAX_AUTO_CONFIRMS = 3;
export const MAX_AUTO_QUITS = 3;
export const MAX_ANSWERS = 10;
export const MAX_ANSWER_TIMES = 5;
export const PROMPT_TAIL_CHARS = 4096;
export const CONTAMINATION_TAIL_CHARS = 2048;
export const AUTO_QUIT_QUIET_MS = 300;
export const AUTO_SIGINT_SETTLE_MS = 500;

// Script answers: [{ pattern, text, submit?, times? }] compiled once so a bad pattern fails before anything is typed.
export function compileAnswers(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ANSWERS) throw sessionError("TERMINAL_OPTION_INVALID", `answers must be an array of at most ${MAX_ANSWERS} entries`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw sessionError("TERMINAL_OPTION_INVALID", `answers[${index}] must be an object with pattern and text`);
    const pattern = compileUserPattern(entry.pattern, `answers[${index}].pattern`, "ANSWER_PATTERN_INVALID");
    if (typeof entry.text !== "string" || entry.text.length > 1024) throw sessionError("TERMINAL_OPTION_INVALID", `answers[${index}].text must be a string of at most 1024 characters`);
    const times = entry.times === undefined ? 1 : Number(entry.times);
    if (!Number.isInteger(times) || times < 1 || times > MAX_ANSWER_TIMES) throw sessionError("TERMINAL_OPTION_INVALID", `answers[${index}].times must be an integer 1-${MAX_ANSWER_TIMES}`);
    return { pattern, text: entry.text, submit: entry.submit !== false, times };
  });
}

// Only already-compiled answers (RegExp patterns) are honoured: JSON from a browser or model can never carry one.
const trustedAnswers = (answers) => Array.isArray(answers) ? answers.filter((entry) => entry?.pattern instanceof RegExp && typeof entry.text === "string") : [];

// Call arguments override the environment profile; manual (UI) sends never get automatic behaviour.
export function resolveAssistOptions(args = {}, profile) {
  const manual = args.actor === "manual";
  const pick = (key) => args[key] !== undefined && args[key] !== null ? args[key] : profile?.[key];
  const autoConfirm = !manual && pick("autoConfirm") === true;
  const render = manual ? { stripAnsi: false, headTailChars: 0 } : resolveRenderOptions(args, profile);
  return {
    autoConfirm,
    confirmPattern: autoConfirm ? compileConfirmPattern(args.confirmPattern ?? profile?.confirmPattern) : undefined,
    autoQuitMore: !manual && pick("autoQuitMore") === true,
    autoSigint: !manual && pick("autoSigint") !== false,
    ...render,
    answers: manual ? [] : trustedAnswers(args.answers),
  };
}

// Ordered by priority: pager first, then the (y/n) confirmation, then caller supplied answers.
export function buildPromptRules(options) {
  const rules = [];
  if (options.autoQuitMore) rules.push({ key: "quit-more", kind: "quit-more", match: (tail) => MORE_PATTERN.test(tail), text: "q", submit: false, quietMs: AUTO_QUIT_QUIET_MS, limit: MAX_AUTO_QUITS });
  if (options.autoConfirm) rules.push({ key: "confirm", kind: "confirm", match: (tail) => options.confirmPattern.test(tail), text: "y", submit: true, limit: MAX_AUTO_CONFIRMS });
  options.answers.forEach((answer, index) => rules.push({ key: `answer:${index}`, kind: "answer", index, match: (tail) => answer.pattern.test(tail), text: answer.text, submit: answer.submit, limit: answer.times }));
  return rules;
}

// First rule matching the end of the output decides; an exhausted rule stops the loop instead of falling through.
export function matchPromptRule(text, rules) {
  const tail = stripAnsi(text).replace(/\s+$/, "");
  return tail ? rules.find((rule) => rule.match(tail)) : undefined;
}

export function detectPrompt(text, options) {
  return matchPromptRule(text, buildPromptRules({ ...options, answers: options.answers ?? [] }))?.kind;
}

export function detectContamination(text) {
  const tail = String(text ?? "").slice(-CONTAMINATION_TAIL_CHARS);
  return CONTAMINATION_PATTERN.test(stripAnsi(tail).replace(/\r\n/g, "\n"));
}

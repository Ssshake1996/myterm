const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]|\u001b[=>78]/g;

export const DEFAULT_CONFIRM_PATTERN = /\(y\/n\)\s*$/i;
export const MORE_PATTERN = /--More--[^\r\n]*$/;
export const CONTAMINATION_PATTERN = /\n\s+\^\s*\n\s*\[.*\=.*\]/m;
export const AUTO_SIGINT_MARKER = "[auto-sigint: command line cleared]";
export const MAX_AUTO_CONFIRMS = 3;
export const MAX_AUTO_QUITS = 3;
export const PROMPT_TAIL_CHARS = 4096;
export const CONTAMINATION_TAIL_CHARS = 2048;
export const AUTO_QUIT_QUIET_MS = 300;
export const AUTO_SIGINT_SETTLE_MS = 500;

export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_RE, "");
}

export function compileConfirmPattern(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_CONFIRM_PATTERN;
  if (typeof value !== "string" || value.length > 512) throw patternError("confirmPattern must be a regular expression string of at most 512 characters");
  try { return new RegExp(value); } catch (error) { throw patternError(`confirmPattern is not a valid regular expression: ${error.message}`); }
}

function patternError(message) {
  const error = new Error(`AUTO_CONFIRM_PATTERN_INVALID: ${message}`);
  error.code = "AUTO_CONFIRM_PATTERN_INVALID";
  return error;
}

export function resolveAssistOptions(args = {}) {
  const manual = args.actor === "manual";
  const autoConfirm = !manual && args.autoConfirm === true;
  return {
    autoConfirm,
    confirmPattern: autoConfirm ? compileConfirmPattern(args.confirmPattern) : undefined,
    autoQuitMore: !manual && args.autoQuitMore === true,
    autoSigint: !manual && args.autoSigint !== false,
  };
}

export function detectPrompt(text, options) {
  const tail = stripAnsi(text).replace(/\s+$/, "");
  if (!tail) return undefined;
  if (options.autoQuitMore && MORE_PATTERN.test(tail)) return "quit-more";
  if (options.autoConfirm && options.confirmPattern.test(tail)) return "confirm";
  return undefined;
}

export function detectContamination(text) {
  const tail = String(text ?? "").slice(-CONTAMINATION_TAIL_CHARS);
  return CONTAMINATION_PATTERN.test(stripAnsi(tail).replace(/\r\n/g, "\n"));
}

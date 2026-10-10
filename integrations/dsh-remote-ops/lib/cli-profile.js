import { sessionError } from "./errors.js";

export const MIN_HEAD_TAIL_CHARS = 200;
export const MAX_HEAD_TAIL_CHARS = 100_000;
export const PROFILE_KEYS = ["autoQuitMore", "autoSigint", "stripAnsi", "headTailChars"];
// Options that existed in v0.2.24-v0.2.25. The plugin no longer answers (y/n) prompts by itself, so they are rejected, not ignored.
export const REMOVED_PROFILE_KEYS = ["autoConfirm", "confirmPattern"];
export const DEFAULT_TERMINAL_ROWS = 40;
export const DEFAULT_TERMINAL_COLS = 160;
export const TERMINAL_ROWS_RANGE = [10, 200];
export const TERMINAL_COLS_RANGE = [40, 500];

// A profile value equal to its default carries no information and is not stored.
const BOOLEAN_DEFAULTS = { autoQuitMore: false, autoSigint: true, stripAnsi: false };

export function compileUserPattern(value, label, code = "PATTERN_INVALID") {
  if (typeof value !== "string" || !value || value.length > 512) throw sessionError(code, `${label} must be a non-empty regular expression string of at most 512 characters`);
  try { return new RegExp(value); } catch (error) { throw sessionError(code, `${label} is not a valid regular expression: ${error.message}`); }
}

export function resolveHeadTail(value) {
  if (value === undefined || value === null || value === 0) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < MIN_HEAD_TAIL_CHARS || number > MAX_HEAD_TAIL_CHARS) throw sessionError("TERMINAL_OPTION_INVALID", `headTailChars must be 0 (off) or ${MIN_HEAD_TAIL_CHARS}-${MAX_HEAD_TAIL_CHARS}`);
  return Math.floor(number);
}

// Call arguments win over the environment profile; both fall back to the built-in defaults.
export function resolveRenderOptions(args = {}, profile) {
  const pick = (key) => args[key] !== undefined && args[key] !== null ? args[key] : profile?.[key];
  return { stripAnsi: pick("stripAnsi") === true, headTailChars: resolveHeadTail(pick("headTailChars")) };
}

export function validateCliProfile(value) {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["cliProfile must be an object"];
  const errors = [];
  for (const key of Object.keys(value)) {
    if (REMOVED_PROFILE_KEYS.includes(key)) errors.push(`cliProfile.${key} was removed: the plugin no longer answers (y/n) prompts automatically`);
    else if (!PROFILE_KEYS.includes(key)) errors.push(`cliProfile.${key} is not supported`);
  }
  for (const key of Object.keys(BOOLEAN_DEFAULTS)) if (value[key] !== undefined && typeof value[key] !== "boolean") errors.push(`cliProfile.${key} must be a boolean`);
  if (value.headTailChars !== undefined) {
    try { resolveHeadTail(value.headTailChars); } catch (error) { errors.push(`cliProfile.headTailChars: ${error.message}`); }
  }
  return errors;
}

// Tolerant counterpart of validateCliProfile for data read from disk: keep what is usable, drop the rest.
export function normalizeCliProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const profile = {};
  for (const [key, fallback] of Object.entries(BOOLEAN_DEFAULTS)) if (typeof value[key] === "boolean" && value[key] !== fallback) profile[key] = value[key];
  try { const chars = resolveHeadTail(value.headTailChars); if (chars) profile.headTailChars = chars; } catch { /* out-of-range value is dropped */ }
  return Object.keys(profile).length ? profile : undefined;
}

export function validateTerminalSize(value) {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["terminal must be an object"];
  const errors = [];
  for (const key of Object.keys(value)) if (key !== "rows" && key !== "cols") errors.push(`terminal.${key} is not supported`);
  const check = (key, [min, max]) => { if (value[key] !== undefined && (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)) errors.push(`terminal.${key} must be an integer ${min}-${max}`); };
  check("rows", TERMINAL_ROWS_RANGE);
  check("cols", TERMINAL_COLS_RANGE);
  return errors;
}

export function normalizeTerminalSize(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const size = {};
  if (Number.isInteger(value.rows) && value.rows >= TERMINAL_ROWS_RANGE[0] && value.rows <= TERMINAL_ROWS_RANGE[1] && value.rows !== DEFAULT_TERMINAL_ROWS) size.rows = value.rows;
  if (Number.isInteger(value.cols) && value.cols >= TERMINAL_COLS_RANGE[0] && value.cols <= TERMINAL_COLS_RANGE[1] && value.cols !== DEFAULT_TERMINAL_COLS) size.cols = value.cols;
  return Object.keys(size).length ? size : undefined;
}

import { homedir } from "node:os";
import { join } from "node:path";
import { CREDENTIAL_REF_RE, ID_RE, SESSION_NAME_PREFIX, TERMINAL_ENCODINGS } from "./constants.js";
import { validateCliProfile, validateTerminalSize } from "./cli-profile.js";

export { sessionError, summarizeError } from "./errors.js";

let sessionNameSequence = 0;
let environmentIdSequence = 0;

export function normalizeTerminalEncoding(value) {
  const normalized = String(value ?? "utf-8").trim().toLowerCase();
  return TERMINAL_ENCODINGS.has(normalized) ? normalized : "utf-8";
}
export function defaultPasswordRef(environmentId) {
  const suffix = String(environmentId ?? "").trim().replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `DSH_REMOTE_OPS_${suffix || "ENV"}_PASSWORD`;
}
export function resolveRemoteHome() { const configured = process.env.DSH_HOME?.trim(); return configured ? configured.replace(/^~(?=[\\/])/, homedir()) : join(homedir(), ".dsh"); }

export function normalizeGroupName(value) {
  const normalized = String(value ?? "default")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 64);
  return normalized || "default";
}

export function toLosslessJson(value) {
  const seen = new Set();
  const visit = (current, arrayItem = false) => {
    if (current === undefined) return arrayItem ? null : undefined;
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") return Number.isFinite(current) ? current : null;
    if (typeof current === "bigint") return current.toString();
    if (typeof current !== "object") return undefined;
    if (seen.has(current)) throw new TypeError("Tool output contains a circular value");
    seen.add(current);
    const result = Array.isArray(current) ? current.map((item) => visit(item, true)) : Object.fromEntries(Object.entries(current).flatMap(([key, item]) => {
      const normalized = visit(item);
      return normalized === undefined ? [] : [[key, normalized]];
    }));
    seen.delete(current);
    return result;
  };
  return visit(value) ?? null;
}

export function validateEnvironment(value) {
  const errors = [];
  if (!value || typeof value !== "object") return { ok: false, errors: ["environment must be an object"] };
  for (const field of ["id", "name", "host", "username"]) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0) errors.push(`${field} is required`);
  }
  if (typeof value.id === "string" && !ID_RE.test(value.id)) errors.push("id must contain only letters, numbers, dot, underscore or hyphen");
  if (value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)) errors.push("port must be 1-65535");
  if (value.privateKeyPath !== undefined && typeof value.privateKeyPath !== "string") errors.push("privateKeyPath must be a string");
  if (value.passwordRef !== undefined && typeof value.passwordRef !== "string") errors.push("passwordRef must be a string");
  if (typeof value.passwordRef === "string" && value.passwordRef !== "" && !CREDENTIAL_REF_RE.test(value.passwordRef)) errors.push("passwordRef must be a valid Harness credential reference");
  if (value.encoding !== undefined && !TERMINAL_ENCODINGS.has(String(value.encoding).trim().toLowerCase())) errors.push("encoding must be one of utf-8, gb18030, big5, windows-1252 or iso-8859-1");
  errors.push(...validateCliProfile(value.cliProfile), ...validateTerminalSize(value.terminal));
  return { ok: errors.length === 0, errors };
}

export function ownerId(owner) {
  const id = owner?.id;
  if (typeof id !== "string" || !id) throw new Error("REMOTE_AGENT_REQUIRED: an active Harness agent is required");
  return id;
}

export function newSessionName(environmentId) {
  sessionNameSequence += 1;
  return `${SESSION_NAME_PREFIX}${environmentId}-${Date.now().toString(36)}-${sessionNameSequence.toString(36)}`;
}

export function newEnvironmentId(host) {
  environmentIdSequence += 1;
  const safeHost = String(host ?? "environment").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 42) || "environment";
  return `env-${safeHost}-${Date.now().toString(36)}-${environmentIdSequence.toString(36)}`;
}

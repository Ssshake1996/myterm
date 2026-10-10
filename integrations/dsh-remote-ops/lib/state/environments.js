import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeCliProfile, normalizeTerminalSize } from "../cli-profile.js";
import { SESSION_NAME_PREFIX } from "../constants.js";
import { newEnvironmentId, normalizeGroupName, ownerId, sessionError } from "../common.js";

export function sanitizeStoredEnvironment(item) {
  if (!item || typeof item !== "object") return item;
  const { cliProfile, terminal, ...rest } = item;
  const profile = normalizeCliProfile(cliProfile), size = normalizeTerminalSize(terminal);
  return { ...rest, ...(profile ? { cliProfile: profile } : {}), ...(size ? { terminal: size } : {}) };
}

// Environment groups and environments: persistence, normalization, lookup and deletion.
export const withEnvironments = (Base) => class EnvironmentsLayer extends Base {
  groupDir(group) { return join(this.environmentRoot, normalizeGroupName(group)); }

  envFile(group) { const safe = normalizeGroupName(group); return join(this.groupDir(safe), `environments.${safe}.json`); }

  async saveGroup(group) { const safe = normalizeGroupName(group); await mkdir(this.groupDir(safe), { recursive: true }); await writeFile(this.envFile(safe), `${JSON.stringify(this.environments.get(safe) ?? [], null, 2)}\n`, "utf8"); }

  normalizeEnvironment(value) {
    const input = value && typeof value === "object" ? value : {};
    const host = String(input.host ?? "").trim();
    return { ...input, id: String(input.id ?? "").trim() || newEnvironmentId(host), name: String(input.name ?? "").trim() || host, host, username: String(input.username ?? "").trim(), group: normalizeGroupName(input.group) };
  }

  groupList() { return [...this.environments.keys()].sort((a, b) => a.localeCompare(b)); }

  async createGroup(name) { const group = normalizeGroupName(name); if (this.environments.has(group)) throw sessionError("REMOTE_GROUP_EXISTS", `Environment group already exists: ${group}`); this.environments.set(group, []); await this.saveGroup(group); return { group }; }

  async renameGroup(from, to) { const source = normalizeGroupName(from); const target = normalizeGroupName(to); if (!this.environments.has(source)) throw sessionError("REMOTE_GROUP_NOT_FOUND", source); if (source === target) return { group: target }; if (this.environments.has(target)) throw sessionError("REMOTE_GROUP_EXISTS", target); this.environments.set(target, (this.environments.get(source) ?? []).map((item) => ({ ...item, group: target }))); this.environments.delete(source); await this.saveGroup(target); await rm(this.groupDir(source), { recursive: true, force: true }); return { group: target }; }

  async deleteGroup(name) { const group = normalizeGroupName(name); const values = this.environments.get(group); if (!values) throw sessionError("REMOTE_GROUP_NOT_FOUND", group); if (values.length) throw sessionError("REMOTE_GROUP_NOT_EMPTY", `Environment group is not empty: ${group}`); this.environments.delete(group); await rm(this.groupDir(group), { recursive: true, force: true }); return { deleted: true, group }; }

  async saveEnvironment(value) {
    const normalized = this.normalizeEnvironment(value);
    const group = normalized.group;
    const previous = this.findEnvironment(normalized.id);
    const duplicate = this.allEnvironments().find((item) => item.id !== normalized.id && item.name === normalized.name);
    if (duplicate) throw sessionError("REMOTE_ENV_NAME_EXISTS", `Environment name already exists: ${normalized.name}`);
    const previousGroups = [];
    for (const [name, list] of this.environments) {
      const next = list.filter((item) => item.id !== normalized.id);
      if (next.length !== list.length) { this.environments.set(name, next); previousGroups.push(name); }
    }
    if (!this.environments.has(group)) this.environments.set(group, []);
    const saved = { ...previous, ...normalized, group };
    // A supplied profile/size replaces the stored one; an empty (all-default) value clears it; an absent field keeps it.
    for (const [key, normalize] of [["cliProfile", normalizeCliProfile], ["terminal", normalizeTerminalSize]]) {
      if (!Object.hasOwn(normalized, key)) continue;
      const clean = normalize(normalized[key]);
      if (clean) saved[key] = clean; else delete saved[key];
    }
    this.environments.set(group, [...this.environments.get(group), saved]);
    for (const name of new Set([...previousGroups, group])) await this.saveGroup(name);
    return this.findEnvironment(normalized.id);
  }

  allEnvironments() { return [...this.environments.entries()].flatMap(([group, values]) => values.map((value) => ({ ...value, group }))); }

  findEnvironment(idOrName) { return this.allEnvironments().find((value) => value.id === idOrName || value.name === idOrName); }

  findEnvironmentBySessionName(name) {
    const value = String(name ?? "");
    return this.findEnvironment(value) ?? [...this.allEnvironments()].sort((left, right) => right.id.length - left.id.length).find((environment) => value.startsWith(`${SESSION_NAME_PREFIX}${environment.id}-`));
  }

  async deleteEnvironment(owner, idOrName) {
    await this.ready;
    const target = this.findEnvironment(idOrName);
    if (!target) throw sessionError("REMOTE_ENV_NOT_FOUND", idOrName);
    const ownerKey = owner ? ownerId(owner) : undefined;
    for (const record of [...this.sessions.values()]) {
      if (record.environment.id === target.id && (!ownerKey || record.ownerId === ownerKey)) {
        await this.ctx.terminals.kill(record.owner, record.sessionId, "environment deleted").catch(() => {});
        this.sessions.delete(record.sessionId);
      }
    }
    for (const [group, list] of this.environments) {
      const next = list.filter((x) => x.id !== target.id);
      if (next.length !== list.length) {
        this.environments.set(group, next);
        await this.saveGroup(group);
      }
    }
    return { deleted: true, environment: target.name };
  }
};

import { mkdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { normalizeCliProfile, normalizeTerminalSize } from "../cli-profile.js";
import { SESSION_NAME_PREFIX } from "../constants.js";
import { newEnvironmentId, normalizeGroupName, ownerId, sessionError, validateEnvironment } from "../common.js";
import { storeNewPassword, validateKeyPassphrase, validateNewPassword, writeKeyPassphrase } from "../environment-password.js";

const UPDATE_FIELDS = new Set(["name", "host", "username", "group", "port", "privateKeyPath", "passwordRef", "password", "passphrase", "clearPassphrase", "encoding", "cliProfile", "terminal", "transport", "platform", "shell", "readyTimeoutMs", "hostKeySha256", "telnet", "serial"]);

export function sanitizeStoredEnvironment(item) {
  if (!item || typeof item !== "object") return item;
  const { cliProfile, terminal, passphrase, clearPassphrase, passphraseConfigured, ...rest } = item;
  const profile = normalizeCliProfile(cliProfile), size = normalizeTerminalSize(terminal);
  return { ...rest, ...(profile ? { cliProfile: profile } : {}), ...(size ? { terminal: size } : {}) };
}

// Publish new lists in memory only after every affected group was saved.
async function persistGroups(state, changes) {
  const written = [];
  try {
    for (const [group, list] of changes) {
      await state.saveGroup(group, list);
      written.push(group);
    }
  } catch (error) {
    for (const group of written.reverse()) {
      if (state.environments.has(group)) await state.saveGroup(group, state.environments.get(group));
      else {
        await rm(state.envFile(group), { force: true });
        await rmdir(state.groupDir(group)).catch(error => { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error; });
      }
    }
    throw error;
  }
  for (const [group, list] of changes) state.environments.set(group, list);
}

// Also used by delete. A failed definition write must leave the old key usable.
async function persistKeyChange(credentials, id, previousRef, passphrase, save) {
  if (passphrase === undefined) return save(previousRef);
  let previous;
  if (previousRef) {
    try { previous = (await credentials.resolve(previousRef))?.value; }
    catch { throw sessionError('SSH_KEY_CREDENTIALS_UNAVAILABLE', 'DSH 未能读取原私钥口令，请重试'); }
  }
  const ref = await writeKeyPassphrase(credentials, id, passphrase);
  try { return await save(ref); }
  catch (error) { await writeKeyPassphrase(credentials, id, previous); throw error; }
}

// Environment groups and environments: persistence, normalization, lookup and deletion.
export const withEnvironments = (Base) => class EnvironmentsLayer extends Base {
  queueEnvironmentChange(operation) {
    const next = (this.environmentChanges ?? Promise.resolve()).then(operation);
    this.environmentChanges = next.catch(() => {});
    return next;
  }
  groupDir(group) { return join(this.environmentRoot, normalizeGroupName(group)); }

  envFile(group) { const safe = normalizeGroupName(group); return join(this.groupDir(safe), `environments.${safe}.json`); }

  async saveGroup(group, values = this.environments.get(group) ?? []) {
    const file = this.envFile(group);
    const temp = file + "." + randomUUID() + ".tmp";
    await mkdir(this.groupDir(group), { recursive: true });
    try {
      await writeFile(temp, JSON.stringify(values, null, 2) + "\n", { mode: 0o600 });
      await rename(temp, file);
    } finally { await rm(temp, { force: true }); }
  }

  normalizeEnvironment(value) {
    const input = value && typeof value === "object" ? value : {};
    const host = String(input.host ?? "").trim();
    const endpoint = input.transport === "serial" ? String(input.serial?.path ?? "").trim() : host;
    const normalized = { ...input, id: String(input.id ?? "").trim() || newEnvironmentId(endpoint), name: String(input.name ?? "").trim() || endpoint, host, username: String(input.username ?? "").trim(), group: normalizeGroupName(input.group) };
    if (input.transport === "serial") {
      for (const key of ["host", "port", "username", "passwordRef", "privateKeyPath", "platform", "shell", "hostKeySha256", "telnet"]) delete normalized[key];
    } else {
      delete normalized.serial;
    }
    return normalized;
  }

  groupList() { return [...this.environments.keys()].sort((a, b) => a.localeCompare(b)); }

  createGroup(name) {
    return this.queueEnvironmentChange(async () => {
      const group = normalizeGroupName(name);
      if (this.environments.has(group)) throw sessionError("REMOTE_GROUP_EXISTS", `Environment group already exists: ${group}`);
      await this.saveGroup(group, []);
      this.environments.set(group, []);
      return { group };
    });
  }

  renameGroup(from, to) {
    return this.queueEnvironmentChange(async () => {
      const source = normalizeGroupName(from), target = normalizeGroupName(to);
      if (!this.environments.has(source)) throw sessionError("REMOTE_GROUP_NOT_FOUND", source);
      if (source === target) return { group: target };
      if (this.environments.has(target)) throw sessionError("REMOTE_GROUP_EXISTS", target);
      const values = this.environments.get(source).map(item => ({ ...item, group: target }));
      await this.saveGroup(target, values);
      await rm(this.groupDir(source), { recursive: true, force: true });
      this.environments.set(target, values);
      this.environments.delete(source);
      return { group: target };
    });
  }

  deleteGroup(name) {
    return this.queueEnvironmentChange(async () => {
      const group = normalizeGroupName(name), values = this.environments.get(group);
      if (!values) throw sessionError("REMOTE_GROUP_NOT_FOUND", group);
      if (values.length) throw sessionError("REMOTE_GROUP_NOT_EMPTY", `Environment group is not empty: ${group}`);
      await rm(this.groupDir(group), { recursive: true, force: true });
      this.environments.delete(group);
      return { deleted: true, group };
    });
  }

  async saveEnvironment(value) {
    const normalized = this.normalizeEnvironment(value);
    const group = normalized.group;
    const previous = this.findEnvironment(normalized.id);
    const duplicate = this.allEnvironments().find((item) => item.id !== normalized.id && item.name === normalized.name);
    if (duplicate) throw sessionError("REMOTE_ENV_NAME_EXISTS", `Environment name already exists: ${normalized.name}`);
    const saved = this.normalizeEnvironment({ ...previous, ...normalized, group });
    if (!saved.passphraseRef || !saved.privateKeyPath || (saved.transport ?? "ssh") !== "ssh") delete saved.passphraseRef;
    // A supplied profile/size replaces the stored one; an empty (all-default) value clears it; an absent field keeps it.
    for (const [key, normalize] of [["cliProfile", normalizeCliProfile], ["terminal", normalizeTerminalSize]]) {
      if (!Object.hasOwn(normalized, key)) continue;
      const clean = normalize(normalized[key]);
      if (clean) saved[key] = clean; else delete saved[key];
    }
    const changes = new Map();
    changes.set(group, [...(this.environments.get(group) ?? []).filter(item => item.id !== saved.id), saved]);
    for (const [name, list] of this.environments) {
      if (name !== group && list.some(item => item.id === saved.id)) changes.set(name, list.filter(item => item.id !== saved.id));
    }
    await persistGroups(this, changes);
    return this.findEnvironment(normalized.id);
  }

  saveEnvironmentWithPassword(value, password, key = {}) {
    return this.queueEnvironmentChange(() => {
      if (Object.hasOwn(value, 'passphraseRef')) throw sessionError('SSH_KEY_PASSPHRASE_INVALID', 'The private key credential reference is managed by DSH');
      return this.saveEnvironmentCredentials(value, password, key);
    });
  }

  async saveEnvironmentCredentials(value, password, { passphrase, clearPassphrase } = {}) {
    const environment = this.normalizeEnvironment(value);
    const previous = this.findEnvironment(environment.id);
    const effective = { ...previous, ...environment };
    const validation = validateEnvironment(environment);
    if (!validation.ok) throw sessionError("REMOTE_ENV_INVALID", validation.errors.join(", "));
    if (this.allEnvironments().some(item => item.id !== environment.id && item.name === environment.name)) throw sessionError("REMOTE_ENV_NAME_EXISTS", "Environment name already exists");
    if (environment.transport === "serial" && password != null) throw sessionError("REMOTE_ENV_INVALID", "Serial consoles accept login input in the terminal and have no saved transport password");
    validateKeyPassphrase(passphrase, clearPassphrase, effective);
    if (clearPassphrase && (effective.transport ?? 'ssh') !== 'ssh') throw sessionError('SSH_KEY_PASSPHRASE_INVALID', 'Only SSH environments have a key passphrase');
    const removeKey = previous?.passphraseRef && (clearPassphrase || (effective.transport ?? 'ssh') !== 'ssh' || !effective.privateKeyPath);
    const credentials = this.ctx.credentials;
    if ((passphrase && !credentials?.set) || (removeKey && !credentials?.unset)) throw sessionError('SSH_KEY_CREDENTIALS_UNAVAILABLE', 'DSH 私钥口令凭据服务不可用');
    const newPasswordRef = password != null ? await storeNewPassword(credentials, environment.id, password) : undefined;
    if (newPasswordRef) environment.passwordRef = newPasswordRef;
    try {
      return await persistKeyChange(credentials, environment.id, previous?.passphraseRef, removeKey ? '' : passphrase || undefined, ref => {
        environment.passphraseRef = ref;
        return this.saveEnvironment(environment);
      });
    } catch (error) {
      if (newPasswordRef) await credentials.unset?.(newPasswordRef);
      throw error;
    }
  }

  updateEnvironment(idOrName, changes) {
    return this.queueEnvironmentChange(() => this.updateSavedEnvironment(idOrName, changes));
  }
  async updateSavedEnvironment(idOrName, changes) {
    await this.ready;
    if (typeof idOrName !== "string" || !idOrName.trim()) throw sessionError("REMOTE_ENV_INVALID", "environment must be an existing environment id or name");
    const previous = this.findEnvironment(idOrName.trim());
    if (!previous) throw sessionError("REMOTE_ENV_NOT_FOUND", idOrName);
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw sessionError("REMOTE_ENV_INVALID", "changes must be an object");
    for (const key of Object.keys(changes)) if (!UPDATE_FIELDS.has(key)) throw sessionError("REMOTE_ENV_INVALID", `Unsupported update field: ${key}`);
    // Optional nulls are omission, not an instruction to erase persisted settings.
    const patch = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined && value !== null));
    if (!Object.keys(patch).length) throw sessionError("REMOTE_ENV_UPDATE_EMPTY", "Provide at least one field to update; omitted or null fields keep their saved values");
    const { password, passphrase, clearPassphrase } = patch;
    validateNewPassword(password, patch.passwordRef);
    delete patch.password;
    delete patch.passphrase;
    delete patch.clearPassphrase;
    if (patch.serial && typeof patch.serial === "object" && !Array.isArray(patch.serial)) patch.serial = { ...previous.serial, ...patch.serial };
    const protocol = patch.transport ?? previous.transport ?? "ssh";
    for (const key of ["name", "group", ...(protocol === "serial" ? [] : ["host"]), ...(protocol === "ssh" ? ["username"] : [])]) {
      if (Object.hasOwn(patch, key) && (typeof patch[key] !== "string" || !patch[key].trim())) throw sessionError("REMOTE_ENV_INVALID", `${key} must be a non-empty string`);
    }
    if (patch.passwordRef === "configured") throw sessionError("REMOTE_ENV_INVALID", "passwordRef 'configured' is a display marker. Omit it to keep the current credential, use a real reference to replace it, or an empty string to clear it");
    const value = this.normalizeEnvironment({ ...previous, ...patch, id: previous.id });
    const validation = validateEnvironment(value);
    if (!validation.ok) throw sessionError("REMOTE_ENV_INVALID", validation.errors.join(", "));
    // Saving replaces the definition; live connections keep the settings captured when they opened.
    return this.saveEnvironmentCredentials(value, password, { passphrase, clearPassphrase });
  }

  allEnvironments() { return [...this.environments.entries()].flatMap(([group, values]) => values.map((value) => ({ ...value, group }))); }

  findEnvironment(idOrName) { const values = this.allEnvironments(); return values.find(value => value.id === idOrName) ?? values.find(value => value.name === idOrName); }

  findEnvironmentBySessionName(name) {
    const value = String(name ?? "");
    return this.findEnvironment(value) ?? [...this.allEnvironments()].sort((left, right) => right.id.length - left.id.length).find((environment) => value.startsWith(`${SESSION_NAME_PREFIX}${environment.id}-`));
  }

  deleteEnvironment(owner, idOrName) {
    return this.queueEnvironmentChange(() => this.deleteSavedEnvironment(owner, idOrName));
  }
  async deleteSavedEnvironment(owner, idOrName) {
    await this.ready;
    const target = this.findEnvironment(idOrName);
    if (!target) throw sessionError("REMOTE_ENV_NOT_FOUND", idOrName);
    const changes = new Map();
    for (const [group, list] of this.environments) {
      if (list.some(item => item.id === target.id)) changes.set(group, list.filter(item => item.id !== target.id));
    }
    await persistKeyChange(this.ctx.credentials, target.id, target.passphraseRef, target.passphraseRef ? '' : undefined, () => persistGroups(this, changes));
    const ownerKey = owner ? ownerId(owner) : undefined;
    for (const record of [...this.sessions.values()]) {
      if (record.environment.id === target.id && (!ownerKey || record.ownerId === ownerKey)) {
        await this.ctx.terminals.kill(record.owner, record.sessionId, "environment deleted").catch(() => {});
        this.sessions.delete(record.sessionId);
      }
    }
    return { deleted: true, environment: target.name };
  }
};

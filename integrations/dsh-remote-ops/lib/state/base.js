import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { PLUGIN_VERSION } from "../version.js";
import { TransferManager } from "../transfers.js";
import { ROOT } from "../constants.js";
import { normalizeGroupName, resolveRemoteHome, summarizeError, validateEnvironment } from "../common.js";
import { sanitizeStoredEnvironment } from "./environments.js";

export class StateBase {
  constructor(ctx) {
    this.ctx = ctx;
    this.base = join(resolveRemoteHome(), ROOT);
    this.environmentRoot = join(this.base, "environments");
    this.quickRoot = join(this.base, "quick-commands");
    this.environments = new Map();
    this.quickCommands = [];
    this.quickGroups = new Set();
    this.quickWrites = Promise.resolve();
    this.quickReceipts = new Map();
    this.sessions = new Map();
    this.events = new Map();
    this.backendSessions = new Map();
    this.directEnvironments = new Map();
    this.openings = new Map();
    this.commands = new Map();
    this.localSession = undefined;
    this.toolWarnings = [];
    this.disconnects = new Map();
    this.localStarting = undefined;
    this.localError = "";
    this.disposed = false;
    this.release = { currentVersion: PLUGIN_VERSION, latestVersion: PLUGIN_VERSION, updateAvailable: false };
    this.releaseCheckedAt = 0;
    this.releaseCheckPromise = undefined;
    this.transfers = new TransferManager((endpoint, signal) => this.connectFiles(endpoint, signal));
    this.ready = this.load();
  }

  async load() {
    const executable = process.argv[1];
    if (executable) {
      const manifest = await readFile(join(dirname(executable), "..", "package.json"), "utf8").then(JSON.parse).catch(() => null);
      this.harnessVersion = manifest?.name === "@deepseek-ai/dsh" ? manifest.version : null;
    }
    await mkdir(this.base, { recursive: true });
    await mkdir(this.environmentRoot, { recursive: true });
    await mkdir(this.quickRoot, { recursive: true });
    const environmentDirs = await readdir(this.environmentRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of environmentDirs.filter((item) => item.isDirectory())) {
      const group = normalizeGroupName(entry.name);
      const data = await this.readJson(this.envFile(group), []);
      this.environments.set(group, Array.isArray(data) ? data.map(sanitizeStoredEnvironment).filter((item) => validateEnvironment(item).ok) : []);
    }
    const quickDirs = await readdir(this.quickRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of quickDirs.filter((item) => item.isDirectory())) {
      const group = normalizeGroupName(entry.name);
      this.quickGroups.add(group);
      const data = await this.readJson(this.quickFile(group), []);
      if (Array.isArray(data)) for (const item of data.filter(item => item && typeof item.id === "string")) {
        this.quickCommands.push({ pinned: true, confirm: false, order: this.quickCommands.length, revision: randomUUID(), ...item, group });
      }
    }
    await this.ensureLocalSession().catch((error) => { this.localError = summarizeError(error); });
  }

  async readJson(path, fallback) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; } }
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { BrowserSessions } from "./browser-sessions.js";
import { browserError, browserSteps, browserTarget, browserUrl } from "./browser-steps.js";

const identifier = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export const browserInstallerCli = () => join(dirname(createRequire(import.meta.url).resolve("playwright-core/package.json")), "cli.js");
export class BrowserWorkspace extends BrowserSessions {
  constructor({ root, credentials, launchContext } = {}) {
    super();
    this.root = root; this.credentials = credentials; this.launchContext = launchContext;
    this.sites = []; this.flows = []; this.sessions = new Map(); this.openings = new Map(); this.receipts = new Map();
    this.writes = Promise.resolve(); this.mutations = Promise.resolve(); this.disposed = false;
    this.ready = this.load(); void this.ready.catch(() => {});
  }
  async load() {
    await mkdir(this.root, { recursive: true });
    const read = async name => {
      try { const value = JSON.parse(await readFile(join(this.root, name), "utf8")); if (!Array.isArray(value)) throw new Error("expected an array"); return value; }
      catch (error) { if (error.code === "ENOENT") return []; throw browserError("BROWSER_STORE_INVALID", `Cannot read ${name}; restore or repair the file before saving`); }
    };
    this.sites = await read("sites.json"); this.flows = await read("flows.json");
  }
  persist(name, value) {
    const content = JSON.stringify(value, null, 2) + "\n";
    const pending = this.writes.then(async () => {
      const destination = join(this.root, name), temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, destination);
    });
    this.writes = pending.catch(() => {}); return pending;
  }
  mutate(operation) { const pending = this.mutations.then(operation); this.mutations = pending.catch(() => {}); return pending; }
  saveSite(input, password) { return this.mutate(() => this.saveSiteUnlocked(input, password)); }
  async saveSiteUnlocked(input, password) {
    await this.ready;
    const id = input.id ?? randomUUID();
    if (!identifier(id) || typeof input.name !== "string" || !input.name.trim() || input.name.length > 120) throw browserError("BROWSER_SITE_INVALID", "A site needs a name and a valid ID");
    if (!this.sites.some(site => site.id === id) && this.sites.length >= 100) throw browserError("BROWSER_SITE_LIMIT", "At most 100 sites are supported");
    const previous = this.sites.find(site => site.id === id);
    if ([...this.sessions.values()].some(record => !record.closed && record.site.id === id)) throw browserError("BROWSER_SITE_ACTIVE", "Close this site's browser before changing its configuration");
    const site = { id, name: input.name.trim(), url: browserUrl(input.url), browser: input.browser ?? "chromium", slowMo: Number(input.slowMo ?? 150), username: String(input.username ?? "").slice(0, 300) };
    if (!["chromium", "msedge", "chrome"].includes(site.browser) || !Number.isInteger(site.slowMo) || site.slowMo < 0 || site.slowMo > 1500) throw browserError("BROWSER_SITE_INVALID", "Choose Chromium/Edge/Chrome and a speed delay of 0–1500 ms");
    if (input.allowedOrigins !== undefined && !Array.isArray(input.allowedOrigins)) throw browserError("BROWSER_SITE_INVALID", "allowedOrigins must be a list of HTTP(S) origins");
    site.allowedOrigins = [...new Set([new URL(site.url).origin, ...(input.allowedOrigins ?? []).map(value => new URL(browserUrl(value)).origin)])].slice(0, 10);
    if (input.login) {
      site.login = Object.fromEntries(["username", "password", "submit", "success"].map(key => [key, browserTarget(input.login[key])]));
    }
    if (previous?.passwordRef) site.passwordRef = previous.passwordRef;
    if (password) {
      if (!this.credentials?.set) throw browserError("BROWSER_CREDENTIALS_UNAVAILABLE", "DSH credentials service is unavailable");
      site.passwordRef = `DSH_REMOTE_OPS_WEB_${id.replace(/-/g, "_").toUpperCase()}_PASSWORD`;
      await this.credentials.set(site.passwordRef, String(password));
    }
    const sites = [...this.sites.filter(item => item.id !== id), site];
    await this.persist("sites.json", sites); this.sites = sites; return site;
  }
  deleteSite(id) { return this.mutate(() => this.deleteSiteUnlocked(id)); }
  async deleteSiteUnlocked(id) {
    await this.ready;
    if ([...this.sessions.values()].some(record => !record.closed && record.site.id === id)) throw browserError("BROWSER_SITE_ACTIVE", "Close this site's browsers before deleting it");
    const sites = this.sites.filter(site => site.id !== id);
    await this.persist("sites.json", sites); this.sites = sites;
    const flows = this.flows.filter(flow => flow.siteId !== id);
    await this.persist("flows.json", flows); this.flows = flows; return { deleted: true };
  }
  saveFlow(input) { return this.mutate(() => this.saveFlowUnlocked(input)); }
  async saveFlowUnlocked(input) {
    await this.ready;
    const id = input.id ?? randomUUID(), site = this.sites.find(item => item.id === input.siteId);
    if (!identifier(id) || !site || typeof input.name !== "string" || !input.name.trim() || input.name.length > 120) throw browserError("BROWSER_FLOW_INVALID", "A flow needs a name and an existing site");
    if (this.flows.length >= 200 && !this.flows.some(item => item.id === id)) throw browserError("BROWSER_FLOW_LIMIT", "At most 200 flows are supported");
    const steps = browserSteps(input.steps);
    if (steps.some(step => step.secretRef && step.secretRef !== site.passwordRef)) throw browserError("BROWSER_CREDENTIAL_SCOPE", "A flow may reference only its site's password");
    const flow = { id, siteId: site.id, name: input.name.trim(), steps };
    const flows = [...this.flows.filter(item => item.id !== id), flow];
    await this.persist("flows.json", flows); this.flows = flows; return flow;
  }
  deleteFlow(id) { return this.mutate(() => this.deleteFlowUnlocked(id)); }
  async deleteFlowUnlocked(id) {
    await this.ready; const flows = this.flows.filter(flow => flow.id !== id);
    await this.persist("flows.json", flows); this.flows = flows; return { deleted: true };
  }
  async library() { return import("playwright-core"); }
  async runtime() {
    try {
      const { chromium } = await this.library();
      const executable = chromium.executablePath();
      const available = await access(executable).then(() => true, () => false);
      return { chromium: available, install: this.installation ?? { status: "idle" } };
    } catch { return { chromium: false, install: { status: "unavailable", error: "Install the plugin's playwright-core dependency" } }; }
  }
  install() { return this.mutate(() => this.installUnlocked()); }
  async installUnlocked() {
    if (this.disposed) throw browserError("BROWSER_DISPOSED", "The plugin is unloading");
    if (this.installation?.status === "installing") return this.installation;
    const { spawn } = await import("node:child_process");
    const cli = browserInstallerCli();
    this.installation = { status: "installing", output: "" };
    const processHandle = spawn(process.execPath, [cli, "install", "chromium"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.installer = processHandle;
    const output = data => { this.installation.output = (this.installation.output + data.toString()).slice(-3000); };
    processHandle.stdout.on("data", output); processHandle.stderr.on("data", output);
    processHandle.once("error", error => { this.installation = { status: "failed", error: error.message }; });
    processHandle.once("close", code => { if (this.installation.status === "installing") this.installation.status = code === 0 ? "completed" : "failed"; this.installer = undefined; });
    return this.installation;
  }
  profile(owner, siteId) { return join(this.root, "profiles", createHash("sha256").update(owner).digest("hex").slice(0, 24), siteId); }
  async saveStorage(record) {
    if (!record.context.storageState) return;
    const state = await record.context.storageState();
    const destination = join(this.profile(record.owner, record.site.id), "remote-ops-session.json"), temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ cookies: state.cookies }), { mode: 0o600 }); await rename(temporary, destination);
  }
  async launch(site, owner) {
    const profile = this.profile(owner, site.id);
    const options = { headless: false, slowMo: site.slowMo, viewport: null, ...(site.browser !== "chromium" ? { channel: site.browser } : {}) };
    if (this.launchContext) return this.launchContext(profile, options);
    const { chromium } = await this.library();
    try {
      const context = await chromium.launchPersistentContext(profile, options); context.setDefaultTimeout(10000);
      try { const saved = JSON.parse(await readFile(join(profile, "remote-ops-session.json"), "utf8")); if (Array.isArray(saved.cookies)) await context.addCookies(saved.cookies); } catch { /* An expired/unusable session is recovered by signing in again in the visible browser. */ }
      return context;
    }
    catch { throw browserError("BROWSER_LAUNCH_FAILED", `Cannot open ${site.browser}. Install Chromium in the Web workspace or choose installed Edge/Chrome. DSH must run in your interactive desktop session`); }
  }
  async dispose() {
    this.disposed = true; this.installer?.kill();
    await this.ready.catch(() => {});
    await Promise.allSettled([...this.openings.values()]);
    await Promise.allSettled([...this.sessions.values()].map(record => this.closeRecord(record)));
    await this.mutations; await this.writes;
  }
}

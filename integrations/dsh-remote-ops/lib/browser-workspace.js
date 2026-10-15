import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { BrowserSessions } from "./browser-sessions.js";
import { browserError, browserSteps, browserTarget, browserUrl } from "./browser-steps.js";
import { BrowserView, browserInput } from "./browser-view.js";
import { windowsDefaultBrowser } from './browser-default.js';
import { browserInstallerCli, browserRuntimeMetadata, browserRuntimeDirectory, inspectBrowserRuntime, writeBrowserRuntimeManifest } from './browser-runtime.js';

const identifier = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export { browserInstallerCli } from './browser-runtime.js';
export class BrowserWorkspace extends BrowserSessions {
  constructor({ root, credentials, launchContext } = {}) {
    super();
    this.root = root; this.credentials = credentials; this.launchContext = launchContext;
    this.sites = []; this.flows = []; this.sessions = new Map(); this.openings = new Map(); this.receipts = new Map();
    this.writes = Promise.resolve(); this.mutations = Promise.resolve(); this.disposed = false;
    this.ready = this.load(); void this.ready.catch(() => {});
    this.active = new Map(); this.ownerSignals = new Map(); this.preferences = { display: 'embedded', browser: 'chromium', windowBrowser: process.platform === 'win32' ? 'system' : 'chromium', viewport: 'panel' };
    this.systemBrowser = windowsDefaultBrowser;
  }
  async load() {
    await mkdir(this.root, { recursive: true });
    const read = async name => {
      try { const value = JSON.parse(await readFile(join(this.root, name), "utf8")); if (!Array.isArray(value)) throw new Error("expected an array"); return value; }
      catch (error) { if (error.code === "ENOENT") return []; throw browserError("BROWSER_STORE_INVALID", `Cannot read ${name}; restore or repair the file before saving`); }
    };
    this.sites = await read("sites.json"); this.flows = await read("flows.json");
    try { const saved=JSON.parse(await readFile(join(this.root,'preferences.json'),'utf8')); this.preferences=this.validatePreferences(saved); } catch(error) { if(error.code!=='ENOENT')throw error; }
  }
  validatePreferences(input) {
    const value={...this.preferences,...input};
    if(!['embedded','window'].includes(value.display)||!['chromium','msedge','chrome'].includes(value.browser)||!['system','chromium','msedge','chrome'].includes(value.windowBrowser)||!['panel','desktop'].includes(value.viewport??'panel'))throw browserError('BROWSER_DISPLAY_INVALID','Choose an embedded/window display, a supported browser and a panel/desktop viewport');
    return {display:value.display,browser:value.browser,windowBrowser:value.windowBrowser,viewport:value.viewport??'panel'};
  }
  savePreferences(input) { return this.mutate(async()=>{await this.ready;const value=this.validatePreferences(input);await this.persist('preferences.json',value);this.preferences=value;return value;}); }
  async openUrl(owner,value,options={}) {
    await this.ready;const url=browserUrl(value),origin=new URL(url).origin;
    const site={id:'url-'+createHash('sha256').update(origin).digest('hex').slice(0,24),name:new URL(url).host,url,browser:options.browser??'default',slowMo:80,allowedOrigins:[origin],temporary:true};
    const display=options.display??this.preferences.display;this.validatePreferences({display});
    const existing=[...this.sessions.values()].find(r=>r.owner===owner&&!r.closed&&r.site.id===site.id);
    const opened=await this.open(owner,site.id,{site,display});
    if(existing&&existing.pages.get(existing.activePageId)?.url()!==url)return this.navigate(owner,opened.id,'goto',url);
    return opened;
  }
  async frame(owner,id,options) {const r=this.session(owner,id);r.view??=new BrowserView(r);return r.view.frame(options);}
  input(owner,id,input) {
    const r=this.session(owner,id),pending=(r.inputQueue??Promise.resolve()).then(()=>browserInput(this,r,input));
    r.inputQueue=pending.catch(()=>{});return pending;
  }
  async resizeViewport(owner,id,input) {
    const r=this.session(owner,id),mode=input?.mode??r.viewport?.mode??'panel';
    const size=mode==='desktop'?{width:1024,height:768}:{width:input?.width,height:input?.height};
    if(!['panel','desktop'].includes(mode)||!Number.isSafeInteger(size.width)||!Number.isSafeInteger(size.height)||size.width<240||size.width>1600||size.height<180||size.height>1200) return Promise.reject(browserError('BROWSER_VIEWPORT_INVALID','Viewport must be 240–1600 × 180–1200 pixels'));
    const pending=(r.inputQueue??Promise.resolve()).then(async()=>{
      // An observer may finish after its viewer closes or switches to a window.
      // A valid, owner-scoped layout hint then becomes a no-op, never a new browser.
      if(r.closed||r.switching||r.display!=='embedded')return {...this.publicSession(r),viewportSkipped:true};
      if(r.viewport?.mode===mode&&r.viewport.width===size.width&&r.viewport.height===size.height)return this.publicSession(r);
      // Discard coordinates from the old viewport before accepting another input.
      r.revision=(r.revision??0)+1;
      try { await r.view?.stop(); await Promise.all([...r.pages.values()].map(page=>page.setViewportSize(size))); }
      catch(error){if(r.closed||r.switching)return {...this.publicSession(r),viewportSkipped:true};throw error;}
      r.viewport={mode,...size};
      if(this.preferences.viewport!==mode)await this.savePreferences({viewport:mode});
      return this.publicSession(r);
    });
    r.inputQueue=pending.catch(()=>{});return pending;
  }
  bindOwnerSignal(owner,signal) {
    const previous=this.ownerSignals.get(owner);if(previous?.signal===signal)return;
    previous?.signal.removeEventListener('abort',previous.abort);
    const abort=()=>{for(const r of this.sessions.values())if(r.owner===owner&&r.job&&!['completed','failed','unknown','stopped'].includes(r.job.status)){r.job.stop=true;r.job.status=r.job.inFlight?'stopping':'stopped';r.job.wake?.();}};
    this.ownerSignals.set(owner,{signal,abort});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
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
    const site = { id, name: input.name.trim(), url: browserUrl(input.url), browser: input.browser ?? "default", slowMo: Number(input.slowMo ?? 150), username: String(input.username ?? "").slice(0, 300) };
    if (!["default", "system", "chromium", "msedge", "chrome"].includes(site.browser) || !Number.isInteger(site.slowMo) || site.slowMo < 0 || site.slowMo > 1500) throw browserError("BROWSER_SITE_INVALID", "Choose the default browser, Chromium/Edge/Chrome and a speed delay of 0–1500 ms");
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
      return { ...await inspectBrowserRuntime({ root: this.root, chromium }), install: this.installation ?? { status: "idle" } };
    } catch { return { chromium: false, install: { status: "unavailable", error: "Install the plugin's playwright-core dependency" } }; }
  }
  install() { return this.mutate(() => this.installUnlocked()); }
  async installUnlocked() {
    if (this.disposed) throw browserError("BROWSER_DISPOSED", "The plugin is unloading");
    if (this.installation?.status === "installing") return this.installation;
    const current = await this.runtime();
    if (this.disposed) throw browserError('BROWSER_DISPOSED', 'The plugin is unloading');
    if (current.chromium) return this.installation = { status: 'completed', output: 'Chromium and Headless Shell are already ready; existing files were reused.' };
    const { spawn } = await import("node:child_process");
    const cli = browserInstallerCli();
    const metadata = browserRuntimeMetadata(), directory = browserRuntimeDirectory(this.root, metadata);
    await mkdir(directory, { recursive: true });
    const installation = this.installation = { status: "installing", output: "" };
    const processHandle = (this.spawnInstaller ?? spawn)(process.execPath, [cli, "install", "chromium"], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: directory }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.installer = processHandle;
    const output = data => { installation.output = (installation.output + data.toString()).slice(-3000); };
    processHandle.stdout.on("data", output); processHandle.stderr.on("data", output);
    processHandle.once("error", error => { installation.status = 'failed'; installation.error = error.message; });
    processHandle.once("close", async code => {
      try {
        if (this.disposed) { installation.status = 'cancelled'; return; }
        if (installation.status !== 'installing') return;
        if (code !== 0) throw new Error(`Chromium download failed (${code ?? 'terminated'}). Check the network/proxy and retry installation.`);
        await writeBrowserRuntimeManifest(directory, metadata);
        installation.status = 'completed';
      } catch (error) { installation.status = 'failed'; installation.error = error.message; }
      finally { if (this.installer === processHandle) this.installer = undefined; }
    });
    return this.installation;
  }
  profile(owner, siteId) { return join(this.root, "profiles", createHash("sha256").update(owner).digest("hex").slice(0, 24), siteId); }
  async saveStorage(record) {
    if (!record.context.storageState) return;
    const state = await record.context.storageState();
    const destination = join(this.profile(record.owner, record.site.id), "remote-ops-session.json"), temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ cookies: state.cookies }), { mode: 0o600 }); await rename(temporary, destination);
  }
  async launchOptions(site, display) {
    const selected = !site.browser || site.browser === 'default' ? (display === 'window' ? this.preferences.windowBrowser : this.preferences.browser) : site.browser;
    if (!['system', 'chromium', 'chrome', 'msedge'].includes(selected)) throw browserError('BROWSER_DISPLAY_INVALID', 'Choose a supported browser');
    const resolved = selected === 'system' ? await this.systemBrowser(new URL(site.url).protocol) : { browser: selected };
    const options = { headless: display === 'embedded', slowMo: site.slowMo, viewport: display === 'embedded' ? {width:1024,height:768} : null, ...(resolved.executablePath ? { executablePath: resolved.executablePath } : resolved.browser !== 'chromium' ? { channel: resolved.browser } : {}) };
    if (resolved.browser === 'chromium' && !this.launchContext) {
      const { chromium } = await this.library();
      const runtime = await inspectBrowserRuntime({ root: this.root, chromium }), mode = runtime.modes[display];
      if (!mode?.ready) throw browserError('BROWSER_RUNTIME_MISSING', `${display === 'embedded' ? 'Headless Shell for the plugin view' : 'Chromium for an independent window'} is missing or mismatched. Use remote_browser_runtime action=install (network required), poll action=status until the required mode is ready, or select installed Chrome/Edge in browser settings.`);
      options.executablePath = mode.executable;
    }
    return options;
  }
  async launch(site, owner, display = 'window', preparedOptions) {
    const profile = this.profile(owner, site.id), options = preparedOptions ?? await this.launchOptions(site, display);
    if (this.launchContext) return this.launchContext(profile, options);
    const { chromium } = await this.library();
    try {
      const context = await chromium.launchPersistentContext(profile, options); context.setDefaultTimeout(10000);
      try { const saved = JSON.parse(await readFile(join(profile, "remote-ops-session.json"), "utf8")); if (Array.isArray(saved.cookies)) await context.addCookies(saved.cookies); } catch { /* An expired/unusable session is recovered by signing in again in the visible browser. */ }
      return context;
    }
    catch { throw browserError("BROWSER_LAUNCH_FAILED", `Cannot open ${site.browser}. Install Chromium in browser settings or choose installed Edge/Chrome. Check browser runtime dependencies${display==='window'?'; independent windows require an interactive desktop session':''}`); }
  }
  async dispose() {
    this.disposed = true; this.installer?.kill();
    for(const {signal,abort} of this.ownerSignals.values())signal.removeEventListener('abort',abort);this.ownerSignals.clear();
    await this.ready.catch(() => {});
    await Promise.allSettled([...this.openings.values()]);
    await Promise.allSettled([...this.sessions.values()].map(record => this.closeRecord(record)));
    await this.mutations; await this.writes;
  }
}

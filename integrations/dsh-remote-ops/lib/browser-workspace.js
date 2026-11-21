import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { BrowserSessions } from "./browser-sessions.js";
import { browserError, browserSteps, browserTarget, browserUrl } from "./browser-steps.js";
import { BrowserView, browserInput } from "./browser-view.js";
import { BrowserRecordings } from './browser-recordings.js';
import { windowsDefaultBrowser } from './browser-default.js';
import { browserInstallerCli, browserRuntimeMetadata, browserRuntimeDirectory, inspectBrowserRuntime, writeBrowserRuntimeManifest } from './browser-runtime.js';
import { prepareEmbeddedBrowser } from './embedded-browser.js';
import { installBrowserScrollbars } from './browser-scrollbars.js';

const identifier = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const validViewport = size => size && [size.width,size.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 8192) && size.width * size.height <= 16777216;

// Adopt live browser handles without reviving removed layout modes or cached widths.
export function adoptBrowserWorkspace(workspace) {
  Object.setPrototypeOf(workspace, BrowserWorkspace.prototype);
  const ready = workspace.ready;
  workspace.ready = Promise.resolve(ready).then(async () => {
    await workspace.migratePreferences(workspace.preferences);
    for (const record of workspace.sessions.values()) {
      record.viewportHint = undefined;
      record.pendingViewport = undefined;
      if (record.view) Object.setPrototypeOf(record.view, BrowserView.prototype);
      if (!record.closed && record.display === 'embedded') await installBrowserScrollbars(record.context);
    }
    delete workspace.siteWidths; delete workspace.autoWidths;
  });
  void workspace.ready.catch(() => {});
  return workspace;
}
export { browserInstallerCli } from './browser-runtime.js';
export class BrowserWorkspace extends BrowserSessions {
  constructor({ root, credentials, launchContext, browserBundleRoot, browserCacheRoot } = {}) {
    super();
    this.root = root; this.credentials = credentials; this.launchContext = launchContext;
    this.browserBundleRoot = browserBundleRoot;
    this.browserCacheRoot = browserCacheRoot;
    this.recordings = new BrowserRecordings(this);
    this.sites = []; this.flows = []; this.sessions = new Map(); this.openings = new Map(); this.receipts = new Map();
    this.writes = Promise.resolve(); this.mutations = Promise.resolve(); this.disposed = false;
    this.ready = this.load(); void this.ready.catch(() => {});
    this.active = new Map(); this.ownerSignals = new Map(); this.preferences = { display: 'embedded', browser: 'chromium', windowBrowser: process.platform === 'win32' ? 'system' : 'chromium' };
    this.systemBrowser = windowsDefaultBrowser;
  }
  async load() {
    await mkdir(this.root, { recursive: true });
    const read = async name => {
      try { const value = JSON.parse(await readFile(join(this.root, name), "utf8")); if (!Array.isArray(value)) throw new Error("expected an array"); return value; }
      catch (error) { if (error.code === "ENOENT") return []; throw browserError("BROWSER_STORE_INVALID", `Cannot read ${name}; restore or repair the file before saving`); }
    };
    this.sites = await read("sites.json"); this.flows = await read("flows.json");
    try { await this.migratePreferences(JSON.parse(await readFile(join(this.root,'preferences.json'),'utf8'))); }
    catch(error) { if(error.code!=='ENOENT')throw error; }
  }
  validatePreferences(input) {
    const value={...this.preferences,...input};
    if(!['embedded','window'].includes(value.display)||!['chromium','msedge','chrome'].includes(value.browser)||!['system','chromium','msedge','chrome'].includes(value.windowBrowser))throw browserError('BROWSER_DISPLAY_INVALID','Choose an embedded/window display and a supported browser');
    return {display:value.display,browser:value.browser,windowBrowser:value.windowBrowser};
  }
  async migratePreferences(saved) {
    const next=this.validatePreferences(saved);
    if(JSON.stringify(saved)!==JSON.stringify(next))await this.persist('preferences.json',next);
    this.preferences=next;
  }
  // Only used before a visible panel has reported its dimensions.
  initialViewport() {return {width:1024,height:768};}
  async prepareNavigationViewport(record, page) {
    if (record.display !== 'embedded' || !page.setViewportSize) return;
    const hint=record.viewportHint, previous=page.viewportSize?.();
    const source=validViewport(hint)?hint:validViewport(record.viewport)?record.viewport:this.initialViewport();
    const size={width:source.width,height:source.height},active=page===record.pages.get(record.activePageId);
    if(previous?.width!==size.width||previous?.height!==size.height){
      if(active){record.revision++;record.observation=undefined;record.viewFocus=undefined;await record.view?.stop();}
      await page.setViewportSize(size);
    }
    if(active)record.viewport={mode:'panel',...size};
  }
  savePreferences(input) { return this.mutate(async()=>{await this.ready;const value=this.validatePreferences(input);await this.persist('preferences.json',value);this.preferences=value;return value;}); }
  async openUrl(owner,value,options={}) {
    await this.ready;const url=browserUrl(value),origin=new URL(url).origin;
    const site={id:'url-'+createHash('sha256').update(origin).digest('hex').slice(0,24),name:new URL(url).host,url,browser:options.browser??'default',slowMo:80,allowedOrigins:[origin],temporary:true};
    const display=options.display??(options.background ? 'embedded' : this.preferences.display);this.validatePreferences({display});
    const existing=[...this.sessions.values()].find(r=>r.owner===owner&&!r.closed&&r.site.id===site.id);
    const opened=await this.open(owner,site.id,{site,display,background:options.background});
    if (options.background) return existing || this.session(owner, opened.id).site.url !== url ?
      this.openBackgroundUrl(owner, opened.id, url) : { ...opened, pageId: opened.activePageId };
    if(existing&&existing.pages.get(existing.activePageId)?.url()!==url)return this.navigate(owner,opened.id,'goto',url,options.source??'agent');
    return opened;
  }
  async frame(owner, id, options) {
    await this.ready;
    const record = this.session(owner, id);
    await this.flushViewport(record);
    record.view ??= new BrowserView(record);
    const frame = await record.view.frame(options);
    return frame;
  }
  async recording(owner,args) {
    await this.ready;
    if(args.action==='start')return this.mutate(()=>this.recordings.start(owner,args.browserId,args.name));
    if(args.action==='read')return this.recordings.read(owner,args.recordingId,args.after??0,args.limit??100);
    const id=args.recordingId??this.session(owner,args.browserId).recording?.metadata.id;
    if(!id)throw browserError('BROWSER_RECORDING_ID_REQUIRED','Start or select a recording first');
    if(args.action==='stop')return this.mutate(()=>this.recordings.stop(owner,id));
    if(args.action==='export'){const {content,...result}=await this.recordings.export(owner,id);return result;}
    throw browserError('BROWSER_RECORDING_ACTION_INVALID','Use start, stop, read or export');
  }
  input(owner,id,input) {
    const r=this.session(owner,id),pending=(r.inputQueue??Promise.resolve()).then(async()=>{
      const handle=await this.recordings.begin(r,'human',input.kind,{pageId:input.pageId,revision:input.revision,...(['click','pointer'].includes(input.kind)?{x:input.x,y:input.y}:{}),...(input.kind==='pointer'?{phase:input.phase,gestureId:input.gestureId}:{}),...(input.kind==='key'?{key:input.key}:{}),...(input.kind==='text'?{input:'See the associated DOM interaction; values are captured at the target element.'}:{})});
      try {const result=await browserInput(this,r,input);await this.recordings.end(r,handle,result.cancelled?'cancelled':'dispatched',{accepted:result.accepted});return result;}
      catch(error){await this.recordings.end(r,handle,'unknown',{code:error.code??'BROWSER_INPUT_FAILED'});throw error;}
    });
    r.inputQueue=pending.catch(()=>{});return pending;
  }
  async resizeViewport(owner, id, input) {
    await this.ready;
    const r=this.session(owner,id);
    if(!validViewport(input))throw browserError('BROWSER_VIEWPORT_INVALID','Provide the visible panel width and height in whole CSS pixels (1–8192; at most 16777216 pixels total)');
    const pending=(r.inputQueue??Promise.resolve()).then(async()=>{
      const pageId=r.activePageId,page=r.pages.get(pageId);
      if(!page||r.closed||r.switching||r.display!=='embedded'||input.pageId&&input.pageId!==pageId)return {...this.publicSession(r),viewportSkipped:true};
      if(this.viewportProtected(r)){
        r.pendingViewport={input};
        return {...this.publicSession(r),viewportDeferred:true};
      }
      const size={width:input.width,height:input.height},previous=page.viewportSize?.()??r.viewport;
      if(previous?.width!==size.width||previous?.height!==size.height){
        r.revision=(r.revision??0)+1;r.observation=undefined;r.viewFocus=undefined;
        await r.view?.stop();
        try {await page.setViewportSize(size);}
        catch(error){if(r.closed||r.switching)return {...this.publicSession(r),viewportSkipped:true};throw error;}
      }
      r.viewport={mode:'panel',...size};
      r.viewportHint={...size,pageId};
      // A newer direct resize supersedes any deferred size from an earlier action.
      r.pendingViewport=undefined;
      return this.publicSession(r);
    });
    r.inputQueue=pending.catch(()=>{});return pending;
  }
  viewportProtected(record) {return record.observing||record.job?.inFlight;}
  async flushViewport(record) {
    if(!record.pendingViewport||this.viewportProtected(record)||record.closed||record.switching)return;
    const pending=record.pendingViewport;record.pendingViewport=undefined;
    await this.resizeViewport(record.owner,record.id,pending.input);
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
  prepareEmbedded(verify = false) {
    const state = this.embeddedPreparation ??= {};
    if (state.pending) return state.pending;
    if (state.result && !verify) return Promise.resolve(state.result);
    const preparing = () => { state.result = { ready: false, source: 'bundled', status: 'preparing' }; };
    if (!state.result?.ready) preparing();
    state.pending = Promise.resolve().then(() => prepareEmbeddedBrowser(browserRuntimeMetadata(), {
      bundleRoot: this.browserBundleRoot, cacheRoot: this.browserCacheRoot, onPrepare: preparing
    })).catch(error => ({ ready: false, source: 'bundled', status: 'failed', error: error.message }))
      .then(mode => state.result = mode).finally(() => { state.pending = undefined; });
    return state.pending;
  }
  async runtime(waitForEmbedded = false) {
    try {
      const { chromium } = await this.library();
      if (waitForEmbedded) await this.prepareEmbedded();
      else if (!this.embeddedPreparation) void this.prepareEmbedded();
      return { ...await inspectBrowserRuntime({ root: this.root, chromium, embedded: this.embeddedPreparation.result }), install: this.installation ?? { status: "idle" } };
    } catch (error) {
      return { chromium: false, modes: { embedded: { ready: false, status: 'failed', error: error.message } }, install: { status: 'unavailable', error: error.message } };
    }
  }
  install() { return this.mutate(() => this.installUnlocked()); }
  async installUnlocked() {
    if (this.disposed) throw browserError("BROWSER_DISPOSED", "The plugin is unloading");
    if (this.installation?.status === "installing") return this.installation;
    const current = await this.runtime(true);
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
    const options = { headless: display === 'embedded', slowMo: site.slowMo, viewport: display === 'embedded' ? this.initialViewport(site.url) : null, ...(display === 'embedded' ? {ignoreDefaultArgs:['--hide-scrollbars']} : {}), ...(resolved.executablePath ? { executablePath: resolved.executablePath } : resolved.browser !== 'chromium' ? { channel: resolved.browser } : {}) };
    if (resolved.browser === 'chromium' && !this.launchContext) {
      const { chromium } = await this.library();
      const embedded = display === 'embedded' ? await this.prepareEmbedded(true) : this.embeddedPreparation?.result;
      const runtime = await inspectBrowserRuntime({ root: this.root, chromium, embedded, bundleRoot: this.browserBundleRoot }), mode = runtime.modes[display];
      if (!mode?.ready) throw browserError('BROWSER_RUNTIME_MISSING', display === 'embedded'
        ? `插件内 Chromium 自动准备失败：${mode?.error ?? '缺少匹配的随包文件'}。可在网页设置中重试离线修复。`
        : '独立窗口的专用 Chromium 尚未安装。可在网页设置中安装，或选择本机已有的浏览器。');
      options.executablePath = mode.executable;
    }
    return options;
  }
  async launch(site, owner, display = 'window', preparedOptions) {
    const profile = this.profile(owner, site.id), options = preparedOptions ?? await this.launchOptions(site, display);
    if (this.launchContext) {
      const context = await this.launchContext(profile, options);
      if (display === 'embedded') await installBrowserScrollbars(context);
      return context;
    }
    const { chromium } = await this.library();
    try {
      const context = await chromium.launchPersistentContext(profile, options); context.setDefaultTimeout(10000);
      if (display === 'embedded') await installBrowserScrollbars(context);
      try { const saved = JSON.parse(await readFile(join(profile, "remote-ops-session.json"), "utf8")); if (Array.isArray(saved.cookies)) await context.addCookies(saved.cookies); } catch { /* An expired/unusable session is recovered by signing in again in the visible browser. */ }
      return context;
    }
    catch (error) {
      const cause = String(error.code || error.message).split('\n', 1)[0].slice(0, 300);
      throw browserError("BROWSER_LAUNCH_FAILED", `无法启动${display === 'embedded' ? '插件内浏览器' : '独立窗口浏览器'}。${cause}`);
    }
  }
  async dispose() {
    this.disposed = true; this.installer?.kill();
    for(const {signal,abort} of this.ownerSignals.values())signal.removeEventListener('abort',abort);this.ownerSignals.clear();
    await this.ready.catch(() => {});
    await this.embeddedPreparation?.pending;
    await Promise.allSettled([...this.openings.values()]);
    await Promise.allSettled([...this.sessions.values()].map(record => this.closeRecord(record)));
    await this.mutations; await this.writes; await this.recordings.writes;
  }
}

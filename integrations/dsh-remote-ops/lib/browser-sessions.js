import { randomUUID, createHash } from "node:crypto";
import { browserError, browserSteps, browserUrl, displayUrl, expandBrowserSteps, locateBrowser, executeBrowserStep } from "./browser-steps.js";

const finished = job => !job || ["completed", "failed", "unknown", "stopped"].includes(job.status);
export class BrowserSessions {
  session(owner, id) {
    const record = this.sessions.get(id);
    if (!owner || !record || record.owner !== owner) throw browserError("BROWSER_SESSION_NOT_FOUND", "No browser session belongs to this DSH conversation");
    return record;
  }
  redact(record, value) {
    let text = String(value ?? "");
    for (const secret of record.secrets) if (secret) text = text.split(secret).join("[redacted]");
    return text;
  }
  async secret(record, page, reference, target) {
    if (reference !== record.site.passwordRef) throw browserError("BROWSER_CREDENTIAL_SCOPE", "Only this site's saved password is accessible");
    if (!record.site.allowedOrigins.includes(new URL(page.url()).origin)) throw browserError("BROWSER_CREDENTIAL_ORIGIN", "The current page is outside this site's credential origins");
    const destination = await locateBrowser(page, target).evaluate(node => ({ origin: node.ownerDocument.location.origin }));
    if (!record.site.allowedOrigins.includes(destination.origin)) throw browserError("BROWSER_CREDENTIAL_ORIGIN", "The target frame is outside this site's credential origins");
    const secret = await this.credentials?.resolve?.(reference);
    if (!secret?.value) throw browserError("BROWSER_CREDENTIAL_MISSING", "Save the site password or log in manually");
    record.secrets.add(secret.value); record.secretTargets.push({ page, target }); return secret.value;
  }
  attachPage(record, page) {
    for (const [id, existing] of record.pages) if (existing === page) return id;
    const id = randomUUID(); record.pages.set(id, page); if (!record.activePageId || finished(record.job)) record.activePageId = id;
    page.on("dialog", dialog => { record.dialog = dialog; });
    page.on("close", () => { record.pages.delete(id); if (record.activePageId === id) record.activePageId = record.pages.keys().next().value; if (!record.pages.size) { record.closed = true; record.job?.wake?.(); } });
    return id;
  }
  async open(owner, siteId) {
    await this.ready;
    if (!owner || typeof owner !== "string") throw browserError("BROWSER_OWNER_REQUIRED", "Select a DSH conversation first");
    if (this.disposed) throw browserError("BROWSER_DISPOSED", "The plugin is unloading");
    const key = `${owner}:${siteId}`;
    if (this.openings.has(key)) return this.openings.get(key);
    const existing = [...this.sessions.values()].find(record => !record.closed && record.owner === owner && record.site.id === siteId);
    if (existing) { await existing.pages.get(existing.activePageId)?.bringToFront(); return this.publicSession(existing); }
    const site = this.sites.find(item => item.id === siteId);
    if (!site) throw browserError("BROWSER_SITE_NOT_FOUND", "Save a web site first");
    const active = [...this.sessions.values()].filter(record => !record.closed);
    if (active.filter(record => record.owner === owner).length + [...this.openings.keys()].filter(key => key.startsWith(`${owner}:`)).length >= 3 || active.length + this.openings.size >= 8) throw browserError("BROWSER_SESSION_LIMIT", "Maximum 3 browsers per conversation, 8 per plugin");
    const opening = (async () => {
      const context = await this.launch(site, owner);
      if (this.disposed) { await context.close(); throw browserError("BROWSER_DISPOSED", "The plugin is unloading"); }
      const record = { id: randomUUID(), owner, site, context, pages: new Map(), holder: "available", secrets: new Set(), secretTargets: [], closed: false, createdAt: new Date().toISOString(), history: [] };
      this.sessions.set(record.id, record);
      context.on("page", page => this.attachPage(record, page));
      context.on("close", () => { record.closed = true; record.job?.wake?.(); });
      for (const page of context.pages()) this.attachPage(record, page);
      const page = record.pages.values().next().value ?? await context.newPage();
      this.attachPage(record, page);
      try { await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 30000 }); }
      catch { record.notice = "The browser opened, but navigation did not finish. Inspect the visible page before continuing"; }
      for (const [id, old] of this.sessions) if (old.closed && this.sessions.size > 24) this.sessions.delete(id);
      return this.publicSession(record);
    })();
    this.openings.set(key, opening);
    try { return await opening; } finally { this.openings.delete(key); }
  }
  publicSession(record) {
    return { id: record.id, siteId: record.site.id, name: record.site.name, closed: record.closed, holder: record.holder, activePageId: record.activePageId,
      pages: [...record.pages].map(([id, page]) => ({ id, url: displayUrl(page.url()), active: id === record.activePageId })),
      job: record.job ? this.publicJob(record, record.job) : null, history: record.history.slice(-15), notice: record.notice ?? "",
      dialog: record.dialog ? { type: record.dialog.type(), message: this.redact(record, record.dialog.message()).slice(0, 1000) } : null,
      screenshotAt: record.screenshot?.at ?? null };
  }
  publicJob(record, job) {
    return { id: job.id, status: job.status, index: job.index, count: job.steps.length, results: job.results, error: job.error ?? null, startedAt: job.startedAt, finishedAt: job.finishedAt ?? null, inFlight: job.inFlight };
  }
  snapshot(owner) { return { sites: this.sites, flows: this.flows, sessions: [...this.sessions.values()].filter(record => record.owner === owner).map(record => this.publicSession(record)) }; }
  async run(owner, id, source, { requestId = randomUUID(), mode = "run", variables = {}, pageId } = {}) {
    await this.ready;
    const record = this.session(owner, id);
    if (record.closed) throw browserError("BROWSER_CLOSED", "Open a new browser; nothing was replayed");
    const flow = typeof source === "string" ? this.flows.find(item => item.id === source && item.siteId === record.site.id) : undefined;
    if (typeof source === "string" && !flow) throw browserError("BROWSER_FLOW_NOT_FOUND", "Choose a flow for this site");
    const steps = expandBrowserSteps(browserSteps(flow?.steps ?? source), variables);
    if (typeof requestId !== "string" || !requestId || requestId.length > 160) throw browserError("BROWSER_REQUEST_INVALID", "Use a request ID up to 160 characters");
    const hash = createHash("sha256").update(JSON.stringify({ steps, mode, pageId })).digest("hex"), key = `${owner}:${id}:${requestId}`;
    for (const [receiptKey, receipt] of this.receipts) if (finished(receipt.job) && (Date.now() - receipt.at > 600000 || this.receipts.size > 100)) this.receipts.delete(receiptKey);
    const previous = this.receipts.get(key);
    if (previous) { if (previous.hash !== hash) throw browserError("BROWSER_REQUEST_CONFLICT", "This request ID already has a different operation"); return previous.job; }
    if (record.holder === "manual") throw browserError("BROWSER_MANUAL_CONTROL", "The user controls this browser; release control before automation");
    if (!finished(record.job)) throw browserError("BROWSER_BUSY", "Pause or finish the current flow before starting another");
    if (!["run", "step"].includes(mode) || !record.pages.has(pageId ?? record.activePageId)) throw browserError("BROWSER_PAGE_INVALID", "Choose an existing page and run/step mode");
    const job = { id: randomUUID(), steps, pageId: pageId ?? record.activePageId, index: 0, status: mode === "step" ? "paused" : "running", paused: mode === "step", results: [], startedAt: new Date().toISOString(), inFlight: false };
    record.job = job; record.holder = "agent";
    this.receipts.set(key, { at: Date.now(), hash, job });
    job.done = this.execute(record, job); void job.done.catch(() => {});
    return job;
  }
  async execute(record, job) {
    let duration = 0;
    try {
      while (job.index < job.steps.length && !job.stop && !record.closed) {
        if (job.paused || record.holder === "manual") {
          job.status = record.holder === "manual" ? "manual" : "paused";
          await new Promise(resolve => { job.wake = resolve; }); job.wake = undefined; continue;
        }
        job.status = "running"; job.inFlight = true;
        const started = Date.now();
        try {
          const result = await executeBrowserStep(this, record, job, job.steps[job.index]);
          job.results.push({ index: job.index + 1, ...result, durationMs: Date.now() - started }); job.index++;
          if (job.single) { job.single = false; job.paused = true; }
        } finally { job.inFlight = false; duration += Date.now() - started; }
        if (record.wantManual) { record.wantManual = false; record.holder = "manual"; job.paused = true; }
        if (duration > 300000) throw browserError("BROWSER_FLOW_TIMEOUT", "The flow reached its five-minute active execution limit");
      }
      job.status = job.stop || record.closed ? "stopped" : "completed";
    } catch (error) {
      job.status = job.effectStarted ? "unknown" : "failed";
      job.error = { code: error.code ?? "BROWSER_OPERATION_FAILED", message: this.redact(record, error.message).slice(0, 1800), ...(job.effectStarted ? { note: "An effect may already have happened. Inspect the page; this step will not be retried automatically" } : {}) };
    } finally {
      job.finishedAt = new Date().toISOString();
      if (record.wantManual) { record.wantManual = false; record.holder = "manual"; }
      if (record.holder !== "manual") record.holder = "available";
      record.history.push(this.publicJob(record, job)); record.history = record.history.slice(-15);
      if (!record.closed) await this.saveStorage(record).catch(() => { record.notice = "Unable to save the login session; you may need to log in again after closing the browser"; });
      if (!record.closed) await this.capture(record).catch(() => {});
    }
    return this.publicJob(record, job);
  }
  async login(owner, id, options = {}) {
    const record = this.session(owner, id), login = record.site.login;
    if (!login || !record.site.passwordRef) throw browserError("BROWSER_LOGIN_CONFIG_REQUIRED", "Configure login locators and a password, or take over and log in manually");
    const page = record.pages.get(record.activePageId), success = locateBrowser(page, login.success);
    if (await success.count() === 1 && await success.isVisible()) return { authenticated: true };
    return this.run(owner, id, [{ action: "fill", target: login.username, value: record.site.username }, { action: "fill", target: login.password, secretRef: record.site.passwordRef }, { action: "click", target: login.submit, expect: { target: login.success } }], options);
  }
  async control(owner, id, action, value) {
    const record = this.session(owner, id), job = record.job;
    if (action === "close") { await this.closeRecord(record); return this.publicSession(record); }
    if (record.closed) throw browserError("BROWSER_CLOSED", "This browser was closed");
    if (action === "focus") await record.pages.get(record.activePageId)?.bringToFront();
    else if (action === "select-page") {
      if (job?.inFlight || !finished(job) && !job.paused) throw browserError("BROWSER_BUSY", "Pause before switching the automation page");
      if (!record.pages.has(value)) throw browserError("BROWSER_PAGE_INVALID", "The page is no longer open");
      record.activePageId = value; if (job && !finished(job)) job.pageId = value;
    } else if (["dialog-accept", "dialog-dismiss"].includes(action)) {
      if (!record.dialog) throw browserError("BROWSER_DIALOG_MISSING", "No browser dialog is pending");
      await record.dialog[action === "dialog-accept" ? "accept" : "dismiss"](); record.dialog = undefined;
    } else if (action === "takeover") {
      if (job?.inFlight) { record.wantManual = true; job.paused = true; job.status = "pausing"; }
      else { record.holder = "manual"; if (!finished(job)) { job.paused = true; job.status = "manual"; } }
    } else if (action === "release") {
      if (record.wantManual || job?.inFlight) throw browserError("BROWSER_BUSY", "Wait for the current action before releasing control");
      await this.observe(owner, id); await this.saveStorage(record); record.holder = "available";
      if (!finished(job)) { job.paused = true; job.status = "paused"; }
    } else if (["pause", "resume", "step", "stop"].includes(action)) {
      if (finished(job)) throw browserError("BROWSER_JOB_FINISHED", "Start a flow first");
      if (["resume", "step"].includes(action) && (record.holder === "manual" || record.wantManual)) throw browserError("BROWSER_MANUAL_CONTROL", "Release manual control first");
      if (action === "pause") { job.paused = true; job.status = job.inFlight ? "pausing" : "paused"; }
      if (action === "resume" || action === "step") { job.paused = false; job.single = action === "step"; record.holder = "agent"; job.status = "running"; }
      if (action === "stop") { job.stop = true; job.status = job.inFlight ? "stopping" : "stopped"; }
      job.wake?.();
    } else if (action !== "focus") throw browserError("BROWSER_CONTROL_INVALID", "Unknown browser control");
    return this.publicSession(record);
  }
  async observe(owner, id) {
    const record = this.session(owner, id), page = record.pages.get(record.activePageId);
    if (!page || record.closed) throw browserError("BROWSER_CLOSED", "The page was closed");
    const content = await page.evaluate(() => ({
      text: (document.body?.innerText ?? "").slice(0, 16000),
      elements: [...document.querySelectorAll('button,a,input,textarea,select,[role="button"],[contenteditable="true"]')].slice(0, 100).map(node => ({ tag: node.tagName.toLowerCase(), id: node.id, type: node.getAttribute("type"), role: node.getAttribute("role"), name: node.getAttribute("aria-label") || node.labels?.[0]?.innerText || node.getAttribute("placeholder") || (node.matches("button,a") ? node.innerText.slice(0, 100) : "") })),
    }));
    const clean = value => typeof value === "string" ? this.redact(record, value) : Array.isArray(value) ? value.map(clean) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)])) : value;
    return { pageId: record.activePageId, url: displayUrl(page.url()), title: this.redact(record, await page.title()), ...clean(content) };
  }
  async testTarget(owner, id, target) {
    const record = this.session(owner, id), page = record.pages.get(record.activePageId);
    if (record.job?.inFlight) throw browserError("BROWSER_BUSY", "Wait for the current action");
    const locator = locateBrowser(page, target), count = await locator.count();
    if (count === 1) await locator.highlight();
    return { count, unique: count === 1, pageId: record.activePageId };
  }
  async capture(record) {
    const page = record.pages.get(record.activePageId);
    if (!page || record.closed) throw browserError("BROWSER_CLOSED", "No active page");
    const masks = [page.locator('input,textarea,[contenteditable="true"]'), ...record.secretTargets.filter(item => item.page === page).map(item => locateBrowser(page, item.target)), ...[...record.secrets].map(secret => page.getByText(secret, { exact: false }))];
    if (record.site.login) masks.push(locateBrowser(page, record.site.login.password));
    const buffer = await page.screenshot({ type: "png", mask: masks, timeout: 5000 });
    record.screenshot = { at: new Date().toISOString(), pageId: record.activePageId, buffer }; return record.screenshot;
  }
  async closeRecord(record) {
    if (record.job && !finished(record.job)) { record.job.stop = true; record.job.wake?.(); }
    if (!record.closed) await this.saveStorage(record).catch(() => { record.notice = "Unable to save the login session"; });
    record.closed = true;
    await record.context.close().catch(() => {}); await record.job?.done;
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { browserError } from './browser-steps.js';
import { installRecordingObserver } from './browser-recording-client.js';

const BINDING = '__remoteOpsRecordingEventV2';
const MAX_EVENTS = 10000;
const MAX_BYTES = 16 * 1024 * 1024;
const idPattern = /^[a-f0-9-]{36}$/;
export function recordingUrl(value) {
  try {
    const url = new URL(value); if (!['http:', 'https:', 'about:'].includes(url.protocol)) return '[unsupported URL]';
    url.username = ''; url.password = '';
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[redacted]');
    if (url.hash.includes('?')) url.hash = url.hash.split('?')[0] + '?[redacted]';
    return url.href;
  } catch { return '[unavailable URL]'; }
}
function deviceLocation(url, deviceOrigin) {
  if (deviceOrigin) {
    try {
      const parsed = new URL(url);
      if (parsed.origin === deviceOrigin) return { url, devicePath: parsed.pathname + parsed.search + parsed.hash };
    } catch { /* Unsupported or unavailable URLs have no device-relative route. */ }
  }
  return { url };
}
function frameSelector(node) {
  const tag = node.tagName.toLowerCase(), root = node.getRootNode();
  for (const attribute of ['data-testid', 'name', 'title', 'id']) {
    const value = node.getAttribute(attribute);
    if (!value) continue;
    const css = attribute === 'id' ? '#' + CSS.escape(value) : tag + '[' + attribute + '="' + CSS.escape(value) + '"]';
    if (root.querySelectorAll(css).length === 1) return css;
  }
  if (root.querySelectorAll(tag).length === 1) return tag;
  const parts = [];
  for (let current = node; current; current = current.parentElement) {
    const siblings = current.parentNode?.children;
    parts.unshift(current.tagName.toLowerCase() + (siblings?.length > 1 ? ':nth-child(' + ([...siblings].indexOf(current) + 1) + ')' : ''));
  }
  return parts.join(' > ');
}
async function describeTarget(raw, frame, sensitive) {
  if (!raw) return undefined;
  const target = { tag: String(raw.tag ?? '').slice(0, 50), type: String(raw.type ?? '').slice(0, 50), role: String(raw.role ?? '').slice(0, 100), name: String(raw.name ?? '').slice(0, 500), label: String(raw.label ?? '').slice(0, 500), css: String(raw.css ?? '').slice(0, 2000), shadowHosts: Array.isArray(raw.shadowHosts) ? raw.shadowHosts.slice(0, 10).map(value => String(value).slice(0, 500)) : [], sensitive };
  if (!Array.isArray(raw.locators)) return target;
  const candidates = raw.locators.slice(0, 8).filter(item => item && typeof item.value === 'string' && item.value.length <= 2000 && ['testId', 'label', 'role', 'placeholder', 'css'].includes(item.kind));
  // The browser observer can count exact DOM selectors at dispatch. Check semantic
  // candidates using Chromium's automation engine while the document still exists.
  const scope = target.shadowHosts.reduce((parent, host) => parent?.locator?.('css=' + host), frame);
  const reference = target.css && scope?.locator?.('css=' + target.css);
  target.locators = await Promise.all(candidates.map(async item => {
    const candidate = { kind: item.kind, value: item.value, ...(item.kind === 'role' && item.name != null ? { name: String(item.name).slice(0, 500) } : {}) };
    if (item.kind !== 'role' && item.kind !== 'label') return { ...candidate, match: ['unique', 'ambiguous'].includes(item.match) ? item.match : 'unverified' };
    let match = 'unverified';
    if (reference) try {
      const locator = item.kind === 'role' ? scope.getByRole(candidate.value, candidate.name === undefined ? {} : { name: candidate.name, exact: true }) : scope.getByLabel(candidate.value, { exact: true });
      const count = await locator.count();
      if (count > 1) match = 'ambiguous';
      else if (count === 1 && await reference.and(locator).count() === 1) match = 'unique';
    } catch { /* A re-render or navigation can remove the original element. */ }
    return { ...candidate, match };
  }));
  return target;
}
export function adoptBrowserRecordings(workspace) {
  workspace.recordings ??= new BrowserRecordings(workspace);
  Object.setPrototypeOf(workspace.recordings, BrowserRecordings.prototype);
  return workspace.recordings;
}
export class BrowserRecordings {
  constructor(workspace) { this.workspace = workspace; this.active = new Map(); this.writes = Promise.resolve(); this.observedPages = new WeakSet(); }
  observePage(record, page, pageId) {
    this.observedPages ??= new WeakSet();
    if (this.observedPages.has(page)) return;
    this.observedPages.add(page);
    const context = record.context;
    page.on('framenavigated', frame => { if (record.context === context) void this.append(record, { kind: 'navigation', source: 'browser', status: 'observed', pageId, mainFrame: frame === page.mainFrame(), url: recordingUrl(frame.url()) }); });
    page.on('close', () => { if (record.context === context) void this.append(record, { kind: 'page', action: 'close', source: 'browser', status: 'observed', pageId }); });
  }
  directory(owner) {
    if (typeof owner !== 'string' || !owner) throw browserError('BROWSER_OWNER_REQUIRED', 'Select a DSH conversation');
    return join(this.workspace.root, 'recordings', createHash('sha256').update(owner).digest('hex'));
  }
  file(owner, id, suffix = 'json') {
    if (!idPattern.test(id ?? '')) throw browserError('BROWSER_RECORDING_ID_INVALID', 'Use a recording ID returned by start/read');
    return join(this.directory(owner), `${id}.${suffix}`);
  }
  clean(record, value) {
    if (typeof value === 'string') return this.workspace.redact(record, value).slice(0, 16000);
    if (Array.isArray(value)) return value.slice(0, 100).map(item => this.clean(record, item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.clean(record, item)]));
    return value;
  }
  summary(record) { return record.recording ? { ...record.recording.metadata, error: record.recording.error ?? null } : null; }
  queue(recording, task) {
    const pending = this.writes.then(task);
    this.writes = pending.catch(error => { recording.error = `Recording persistence failed: ${error.code ?? 'IO_ERROR'}`; recording.metadata.status = 'error'; });
    return pending;
  }
  async save(recording) {
    const path = this.file(recording.owner, recording.metadata.id), temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(recording.metadata, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, path);
  }
  append(record, event, expectedId) {
    const recording = record.recording;
    if (!recording || recording.metadata.status !== 'recording' || expectedId && recording.metadata.id !== expectedId) return Promise.resolve();
    return this.queue(recording, async () => {
      if (recording.metadata.status !== 'recording') return;
      const location = event.url ? deviceLocation(event.url, recording.metadata.deviceOrigin) : {};
      const line = JSON.stringify(this.clean(record, { ...event, ...location, seq: recording.metadata.eventCount + 1, at: new Date().toISOString() })) + '\n';
      if (recording.metadata.eventCount >= MAX_EVENTS || recording.bytes + Buffer.byteLength(line) > MAX_BYTES) {
        recording.metadata.status = 'limited'; recording.metadata.stoppedAt = new Date().toISOString(); recording.metadata.reason = 'recording-size-limit'; await this.save(recording); return;
      }
      await appendFile(this.file(recording.owner, recording.metadata.id, 'jsonl'), line, { mode: 0o600 });
      recording.bytes += Buffer.byteLength(line); recording.metadata.eventCount++; await this.save(recording);
    }).catch(() => {});
  }
  async install(record) {
    const context = record.context;
    for (const [pageId, page] of record.pages) this.observePage(record, page, pageId);
    if (context.__remoteOpsRecorderInstalled === BINDING) return;
    await context.exposeBinding(BINDING, async (source, payload) => {
      const recording = record.recording;
      if (record.context !== context || !recording || recording.metadata.status !== 'recording') return {};
      if (payload?.action === 'ready') return { recordingId: recording.metadata.id };
      if (payload?.recordingId !== recording.metadata.id || !['click','fill','select','check','press','scroll','hover','contextmenu','dragstart','drop','feedback'].includes(payload?.action)) return {};
      const pageId = [...record.pages].find(([, page]) => page === source.page)?.[0]; if (!pageId) return {};
      const operation = [...recording.operations.values()].filter(item => item.pageId === pageId).at(-1);
      const url = recordingUrl(source.frame.url());
      const frames = [];
      for (let frame = source.frame; frame && frame !== source.page.mainFrame(); frame = frame.parentFrame()) {
        let selector = null;
        try { const element = await frame.frameElement(); try { selector = await element.evaluate(frameSelector); } finally { await element.dispose(); } } catch { /* navigation may detach a frame */ }
        frames.unshift({ ...deviceLocation(recordingUrl(frame.url()), recording.metadata.deviceOrigin), name: frame.name(), selector });
      }
      // DOM events during a dispatched operation can also be concurrent human
      // input. Correlation is evidence, never proof of exclusive authorship.
      const sensitive = !!payload.target?.sensitive || record.secrets.has(payload.input?.value);
      const target = await describeTarget(payload.target, source.frame, sensitive);
      const observation = payload.action === 'feedback';
      const event = { kind: observation ? 'observation' : 'interaction', source: operation || observation ? 'browser' : 'human', ...(operation ? { duringActionId: operation.actionId } : {}), status: 'observed', pageId, frame: frames, url, action: payload.action, observedAt: String(payload.observedAt ?? '').slice(0, 40), target };
      if (observation) {
        event.feedback = sensitive || payload.feedback?.redacted ? { redacted: true } : { text: String(payload.feedback?.text ?? '').slice(0, 500), truncated: !!payload.feedback?.truncated };
      } else {
        if (sensitive || payload.input?.redacted) event.input = { redacted: true, reason: 'sensitive-or-file-input' };
        else if (payload.input) event.input = { value: String(payload.input.value ?? '').slice(0, 16000), truncated: !!payload.input.truncated || String(payload.input.value ?? '').length > 16000, ...(typeof payload.input.checked === 'boolean' ? { checked: payload.input.checked } : {}) };
        if (payload.action === 'press') event.key = String(payload.key ?? '').slice(0, 100);
        if (payload.pointer) {
          const { x, y, button, count, relative } = payload.pointer;
          event.pointer = { x: Number(x), y: Number(y), button: Number(button), count: Number(count) };
          if (relative && [relative.x, relative.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) event.pointer.relative = { x: relative.x, y: relative.y };
        }
        if (payload.position) event.position = { x: Number(payload.position.x), y: Number(payload.position.y) };
      }
      await this.append(record, event, recording.metadata.id);
      return {};
    });
    await context.addInitScript(installRecordingObserver, BINDING);
    context.__remoteOpsRecorderInstalled = BINDING;
  }
  async configurePages(record, id) {
    const results = await Promise.allSettled([...record.pages.values()].flatMap(page => page.frames().map(async frame => {
      await frame.evaluate(installRecordingObserver, BINDING);
      await frame.evaluate(value => window.__remoteOpsRecordingObserver.configure(value), id);
    })));
    return results.filter(result => result.status === 'rejected').length;
  }
  async start(owner, browserId, name) {
    const record = this.workspace.session(owner, browserId);
    if (record.closed || record.switching) throw browserError('BROWSER_CLOSED', 'Open a browser before recording');
    if (record.recording?.metadata.status === 'recording') return this.summary(record);
    if (record.recording) this.active.delete(record.recording.metadata.id);
    if (name != null && (typeof name !== 'string' || name.length > 120)) throw browserError('BROWSER_RECORDING_NAME_INVALID', 'Use a name up to 120 characters');
    const deviceOrigin = new URL(record.site.url).origin;
    const metadata = { schemaVersion: 1, id: randomUUID(), name: name?.trim() || 'Web recording', browserId: record.id, deviceOrigin, startedAt: new Date().toISOString(), status: 'recording', eventCount: 0, initialPages: [...record.pages].map(([pageId, page]) => ({ pageId, ...deviceLocation(recordingUrl(page.url()), deviceOrigin) })), coverage: { agentSteps: true, documentInteractions: true, browserChrome: false, notes: ['DOM events are observations, not business assertions.', 'Changed visible status, alert, live and output regions can supply observed feedback.', 'Interactions inside closed shadow roots, browser UI and native file pickers may need manual reconstruction.', 'Input values are bounded; sensitive fields and URL query values are redacted.'] } };
    await mkdir(this.directory(owner), { recursive: true });
    const recording = { metadata, owner, bytes: 0, operations: new Map() }; record.recording = recording;
    try {
      await this.save(recording); await writeFile(this.file(owner, metadata.id, 'jsonl'), '', { mode: 0o600 });
      await this.install(record); const missing = await this.configurePages(record, metadata.id);
      if (missing) await this.append(record, { kind: 'gap', source: 'browser', status: 'unknown', reason: 'document-observer-unavailable', count: missing });
      this.active.set(metadata.id, record); return this.summary(record);
    } catch (error) { metadata.status = 'error'; metadata.reason = 'observer-installation-failed'; await this.save(recording); throw error; }
  }
  async stop(owner, id, reason = 'requested') {
    const record = this.active.get(id);
    if (!record || record.owner !== owner) return (await this.read(owner, id, 0, 1)).recording;
    const recording = record.recording;
    if (recording.metadata.status === 'recording') {
      await record.inputQueue;
      await this.configurePages(record, null);
      await this.writes;
      if (recording.metadata.status !== 'recording') return this.summary(record);
      recording.metadata.status = 'stopped'; recording.metadata.stoppedAt = new Date().toISOString(); recording.metadata.reason = reason;
      recording.metadata.unfinishedActionIds = [...recording.operations.values()].map(value => value.actionId);
      await this.queue(recording, () => this.save(recording));
    }
    this.active.delete(id);
    return this.summary(record);
  }
  async read(owner, id, after = 0, limit = 100) {
    await this.writes;
    if (!id) {
      let names; try { names = await readdir(this.directory(owner)); } catch (error) { if (error.code === 'ENOENT') return { recordings: [] }; throw error; }
      const recordings = await Promise.all(names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(async name => {
        const saved = JSON.parse(await readFile(join(this.directory(owner), name), 'utf8'));
        const metadata = this.active.has(saved.id) ? this.summary(this.active.get(saved.id)) : saved;
        if (metadata.status === 'recording' && !this.active.has(metadata.id)) return { ...metadata, status: 'interrupted', reason: 'process-ended' };
        return metadata;
      }));
      return { recordings: recordings.sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
    }
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw browserError('BROWSER_RECORDING_CURSOR_INVALID', 'after must be nonnegative and limit 1–200');
    let recording, lines;
    try { recording = JSON.parse(await readFile(this.file(owner, id), 'utf8')); lines = (await readFile(this.file(owner, id, 'jsonl'), 'utf8')).split('\n').filter(Boolean); }
    catch (error) { if (error.code === 'ENOENT') throw browserError('BROWSER_RECORDING_NOT_FOUND', 'No recording belongs to this conversation'); throw error; }
    const events = []; let incompleteTail = false, lastSeq = 0;
    for (let index = 0; index < lines.length; index++) {
      try { const event = JSON.parse(lines[index]); lastSeq = event.seq; if (event.seq > after) events.push(event); }
      catch { if (index !== lines.length - 1) throw browserError('BROWSER_RECORDING_CORRUPT', 'Recording journal is damaged'); incompleteTail = true; }
    }
    if (this.active.has(id)) recording = this.summary(this.active.get(id));
    else if (recording.status === 'recording') recording = { ...recording, status: 'interrupted', reason: 'process-ended' };
    // A crash can leave a complete journal line before its metadata update.
    recording = { ...recording, eventCount: lastSeq };
    const selected = events.slice(0, limit);
    return { recording, events: selected, nextAfter: selected.at(-1)?.seq ?? after, hasMore: events.length > limit, incompleteTail };
  }
  async export(owner, id) {
    const first = await this.read(owner, id, 0, 200);
    if (!first.recording) throw browserError('BROWSER_RECORDING_ID_REQUIRED', 'Choose a recording to export');
    const boundary = first.recording.eventCount;
    const events = first.events.filter(event => event.seq <= boundary); let cursor = first;
    while (cursor.hasMore && cursor.nextAfter < boundary) { cursor = await this.read(owner, id, cursor.nextAfter, 200); events.push(...cursor.events.filter(event => event.seq <= boundary)); }
    const content = JSON.stringify({ format: 'myterm.web-recording', schemaVersion: 1, exportedAt: new Date().toISOString(), recording: first.recording, incompleteTail: cursor.incompleteTail, events }, null, 2) + '\n';
    const path = this.file(owner, id, 'export.json'); await writeFile(path, content, { mode: 0o600 });
    return { recordingId: id, fileName: `myterm-web-${id}.json`, path, bytes: Buffer.byteLength(content), content };
  }
  async begin(record, source, action, details = {}, pageId = record.activePageId) {
    if (record.recording?.metadata.status !== 'recording') return null;
    const handle = { recordingId: record.recording.metadata.id, actionId: randomUUID(), pageId };
    record.recording.operations.set(handle.actionId, handle);
    await this.append(record, { kind: 'action', phase: 'before', source, action, actionId: handle.actionId, pageId, url: recordingUrl(record.pages.get(pageId)?.url()), details }, handle.recordingId);
    return handle;
  }
  async end(record, handle, status, result) {
    if (!handle) return;
    // Flush debounced input while the operation is still correlated. Otherwise
    // a quick Agent fill could be mislabeled as later human input.
    const page = record.pages.get(handle.pageId);
    if (record.recording?.metadata.status === 'recording' && page) await Promise.allSettled(page.frames().map(frame => frame.evaluate(() => window.__remoteOpsRecordingObserver?.flush())));
    await this.append(record, { kind: 'action', phase: 'after', actionId: handle.actionId, pageId: handle.pageId, status, url: recordingUrl(record.pages.get(handle.pageId)?.url()), result }, handle.recordingId);
    if (record.recording?.operations.get(handle.actionId) === handle) record.recording.operations.delete(handle.actionId);
  }
}

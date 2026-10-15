import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { browserRuntimeMetadata, browserRuntimeDirectory, inspectBrowserRuntime, writeBrowserRuntimeManifest } from '../lib/browser-runtime.js';
import { BrowserWorkspace } from '../lib/browser-workspace.js';
import { registerSessionActivation, RemoteOpsState } from '../lib/index.js';
import { registerBrowserTools } from '../lib/browser-tools.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'remote-ops-runtime-')), metadata = browserRuntimeMetadata();
  const cache = join(root, 'empty-cache'), chromium = { executablePath: () => join(cache, metadata.executables.window) };
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (base, mode) => { const path = join(base, metadata.executables[mode]); await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'test executable'); };
  const managed = browserRuntimeDirectory(root, metadata);
  return { root, metadata, cache, managed, chromium, put, inspect: () => inspectBrowserRuntime({ root, chromium, metadata }) };
}

test('browser runtime tool installs only on request, exposes progress and needs no open browser', async () => {
  const tools = new Map(); let installs = 0;
  const workspace = { preferences: { browser: 'chrome' }, runtime: async () => ({ chromium: installs > 0, install: { status: installs ? 'completed' : 'idle' } }), install: async () => { installs++; } };
  registerBrowserTools({ tools: { register: tool => tools.set(tool.name, tool) }, systemPrompt: { section() {} } }, { browser: workspace });
  const tool = tools.get('remote_browser_runtime'), exec = { agent: { id: 'owner' } };
  assert.ok(tool, 'plugin must expose on-demand runtime installation without changing Agent');
  assert.equal((await tool.execute({ action: 'status' }, exec)).chromium, false); assert.equal(installs, 0);
  assert.equal((await tool.execute({ action: 'install' }, exec)).install.status, 'completed'); assert.equal(installs, 1);
  assert.equal(workspace.preferences.browser, 'chrome');
  await assert.rejects(tool.execute({ action: 'guess' }, exec), /BROWSER_RUNTIME_ACTION_INVALID/);
  assert.equal(installs, 1);
});

test('runtime metadata pins both Chromium variants to the installed Playwright version', () => {
  const m = browserRuntimeMetadata({ platform: 'win32', arch: 'x64' });
  assert.equal(m.playwrightVersion, '1.64.0');
  assert.deepEqual(m.browsers.map(b => [b.name, b.revision]), [['chromium', '1248'], ['chromium-headless-shell', '1248'], ['ffmpeg', '1013'], ['winldd', '1007']]);
  assert.match(m.executables.embedded, /chrome-headless-shell\.exe$/);
  assert.match(m.executables.window, /chrome\.exe$/);
});

test('window-only caches never report embedded mode ready', async t => {
  const f = await fixture(t); await f.put(f.cache, 'window');
  const state = await f.inspect();
  assert.equal(state.chromium, false); assert.equal(state.modes.window.source, 'cache'); assert.equal(state.modes.embedded.ready, false);
  await assert.rejects(writeBrowserRuntimeManifest(f.cache, f.metadata), /incomplete/);
});

test('matching managed browsers take precedence and a missing variant can use the matching default cache', async t => {
  const f = await fixture(t);
  for (const mode of ['embedded', 'window']) { await f.put(f.managed, mode); await f.put(f.cache, mode); }
  await writeBrowserRuntimeManifest(f.managed, f.metadata);
  let state = await f.inspect();
  assert.equal(state.chromium, true); assert.equal(state.modes.window.source, 'managed'); assert.equal(state.modes.embedded.source, 'managed');
  await rm(join(f.managed, f.metadata.executables.embedded));
  state = await f.inspect(); assert.equal(state.managedStatus, 'incomplete'); assert.equal(state.modes.embedded.source, 'cache');
});

test('mismatched or corrupt manifests never select a managed executable', async t => {
  const f = await fixture(t); for (const mode of ['embedded', 'window']) await f.put(f.managed, mode);
  await writeBrowserRuntimeManifest(f.managed, { ...f.metadata, playwrightVersion: '0.0.0' });
  assert.equal((await f.inspect()).managedStatus, 'mismatch'); assert.equal((await f.inspect()).modes.window.ready, false);
  await writeFile(join(f.managed, 'runtime.json'), '{'); assert.equal((await f.inspect()).managedStatus, 'invalid');
});

test('managed installation preserves profiles and stays independent of other Playwright versions', async t => {
  const f = await fixture(t), profile = join(f.root, 'profiles', 'owner', 'site'); await mkdir(profile, { recursive: true }); await writeFile(join(profile, 'cookies'), 'keep');
  assert.notEqual(f.managed, browserRuntimeDirectory(f.root, { ...f.metadata, playwrightVersion: '1.63.0' }));
  for (const mode of ['embedded', 'window']) await f.put(f.managed, mode); await writeBrowserRuntimeManifest(f.managed, f.metadata);
  assert.equal(await readFile(join(profile, 'cookies'), 'utf8'), 'keep');
});

test('Chromium launches the executable for the selected mode while Edge retains its channel', async t => {
  const f = await fixture(t), calls = [];
  for (const mode of ['embedded', 'window']) await f.put(f.managed, mode); await writeBrowserRuntimeManifest(f.managed, f.metadata);
  const w = new BrowserWorkspace({ root: f.root }); await w.ready; t.after(() => w.dispose());
  w.library = async () => ({ chromium: { ...f.chromium, launchPersistentContext: async (profile, options) => { calls.push({ profile, options }); return { setDefaultTimeout() {} }; } } });
  await w.launch({ id: 'test', browser: 'chromium' }, 'owner', 'embedded'); await w.launch({ id: 'test', browser: 'chromium' }, 'owner', 'window'); await w.launch({ id: 'edge', browser: 'msedge' }, 'owner', 'embedded');
  assert.equal(calls[0].options.executablePath, join(f.managed, f.metadata.executables.embedded)); assert.equal(calls[1].options.executablePath, join(f.managed, f.metadata.executables.window));
  assert.equal(calls[0].profile, calls[1].profile); assert.equal(calls[2].options.channel, 'msedge'); assert.equal(calls[2].options.executablePath, undefined);
});

test('missing Chromium fails before launch with a repairable runtime error', async t => {
  const f = await fixture(t), w = new BrowserWorkspace({ root: f.root }); await w.ready; t.after(() => w.dispose());
  w.library = async () => ({ chromium: { ...f.chromium, launchPersistentContext: () => assert.fail('missing browser must not launch') } });
  await assert.rejects(w.launch({ id: 'test', browser: 'chromium' }, 'owner', 'embedded'), /BROWSER_RUNTIME_MISSING/);
});

test('installer reuses a complete runtime without downloading or changing global environment', async t => {
  const f = await fixture(t), w = new BrowserWorkspace({ root: f.root }); await w.ready; t.after(() => w.dispose());
  for (const mode of ['embedded', 'window']) await f.put(f.cache, mode);
  w.library = async () => ({ chromium: f.chromium }); w.spawnInstaller = () => assert.fail('ready browsers must be reused');
  const before = process.env.PLAYWRIGHT_BROWSERS_PATH; assert.equal((await w.install()).status, 'completed'); assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, before);
});

test('installer deduplicates clicks, publishes progress, rejects partial success and permits retry', async t => {
  const f = await fixture(t), w = new BrowserWorkspace({ root: f.root }); await w.ready; t.after(() => w.dispose());
  w.library = async () => ({ chromium: f.chromium }); const handles = [], before = process.env.PLAYWRIGHT_BROWSERS_PATH;
  w.spawnInstaller = (command, args, options) => { assert.equal(options.env.PLAYWRIGHT_BROWSERS_PATH, f.managed); assert.equal(options.windowsHide, true); const h = new EventEmitter(); h.stdout = new EventEmitter(); h.stderr = new EventEmitter(); h.kill = () => h.emit('close', null); handles.push(h); return h; };
  const first = await w.install(); assert.equal((await w.install()), first); assert.equal(handles.length, 1); handles[0].stdout.emit('data', Buffer.from('download 50%')); assert.match((await w.runtime()).install.output, /50%/);
  handles[0].emit('close', 0); await new Promise(r => setTimeout(r, 20)); assert.equal(w.installation.status, 'failed'); assert.match(w.installation.error, /incomplete/);
  await w.install(); for (const mode of ['embedded', 'window']) await f.put(f.managed, mode); handles[1].emit('close', 0);
  for (let i = 0; i < 50 && w.installation.status === 'installing'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(w.installation.status, 'completed'); assert.equal((await w.runtime()).modes.embedded.source, 'managed'); assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, before);
});

test('a late failed installer callback cannot replace the retry state or its process handle', async t => {
  const f=await fixture(t),w=new BrowserWorkspace({root:f.root});await w.ready;t.after(()=>w.dispose());w.library=async()=>({chromium:f.chromium});
  const handles=[];w.spawnInstaller=()=>{const h=new EventEmitter();h.stdout=new EventEmitter();h.stderr=new EventEmitter();h.kill=()=>h.emit('close',null);handles.push(h);return h;};
  await w.install();handles[0].emit('error',Error('spawn failed'));await w.install();const retry=w.installation;
  handles[0].stdout.emit('data',Buffer.from('old progress'));handles[0].emit('close',1);await new Promise(setImmediate);
  assert.equal(w.installation,retry);assert.equal(retry.status,'installing');assert.equal(retry.output,'');assert.equal(w.installer,handles[1]);
  handles[1].emit('close',1);await new Promise(setImmediate);
});

test('unloading while runtime detection is pending never starts a new download process', async t => {
  const f=await fixture(t),w=new BrowserWorkspace({root:f.root});await w.ready;let release;
  w.library=()=>new Promise(resolve=>{release=()=>resolve({chromium:f.chromium});});w.spawnInstaller=()=>assert.fail('unloaded plugin must not spawn');
  const pending=w.install();await new Promise(setImmediate);const disposing=w.dispose();release();
  await assert.rejects(pending,/BROWSER_DISPOSED/);await disposing;
});

test('cold-session activation accesses the optional controller only through its injected owner', async () => {
  const owner={id:'persisted-session'},state={ctx:{agents:{get:()=>undefined}}},cleanups=[];let mount;
  const root=new Proxy({inject:(names,callback)=>{assert.deepEqual(names,['sessionController']);mount=callback;}},{get:(target,key)=>{if(key==='sessionController')throw Error('cannot access without inject');return target[key];}});
  registerSessionActivation(root,state);
  const resolve=()=>RemoteOpsState.prototype.resolveOwner.call(state,owner.id);
  await assert.rejects(resolve(),{code:'REMOTE_OWNER_UNAVAILABLE'});
  const first={resolveAgent:async id=>{assert.equal(id,owner.id);return {agent:owner};}};
  mount({sessionController:first,effect:fn=>cleanups.push(fn())});assert.equal(await resolve(),owner);
  const second={resolveAgent:async()=>({agent:owner})};mount({sessionController:second,effect:fn=>cleanups.push(fn())});cleanups[0]();assert.equal(state.sessionController,second);
  cleanups[1]();await assert.rejects(resolve(),{code:'REMOTE_OWNER_UNAVAILABLE'});
});

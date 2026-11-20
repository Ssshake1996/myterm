import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {BrowserWorkspace} from '../lib/browser-workspace.js';

async function fixture(t, saved) {
  const root = await mkdtemp(join(tmpdir(), 'remote-ops-adaptive-'));
  if (saved) await writeFile(join(root, 'preferences.json'), JSON.stringify(saved));
  const changes = [], navigations = [];
  const workspace = new BrowserWorkspace({root, launchContext: async (_, options) => {
    const context = new EventEmitter(), pages = [];
    context.pages = () => pages; context.close = async () => context.emit('close');
    context.newPage = async () => {
      const page = new EventEmitter(); let url = 'about:blank', size = options.viewport;
      Object.assign(page, {url: () => url, mainFrame: () => page, frames: () => [page], isClosed: () => false,
        title: async () => 'Adaptive fixture', bringToFront: async () => {}, viewportSize: () => size,
        setViewportSize: async value => { size = value; changes.push(value); },
        goto: async value => { url = value; navigations.push({...size}); page.emit('framenavigated', page); },
        reload: async () => { navigations.push({...size}); page.emit('framenavigated', page); },
        evaluate: async () => ({required: 0, frameWidth: size.width}), screenshot: async () => Buffer.from('png'),
      }); pages.push(page); context.emit('page', page); return page;
    };
    await context.newPage(); return context;
  }});
  await workspace.ready;
  t.after(async () => { await workspace.dispose(); await rm(root, {recursive: true, force: true}); });
  return {workspace, root, changes, navigations};
}

test('automatic fit starts before navigation and remains independent of viewer size', async t => {
  const {workspace: w, navigations, changes} = await fixture(t);
  assert.equal(w.preferences.zoom, 'auto');
  const opened = await w.openUrl('a', 'https://device.test/');
  assert.equal(navigations[0].width, 1280);
  await w.resizeViewport('a', opened.id, {mode:'panel', zoom:'auto', width:1027, height:768});
  const size = {...w.session('a', opened.id).viewport}; changes.length = 0;
  await w.resizeViewport('a', opened.id, {mode:'panel', zoom:'auto', width:390, height:480});
  assert.deepEqual(w.session('a', opened.id).viewport, size);
  assert.equal(changes.length, 0, 'viewer-only resize must not invalidate CSS coordinates');
});

test('legacy display settings migrate once, then explicit original-size choice survives restart', async t => {
  const {workspace: w, root} = await fixture(t, {display:'embedded',browser:'chromium',windowBrowser:'system',viewport:'panel',zoom:'actual'});
  assert.equal(w.preferences.zoom, 'auto');
  await w.savePreferences({zoom:'actual'});
  const restored = new BrowserWorkspace({root}); await restored.ready; t.after(() => restored.dispose());
  assert.equal(restored.preferences.zoom, 'actual');
  assert.equal(JSON.parse(await readFile(join(root,'preferences.json'),'utf8')).layoutVersion, 1);
});

test('automatic detection learns stable width, restores it before reload and never learns long-page height', async t => {
  const {workspace: w, root, navigations} = await fixture(t);
  const opened = await w.openUrl('a', 'https://device.test/'), r = w.session('a', opened.id), page = r.pages.get(r.activePageId);
  page.evaluate = async () => ({required:1920,frameWidth:r.viewport.width,overflow:Math.max(0,1920-r.viewport.width)});
  const hint = {mode:'panel',zoom:'auto',width:1027,height:768,pageId:r.activePageId};
  await w.resizeViewport('a',r.id,hint); await w.resizeViewport('a',r.id,r.viewportHint,true);
  assert.equal(r.viewport.width,1920); assert.equal(r.viewport.height,768);
  const restored = new BrowserWorkspace({root}); await restored.ready; t.after(() => restored.dispose());
  assert.equal(restored.initialViewport('https://device.test/next').width,1920);
  await w.navigate('a',r.id,'reload'); assert.equal(navigations.at(-1).width,1920);
  assert.equal(restored.initialViewport('https://other.test/').width,1280);
});

test('viewport updates defer while an observation or action owns CSS coordinates', async t => {
  const {workspace:w,changes} = await fixture(t);
  const opened = await w.openUrl('a','https://device.test/'), r = w.session('a',opened.id);
  r.observation = {at:Date.now(),pageId:r.activePageId};
  let result = await w.resizeViewport('a',r.id,{mode:'panel',zoom:'actual',width:400,height:500});
  assert.equal(result.viewportDeferred,true); assert.equal(changes.length,0);
  r.observation = undefined; r.job = {inFlight:true,steps:[],results:[]};
  result = await w.resizeViewport('a',r.id,{mode:'panel',zoom:'actual',width:500,height:600});
  assert.equal(result.viewportDeferred,true); assert.equal(changes.length,0);
  r.job = undefined; await w.flushViewport(r);
  assert.deepEqual(changes.at(-1),{width:500,height:600});
});

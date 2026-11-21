import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {BrowserWorkspace,adoptBrowserWorkspace} from '../lib/browser-workspace.js';

async function fixture(t,saved) {
  const root=await mkdtemp(join(tmpdir(),'remote-ops-panel-'));
  if(saved)await writeFile(join(root,'preferences.json'),JSON.stringify(saved));
  await writeFile(join(root,'auto-widths.json'),'obsolete');
  const changes=[],navigations=[];
  const w=new BrowserWorkspace({root,launchContext:async(_,options)=>{
    const context=new EventEmitter(),pages=[];
    context.pages=()=>pages;context.close=async()=>context.emit('close');
    context.newPage=async()=>{
      const page=new EventEmitter();let url='about:blank',size=options.viewport;
      Object.assign(page,{url:()=>url,mainFrame:()=>page,frames:()=>[page],isClosed:()=>false,
        title:async()=>'Panel fixture',bringToFront:async()=>{},viewportSize:()=>size,
        setViewportSize:async value=>{size=value;changes.push(value);},
        goto:async value=>{url=value;navigations.push({...size});page.emit('framenavigated',page);},
        reload:async()=>{navigations.push({...size});page.emit('framenavigated',page);},
        evaluate:async()=>{throw Error('Layout must not be measured or rewritten');},screenshot:async()=>Buffer.from('png'),
      });pages.push(page);context.emit('page',page);return page;
    };
    await context.newPage();return context;
  }});
  await w.ready;
  t.after(async()=>{await w.dispose();await rm(root,{recursive:true,force:true});});
  const opened=await w.openUrl('a','https://device.test/');
  const r=w.session('a',opened.id),page=r.pages.get(r.activePageId);
  return {w,root,changes,navigations,r,page};
}

test('panel dimensions become the CSS viewport without measuring content or reloading',async t=>{
  const {w,r,page,navigations}=await fixture(t);page.draft='unchanged';
  for(const [width,height] of [[1027,768],[390,640],[1440,420],[1280,900]]){
    await w.resizeViewport('a',r.id,{width,height,pageId:r.activePageId});
    assert.deepEqual(page.viewportSize(),{width,height});
  }
  assert.equal(page.draft,'unchanged');assert.equal(navigations.length,1);
});

test('cold migration strips old modes but preserves engine choices and ignores obsolete caches',async t=>{
  const saved={display:'embedded',browser:'chrome',windowBrowser:'system',viewport:'desktop',zoom:'auto',desktopWidth:null,desktopHeight:1600,layoutVersion:1};
  const {w,root}=await fixture(t,saved);
  const expected={display:'embedded',browser:'chrome',windowBrowser:'system'};
  assert.deepEqual(w.preferences,expected);
  assert.deepEqual(JSON.parse(await readFile(join(root,'preferences.json'),'utf8')),expected);
  assert.equal(w.snapshot('a').siteWidths,undefined);
  await w.savePreferences({zoom:'actual',desktopHeight:'legacy',viewport:'desktop'});
  assert.deepEqual(w.preferences,expected);
});

test('hot adoption preserves live handles and drops obsolete deferred desktop dimensions',async t=>{
  const {w,r,page,root}=await fixture(t),recorder=w.recordings;
  w.preferences={...w.preferences,zoom:'auto',viewport:'desktop',desktopWidth:1280,desktopHeight:1600};
  delete w.autoWidths;
  r.viewportHint={mode:'desktop',zoom:'actual'};r.pendingViewport={input:{mode:'desktop'}};
  assert.equal(adoptBrowserWorkspace(w),w);await w.ready;
  assert.equal(r.pages.get(r.activePageId),page);assert.equal(w.recordings,recorder);assert.equal(r.pendingViewport,undefined);
  await w.resizeViewport('a',r.id,{width:1027,height:768});await w.flushViewport(r);
  assert.deepEqual(page.viewportSize(),{width:1027,height:768});
  assert.equal(JSON.parse(await readFile(join(root,'preferences.json'),'utf8')).zoom,undefined);
});

test('a saved observation does not freeze resizing and its coordinates become stale',async t=>{
  const {w,r,page}=await fixture(t);
  r.observation={at:Date.now(),pageId:r.activePageId};const revision=r.revision;
  await w.resizeViewport('a',r.id,{width:600,height:450});
  assert.deepEqual(page.viewportSize(),{width:600,height:450});
  assert.equal(r.observation,undefined);assert.ok(r.revision>revision);
});

test('only in-flight work defers resize, and the newest size supersedes an old pending size',async t=>{
  const {w,r,page,changes}=await fixture(t);r.job={inFlight:true,steps:[],results:[]};
  for(const width of [400,500,600])assert.equal((await w.resizeViewport('a',r.id,{width,height:450})).viewportDeferred,true);
  assert.equal(changes.length,0);r.job=undefined;await w.flushViewport(r);
  assert.deepEqual(page.viewportSize(),{width:600,height:450});assert.equal(changes.length,1);
  r.observing=true;await w.resizeViewport('a',r.id,{width:700,height:500});
  r.observing=false;await w.resizeViewport('a',r.id,{width:800,height:600});await w.flushViewport(r);
  assert.deepEqual(page.viewportSize(),{width:800,height:600});
});

test('legacy mode arguments cannot override measured dimensions; navigation inherits the panel',async t=>{
  const {w,r,page,navigations}=await fixture(t);
  await w.resizeViewport('a',r.id,{mode:'desktop',zoom:'fit',width:640,height:480});
  await w.navigate('a',r.id,'goto','https://device.test/next');
  assert.deepEqual(navigations.at(-1),{width:640,height:480});
  assert.deepEqual(page.viewportSize(),{width:640,height:480});
  for(const size of [{},{width:0,height:768},{width:123.5,height:768},{width:8192,height:8192},{width:'640',height:480}])
    await assert.rejects(w.resizeViewport('a',r.id,size),/BROWSER_VIEWPORT_INVALID/);
});

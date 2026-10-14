import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {BrowserWorkspace} from '../lib/browser-workspace.js';
import {registerBrowserTools} from '../lib/browser-tools.js';
import {registerBrowserRoutes} from '../lib/browser-routes.js';

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'remote-ops-live-')), launches=[], inputs=[];
  const w=new BrowserWorkspace({root,launchContext:async (profile,options)=>{
    const context=new EventEmitter(), pages=[];
    context.pages=()=>pages; context.close=async()=>context.emit('close');
    context.newPage=async()=>{
      const page=new EventEmitter(); let url='about:blank';
      Object.assign(page,{url:()=>url,mainFrame:()=>page,isClosed:()=>false,title:async()=> 'Fixture',bringToFront:async()=>{},
        goto:async value=>{url=value;page.emit('framenavigated',page);},close:async()=>page.emit('close'),
        locator:()=>({}),getByText:()=>({}),screenshot:async()=>Buffer.from('png'),
        evaluate:async()=>({text:'fixture',elements:[]}),
        mouse:{click:async(...v)=>inputs.push(['click',...v]),wheel:async(...v)=>inputs.push(['wheel',...v])},
        keyboard:{insertText:async v=>inputs.push(['text',v]),press:async v=>inputs.push(['key',v])},
      });pages.push(page);context.emit('page',page);return page;
    };
    context.newCDPSession=async()=>{
      const cdp=new EventEmitter();cdp.detach=async()=>{};
      cdp.send=async name=>{if(name==='Page.startScreencast')queueMicrotask(()=>cdp.emit('Page.screencastFrame',{sessionId:1,data:Buffer.from('jpeg').toString('base64'),metadata:{deviceWidth:1024,deviceHeight:768}}));};return cdp;
    };
    launches.push({profile,options,context});await context.newPage();return context;
  }});await w.ready;
  t.after(async()=>{await w.dispose();await rm(root,{recursive:true,force:true});});
  return {w,root,launches,inputs};
}

test('a URL opens without a saved site and defaults to embedded; active selection is owner scoped',async t=>{
  const {w,launches}=await fixture(t);
  const one=await w.openUrl('a','https://example.test/login');
  assert.equal(one.display,'embedded');assert.equal(launches[0].options.headless,true);assert.equal(w.sites.length,0);
  assert.equal(w.snapshot('a').activeBrowserId,one.id);assert.equal(w.session('a').id,one.id);
  assert.throws(()=>w.session('b',one.id),/BROWSER_SESSION_NOT_FOUND/);
  await assert.rejects(w.openUrl('a','javascript:alert(1)'),/BROWSER_URL_INVALID/);
});
test('display preferences persist and legacy saved-site opens remain visible',async t=>{
  const {w,root,launches}=await fixture(t);
  await w.savePreferences({display:'window',browser:'msedge'});
  const one=await w.openUrl('a','https://example.test/');
  assert.equal(one.display,'window');assert.equal(launches[0].options.headless,false);
  assert.equal(JSON.parse(await readFile(join(root,'preferences.json'),'utf8')).display,'window');
  const site=await w.saveSite({name:'Legacy',url:'https://old.test/'});
  await w.open('a',site.id);assert.equal(launches[1].options.headless,false);
  await assert.rejects(w.savePreferences({display:'invalid'}),/BROWSER_DISPLAY_INVALID/);
});
test('live frames require the same conversation, while human input needs no takeover even during an Agent action',async t=>{
  const {w,inputs}=await fixture(t), one=await w.openUrl('a','https://example.test/');
  const frame=await w.frame('a',one.id,{});
  assert.ok(frame.data);assert.equal(frame.width,1024);
  w.session('a',one.id).job={status:'running',inFlight:true,steps:[],index:0,results:[]};
  await w.input('a',one.id,{kind:'text',text:'中文',pageId:frame.pageId,revision:frame.revision});
  assert.deepEqual(inputs,[['text','中文']]);
  w.session('a',one.id).job={status:'completed',steps:[],index:0,results:[]};
  await w.session('a',one.id).pages.values().next().value.goto('https://example.test/next');
  await assert.rejects(w.input('a',one.id,{kind:'click',x:10,y:10,pageId:frame.pageId,revision:frame.revision}),/BROWSER_FRAME_STALE/);
  await assert.rejects(w.frame('b',one.id,{}),/BROWSER_SESSION_NOT_FOUND/);
});
test('view abort disconnects only the frame request; it does not close the browser',async t=>{
  const {w}=await fixture(t), one=await w.openUrl('a','https://example.test/');
  const frame=await w.frame('a',one.id,{}), controller=new AbortController();
  const waiting=w.frame('a',one.id,{after:frame.sequence,signal:controller.signal});controller.abort();
  await assert.rejects(waiting,/abort/i);assert.equal(w.session('a',one.id).closed,false);
});
test('shared input validates bounds and drops input captured before a page change',async t=>{
  const {w,inputs}=await fixture(t),one=await w.openUrl('a','https://example.test/'),frame=await w.frame('a',one.id,{});
  await assert.rejects(w.input('a',one.id,{kind:'click',x:-1,y:0,pageId:frame.pageId,revision:frame.revision}),/BROWSER_INPUT_INVALID/);
  await w.navigate('a',one.id,'goto','https://example.test/new');
  await assert.rejects(w.input('a',one.id,{kind:'text',text:'late',pageId:frame.pageId,revision:frame.revision}),/BROWSER_FRAME_STALE/);
  assert.deepEqual(inputs,[]);
});
test('direct URL and browser frame routes are owner guarded, and Agent opens the active page without a site ID',async t=>{
  const {w}=await fixture(t),routes=new Map(),tools=new Map(),agents=new Map([['a',{id:'a'}],['b',{id:'b'}]]);
  const ctx={effect:f=>f(),connection:{fetch:{register:r=>routes.set(r.path,r)}},agents:{get:id=>agents.get(id)},tools:{register:d=>tools.set(d.name,d)},systemPrompt:{section(){}}};
  const state={browser:w,resolveOwner:async id=>{if(!agents.has(id))throw Error('unknown');return agents.get(id);}};
  registerBrowserRoutes(ctx,state);registerBrowserTools(ctx,state);
  await assert.rejects(tools.get('remote_browser_control').execute({action:'takeover'},{agent:agents.get('a')}),/BROWSER_CONTROL_INVALID/);
  const opened=await tools.get('remote_browser_open').execute({url:'https://example.test/'},{agent:agents.get('a')});
  assert.equal(w.session('a').id,opened.id);
  const saved=await w.saveSite({name:'Saved',url:'https://saved.test/'});
  const savedResponse=await routes.get('/api/dsh-remote-ops/browser').fetch(new Request('http://local/api',{method:'POST',body:JSON.stringify({action:'open',sessionId:'a',siteId:saved.id})}));
  assert.equal((await savedResponse.json()).result.display,'embedded','saved-site UI opens must honor the same display preference as direct URLs');
  const route=routes.get('/api/dsh-remote-ops/browser/frame');assert.ok(route);
  const response=await route.fetch(new Request(`http://local/api?sessionId=b&browserId=${opened.id}`));assert.equal(response.status,404);
  await w.control('a',opened.id,'close');
  const ended=await route.fetch(new Request(`http://local/api?sessionId=a&browserId=${opened.id}`));assert.equal(ended.status,200);assert.equal((await ended.json()).closed,true);
});
test('changing display keeps browser identity and URLs but is refused while a task is unfinished',async t=>{
  const {w,launches}=await fixture(t),one=await w.openUrl('a','https://example.test/login');
  const r=w.session('a',one.id),pageId=r.activePageId;
  const changed=await w.changeDisplay('a',one.id,'window');
  assert.equal(changed.id,one.id);assert.equal(changed.display,'window');assert.equal(changed.activePageId,pageId);
  assert.equal(r.pages.get(pageId).url(),'https://example.test/login');assert.equal(launches[1].options.headless,false);
  r.job={status:'paused',steps:[],index:0,results:[]};
  await assert.rejects(w.changeDisplay('a',one.id,'embedded'),/BROWSER_BUSY/);
  r.job.status='stopped';
});
test('the canonical DSH turn cancellation stops future browser steps only in that conversation',async t=>{
  const {w}=await fixture(t),a=await w.openUrl('a','https://example.test/'),b=await w.openUrl('b','https://example.test/');
  for(const id of [a.id,b.id])w.sessions.get(id).job={status:'paused',steps:[],index:0,results:[]};
  const handlers=new Map(),ctx={on:(name,fn)=>handlers.set(name,fn),tools:{register(){}},systemPrompt:{section(){}}};
  registerBrowserTools(ctx,{browser:w});
  const signal=new AbortController();let reached=false;
  await handlers.get('agent/pre-step')({agent:{id:'a'},signal:signal.signal},async()=>{reached=true;});signal.abort();
  assert.equal(reached,true);assert.equal(w.session('a').job.status,'stopped');assert.equal(w.session('b').job.status,'paused');
  w.session('b').job.status='stopped';
});
test('a navigation restarts the frame source even when the new page is visually idle',async t=>{
  const {w}=await fixture(t),one=await w.openUrl('a','https://example.test/');
  const first=await w.frame('a',one.id,{});await w.navigate('a',one.id,'goto','https://example.test/next');
  const next=await Promise.race([w.frame('a',one.id,{after:first.sequence}),new Promise((_,reject)=>setTimeout(()=>reject(Error('no fresh frame after navigation')),100))]);
  assert.ok(next.revision>first.revision);assert.ok(next.sequence>first.sequence);
});
test('navigation in an inactive tab does not invalidate input in the active page',async t=>{
  const {w}=await fixture(t),one=await w.openUrl('a','https://example.test/'),r=w.session('a',one.id),selected=r.activePageId;
  const background=await r.context.newPage();await w.control('a',one.id,'select-page',selected);
  const revision=r.revision;await background.goto('https://example.test/background');assert.equal(r.revision,revision);
});

test('a new blank tab keeps its browser URL and selection across display changes',async t=>{
  const {w}=await fixture(t),one=await w.openUrl('a','https://example.test/');
  const opened=await w.navigate('a',one.id,'new-page'),blank=opened.pages.find(p=>p.active);
  assert.equal(blank.url,'about:blank');
  const changed=await w.changeDisplay('a',one.id,'window');
  assert.equal(changed.activePageId,blank.id);assert.equal(changed.pages.find(p=>p.active).url,'about:blank');
});
test('a failed screencast start is discarded so the next view request can recover',async t=>{
  const {w}=await fixture(t),one=await w.openUrl('a','https://example.test/'),r=w.session('a',one.id);
  const original=r.context.newCDPSession;let first=true;
  r.context.newCDPSession=async()=>{const cdp=await original();if(first){first=false;cdp.send=async()=>{throw Error('transient start failure');};}return cdp;};
  await assert.rejects(w.frame('a',one.id,{}),/transient start failure/);
  const frame=await Promise.race([w.frame('a',one.id,{}),new Promise((_,reject)=>setTimeout(()=>reject(Error('view did not recover')),100))]);assert.ok(frame.data);
});

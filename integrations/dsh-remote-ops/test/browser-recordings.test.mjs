import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWorkspace } from '../lib/browser-workspace.js';
import { adoptBrowserRecordings } from '../lib/browser-recordings.js';
import { registerBrowserTools } from '../lib/browser-tools.js';
import { registerBrowserRoutes } from '../lib/browser-routes.js';

async function fixture(t, legacy = false) {
  const root=await mkdtemp(join(tmpdir(),'remote-ops-recordings-'));
  const context=new EventEmitter(),page=new EventEmitter();let url='https://device.test/ui?token=private#route';let effects=0;
  const locator={count:async()=>1,waitFor:async()=>{},isVisible:async()=>true,innerText:async()=>'OK',evaluate:async fn=>fn({matches:()=>false,id:'entry',name:'entry',getAttribute:()=>null}),fill:async()=>{effects++;},click:async()=>{effects++;if(page.fail)throw Error('uncertain');}};
  Object.assign(page,{url:()=>url,frames:()=>[page],mainFrame:()=>page,isClosed:()=>false,title:async()=>'Device',evaluate:async()=>{},goto:async value=>{url=value;page.emit('framenavigated',page);},locator:()=>locator,getByRole:()=>locator,getByText:()=>locator,screenshot:async()=>Buffer.from('png'),close:async()=>page.emit('close')});
  Object.assign(context,{pages:()=>[page],newPage:async()=>page,close:async()=>context.emit('close'),storageState:async()=>({cookies:[]}),exposeBinding:async(_name,callback)=>{context.binding=callback;},addInitScript:async()=>{}});
  const w=new BrowserWorkspace({root,launchContext:async()=>context});await w.ready;
  if(legacy)w.recordings.observePage=()=>{};
  const opened=await w.openUrl('owner','https://device.test/ui?token=private#route');
  if(legacy)delete w.recordings;
  t.after(async()=>{await w.dispose();await rm(root,{recursive:true,force:true});});
  return {w,root,context,page,id:opened.id,effects:()=>effects};
}

test('hot adoption initializes recording on a retained legacy browser and observes existing pages once',async t=>{
  const f=await fixture(t,true),record=f.w.session('owner',f.id),page=record.pages.get(record.activePageId);
  const recorder=adoptBrowserRecordings(f.w);assert.equal(adoptBrowserRecordings(f.w),recorder);
  assert.equal(f.w.publicSession(record).recording,null);
  const recording=await f.w.recording('owner',{action:'start',browserId:f.id});
  assert.equal(record.pages.get(record.activePageId),page);
  await f.w.recordings.install(record);
  await f.w.navigate('owner',f.id,'goto','https://device.test/after-upgrade');
  await f.w.recording('owner',{action:'stop',recordingId:recording.id});
  const events=(await f.w.recording('owner',{action:'read',recordingId:recording.id})).events;
  assert.equal(events.filter(event=>event.kind==='navigation').length,1);
});

test('durable capture pairs Agent actions, deduplicates runs, paginates and exports owner-scoped records',async t=>{
  const f=await fixture(t),recording=await f.w.recording('owner',{action:'start',browserId:f.id,name:'Test'});
  assert.equal((await f.w.recording('owner',{action:'start',browserId:f.id})).id,recording.id);
  const args={requestId:'once'},steps=[{action:'fill',target:{kind:'css',value:'#entry'},value:'hello'},{action:'assert',target:{kind:'css',value:'#echo'},value:'OK'}];
  const job=await f.w.run('owner',f.id,steps,args);await job.done;
  assert.equal((await f.w.run('owner',f.id,steps,args)).id,job.id);assert.equal(f.effects(),1);
  await f.w.recording('owner',{action:'stop',recordingId:recording.id});
  const first=await f.w.recording('owner',{action:'read',recordingId:recording.id,limit:2});assert.equal(first.hasMore,true);
  assert.equal(first.events[0].details.step.value,'hello');assert.equal(first.events[1].status,'completed');
  const next=await f.w.recording('owner',{action:'read',recordingId:recording.id,after:first.nextAfter,limit:2});assert.equal(next.events[1].result.completion,'checked');assert.equal(next.hasMore,false);
  const exported=await f.w.recording('owner',{action:'export',recordingId:recording.id});assert.equal(exported.content,undefined);
  const file=await readFile(exported.path,'utf8'),value=JSON.parse(file);assert.equal(value.events.length,4);assert.equal(value.format,'myterm.web-recording');assert.ok(!file.includes('token=private'));
  assert.equal((await f.w.recording('owner',{action:'read'})).recordings.length,1);
  assert.deepEqual((await f.w.recording('other',{action:'read'})).recordings,[]);
  await assert.rejects(f.w.recording('other',{action:'read',recordingId:recording.id}),/BROWSER_RECORDING_NOT_FOUND/);
  await assert.rejects(f.w.recording('owner',{action:'read',recordingId:'../../outside'}),/BROWSER_RECORDING_ID_INVALID/);
  await assert.rejects(f.w.recording('owner',{action:'read',recordingId:recording.id,limit:999}),/BROWSER_RECORDING_CURSOR_INVALID/);
});

test('an ambiguous fill records a failed attempt without the unclassified input', async t => {
  const f = await fixture(t);
  const { id } = await f.w.recording('owner', { action: 'start', browserId: f.id });
  const locate = f.page.locator;
  f.page.locator = selector => ({ ...locate(selector), count: async () => 2 });
  const value = 'private-attempt-fixture';
  const job = await f.w.run('owner', f.id, [{ action: 'fill', target: '#entry', value }]);
  await job.done;
  assert.equal(job.error.code, 'BROWSER_TARGET_COUNT');
  await f.w.recording('owner', { action: 'stop', recordingId: id });
  const { events } = await f.w.recording('owner', { action: 'read', recordingId: id });
  assert.equal(events[0].details.step.input.redacted, true);
  assert.equal(events[1].status, 'failed');
  assert.ok(!JSON.stringify(events).includes(value));
  assert.equal(f.effects(), 0);
});

test('document events retain human password fills and stop accepting events at stop',async t=>{
  const f=await fixture(t),recording=await f.w.recording('owner',{action:'start',browserId:f.id});
  const send=payload=>f.context.binding({page:f.page,frame:f.page},{recordingId:recording.id,action:'fill',observedAt:new Date().toISOString(),...payload});
  await send({target:{tag:'input',css:'#name',name:'Name'},input:{value:'a device'}});
  await send({target:{tag:'input',type:'password',css:'#password',sensitive:true},input:{value:' demo password '}});
  const handle=await f.w.recordings.begin(f.w.session('owner',f.id),'agent','wait');
  await send({target:{tag:'input',css:'#name'},input:{value:'human while Agent waits'}});
  const stopped=await f.w.recording('owner',{action:'stop',recordingId:recording.id});assert.deepEqual(stopped.unfinishedActionIds,[handle.actionId]);
  await send({target:{css:'#name'},input:{value:'after-stop'}});
  const read=await f.w.recording('owner',{action:'read',recordingId:recording.id});
  assert.equal(read.events[0].source,'human');assert.equal(read.events[1].input.value,' demo password ');assert.equal(read.events[3].source,'browser');assert.equal(read.events[3].duringActionId,handle.actionId);
  assert.equal(read.events[1].target.password,true);assert.ok(!JSON.stringify(read).includes('after-stop'));
});

test('uncertain effects remain unknown and a new process can read interrupted recordings',async t=>{
  const f=await fixture(t),recording=await f.w.recording('owner',{action:'start',browserId:f.id});f.page.fail=true;
  const job=await f.w.run('owner',f.id,[{action:'click',target:{kind:'css',value:'#save'}}]);await job.done;
  assert.equal((await f.w.recording('owner',{action:'read',recordingId:recording.id})).events.at(-1).status,'unknown');
  const other=new BrowserWorkspace({root:f.root});await other.ready;
  assert.equal((await other.recording('owner',{action:'read',recordingId:recording.id})).recording.status,'interrupted');
  const path=f.w.recordings.file('owner',recording.id,'jsonl');
  await appendFile(path,JSON.stringify({seq:3,kind:'navigation',url:'https://device.test/done'})+'\n{"seq":4,');
  const recovered=JSON.parse((await other.recordings.export('owner',recording.id)).content);
  assert.equal(recovered.events.length,3);assert.equal(recovered.recording.eventCount,3);assert.equal(recovered.incompleteTail,true);
  await other.dispose();
});

test('recording tool and JSON download route use the same conversation ownership and export bytes',async t=>{
  const f=await fixture(t),tools=new Map(),routes=new Map();
  const ctx={tools:{register:tool=>tools.set(tool.name,tool)},systemPrompt:{section(){}},effect:fn=>fn(),connection:{fetch:{register:route=>routes.set(route.path,route)}},agents:{get:id=>id==='owner'?{id}:undefined}};
  const state={browser:f.w,resolveOwner:async id=>({id})};registerBrowserTools(ctx,state);registerBrowserRoutes(ctx,state);
  const tool=tools.get('remote_browser_recording'),exec={agent:{id:'owner'}};
  const started=await tool.execute({action:'start',browserId:f.id},exec);
  // DSH validates raw tool results before rendering: undefined is not JSON.
  const jsonResult=value=>assert.deepEqual(JSON.parse(JSON.stringify(value)),value);
  jsonResult(started);
  jsonResult(await tools.get('remote_browser_list').execute({},exec));
  jsonResult(await tools.get('remote_browser_read').execute({browserId:f.id},exec));
  jsonResult(await tool.execute({action:'read',recordingId:started.id},exec));
  jsonResult(await tool.execute({action:'read'},exec));
  jsonResult(await tool.execute({action:'stop',recordingId:started.id},exec));
  const route=routes.get('/api/dsh-remote-ops/browser/recording/export');assert.ok(route);
  const response=await route.fetch(new Request(`http://localhost/api/dsh-remote-ops/browser/recording/export?sessionId=owner&recordingId=${started.id}`));
  assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal((await response.json()).recording.id,started.id);
  assert.equal((await route.fetch(new Request(`http://localhost/api/dsh-remote-ops/browser/recording/export?sessionId=other&recordingId=${started.id}`))).status,404);
});

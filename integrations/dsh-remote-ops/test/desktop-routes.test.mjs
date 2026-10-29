import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { DesktopWorkspace } from '../lib/desktop-workspace.js';
import { DesktopRpc } from '../lib/desktop-transport.js';
import { registerDesktopTools } from '../lib/desktop-tools.js';
import { registerDesktopRoutes } from '../lib/desktop-routes.js';

function fixture(){
  const tools=new Map(),routes=new Map(),saved=[],calls=[];
  const transport={info:{sessionId:1,workerId:'w'},closed:false,close(){this.closed=true;},async call(method,args){calls.push({method,args});return method==='observe'?{snapshotId:'s',elements:[{ref:'e1'}],screenshot:{data:Buffer.from([255,216,1,2,255,217]).toString('base64'),mimeType:'image/jpeg',width:1,height:1,sourceWidth:1,sourceHeight:1}}:{status:'completed',verified:false};}};
  const state={ready:Promise.resolve(),resolveOwner:async id=>{if(!['a','b'].includes(id))throw Error('No conversation');return{id};}};
  state.desktop=new DesktopWorkspace(state,{connect:async()=>({...transport})});
  const ctx={tools:{register:def=>tools.set(def.name,def)},agents:{get:id=>['a','b'].includes(id)?{id}:null},effect:fn=>fn(),connection:{fetch:{register:def=>routes.set(def.path,def)}},get:name=>name==='attachments'?{saveImage:async image=>{saved.push(image);return {id:'image-1',mediaType:image.mediaType};}}:{resolveModelInfo:async(_p,model)=>({inputModalities:model==='vision'?['text','image']:['text']})}};
  registerDesktopTools(ctx,state);registerDesktopRoutes(ctx,state);
  const execute=(name,args,model='vision')=>tools.get(name).execute(args,{agent:{id:'a',options:{provider:'test',model}}});
  return {tools,routes,saved,calls,state,execute};
}
test('DSH images use attachment references and reject text-only routes before observation',async()=>{
  const f=fixture();const c=await f.execute('remote_desktop_connect',{environment:'local'});
  await assert.rejects(f.execute('remote_desktop_observe',{desktopId:c.desktopId,image:true},'text'),/DESKTOP_IMAGE_MODEL_REQUIRED/);assert.equal(f.calls.length,0);
  const value=await f.execute('remote_desktop_observe',{desktopId:c.desktopId,image:true});assert.equal(f.saved.length,1);assert.ok(Buffer.isBuffer(f.saved[0].data));
  assert.equal(value.screenshot.data,undefined);const blocks=f.tools.get('remote_desktop_observe').output.render({},value);assert.equal(blocks[1].attachment.id,'image-1');assert.equal(blocks[1].type,'image');
  assert.deepEqual(value,JSON.parse(JSON.stringify(value)));
});
test('desktop HTTP routes enforce ownership, retain closed logs and serve binary export',async()=>{
  const f=fixture(),c=await f.execute('remote_desktop_connect',{environment:'local'}),route=f.routes.get('/api/dsh-remote-ops/desktop');
  const post=(owner,action,args)=>route.fetch(new Request('http://localhost/api/dsh-remote-ops/desktop',{method:'POST',body:JSON.stringify({sessionId:owner,action,args})}));
  assert.equal((await post('b','act',{desktopId:c.desktopId,requestId:'x',snapshotId:'s',steps:[{action:'click',ref:'e1'}]})).status,400);assert.equal(f.calls.length,0);
  assert.equal((await post('a','__proto__',{})).status,400);
  await f.execute('remote_desktop_observe',{desktopId:c.desktopId});await f.execute('remote_desktop_act',{desktopId:c.desktopId,requestId:'fill',snapshotId:'s',steps:[{action:'fill',ref:'e1',text:'private-value'}]});
  await f.execute('remote_desktop_disconnect',{desktopId:c.desktopId});const exported=await f.execute('remote_desktop_log_export',{all:true});
  const read=f.routes.get('/api/dsh-remote-ops/desktop-log');const good=await read.fetch(new Request('http://localhost'+exported.url));const zip=Buffer.from(await good.arrayBuffer());
  assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(good.headers.get('cache-control'),'no-store');assert.ok(!JSON.stringify([...f.state.desktop.closed.values()][0].events).includes('private-value'));
  assert.equal((await read.fetch(new Request('http://localhost'+exported.url.replace('sessionId=a','sessionId=b')))).status,404);
  assert.equal((await route.fetch(new Request('http://localhost/api/dsh-remote-ops/desktop?sessionId=b'))).status,200);
});
test('RPC transport loss rejects pending effects and never writes a retry',async()=>{
  const input=new PassThrough(),output=new PassThrough();let writes=0,closed=0;input.on('data',()=>writes++);
  const rpc=new DesktopRpc(input,output,()=>closed++);const pending=rpc.call('act',{requestId:'r'});output.end();await assert.rejects(pending,/DESKTOP_DISCONNECTED/);
  await assert.rejects(rpc.call('act',{requestId:'r'}),/DESKTOP_DISCONNECTED/);assert.equal(writes,1);assert.equal(closed,1);
});
test('RPC malformed bootstrap output and invalid action batches cannot dispatch a later step',async()=>{
  const input=new PassThrough(),output=new PassThrough(),rpc=new DesktopRpc(input,output,()=>{});input.resume();const call=rpc.call('status');output.write('{broken\n');await assert.rejects(call,/DESKTOP_PROTOCOL_INVALID/);
  const f=fixture(),c=await f.execute('remote_desktop_connect',{environment:'local'});
  await assert.rejects(f.execute('remote_desktop_act',{desktopId:c.desktopId,requestId:'bad',snapshotId:'s',steps:[{action:'click',ref:'e1'},{action:'fill',ref:'e1',text:null}]}),/DESKTOP_ARGUMENT_INVALID/);assert.equal(f.calls.length,0);
});

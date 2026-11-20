import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSteps } from '../lib/browser-steps.js';
import { validateObservedTarget } from '../lib/browser-mcp.js';
import { registerBrowserTools } from '../lib/browser-tools.js';

test('observed references and coordinates retain their observation identity', () => {
  assert.deepEqual(browserSteps([{action:'click',target:{kind:'ref',value:'e12',snapshotId:'observation-1'}}])[0].target,
    {kind:'ref',value:'e12',snapshotId:'observation-1'});
  assert.deepEqual(browserSteps([{action:'click',target:{kind:'point',x:1279,y:767,snapshotId:'observation-1'}}])[0].target,
    {kind:'point',x:1279,y:767,snapshotId:'observation-1'});
  assert.throws(()=>browserSteps([{action:'click',target:{kind:'point',x:NaN,y:3,snapshotId:'x'}}]),/BROWSER_STEP_INVALID/);
  assert.throws(()=>browserSteps([{action:'click',target:{kind:'ref',value:'e12'}}]),/BROWSER_STEP_INVALID/);
});
test('stale, foreign-page, missing and out-of-bounds observations fail before dispatch', () => {
  const snap={id:'s',pageId:'p',at:Date.now(),width:1280,height:768,refs:['e12'],imageHash:'pixels'};
  const point={kind:'point',snapshotId:'s',x:1279,y:767};
  assert.doesNotThrow(()=>validateObservedTarget(snap,point,'p'));
  for(const change of [{snapshotId:'old'},{x:1280},{y:-1}])assert.throws(()=>validateObservedTarget(snap,{...point,...change},'p'));
  assert.throws(()=>validateObservedTarget(snap,point,'another-page'),/BROWSER_OBSERVATION_STALE/);
  assert.throws(()=>validateObservedTarget({...snap,at:0},point,'p'),/BROWSER_OBSERVATION_STALE/);
  assert.throws(()=>validateObservedTarget(snap,{kind:'ref',snapshotId:'s',value:'e999'},'p'),/BROWSER_OBSERVATION_STALE/);
  assert.throws(()=>validateObservedTarget({...snap,imageHash:null},point,'p'),/BROWSER_IMAGE_REQUIRED/);
});
test('observed targets cannot bypass supported operations or use arbitrary MCP tools',()=>{
  for(const action of ['press','select','read','assert','scroll'])assert.throws(()=>browserSteps([{action,target:{kind:'ref',value:'e12',snapshotId:'s'},value:'x'}]),/BROWSER_STEP_INVALID/);
  assert.throws(()=>browserSteps([{action:'fill',target:{kind:'point',x:1,y:2,snapshotId:'s'},value:'x'}]),/BROWSER_STEP_INVALID/);
});

function readTool(modalities=['text','image']) {
  const tools=new Map(),calls=[];
  const image={id:'fixture-image',mediaType:'image/png'};
  const ctx={tools:{register:t=>tools.set(t.name,t)},systemPrompt:{section(){}},get:name=>({
    attachments:{saveImage:async value=>{calls.push(value);return image;}},
    llm:{resolveModelInfo:async()=>({inputModalities:modalities})},
  })[name]};
  const workspace={session:()=>({id:'browser'}),publicSession:r=>r,
    observe:async()=>({text:'legacy page'}),observeSnapshot:async(_owner,_browser,_page,wantsImage)=>{
      calls.push('observed');return {snapshotId:'snapshot',snapshot:'- button "Save" [ref=e1]',...(wantsImage?{imageBuffer:Buffer.from('fixture-pixels')}:{})};
    }};
  registerBrowserTools(ctx,{browser:workspace});
  return {tool:tools.get('remote_browser_read'),calls,image};
}
const execution=()=>({agent:{id:'conversation',session:{id:'conversation'},options:{provider:'local',model:'vision'}},signal:new AbortController().signal});
test('browser screenshots use native image attachments and leave legacy reads compatible',async()=>{
  const {tool,calls,image}=readTool();const result=await tool.execute({image:true},execution());
  assert.equal(result.image,image);assert.equal(result.page.imageBuffer,undefined);
  assert.equal(calls[1].data.toString(),'fixture-pixels');
  const rendered=tool.output.render({},result);
  assert.deepEqual(rendered[1],{type:'image',attachment:image});assert.doesNotMatch(rendered[0].text,/fixture-pixels|fixture-image/);
  assert.equal((await tool.execute({},execution())).page.text,'legacy page');
});
test('text-only models reject images before capture; snapshots still work',async()=>{
  const {tool,calls}=readTool(['text']);
  await assert.rejects(tool.execute({image:true},execution()),/BROWSER_IMAGE_MODEL_REQUIRED/);assert.equal(calls.length,0);
  assert.equal((await tool.execute({snapshot:true},execution())).page.snapshotId,'snapshot');
  assert.deepEqual(calls,['observed']);
});
test('cancelled observation is rejected before dispatch or attachment creation',async()=>{
  const {tool,calls}=readTool();const exec=execution(),abort=new AbortController();abort.abort();exec.signal=abort.signal;
  await assert.rejects(tool.execute({image:true},exec));assert.deepEqual(calls,[]);
});

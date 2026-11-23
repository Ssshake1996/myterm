import test from 'node:test';
import assert from 'node:assert/strict';
import {showTargetHighlight, clearTargetHighlight, TARGET_HIGHLIGHT_MS} from '../lib/browser-highlight.js';
import {registerBrowserTools} from '../lib/browser-tools.js';

const fixture = () => {
  const calls=[],record={},page={isClosed:()=>false};
  const locator={highlight:async options=>calls.push(['show',options]),hideHighlight:async()=>calls.push(['hide'])};
  return {calls,record,page,locator};
};
test('locator preview has no filled mask and expires without another tool call',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();await showTargetHighlight(f.record,f.page,f.locator);
  assert.equal(f.calls[0][1].style.backgroundColor,'transparent');
  assert.equal(f.calls[0][1].style.pointerEvents,'none');
  t.mock.timers.tick(TARGET_HIGHLIGHT_MS);await f.record.highlightQueue;
  assert.equal(f.record.targetHighlight,undefined);assert.equal(f.calls.at(-1)[0],'hide');
});
test('end of turn while highlight is being drawn still removes it',async()=>{
  const f=fixture();let release;f.locator.highlight=()=>new Promise(r=>{release=r;});
  const shown=showTargetHighlight(f.record,f.page,f.locator);
  while(!release)await Promise.resolve();
  const cleared=clearTargetHighlight(f.record);release();await Promise.all([shown,cleared]);
  assert.equal(f.record.targetHighlight,undefined);assert.deepEqual(f.calls,[['hide']]);
});
test('an obsolete expiry cannot clear the next locator preview',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture();
  await showTargetHighlight(f.record,f.page,f.locator);const previous=f.record.targetHighlight;
  await showTargetHighlight(f.record,f.page,f.locator);const current=f.record.targetHighlight;
  await clearTargetHighlight(f.record,previous);assert.equal(f.record.targetHighlight,current);
  await clearTargetHighlight(f.record);
});
test('cancelled locator checks never leave a late preview behind',async()=>{
  const f=fixture(),controller=new AbortController();let release;
  f.locator.highlight=()=>new Promise(r=>{release=r;});
  const shown=showTargetHighlight(f.record,f.page,f.locator,controller.signal);
  while(!release)await Promise.resolve();controller.abort();release();await shown;
  assert.equal(f.record.targetHighlight,undefined);assert.deepEqual(f.calls,[['hide']]);
  await showTargetHighlight(f.record,f.page,f.locator,controller.signal);
  assert.deepEqual(f.calls,[['hide']]);
});
test('closed pages and preview errors do not fail the locator result or leak a timer',async()=>{
  const f=fixture();f.locator.highlight=async()=>{throw Error('navigated');};
  f.locator.hideHighlight=async()=>{throw Error('closed');};
  await showTargetHighlight(f.record,f.page,f.locator);assert.equal(f.record.targetHighlight,undefined);
  f.page.isClosed=()=>true;await showTargetHighlight(f.record,f.page,f.locator);
  assert.equal(f.record.targetHighlight,undefined);
});
test('native turn completion, idle, failure and disposal clear only their conversation',async()=>{
  const events=new Map(),owners=[];
  registerBrowserTools({on:(name,listener)=>events.set(name,listener),tools:{register(){}},systemPrompt:{section(){}}},
    {browser:{clearOwnerHighlights:async owner=>owners.push(owner)}});
  const payload={agent:{id:'agent',session:{id:'conversation'}}};
  for(const name of ['agent/turn-stopping','agent/error','agent/disposed'])await events.get(name)(payload);
  await events.get('agent/status')({...payload,status:'running'});assert.equal(owners.length,3);
  await events.get('agent/status')({...payload,status:'idle'});
  assert.deepEqual(owners,['agent','agent','agent','agent']);
});

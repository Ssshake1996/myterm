import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerTools} from '../lib/tools.js';
import {RemoteOpsState} from '../lib/state/index.js';
import {createFakeHost} from '../../../e2e/harness/fake-host.mjs';

test('task ownership and cancellation do not require dedicated Agent control tools',()=>{
  const tools=new Map();registerTools({systemPrompt:{section(){}},tools:{register:d=>tools.set(d.name,d)}},{toolWarnings:[]});
  assert.equal(tools.has('remote_terminal_control'),false);assert.equal(tools.has('remote_command_control'),false);
});

test('human and Agent share terminal input during a conversation; native cancellation still interrupts the pending send',async t=>{
  const root=await mkdtemp(join(tmpdir(),'remote-ops-shared-')),previous=process.env.DSH_HOME,writes=[];
  process.env.DSH_HOME=root;const host=createFakeHost({localShellOptions:{onInput:text=>writes.push(text)}}),state=new RemoteOpsState(host.ctx);
  await state.ready;
  t.after(async()=>{state.disposed=true;await state.localSession?.close();await host.dispose();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(root,{recursive:true,force:true});});
  const owner={id:'a'},controller=new AbortController();
  const send=state.send(owner,'local-cmd',{text:'echo agent',quietMs:1000,signal:controller.signal});
  await new Promise(r=>setTimeout(r,10));
  await state.input(owner,'local-cmd','echo human\r','manual');
  controller.abort();assert.equal((await send).waitReason,'cancelled');
  await state.input(owner,'local-cmd','echo next\r');
  assert.deepEqual(writes,['echo agent\r','echo human\r','\u0003','echo next\r']);
  const stream=state.localSession.outputBuffer.streamId;
  await assert.rejects(state.input(owner,'local-cmd','stale','manual','old-'+stream),{code:'TERMINAL_STREAM_CHANGED'});
});

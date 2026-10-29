import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDesktopAction, validateLaunch, DesktopWorkspace } from '../lib/desktop-workspace.js';

test('desktop actions reject malformed batches before dispatch and preserve empty fills', () => {
  for (const steps of ['[{"action":"click"}]', {}, [], [{ action: 'click' }], [{ action: 'fill', ref: 'x', text: null }]]) {
    assert.throws(() => validateDesktopAction({ requestId: 'r', snapshotId: 's', steps }), /DESKTOP_ARGUMENT_INVALID/);
  }
  assert.deepEqual(validateDesktopAction({ requestId: 'r', snapshotId: 's', steps: [{ action: 'fill', ref: 'e1', text: '' }] }).steps, [{ action: 'fill', ref: 'e1', text: '' }]);
  assert.throws(() => validateLaunch({ path: 'C:\\App.exe', args: '--bad' }), /DESKTOP_ARGUMENT_INVALID/);
  assert.deepEqual(validateLaunch({ path: 'C:\\Ops Data\\App.exe', args: ['中文 & | "'] }).args, ['中文 & | "']);
});

function fixture() {
  const calls = [], waits = [];
  const transport = { info: { workerId: 'w', sessionId: 1 }, call: async (method, args) => {
    calls.push({ method, args });
    if (method === 'act') await new Promise(r => waits.push(r));
    return method === 'observe' ? { snapshotId: 'snapshot', windows: [], elements: [], screenshot: null } : { status: 'completed', verified: false };
  }, close() {} };
  const ws = new DesktopWorkspace({ ready: Promise.resolve(), findEnvironment: () => ({id:'env',platform:'windows'}) }, { connect: async () => transport });
  return { ws, calls, waits };
}

test('desktop sessions isolate conversations and disconnect leaves applications alone', async () => {
  const {ws,calls}=fixture(); const a=await ws.connect('a',{environment:'env',windowsSessionId:1});
  assert.throws(()=>ws.session('b',a.desktopId),/DESKTOP_SESSION_NOT_FOUND/);
  await ws.disconnect('a',a.desktopId);
  assert.equal(calls.some(c=>c.method==='close-app'),false);
  assert.equal(ws.snapshot('a').sessions.length,0);
});

test('desktop request IDs deduplicate actions and reject changed reuse', async () => {
  const {ws,calls,waits}=fixture();const s=await ws.connect('a',{environment:'env',windowsSessionId:1});
  const args={desktopId:s.desktopId,requestId:'one',snapshotId:'snapshot',steps:[{action:'click',ref:'e1'}]};
  const first=ws.act('a',args);await new Promise(r=>setImmediate(r));
  const repeat=ws.act('a',args);
  await assert.rejects(ws.act('a',{...args,steps:[{action:'click',ref:'e2'}]}),/DESKTOP_REQUEST_CONFLICT/);
  waits.shift()(); assert.deepEqual(await repeat,await first);assert.equal(calls.filter(c=>c.method==='act').length,1);
});

test('cancellation prevents later desktop steps and uncertain effects are not replayed', async () => {
  const {ws,calls,waits}=fixture();const s=await ws.connect('a',{environment:'env',windowsSessionId:1});
  const controller=new AbortController();
  const pending=ws.act('a',{desktopId:s.desktopId,requestId:'cancel',snapshotId:'snapshot',steps:[{action:'click',ref:'e1'},{action:'click',ref:'e2'}]},controller.signal);
  await new Promise(r=>setImmediate(r));controller.abort();waits.shift()();
  const result=await pending;assert.equal(result.status,'cancelled');assert.equal(result.results.length,1);assert.equal(calls.filter(c=>c.method==='act').length,1);
});

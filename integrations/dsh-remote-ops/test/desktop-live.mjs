// Live Windows desktop gate. The target application is a dedicated test fixture.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectDesktop } from '../lib/desktop-transport.js';

const out=resolve(process.env.DESKTOP_OUTPUT??'../../output/desktop-live');await mkdir(out,{recursive:true});
const evidence={kind:'real-windows-interactive-desktop',steps:[],errors:[]};let transport,app;
const runId=randomUUID();
const step=async(name,work)=>{await work();evidence.steps.push({name,pass:true});console.log('PASS '+name);};
try {
  transport=await connectDesktop(null,{environment:'local'});evidence.target=transport.info;
  assert.ok(transport.info.sessionId>0,'An actual interactive user session is required');
  const fixture=resolve('desktop/test-app/RemoteOpsDesktopTest.exe');
  const file=join(out,'桌面结果.txt');
  await step('launch an actual visible Windows test application',async()=>{app=await transport.call('launch',{path:fixture,args:[file],requestId:runId+'-launch-test'});assert.ok(app.pid>0);});
  let snap;
  await step('observe real UIA controls and capture a nonempty window',async()=>{
    for(let i=0;i<50;i++){try{snap=await transport.call('observe',{pid:app.pid});if(snap.elements?.some(e=>e.automationId==='InputText'))break;}catch(error){if(error.code!=='DESKTOP_WINDOW_NOT_FOUND')throw error;}await new Promise(r=>setTimeout(r,200));}
    assert.ok(snap.elements.some(e=>e.automationId==='InputText'));assert.ok(snap.screenshot?.data);await writeFile(join(out,'before.jpg'),Buffer.from(snap.screenshot.data,'base64'));
  });
  await step('fill Unicode through UIA and verify the value',async()=>{
    const ref=snap.elements.find(e=>e.automationId==='InputText').ref;
    await transport.call('act',{snapshotId:snap.snapshotId,step:{action:'fill',ref,text:'Windows 桌面 中文 & " 空格'},requestId:runId+'-fill-test'});
    snap=await transport.call('observe',{pid:app.pid});assert.equal(snap.elements.find(e=>e.automationId==='InputText').value,'Windows 桌面 中文 & " 空格');
  });
  await step('invoke Save and verify the resulting file outside the UI',async()=>{
    const ref=snap.elements.find(e=>e.automationId==='SaveButton').ref;
    const args={snapshotId:snap.snapshotId,step:{action:'click',ref},requestId:runId+'-save-test'};
    const a=await transport.call('act',args),b=await transport.call('act',args);assert.deepEqual(a,b);
    assert.equal(await readFile(file,'utf8'),'Windows 桌面 中文 & " 空格');
    snap=await transport.call('observe',{pid:app.pid});assert.equal(snap.elements.find(e=>e.automationId==='SaveCount').name,'Saved 1');await writeFile(join(out,'after.jpg'),Buffer.from(snap.screenshot.data,'base64'));
  });
  await step('reject an invented element without input injection',async()=>{await assert.rejects(transport.call('act',{snapshotId:snap.snapshotId,step:{action:'click',ref:'missing'},requestId:runId+'-missing-test'}),/DESKTOP_ELEMENT/);});
} catch(error){evidence.errors.push(error.stack);process.exitCode=1;console.error(error.message);}
finally {transport?.close();if(app?.pid){try{execFileSync('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}evidence.status=process.exitCode?'failed':'passed';await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));}

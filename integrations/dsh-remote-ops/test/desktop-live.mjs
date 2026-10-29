// Live Windows desktop gate. The target application is a dedicated test fixture.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectDesktop, desktopRuntime } from '../lib/desktop-transport.js';
import { RemoteOpsState } from '../lib/state/index.js';
import { startWindowsOpenSsh } from '../../../e2e/harness/windows-openssh.mjs';

const out=resolve(process.env.DESKTOP_OUTPUT??'../../output/desktop-live');await mkdir(out,{recursive:true});
const evidence={kind:'real-windows-interactive-desktop',steps:[],errors:[]};let transport,app,ssh,snap,targetState,targetArgs;
const runId=randomUUID();
const step=async(name,work)=>{await work();evidence.steps.push({name,pass:true});console.log('PASS '+name);};
try {
  evidence.os=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,ProductType | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true}));
  if(process.env.DESKTOP_SSH==='1'){
    ssh=await startWindowsOpenSsh({root:join(out,'sshd')});process.env.DSH_HOME=join(out,'dsh-home');
    const state=new RemoteOpsState({});await state.ready;await state.saveEnvironment(ssh.environment);
    const probe=await connectDesktop(state,{environment:ssh.environment.id,inspect:true});evidence.bridgeProbe=probe;
    targetState=state;targetArgs={environment:ssh.environment.id};transport=await connectDesktop(targetState,targetArgs);evidence.transport='real-openssh';
  }else{targetState={base:join(out,runId)};targetArgs={environment:'local'};transport=await connectDesktop(targetState,targetArgs);evidence.transport='local';}
  evidence.target=transport.info;
  assert.ok(transport.info.sessionId>0,'An actual interactive user session is required');
  await step('exchange repeated requests on one desktop transport',async()=>{assert.equal((await transport.call('status')).workerId,transport.info.workerId);assert.equal((await transport.call('status')).workerId,transport.info.workerId);});
  await step('independent connections share one user-session worker and can disconnect separately',async()=>{const other=await connectDesktop(targetState,targetArgs);try{assert.equal(other.info.workerId,transport.info.workerId);}finally{other.close();}assert.equal((await transport.call('status')).interactive,true);});
  if(!ssh)await step('rapid readiness probes cannot terminate the shared worker',async()=>{
    const runtime=await desktopRuntime(),endpoint=JSON.parse(await readFile(join(targetState.base,'desktop-runtime',runtime.id,'endpoint-'+transport.info.sessionId+'.json'),'utf8'));
    assert.match(endpoint.pipe,/^[\w-]+$/);
    const script=`$ProgressPreference='SilentlyContinue';$count=0;for($i=0;$i -lt 160;$i++){$p=[IO.Pipes.NamedPipeClientStream]::new('.', '${endpoint.pipe}', [IO.Pipes.PipeDirection]::InOut);try{$p.Connect(100);$count++}catch{}finally{$p.Dispose()}};Write-Output $count`;
    const count=Number(execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000}));
    assert.ok(count>=80,'Most readiness probes must connect');assert.equal((await transport.call('status')).workerId,transport.info.workerId,'Readiness probes must not kill or replace the worker');
  });
  const fixture=resolve('desktop/test-app/RemoteOpsDesktopTest.exe');
  const file=join(out,'桌面结果.txt');
  await step('launch an actual visible Windows test application',async()=>{app=await transport.call('launch',{path:fixture,args:[file],requestId:runId+'-launch-test'});assert.ok(app.pid>0);});
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
    for(let i=0;!snap.elements.some(e=>e.automationId==='SaveButton')&&i<5;i++)snap=await transport.call('observe',{pid:app.pid});
    const ref=snap.elements.find(e=>e.automationId==='SaveButton').ref;
    const args={snapshotId:snap.snapshotId,step:{action:'click',ref},requestId:runId+'-save-test'};
    const a=await transport.call('act',args),b=await transport.call('act',args);assert.deepEqual(a,b);
    assert.equal(await readFile(file,'utf8'),'Windows 桌面 中文 & " 空格');
    snap=await transport.call('observe',{pid:app.pid});assert.equal(snap.elements.find(e=>e.automationId==='SaveCount').name,'Saved 1');await writeFile(join(out,'after.jpg'),Buffer.from(snap.screenshot.data,'base64'));
  });
  await step('real keyboard and window-relative mouse input preserve Unicode and verify the saved file',async()=>{
    snap=await transport.call('observe',{pid:app.pid});let ref=snap.elements.find(e=>e.automationId==='InputText').ref;
    await transport.call('act',{snapshotId:snap.snapshotId,step:{action:'keys',ref,keys:'CTRL+A'},requestId:runId+'-keys'});
    snap=await transport.call('observe',{pid:app.pid});ref=snap.elements.find(e=>e.automationId==='InputText').ref;
    await transport.call('act',{snapshotId:snap.snapshotId,step:{action:'text',ref,text:'键盘输入 Keyboard'},requestId:runId+'-text'});
    snap=await transport.call('observe',{pid:app.pid});assert.equal(snap.elements.find(e=>e.automationId==='InputText').value,'键盘输入 Keyboard');
    const button=snap.elements.find(e=>e.automationId==='SaveButton').bounds;
    await transport.call('act',{snapshotId:snap.snapshotId,step:{action:'click',x:Math.floor(button.x+button.width/2-snap.bounds.x),y:Math.floor(button.y+button.height/2-snap.bounds.y)},requestId:runId+'-mouse'});
    for(let i=0;i<20&&(await readFile(file,'utf8'))!=='键盘输入 Keyboard';i++)await new Promise(r=>setTimeout(r,50));
    assert.equal(await readFile(file,'utf8'),'键盘输入 Keyboard');
  });
  await step('reject worker identity changes before issuing effects',async()=>{await assert.rejects(transport.call('act',{workerId:'old-worker',snapshotId:snap.snapshotId,step:{action:'click',ref:'e1'},requestId:runId+'-worker'}),/DESKTOP_WORKER_CHANGED/);});
  await step('reject an invented element without input injection',async()=>{await assert.rejects(transport.call('act',{snapshotId:snap.snapshotId,step:{action:'click',ref:'missing'},requestId:runId+'-missing-test'}),/DESKTOP_ELEMENT/);});
} catch(error){if(snap){await writeFile(join(out,'failed-snapshot.json'),JSON.stringify({...snap,screenshot:undefined},null,2));if(snap.screenshot?.data)await writeFile(join(out,'failed-window.jpg'),Buffer.from(snap.screenshot.data,'base64'));}evidence.errors.push(error.stack);process.exitCode=1;console.error(error.message);}
finally {transport?.close();if(app?.pid){try{execFileSync('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}await ssh?.close();evidence.status=process.exitCode?'failed':'passed';await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));}

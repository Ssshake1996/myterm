import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, cp, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BrowserWorkspace } from '../../integrations/dsh-remote-ops/lib/browser-workspace.js';

test('postinstall prepares a missing bundle from matching files without downloads and reuses it', {timeout:120000}, async t=>{
  const root=await mkdtemp(join(tmpdir(),'remote-ops-browser-prepare-'));
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/'));await rm(root,{recursive:true,force:true});});
  const plugin=fileURLToPath(new URL('../../integrations/dsh-remote-ops/',import.meta.url));
  for(const directory of ['lib','scripts'])await mkdir(join(root,directory),{recursive:true});
  await writeFile(join(root,'package.json'),JSON.stringify({type:'module'}));
  await cp(join(plugin,'lib/browser-runtime.js'),join(root,'lib/browser-runtime.js'));
  await cp(join(plugin,'scripts/bundle-browser-runtime.mjs'),join(root,'scripts/bundle-browser-runtime.mjs'));
  await symlink(join(plugin,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  const run=()=>spawnSync(process.execPath,['scripts/bundle-browser-runtime.mjs'],{cwd:root,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:join(plugin,'browser/runtime',`${process.platform}-${process.arch}`),PLAYWRIGHT_DOWNLOAD_HOST:'http://127.0.0.1:9'},windowsHide:true,encoding:'utf8',timeout:60000});
  const first=run();assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/browser prepared/);
  const second=run();assert.equal(second.status,0,second.stderr);assert.match(second.stdout,/already matches/);
});

test('bundled browser records genuine human/Agent events, cross-origin frames, popups and redaction', {timeout:60000}, async t=>{
  const root=await mkdtemp(join(tmpdir(),'remote-ops-recording-live-'));
  const server=createServer((request,response)=>{
    response.setHeader('Content-Type','text/html; charset=utf-8');
    if(request.url==='/frame'){response.end('<label>Frame input<input id="frame-entry"></label>');return;}
    if(request.url==='/popup'){response.end('<label>Popup input<input id="popup-entry"></label>');return;}
    response.end(`<title>Recording fixture</title><label>Name<input id="name"></label><label>Password<input id="password" type="password"></label><label>API token<input id="token" name="api-token"></label><button id="save" onclick="document.querySelector('#result').textContent=document.querySelector('#name').value">Save</button><div id="result"></div><a id="popup" href="/popup" target="_blank">Popup</a><iframe id="child" src="http://localhost:${server.address().port}/frame"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,resolve));
  const w=new BrowserWorkspace({root});await w.ready;
  t.after(async()=>{await w.dispose();await new Promise(resolve=>server.close(resolve));assert.ok(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/'));await rm(root,{recursive:true,force:true});});
  const runtime=await w.runtime();assert.equal(runtime.modes.embedded.source,'bundled');
  const opened=await w.openUrl('live',`http://127.0.0.1:${server.address().port}/?token=do-not-export`),record=w.session('live',opened.id),page=record.pages.get(record.activePageId);
  const started=await w.recording('live',{action:'start',browserId:opened.id,name:'Real document events'});
  await page.getByLabel('Name',{exact:true}).fill('human entry');await page.getByLabel('Name',{exact:true}).press('Control+A');await page.getByRole('button',{name:'Save'}).click();
  await page.getByLabel('Password',{exact:true}).fill('human-password-secret');
  await page.getByLabel('API token',{exact:true}).fill('human-api-token-secret');
  await page.frameLocator('#child').getByLabel('Frame input').fill('cross origin entry');
  const single=await w.run('live',opened.id,[{action:'fill',target:{kind:'css',value:'#name'},value:'single Agent fill'}]);await single.done;
  const singleEvents=(await w.recording('live',{action:'read',recordingId:started.id,limit:200})).events;
  const beforeSingle=singleEvents.find(event=>event.details?.step?.value==='single Agent fill');
  assert.ok(singleEvents.some(event=>event.input?.value==='single Agent fill'&&event.duringActionId===beforeSingle.actionId));
  const job=await w.run('live',opened.id,[{action:'fill',target:{kind:'css',value:'#name'},value:'agent entry'},{action:'click',target:{kind:'css',value:'#save'},expect:{target:{kind:'css',value:'#result'},text:'agent entry'}}]);await job.done;assert.equal(job.status,'completed');
  const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'Popup'}).click();const popup=await popupPromise;
  await popup.getByLabel('Popup input').fill('popup entry');await popup.getByLabel('Popup input').press('Tab');
  await w.recording('live',{action:'stop',recordingId:started.id});
  const exported=await w.recordings.export('live',started.id),value=JSON.parse(exported.content);
  assert.ok(value.events.some(event=>event.source==='human'&&event.input?.value==='human entry'));
  assert.ok(value.events.some(event=>event.source==='agent'&&event.details?.step?.value==='agent entry'));
  assert.ok(value.events.some(event=>event.frame?.[0]?.selector==='#child'&&event.input?.value==='cross origin entry'));
  assert.ok(value.events.some(event=>event.input?.value==='popup entry'&&event.pageId!==opened.pages[0].id));
  assert.ok(value.events.some(event=>event.result?.completion==='checked'));
  assert.ok(value.events.some(event=>event.duringActionId));
  assert.ok(!value.events.some(event=>event.key==='Control+Control'));
  for(const secret of ['human-password-secret','human-api-token-secret','do-not-export'])assert.ok(!exported.content.includes(secret),secret+' leaked');
  const before=value.events.length;await page.getByLabel('Name',{exact:true}).fill('after stopping');assert.equal((await w.recording('live',{action:'read',recordingId:started.id,limit:200})).events.length,before);
  const output=resolve('output/recording-live');await mkdir(output,{recursive:true});await writeFile(join(output,'recording.json'),exported.content);await page.screenshot({path:join(output,'page.png'),mask:[page.locator('input')]});
  console.log(JSON.stringify({output,eventCount:before,runtime:runtime.modes.embedded.source}));
});

import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {BrowserWorkspace} from '../lib/browser-workspace.js';

const root=await mkdtemp(join(tmpdir(),'remote-ops-adaptive-live-'));
const evidence={kind:'real-browser-adaptive-focus',checks:[],errors:[]};
const pass=name=>{evidence.checks.push(name);console.log('PASS '+name);};
const server=createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url==='/child')res.end('<style>body{margin:0}main{width:1400px;height:1200px;position:relative}button{position:absolute;right:10px;bottom:10px}</style><main><button id="inner" onclick="this.textContent=\'Inner saved\'">Inner save</button></main>');
  else if(req.url==='/nested')res.end(`<style>body{margin:0}iframe{margin:40px;width:800px;height:360px}</style><iframe src="http://localhost:${server.address().port}/child"></iframe>`);
  else res.end('<style>body{margin:0}main{width:1600px;height:900px;position:relative}button{position:absolute;right:20px;bottom:20px;width:100px;height:40px}output{position:absolute;left:20px;top:20px}</style><main><output id="startup"></output><button id="save" onclick="document.querySelector(\'output\').textContent=\'Saved\'">Save</button></main><script>startup.textContent="initial="+innerWidth</script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const launchContext=(profile,options)=>chromium.launchPersistentContext(profile,{...options,headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:process.platform==='win32'?{channel:'chrome'}:{})});
const w=new BrowserWorkspace({root,launchContext});let number=0;
const until=async fn=>{const end=Date.now()+12000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,80));}throw Error('adaptive verification timed out');};
const run=async(r,steps)=>{const job=await w.run('test',r.id,steps,{requestId:'adaptive-'+ ++number});await job.done;assert.equal(job.status,'completed',job.error?.message);return job;};
try {
  await w.ready;
  const opened=await w.openUrl('test',origin+'/wide'),r=w.session('test',opened.id),page=r.pages.get(r.activePageId);
  page.on('pageerror',e=>evidence.errors.push(e.message));
  assert.equal(await page.locator('output').innerText(),'initial=1280');
  const hint={mode:'panel',zoom:'auto',width:1027,height:768,pageId:r.activePageId};
  await w.resizeViewport('test',r.id,hint);
  assert.ok(page.viewportSize().width>=1600);assert.ok(page.viewportSize().height>=900);
  const stable=page.viewportSize();
  for(const [width,height] of [[390,640],[640,480],[1440,400]])await w.resizeViewport('test',r.id,{...hint,width,height});
  assert.deepEqual(page.viewportSize(),stable);pass('fixed console fits without changing CSS geometry during panel resize');
  await w.resizeViewport('test',r.id,r.viewportHint,true);
  const restored=new BrowserWorkspace({root});await restored.ready;
  assert.ok(restored.initialViewport(origin+'/other').width>=1600);await restored.dispose();
  await w.navigate('test',r.id,'reload');assert.match(await page.locator('output').innerText(),/initial=16/);pass('learned website width survives reload and store restart');
  await w.resizeViewport('test',r.id,hint);
  const observed=await w.observeSnapshot('test',r.id,undefined,true);
  const box=await page.locator('#save').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  const before=page.viewportSize();
  const deferred=await w.resizeViewport('test',r.id,{...hint,zoom:'fit',width:390,height:640});
  assert.equal(deferred.viewportDeferred,true);assert.deepEqual(page.viewportSize(),before);
  await run(r,[{action:'click',target:{kind:'point',x,y,snapshotId:observed.snapshotId}}]);
  assert.equal(await page.locator('output').innerText(),'Saved');pass('MCP screenshot coordinates remain valid across a deferred viewport resize');
  await w.resizeViewport('test',r.id,hint);r.pendingViewport=undefined;
  await w.frame('test',r.id,{});
  await run(r,[{action:'click',target:'#save'}]);
  await until(async()=>{const frame=await w.frame('test',r.id,{});return frame.focus?.rect.x>1400;});
  assert.equal(recordingEnabled(r),false);pass('ordinary and MCP actions publish viewer focus without enabling recording');
  await w.navigate('test',r.id,'goto',origin+'/nested');await w.resizeViewport('test',r.id,hint);
  await run(r,[{action:'click',target:{kind:'css',value:'#inner',frame:'iframe'}}]);
  await until(()=>r.viewFocus?.rect.x>40&&r.viewFocus?.rect.x<900&&r.viewFocus?.rect.y<500);
  assert.equal(await page.frameLocator('iframe').locator('#inner').innerText(),'Inner saved');pass('cross-origin nested scrolling reports focus in top-level CSS pixels');
  await w.navigate('test',r.id,'goto',origin+'/wide');await w.resizeViewport('test',r.id,hint);
  const recording=await w.recording('test',{action:'start',browserId:r.id,name:'Display-only proof'});
  await run(r,[{action:'click',target:'#save'}]);
  await w.recording('test',{action:'stop',recordingId:recording.id});
  const log=await w.recording('test',{action:'read',recordingId:recording.id,limit:100});
  const clicks=log.events.filter(e=>e.kind==='interaction'&&e.action==='click'&&e.target?.css==='#save');
  assert.equal(clicks.length,1);assert.equal(await page.locator('.dsh-remote-ops__browserFocus').count(),0);
  assert.deepEqual(evidence.errors,[]);pass('recording keeps one real click and no GUI highlight DOM is injected');
  evidence.status='passed';
} catch(error){evidence.status='failed';evidence.failure=error.stack;throw error;}
finally {
  await w.dispose();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});
  if(process.env.ADAPTIVE_EVIDENCE){const out=resolve(process.env.ADAPTIVE_EVIDENCE);await mkdir(out,{recursive:true});await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');}
}
function recordingEnabled(record){return record.recording?.metadata.status==='recording';}

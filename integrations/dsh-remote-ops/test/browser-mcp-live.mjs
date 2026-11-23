// Runs the actual Microsoft MCP and browser against a loopback-only fixture.
// Also executed under an OS network namespace by the release gate.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {BrowserWorkspace} from '../lib/browser-workspace.js';
import {closeBrowserMcp} from '../lib/browser-mcp.js';

const root=await mkdtemp(join(tmpdir(),'remote-ops-mcp-'));
const evidence={kind:'actual-playwright-mcp-local-browser',networkIsolation:process.env.REMOTE_OPS_NETWORK_ISOLATION??'none',checks:[],requests:[]};
const check=(name)=>{evidence.checks.push(name);console.log('PASS '+name);};
const fixture='<title>Local MCP fixture</title><button id="menu" onclick="document.querySelector(\'nav\').hidden=false">System settings</button><nav hidden><button onclick="document.querySelector(\'form\').hidden=false">User management</button></nav><form hidden onsubmit="event.preventDefault();document.querySelector(\'output\').textContent=\'Saved \'+this.elements.user.value"><label>User name<input name="user"></label><button>Save</button></form><output></output><input type="password" value="not-for-model"><canvas width="100" height="50" style="position:absolute;left:300px;top:200px" onclick="document.querySelector(\'output\').textContent=\'Canvas opened\'"></canvas><script>let c=document.querySelector(\'canvas\').getContext(\'2d\');c.fillStyle=\'#2463eb\';c.fillRect(0,0,100,50);c.fillStyle=\'white\';c.fillText(\'Settings\',15,30)</script>';
const server=createServer((req,res)=>{evidence.requests.push({method:req.method,path:req.url});res.setHeader('Content-Type','text/html');res.end(fixture);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const w=new BrowserWorkspace({root,launchContext:async(profile,options)=>chromium.launchPersistentContext(profile,{...options,headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:process.platform==='win32'?{channel:'chrome'}:{})})});
let n=0;
const act=async(id,snapshot,target,action='click',value)=>{const job=await w.run('tester',id,[{action,target:{...target,snapshotId:snapshot.snapshotId},...(value!==undefined?{value}:{})}],{requestId:'mcp-live-'+ ++n});await job.done;return job;};
const ref=(s,name)=>{const line=s.snapshot.split('\n').find(line=>line.includes('"'+name+'"'));assert.ok(line,'Missing '+name+' in '+s.snapshot);return line.match(/\[ref=(\w+)\]/)[1];};
try{
  await w.ready;const session=await w.openUrl('tester',url),r=w.session('tester',session.id),page=r.pages.get(r.activePageId);
  const plain=await page.screenshot({animations:'disabled'});
  await w.testTarget('tester',r.id,{kind:'css',value:'body'});
  assert.ok(r.targetHighlight);
  await new Promise(resolve=>setTimeout(resolve,1700));await r.highlightQueue;
  assert.equal(r.targetHighlight,undefined);
  assert.deepEqual(await page.screenshot({animations:'disabled'}),plain);
  check('whole-page locator preview expires and restores exact original pixels');
  await w.testTarget('tester',r.id,{kind:'css',value:'body'});
  await w.clearOwnerHighlights('tester');
  assert.equal(r.targetHighlight,undefined);
  assert.deepEqual(await page.screenshot({animations:'disabled'}),plain);
  check('conversation end clears the preview without navigation or page changes');
  let s=await w.observeSnapshot('tester',r.id);
  assert.equal(s.engine,'playwright-mcp');assert.match(s.snapshot,/System settings/);assert.doesNotMatch(s.snapshot,/not-for-model/);check('MCP reads menu hierarchy without returning a password');
  let job=await act(r.id,s,{kind:'ref',value:ref(s,'System settings')});assert.equal(job.status,'completed',job.error?.message);
  s=await w.observeSnapshot('tester',r.id);assert.match(s.snapshot,/User management/);check('ref click expands a hidden navigation entry');
  await act(r.id,s,{kind:'ref',value:ref(s,'User management')});s=await w.observeSnapshot('tester',r.id);
  job=await act(r.id,s,{kind:'ref',value:ref(s,'User name')},'fill','Example user');assert.equal(job.status,'completed',job.error?.message);
  s=await w.observeSnapshot('tester',r.id);assert.doesNotMatch(s.snapshot,/Example user/);
  job=await act(r.id,s,{kind:'ref',value:ref(s,'Save')});assert.equal(job.status,'completed',job.error?.message);assert.equal(await page.locator('output').innerText(),'Saved Example user');check('MCP fills and submits in the same browser session');
  s=await w.observeSnapshot('tester',r.id,undefined,true);assert.ok(s.imageBuffer.length>500);
  for(let attempt=0;attempt<3;attempt++){
    job=await act(r.id,s,{kind:'point',x:350,y:225});
    if(job.status==='completed')break;
    // A pre-dispatch stale-image rejection is explicitly safe to re-observe.
    if(job.status!=='failed'||job.error?.code!=='BROWSER_OBSERVATION_STALE')break;
    evidence.visualObservationRetries=(evidence.visualObservationRetries??0)+1;
    if(process.env.MCP_EVIDENCE){const dir=resolve(process.env.MCP_EVIDENCE);await mkdir(dir,{recursive:true});await writeFile(join(dir,'observed-'+attempt+'.png'),s.imageBuffer);await page.screenshot({path:join(dir,'current-'+attempt+'.png'),animations:'disabled',scale:'css'});}
    s=await w.observeSnapshot('tester',r.id,undefined,true);
  }
  assert.equal(job.status,'completed',job.error?.message);assert.equal(await page.locator('output').innerText(),'Canvas opened');check('actual screenshot coordinates operate a canvas entry');
  const stale=s;job=await act(r.id,stale,{kind:'point',x:350,y:225});assert.equal(job.status,'failed');assert.match(job.error.message,/STALE/);check('consumed screenshots cannot be replayed');
  s=await w.observeSnapshot('tester',r.id);await page.locator('#menu').evaluate(el=>el.textContent='Changed by human');job=await act(r.id,s,{kind:'ref',value:ref(s,'System settings')});assert.equal(job.status,'failed');assert.match(job.error.message,/STALE/);check('human page changes invalidate old navigation observations');
  assert.throws(()=>w.observeSnapshot('foreign-owner',r.id),/NOT_FOUND/);check('observations stay in their DSH conversation');
  const second=await r.context.newPage();await second.goto(url);const secondId=w.attachPage(r,second);
  s=await w.observeSnapshot('tester',r.id,secondId);assert.match(s.snapshot,/System settings/);
  job=await w.run('tester',r.id,[{action:'click',target:{kind:'ref',value:ref(s,'System settings'),snapshotId:s.snapshotId}}],{requestId:'second-page',pageId:secondId});await job.done;assert.equal(job.status,'completed',job.error?.message);assert.equal(await second.locator('nav').isVisible(),true);
  assert.equal(r.activePageId,secondId);check('duplicate-URL tabs are selected by identity, not URL guessing');
  await closeBrowserMcp(r);assert.equal(page.isClosed(),false);assert.equal(second.isClosed(),false);check('disposing MCP preserves the plugin-owned browser');
}finally{
  await w.dispose();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});
  if(process.env.MCP_EVIDENCE){const dir=resolve(process.env.MCP_EVIDENCE);await mkdir(dir,{recursive:true});await writeFile(join(dir,'evidence.json'),JSON.stringify(evidence,null,2));}
}

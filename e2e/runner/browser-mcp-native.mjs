// Native unmodified DSH + installed plugin + deterministic local model fixture.
// This verifies tool/image transport, not a real model's visual reasoning quality.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {join,resolve,dirname} from 'node:path';
import {chromium} from '../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs';

const cli=process.env.DSH_CLI,pkg=process.argv[2]&&resolve(process.argv[2]);
if(!cli||!pkg)throw Error('Set DSH_CLI and pass a candidate tgz');
const out=resolve(process.env.MCP_NATIVE_OUTPUT??'output/browser-mcp-native');
const home=join(out,'dsh-home'),profile=join(home,'profiles/web');await mkdir(profile,{recursive:true});
const env={...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',REMOTE_OPS_ACCEPTANCE_KEY:'local-fixture',PLAYWRIGHT_DOWNLOAD_HOST:'http://127.0.0.1:9',PLAYWRIGHT_BROWSERS_PATH:join(out,'empty-cache')};
const run=args=>new Promise((yes,no)=>{const p=spawn(process.execPath,[cli,...args],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';p.stdout.on('data',b=>text+=b);p.stderr.on('data',b=>text+=b);p.on('error',no);p.on('close',code=>code?no(Error(text.slice(-3500))):yes(text));});
const manifest=join(profile,'node_modules/@dsh/remote-ops/package.json');
if(process.env.MCP_NATIVE_PREPARE_ONLY){await writeFile(join(out,'install.log'),await run(['plugin','--profile','web','add',pkg]));console.log('Prepared installed candidate');process.exit(0);}
try{await readFile(manifest);}catch{await writeFile(join(out,'install.log'),await run(['plugin','--profile','web','add',pkg]));}
const evidence={kind:'native-dsh-browser-mcp',model:'deterministic-local-fixture',packageSha256:createHash('sha256').update(await readFile(pkg)).digest('hex'),hostVersion:JSON.parse(await readFile(join(dirname(cli),'../package.json'),'utf8')).version,installedVersion:JSON.parse(await readFile(manifest,'utf8')).version,checks:[],errors:[],imageSeen:false};
// DSH appends image provenance text after the JSON text part in tool messages.
const decode=v=>{if(typeof v==='string'){try{return decode(JSON.parse(v));}catch{try{return decode(JSON.parse(v.split('\n')[0]));}catch{return v;}}}if(Array.isArray(v))return v.map(decode).find(x=>x&&typeof x==='object')??v.map(decode).join('\n');return v?.type==='text'?decode(v.text):v;};
const proofs=new Map(),held=new Map();let live,snapshot,host,browser,page;const logs=[];
const fixture='<style>html{background:white}body{min-height:calc(100vh - 16px);background:white}</style><title>Native browser MCP</title><button onclick="document.querySelector(\'nav\').hidden=false">System settings</button><nav hidden><button onclick="document.querySelector(\'output\').textContent=\'Users opened\'">User management</button></nav><output></output><input aria-label="Shared human input" style="position:absolute;left:30px;top:110px;width:180px" oninput="document.querySelector(\'output\').textContent=this.value"><canvas width="100" height="50" style="position:absolute;left:300px;top:200px" onclick="document.querySelector(\'output\').textContent=\'Visual entry opened\'"></canvas><script>let c=document.querySelector(\'canvas\').getContext(\'2d\');c.fillStyle=\'#2463eb\';c.fillRect(0,0,100,50);c.fillStyle=\'white\';c.fillText(\'Settings\',15,30)</script>';
const server=createServer(async(req,res)=>{
  try{
    if(req.url==='/page'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw),messages=body.messages??[];
    if(messages.some(m=>JSON.stringify(m.content).includes('data:image/')))evidence.imageSeen=true;
    const at=messages.findLastIndex(m=>m.role==='user'&&/MCP_NATIVE_(READY|SNAPSHOT|MENU|IMAGE|POINT|READ|PREVIEW|CANCEL)/.test(JSON.stringify(m.content)));
    const stage=at>=0?/MCP_NATIVE_(READY|SNAPSHOT|MENU|IMAGE|POINT|READ|PREVIEW|CANCEL)/.exec(JSON.stringify(messages[at].content))[1]:'NONE';
    const results=messages.slice(at+1).filter(m=>m.role==='tool').map(m=>decode(m.content));
    const ids=live?{browserId:live.id,pageId:live.activePageId}:{};
    const menu=snapshot?.snapshot.split('\n').find(line=>line.includes('"System settings"'))?.match(/\[ref=(\w+)\]/)?.[1];
    const plans={READY:[['skill',{name:'remote-ops-browser'}],['remote_browser_open',{url:`http://127.0.0.1:${server.address().port}/page`,display:'embedded'}]],
      SNAPSHOT:[['remote_browser_read',{...ids,snapshot:true}]],MENU:[['remote_browser_run',{...ids,requestId:'native-mcp-menu',steps:[{action:'click',target:{kind:'ref',value:menu,snapshotId:snapshot?.snapshotId}}]}]],
      IMAGE:[['remote_browser_read',{...ids,image:true}]],POINT:[['remote_browser_run',{...ids,requestId:'native-mcp-point-'+snapshot?.snapshotId,steps:[{action:'click',target:{kind:'point',x:350,y:225,snapshotId:snapshot?.snapshotId}}]}]],READ:[['remote_browser_read',ids]],
      PREVIEW:[['remote_browser_read',{...ids,target:{kind:'css',value:'body'}}]],CANCEL:[['remote_browser_read',{...ids,target:{kind:'css',value:'body'}}]]};
    const plan=plans[stage]??[];res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'mcp-native',object:'chat.completion.chunk',created:1,model:'native-test',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    if(at>=0&&body.tools?.length&&results.length<plan.length&&!results.some(v=>typeof v==='string'&&v.startsWith('Error:'))){const [name,args]=plan[results.length];emit({role:'assistant',tool_calls:[{index:0,id:'mcp-'+Date.now(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls');}
    else {if(at>=0&&body.tools?.length){proofs.set(stage,results);if(['PREVIEW','CANCEL'].includes(stage))await new Promise(resolve=>{held.set(stage,resolve);res.once('close',resolve);});}emit({role:'assistant',content:'MCP_NATIVE_DONE'},'stop');}
    res.end('data: [DONE]\n\n');
  }catch(error){if(!res.headersSent)res.writeHead(500);res.end(String(error));}
});
const until=async fn=>{const end=Date.now()+60000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,150));}throw Error('Native MCP acceptance timed out');};
const pass=name=>{evidence.checks.push(name);console.log('PASS '+name);};
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const documents=join(out,'fixture-documents');await mkdir(documents,{recursive:true});
  await writeFile(join(profile,'cordis.patch.yml'),`- id: workspace-controller
  config:
    documentsDirectory: ${JSON.stringify(documents)}
- id: ui-settings-general
  config:
    welcomeNoticeVersion: 2026-09-28.1
- id: agent-default-model
  config:
    provider: remote-ops-acceptance
    model: native-test
- id: llm-pi-ai
  config:
    providers:
      remote-ops-acceptance:
        api: openai-completions
        baseURL: http://127.0.0.1:${server.address().port}/v1
        apiKeyEnv: REMOTE_OPS_ACCEPTANCE_KEY
        models:
          - id: native-test
            name: Local browser MCP acceptance
            contextWindow: 262144
            maxTokens: 4096
            input: [text, image]
`);
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  host=spawn(process.execPath,[cli,'--profile','web','--host','127.0.0.1','--port',String(port),'--no-open'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  logs.push(createWriteStream(join(out,'stdout.log')),createWriteStream(join(out,'stderr.log')));host.stdout.pipe(logs[0]);host.stderr.pipe(logs[1]);
  const url=await until(async()=>{if(host.exitCode!==null)throw Error('DSH exited');return(await readFile(join(out,'stdout.log'),'utf8').catch(()=>'' )).match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?\\S+`))?.[0];});
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'chrome'})});
  page=await browser.newPage({locale:'zh-CN',viewport:{width:1500,height:1000}});page.setDefaultTimeout(60000);page.on('pageerror',e=>evidence.errors.push(e.message));
  evidence.responses=[];page.on('response',response=>{if(response.url().includes('/api/'))evidence.responses.push({path:new URL(response.url()).pathname,status:response.status()});});
  evidence.sockets=[];page.on('websocket',socket=>{
    const detail={path:new URL(socket.url()).pathname,sent:0,received:0};evidence.sockets.push(detail);
    socket.on('framesent',()=>detail.sent++);socket.on('framereceived',()=>detail.received++);
    socket.on('socketerror',error=>detail.error=String(error));socket.on('close',()=>detail.closed=true);
  });
  page.on('requestfailed',request=>evidence.errors.push(request.method()+' '+new URL(request.url()).pathname+' '+request.failure()?.errorText));
  await page.goto(url);
  const editor=page.getByRole('textbox',{name:/描述你想要|发消息或创建任务|describe what|message or create/i});await editor.waitFor();
  const agent=async stage=>{proofs.delete(stage);await until(()=>editor.isEditable());await editor.fill('MCP_NATIVE_'+stage);await editor.press('Enter');return until(()=>proofs.get(stage));};
  const ready=await agent('READY');assert.match(String(ready[0]),/remote-ops-browser/);live=ready[1];assert.ok(live?.id,JSON.stringify(ready));pass('installed bundled skill is loaded and native Agent opens a plugin browser');
  await page.getByRole('button',{name:'Remote Ops',exact:true}).click();await page.getByRole('tab',{name:'网页',exact:true}).click();await page.getByAltText('网页实时画面',{exact:true}).waitFor();
  snapshot=(await agent('SNAPSHOT'))[0]?.page;assert.match(snapshot?.snapshot??'',/System settings/);pass('native Agent receives the MCP menu snapshot');
  let result=(await agent('MENU'))[0];assert.ok(result?.id,JSON.stringify(result));
  await until(async()=>{const v=(await agent('READ'))[0];return v?.browser?.job?.status==='completed'&&v;});
  snapshot=(await agent('IMAGE'))[0]?.page;assert.ok(snapshot?.snapshotId);assert.equal(evidence.imageSeen,true);pass('actual screenshot bytes reach the configured image-capable model');
  const liveImage=page.getByAltText('网页实时画面',{exact:true});
  const divider=await page.locator('[data-side="rightbar"]').boundingBox();assert.ok(divider);
  const oldImage=await liveImage.boundingBox();
  await page.mouse.move(divider.x+divider.width/2,divider.y+divider.height/2);await page.mouse.down();
  await page.mouse.move(divider.x+divider.width/2+110,divider.y+divider.height/2,{steps:12});await page.mouse.up();
  await until(async()=>Math.abs((await liveImage.boundingBox()).width-oldImage.width)>30);
  result=(await agent('POINT'))[0];
  assert.ok(result?.id,JSON.stringify(result));
  const rejected=await until(async()=>{const v=(await agent('READ'))[0];return v?.browser?.job?.status==='failed'&&v;});
  assert.match(JSON.stringify(rejected),/BROWSER_OBSERVATION_STALE/);pass('sidebar resize rejects the old observation before dispatch');
  snapshot=(await agent('IMAGE'))[0]?.page;proofs.delete('POINT');
  result=(await agent('POINT'))[0];assert.ok(result?.id,JSON.stringify(result));
  await until(async()=>{const v=(await agent('READ'))[0];return v?.browser?.job?.status==='completed'&&v?.page?.text?.includes('Visual entry opened');});pass('native Agent coordinate action changes the actual plugin page');
  pass('fresh observation after a sidebar resize supplies valid native Agent coordinates');
  const pixels=()=>liveImage.evaluate(image=>{const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const g=c.getContext('2d');g.drawImage(image,0,0);return {edge:[...g.getImageData(6,70,1,1).data],middle:[...g.getImageData(220,300,1,1).data]};});
  const isWhite=p=>p.slice(0,3).every(v=>v>240),isBlue=p=>p[2]>p[0]+70;
  for(const stage of ['PREVIEW','CANCEL']){
    const preview=await agent(stage);assert.equal(preview[0]?.target?.unique,true,JSON.stringify(preview));
    const previewAt=Date.now();
    await until(async()=>isBlue((await pixels()).edge));
    assert.ok(isWhite((await pixels()).middle),'locator preview must not tint the page');
    await page.screenshot({path:join(out,stage.toLowerCase()+'-outline.png')});
    if(stage==='PREVIEW'){
      // Click and type through the real embedded surface while the Agent is still active.
      await liveImage.click({position:{x:90,y:120}});await page.getByRole('textbox',{name:'网页键盘输入',exact:true}).fill('Human during Agent');
      held.get(stage)();
    }else{
      const stop=page.getByRole('button',{name:/^(停止|Stop)(生成|回复|响应| response| generating)?$/i});
      await stop.click();held.get(stage)?.();
    }
    await until(async()=>isWhite((await pixels()).edge));
    const clearedMs=Date.now()-previewAt;
    (evidence.highlightCleanup??=[]).push({stage,clearedMs});
    assert.ok(clearedMs<1000,`${stage} must clear promptly at the conversation boundary, before the 1.5s expiry (${clearedMs}ms)`);
    assert.ok(isWhite((await pixels()).middle));
    pass(stage==='PREVIEW'?'native Agent turn end removes its outline while human input stays enabled':'native conversation stop removes its outline and preserves the browser');
  }
  const human=(await agent('READ'))[0];assert.match(human?.page?.text??'',/Human during Agent/);
  assert.equal(human.browser.closed,false);assert.equal(human.browser.id,live.id);
  pass('human typing during the Agent turn survives completion and cancellation');
  await page.screenshot({path:join(out,'native-mcp.png'),animations:'disabled'});
  assert.deepEqual(evidence.errors,[]);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=error.stack;evidence.proofs=Object.fromEntries(proofs);process.exitCode=1;console.error(error);if(page){evidence.dom=await page.locator('body').ariaSnapshot().catch(()=>null);evidence.navigatorOnline=await page.evaluate(()=>navigator.onLine).catch(()=>null);}await page?.screenshot({path:join(out,'failure.png')}).catch(()=>{});}
finally{
  for(const release of held.values())release();
  await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));await browser?.close();
  if(host?.exitCode===null){if(process.platform==='win32')await new Promise(r=>{const p=spawn('taskkill.exe',['/PID',String(host.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});p.on('close',r);p.on('error',r);});else host.kill('SIGTERM');}
  host?.stdout.destroy();host?.stderr.destroy();host?.unref();logs.forEach(log=>log.end());server.closeAllConnections();await new Promise(r=>server.close(r));
  console.log('Evidence: '+join(out,'evidence.json'));
}

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
const decode=v=>{if(typeof v==='string'){try{return decode(JSON.parse(v));}catch{return v;}}if(Array.isArray(v))return v.map(decode).find(x=>x&&typeof x==='object')??v.map(decode).join('\n');return v?.type==='text'?decode(v.text):v;};
const proofs=new Map();let live,snapshot,host,browser,page;const logs=[];
const fixture='<title>Native browser MCP</title><button onclick="document.querySelector(\'nav\').hidden=false">System settings</button><nav hidden><button onclick="document.querySelector(\'output\').textContent=\'Users opened\'">User management</button></nav><output></output><canvas width="100" height="50" style="position:absolute;left:300px;top:200px" onclick="document.querySelector(\'output\').textContent=\'Visual entry opened\'"></canvas><script>let c=document.querySelector(\'canvas\').getContext(\'2d\');c.fillStyle=\'#2463eb\';c.fillRect(0,0,100,50);c.fillStyle=\'white\';c.fillText(\'Settings\',15,30)</script>';
const server=createServer(async(req,res)=>{
  try{
    if(req.url==='/page'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw),messages=body.messages??[];
    if(messages.some(m=>JSON.stringify(m.content).includes('data:image/')))evidence.imageSeen=true;
    const at=messages.findLastIndex(m=>m.role==='user'&&/MCP_NATIVE_(READY|SNAPSHOT|MENU|IMAGE|POINT|READ)/.test(JSON.stringify(m.content)));
    const stage=at>=0?/MCP_NATIVE_(READY|SNAPSHOT|MENU|IMAGE|POINT|READ)/.exec(JSON.stringify(messages[at].content))[1]:'NONE';
    const results=messages.slice(at+1).filter(m=>m.role==='tool').map(m=>decode(m.content));
    const ids=live?{browserId:live.id,pageId:live.activePageId}:{};
    const menu=snapshot?.snapshot.split('\n').find(line=>line.includes('"System settings"'))?.match(/\[ref=(\w+)\]/)?.[1];
    const plans={READY:[['skill',{name:'remote-ops-browser'}],['remote_browser_open',{url:`http://127.0.0.1:${server.address().port}/page`,display:'embedded'}]],
      SNAPSHOT:[['remote_browser_read',{...ids,snapshot:true}]],MENU:[['remote_browser_run',{...ids,requestId:'native-mcp-menu',steps:[{action:'click',target:{kind:'ref',value:menu,snapshotId:snapshot?.snapshotId}}]}]],
      IMAGE:[['remote_browser_read',{...ids,image:true}]],POINT:[['remote_browser_run',{...ids,requestId:'native-mcp-point',steps:[{action:'click',target:{kind:'point',x:350,y:225,snapshotId:snapshot?.snapshotId}}]}]],READ:[['remote_browser_read',ids]]};
    const plan=plans[stage]??[];res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'mcp-native',object:'chat.completion.chunk',created:1,model:'native-test',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    if(at>=0&&body.tools?.length&&results.length<plan.length&&!results.some(v=>typeof v==='string'&&v.startsWith('Error:'))){const [name,args]=plan[results.length];emit({role:'assistant',tool_calls:[{index:0,id:'mcp-'+Date.now(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls');}
    else {if(at>=0&&body.tools?.length)proofs.set(stage,results);emit({role:'assistant',content:'MCP_NATIVE_DONE'},'stop');}
    res.end('data: [DONE]\n\n');
  }catch(error){if(!res.headersSent)res.writeHead(500);res.end(String(error));}
});
const until=async fn=>{const end=Date.now()+60000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,150));}throw Error('Native MCP acceptance timed out');};
const pass=name=>{evidence.checks.push(name);console.log('PASS '+name);};
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await writeFile(join(profile,'cordis.patch.yml'),`- id: ui-settings-general
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
  page=await browser.newPage({locale:'zh-CN',viewport:{width:1500,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',e=>evidence.errors.push(e.message));await page.goto(url);
  const editor=page.getByRole('textbox',{name:/描述你想要|发消息或创建任务/});await editor.waitFor();
  const agent=async stage=>{proofs.delete(stage);await until(()=>editor.isEditable());await editor.fill('MCP_NATIVE_'+stage);await editor.press('Enter');return until(()=>proofs.get(stage));};
  const ready=await agent('READY');assert.match(String(ready[0]),/remote-ops-browser/);live=ready[1];assert.ok(live?.id,JSON.stringify(ready));pass('installed bundled skill is loaded and native Agent opens a plugin browser');
  await page.getByRole('button',{name:'Remote Ops',exact:true}).click();await page.getByRole('tab',{name:'网页',exact:true}).click();await page.getByAltText('网页实时画面',{exact:true}).waitFor();
  snapshot=(await agent('SNAPSHOT'))[0]?.page;assert.match(snapshot?.snapshot??'',/System settings/);pass('native Agent receives the MCP menu snapshot');
  let result=(await agent('MENU'))[0];assert.ok(result?.id,JSON.stringify(result));
  await until(async()=>{const v=(await agent('READ'))[0];return v?.browser?.job?.status==='completed'&&v;});
  snapshot=(await agent('IMAGE'))[0]?.page;assert.ok(snapshot?.snapshotId);assert.equal(evidence.imageSeen,true);pass('actual screenshot bytes reach the configured image-capable model');
  result=(await agent('POINT'))[0];assert.ok(result?.id,JSON.stringify(result));
  await until(async()=>{const v=(await agent('READ'))[0];return v?.browser?.job?.status==='completed'&&v?.page?.text?.includes('Visual entry opened');});pass('native Agent coordinate action changes the actual plugin page');
  await page.screenshot({path:join(out,'native-mcp.png'),animations:'disabled'});
  assert.deepEqual(evidence.errors,[]);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=error.stack;evidence.proofs=Object.fromEntries(proofs);process.exitCode=1;console.error(error);await page?.screenshot({path:join(out,'failure.png')}).catch(()=>{});}
finally{
  await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));await browser?.close();
  if(host?.exitCode===null){if(process.platform==='win32')await new Promise(r=>{const p=spawn('taskkill.exe',['/PID',String(host.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});p.on('close',r);p.on('error',r);});else host.kill('SIGTERM');}
  host?.stdout.destroy();host?.stderr.destroy();host?.unref();logs.forEach(log=>log.end());server.closeAllConnections();await new Promise(r=>server.close(r));
  console.log('Evidence: '+join(out,'evidence.json'));
}

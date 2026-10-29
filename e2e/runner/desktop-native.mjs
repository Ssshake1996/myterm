import assert from 'node:assert/strict';
import {chromium} from '../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

// A native, installed DSH host and real visible Windows fixture. The provider is
// deterministic so tool arguments and image delivery can be asserted precisely.
const cli=process.env.DSH_CLI;if(!cli||!process.argv[2])throw Error('Set DSH_CLI and pass the tgz to install');
const pkg=resolve(process.argv[2]),out=resolve(process.env.DESKTOP_NATIVE_OUTPUT??'output/desktop-native');await mkdir(out,{recursive:true});
const home=join(out,'dsh-home'),profile=join(home,'profiles/web'),fixture=resolve('integrations/dsh-remote-ops/desktop/test-app/RemoteOpsDesktopTest.exe'),resultFile=join(out,'native-result.txt');
const evidence={kind:'native-dsh-real-windows-desktop',packageSha256:createHash('sha256').update(await readFile(pkg)).digest('hex'),steps:[],errors:[],tools:[],imageDelivered:false};
const decode=value=>{if(typeof value==='string'){try{return decode(JSON.parse(value));}catch{try{return JSON.parse(value.split('\n')[0]);}catch{return value;}}}if(Array.isArray(value))return value.map(decode).find(v=>v&&typeof v==='object'&&!v.type)??value.map(decode).join('\n');return value?.type==='text'?decode(value.text):value;};
let host,browser,page,proof,appPid,owner;const logs=[];
const server=createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),messages=body.messages??[];
  const at=messages.findLastIndex(m=>m.role==='user'&&JSON.stringify(m.content).includes('DESKTOP_NATIVE_CHECK'));
  const results=messages.slice(at+1).filter(m=>m.role==='tool').map(m=>decode(m.content));
  if(at>=0&&JSON.stringify(messages.slice(at+1)).includes('image_url'))evidence.imageDelivered=true;
  const desktopId=results[1]?.desktopId;appPid??=results[2]?.pid;
  const first=results[3],second=results[5],input=first?.elements?.find(e=>e.automationId==='InputText'),save=second?.elements?.find(e=>e.automationId==='SaveButton');
  const plan=[
    ['skill',{name:'remote-ops-desktop'}],
    ['remote_desktop_connect',{environment:'local'}],
    ['remote_desktop_launch',{desktopId,requestId:'native-open',path:fixture,args:[resultFile]}],
    ['remote_desktop_observe',{desktopId,pid:results[2]?.pid,image:true}],
    ['remote_desktop_act',{desktopId,requestId:'native-fill',snapshotId:first?.snapshotId,steps:[{action:'fill',ref:input?.ref,text:'原生 DSH 中文输入'},{action:'expect',ref:input?.ref,text:'原生 DSH 中文输入'}]}],
    ['remote_desktop_observe',{desktopId,image:true}],
    ['remote_desktop_act',{desktopId,requestId:'native-save',snapshotId:second?.snapshotId,steps:[{action:'click',ref:save?.ref}]}],
    ['remote_desktop_observe',{desktopId,image:true}],
    ['remote_desktop_log_export',{all:true}],
    ['remote_desktop_read',{desktopId}],
  ];
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'desktop-native',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'native-test',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  const failed=results.some(r=>typeof r==='string'&&/^Error:/.test(r)||r?.error||['failed','unknown'].includes(r?.status));
  if(at>=0&&body.tools?.length&&results.length<plan.length&&!failed){if(results.length===3)await new Promise(r=>setTimeout(r,600));const[name,args]=plan[results.length];evidence.tools.push(name);emit({role:'assistant',tool_calls:[{index:0,id:'desktop-'+results.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls');}
  else{if(at>=0&&body.tools?.length)proof=results;emit({role:'assistant',content:'DESKTOP_NATIVE_DONE'},'stop');}
  res.end('data: [DONE]\n\n');
 }catch(error){if(!res.headersSent)res.writeHead(500);res.end(String(error));}
});
const until=async(fn,ms=60000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150));}throw Error('Native desktop check did not settle');};
const step=async(name,work)=>{try{await work();evidence.steps.push({name,pass:true});console.log('PASS '+name);}catch(error){evidence.steps.push({name,pass:false,error:error.message});throw error;}};
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const portProbe=createServer();await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));
 await mkdir(profile,{recursive:true});
 await writeFile(join(profile,'cordis.patch.yml'),`- id: ui-settings-general\n  name: '@deepseek-ai/dsh-client-ui-settings-general'\n  config:\n    welcomeNoticeVersion: 2026-09-28.1\n- id: agent-default-model\n  config:\n    provider: remote-ops-acceptance\n    model: native-test\n- id: llm-pi-ai\n  config:\n    providers:\n      remote-ops-acceptance:\n        api: openai-completions\n        baseURL: ${origin}/v1\n        apiKeyEnv: REMOTE_OPS_ACCEPTANCE_KEY\n        models:\n          - id: native-test\n            name: Desktop native acceptance\n            contextWindow: 262144\n            maxTokens: 4096\n            input: [text, image]\n`);
 const env={...process.env,DSH_HOME:home,REMOTE_OPS_ACCEPTANCE_KEY:'isolated-test-fixture'};
 await new Promise((yes,no)=>{const child=spawn(process.execPath,[cli,'plugin','--profile','web','add',pkg],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});const log=createWriteStream(join(out,'install.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.once('error',no);child.once('close',code=>log.end(()=>code?no(Error('DSH install exited '+code)):yes()));});
 evidence.installedVersion=JSON.parse(await readFile(join(profile,'node_modules/@dsh/remote-ops/package.json'),'utf8')).version;
 logs.push(createWriteStream(join(out,'dsh.stdout.log')),createWriteStream(join(out,'dsh.stderr.log')));
 host=spawn(process.execPath,[cli,'--profile','web','--host','127.0.0.1','--port',String(port),'--no-open'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});host.stdout.pipe(logs[0],{end:false});host.stderr.pipe(logs[1],{end:false});
 const url=await until(async()=>{if(host.exitCode!==null)throw Error('DSH exited');return(await readFile(join(out,'dsh.stdout.log'),'utf8').catch(()=>'' )).match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?\\S+`))?.[0];});
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({locale:'zh-CN',viewport:{width:1500,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',e=>evidence.errors.push(e.message));
 page.on('request',request=>{const u=new URL(request.url());if(u.pathname==='/api/dsh-remote-ops/state'&&u.searchParams.get('sessionId'))owner=u.searchParams.get('sessionId');});
 await page.goto(url);const editor=page.getByRole('textbox',{name:/描述你想要|发消息或创建任务/});await editor.waitFor();await page.getByRole('button',{name:'Remote Ops',exact:true}).click();
 await step('native DSH loads bundled skill, invokes desktop tools and sends real image attachments to the model',async()=>{
  await editor.fill('DESKTOP_NATIVE_CHECK');await editor.press('Enter');await until(()=>proof,120000);
  evidence.results=proof;assert.equal(proof.length,10,JSON.stringify(proof).slice(-2500));assert.equal(proof[4].verified,true);assert.equal(evidence.imageDelivered,true);
  assert.equal(await readFile(resultFile,'utf8'),'原生 DSH 中文输入');assert.equal(proof[7].elements.find(e=>e.automationId==='SaveCount').name,'Saved 1');
 });
 const panel=page.locator('.dsh-remote-ops'),api=async(action,args={})=>page.evaluate(async({owner,action,args})=>{const response=await fetch('/api/dsh-remote-ops/desktop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:owner,action,args})});if(!response.ok)throw Error(await response.text());return response.json();},{owner,action,args});
 await step('native desktop workspace preserves the conversation and displays the actual application',async()=>{
  await editor.fill('保留中的对话草稿');await panel.getByRole('tab',{name:'桌面',exact:true}).click();await panel.getByAltText('目标 Windows 软件窗口').waitFor();
  assert.equal(await editor.innerText(),'保留中的对话草稿');await page.screenshot({path:join(out,'desktop-workspace.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});assert.ok(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth+1));await page.screenshot({path:join(out,'desktop-narrow.png'),animations:'disabled'});await page.setViewportSize({width:1500,height:1000});
 });
 await step('human input from the plugin preview reaches the same Windows application',async()=>{
  const img=panel.getByAltText('目标 Windows 软件窗口');
  const clickControl=async name=>{const snap=await api('observe'),control=snap.elements.find(e=>e.automationId===name);assert.ok(control,name);const box=await img.boundingBox(),scale=Math.min(box.width/snap.screenshot.width,box.height/snap.screenshot.height),width=snap.screenshot.width*scale,height=snap.screenshot.height*scale;
    await img.click({position:{x:(box.width-width)/2+(control.bounds.x+control.bounds.width/2-snap.bounds.x)/snap.bounds.width*width,y:(box.height-height)/2+(control.bounds.y+control.bounds.height/2-snap.bounds.y)/snap.bounds.height*height}});
    await until(async()=>!(await api('read')).status.includes('busy'));
  };
  await clickControl('InputText');await img.press('Control+A');await new Promise(r=>setTimeout(r,300));
  await panel.getByRole('textbox',{name:'桌面输入内容'}).fill('人工输入与 Agent 共用窗口');await panel.getByRole('button',{name:'发送',exact:true}).click();
  await until(async()=>{const s=await api('observe');return s.elements.find(e=>e.automationId==='InputText')?.value==='人工输入与 Agent 共用窗口';});
  await clickControl('SaveButton');await until(async()=>(await readFile(resultFile,'utf8'))==='人工输入与 Agent 共用窗口');
  await page.screenshot({path:join(out,'desktop-human-input.png'),animations:'disabled'});
 });
 await step('desktop ZIP is authenticated, binary and available after disconnect without closing software',async()=>{
  const response=await page.request.get(new URL(proof[8].url,url).href);assert.equal(response.status(),200);const bytes=await response.body();assert.equal(bytes.readUInt32LE(0),0x04034b50);await writeFile(join(out,'desktop-logs.zip'),bytes);
  await api('disconnect',{desktopId:proof[1].desktopId});assert.equal((await api('export',{all:true})).bytes>0,true);execFileSync('tasklist.exe',['/FI','PID eq '+appPid],{windowsHide:true});
  assert.match(execFileSync('tasklist.exe',['/FO','CSV','/NH','/FI','PID eq '+appPid],{encoding:'utf8',windowsHide:true}),new RegExp(String(appPid)));
 });
 assert.deepEqual(evidence.errors,[]);
}catch(error){process.exitCode=1;evidence.error=error.stack;console.error(error.message);if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});}
finally{
 await browser?.close();if(host?.pid){try{execFileSync('taskkill.exe',['/PID',String(host.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}for(const log of logs)log.end();
 if(appPid){try{execFileSync('taskkill.exe',['/PID',String(appPid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}
 server.closeAllConnections();await new Promise(r=>server.close(r));evidence.status=process.exitCode?'failed':'passed';await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));
}

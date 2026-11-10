// Installed release, unmodified DSH and real Chrome. Device/model are isolated fixtures.
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve,join,dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs';
import { startTelnetDevice } from '../harness/telnet-device.mjs';
import { startFakeDevice } from '../harness/fake-device.mjs';

const cli=process.env.DSH_CLI,pkg=resolve(process.argv[2]??'');
if(!cli||!process.argv[2])throw Error('Set DSH_CLI and pass a tgz');
const out=resolve(process.env.TELNET_OUTPUT??`output/playwright/telnet-native-${Date.now()}`);
await mkdir(out,{recursive:true});
const home=join(out,'home'),profile=join(home,'profiles/web');
const env={...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',REMOTE_OPS_ACCEPTANCE_KEY:'isolated-test-fixture'};
const evidence={kind:'installed-package-native-dsh-local-telnet-and-model-fixtures',hostVersion:JSON.parse(await readFile(join(dirname(cli),'../package.json'),'utf8')).version,packageSha256:createHash('sha256').update(await readFile(pkg)).digest('hex'),steps:[],errors:[]};
const until=async(fn,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150));}throw Error('Telnet native acceptance did not settle');};
const run=(exe,args,options={})=>new Promise((yes,no)=>{const child=spawn(exe,args,{env,windowsHide:true,...options});let text='';child.stdout.on('data',x=>text+=x);child.stderr.on('data',x=>text+=x);child.once('error',no);child.once('close',code=>code?no(Error(text.slice(-4000))):yes(text));});
const telnet=await startTelnetDevice(),ssh=await startFakeDevice({name:'SSH regression'});
let host,browser,page,owner,telnetId,feed,agentProof;
const logs=[],decode=value=>{if(typeof value==='string'){try{return decode(JSON.parse(value));}catch{return value;}}if(Array.isArray(value))return value.map(decode).find(x=>x&&typeof x==='object')??value.map(decode).join('\n');return value?.type==='text'?decode(value.text):value;};
const model=createServer(async(req,res)=>{
  try{
    if(req.url==='/feed/latest.json'){res.end(JSON.stringify({schemaVersion:1,package:'@dsh/remote-ops',version:feed.version,asset:`dsh-remote-ops-v${feed.version}.tgz`,checksum:`SHA256SUMS-dsh-remote-ops-v${feed.version}.txt`}));return;}
    if(req.url?.endsWith('.tgz')){res.end(feed.bytes);return;}
    if(req.url?.endsWith('.txt')){res.end(`${createHash('sha256').update(feed.bytes).digest('hex')}  dsh-remote-ops-v${feed.version}.tgz\n`);return;}
    let raw='';for await(const part of req)raw+=part;
    const body=JSON.parse(raw),messages=body.messages??[],at=messages.findLastIndex(m=>m.role==='user'&&JSON.stringify(m.content).includes('TELNET_AGENT_CHECK'));
    const results=messages.slice(at+1).filter(m=>m.role==='tool').map(m=>decode(m.content));
    const plan=[['remote_environment_list',{}],['remote_terminal_read',{session:telnetId}],['remote_terminal_send',{session:telnetId,text:'show version',quietMs:200}],['remote_terminal_log_export',{all:true,format:'zip'}]];
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'telnet-native',object:'chat.completion.chunk',created:1,model:'native-test',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    if(at>=0&&body.tools?.length&&results.length<plan.length&&!results.some(x=>typeof x==='string'&&x.startsWith('Error:'))){const [name,args]=plan[results.length];emit({role:'assistant',tool_calls:[{index:0,id:'telnet-'+results.length+'-'+Date.now(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls');}
    else{if(at>=0&&body.tools?.length)agentProof=results;emit({role:'assistant',content:at>=0?'TELNET_AGENT_DONE':'Telnet 测试会话就绪'},'stop');}
    res.end('data: [DONE]\n\n');
  }catch(error){if(!res.headersSent)res.writeHead(500);res.end(String(error));}
});
const step=async(name,fn)=>{await fn();evidence.steps.push({name,passed:true});console.log('PASS '+name);await page.screenshot({path:join(out,`step-${evidence.steps.length}.png`),animations:'disabled'});};
try{
  await new Promise(r=>model.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${model.address().port}`;
  await mkdir(profile,{recursive:true});
  await writeFile(join(profile,'cordis.patch.yml'),`- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: 2026-09-28.1\n- id: agent-default-model\n  config:\n    provider: remote-ops-acceptance\n    model: native-test\n- id: llm-pi-ai\n  config:\n    providers:\n      remote-ops-acceptance:\n        api: openai-completions\n        baseURL: ${origin}/v1\n        apiKeyEnv: REMOTE_OPS_ACCEPTANCE_KEY\n        models:\n          - id: native-test\n            name: Telnet acceptance\n            contextWindow: 262144\n            maxTokens: 4096\n            input: [text]\n`);
  await writeFile(join(out,'install.log'),await run(process.execPath,[cli,'plugin','--profile','web','add',pkg]));
  evidence.installedVersion=JSON.parse(await readFile(join(profile,'node_modules/@dsh/remote-ops/package.json'),'utf8')).version;
  const fixtureDir=join(out,'synthetic-next-version');await mkdir(fixtureDir,{recursive:true});await run('tar',['-xzf',pkg,'-C',fixtureDir]);
  const parts=evidence.installedVersion.split('.').map(Number);parts[2]++;const next=parts.join('.');
  for(const file of ['package.json','lib/version.js','lib/client.js']){const path=join(fixtureDir,'package',file);await writeFile(path,(await readFile(path,'utf8')).replaceAll(evidence.installedVersion,next));}
  await run(process.execPath,[join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),'pack','--silent','--pack-destination',fixtureDir],{cwd:join(fixtureDir,'package')});
  feed={version:next,bytes:await readFile(join(fixtureDir,`dsh-remote-ops-${next}.tgz`))};
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  host=spawn(process.execPath,[cli,'--profile','web','--host','127.0.0.1','--port',String(port),'--no-open'],{env,windowsHide:true});evidence.hostPid=host.pid;
  logs.push(createWriteStream(join(out,'stdout.log')),createWriteStream(join(out,'stderr.log')));host.stdout.pipe(logs[0]);host.stderr.pipe(logs[1]);
  const url=await until(async()=>{if(host.exitCode!==null)throw Error('DSH exited');return(await readFile(join(out,'stdout.log'),'utf8').catch(()=> '')).match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?\\S+`))?.[0];});
  browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({locale:'zh-CN',viewport:{width:1500,height:1000}});page.setDefaultTimeout(20000);
  page.on('pageerror',error=>evidence.errors.push(error.message));page.on('request',request=>{const u=new URL(request.url());if(u.pathname.endsWith('/state')&&u.searchParams.get('sessionId'))owner=u.searchParams.get('sessionId');});
  await page.goto(url);const editor=page.getByRole('textbox',{name:/描述你想要|发消息或创建任务/});await editor.waitFor();await editor.fill('初始化隔离 Telnet 验收');await editor.press('Enter');
  await page.getByRole('button',{name:'Remote Ops',exact:true}).click();await page.getByLabel('终端输出',{exact:true}).waitFor();await until(()=>owner);
  const api=(path,body)=>page.evaluate(async({path,body})=>{const res=await fetch('/api/dsh-remote-ops/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const value=await res.json();if(!res.ok)throw Error(JSON.stringify(value));return value;},{path,body:body?{sessionId:owner,...body}:undefined});
  const state=()=>api('state?sessionId='+owner),action=body=>api('action',body),panel=page.locator('.dsh-remote-ops');
  await step('保存 Telnet 环境，登录设置与默认端口可见',async()=>{
    await panel.getByRole('button',{name:'环境管理',exact:true}).click();await page.getByRole('tab',{name:/^(终端环境|SSH \/ Telnet)$/}).click();await panel.getByRole('button',{name:'+ 环境',exact:true}).click();
    const form=panel.locator('form.dsh-remote-ops__form');await form.getByLabel('连接协议',{exact:true}).selectOption('telnet');assert.equal(await form.getByLabel('端口',{exact:true}).inputValue(),'23');
    await form.getByLabel('显示名称',{exact:true}).fill('Telnet native');await form.getByLabel('主机地址',{exact:true}).fill(telnet.host);await form.getByLabel('端口',{exact:true}).fill(String(telnet.port));await form.getByLabel('Telnet 登录方式',{exact:true}).selectOption('username-password');await form.getByLabel('用户名',{exact:true}).fill(telnet.username);await form.locator('input[type=password]').fill(telnet.password);await form.getByRole('button',{name:'保存',exact:true}).click();
    await until(async()=>(await state()).environments.some(x=>x.name==='Telnet native'&&x.transport==='telnet'));assert.equal(await form.count(),0);
  });
  await step('真实 Telnet 协商与登录，用户直接输入并看到回显',async()=>{
    await panel.locator('[data-environment-row]').filter({hasText:'Telnet native'}).getByRole('button',{name:'连接',exact:true}).click();
    const connected=await until(async()=>{const s=(await state()).sessions.find(x=>x.kind==='telnet');return s?.login?.state==='ready'&&s;});telnetId=connected.sessionId;
    const input=page.getByLabel('终端输入',{exact:true});await input.focus();await page.keyboard.type('show human');await page.keyboard.press('Enter');
    await until(()=>telnet.commands.includes('show human'));await until(async()=>(await page.getByLabel('终端输出',{exact:true}).innerText()).includes('TELNET_HUMAN_VERIFIED'));
    assert.equal(telnet.stats.passwordAttempts,1);assert.equal(telnet.stats.logins,1);assert.ok(!JSON.stringify(await state()).includes(telnet.password));
  });
  await step('原生 Agent 工具在同一 Telnet 连接执行与打包日志',async()=>{
    await editor.fill('TELNET_AGENT_CHECK');await editor.press('Enter');await until(()=>agentProof);
    assert.equal(agentProof.length,4,JSON.stringify(agentProof));assert.equal(agentProof[1].login.state,'ready');assert.match(JSON.stringify(agentProof[2]),/TELNET_AGENT_VERIFIED/);assert.equal(agentProof[3].manifest.logs.some(x=>x.kind==='telnet'),true);
    assert.equal(telnet.stats.connections,1);assert.ok(!JSON.stringify(agentProof).includes(telnet.password));evidence.agentToolResults=agentProof;
    const archive=await page.request.get(new URL(agentProof[3].downloadPath,page.url()).href);assert.equal(archive.ok(),true);const bytes=await archive.body();assert.equal(createHash('sha256').update(bytes).digest('hex'),agentProof[3].sha256);await writeFile(join(out,'terminal-logs.zip'),bytes);
  });
  await step('SSH 回归与文件能力边界，刷新页面保留连接',async()=>{
    await action({action:'environment.save',environment:{id:'native-ssh',name:'Native SSH',host:ssh.host,port:ssh.port,username:ssh.username},password:ssh.password});const opened=await action({action:'open',environment:'native-ssh'});const sent=await action({action:'send',session:opened.sessionId,text:'echo SSH_STILL_WORKS',quietMs:200});assert.match(JSON.stringify(sent),/SSH_STILL_WORKS/);
    const original=(await state()).sessions.find(x=>x.sessionId===telnetId);await page.reload();await page.getByRole('button',{name:'Remote Ops',exact:true}).waitFor();if(!await panel.isVisible())await page.getByRole('button',{name:'Remote Ops',exact:true}).click();
    const restored=await until(async()=>(await state()).sessions.find(x=>x.sessionId===telnetId));assert.equal(restored.outputCursor.streamId,original.outputCursor.streamId);assert.equal(telnet.stats.connections,1);
    await panel.getByRole('tab',{name:'文件',exact:true}).click();await page.getByLabel('位置 A',{exact:true}).waitFor();assert.ok(!(await page.getByLabel('位置 A',{exact:true}).innerText()).includes('Telnet native'));await panel.getByRole('tab',{name:'终端',exact:true}).click();
  });
  await step('热加载保留 Telnet 连接、草稿与日志，后续命令不重放',async()=>{
    const before=await state(),session=before.sessions.find(x=>x.sessionId===telnetId);await editor.fill('Telnet 热加载保留的草稿');
    await api('update',{action:'settings',settings:{source:'custom',url:origin+'/feed/'}});const accepted=await api('update',{action:'install'});assert.equal(accepted.accepted,true);
    const after=await until(async()=>{try{const s=await state();return s.bound&&s.pluginVersion===feed.version&&s;}catch{return false;}},120000);
    assert.equal(host.exitCode,null);assert.notEqual(after.runtimeId,before.runtimeId);assert.equal(after.sessions.find(x=>x.sessionId===telnetId).outputCursor.streamId,session.outputCursor.streamId);assert.equal(telnet.stats.connections,1);assert.equal(telnet.stats.passwordAttempts,1);assert.equal(await editor.innerText(),'Telnet 热加载保留的草稿');
    await action({action:'send',session:telnetId,text:'show after',quietMs:200});assert.equal(telnet.commands.filter(x=>x==='show after').length,1);assert.equal(telnet.commands.filter(x=>x==='show version').length,1);evidence.hotReload={from:evidence.installedVersion,to:feed.version,synthetic:true,connectionCount:telnet.stats.connections,sessionId:telnetId,streamId:session.outputCursor.streamId};
  });
  await step('窄栏可配置 Telnet，全部关闭保留本地 CMD',async()=>{
    await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await panel.getByRole('button',{name:'环境管理',exact:true}).click();await panel.getByRole('tab',{name:/^(终端环境|SSH \/ Telnet)$/}).click();await panel.locator('[data-environment-row]').filter({hasText:'Telnet native'}).getByRole('button',{name:'更多环境操作 Telnet native',exact:true}).click();await panel.getByRole('group',{name:'环境管理操作',exact:true}).getByRole('button',{name:'编辑',exact:true}).click();await panel.getByLabel('连接协议',{exact:true}).waitFor();assert.ok(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth+1));await panel.locator('form.dsh-remote-ops__form').getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'关闭环境抽屉',exact:true}).click();
    await page.screenshot({path:join(out,'narrow.png'),animations:'disabled'});
    await page.setViewportSize({width:1500,height:1000});await panel.getByRole('button',{name:'全部关闭远程标签',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();await until(async()=>(await state()).sessions.every(x=>x.kind==='local'));assert.equal((await api('logs',{action:'list'})).logs.some(x=>x.kind==='telnet'&&x.archived),true);
  });
  assert.deepEqual(evidence.errors,[]);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=error.stack;process.exitCode=1;console.error(error);evidence.failedView=await page?.locator('body').innerText({timeout:3000}).catch(()=> 'unavailable');await page?.screenshot({path:join(out,'failure.png')}).catch(()=>{});}
finally{evidence.device={stats:telnet.stats,commands:telnet.commands};await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));await browser?.close();if(host?.exitCode===null)await run('taskkill.exe',['/PID',String(host.pid),'/T','/F']).catch(()=>{});host?.stdout.destroy();host?.stderr.destroy();host?.unref();logs.forEach(x=>x.end());model.closeAllConnections();await new Promise(r=>model.close(r));await telnet.close();await ssh.close();console.log('Evidence: '+join(out,'evidence.json'));}

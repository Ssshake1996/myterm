// Official DSH tool dispatch and credentials service; loopback-only device/model fixtures.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs';
import { startFakeDevice } from '../harness/fake-device.mjs';
import { startTelnetDevice } from '../harness/telnet-device.mjs';

const cli=process.env.DSH_CLI, pkg=resolve(process.argv[2]??'');
if(!cli||!process.argv[2])throw Error('Set DSH_CLI and pass a tgz');
const out=resolve(process.env.PASSWORD_OUTPUT??`output/playwright/environment-password-${Date.now()}`);
await mkdir(out,{recursive:true});
const home=join(out,'home'),profile=join(home,'profiles/web');
const env={...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',REMOTE_OPS_ACCEPTANCE_KEY:'isolated-test-fixture'};
const evidence={kind:'installed-package-native-dsh-credential-tools',hostVersion:JSON.parse(await readFile(join(dirname(cli),'../package.json'),'utf8')).version,packageSha256:createHash('sha256').update(await readFile(pkg)).digest('hex'),steps:[],errors:[]};
const initial='  Native 中文 P@ss !  ',replacement='  Updated 中文 P@ss !  ',apiToken='isolated-native-token';
const ssh=await startFakeDevice({password:initial}),sshNext=await startFakeDevice({password:replacement});
const telnet=await startTelnetDevice(),telnetNext=await startTelnetDevice({password:replacement});
const secrets=[initial,replacement,telnet.password,apiToken];
const until=async(fn,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150));}throw Error('Native credential acceptance did not settle');};
const run=(exe,args,options={})=>new Promise((yes,no)=>{const child=spawn(exe,args,{env,windowsHide:true,...options});let text='';child.stdout.on('data',x=>text+=x);child.stderr.on('data',x=>text+=x);child.once('error',no);child.once('close',code=>code?no(Error(text.slice(-4000))):yes(text));});
const decode=value=>{if(typeof value==='string'){try{return decode(JSON.parse(value));}catch{return value;}}if(Array.isArray(value))return value.map(decode).find(x=>x&&typeof x==='object')??value.map(decode).join('\n');return value?.type==='text'?decode(value.text):value;};
let plan=[],proof,phase='BOOT',expectedApiPassword=initial,apiLogins=0,apiRequests=0,owner,host,browser,page,editor,hostPort,bootCount=0;
const logs=[];
const service=createServer(async(req,res)=>{
  try{
    let raw='';for await(const chunk of req)raw+=chunk;
    if(req.url.startsWith('/api/')){
      res.setHeader('Content-Type','application/json');
      if(req.url.endsWith('/login')){
        const body=JSON.parse(raw);assert.equal(body.username,'operator');assert.equal(body.password,expectedApiPassword);apiLogins++;
        if(req.url.includes('/cookie/')){res.setHeader('Set-Cookie',`sid=${apiToken}; Path=/api/; HttpOnly`);res.end('{"ok":true}');}
        else res.end(JSON.stringify({token:apiToken}));
      }else{assert.ok(req.headers.authorization==='Bearer '+apiToken||req.headers.cookie?.includes('sid='+apiToken));apiRequests++;res.end('{"ok":true,"result":"CREDENTIAL_API_VERIFIED"}');}
      return;
    }
    const body=JSON.parse(raw),messages=body.messages??[],at=messages.findLastIndex(m=>m.role==='user'),results=messages.slice(at+1).filter(m=>m.role==='tool').map(m=>decode(m.content));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'credentials-native',object:'chat.completion.chunk',created:1,model:'native-test',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    if(body.tools?.length&&results.length<plan.length&&!results.some(x=>typeof x==='string'&&x.startsWith('Error:'))){const [name,args]=plan[results.length];emit({role:'assistant',tool_calls:[{index:0,id:'credentials-'+Date.now(),type:'function',function:{name,arguments:JSON.stringify(typeof args==='function'?args(results):args)}}]});emit({},'tool_calls');}
    else{if(body.tools?.length)proof=results;emit({role:'assistant',content:'DONE_'+phase},'stop');}
    res.end('data: [DONE]\n\n');
  }catch{if(!res.headersSent)res.writeHead(500);res.end('Isolated fixture check failed');}
});
const api=(path,body)=>page.evaluate(async({path,body})=>{const res=await fetch('/api/dsh-remote-ops/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await res.json();if(!res.ok)throw Error(JSON.stringify(data));return data;},{path,body:body?{sessionId:owner,...body}:undefined});
const state=()=>api('state?sessionId='+owner);
const agent=async(name,tools)=>{phase=name;plan=tools;proof=undefined;await editor.fill(`PWD_${name}: use only the supplied isolated test credentials. SSH: ${ssh.username} / ${initial}; Telnet: ${telnet.username} / ${telnet.password}; API: operator / ${expectedApiPassword}; replacement password: ${replacement}. Save and verify the requested environments.`);await editor.press('Enter');await until(()=>proof);assert.equal(proof.length,tools.length,JSON.stringify(proof));await page.getByText('DONE_'+name,{exact:true}).last().waitFor();const text=JSON.stringify(proof);for(const secret of secrets)assert.ok(!text.includes(secret),'Tool results must omit credential values');return proof;};
const stop=async()=>{if(host?.exitCode===null)await run('taskkill.exe',['/PID',String(host.pid),'/T','/F']);host?.stdout.destroy();host?.stderr.destroy();host?.unref();};
const boot=async()=>{
  bootCount++;const stdout=join(out,`host-${bootCount}.log`),stderr=join(out,`host-${bootCount}-error.log`);
  host=spawn(process.execPath,[cli,'--profile','web','--host','127.0.0.1','--port',String(hostPort),'--no-open'],{env,windowsHide:true});
  const streams=[createWriteStream(stdout),createWriteStream(stderr)];logs.push(...streams);host.stdout.pipe(streams[0]);host.stderr.pipe(streams[1]);
  const url=await until(async()=>{if(host.exitCode!==null)throw Error('DSH exited');return(await readFile(stdout,'utf8').catch(()=> '')).match(new RegExp(`http://127\\.0\\.0\\.1:${hostPort}/\\?\\S+`))?.[0];});
  owner=undefined;await page.goto(url);editor=page.getByRole('textbox',{name:/描述你想要|发消息或创建任务/});await editor.waitFor();await agent('BOOT_'+bootCount,[]);
  const panel=page.locator('.dsh-remote-ops');if(!await panel.isVisible())await page.getByRole('button',{name:'Remote Ops',exact:true}).click();await until(()=>owner);
  // A process restart closes remote connections; explicitly select the new local terminal.
  await page.getByRole('tablist',{name:'终端会话',exact:true}).getByRole('tab',{name:'本地 CMD',exact:true}).click();
  await page.getByLabel('终端输出',{exact:true}).waitFor();
};
const step=async(name,fn)=>{await fn();evidence.steps.push({name,passed:true});console.log('PASS '+name);await page.screenshot({path:join(out,`step-${evidence.steps.length}.png`),animations:'disabled'});};
try{
  await new Promise(r=>service.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${service.address().port}`;
  await mkdir(profile,{recursive:true});
  await writeFile(join(profile,'cordis.patch.yml'),`- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: 2026-09-28.1\n- id: agent-default-model\n  config:\n    provider: remote-ops-acceptance\n    model: native-test\n- id: llm-pi-ai\n  config:\n    providers:\n      remote-ops-acceptance:\n        api: openai-completions\n        baseURL: ${origin}/v1\n        apiKeyEnv: REMOTE_OPS_ACCEPTANCE_KEY\n        models:\n          - id: native-test\n            name: Credential acceptance\n            contextWindow: 262144\n            maxTokens: 4096\n            input: [text]\n`);
  await writeFile(join(out,'install.log'),await run(process.execPath,[cli,'plugin','--profile','web','add',pkg]));
  evidence.installedVersion=JSON.parse(await readFile(join(profile,'node_modules/@dsh/remote-ops/package.json'),'utf8')).version;
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));hostPort=probe.address().port;await new Promise(r=>probe.close(r));
  browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({locale:'zh-CN',viewport:{width:1500,height:1000}});page.setDefaultTimeout(20000);
  page.on('pageerror',e=>evidence.errors.push(e.message));page.on('request',r=>{const u=new URL(r.url());if(u.pathname.endsWith('/state')&&u.searchParams.get('sessionId'))owner=u.searchParams.get('sessionId');});await boot();
  let ids,sessionIds,originalRefs;
  const configs=async()=>({ssh:JSON.parse(await readFile(join(home,'remote-ops/environments/default/environments.default.json'),'utf8')),api:JSON.parse(await readFile(join(home,'remote-ops/api/environments.json'),'utf8'))});
  const verify=async(label)=>{
    const opened=await agent(label+'_OPEN', [['remote_terminal_open',{environment:ids.ssh}],['remote_terminal_open',{environment:ids.telnet}]]);
    sessionIds={ssh:opened[0].sessionId,telnet:opened[1].sessionId};await until(async()=>(await state()).sessions.find(s=>s.sessionId===sessionIds.telnet)?.login?.state==='ready');
    const results=await agent(label+'_EXEC',[
      ['remote_terminal_send',{session:sessionIds.ssh,text:'show version',quietMs:200}],['remote_terminal_send',{session:sessionIds.telnet,text:'show version',quietMs:200}],
      ['remote_api_login',{environment:ids.token,requestId:label+'-token-login'}],['remote_api_request',{environment:ids.token,requestId:label+'-token-read',path:'items'}],
      ['remote_api_login',{environment:ids.cookie,requestId:label+'-cookie-login'}],['remote_api_request',{environment:ids.cookie,requestId:label+'-cookie-read',path:'items'}]
    ]);
    assert.match(JSON.stringify(results[0]),/Array OS/);assert.match(JSON.stringify(results[1]),/TELNET_AGENT_VERIFIED/);for(const item of results.slice(2))assert.equal(item.state,'completed');
    await page.getByRole('tablist',{name:'终端会话',exact:true}).getByRole('tab',{name:'Chat Telnet',exact:true}).click();
    await until(async()=>(await page.getByLabel('终端输出',{exact:true}).innerText()).includes('TELNET_AGENT_VERIFIED'));
    evidence[label]={sessions:sessionIds,toolResults:results};
  };
  await step('Agent 直接创建 SSH、Telnet、Token 和 Cookie 四种环境',async()=>{
    const results=await agent('CREATE',[
      ['remote_environment_create',{name:'Chat SSH',host:ssh.host,port:ssh.port,username:ssh.username,password:initial}],
      ['remote_environment_create',{name:'Chat Telnet',host:telnet.host,port:telnet.port,username:telnet.username,password:telnet.password,transport:'telnet',telnet:{loginMode:'username-password'}}],
      ...['token','cookie'].map(mode=>['remote_api_environment_save',{name:'Chat '+mode,baseUrl:origin+'/api/'+mode,password:initial,auth:{mode,username:'operator',cookieName:mode==='cookie'?'sid':''}}])
    ]);ids=Object.fromEntries(['ssh','telnet','token','cookie'].map((key,i)=>[key,results[i].environment.id]));
    const stored=await configs();originalRefs=[...stored.ssh.map(x=>x.passwordRef),...stored.api.map(x=>x.auth.passwordRef)];for(const secret of secrets)assert.ok(!JSON.stringify(stored).includes(secret));assert.equal(new Set(originalRefs).size,4);
  });
  await step('保存的密码实际用于 SSH/Telnet 登录与 API Token/Cookie 请求',()=>verify('INITIAL'));
  await step('Agent 修改密码与目标端口，已有连接保留，省略密码不重写',async()=>{
    const before=(await state()).sessions.filter(s=>s.kind!=='local');expectedApiPassword=replacement;
    await agent('UPDATE',[
      ['remote_environment_update',{environment:ids.ssh,password:replacement,port:sshNext.port}],['remote_environment_update',{environment:ids.telnet,password:replacement,port:telnetNext.port}],
      ['remote_api_environment_save',{id:ids.token,password:replacement}],['remote_api_environment_save',{id:ids.cookie,password:replacement}]
    ]);
    const updated=await configs(),refs=[...updated.ssh.map(x=>x.passwordRef),...updated.api.map(x=>x.auth.passwordRef)];assert.ok(refs.every(ref=>!originalRefs.includes(ref)));
    await agent('RENAME',[['remote_environment_update',{environment:ids.ssh,name:'Chat SSH renamed',password:null}],['remote_api_environment_save',{id:ids.token,name:'Chat token renamed',password:null}]]);
    const unchanged=await configs();assert.deepEqual([...unchanged.ssh.map(x=>x.passwordRef),...unchanged.api.map(x=>x.auth.passwordRef)].sort(),[...refs].sort());
    const after=(await state()).sessions;for(const old of before)assert.equal(after.find(x=>x.sessionId===old.sessionId).outputCursor.streamId,old.outputCursor.streamId);
    assert.equal(ssh.log.connections,1);assert.equal(telnet.stats.connections,1);for(const secret of secrets)assert.ok(!JSON.stringify(unchanged).includes(secret));
  });
  await step('GUI 可查看 Agent 保存的新密码，页面刷新保持环境',async()=>{
    const panel=page.locator('.dsh-remote-ops');await panel.getByRole('button',{name:'环境管理',exact:true}).click();await panel.getByRole('tab',{name:'终端环境',exact:true}).click();await panel.locator('[data-environment-row]').filter({hasText:'Chat SSH renamed'}).getByRole('button',{name:'编辑',exact:true}).click();
    await panel.getByRole('button',{name:'显示 SSH 密码',exact:true}).click();await until(async()=>(await panel.locator('form input[type=text]').evaluateAll(nodes=>nodes.map(node=>node.value))).includes(replacement));
    await panel.getByRole('button',{name:'隐藏 SSH 密码',exact:true}).click();await panel.locator('form').getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'返回工作区',exact:true}).click();await page.reload();await until(async()=>(await state()).environments.length===2);
    await page.getByRole('tablist',{name:'终端会话',exact:true}).getByRole('tab',{name:'Chat Telnet',exact:true}).click();
    await until(async()=>(await page.getByLabel('终端输出',{exact:true}).innerText()).includes('TELNET_AGENT_VERIFIED'));
  });
  await step('重启隔离 DSH 后配置和凭据保留，新连接使用新密码',async()=>{await stop();plan=[];await boot();await verify('RESTART');assert.equal(sshNext.log.connections,1);assert.equal(telnetNext.stats.logins,1);assert.equal(apiLogins,4);assert.equal(apiRequests,4);});
  assert.deepEqual(evidence.errors,[]);evidence.status='passed';evidence.api={logins:apiLogins,requests:apiRequests};
}catch(error){evidence.status='failed';evidence.error=error.stack;process.exitCode=1;console.error(error);await page?.screenshot({path:join(out,'failure.png')}).catch(()=>{});}
finally{await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));await browser?.close();await stop().catch(()=>{});logs.forEach(x=>x.end());service.closeAllConnections();await new Promise(r=>service.close(r));await Promise.all([ssh.close(),sshNext.close(),telnet.close(),telnetNext.close()]);console.log('Evidence: '+join(out,'evidence.json'));}

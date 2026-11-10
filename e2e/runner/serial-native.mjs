// Installs a tgz into an isolated DSH home. POSIX I/O uses an owned kernel PTY;
// Windows enumerates real COM ports and exercises a deliberately absent port.
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from '../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs';

const cli=process.env.DSH_CLI, archive=resolve(process.argv[2] || '');
if (!cli || !process.argv[2]) throw Error('Set DSH_CLI and pass a plugin tgz');
const windows=process.platform==='win32', run=promisify(execFile);
const out=resolve(process.env.SERIAL_OUTPUT || 'output/serial-native');
await mkdir(out,{recursive:true});
const home=await mkdtemp(join(out,'home-')), profile=join(home,'profiles/web');
const env={...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',SERIAL_TEST_KEY:'loopback-fixture'};
const evidence={platform:process.platform,device:windows?'enumeration and absent COM':'kernel PTY',steps:[],errors:[],
  hostVersion:JSON.parse(await readFile(join(dirname(cli),'../package.json'),'utf8')).version,
  sha256:createHash('sha256').update(await readFile(archive)).digest('hex')};
const until=async(fn,message,ms=45000)=>{
  const end=Date.now()+ms;
  do { const value=await fn(); if(value)return value; await delay(120); } while(Date.now()<end);
  throw Error(message);
};
function decode(value) {
  if(typeof value==='string'){try{return decode(JSON.parse(value));}catch{return value;}}
  if(Array.isArray(value))return value.map(decode).find(x=>x && typeof x==='object') ?? value.map(decode).join('\n');
  return value?.type==='text'?decode(value.text):value;
}
let phase='boot',plan=[],proof,fixture,host,browser,page;
const lines=[];
const skillNames=['remote-ops-environments','remote-ops-terminal-logs'];
const advertisedSkills=new Set(), availableTools=new Set();
const model=createServer(async(req,res)=>{
  let raw=''; for await(const chunk of req) raw+=chunk;
  const body=JSON.parse(raw), messages=body.messages??[], at=messages.findLastIndex(m=>m.role==='user');
  for(const tool of body.tools??[]) availableTools.add(tool.function?.name);
  for(const message of messages){
    const content=typeof message.content==='string'?message.content:(message.content??[]).map(part=>part.text??'').join('\n');
    for(const [,catalog] of content.matchAll(/<available_skills>([\s\S]*?)<\/available_skills>/g)){
      for(const name of skillNames) if(catalog.includes('`'+name+'`')) advertisedSkills.add(name);
    }
  }
  const results=messages.slice(at+1).filter(m=>m.role==='tool').map(m=>decode(m.content));
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=(delta,reason=null)=>res.write('data: '+JSON.stringify({id:'serial-acceptance',object:'chat.completion.chunk',created:1,model:'serial-test',choices:[{index:0,delta,finish_reason:reason}]})+'\n\n');
  if(body.tools?.length && results.length<plan.length && !results.some(x=>typeof x==='string'&&x.startsWith('Error:'))){
    const [name,args]=plan[results.length];
    emit({role:'assistant',tool_calls:[{index:0,id:'serial-'+Date.now(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls');
  }else{if(body.tools?.length)proof=results; emit({role:'assistant',content:'DONE_'+phase},'stop');}
  res.end('data: [DONE]\n\n');
});
const listen=async server=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port;};
const step=async(name,fn)=>{await fn(); evidence.steps.push(name); console.log('PASS '+name); await page.screenshot({path:join(out,'step-'+evidence.steps.length+'.png')});};
try {
  const modelPort=await listen(model);
  let path;
  if(!windows){
    fixture=spawn('python3',['-u','e2e/harness/serial-pty.py'],{stdio:['ignore','pipe','inherit']});
    createInterface({input:fixture.stdout}).on('line',line=>lines.push(line));
    path=await until(()=>lines[0],'PTY was not created');
    assert.match(path,/^\/dev\/(?:pts\/\d+|ttys\w+)$/);
  }
  await mkdir(profile,{recursive:true});
  const documents = join(home,'fixture-documents'); await mkdir(documents,{recursive:true});
  await writeFile(join(profile,'cordis.patch.yml'),[
    '- id: workspace-controller','  config:','    documentsDirectory: '+JSON.stringify(documents),
    '- id: ui-settings-general','  config:','    welcomeNoticeVersion: 2026-09-28.1',
    '- id: agent-default-model','  config:','    provider: serial-fixture','    model: serial-test',
    '- id: llm-pi-ai','  config:','    providers:','      serial-fixture:','        api: openai-completions',
    '        baseURL: http://127.0.0.1:'+modelPort+'/v1','        apiKeyEnv: SERIAL_TEST_KEY','        models:',
    '          - id: serial-test','            name: Serial acceptance','            contextWindow: 262144','            maxTokens: 4096','            input: [text]','',
  ].join('\n'));
  await run(process.execPath,[cli,'plugin','--profile','web','add',archive],{env,windowsHide:true,timeout:240000,maxBuffer:8000000});
  evidence.installedVersion=JSON.parse(await readFile(join(profile,'node_modules/@dsh/remote-ops/package.json'),'utf8')).version;
  const probe=createServer(),port=await listen(probe);await new Promise(r=>probe.close(r));
  host=spawn(process.execPath,[cli,'--profile','web','--host','127.0.0.1','--port',String(port),'--no-open'],{env,windowsHide:true,detached:!windows});
  host.stdout.pipe(createWriteStream(join(out,'host.log')));host.stderr.pipe(createWriteStream(join(out,'host-errors.log')));
  const url=await until(async()=>{if(host.exitCode!==null)throw Error('DSH exited');return (await readFile(join(out,'host.log'),'utf8').catch(()=> '')).match(new RegExp('http://127\\.0\\.0\\.1:'+port+'/\\?\\S+'))?.[0];},'DSH did not start',90000);
  browser=await chromium.launch({channel:'chrome',headless:true});
  page=await browser.newPage({locale:'zh-CN',viewport:{width:1500,height:1000}});
  page.on('pageerror',e=>evidence.errors.push(e.message));page.setDefaultTimeout(25000);await page.goto(url);
  const editor=page.getByRole('textbox',{name:/描述你想要|发消息或创建任务|describe what|message or create/i});
  const agent=async(name,tools)=>{
    phase=name;plan=tools;proof=undefined;await editor.fill('SERIAL_FIXTURE_'+name);await editor.press('Enter');
    await until(()=>proof,'No native tool results for '+name);
    assert.equal(proof.length,tools.length,JSON.stringify(proof));
    await page.getByText('DONE_'+name,{exact:true}).last().waitFor();
    for(const [index,item] of proof.entries()){
      if(tools[index][0]==='skill') assert.match(String(item),/<skill_content name=/);
      else assert.equal(typeof item,'object',JSON.stringify(item));
    }
    return proof;
  };
  await agent('BOOT',[]);
  const panel=page.locator('.dsh-remote-ops');
  if(!await panel.isVisible())await page.getByRole('button',{name:'Remote Ops',exact:true}).click();
  const row=()=>panel.locator('[data-environment-row]').filter({hasText:'Serial lab'});
  let id,sessionId;
  await step('Native skill catalog, loading both guides and executing the serial create example',async()=>{
    assert.deepEqual([...advertisedSkills].sort(),[...skillNames].sort());
    const [environmentGuide,logGuide]=await agent('SKILLS',skillNames.map(name=>['skill',{name}]));
    assert.ok(environmentGuide.includes('<skill_content name="remote-ops-environments">'));
    assert.ok(logGuide.includes('<skill_content name="remote-ops-terminal-logs">'));
    const calls=['remote_serial_ports','remote_environment_create','remote_terminal_open','remote_terminal_log_read','remote_terminal_log_export'];
    for(const name of calls){assert.ok(availableTools.has(name),name);assert.ok((environmentGuide+logGuide).includes(name),name);}
    assert.ok(logGuide.includes('serialPath'));
    const examples=[...environmentGuide.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map(match=>JSON.parse(match[1]));
    const sample=examples.find(example=>example.tool==='remote_environment_create'&&example.arguments.transport==='serial');
    assert.ok(sample,'The loaded skill must provide a runnable serial example');
    const args=structuredClone(sample.arguments);args.name='Skill example console';
    args.serial.path=windows?'COM249':path;
    const [created]=await agent('EXAMPLE',[[sample.tool,args]]);
    assert.equal(created.environment.serial.path,args.serial.path);
    assert.equal(created.environment.serial.baudRate,sample.arguments.serial.baudRate);
    evidence.skills={advertised:[...advertisedSkills],loaded:skillNames,verifiedTools:calls,executedExample:sample.tool};
  });
  await step('Three protocol choices, native enumeration and a saved serial environment',async()=>{
    const [result]=await agent('PORTS',[['remote_serial_ports',{}]]);
    assert.ok(Array.isArray(result.ports));evidence.enumerated=result.ports.map(x=>x.path);
    if(windows){path='COM249';assert.ok(!evidence.enumerated.includes(path),'Choose a different absent test port');}
    await panel.getByRole('button',{name:'环境管理',exact:true}).click();
    await panel.getByRole('tab',{name:'终端环境',exact:true}).click();
    await panel.getByRole('button',{name:'+ 环境',exact:true}).click();
    const protocol=panel.getByLabel('连接协议',{exact:true});
    assert.deepEqual(await protocol.locator('option').allTextContents(),['SSH','TELNET','SERIAL']);
    await protocol.selectOption('serial');
    assert.equal(await panel.getByLabel('主机地址',{exact:true}).count(),0);
    assert.equal(await panel.getByLabel('SSH 密码',{exact:true}).count(),0);
    await panel.getByLabel('串口号 / 设备路径',{exact:true}).fill(path);
    await panel.getByLabel('波特率',{exact:true}).fill('115200');
    await panel.getByLabel('显示名称',{exact:true}).fill('Serial lab');
    await panel.getByRole('button',{name:'保存',exact:true}).click(); await row().waitFor();
    const [catalog]=await agent('SAVED',[['remote_environment_list',{}]]);
    const saved=catalog.environments.find(x=>x.name==='Serial lab');id=saved.id;
    assert.equal(saved.serial.path,path);assert.equal(saved.serial.baudRate,115200);assert.equal(saved.host,undefined);
  });
  await step('Agent edits the saved device; diagnostics identify the exact endpoint',async()=>{
    const [update,check]=await agent('EDIT',[['remote_environment_update',{environment:id,serial:{baudRate:19200}}],['remote_environment_test',{environment:id}]]);
    assert.equal(update.environment.serial.path,path);assert.equal(check.endpoint,path);assert.equal(check.ok,!windows,JSON.stringify(check));
    if(windows)assert.match(check.stages[0].code,/^SERIAL_/);
  });
  if(!windows){
    await step('User and Agent send once through one native serial handle and download its transcript',async()=>{
      await row().getByRole('button',{name:'连接',exact:true}).click();
      const tab=panel.getByRole('tab',{name:'Serial lab',exact:true});await tab.click();
      const [catalog]=await agent('LIVE',[['remote_environment_list',{}]]);
      const active=catalog.sessions.find(x=>x.kind==='serial');sessionId=active.sessionId;assert.equal(active.endpoint.path,path);
      await page.getByLabel('终端输入',{exact:true}).focus();await page.keyboard.type('human');await page.keyboard.press('Enter');
      await until(async()=>(await panel.getByLabel('终端输出',{exact:true}).innerText()).includes('SERIAL_REPLY human'),'Missing human reply');
      const [sent,busy,logs]=await agent('IO',[['remote_terminal_send',{session:sessionId,text:'agent',quietMs:200}],['remote_environment_test',{environment:id}],['remote_terminal_logs',{}]]);
      assert.match(JSON.stringify(sent),/SERIAL_REPLY agent/);assert.equal(busy.stages[0].code,'SERIAL_PORT_BUSY');
      const log=logs.logs.find(x=>x.sessionId===sessionId);assert.equal(log.serialPath,path);
      const [exported]=await agent('LOG',[['remote_terminal_log_export',{logIds:[log.logId],format:'txt'}]]);
      const download=await page.request.get(new URL(exported.downloadPath,page.url()).href);assert.ok(download.ok());
      const bytes=await download.body();assert.equal(createHash('sha256').update(bytes).digest('hex'),exported.sha256);
      assert.match(bytes.toString(),/SERIAL_REPLY human/);assert.match(bytes.toString(),/SERIAL_REPLY agent/);
      for(const command of ['human','agent'])assert.equal(lines.filter(x=>x===command).length,1);
    });
    await step('Closing the terminal tab releases the device for a new session',async()=>{
      await panel.getByRole('button',{name:'释放Serial lab',exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();
      await panel.getByRole('tab',{name:'Serial lab',exact:true}).waitFor({state:'detached'});
      const [opened]=await agent('REOPEN',[['remote_terminal_open',{environment:id}]]);
      assert.notEqual(opened.sessionId,sessionId);
      const [sent]=await agent('VERIFY',[['remote_terminal_send',{session:opened.sessionId,text:'again',quietMs:200}]]);
      assert.match(JSON.stringify(sent),/SERIAL_REPLY again/);
      assert.equal(lines.filter(x=>x==='again').length,1);
    });
  }
  assert.deepEqual(evidence.errors,[]); evidence.status='passed';
}catch(error){
  evidence.status='failed';evidence.error=String(error.stack); console.error(error);
  if (page) evidence.visibleText=(await page.locator('body').innerText().catch(()=> '')).slice(-3500);
  await page?.screenshot({path:join(out,'failure.png')}).catch(()=>{});process.exitCode=1;
}finally{
  await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));
  await browser?.close();fixture?.kill();
  if(host && host.exitCode===null){
    if(windows)await run('taskkill.exe',['/PID',String(host.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
    else {try{process.kill(-host.pid,'SIGTERM');}catch{}}
  }
  model.closeAllConnections();model.close();
}

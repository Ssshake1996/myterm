// Actual installed DSH, native Windows shells and an explicitly selected test WSL distribution.
// The loopback model fixture dispatches deterministic tool calls through the unmodified Agent.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs';

const cli=process.env.DSH_CLI,pkg=resolve(process.argv[2]??''),distro=process.env.LOCAL_WSL_DISTRIBUTION;
if(!cli||!process.argv[2]||process.platform!=='win32')throw Error('Set DSH_CLI and run on Windows with a package argument');
const out=resolve(process.env.LOCAL_SHELL_OUTPUT??'output/playwright/local-shells-'+Date.now());
await mkdir(out,{recursive:true});
const home=join(out,'home'),profile=join(home,'profiles/web'),work=join(out,'中文 work');
await mkdir(work,{recursive:true});await mkdir(profile,{recursive:true});
const env={...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',REMOTE_OPS_ACCEPTANCE_KEY:'isolated-test-fixture'};
const evidence={kind:'native-installed-dsh-local-shells',hostVersion:JSON.parse(await readFile(join(dirname(cli),'../package.json'),'utf8')).version,packageSha256:createHash('sha256').update(await readFile(pkg)).digest('hex'),steps:[],errors:[],wsl:distro||'not tested'};
const until=async(fn,label='condition',ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150));}throw Error('Timed out: '+label);};
const run=(exe,args)=>new Promise((yes,no)=>{const child=spawn(exe,args,{env,windowsHide:true});let text='';child.stdout.on('data',x=>text+=x);child.stderr.on('data',x=>text+=x);child.once('error',no);child.once('close',code=>code?no(Error(text.slice(-4000))):yes(text));});
const decode=x=>{if(typeof x==='string'){try{return decode(JSON.parse(x));}catch{return x;}}if(Array.isArray(x))return x.map(decode).find(v=>v&&typeof v==='object')??x.map(decode).join('\n');return x?.type==='text'?decode(x.text):x;};
let phase='BOOT',plan=[],proof,owner,host,browser,page,editor,hostPort,bootCount=0;
const streams=[];
const model=createServer(async(req,res)=>{
  try {
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw),messages=body.messages??[],at=messages.findLastIndex(m=>m.role==='user'),results=messages.slice(at+1).filter(m=>m.role==='tool').map(m=>decode(m.content));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'locals-native',object:'chat.completion.chunk',created:1,model:'native-test',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    if(body.tools?.length&&results.length<plan.length&&!results.some(x=>typeof x==='string'&&x.startsWith('Error:'))){
      const [name,args]=plan[results.length];emit({role:'assistant',tool_calls:[{index:0,id:'locals-'+Date.now(),type:'function',function:{name,arguments:JSON.stringify(typeof args==='function'?args(results):args)}}]});emit({},'tool_calls');
    }else{if(body.tools?.length)proof=results;emit({role:'assistant',content:'DONE_'+phase},'stop');}
    res.end('data: [DONE]\n\n');
  }catch(error){evidence.errors.push(error.message);if(!res.headersSent)res.writeHead(500);res.end('Fixture error');}
});
const api=(path,body)=>page.evaluate(async({path,body})=>{
  const res=await fetch('/api/dsh-remote-ops/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const data=await res.json();if(!res.ok)throw Error(JSON.stringify(data));return data;
},{path,body:body?{sessionId:owner,...body}:undefined});
const state=()=>api('state?sessionId='+owner),action=body=>api('action',body);
const agent=async(name,steps)=>{
  phase=name;plan=steps;proof=undefined;await editor.fill('LOCAL_SHELL_ACCEPTANCE_'+name);await editor.press('Enter');
  await until(()=>proof,name);assert.equal(proof.length,steps.length,JSON.stringify(proof));
  await page.getByText('DONE_'+name,{exact:true}).last().waitFor();
  for(let i=0;i<steps.length;i++)if(steps[i][0]!=='skill')assert.equal(typeof proof[i],'object',JSON.stringify(proof));
  return proof;
};
const stop=async()=>{if(host?.exitCode===null){await run('taskkill.exe',['/PID',String(host.pid),'/T','/F']).catch(()=>{});await until(()=>host.exitCode!==null,'test host stopped',10000);}host?.stdout.destroy();host?.stderr.destroy();host?.unref();};
const boot=async()=>{
  const log=join(out,'host-'+(++bootCount)+'.log');
  host=spawn(process.execPath,[cli,'--profile','web','--host','127.0.0.1','--port',String(hostPort),'--no-open'],{env,windowsHide:true});
  const output=createWriteStream(log),errors=createWriteStream(join(out,'host-'+bootCount+'-error.log'));streams.push(output,errors);host.stdout.pipe(output);host.stderr.pipe(errors);
  const url=await until(async()=>{if(host.exitCode!==null)throw Error('DSH exited');return(await readFile(log,'utf8').catch(()=> '')).match(new RegExp('http://127\\.0\\.0\\.1:'+hostPort+'/\\?\\S+'))?.[0];},'DSH start');
  owner=undefined;await page.goto(url);editor=page.getByRole('textbox',{name:/描述你想要|发消息或创建任务/});await editor.waitFor();await agent('BOOT_'+bootCount,[]);
  const panel=page.locator('.dsh-remote-ops');if(!await panel.isVisible())await page.getByRole('button',{name:'Remote Ops',exact:true}).click();
  await until(()=>owner,'owner');await page.getByLabel('终端输出',{exact:true}).waitFor();
};
const tabs=()=>page.getByRole('tablist',{name:'终端会话',exact:true});
const select=async session=>{await tabs().getByRole('tab',{name:session.name,exact:true}).click();};
const terminalText=()=>page.getByLabel('终端输出',{exact:true}).innerText();
const step=async(name,fn)=>{await fn();evidence.steps.push({name,passed:true});console.log('PASS '+name);await page.screenshot({path:join(out,'step-'+evidence.steps.length+'.png'),animations:'disabled'});};
try {
  await new Promise(r=>model.listen(0,'127.0.0.1',r));
  await writeFile(join(profile,'cordis.patch.yml'),'- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: 2026-09-28.1\n- id: agent-default-model\n  config:\n    provider: remote-ops-acceptance\n    model: native-test\n- id: llm-pi-ai\n  config:\n    providers:\n      remote-ops-acceptance:\n        api: openai-completions\n        baseURL: http://127.0.0.1:'+model.address().port+'/v1\n        apiKeyEnv: REMOTE_OPS_ACCEPTANCE_KEY\n        models:\n          - id: native-test\n            name: Local shell acceptance\n            contextWindow: 262144\n            maxTokens: 4096\n            input: [text]\n');
  await writeFile(join(out,'install.log'),await run(process.execPath,[cli,'plugin','--profile','web','add',pkg]));
  evidence.installedVersion=JSON.parse(await readFile(join(profile,'node_modules/@dsh/remote-ops/package.json'),'utf8')).version;
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));hostPort=probe.address().port;await new Promise(r=>probe.close(r));
  browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({locale:'zh-CN',viewport:{width:1500,height:1000}});page.setDefaultTimeout(25000);
  page.on('pageerror',error=>evidence.errors.push(error.message));page.on('request',req=>{const u=new URL(req.url());if(u.pathname.endsWith('/state')&&u.searchParams.get('sessionId'))owner=u.searchParams.get('sessionId');});
  await boot();
  let sessions={},catalog;
  await step('Startup opens one CMD; native Agent loads bundled skill and discovers shells without spawning',async()=>{
    assert.equal((await state()).sessions.filter(x=>x.kind==='local').length,1);
    const result=await agent('DISCOVER',[['skill',{name:'remote-ops-environments'}],['remote_local_shells',{}],['remote_local_open',{}]]);
    assert.match(String(result[0]),/remote_local_open/);catalog=result[1];assert.equal(result[2].sessionId,'local-cmd');assert.equal(result[2].reused,true);
    for(const shell of ['cmd','powershell','pwsh'])assert.ok(catalog.shells.some(x=>x.shell===shell&&x.available),shell+' missing');
    if(distro)assert.ok(catalog.shells.some(x=>x.distribution===distro&&x.available));
    assert.equal((await state()).sessions.length,1);sessions.cmd=result[2];evidence.catalog=catalog;
  });
  await step('GUI dropdown opens PowerShell 5.1/7 and WSL one at a time; Agent reuses exact matching sessions',async()=>{
    for(const [shell,label] of [['powershell','Windows PowerShell 5.1'],['pwsh','PowerShell 7'],...(distro?[['wsl','WSL · '+distro]]:[])]){
      const count=(await state()).sessions.length;
      await page.getByLabel('选择本地终端类型',{exact:true}).click();
      await page.locator('.dsh-remote-ops__localMenu').getByRole('button',{name:label,exact:true}).click();
      await until(async()=>(await state()).sessions.length===count+1,'one new tab '+shell);
      const session=(await state()).sessions.find(x=>x.shell===shell);sessions[shell]=session;
      await until(async()=>await tabs().getByRole('tab',{name:session.name,exact:true}).getAttribute('aria-selected')==='true','new tab selection');
      const [result]=await agent('REUSE_'+shell,[['remote_local_open',{shell,...(shell==='wsl'?{distribution:distro}:{})}]]);
      assert.equal(result.sessionId,session.sessionId);assert.equal(result.reused,true);assert.equal((await state()).sessions.length,count+1);
    }
  });
  await step('Native commands use shell syntax, preserve spaces and Chinese text, and return independent exit codes',async()=>{
    const commands={cmd:'echo CMD_NATIVE_中文 & echo CMD_FILE>"'+join(work,'cmd result.txt')+'"',powershell:"$localValue='PS51_PRIVATE'; Write-Output ('PS51_NATIVE_'+[char]0x4E2D+[char]0x6587); Set-Content -LiteralPath '"+join(work,'ps51 result.txt').replaceAll("'","''")+"' -Value 'PS51_FILE'",pwsh:"$localValue='PS7_PRIVATE'; Write-Output 'PS7_NATIVE_中文'; Set-Content -LiteralPath '"+join(work,'ps7 result.txt').replaceAll("'","''")+"' -Value 'PS7_FILE'",wsl:"localValue=WSL_PRIVATE; printf 'WSL_NATIVE_中文\\n'; printf 'WSL_FILE\\n' > /tmp/dsh-remote-ops-0160.txt"};
    for(const [shell,session] of Object.entries(sessions)){
      const [sent]=await agent('SEND_'+shell,[['remote_terminal_send',{session:session.sessionId,text:commands[shell],quietMs:1000,timeoutSeconds:20,stripAnsi:true}]]);
      evidence[shell]={sessionId:session.sessionId,sent};await select(session);
      await until(async()=>/NATIVE_中文/.test(await terminalText()),'native unicode '+shell);
      const [exec]=await agent('EXEC_'+shell,[['remote_command_execute',{session:session.sessionId,command:shell==='cmd'?'echo EXACT_EXIT & exit /b 7':shell==='wsl'?"printf 'EXACT_EXIT\\n'; exit 7":"Write-Output 'EXACT_EXIT'; exit 7"}]]);
      assert.equal(exec.exitCode,7);assert.match(exec.stdout,/EXACT_EXIT/);evidence[shell].exec=exec;
    }
    for(const file of ['cmd result.txt','ps51 result.txt','ps7 result.txt'])assert.match(await readFile(join(work,file),'utf8'),/_FILE/);
    const [a,b]=await agent('VARIABLES',[['remote_terminal_send',{session:sessions.powershell.sessionId,text:'Write-Output $localValue',quietMs:300}],['remote_terminal_send',{session:sessions.pwsh.sessionId,text:'Write-Output $localValue',quietMs:300}]]);
    assert.match(JSON.stringify(a),/PS51_PRIVATE/);assert.doesNotMatch(JSON.stringify(a),/PS7_PRIVATE/);assert.match(JSON.stringify(b),/PS7_PRIVATE/);
  });
  await step('Default + creates exactly one independent CMD; manual input goes to it only',async()=>{
    const before=(await state()).sessions;await page.getByLabel('新建默认本地终端',{exact:true}).click();
    const fresh=await until(async()=>{const list=(await state()).sessions;return list.length===before.length+1&&list.find(x=>!before.some(s=>s.sessionId===x.sessionId));},'plus');
    sessions.extra=fresh;await select(fresh);
    await until(async()=>!(await page.locator('.dsh-remote-ops__inputCapture').isDisabled()),'input ready');
    await page.locator('.dsh-remote-ops__inputCapture').focus();await page.keyboard.insertText('echo MANUAL_EXTRA_0160');await page.keyboard.press('Enter');
    await until(async()=>(await terminalText()).includes('MANUAL_EXTRA_0160'),'manual output');
    const [old]=await agent('ISOLATION',[['remote_terminal_read',{session:'local-cmd'}]]);assert.doesNotMatch(JSON.stringify(old),/MANUAL_EXTRA_0160/);
  });
  await step('Exited local terminal stays grey without respawn; explicit reopen resets stream; closing keeps archived logs',async()=>{
    const extra=sessions.extra,before=(await state()).sessions.length,stream=extra.outputCursor.streamId;
    await agent('EXIT',[['remote_terminal_send',{session:extra.sessionId,text:'exit',quietMs:200}]]);
    await until(async()=>(await state()).sessions.find(x=>x.sessionId===extra.sessionId)?.status.kind==='exited','exit');await select(extra);
    assert.equal((await state()).sessions.length,before);assert.match(await terminalText(),/MANUAL_EXTRA_0160/);
    await page.getByRole('button',{name:'重新打开终端',exact:true}).click();
    await until(async()=>(await state()).sessions.find(x=>x.sessionId===extra.sessionId)?.outputCursor.streamId!==stream,'new stream');
    await agent('CLOSE',[['remote_terminal_close',{session:extra.sessionId}]]);
    assert.equal((await state()).sessions.length,before-1);delete sessions.extra;
    await until(async()=>await tabs().getByRole('tab',{name:extra.name,exact:true}).count()===0,'closed local tab removed');
    assert.equal(await tabs().getByRole('tab',{name:'本地 CMD',exact:true}).getAttribute('aria-selected'),'true');
    const [logs,zip]=await agent('LOGS',[['skill',{name:'remote-ops-terminal-logs'}],['remote_terminal_log_export',{all:true,format:'zip'}]]);
    assert.match(String(logs),/PowerShell/);assert.ok(zip.manifest.logs.length>=before+1);evidence.export=zip;
    const download=await page.request.get(new URL(zip.downloadPath,page.url()).href);assert.ok(download.ok());const data=await download.body();assert.equal(createHash('sha256').update(data).digest('hex'),zip.sha256);await writeFile(join(out,'native-logs.zip'),data);
  });
  await step('Settings persist PowerShell and a spaced Unicode directory without replacing live terminals',async()=>{
    await page.getByLabel('设置',{exact:true}).click();await page.getByRole('tablist',{name:'设置分类'}).getByRole('tab',{name:'终端',exact:true}).click();
    await page.getByLabel('默认本地终端',{exact:true}).selectOption(JSON.stringify(['powershell','']));
    await page.getByLabel('本地终端启动目录',{exact:true}).fill(work);
    const ids=(await state()).sessions.map(x=>x.sessionId);
    await page.getByRole('button',{name:'保存本地终端设置',exact:true}).click();await page.getByText('已保存，后续新建和下次启动使用此默认终端',{exact:true}).waitFor();
    assert.deepEqual((await state()).sessions.map(x=>x.sessionId),ids);
    await page.getByLabel('返回工作区',{exact:true}).click();
    await stop();await boot();
    const local=(await state()).sessions.filter(x=>x.kind==='local');assert.equal(local.length,1);assert.equal(local[0].shell,'powershell');assert.equal(local[0].sessionId,'local-cmd');assert.equal(local[0].workingDirectory,work);
    const [result]=await agent('DEFAULT_PS',[['remote_terminal_send',{session:'local-cmd',text:"Write-Output (Get-Location).Path; Write-Output 'RESTART_ONE'",quietMs:800,stripAnsi:true}]]);
    assert.match(JSON.stringify(result),/RESTART_ONE/);await until(async()=>(await terminalText()).includes('RESTART_ONE'),'restart output');
  });
  await step('Narrow panel keeps shell menu and tab scrolling accessible',async()=>{
    await page.setViewportSize({width:900,height:768});
    // Resize only the plugin test pane; do not alter the host implementation.
    await page.locator('.dsh-remote-ops').evaluate(node=>{node.style.width='390px';node.style.maxWidth='390px';});
    await page.getByLabel('选择本地终端类型',{exact:true}).click();await page.locator('.dsh-remote-ops__localMenu').getByRole('button',{name:'PowerShell 7',exact:true}).waitFor();
    const bounds=await page.locator('.dsh-remote-ops__localMenu>div').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=900,bounds);
    assert.ok(await page.getByLabel('新建默认本地终端',{exact:true}).isVisible());
  });
  assert.deepEqual(evidence.errors,[]);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=error.stack;process.exitCode=1;console.error(error);evidence.failedView=await page?.locator('body').innerText({timeout:5000}).catch(()=> 'unavailable');await page?.screenshot({path:join(out,'failure.png'),animations:'disabled'}).catch(()=>{});}
finally{
  await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));
  await browser?.close();await stop();streams.forEach(x=>x.end());model.closeAllConnections();await new Promise(r=>model.close(r));
  console.log('Evidence: '+join(out,'evidence.json'));
}


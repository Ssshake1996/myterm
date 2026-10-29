import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, win32 } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { executeCommand } from './commands.js';
import { buildWindowsCommand } from './windows-shell.js';
import { openSftpChannel, sshChannel, closeSshClient } from './ssh-connection.js';

const runFile = promisify(execFile);
const runtime = fileURLToPath(new URL('../desktop/runtime/', import.meta.url));
export const desktopError = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });
const parse = text => { const value=JSON.parse(text.trim()); if(value.error)throw desktopError(value.code??'DESKTOP_RUNTIME_FAILED',value.error);return value; };

export async function desktopRuntime() {
  const bytes=await readFile(join(runtime,'manifest.json')).catch(()=>{throw desktopError('DESKTOP_RUNTIME_MISSING','Install a plugin package containing the built Windows desktop runtime');});
  const manifest=JSON.parse(bytes);
  for(const file of manifest.files) {
    if(!/^[\w.-]+$/.test(file.name))throw desktopError('DESKTOP_RUNTIME_INVALID','Invalid runtime filename');
    if(createHash('sha256').update(await readFile(join(runtime,file.name))).digest('hex')!==file.sha256)throw desktopError('DESKTOP_RUNTIME_INVALID',`Runtime checksum mismatch: ${file.name}`);
  }
  return {...manifest,id:createHash('sha256').update(bytes).digest('hex').slice(0,20)};
}

export class DesktopRpc {
  constructor(input,output,close) {
    this.input=input;this.output=output;this.shutdown=close;this.pending=new Map();this.buffer='';this.closed=false;
    output.setEncoding('utf8');
    output.on('data',chunk=>{
      this.buffer+=chunk;if(this.buffer.length>12*1024*1024){this.close(desktopError('DESKTOP_RESPONSE_LIMIT','Worker response exceeded limit'));return;}
      let index;while((index=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,index);this.buffer=this.buffer.slice(index+1);if(!line.trim())continue;
        let response;try{response=JSON.parse(line);}catch{this.close(desktopError('DESKTOP_PROTOCOL_INVALID','Invalid worker response'));return;}
        const pending=this.pending.get(response.id);if(!pending)continue;this.pending.delete(response.id);clearTimeout(pending.timer);
        response.ok?pending.resolve(response.result):pending.reject(desktopError(response.code??'DESKTOP_OPERATION_FAILED',response.error));
      }
    });
    output.on('error',()=>this.close());output.on('end',()=>this.close());input.on('error',()=>this.close());
  }
  call(method,args={}) {
    if(this.closed)return Promise.reject(desktopError('DESKTOP_DISCONNECTED','Reconnect and inspect the current desktop; no requests were replayed'));
    if(this.pending.size>=16)return Promise.reject(desktopError('DESKTOP_BUSY','Too many pending desktop requests'));
    const id=randomUUID();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.close(desktopError('DESKTOP_OUTCOME_UNKNOWN','Worker timed out. An effect may have happened; inspect before retrying')),15000);
      this.pending.set(id,{resolve,reject,timer});this.input.write(JSON.stringify({id,method,args})+'\n');
    });
  }
  close(error=desktopError('DESKTOP_DISCONNECTED','Desktop transport closed; unfinished effects may be unknown')) {
    if(this.closed)return;this.closed=true;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.shutdown();
  }
}

const chooseSession=(probe,requested)=>{
  const candidates=probe.sessions.filter(s=>s.state==='active');
  if(requested!=null){if(!Number.isInteger(requested)||!candidates.some(s=>s.sessionId===requested))throw desktopError('DESKTOP_SESSION_UNAVAILABLE','Choose an active session for the SSH account');return requested;}
  if(candidates.length!==1)throw desktopError('DESKTOP_SESSION_REQUIRED',`Select windowsSessionId; active sessions: ${JSON.stringify(candidates)}`);
  return candidates[0].sessionId;
};

export async function connectDesktop(state,args={}) {
  const manifest=await desktopRuntime();let client,channel,child;
  try {
    let probe,ensured,exe;
    if(args.environment==='local') {
      if(process.platform!=='win32')throw desktopError('DESKTOP_PLATFORM_UNSUPPORTED','The DSH host is not Windows; select a saved Windows SSH environment');
      exe=join(runtime,'RemoteOpsDesktop.exe');
      probe=parse((await runFile(exe,['probe'],{windowsHide:true,timeout:12000,maxBuffer:262144})).stdout);
      if(args.inspect)return probe;
      const session=chooseSession(probe,args.windowsSessionId);
      ensured=parse((await runFile(exe,['ensure',String(session)],{windowsHide:true,timeout:15000,maxBuffer:262144})).stdout);
      child=spawn(exe,['bridge',ensured.pipe],{windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr.resume();
    } else {
      await state.ready;const environment=state.findEnvironment(args.environment);
      if(!environment||environment.platform!=='windows')throw desktopError('DESKTOP_ENVIRONMENT_INVALID','Select an existing SSH environment with target system Windows');
      ({client}=await state.connectSshEnvironment(environment,args.signal));
      const run=async(command,parameters={})=>{
        const result=await executeCommand({client,...buildWindowsCommand({shell:'windows-powershell',command,parameters}),timeoutMs:25000,maxBytes:262144,signal:args.signal});
        if(result.exitCode!==0)throw desktopError('DESKTOP_SETUP_FAILED',`${result.status}, exit=${result.exitCode}: ${result.stderr||result.stdout}`);
        return parse(result.stdout);
      };
      const location=await run('param($version) $root=Join-Path $env:LOCALAPPDATA ("DSH/RemoteOps/desktop/"+$version); @{root=$root; exists=(Test-Path -LiteralPath (Join-Path $root "manifest.json"))}|ConvertTo-Json -Compress',{version:manifest.id});
      exe=win32.join(location.root,'RemoteOpsDesktop.exe');
      if(!location.exists) {
        await run('param($root) New-Item -ItemType Directory -Path $root -Force|Out-Null; @{ok=$true}|ConvertTo-Json -Compress',{root:location.root});
        const sftp=await openSftpChannel(client,{windows:true,signal:args.signal});
        try {
          for(const file of [...manifest.files,{name:'manifest.json'}]){
            const data=await readFile(join(runtime,file.name));await new Promise((resolve,reject)=>sftp.writeFile(win32.join(location.root,file.name).replaceAll('\\','/'),data,error=>error?reject(error):resolve()));
          }
        } finally{sftp.end();}
      }
      // Validate every installed byte before running the helper, including reused installs.
      await run('param($root) $m=Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw|ConvertFrom-Json; foreach($f in $m.files){if((Get-FileHash -LiteralPath (Join-Path $root $f.name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $f.sha256){throw "Desktop runtime checksum mismatch"}}; @{ok=$true}|ConvertTo-Json -Compress',{root:location.root});
      probe=await run('param($exe) & $exe probe',{exe});
      if(args.inspect){closeSshClient(client);return probe;}
      const session=chooseSession(probe,args.windowsSessionId);
      ensured=await run('param($exe,$session) & $exe ensure $session',{exe,session});
      const quote=value=>"'"+value.replaceAll("'","''")+"'";
      const script=`& ${quote(exe)} bridge ${quote(ensured.pipe)}`;
      const command='powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64');
      channel=await sshChannel(client,cb=>client.exec(command,cb),15000,args.signal);channel.stderr.resume();
    }
    const rpc=new DesktopRpc(channel??child.stdin,channel??child.stdout,()=>{if(channel){channel.close();closeSshClient(client);}else{child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.kill();}});
    child?.once('error',error=>rpc.close(desktopError('DESKTOP_BRIDGE_FAILED',error.message)));
    rpc.info=await rpc.call('status');
    if(rpc.info.sessionId!==ensured.sessionId||rpc.info.protocol!==manifest.protocol||!rpc.info.interactive){rpc.close();throw desktopError('DESKTOP_SESSION_MISMATCH','Worker did not join the selected interactive desktop');}
    return rpc;
  } catch(error){channel?.close();closeSshClient(client);child?.kill();throw error;}
}

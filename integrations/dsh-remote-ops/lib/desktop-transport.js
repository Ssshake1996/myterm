import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, win32 } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { openSftpChannel, sshChannel, closeSshClient } from './ssh-connection.js';
import { executeCommand } from './commands.js';
import { buildWindowsCommand } from './windows-shell.js';

const runFile = promisify(execFile);
const runtime = fileURLToPath(new URL('../desktop/runtime/', import.meta.url));
export const desktopError = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });
const parse = text => { const value=JSON.parse(text.trim()); if(value.error)throw desktopError(value.code??'DESKTOP_RUNTIME_FAILED',value.error);return value; };
const runHelper=async(exe,args,signal)=>{try{return parse((await runFile(exe,args,{windowsHide:true,timeout:40000,maxBuffer:262144,signal})).stdout);}catch(error){if(error.stdout?.trim())return parse(error.stdout);if(error.code?.startsWith?.('DESKTOP_'))throw error;throw desktopError('DESKTOP_SETUP_FAILED',`Worker ${args[0]} failed (exit ${error.code??'unknown'}, signal ${error.signal??'none'}): ${error.stderr?.trim()||error.message}`);}};
// SSH exec is a bounded setup command. Bidirectional desktop traffic uses SSH
// direct-tcpip to the worker's authenticated loopback-only endpoint.
const bootstrap=String.raw`
param($root,$expected,$session,$inspect)
$u=[Text.UTF8Encoding]::new($false)
try {
  foreach($f in (ConvertFrom-Json $expected)){
    if($f.name -notmatch '^[\w.-]+$'){throw 'Invalid runtime filename'}
    $path=Join-Path $root $f.name
    if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $f.sha256){throw 'Desktop runtime checksum mismatch'}
  }
  $exe=Join-Path $root 'RemoteOpsDesktop.exe'
  function RunDesktop($arguments){
    $info=[Diagnostics.ProcessStartInfo]::new($exe,$arguments);$info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $info.StandardOutputEncoding=$u;$info.StandardErrorEncoding=$u
    $process=[Diagnostics.Process]::Start($info);$process.StandardInput.Close()
    $output=$process.StandardOutput.ReadToEndAsync();$errors=$process.StandardError.ReadToEndAsync()
    if(-not $process.WaitForExit(15000)){$process.Kill();throw 'Desktop setup process timed out'}
    $result=$output.Result
    if(-not $result){throw ('Desktop setup exited '+$process.ExitCode+': '+$errors.Result)}
    $process.Dispose();return $result
  }
  if($inspect){RunDesktop 'probe';return}
  $probe=RunDesktop 'probe' | ConvertFrom-Json
  if($probe.error){throw $probe.error}
  if($session -le 0){$active=@($probe.sessions|Where-Object state -eq 'active');if($active.Count -ne 1){throw 'DESKTOP_SESSION_REQUIRED: select an active same-account windowsSessionId'};$session=[int]$active[0].sessionId}
  $ready=RunDesktop ('ensure '+$session+' task') | ConvertFrom-Json
  if($ready.error){throw ($ready.code+': '+$ready.error)}
  $ready|ConvertTo-Json -Compress
}catch{@{error=$_.Exception.Message;code='DESKTOP_SETUP_FAILED'}|ConvertTo-Json -Compress}
`;

export async function desktopRuntime() {
  const bytes=await readFile(join(runtime,'manifest.json')).catch(()=>{throw desktopError('DESKTOP_RUNTIME_MISSING','Install a plugin package containing the built Windows desktop runtime');});
  const manifest=JSON.parse(bytes);
  const names=['RemoteOpsDesktop.exe','RemoteOpsDesktopWorker.exe','RemoteOpsDesktop.exe.config','RemoteOpsDesktopWorker.exe.config','FlaUI.Core.dll','FlaUI.UIA3.dll','Interop.UIAutomationClient.dll','flaui.core-LICENSE.txt','flaui.uia3-LICENSE.txt','interop.uiautomationclient-LICENSE.txt'];
  if(manifest.protocol!==1||!Array.isArray(manifest.files)||manifest.files.length!==names.length||names.some(name=>manifest.files.filter(file=>file.name===name).length!==1))throw desktopError('DESKTOP_RUNTIME_INVALID','Runtime manifest must contain exactly the pinned binaries, configuration and licenses');
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
        if(!response.id&&response.error){this.close(desktopError(response.code??'DESKTOP_SETUP_FAILED',response.error));return;}
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
  const manifest=await desktopRuntime();let client,channel,sftp;
  try {
    let probe,ensured,exe;
    if(args.environment==='local') {
      if(process.platform!=='win32')throw desktopError('DESKTOP_PLATFORM_UNSUPPORTED','The DSH host is not Windows; select a saved Windows SSH environment');
      // Windows locks loaded native images. Run an immutable private copy, never
      // the package files that DSH replaces during installation/hot reload.
      const cached=join(state?.base??tmpdir(),'desktop-runtime',manifest.id);
      await mkdir(cached,{recursive:true});
      for(const file of manifest.files){const target=join(cached,file.name);const previous=await readFile(target).catch(()=>null);if(!previous)await copyFile(join(runtime,file.name),target);else if(createHash('sha256').update(previous).digest('hex')!==file.sha256)throw desktopError('DESKTOP_RUNTIME_INVALID','Cached worker integrity check failed');}
      exe=join(cached,'RemoteOpsDesktop.exe');
      probe=await runHelper(exe,['probe'],args.signal);
      if(args.inspect)return probe;
      const session=chooseSession(probe,args.windowsSessionId);
      ensured=await runHelper(exe,['ensure',String(session),'task'],args.signal);
      channel=await new Promise((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port:ensured.port});const timer=setTimeout(()=>{socket.destroy();reject(desktopError('DESKTOP_CONNECT_TIMEOUT','Local worker did not accept a connection'));},5000);socket.once('connect',()=>{clearTimeout(timer);resolve(socket);});socket.once('error',error=>{clearTimeout(timer);reject(error);});});
    } else {
      await state.ready;const environment=state.findEnvironment(args.environment);
      if(!environment||environment.platform!=='windows')throw desktopError('DESKTOP_ENVIRONMENT_INVALID','Select an existing SSH environment with target system Windows');
      if(args.windowsSessionId!=null&&(!Number.isInteger(args.windowsSessionId)||args.windowsSessionId<1))throw desktopError('DESKTOP_SESSION_INVALID','windowsSessionId must be a positive integer');
      ({client}=await state.connectSshEnvironment(environment,args.signal));
      sftp=await openSftpChannel(client,{windows:true,signal:args.signal});
      const home=await new Promise((resolve,reject)=>sftp.realpath('.',(error,path)=>error?reject(error):resolve(path)));
      let root=home;for(const part of ['.dsh-remote-ops','desktop',manifest.id]){root=root.replace(/\/$/,'')+'/'+part;const exists=await new Promise((resolve,reject)=>sftp.stat(root,(error,stat)=>error?(error.code===2?resolve(false):reject(error)):resolve(stat.isDirectory())));if(!exists)await new Promise((resolve,reject)=>sftp.mkdir(root,error=>error?reject(error):resolve()));}
      for(const file of manifest.files){const target=root+'/'+file.name;const exists=await new Promise((resolve,reject)=>sftp.stat(target,(error,stat)=>error?(error.code===2?resolve(false):reject(error)):resolve(!!stat)));
        if(!exists)await new Promise((resolve,reject)=>readFile(join(runtime,file.name)).then(bytes=>sftp.writeFile(target,bytes,error=>error?reject(error):resolve()),reject));
      }
      const nativeRoot=root.replace(/^\/([A-Za-z]:)/,'$1').replaceAll('/','\\');
      if(!win32.isAbsolute(nativeRoot))throw desktopError('DESKTOP_SETUP_FAILED','The SFTP runtime path is not an absolute Windows path');
      const setup=await executeCommand({client,...buildWindowsCommand({shell:'windows-powershell',command:bootstrap,parameters:{root:nativeRoot,expected:JSON.stringify(manifest.files),session:args.windowsSessionId??0,inspect:!!args.inspect}}),timeoutMs:30000,maxBytes:262144,signal:args.signal});
      if(setup.exitCode!==0)throw desktopError('DESKTOP_SETUP_FAILED',`${setup.status}, exit=${setup.exitCode}: ${setup.stderr}`);
      ensured=parse(setup.stdout);
      if(args.inspect){sftp.end();closeSshClient(client);return ensured;}
      if(!Number.isInteger(ensured.port)||ensured.port<1||ensured.port>65535||!/^[a-f0-9]{64}$/.test(ensured.token))throw desktopError('DESKTOP_PROTOCOL_INVALID','Invalid worker endpoint');
      channel=await sshChannel(client,cb=>client.forwardOut('127.0.0.1',0,'127.0.0.1',ensured.port,cb),15000,args.signal,'Opening desktop SSH forwarding (AllowTcpForwarding must permit local forwarding)');
    }
    const rpc=new DesktopRpc(channel,channel,()=>{sftp?.end();channel.close?.();channel.destroy?.();closeSshClient(client);});
    await rpc.call('authenticate',{token:ensured.token});
    rpc.info=await rpc.call('status');
    if((ensured.sessionId!=null&&rpc.info.sessionId!==ensured.sessionId)||rpc.info.sessionId<1||rpc.info.protocol!==manifest.protocol||!rpc.info.interactive){rpc.close();throw desktopError('DESKTOP_SESSION_MISMATCH','Worker did not join the selected interactive desktop');}
    return rpc;
  } catch(error){sftp?.end();channel?.close?.();channel?.destroy?.();closeSshClient(client);throw error;}
}

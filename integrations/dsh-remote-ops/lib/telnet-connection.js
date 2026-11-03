import { Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import iconv from 'iconv-lite';
import { SshTerminalSession } from './terminal-sessions.js';
import { normalizeTerminalEncoding, sessionError, validateEnvironment } from './common.js';
import { TELNET_DEFAULTS } from './telnet-config.js';
import { stripAnsi } from './cli-assist.js';

const IAC=255, WILL=251, WONT=252, DO=253, DONT=254, SB=250, SE=240;
const escaped = bytes => Buffer.from([...bytes].flatMap(byte => byte === IAC ? [IAC,IAC] : [byte]));

// Byte-oriented framing precedes character decoding. Partial commands and subnegotiations
// survive TCP packet boundaries; option acknowledgements are sent only on transitions.
class TelnetChannel extends EventEmitter {
  constructor(socket, size, config) {
    super(); this.socket=socket; this.size=size; this.config=config; this.mode='data'; this.sub=[];
    this.local=new Map(); this.remote=new Map(); this.echo=false; this.previousCR=false;
    socket.on('data', bytes => this.receive(bytes)); socket.on('close', () => this.emit('close'));
  }
  control(...bytes) { if (!this.socket.destroyed) this.socket.write(Buffer.from(bytes)); }
  receive(bytes) {
    const data=[];
    for (const byte of bytes) {
      if (this.mode==='data') { if (byte===IAC) this.mode='iac'; else { if (!(this.previousCR && byte===0 && !this.remote.get(0))) data.push(byte); this.previousCR=byte===13; } }
      else if (this.mode==='iac') {
        if (byte===IAC) { data.push(byte); this.previousCR=false; this.mode='data'; }
        else if ([WILL,WONT,DO,DONT].includes(byte)) { this.command=byte; this.mode='option'; }
        else if (byte===SB) { this.sub=[]; this.mode='sub'; }
        else this.mode='data';
      } else if (this.mode==='option') { this.negotiate(this.command,byte); this.mode='data'; }
      else if (this.mode==='sub') { if (byte===IAC) this.mode='sub-iac'; else if(this.sub.length<4096) this.sub.push(byte); else { this.socket.destroy(sessionError('TELNET_PROTOCOL_INVALID','Telnet subnegotiation exceeded 4096 bytes')); return; } }
      else if (this.mode==='sub-iac') {
        if (byte===SE) { if(this.sub[0]===24 && this.sub[1]===1 && this.local.get(24)) this.control(IAC,SB,24,0,...Buffer.from('xterm-256color'),IAC,SE); this.mode='data'; }
        else { if(byte===IAC) this.sub.push(IAC); if(this.sub.length>4096) { this.socket.destroy(sessionError('TELNET_PROTOCOL_INVALID','Telnet subnegotiation exceeded 4096 bytes')); return; } this.mode='sub'; }
      }
    }
    if(data.length) this.emit('data',Buffer.from(data));
  }
  negotiate(command,option) {
    const isLocal=command===DO||command===DONT, map=isLocal?this.local:this.remote;
    const enable=command===DO||command===WILL;
    const allowed=(isLocal?[0,3,24,31]:[0,1,3]).includes(option), accepted=enable&&allowed;
    if(map.get(option)!==accepted) {
      map.set(option,accepted);
      if(enable || !accepted) this.control(IAC,isLocal?(accepted?WILL:WONT):(accepted?DO:DONT),option);
      if(isLocal && option===31 && accepted) this.setWindow(this.size.rows,this.size.cols);
    }
    if(!isLocal && option===1) this.echo=accepted;
  }
  setWindow(rows,cols) { this.size={rows,cols}; if(this.local.get(31)) this.control(IAC,SB,31,...escaped([cols>>8,cols&255,rows>>8,rows&255]),IAC,SE); }
  write(bytes) { this.socket.write(escaped(Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes))); }
  end() { this.socket.end(); }
}

// Hold a possible secret prefix instead of exposing it before the next packet arrives.
class SecretFilter {
  constructor(secret) { this.secret=secret||''; this.pending=''; }
  push(text) {
    if(!this.secret) return text;
    this.pending+=text; let out='';
    while(this.pending) {
      if(this.pending.startsWith(this.secret)) { out+='[redacted]'; this.pending=this.pending.slice(this.secret.length); }
      else if(this.secret.startsWith(this.pending)) break;
      else { out+=this.pending[0]; this.pending=this.pending.slice(1); }
    }
    return out;
  }
}

class TelnetTerminalSession extends SshTerminalSession {
  constructor(socket,channel,environment,password) {
    super(socket,channel,environment,channel.size);
    this.config={...TELNET_DEFAULTS,...environment.telnet}; this.loginTail=''; this.secretFilter=new SecretFilter(password);
    this.password=password; this.sentUsername=false; this.sentPassword=false;
    this.patterns=Object.fromEntries(['usernamePrompt','passwordPrompt','shellPrompt'].map(key=>[key,new RegExp(this.config[key],'i')]));
    this.login={state:this.config.loginMode==='manual'?'manual':'waiting',mode:this.config.loginMode,encrypted:false};
    this.loginReady=new Promise((resolve,reject)=>{this.resolveLogin=resolve;this.rejectLogin=reject;});
    this.loginReady.catch(()=>{});
    socket.once('connect',()=>{
      if(this.config.loginMode!=='manual') this.loginTimer=setTimeout(()=>this.failLogin('TELNET_LOGIN_TIMEOUT','TCP connected, but the configured login prompt was not confirmed. Read the terminal and check login mode/prompt settings.'),environment.readyTimeoutMs??15000);
    });
  }
  setLogin(state,code,message) {
    this.login={...this.login,state,...(code?{code,message}:{})}; this.outputBuffer.notify();
    if(state==='ready') { clearTimeout(this.loginTimer); this.password=undefined; this.resolveLogin(this.login); }
  }
  failLogin(code,message) { if(this.login.state==='ready'||this.login.state==='failed') return; clearTimeout(this.loginTimer); this.password=undefined; this.setLogin('failed',code,message); this.rejectLogin(sessionError(code,message)); }
  markClosed() { if(this.login) this.failLogin('TELNET_CONNECTION_CLOSED','Telnet closed before login was confirmed'); super.markClosed(); }
  append(text) {
    if(!this.login) return super.append(text);
    const clean=this.secretFilter.push(text); super.append(clean);
    this.loginTail=(this.loginTail+stripAnsi(clean)).slice(-2048);
    if(this.login.state==='ready'||this.login.state==='failed') return;
    const tail=this.loginTail;
    if(this.sentPassword && /(?:login (?:incorrect|failed)|authentication failed|access denied|认证失败|登录失败)/i.test(tail)) return this.failLogin('TELNET_AUTH_FAILED','Device rejected the login. Credentials were sent once; no command was dispatched.');
    if(this.patterns.passwordPrompt.test(tail)) {
      this.passwordEntry=true;
      if(this.config.loginMode==='password'||this.config.loginMode==='username-password') {
        if(this.sentPassword) return this.failLogin('TELNET_AUTH_FAILED','Device requested the password again; automatic login stopped.');
        if(!this.password) return this.failLogin('TELNET_PASSWORD_REQUIRED','Configure a saved password or use manual login.');
        this.sentPassword=true; this.loginTail=''; this.setLogin('waiting-prompt'); this.sendLogin(this.password); this.password=undefined;
      }
      return;
    }
    if(this.patterns.usernamePrompt.test(tail)) {
      if(this.config.loginMode==='username-password') {
        if(this.sentUsername) return this.failLogin('TELNET_AUTH_FAILED','Device requested the username again; automatic login stopped.');
        this.sentUsername=true; this.loginTail=''; this.setLogin('waiting-password'); this.sendLogin(this.environment.username);
      }
      return;
    }
    if(this.patterns.shellPrompt.test(tail) && (['manual','none'].includes(this.config.loginMode)||this.sentPassword)) { this.passwordEntry=false; this.setLogin('ready'); }
  }
  encoded(text) { const enc=normalizeTerminalEncoding(this.environment.encoding); return iconv.encode(text,enc==='iso-8859-1'?'windows-1252':enc); }
  lineText(text) { return text.replace(/\r\n|\r|\n/g,{crlf:'\r\n',cr:'\r',lf:'\n'}[this.config.lineEnding]); }
  sendLogin(text) { this.channel.write(this.encoded(this.lineText(text+'\r'))); }
  write(text) {
    if(this.closed) throw this.exitedError();
    const value=String(text??''); if(!value) return;
    if(this.login.state!=='ready' && this.config.loginMode!=='manual') {
      clearTimeout(this.loginTimer); this.config.loginMode='manual'; this.password=undefined; this.loginTail=''; this.setLogin('manual');
    }
    this.channel.write(this.encoded(this.lineText(value)));
    // Local echo is enabled only after a server explicitly declines remote echo.
    if(this.login.state==='ready' && this.channel.remote.get(1)===false && !this.passwordEntry) super.append(value.replace(/\r(?!\n)/g,'\r\n'));
  }
  startSend(request) {
    if(this.closed) throw this.exitedError();
    if(this.login.state!=='ready') throw sessionError('TELNET_LOGIN_REQUIRED','Login is not confirmed. Read the terminal, finish interactive login using remote_terminal_input, or correct the saved Telnet login settings. Nothing was dispatched.');
    return super.startSend(request);
  }
  signal(signal) {
    if(this.closed) throw this.exitedError();
    if(!['SIGINT','INT'].includes(signal)) throw sessionError('TELNET_SIGNAL_UNSUPPORTED','Telnet supports Ctrl+C input; other process signals are unavailable.');
    this.write('\u0003'); return {delivered:true,targetPgid:undefined};
  }
  exitedError() { return sessionError('REMOTE_SESSION_EXITED',`Telnet connection to ${this.environment.name} has exited. Nothing was replayed; use remote_terminal_open to reconnect.`); }
  async close(reason) { this.failLogin('TELNET_CONNECTION_CLOSED','Telnet connection closed'); await super.close(reason); }
}

export async function connectTelnet(environment,{password,signal}={}) {
  const validation=validateEnvironment(environment);
  if(!validation.ok) throw sessionError('REMOTE_ENV_INVALID',validation.errors.join(', '));
  if ([environment.username,password].some(value=>value && (/[\x00-\x1f\x7f]/.test(value) || value.length>4096))) throw sessionError('TELNET_CREDENTIAL_INVALID','Telnet credentials must be one line without terminal control characters, at most 4096 characters. Nothing was sent.');
  signal?.throwIfAborted();
  const socket=new Socket(); socket.setNoDelay(true); socket.setKeepAlive(true,10000);
  const channel=new TelnetChannel(socket,{rows:environment.terminal?.rows??40,cols:environment.terminal?.cols??160},{...TELNET_DEFAULTS,...environment.telnet});
  const session=new TelnetTerminalSession(socket,channel,environment,password);
  try {
    await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket.off('error',failed);socket.off('close',closed);error?reject(error):resolve();};
      const failed=error=>finish(sessionError(error.code??'TELNET_CONNECT_FAILED',`${environment.name} (${environment.host}:${environment.port??23}): ${error.message}`));
      const closed=()=>finish(sessionError('TELNET_CONNECTION_CLOSED','Connection closed before TCP connected'));
      const abort=()=>{finish(signal.reason??sessionError('TELNET_CANCELLED','Connection cancelled'));socket.destroy();};
      const timer=setTimeout(()=>{finish(sessionError('TELNET_CONNECT_TIMEOUT',`Connection timed out: ${environment.host}:${environment.port??23}`));socket.destroy();},environment.readyTimeoutMs??15000);
      socket.once('error',failed);socket.once('close',closed);socket.once('connect',()=>finish());signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted) abort(); else socket.connect(environment.port??23,environment.host);
    });
    return session;
  } catch(error) { await session.close(); error.stage='connection'; throw error; }
}

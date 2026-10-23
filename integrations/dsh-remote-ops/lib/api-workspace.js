import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { CookieJar } from 'tough-cookie';
import { apiError, normalizeApiConfig, endpoint, headersMap, object, pointer, redact, methods } from './api-config.js';

const MAX_RESPONSE = 128 * 1024, MAX_RECORDS = 100, MAX_OWNERS = 100;
const stamp = () => new Date().toISOString();
export class ApiWorkspace {
  constructor({root,credentials}) {
    this.root=root; this.credentials=credentials; this.environments=new Map(); this.sessions=new Map(); this.owners=new Map(); this.writes=Promise.resolve(); this.disposed=false;
    this.ready=this.load();
    // Keep a corrupt configuration reportable through routes/tools without an unhandled rejection at host startup.
    this.ready.catch(()=>{});
  }
  async load() {
    await mkdir(this.root,{recursive:true});
    try { const data=JSON.parse(await readFile(join(this.root,'environments.json'),'utf8')); for (const item of data) { const env=normalizeApiConfig(item); this.environments.set(env.id,env); } }
    catch(error) { if(error.code!=='ENOENT') throw apiError('API_CONFIG_LOAD_FAILED','API environment file could not be loaded; repair the file before saving'); }
  }
  config(id) { const env=this.environments.get(id); if(!env) throw apiError('API_ENV_NOT_FOUND','Use an exact environment ID returned by remote_api_environment_list'); return env; }
  async mutate(operation) {
    const task=this.writes.catch(()=>{}).then(async()=>{ await this.ready; if(this.disposed) throw apiError('API_CLOSED','Plugin is closed'); const next=new Map(this.environments); const result=await operation(next); const file=join(this.root,'environments.json'); const temp=file+'.'+randomUUID()+'.tmp'; await writeFile(temp,JSON.stringify([...next.values()],null,2),{mode:0o600}); await rename(temp,file); for(const [id,env]of this.environments)if(next.get(id)!==env)this.invalidate(id);this.environments=next; return result; });
    this.writes=task; return task;
  }
  async save(input,password) {
    return this.mutate(async next=>{
      const previous=input?.id?this.config(input.id):undefined;
      const env=normalizeApiConfig(input,previous);
      if([...next.values()].some(other=>other.id!==env.id&&other.name===env.name&&other.group===env.group)) throw apiError('API_ENV_NAME_EXISTS','Name already exists in this group');
      if(password != null && password !== '') { if(typeof password!=='string'||password.length>8192) throw apiError('API_PASSWORD_INVALID','Invalid password'); if(!this.credentials?.set) throw apiError('API_CREDENTIALS_UNAVAILABLE','DSH credentials unavailable'); env.auth.passwordRef ||= 'DSH_API_'+env.id.replace(/[^a-z0-9]/gi,'_').toUpperCase(); await this.credentials.set(env.auth.passwordRef,password); }
      next.set(env.id,env); return structuredClone(env);
    });
  }
  async remove(id) { return this.mutate(next=>{this.config(id); if([...this.owners.values()].some(owner=>[...owner.records.values()].some(r=>r.environment===id&&r.state==='running'))) throw apiError('API_ENV_BUSY','Wait for requests to finish before deleting'); next.delete(id);return {deleted:true,environment:id};}); }
  invalidate(id) { for(const [key,session]of this.sessions) if(session.environment===id)this.sessions.delete(key); }
  owner(id) {
    if(!id)throw apiError('API_OWNER_REQUIRED','Select an active conversation');
    if(!this.owners.has(id)) { if(this.owners.size>=MAX_OWNERS)throw apiError('API_CAPACITY','API conversation capacity reached; restart DSH after exporting records');this.owners.set(id,{records:new Map()}); }
    return this.owners.get(id);
  }
  key(owner,env) {return JSON.stringify([owner,env]);}
  snapshot(owner) {
    return {environments:structuredClone([...this.environments.values()]),sessions:owner?[...this.sessions.values()].filter(s=>s.owner===owner).map(s=>({environment:s.environment,authenticatedAt:s.at,mode:s.mode})):[],records:owner?[...(this.owners.get(owner)?.records.values()??[])].reverse().map(r=>this.publicRecord(r,false)):[],recordLimit:MAX_RECORDS,retention:'current DSH process; last 100 requests per conversation'};
  }
  publicRecord(record,detail=true) {const {controller,done,fingerprint,privateSecrets,...value}=record; if(!detail){const {response,request,...summary}=value;return structuredClone(summary);}return structuredClone(value);}
  read(owner,id) {const record=this.owners.get(owner)?.records.get(id);if(!record)throw apiError('API_RECORD_NOT_FOUND','No request with this ID in the current conversation');return this.publicRecord(record);}
  async credential(ref) {const result=await this.credentials?.resolve?.(ref);if(typeof result?.value!=='string'||!result.value)throw apiError('API_CREDENTIAL_MISSING','Configure the saved credential in the environment editor or DSH credentials');return result.value;}
  async login(owner,args,options={}) { return this.run(owner,'login',args,options); }
  async request(owner,args,options={}) { return this.run(owner,'request',args,options); }
  async run(owner,kind,args,{signal}={}) {
    await this.ready;
    if(this.disposed || signal?.aborted) throw apiError('API_CANCELLED','Nothing was dispatched');
    if(!object(args)||typeof args.requestId!=='string'||!args.requestId.trim()||args.requestId.length>120)throw apiError('API_REQUEST_INVALID','requestId is required (1–120 characters)');
    const env=this.config(args.environment),data=this.owner(owner),key=this.key(owner,env.id);
    const fingerprint=createHash('sha256').update(JSON.stringify({kind,...args})).digest('hex');
    const duplicate=data.records.get(args.requestId);
    if(duplicate) {if(duplicate.fingerprint!==fingerprint)throw apiError('API_REQUEST_ID_CONFLICT','requestId was used with different arguments');await duplicate.done;return this.publicRecord(duplicate);}
    if([...data.records.values()].filter(r=>r.state==='running').length>=8)throw apiError('API_BUSY','At most 8 API requests per conversation may run at once');
    if(kind==='login'&&[...data.records.values()].some(r=>r.kind==='login'&&r.environment===env.id&&r.state==='running'))throw apiError('API_LOGIN_BUSY','Login already in progress for this environment');
    const path=kind==='login'?env.auth.loginPath:args.path;
    const url=endpoint(env.baseUrl,path),method=kind==='login'?'POST':args.method??'GET';
    if(!methods.includes(method))throw apiError('API_REQUEST_INVALID','Unsupported HTTP method');
    const extra=headersMap(args.headers??{});
    if([env.auth.headerName,env.auth.csrfHeader].some(k=>Object.hasOwn(extra,k.toLowerCase())))throw apiError('API_REQUEST_INVALID','Managed auth headers cannot be overridden');
    if(args.body!=null&&['GET','HEAD'].includes(method))throw apiError('API_REQUEST_INVALID','GET/HEAD must not contain a body');
    if(args.body!=null&&!object(args.body)&&!Array.isArray(args.body)&&typeof args.body!=='string')throw apiError('API_REQUEST_INVALID','body must be an object, array or text');
    const serialized=args.body==null?undefined:typeof args.body==='string'?args.body:JSON.stringify(args.body);
    if(serialized&&Buffer.byteLength(serialized)>1024*1024)throw apiError('API_REQUEST_INVALID','Request body exceeds 1 MiB');
    const session=this.sessions.get(key);
    if(kind==='request'&&env.auth.mode!=='none'&&!session)throw apiError('API_LOGIN_REQUIRED','Login to this environment in the current conversation, then submit a new request');
    if(kind==='login'&&env.auth.mode==='none')throw apiError('API_AUTH_NONE','This environment does not use login');
    while(data.records.size>=MAX_RECORDS) {const oldest=[...data.records.values()].find(r=>r.state!=='running');if(!oldest)throw apiError('API_BUSY','Request capacity reached');data.records.delete(oldest.id);}
    const record={id:args.requestId,kind,environment:env.id,environmentName:env.name,method,path:redact(path),url:redact(url.href),startedAt:stamp(),state:'running',fingerprint,controller:new AbortController()};
    data.records.set(record.id,record);
    const cancel=()=>record.controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    // Captured env and session are immutable for this request. UI selection and edits cannot retarget it.
    record.done=this.perform(owner,env,key,session,record,url,extra,serialized,args.body).finally(()=>signal?.removeEventListener('abort',cancel));
    await record.done;return this.publicRecord(record);
  }
  async perform(owner,env,key,session,record,url,extra,serialized,body) {
    const start=Date.now(),secrets=[];let dispatched=false;let jar=session?.jar;let token=session?.token;
    if(record.kind==='login')this.sessions.delete(key);
    try {
      const headers={accept:'application/json',...env.headers,...extra};
      for(const [name,ref]of Object.entries(env.headerRefs)) {headers[name]=await this.credential(ref);secrets.push(headers[name]);}
      if(token)secrets.push(token);
      if(record.kind==='login') {
        const password=await this.credential(env.auth.passwordRef);secrets.push(password);
        const loginBody={...env.auth.extraBody,[env.auth.usernameField]:env.auth.username,[env.auth.passwordField]:password};
        serialized=env.auth.bodyFormat==='form'?new URLSearchParams(Object.entries(loginBody).map(([k,v])=>[k,String(v)])).toString():JSON.stringify(loginBody);
        headers['content-type']=env.auth.bodyFormat==='form'?'application/x-www-form-urlencoded':'application/json'; jar=new CookieJar();
      } else {
        if(token)headers[env.auth.headerName.toLowerCase()]=env.auth.prefix+token;
        if(jar) {const cookies=await jar.getCookies(url.href);for(const cookie of cookies)secrets.push(cookie.value);const cookie=await jar.getCookieString(url.href);if(cookie)headers.cookie=cookie;if(env.auth.mode==='cookie'&&!cookies.some(c=>!env.auth.cookieName||c.key===env.auth.cookieName)){this.sessions.delete(key);throw apiError('API_LOGIN_REQUIRED','Cookie expired or does not match this request path');}if(env.auth.csrfCookie){const csrf=cookies.find(c=>c.key===env.auth.csrfCookie);if(!csrf)throw apiError('API_CSRF_MISSING','CSRF cookie not available');headers[env.auth.csrfHeader.toLowerCase()]=csrf.value;}}
        if(serialized!=null&&!headers['content-type'])headers['content-type']=typeof body==='string'?'text/plain; charset=utf-8':'application/json';
      }
      record.request=record.kind==='login'?{body:'[login credentials omitted]'}:{headers:redact(headers,secrets),body:redact(body,secrets)};
      record.url=redact(url.href,secrets);record.path=redact(record.path,secrets);
      const response=await this.exchange(url,{method:record.method,headers,body:serialized,ca:env.caPem||undefined,timeout:env.timeoutMs,signal:record.controller.signal,onDispatch:()=>{dispatched=true;}});
      record.httpStatus=response.status; record.truncated=response.truncated;
      for(const cookie of response.cookies) {try {await jar?.setCookie(cookie,url.href);const value=cookie.split(';')[0].split('=').slice(1).join('=');if(value)secrets.push(value);} catch {/* Ignore invalid cookies; required login cookie is checked below. */}}
      let parsed;try {parsed=JSON.parse(response.text);}catch{parsed=response.text;}
      if(record.kind==='login') {
        if(response.status<200||response.status>=300)throw apiError('API_LOGIN_FAILED',`Login returned HTTP ${response.status}`);
        if(env.auth.successPointer&&JSON.stringify(pointer(parsed,env.auth.successPointer))!==JSON.stringify(env.auth.successValue))throw apiError('API_LOGIN_FAILED','Login success condition did not match');
        if(env.auth.mode==='token') {token=env.auth.tokenSource==='header'?response.headers[env.auth.tokenResponseHeader.toLowerCase()]:pointer(parsed,env.auth.tokenPointer);if(typeof token!=='string'||!token||/[\r\n]/.test(token)||token.length>8192)throw apiError('API_TOKEN_MISSING','Expected token was not found; check login configuration');secrets.push(token);}
        else {const cookies=await jar.getCookies(url.href);if(!cookies.some(c=>!env.auth.cookieName||c.key===env.auth.cookieName))throw apiError('API_COOKIE_MISSING','Expected login cookie was not found');}
        if(this.environments.get(env.id)!==env)throw apiError('API_ENV_CHANGED','Environment changed during login; login again using its new configuration');
        this.sessions.set(key,{owner,environment:env.id,mode:env.auth.mode,token:env.auth.mode==='token'?token:undefined,jar:env.auth.mode==='cookie'?jar:undefined,at:stamp()});
        record.response={authenticated:true,mode:env.auth.mode};record.state='completed';
      } else {
        record.response={headers:redact(response.headers,secrets),body:redact(parsed,secrets)};
        record.state=response.status>=200&&response.status<300?'completed':'http_error';
        if(response.status===401){if(this.sessions.get(key)===session)this.sessions.delete(key);record.code='API_AUTH_EXPIRED';record.note='Login expired. Request was not replayed. Verify any mutation before deciding whether to retry.';}
        if(response.status>=300&&response.status<400)record.note='Redirect was not followed. Check the saved base URL/path.';
      }
    } catch(error) {
      record.code=error.code?.startsWith('API_')?error.code:'API_TRANSPORT_FAILED';
      record.state=dispatched&&!record.httpStatus?'unknown':'failed';
      record.error=record.code==='API_TRANSPORT_FAILED'?'Connection or TLS failed. Check endpoint, network and CA certificate.':redact(error.message,secrets);
      if(record.state==='unknown')record.note='The device may have applied the request. Check its state with a read-only request; do not automatically retry.';
      if(record.kind==='login')record.response={authenticated:false};
    } finally {record.durationMs=Date.now()-start;record.finishedAt=stamp();}
  }
  exchange(url,{method,headers,body,ca,timeout,signal,onDispatch}) {
    return new Promise((resolve,reject)=>{
      if(signal.aborted)return reject(apiError('API_CANCELLED','Cancelled before dispatch'));
      let timer,settled=false;
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(result);};
      const req=(url.protocol==='https:'?https:http).request(url,{method,headers:{...headers,'accept-encoding':'identity'},ca},res=>{
        let length=0;const chunks=[];const result=()=>({status:res.statusCode,headers:res.headers,cookies:res.headers['set-cookie']??[],text:Buffer.concat(chunks).toString('utf8'),truncated:length>MAX_RESPONSE});
        res.on('data',chunk=>{if(length<MAX_RESPONSE)chunks.push(chunk.subarray(0,MAX_RESPONSE-length));length+=chunk.length;if(length>MAX_RESPONSE){finish(null,result());res.destroy();}});
        res.on('end',()=>finish(null,result()));res.on('error',error=>finish(error));res.on('aborted',()=>finish(apiError('API_RESPONSE_INTERRUPTED','Response interrupted; verify the operation result')));
      });
      const abort=()=>req.destroy(apiError('API_CANCELLED','Conversation stopped; request not replayed'));
      req.on('error',error=>finish(error));signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>req.destroy(apiError('API_TIMEOUT','Request timed out; request not replayed')),timeout);
      if(signal.aborted)return abort();onDispatch();req.end(body);
    });
  }
  async dispose() {this.disposed=true;const records=[...this.owners.values()].flatMap(o=>[...o.records.values()]);for(const r of records)if(r.state==='running')r.controller.abort();await Promise.allSettled(records.map(r=>r.done));await this.writes.catch(()=>{});this.sessions.clear();this.owners.clear();}
}

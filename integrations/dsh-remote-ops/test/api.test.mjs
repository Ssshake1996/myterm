import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { ApiWorkspace } from '../lib/api-workspace.js';
import Ajv from 'ajv';
import { registerApiTools, API_TOOL_SCHEMAS } from '../lib/api-tools.js';
import { registerApiRoutes } from '../lib/api-routes.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'remote-api-'));
  const secrets = new Map([['TEST_PASSWORD', 'test-pass-SECRET']]);
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ url: req.url, method: req.method, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/login') return res.end(JSON.stringify({ data: { token: 'token-SECRET' } }));
    if (req.url === '/v1/cookie-login') { res.setHeader('Set-Cookie', ['sid=cookie-SECRET; Path=/v1; HttpOnly', 'csrf=csrf-SECRET; Path=/v1']); return res.end('{"ok":true}'); }
    if (req.url === '/v1/header-login') { res.setHeader('x-login-token', 'header-SECRET'); return res.end('{}'); }
    if (req.url === '/v1/bad-login') return res.end('{"ok":false}');
    if (req.url === '/v1/unauthorized') { res.statusCode=401; return res.end('{"error":"expired"}'); }
    if (req.url === '/v1/redirect') { res.statusCode=302; res.setHeader('Location','https://example.test'); return res.end('{}'); }
    if (req.url === '/v1/slow') await new Promise(resolve=>setTimeout(resolve, 250));
    if (req.url === '/v1/slow-login') {await new Promise(resolve=>setTimeout(resolve,120));return res.end('{"data":{"token":"late-SECRET"}}');}
    if (req.url === '/v1/large') return res.end('x'.repeat(2*1024*1024));
    res.end(JSON.stringify({ ok:true, authorization:req.headers.authorization, cookie:req.headers.cookie, body, password:'other-secret', path:req.url }));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
  const options={root,credentials:{resolve:async ref=>({value:secrets.get(ref)}),set:async(ref,value)=>secrets.set(ref,value)}};
  const ws=new ApiWorkspace(options); await ws.ready;
  t.after(async()=>{await ws.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  const env=await ws.save({name:'Test API',baseUrl,auth:{mode:'token',username:'tester',passwordRef:'TEST_PASSWORD',loginPath:'login',tokenPointer:'/data/token'}});
  return {ws,env,root,options,calls,baseUrl,secrets};
}

test('API-only environment CRUD persists configuration without secrets, rejects invalid updates atomically',async t=>{
  const {ws,env,root,options}=await fixture(t);
  const changed=await ws.save({id:env.id,name:'Renamed',group:'lab',timeoutMs:null});
  assert.equal(changed.baseUrl,env.baseUrl); assert.equal(changed.auth.passwordRef,'TEST_PASSWORD');
  for(const patch of [{baseUrl:'file:///tmp/a'},{headers:{Authorization:'raw'}},{auth:{mode:'typo'}},{unknown:1}]) await assert.rejects(ws.save({id:env.id,...patch}));
  assert.equal(ws.snapshot('a').environments[0].name,'Renamed');
  const disk=await readFile(join(root,'environments.json'),'utf8'); assert.ok(!disk.includes('test-pass-SECRET'));
  const reload=new ApiWorkspace(options); await reload.ready; assert.equal(reload.snapshot('a').environments[0].id,env.id); assert.equal(reload.snapshot('a').sessions.length,0); await reload.dispose();
  await ws.remove(env.id); assert.equal(ws.snapshot('a').environments.length,0);
});

test('JSON token login, path prefixes, execution receipts and redaction',async t=>{
  const {ws,env,calls}=await fixture(t);
  await assert.rejects(ws.request('a',{environment:env.id,requestId:'before',path:'items'}),{code:'API_LOGIN_REQUIRED'});
  const login=await ws.login('a',{environment:env.id,requestId:'login'}); assert.equal(login.state,'completed');
  const result=await ws.request('a',{environment:env.id,requestId:'r1',method:'POST',path:'/items',body:{action:'inspect'}});
  assert.equal(result.httpStatus,200); assert.equal(result.state,'completed'); assert.equal(calls.at(-1).url,'/v1/items'); assert.equal(calls.at(-1).headers.authorization,'Bearer token-SECRET');
  assert.deepEqual(JSON.parse(calls[0].body),{username:'tester',password:'test-pass-SECRET'});
  const publicText=JSON.stringify(ws.snapshot('a'));
  for(const secret of ['test-pass-SECRET','token-SECRET','other-secret']) assert.ok(!publicText.includes(secret),secret);
  for(const secret of ['token-SECRET','other-secret']) assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(ws.snapshot('b').records.length,0);
  await assert.rejects(ws.request('b',{environment:env.id,requestId:'r2',path:'items'}),{code:'API_LOGIN_REQUIRED'});
});

test('environment edit cannot retarget an in-flight request or revive an old login; timeout does not resend',async t=>{
  const {ws,env,calls}=await fixture(t);
  await ws.save({id:env.id,auth:{loginPath:'slow-login'}});
  const pending=ws.login('a',{environment:env.id,requestId:'slow-login'});
  await new Promise(resolve=>setTimeout(resolve,40));
  await ws.save({id:env.id,name:'Changed'});
  assert.equal((await pending).code,'API_ENV_CHANGED');assert.equal(ws.snapshot('a').sessions.length,0);
  await ws.save({id:env.id,timeoutMs:100,auth:{loginPath:'login'}});await ws.login('a',{environment:env.id,requestId:'l'});
  const request=ws.request('a',{environment:env.id,requestId:'timeout',method:'POST',path:'slow'});
  await ws.save({id:env.id,baseUrl:'http://127.0.0.1:1/other'});
  const receipt=await request;assert.equal(receipt.code,'API_TIMEOUT');assert.equal(receipt.state,'unknown');assert.equal(calls.filter(c=>c.url==='/v1/slow').length,1);
});

test('no-auth requests, secret header references, preflight validation and saved credential updates',async t=>{
  const {ws,env,secrets,calls}=await fixture(t);secrets.set('API_KEY','key-SECRET');
  await ws.save({id:env.id,auth:{mode:'none'},headerRefs:{'X-Api-Key':'API_KEY'}});
  const result=await ws.request('a',{environment:env.id,requestId:'anonymous',path:'items',headers:null,method:null});
  assert.equal(result.httpStatus,200);assert.equal(calls.at(-1).headers['x-api-key'],'key-SECRET');assert.ok(!JSON.stringify(result).includes('key-SECRET'));
  const before=calls.length;
  for(const args of [{path:'items',headers:[]},{path:'items',method:'BOGUS'},{path:'items',method:'GET',body:{x:1}},{path:'items',headers:{host:'evil'}},{path:'items',body:'x'.repeat(1024*1024+1),method:'POST'}])await assert.rejects(ws.request('a',{environment:env.id,requestId:'invalid-'+calls.length,...args}));
  assert.equal(calls.length,before);
  await assert.rejects(ws.save({id:env.id,auth:{extraBody:{nested:{password:'raw'}}}}));
  const saved=await ws.save({id:env.id,auth:{mode:'token',passwordRef:''}},'replacement-SECRET');assert.equal(secrets.get(saved.auth.passwordRef),'replacement-SECRET');
  assert.ok(!JSON.stringify(ws.snapshot('a')).includes('replacement-SECRET'));
});

test('record retention bounds duplicate-ID protection and owner records never cross conversations',async t=>{
  const {ws,env}=await fixture(t);await ws.save({id:env.id,auth:{mode:'none'}});
  for(let n=0;n<103;n++)await ws.request('a',{environment:env.id,requestId:'r'+n,path:'items'});
  assert.equal(ws.snapshot('a').records.length,100);assert.throws(()=>ws.read('a','r0'),{code:'API_RECORD_NOT_FOUND'});assert.throws(()=>ws.read('b','r102'),{code:'API_RECORD_NOT_FOUND'});
  assert.equal(ws.read('a','r102').state,'completed');
});

test('corrupt persisted configuration is reported without being overwritten',async t=>{
  const {root,options}=await fixture(t);await writeFile(join(root,'environments.json'),'{broken');
  const invalid=new ApiWorkspace(options);await assert.rejects(invalid.ready,{code:'API_CONFIG_LOAD_FAILED'});
  await assert.rejects(invalid.save({name:'overwrite',baseUrl:'http://localhost'}),{code:'API_CONFIG_LOAD_FAILED'});
  assert.equal(await readFile(join(root,'environments.json'),'utf8'),'{broken');await invalid.dispose();
});

test('tool schemas compile, shipped examples match and native routes bind conversation without leaking login secrets',async t=>{
  const {ws,env}=await fixture(t),tools=new Map(),routes=new Map();
  const ctx={tools:{register:def=>tools.set(def.name,def)},agents:{get:id=>id==='a'?{id:'a'}:undefined},effect:fn=>fn(),connection:{fetch:{register:def=>routes.set(def.path,def)}}};
  const state={api:ws,findEnvironment:()=>null,resolveOwner:async id=>{if(!ctx.agents.get(id))throw Error('missing');return {id};}};
  registerApiTools(ctx,state);registerApiRoutes(ctx,state);const ajv=new Ajv({strict:true});
  const allowed=new Set(['type','oneOf','properties','required','additionalProperties','items','enum','description']);
  const inspect=schema=>{assert.ok(Object.keys(schema).every(key=>allowed.has(key)),JSON.stringify(schema));Object.values(schema.properties??{}).forEach(inspect);(schema.oneOf??[]).forEach(inspect);if(schema.items)inspect(schema.items);if(typeof schema.additionalProperties==='object')inspect(schema.additionalProperties);};
  for(const schema of Object.values(API_TOOL_SCHEMAS)){inspect(schema);ajv.compile(schema);}
  const skill=await readFile(new URL('../skills/remote-ops-api/SKILL.md',import.meta.url),'utf8');const examples=[...skill.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map(m=>JSON.parse(m[1]));
  assert.equal(ajv.compile(API_TOOL_SCHEMAS.remote_api_environment_save)(examples[0]),true);
  assert.equal(ajv.compile(API_TOOL_SCHEMAS.remote_api_request)(examples[1]),true);
  await tools.get('remote_api_login').execute({environment:env.id,requestId:'native-login'},{agent:{id:'a'}});
  const receipt=await tools.get('remote_api_records').execute({requestId:'native-login'},{agent:{id:'a'}});
  assert.deepEqual(receipt,JSON.parse(JSON.stringify(receipt)),'native DSH tool values must not contain undefined response fields');
  const res=await routes.get('/api/dsh-remote-ops/api').fetch(new Request('http://localhost/api/dsh-remote-ops/api?sessionId=a'));
  assert.equal((await res.json()).records[0].id,'native-login');assert.equal(res.headers.get('cache-control'),'no-store');
  const denied=await routes.get('/api/dsh-remote-ops/api').fetch(new Request('http://localhost/api/dsh-remote-ops/api?sessionId=b&requestId=native-login'));assert.equal(denied.status,400);
  const client=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');assert.match(client,/const ApiWorkspacePanel = createApiPanel/);assert.ok(!client.includes("import('/api/dsh-remote-ops/api-client.js')"));
  await tools.get('remote_api_environment_save').execute({id:env.id,baseUrl:null,auth:{username:null}},{agent:{id:'a'}});
  assert.equal(ws.config(env.id).auth.username,'tester');
});

test('form login, scoped Cookie jar and CSRF header; header token extraction',async t=>{
  const {ws,env,calls}=await fixture(t);
  await ws.save({id:env.id,auth:{mode:'cookie',loginPath:'cookie-login',bodyFormat:'form',cookieName:'sid',csrfCookie:'csrf',csrfHeader:'x-csrf-token'}});
  await ws.login('a',{environment:env.id,requestId:'cookie'});
  await ws.request('a',{environment:env.id,requestId:'cookie-r',path:'items',method:'POST',body:{a:1}});
  assert.match(calls[0].body,/password=test-pass-SECRET/); assert.match(calls.at(-1).headers.cookie,/sid=cookie-SECRET/); assert.equal(calls.at(-1).headers['x-csrf-token'],'csrf-SECRET');
  assert.ok(!JSON.stringify(ws.snapshot('a')).includes('cookie-SECRET'));
  await ws.save({id:env.id,auth:{mode:'token',loginPath:'header-login',tokenSource:'header',tokenResponseHeader:'x-login-token'}});
  await ws.login('a',{environment:env.id,requestId:'header'});
  await ws.request('a',{environment:env.id,requestId:'header-r',path:'items'}); assert.equal(calls.at(-1).headers.authorization,'Bearer header-SECRET');
});

test('duplicate request IDs do not replay; conflicts fail; 401 and redirects never retry',async t=>{
  const {ws,env,calls}=await fixture(t); await ws.login('a',{environment:env.id,requestId:'l'});
  const args={environment:env.id,requestId:'once',path:'slow',method:'POST',body:{a:1}};
  const [a,b]=await Promise.all([ws.request('a',args),ws.request('a',args)]); assert.equal(a.id,b.id); assert.equal(calls.filter(c=>c.url==='/v1/slow').length,1);
  await assert.rejects(ws.request('a',{...args,path:'items'}),{code:'API_REQUEST_ID_CONFLICT'});
  const r=await ws.request('a',{environment:env.id,requestId:'expired',method:'POST',path:'unauthorized'}); assert.equal(r.httpStatus,401); assert.equal(r.state,'http_error');
  assert.equal(calls.filter(c=>c.url==='/v1/unauthorized').length,1);
  await assert.rejects(ws.request('a',{environment:env.id,requestId:'after',path:'items'}),{code:'API_LOGIN_REQUIRED'});
  await ws.login('a',{environment:env.id,requestId:'l2'});
  const redirect=await ws.request('a',{environment:env.id,requestId:'redirect',path:'redirect'}); assert.equal(redirect.httpStatus,302); assert.equal(redirect.state,'http_error');
});

test('cross-origin/path escapes and auth overrides rejected before dispatch; login failure clears session',async t=>{
  const {ws,env,calls}=await fixture(t); await ws.login('a',{environment:env.id,requestId:'l'});
  for(const path of ['https://example.test','//evil.test','../escape','%2e%2e/escape','foo\\bar']) await assert.rejects(ws.request('a',{environment:env.id,requestId:path,path}));
  await assert.rejects(ws.request('a',{environment:env.id,requestId:'override',path:'items',headers:{Authorization:'oops'}})); assert.equal(calls.length,1);
  await ws.save({id:env.id,auth:{loginPath:'bad-login'}});
  const failure=await ws.login('a',{environment:env.id,requestId:'bad'}); assert.equal(failure.state,'failed'); assert.equal(ws.snapshot('a').sessions.length,0);
});

test('timeout/cancellation after dispatch are unknown, never replayed, large responses bounded',async t=>{
  const {ws,env,calls}=await fixture(t); await ws.login('a',{environment:env.id,requestId:'l'});
  const controller=new AbortController(); const task=ws.request('a',{environment:env.id,requestId:'cancel',method:'POST',path:'slow'},{signal:controller.signal});
  setTimeout(()=>controller.abort(),40); const result=await task; assert.equal(result.state,'unknown'); assert.equal(result.code,'API_CANCELLED');
  assert.equal((await ws.request('a',{environment:env.id,requestId:'cancel',method:'POST',path:'slow'})).id,result.id); assert.equal(calls.filter(c=>c.url==='/v1/slow').length,1);
  const large=await ws.request('a',{environment:env.id,requestId:'large',path:'large'}); assert.equal(large.truncated,true); assert.ok(JSON.stringify(large).length<300000);
  const before=calls.length; const aborted=new AbortController(); aborted.abort(); await assert.rejects(ws.request('a',{environment:env.id,requestId:'pre',path:'items'},{signal:aborted.signal})); assert.equal(calls.length,before);
});

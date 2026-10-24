import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRefreshNoticeGate} from '../lib/http-diagnostics.js';

const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
test('a background failure is shown once per runtime across remounts, while manual retry remains visible',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
  const failure={code:'NOT_FOUND',requestFailure:{stage:'state-refresh',method:'GET',url:'http://dsh/api/state?sessionId=one',status:404}};
  const first=createRefreshNoticeGate(storage);first.setRuntime('boot-a');assert.equal(first.shouldNotify(failure),true);assert.equal(first.shouldNotify(failure),false);
  const remount=createRefreshNoticeGate(storage);remount.setRuntime('boot-a');assert.equal(remount.shouldNotify(failure),false);assert.equal(remount.shouldNotify(failure,true),true);assert.equal(remount.shouldNotify(failure),false);
  remount.setRuntime('boot-b');assert.equal(remount.shouldNotify(failure),true);
});
function requestWith(fetch){
  const start=source.includes('// BEGIN generated HTTP diagnostics')?source.indexOf('// BEGIN generated HTTP diagnostics'):source.indexOf('const failureMessage =');
  const context={fetch,URL,Date,window:{location:{href:'https://dsh.example/app/'}},AbortController};
  vm.runInNewContext(source.slice(start,source.indexOf('    const empty =',start))+'\nglobalThis.call=request;',context);
  return context.call;
}
test('plain HTTP 404 identifies state refresh and the actual request with redacted query',async()=>{
  const request=requestWith(async()=>new Response('Not Found',{status:404}));
  await assert.rejects(request('/api/dsh-remote-ops/state?sessionId=private-session'),error=>{
    assert.match(error.message,/^状态刷新失败/);assert.match(error.message,/GET https:\/\/dsh\.example\/api\/dsh-remote-ops\/state/);
    assert.match(error.message,/HTTP 404/);assert.match(error.message,/Not Found/);assert.doesNotMatch(error.message,/private-session/);return true;
  });
});
test('network failures include operation and address; cancellation remains cancellation',async()=>{
  const request=requestWith(async()=>{throw new TypeError('Failed to fetch');});
  await assert.rejects(request('/api/dsh-remote-ops/update'),error=>{assert.match(error.message,/更新状态读取失败/);assert.match(error.message,/未收到 HTTP 响应/);assert.match(error.message,/\/update/);return true;});
  const aborted=Object.assign(new Error('aborted'),{name:'AbortError'});
  await assert.rejects(requestWith(async()=>{throw aborted;})('/api/dsh-remote-ops/state'),error=>error===aborted);
});
test('JSON errors retain their code, bound the preview, and redact credentials',async()=>{
  const request=requestWith(async()=>Response.json({code:'EXAMPLE_ERROR',error:'Denied',password:'fixture-password',access_token:'fixture-token',nested:{cookie:'fixture-cookie'},detail:'x'.repeat(9000)},{status:403}));
  await assert.rejects(request('/api/dsh-remote-ops/action',{method:'POST',body:'secret request body'}),error=>{
    assert.equal(error.code,'EXAMPLE_ERROR');assert.match(error.message,/HTTP 403/);assert.doesNotMatch(error.message,/fixture-password|fixture-token|fixture-cookie|secret request body/);assert.ok(error.message.length<2500);return true;
  });
});
test('upstream update diagnostics distinguish upstream HTTP 404 from the plugin HTTP 400',async()=>{
  const request=requestWith(async()=>Response.json({code:'UPDATE_DOWNLOAD_FAILED',error:'Missing package',requestFailure:{stage:'update-package',method:'GET',url:'https://updates.example/pkg.tgz?signature=fixture-signature',status:404,responseSummary:'Not Found',at:'2026-10-24T00:00:00.000Z'}},{status:400}));
  await assert.rejects(request('/api/dsh-remote-ops/update',{method:'POST',body:JSON.stringify({action:'install'})}),error=>{
    assert.match(error.message,/^插件更新失败/);assert.match(error.message,/下载安装包/);assert.match(error.message,/GET https:\/\/updates.example\/pkg.tgz/);assert.match(error.message,/HTTP 404/);assert.match(error.message,/插件接口.*HTTP 400/);assert.doesNotMatch(error.message,/fixture-signature/);return true;
  });
});
test('invalid JSON and empty non-OK responses still retain the status and URL',async()=>{
  await assert.rejects(requestWith(async()=>new Response('<html>proxy error</html>'))('/api/dsh-remote-ops/state'),error=>{assert.match(error.message,/HTTP 200/);assert.match(error.message,/JSON/);assert.match(error.message,/proxy error/);return true;});
  await assert.rejects(requestWith(async()=>new Response(null,{status:404}))('/api/dsh-remote-ops/state'),error=>{assert.match(error.message,/HTTP 404/);assert.match(error.message,/响应为空/);return true;});
});

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeUpdateSettings, readUpdateSettings, writeUpdateSettings, compareVersions, fetchLatestRelease, downloadRelease, fetchUpdateBytes, expectedChecksum, inspectUpdatePackage, UPDATE_PACKAGE } from "../lib/release.js";
import { PLUGIN_VERSION } from "../lib/version.js";
import { withUpdates } from "../lib/state/updates.js";
import { createUpdateManifest } from "../scripts/create-update-manifest.mjs";

const next = PLUGIN_VERSION.split('.').map(Number); next[2]++; const nextVersion = next.join('.');

test('update HTTP errors retain the failing stage, redirect target and bounded safe response',async()=>{
  let calls=0;
  await assert.rejects(fetchUpdateBytes('https://updates.example/start',{stage:'update-package',fetchImpl:async()=>++calls===1?new Response(null,{status:302,headers:{location:'https://updates.example/pkg.tgz?signature=private-signature'}}):new Response('Authorization: Bearer private-bearer\nCookie: sid=private-cookie\npassword=private-password\nNot Found '+ 'x'.repeat(10000),{status:404})}),error=>{
    assert.equal(error.requestFailure.stage,'update-package');assert.equal(error.requestFailure.status,404);assert.match(error.requestFailure.url,/updates.example\/pkg.tgz/);assert.match(error.requestFailure.responseSummary,/Not Found/);assert.ok(error.requestFailure.responseSummary.length<=1200);assert.doesNotMatch(JSON.stringify(error.requestFailure),/private-signature|private-bearer|private-cookie|private-password/);return true;
  });
});

test('manifest, checksum and archive failures identify their own request',async t=>{
  for(const stage of ['update-manifest','update-checksum','update-package']) {
    const fetchImpl=async address=>address.endsWith('latest.json')?(stage==='update-manifest'?new Response('Missing manifest',{status:404}):Response.json({schemaVersion:1,package:UPDATE_PACKAGE,version:nextVersion,asset:'pkg.tgz',checksum:'sums.txt'})):address.endsWith('.txt')?(stage==='update-checksum'?new Response('Missing checksum',{status:404}):new Response('a'.repeat(64)+`  dsh-remote-ops-v${nextVersion}.tgz`)):new Response('Missing package',{status:404});
    await assert.rejects((async()=>{const release=await fetchLatestRelease({source:'custom',url:'https://updates.example/latest.json'},{fetchImpl});await downloadRelease(release,await rootFor(t),{fetchImpl});})(),error=>{assert.equal(error.requestFailure.stage,stage);assert.equal(error.requestFailure.status,404);return true;});
  }
});

test('failed update diagnostics survive status reads and clear after saving a corrected source',async t=>{
  const f=await feed(t),{state}=await stateFor(t,f);f.settings={source:'custom',url:new URL(f.base).origin+'/missing/'};
  // Local server always supplies latest.json, so use a deterministic invalid JSON response.
  f.raw='<html>missing version list</html>';
  await assert.rejects(state.checkForUpdate(true),/UPDATE_METADATA_INVALID/);
  const failure=await state.updateStatus();assert.equal(failure.requestFailure.stage,'update-manifest');assert.match(failure.requestFailure.url,/latest.json/);
  await state.saveUpdateSettings({source:'github'});assert.equal((await state.updateStatus()).requestFailure,null);
});
function tarball(version = nextVersion, extra = {}) {
  const json = Buffer.from(JSON.stringify({ name: UPDATE_PACKAGE, version, dsh: { bundle: { patch: './cordis.patch.yml' } }, ...extra }));
  const header = Buffer.alloc(512); header.write('package/package.json'); header.write('0000644\0',100); header.write(json.length.toString(8).padStart(11,'0')+'\0',124); header[156]=48;
  header.fill(32,148,156); const sum=header.reduce((a,b)=>a+b,0); header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
  return gzipSync(Buffer.concat([header,json,Buffer.alloc((512-json.length%512)%512),Buffer.alloc(1024)]));
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function rootFor(t) { const root=await mkdtemp(join(tmpdir(),'remote-updates-'));t.after(()=>rm(root,{recursive:true,force:true}));return root; }
async function feed(t) {
  const config={version:nextVersion,bytes:tarball(),requests:[],delay:0};
  const server=createServer(async(req,res)=>{
    config.requests.push(req.url);
    if(config.delay)await new Promise(r=>setTimeout(r,config.delay));
    if(req.url==='/redirect'){res.writeHead(302,{location:config.redirect});return res.end();}
    if(req.url.endsWith('/latest.json')){res.setHeader('Content-Type','application/json');return res.end(config.raw??JSON.stringify(config.metadata??{schemaVersion:1,package:UPDATE_PACKAGE,version:config.version,asset:`dsh-remote-ops-v${config.version}.tgz`,checksum:`SHA256SUMS-dsh-remote-ops-v${config.version}.txt`}));}
    if(req.url.endsWith('.txt'))return res.end(`${config.digest??sha(config.bytes)}  dsh-remote-ops-v${config.version}.tgz\n`);
    if(req.url.endsWith('.tgz'))return res.end(config.bytes);
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  config.base=`http://127.0.0.1:${server.address().port}/feed/`; config.settings={source:'custom',url:config.base};
  return config;
}
async function stateFor(t, f) {
  const root=await rootFor(t);await writeUpdateSettings(root,normalizeUpdateSettings(f.settings));
  const State=withUpdates(class {});const state=new State();state.base=root;state.releaseCheckedAt=0;state.release={currentVersion:PLUGIN_VERSION};
  let installed=PLUGIN_VERSION;const installs=[];
  state.updateManager={listBundles:async()=>[{name:UPDATE_PACKAGE,version:installed,installed:true}],installBundle:async(path,options)=>{installs.push({path,options});inspectUpdatePackage(await readFile(path),f.version);installed=f.version;return {application:'restart-required',packageResult:{exitCode:0}};}};
  return {state,installs,setInstalled:value=>installed=value};
}

test('custom address accepts a directory or latest.json; rejects unsafe or malformed settings',()=>{
  assert.deepEqual(normalizeUpdateSettings({source:'custom',url:' https://intranet.example/releases '}),{source:'custom',url:'https://intranet.example/releases/latest.json'});
  assert.equal(normalizeUpdateSettings({source:'custom',url:'http://host/latest.json'}).url,'http://host/latest.json');
  assert.deepEqual(normalizeUpdateSettings({source:'github',url:'ignored'}),{source:'github',url:''});
  for(const value of [null,[],{}, {source:'other'}, {source:'filesystem',path:'/releases'}, {source:'sftp',path:'/releases',environment:'ssh'},...['file:///tmp','sftp://host/releases','ftp://host/releases','https://user:pass@host','https://host/?token=secret','https://host/#part',''].map(url=>({source:'custom',url}))])assert.throws(()=>normalizeUpdateSettings(value),/UPDATE_/);
});

test('settings persist atomically, corruption is visible and explicit save repairs it',async t=>{
  const root=await rootFor(t);assert.equal((await readUpdateSettings(root)).source,'github');
  const settings=normalizeUpdateSettings({source:'custom',url:'http://host/plugin/'});await writeUpdateSettings(root,settings);assert.deepEqual(await readUpdateSettings(root),settings);
  await writeFile(join(root,'update-settings.json'),'broken');await assert.rejects(readUpdateSettings(root),/UPDATE_SETTINGS_INVALID/);
  const state=new(withUpdates(class{}))();state.base=root;assert.match((await state.updateStatus()).error,/UPDATE_SETTINGS_INVALID/);
  await state.saveUpdateSettings(settings);assert.equal((await state.updateStatus()).error,null);
});

test('stable numeric versions compare correctly without upgrading to prereleases or lower versions',()=>{
  assert.ok(compareVersions('0.10.0','0.9.9')>0);assert.ok(compareVersions('1.0.0','0.99.0')>0);assert.equal(compareVersions('1.0.0','1.0.0'),0);
  for(const value of ['1.0.0-beta','01.2.3','1.2',null,{},'99999999999999999.0.0'])assert.throws(()=>compareVersions(value,'0.8.0'),/UPDATE_METADATA_INVALID/);
});

test('manifest resolves relative URLs; malformed or cross-origin metadata never downloads a package',async t=>{
  const f=await feed(t);const release=await fetchLatestRelease(f.settings);assert.equal(release.assetUrl,f.base+`dsh-remote-ops-v${nextVersion}.tgz`);assert.equal(release.updateAvailable,true);
  const valid={schemaVersion:1,package:UPDATE_PACKAGE,version:nextVersion,asset:'pkg.tgz',checksum:'sum.txt'};
  for(const metadata of [[],null,{...valid,package:'other'},{...valid,schemaVersion:2},{...valid,version:'0.0.0-beta'},{...valid,asset:'https://another.invalid/pkg.tgz'},{...valid,checksum:''}]){f.raw=JSON.stringify(metadata);await assert.rejects(fetchLatestRelease(f.settings),/UPDATE_/);}
  f.raw='<html>index</html>';await assert.rejects(fetchLatestRelease(f.settings),/UPDATE_METADATA_INVALID/);assert.ok(f.requests.every(path=>path.endsWith('latest.json')));
});

test('GitHub updates require the exact stable release pair and accept signed HTTPS asset redirects',async()=>{
  const asset=`dsh-remote-ops-v${nextVersion}.tgz`,checksum=`SHA256SUMS-dsh-remote-ops-v${nextVersion}.txt`;
  const payload={tag_name:`dsh-remote-ops-v${nextVersion}`,assets:[asset,checksum].map(name=>({name,browser_download_url:`https://github.com/test/releases/${name}`}))};
  const release=await fetchLatestRelease({source:'github'},{fetchImpl:async()=>Response.json(payload)});
  assert.equal(release.latestVersion,nextVersion);assert.equal(release.assetName,asset);
  for(const invalid of [{...payload,prerelease:true},{...payload,draft:true},{...payload,assets:payload.assets.slice(0,1)}])await assert.rejects(fetchLatestRelease({source:'github'},{fetchImpl:async()=>Response.json(invalid)}),/UPDATE_/);
  const calls=[];
  const bytes=await fetchUpdateBytes(release.assetUrl,{fetchImpl:async address=>{calls.push(address);return calls.length===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/package?signature=test'}}):new Response('package');}});
  assert.equal(bytes.toString(),'package');assert.equal(calls[1],'https://release-assets.githubusercontent.com/package?signature=test');
});

test('custom redirects stay on the same origin; network requests have time and size bounds',async t=>{
  const f=await feed(t),origin=new URL(f.base).origin;f.redirect='http://another.invalid/file';
  await assert.rejects(fetchUpdateBytes(origin+'/redirect',{origin}),/UPDATE_URL_INVALID/);
  f.redirect=f.base+'latest.json';assert.ok((await fetchUpdateBytes(origin+'/redirect',{origin})).length);
  await assert.rejects(fetchUpdateBytes(f.base+'latest.json',{limit:5}),/UPDATE_TOO_LARGE/);
  f.delay=80;await assert.rejects(fetchUpdateBytes(f.base+'latest.json',{timeoutMs:10}),/UPDATE_CHECK_TIMEOUT/);
});

test('download verifies checksum and package identity before returning an install path',async t=>{
  const f=await feed(t),root=await rootFor(t),release=await fetchLatestRelease(f.settings);
  const phases=[];const result=await downloadRelease(release,root,{onPhase:p=>phases.push(p)});assert.equal(sha(await readFile(result.path)),sha(f.bytes));assert.deepEqual(phases,['downloading','verifying']);
  f.digest='0'.repeat(64);await assert.rejects(downloadRelease(release,root),/UPDATE_CHECKSUM_MISMATCH/);delete f.digest;
  for(const bytes of [Buffer.from('broken'),tarball('99.0.0'),tarball(nextVersion,{name:'other-package'}),tarball(nextVersion,{dsh:{}})]){f.bytes=bytes;await assert.rejects(downloadRelease(release,root),/UPDATE_PACKAGE_INVALID/);}
});

test('checksum requires exactly one matching filename',()=>{
  const digest='a'.repeat(64);assert.equal(expectedChecksum(`${digest.toUpperCase()} *plugin.tgz\r\n`,'plugin.tgz'),digest);
  for(const text of [`${digest} other.tgz`,`${digest} plugin.tgz\n${digest} plugin.tgz`,'bad plugin.tgz'])assert.throws(()=>expectedChecksum(text,'plugin.tgz'),/UPDATE_CHECKSUM_INVALID/);
});

test('local status performs no update fetch; manual checks bypass cached latest results',async t=>{
  const f=await feed(t),{state}=await stateFor(t,f);await state.updateStatus();assert.equal(f.requests.length,0);
  await state.checkForUpdate(true);await state.checkForUpdate(true);assert.equal(f.requests.length,2);
  await state.checkForUpdate(false);assert.equal(f.requests.length,2);
  f.version='0.0.1';assert.equal((await state.checkForUpdate(true)).updateAvailable,false);
});

test('one click installs one verified local tgz through DSH and preserves pending restart state',async t=>{
  const f=await feed(t),{state,installs}=await stateFor(t,f);f.delay=20;
  const task=state.upgrade();assert.equal(state.upgrade(),task);await assert.rejects(state.saveUpdateSettings({source:'github'}),/UPDATE_BUSY/);
  await assert.rejects(state.checkForUpdate(true),/UPDATE_BUSY/);
  const result=await task;assert.equal(result.currentVersion,PLUGIN_VERSION);assert.equal(result.installedVersion,nextVersion);assert.equal(result.restartRequired,true);assert.equal(result.busy,false);assert.equal(installs.length,1);assert.ok(installs[0].options.requestId);
  const count=f.requests.length;await state.upgrade();await state.updateStatus();assert.equal(installs.length,1);assert.equal(f.requests.length,count);
});

test('current or older release never installs; bad packages never invoke DSH manager',async t=>{
  const f=await feed(t),{state,installs}=await stateFor(t,f);
  f.version=PLUGIN_VERSION;assert.equal((await state.upgrade()).updated,false);f.version='0.0.1';assert.equal((await state.upgrade()).updated,false);assert.equal(installs.length,0);
  f.version=nextVersion;f.digest='0'.repeat(64);await assert.rejects(state.upgrade(),/UPDATE_CHECKSUM_MISMATCH/);assert.equal(installs.length,0);assert.equal((await state.updateStatus()).phase,'failed');
});

test('DSH failures are reported without automatic retries, approvals or hot reload',async t=>{
  const f=await feed(t),{state}=await stateFor(t,f);let calls=0;
  state.updateManager.installBundle=async()=>{calls++;return {application:'failed',packageResult:{exitCode:1,kind:'network',logPath:'test.log'}};};
  await assert.rejects(state.upgrade(),/UPDATE_INSTALL_FAILED/);const status=await state.updateStatus();assert.equal(status.restartRequired,false);assert.equal(status.busy,false);assert.equal(calls,1);
  state.updateManager.installBundle=async()=>({application:'failed',pendingBuilds:['native-addon']});await assert.rejects(state.upgrade(),/等待批准/);
  state.updateManager.installBundle=async()=>({application:'restart-required'});await assert.rejects(state.upgrade(),/UPDATE_INSTALL_UNVERIFIED/);
});

test('unavailable manager and non-profile bundles fail safely; interrupted downloads cannot install',async t=>{
  const f=await feed(t),{state,installs}=await stateFor(t,f),manager=state.updateManager;
  state.updateManager=undefined;await assert.rejects(state.upgrade(),/UPDATE_MANAGER_UNAVAILABLE/);
  state.updateManager={...manager,listBundles:async()=>[]};await assert.rejects(state.upgrade(),/UPDATE_PROFILE_NOT_FOUND/);
  state.updateManager=manager;state.updateDownloadAbort.abort();await assert.rejects(state.upgrade(),/UPDATE_CANCELLED/);assert.equal(installs.length,0);
});

test('generator validates release pair and publishes portable relative paths without changing an existing manifest on failure',async t=>{
  const root=await rootFor(t),folder=join(root,nextVersion);await mkdir(folder);const name=`dsh-remote-ops-v${nextVersion}.tgz`,file=join(folder,name),sums=join(folder,`SHA256SUMS-dsh-remote-ops-v${nextVersion}.txt`),output=join(root,'latest.json'),bytes=tarball();
  await writeFile(file,bytes);await writeFile(sums,sha(bytes)+'  '+name+'\n');const result=await createUpdateManifest(file,output);assert.equal(result.manifest.asset,`${nextVersion}/${name}`);const before=await readFile(output,'utf8');
  await writeFile(sums,'0'.repeat(64)+'  '+name);await assert.rejects(createUpdateManifest(file,output),/SHA256 mismatch/);assert.equal(await readFile(output,'utf8'),before);
  await writeFile(sums,sha(bytes)+'  '+name);await writeFile(output,JSON.stringify({...result.manifest,version:'99.0.0'}));await assert.rejects(createUpdateManifest(file,output),/newer/);
  await assert.rejects(createUpdateManifest(file,join(folder,'nested','latest.json')),/subdirectories/);
});

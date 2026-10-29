import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('prepack validates a standalone runtime without installed dependencies and rejects extra or corrupt files',async t=>{
  const root=await mkdtemp(join(tmpdir(),'desktop-package-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const path of ['lib','scripts','desktop/runtime'])await mkdir(join(root,path),{recursive:true});
  await writeFile(join(root,'package.json'),'{"type":"module"}');
  for(const path of ['lib/desktop-runtime.js','scripts/check-desktop-runtime.mjs'])await writeFile(join(root,path),await readFile(new URL('../'+path,import.meta.url)));
  const names=['RemoteOpsDesktop.exe','RemoteOpsDesktopWorker.exe','RemoteOpsDesktop.exe.config','RemoteOpsDesktopWorker.exe.config','FlaUI.Core.dll','FlaUI.UIA3.dll','Interop.UIAutomationClient.dll','flaui.core-LICENSE.txt','flaui.uia3-LICENSE.txt','interop.uiautomationclient-LICENSE.txt'];
  const files=[];for(const name of names){const bytes=Buffer.from('integrity fixture '+name);await writeFile(join(root,'desktop/runtime',name),bytes);files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  await writeFile(join(root,'desktop/runtime/manifest.json'),JSON.stringify({protocol:1,files}));
  const check=()=>spawnSync(process.execPath,['scripts/check-desktop-runtime.mjs'],{cwd:root,encoding:'utf8'});
  const good=check();assert.equal(good.status,0,good.stderr);assert.match(good.stdout,/Desktop runtime verified/);
  await writeFile(join(root,'desktop/runtime/endpoint-1.json'),'private endpoint');
  assert.match(check().stderr,/Unexpected file in packaged desktop runtime/);
  await rm(join(root,'desktop/runtime/endpoint-1.json'));
  await writeFile(join(root,'desktop/runtime/RemoteOpsDesktop.exe'),'tampered');
  assert.match(check().stderr,/Runtime checksum mismatch/);
});

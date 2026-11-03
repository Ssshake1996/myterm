import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
function helpers(start,end,names) { const context={};vm.runInNewContext(source.slice(source.indexOf(`const ${start} =`),source.indexOf(`const ${end} =`))+`;Object.assign(globalThis,{${names.join(',')}});`,context);return context; }
const connection=helpers('environmentConnectionValues','environmentProfileFromForm',['environmentConnectionValues','environmentConnectionFromForm']);
const tabs=helpers('terminalTabStatus','terminalCloseResult',['terminalTabStatus','terminalCloseSelection']);
test('Telnet form preserves login, codec and custom port while clearing SSH-only connection fields',()=>{
  const form=connection.environmentConnectionValues({transport:'telnet',telnet:{loginMode:'password',shellPrompt:'SW> $',lineEnding:'cr'},encoding:'gb18030'});
  assert.equal(form.transport,'telnet');assert.equal(form.telnetLoginMode,'password');
  const saved=connection.environmentConnectionFromForm({...form,platform:'windows',shell:'pwsh',hostKeySha256:'stale SSH key'});
  assert.equal(saved.transport,'telnet');assert.equal(saved.shell,'server-default');assert.equal(saved.hostKeySha256,'');
  assert.equal(saved.telnet.shellPrompt,'SW> $');assert.equal(saved.telnet.lineEnding,'cr');assert.equal(saved.encoding,'gb18030');
  assert.equal(connection.environmentConnectionFromForm({...form,telnetShellPrompt:'['}).error?.includes('提示符'),true);
});
test('Telnet joins close-all and login is distinct from a ready connected terminal',()=>{
  const all=[{sessionId:'local-cmd',kind:'local'},{sessionId:'s',kind:'ssh'},{sessionId:'t',kind:'telnet',login:{state:'waiting-password'}},{sessionId:'old',kind:'telnet',disconnected:true}];
  assert.deepEqual(Array.from(tabs.terminalCloseSelection(all).targets,item=>item.sessionId),['s','t','old']);
  assert.equal(tabs.terminalTabStatus(all[2]).state,'busy');
  assert.match(tabs.terminalTabStatus({...all[2],login:{state:'manual'}}).label,/登录/);
  assert.match(tabs.terminalTabStatus({...all[2],login:{state:'ready'}}).label,/已连接/);
  assert.equal(tabs.terminalTabStatus(all[3]).state,'disconnected');
});

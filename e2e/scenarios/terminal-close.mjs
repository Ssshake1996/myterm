import assert from 'node:assert/strict';

export const terminalCloseScenario = { id: 'terminal-close', title: 'SSH 黄绿灰状态、批量关闭、取消与部分失败', async run(t) {
  const p = t.page, info = await t.info(), panel = p.locator('.dsh-remote-ops');
  const tabs = p.getByRole('tablist', { name: '终端会话' });
  const all = () => p.getByRole('button', { name: '全部关闭 SSH 标签', exact: true });
  const tool = (name, args) => p.evaluate(async ({name,args}) => {
    const response = await fetch('/e2e/agent', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({tool:name,args,timeoutMs:30000}) });
    const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
  }, {name,args});
  const state = () => p.evaluate(id => fetch('/api/dsh-remote-ops/state?sessionId=' + id).then(r=>r.json()), info.sessionId);
  const until = async fn => { for (let i=0;i<120;i++) { if (await fn()) return; await new Promise(r=>setTimeout(r,100)); } throw Error('Terminal close UI did not settle'); };
  await p.getByRole('button', {name:'Remote Ops',exact:true}).click();
  const names = ['验收环境','分页设备','提示设备'];
  const opened = [];
  for (const environment of names) {
    await panel.getByRole('button',{name:'环境管理',exact:true}).click();
    await p.getByRole('button',{name:'+ 环境',exact:true}).click();
    await p.getByLabel('显示名称',{exact:true}).fill(environment); await p.getByLabel('主机地址',{exact:true}).fill(info.device.host);
    await p.getByLabel('用户名',{exact:true}).fill(info.device.username); await p.getByLabel('端口',{exact:true}).fill(String(info.device.port));
    await p.getByLabel('SSH 密码',{exact:true}).fill('e2e-device-pass'); await p.getByRole('button',{name:'保存',exact:true}).click();
    await p.getByRole('button',{name:'返回工作区',exact:true}).click(); opened.push(await tool('remote_terminal_open', {environment}));
  }
  await until(async()=>await tabs.getByRole('tab').count()===4);
  await t.step('绿色只表示已连接，主按钮直接可见且标签栏保持一行', async()=>{
    assert.equal(await tabs.locator('[data-state=connected]').count(),4);
    assert.equal(await all().isVisible(),true); assert.equal(await all().evaluate(n=>!!n.closest('details')),false);
    assert.ok((await p.locator('.dsh-remote-ops__terminalHead').boundingBox()).height<=40);
    assert.match(await tabs.getByRole('tab',{name:names[0],exact:true}).getAttribute('aria-description'),/不代表命令已完成/);
  });
  await t.step('Agent 等待回显显示黄色，人仍可输入；取消一次确认不关闭任何连接', async()=>{
    await tabs.getByRole('tab',{name:names[0],exact:true}).click();
    await p.evaluate(id=>{ window.bulkSend=fetch('/e2e/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'remote_terminal_send',args:{session:id,text:'show version',quietMs:10000,timeoutSeconds:30},timeoutMs:30000})}).then(r=>r.json()); },opened[0].sessionId);
    await until(async()=>await tabs.getByRole('tab',{name:names[0],exact:true}).locator('[data-state=busy]').count()===1);
    assert.equal(await p.getByLabel('终端输入',{exact:true}).getAttribute('readonly'),null);
    await all().click(); assert.match(await p.getByRole('dialog').innerText(),/3 个 SSH 连接，其中 1 个正在操作/);
    await p.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
    assert.equal((await state()).sessions.filter(x=>x.kind==='ssh').length,3);
  });
  await t.step('受控部分失败保留失败标签，成功连接实际释放，CMD 与环境保持', async()=>{
    let calls=0;
    await p.route('**/api/dsh-remote-ops/action',async route=>{
      const body=route.request().postDataJSON(); if(body.action!=='close-many')return route.continue();
      calls++;
      const targets=body.sessions.filter(id=>id!==opened[2].sessionId);
      const response=await route.fetch({postData:JSON.stringify({...body,sessions:targets})});
      const value=await response.json(); value.results.push({sessionId:opened[2].sessionId,closed:false,error:'受控关闭失败'});
      await route.fulfill({response,json:value});
    });
    await all().click(); await p.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();
    await until(async()=>await tabs.getByRole('tab').count()===2);
    assert.equal(calls,1); assert.equal(await tabs.getByRole('tab',{name:names[2],exact:true}).count(),1);
    const value=await state(); assert.equal(value.sessions.filter(x=>x.kind==='ssh').length,1); assert.ok(value.sessions.some(x=>x.kind==='local')); assert.equal(value.environments.length,3);
    await p.unroute('**/api/dsh-remote-ops/action');
    await p.evaluate(()=>window.bulkSend);
    await t.shot('关闭部分失败保留对应标签');
    await all().click(); await p.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();
    await until(async()=>await tabs.getByRole('tab').count()===1);
    assert.equal(await tabs.getByRole('tab').getAttribute('aria-selected'),'true');
    await p.waitForTimeout(3500); assert.equal(await tabs.getByRole('tab').count(),1);
  });
  await t.step('灰色已断开标签保留输出，全部关闭直接清理，无二次确认', async()=>{
    const session=await tool('remote_terminal_open',{environment:names[0]});
    await until(async()=>await tabs.getByRole('tab').count()===2);
    await tool('remote_terminal_send',{session:session.sessionId,text:'exit',quietMs:100});
    await until(async()=>await tabs.locator('[data-state=disconnected]').count()===1);
    await p.setViewportSize({width:390,height:844}); await p.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});
    await p.evaluate(()=>{document.documentElement.style.colorScheme='dark';});
    assert.ok(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    const bounds=await all().boundingBox(); assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
    await t.shot('窄屏灰色已断开与全部关闭');
    await all().focus(); await p.keyboard.press('Enter');
    await until(async()=>await tabs.getByRole('tab').count()===1);
    assert.equal(await p.getByRole('dialog').count(),0); assert.equal(await all().count(),0);
    const logs=await tool('remote_terminal_logs',{}); assert.ok(JSON.stringify(logs).includes('验收环境'));
  });
}};

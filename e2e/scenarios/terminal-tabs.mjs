import assert from 'node:assert/strict';

export const terminalTabsScenario={id:'terminal-tabs',title:'CMD 与 SSH 统一标签、键盘切换和固定环境退出入口',async run(t){
  const p=t.page,info=await t.info(),panel=p.locator('.dsh-remote-ops');
  const localName=process.platform==='win32'?'本地 CMD':'本地 Shell';
  const workspace=name=>p.getByRole('tablist',{name:'Remote Ops 工作区'}).getByRole('tab',{name,exact:true});
  const sessions=()=>p.getByRole('tablist',{name:'终端会话'});
  const tab=name=>sessions().getByRole('tab',{name,exact:true});
  const tool=(name,args)=>p.evaluate(async({name,args})=>{const r=await fetch('/e2e/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:name,args})});const value=await r.json();if(!r.ok)throw Error(value.error);return value;},{name,args});
  const state=()=>p.evaluate(id=>fetch('/api/dsh-remote-ops/state?sessionId='+id).then(r=>r.json()),info.sessionId);
  const until=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('Terminal tabs did not settle');};
  await p.getByRole('button',{name:'Remote Ops',exact:true}).click();await p.getByLabel('终端输出',{exact:true}).waitFor();
  await t.step('本地 CMD 从单终端开始就使用同一标签栏',async()=>{
    assert.equal(await sessions().count(),1);
    assert.equal(await tab(localName).getAttribute('aria-selected'),'true');
    const control=await tab(localName).getAttribute('aria-controls');
    assert.equal(await p.locator('[id="'+control+'"]').getAttribute('role'),'tabpanel');
  });
  await t.step('标签与常用按钮同一行，输出紧邻其下且日志无需展开菜单',async()=>{
    const header=p.locator('.dsh-remote-ops__terminalHead');
    const row=await header.boundingBox(),label=await tab(localName).boundingBox(),output=await p.locator('.dsh-remote-ops__screen').boundingBox();
    assert.ok(row.height<=40,'terminal chrome must fit a single compact row');
    assert.ok(label.y>=row.y&&label.y+label.height<=row.y+row.height+1,'session tab shares the action row');
    assert.ok(output.y-row.y-row.height<=2,'no separate context or operation row above terminal output');
    for(const name of ['搜索输出','导出当前终端 TXT']){
      const button=p.getByRole('button',{name,exact:true});assert.equal(await button.isVisible(),true);
      assert.equal(await button.evaluate(n=>n.closest('details')===null),true);
    }
    assert.equal(await p.getByRole('button',{name:'复制输出',exact:true}).count(),0);
    const more=p.getByLabel('终端操作',{exact:true});assert.match(await more.innerText(),/更多/);
    assert.equal(await p.getByRole('button',{name:'一键打包本会话全部日志',exact:true}).isVisible(),false);
    await more.click();assert.equal(await p.getByRole('button',{name:'一键打包本会话全部日志',exact:true}).isVisible(),true);
    assert.equal(await header.getByLabel('终端大小',{exact:true}).count(),0);await more.click();
    assert.ok((await p.locator('.dsh-remote-ops__terminalStatus').innerText()).includes((await state()).sessions.find(s=>s.kind==='local').workingDirectory));
  });
  const opened=[];
  await t.step('实际连接三个 SSH 终端，样式一致且切换显示对应输出',async()=>{
    await tool('remote_terminal_send',{session:'local-cmd',text:'echo LOCAL_TAB_OUTPUT',quietMs:100});
    for(const name of ['开发环境','测试环境','验收环境']){
      await panel.getByRole('button',{name:'环境管理',exact:true}).click();await p.getByRole('button',{name:'+ 环境',exact:true}).click();
      await p.getByLabel('显示名称',{exact:true}).fill(name);await p.getByLabel('主机地址',{exact:true}).fill(info.device.host);
      await p.getByLabel('用户名',{exact:true}).fill(info.device.username);await p.getByLabel('端口',{exact:true}).fill(String(info.device.port));
      await p.getByLabel('SSH 密码',{exact:true}).fill('e2e-device-pass');await p.getByRole('button',{name:'保存',exact:true}).click();
      await p.getByRole('button',{name:'返回工作区',exact:true}).click();opened.push(await tool('remote_terminal_open',{environment:name}));await tab(name).waitFor();
    }
    await tab('开发环境').click();await tool('remote_terminal_send',{session:opened[0].sessionId,text:'show version',quietMs:100});
    await until(async()=>/Array OS 1.2.3/.test(await p.getByLabel('终端输出',{exact:true}).innerText()));
    await tab(localName).click();await until(async()=>/LOCAL_TAB_OUTPUT/.test(await p.getByLabel('终端输出',{exact:true}).innerText()));
    assert.doesNotMatch(await p.getByLabel('终端输出',{exact:true}).innerText(),/Array OS 1.2.3/);
    const styles=await sessions().getByRole('tab').evaluateAll(nodes=>nodes.map(n=>({font:getComputedStyle(n).fontSize,height:n.getBoundingClientRect().height,selected:n.getAttribute('aria-selected')})));
    assert.equal(new Set(styles.map(s=>s.font)).size,1);assert.ok(styles.every(s=>s.height>=28&&s.height<=34));assert.equal(styles.filter(s=>s.selected==='true').length,1);
    await t.shot('统一的 CMD 和 SSH 标签');
  });
  await t.step('窄栏键盘切换滚动到所选标签，关闭连接仍需原有确认',async()=>{
    await tab('验收环境').click();
    await p.setViewportSize({width:390,height:844});await p.emulateMedia({reducedMotion:'reduce'});
    await until(()=>tab('验收环境').evaluate(n=>{const r=n.getBoundingClientRect(),b=n.closest('[role=tablist]').getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1;}));
    await tab(localName).focus();await p.keyboard.press('End');
    assert.equal(await tab('验收环境').getAttribute('aria-selected'),'true');assert.equal(await tab('验收环境').evaluate(n=>n===document.activeElement),true);
    await until(()=>tab('验收环境').evaluate(n=>{const r=n.getBoundingClientRect(),b=n.closest('[role=tablist]').getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1;}));
    assert.ok(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    const header=await p.locator('.dsh-remote-ops__terminalHead').boundingBox();assert.ok(header.height<=40);
    for(const name of ['搜索输出','导出当前终端 TXT']){
      const bounds=await p.getByRole('button',{name,exact:true}).boundingBox();assert.ok(bounds.x>=header.x&&bounds.x+bounds.width<=header.x+header.width+1);
    }
    await t.shot('窄栏的活动标签');
    await p.getByRole('button',{name:'释放验收环境',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
    assert.equal((await state()).sessions.filter(s=>s.kind==='ssh').length,3);
  });
  await t.step('环境表单左上角返回入口固定可见，返回原终端并恢复焦点',async()=>{
    await panel.getByRole('button',{name:'环境管理',exact:true}).click();await p.getByRole('button',{name:'+ 环境',exact:true}).click();
    const close=p.getByRole('button',{name:'返回工作区',exact:true});assert.equal((await close.innerText()).trim(),'返回工作区');
    assert.ok(await close.evaluate(n=>{const r=n.getBoundingClientRect(),head=n.parentElement.getBoundingClientRect();return n===n.parentElement.firstElementChild&&r.left-head.left<=16;}),'return action occupies the left edge of the environment header');
    const before=await close.boundingBox();await p.getByRole('button',{name:'保存',exact:true}).scrollIntoViewIfNeeded();const after=await close.boundingBox();
    assert.ok(Math.abs(before.y-after.y)<1);assert.ok(after.height>=36);assert.ok(after.y>=0&&after.y+after.height<844);
    await t.shot('环境页左上角返回入口');await close.click();
    assert.equal(await tab('验收环境').getAttribute('aria-selected'),'true');assert.equal((await state()).sessions.filter(s=>s.kind==='ssh').length,3);
    assert.equal(await panel.getByRole('button',{name:'环境管理',exact:true}).evaluate(n=>n===document.activeElement),true);
  });
  await t.step('网页草稿往返保留，深色标签具有清晰的选中状态',async()=>{
    await workspace('网页').click();await p.getByLabel('网页地址',{exact:true}).fill('https://example.test/unsent');
    await panel.getByRole('button',{name:'环境管理',exact:true}).click();await p.getByRole('button',{name:'返回工作区',exact:true}).click();
    assert.equal(await p.getByLabel('网页地址',{exact:true}).inputValue(),'https://example.test/unsent');
    await workspace('终端').click();await p.emulateMedia({colorScheme:'dark'});await p.evaluate(()=>{document.documentElement.style.colorScheme='dark';});
    assert.equal(await tab('验收环境').getAttribute('aria-selected'),'true');await t.shot('深色终端标签');
  });
  await t.step('API 环境共用左上角返回入口，返回后保留请求草稿',async()=>{
    await tool('remote_api_environment_save',{name:'API tabs fixture',baseUrl:info.website.url,auth:{mode:'none'}});
    await workspace('API').click();await p.getByLabel('API 请求路径',{exact:true}).fill('unsent-request');
    await panel.getByRole('button',{name:'环境管理',exact:true}).click();
    assert.equal(await p.getByRole('tablist',{name:'环境类型'}).getByRole('tab',{name:'API',exact:true}).getAttribute('aria-selected'),'true');
    const close=p.getByRole('button',{name:'返回工作区',exact:true});assert.equal((await close.innerText()).trim(),'返回工作区');
    assert.ok(await close.evaluate(n=>n===n.parentElement.firstElementChild));
    await t.shot('API 环境左上角返回入口');await close.click();
    assert.equal(await p.getByLabel('API 请求路径',{exact:true}).inputValue(),'unsent-request');
  });
}};

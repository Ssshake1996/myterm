import assert from 'node:assert/strict';

export const visualRefreshScenario = { id: 'visual-refresh', title: '视觉工作区、密度恢复、网页显示确认与文件操作', async run(t) {
  const p=t.page, info=await t.info();
  const tab=name=>p.getByRole('tablist',{name:'Remote Ops 工作区'}).getByRole('tab',{name,exact:true});
  const snapshot=()=>p.evaluate(id=>fetch('/api/dsh-remote-ops/browser?sessionId='+id).then(r=>r.json()),info.sessionId);
  const until=async read=>{for(let n=0;n<150;n++){if(await read())return;await new Promise(r=>setTimeout(r,100));}throw Error('visual workspace did not settle');};
  await p.getByRole('button',{name:'Remote Ops',exact:true}).click();
  await p.getByLabel('终端输出',{exact:true}).waitFor();
  await t.step('单终端使用统一标签，操作与地址位于下方上下文行',async()=>{
    assert.equal(await p.locator('.dsh-remote-ops__head').innerText().then(v=>/v\d+\.\d+/.test(v)),false);
    assert.equal(await p.getByRole('tablist',{name:'终端会话'}).getByRole('tab',{name:'本地 CMD',exact:true}).isVisible(),true);
    const context=await p.locator('.dsh-remote-ops__terminalHead').boundingBox();
    const command=await p.getByLabel('终端操作',{exact:true}).boundingBox();
    assert.ok(command.y>=context.y && command.y+command.height<=context.y+context.height+1,'terminal tools share its context row');
  });
  await t.step('密度设置在刷新后保留，恢复舒适密度',async()=>{
    await p.getByLabel('设置',{exact:true}).click();await p.getByRole('tablist',{name:'设置分类'}).getByRole('tab',{name:'通用',exact:true}).click();
    await p.getByLabel('界面密度',{exact:true}).selectOption('compact');
    assert.equal(await p.locator('.dsh-remote-ops').getAttribute('data-density'),'compact');
    await p.reload();await p.locator('html[data-e2e-ready=true]').waitFor();await p.getByRole('button',{name:'Remote Ops',exact:true}).click();
    assert.equal(await p.locator('.dsh-remote-ops').getAttribute('data-density'),'compact');
    await p.getByLabel('设置',{exact:true}).click();await p.getByRole('tablist',{name:'设置分类'}).getByRole('tab',{name:'通用',exact:true}).click();await p.getByLabel('界面密度',{exact:true}).selectOption('comfortable');await p.getByRole('button',{name:'返回工作区',exact:true}).click();
  });
  await t.step('网页设置按需显示，关闭后保留地址草稿',async()=>{
    await tab('网页').click();await p.getByLabel('网页地址',{exact:true}).fill(info.website.url+'/manual');
    assert.equal(await p.getByLabel('浏览器引擎',{exact:true}).isVisible(),false);
    await p.getByRole('button',{name:'设置',exact:true}).click();
    await p.getByLabel('浏览器引擎',{exact:true}).selectOption('chrome');
    await p.getByLabel('独立窗口浏览器',{exact:true}).selectOption('chrome');
    await p.getByRole('button',{name:'返回工作区',exact:true}).click();
    assert.equal(await p.getByLabel('网页地址',{exact:true}).inputValue(),info.website.url+'/manual');
    await p.getByRole('button',{name:'打开网页',exact:true}).click();await p.getByAltText('网页实时画面',{exact:true}).waitFor();
  });
  await t.step('显示方式先确认，取消不重载、不关闭网页',async()=>{
    const before=(await snapshot()).sessions.find(s=>!s.closed);
    let displayRequests=0;
    const track=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/dsh-remote-ops/browser'&&request.postDataJSON()?.action==='display')displayRequests++;};
    p.on('request',track);
    await p.getByLabel('网页显示方式',{exact:true}).selectOption('window');
    const dialog=p.getByRole('dialog',{name:'切换网页显示',exact:true});await dialog.waitFor();
    assert.match(await dialog.innerText(),/未提交/);
    assert.equal((await snapshot()).sessions.find(s=>s.id===before.id).display,'embedded');
    await dialog.getByRole('button',{name:'取消',exact:true}).click();
    const after=(await snapshot()).sessions.find(s=>s.id===before.id);
    assert.equal(after.display,before.display);assert.equal(after.activePageId,before.activePageId);assert.equal(after.closed,false);
    assert.equal(displayRequests,0);p.off('request',track);
    assert.equal(await p.getByLabel('网页显示方式',{exact:true}).inputValue(),'embedded');
  });
  await t.step('窄侧栏的网页内容保有可用高度，所有模块无横向溢出',async()=>{
    await p.setViewportSize({width:390,height:844});
    for(const name of ['网页','终端','文件']){await tab(name).click();assert.ok(await p.locator('.dsh-remote-ops').evaluate(n=>n.scrollWidth-n.clientWidth)<=1);}
    await tab('网页').click();await p.getByAltText('网页实时画面',{exact:true}).waitFor();
    assert.ok((await p.locator('.dsh-remote-ops__liveSurface').boundingBox()).height>=360);
    await until(async()=>{const state=await snapshot(),session=state.sessions.find(s=>!s.closed),surface=await p.locator('.dsh-remote-ops__liveSurface').boundingBox();return Math.abs(session.viewport.width-surface.width)<=2&&Number(await p.getByAltText('网页实时画面',{exact:true}).getAttribute('data-revision'))===session.revision;});
    await t.shot('390px 网页');
  });
  await t.step('选中文件在悬停时保留高亮，选择后显示批量操作',async()=>{
    await p.emulateMedia({reducedMotion:'reduce'});
    await p.route('**/api/dsh-remote-ops/workspace',async route=>{
      if(route.request().postDataJSON()?.action==='files')return route.fulfill({json:{path:'/visual',entries:[{name:'selected.txt',type:'-',size:1},{name:'other.txt',type:'-',size:1}]}});
      return route.continue();
    });
    await tab('文件').click();await p.getByLabel('路径 A',{exact:true}).fill('/visual');await p.getByLabel('路径 A',{exact:true}).press('Enter');
    const check=p.getByLabel('文件来源 A',{exact:true}).getByLabel('选择 selected.txt',{exact:true});await check.waitFor();
    assert.equal(await p.locator('.dsh-remote-ops__fileActions').isVisible(),false);await check.check();
    assert.equal(await p.locator('.dsh-remote-ops__fileActions').isVisible(),true);
    const selected=p.locator('.dsh-remote-ops__sftpEntry').filter({has:p.getByLabel('选择 selected.txt',{exact:true})}).first();await selected.hover();
    const selectedColor=await selected.evaluate(n=>getComputedStyle(n).backgroundColor);
    const other=p.locator('.dsh-remote-ops__sftpEntry').filter({has:p.getByLabel('选择 other.txt',{exact:true})}).first();await other.hover();
    assert.notEqual(selectedColor,await other.evaluate(n=>getComputedStyle(n).backgroundColor),'hover must distinguish a selected row');
    await check.uncheck();assert.equal(await p.locator('.dsh-remote-ops__fileActions').isVisible(),false);
  });
}};

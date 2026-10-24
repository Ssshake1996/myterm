import assert from 'node:assert/strict';
import {createServer} from 'node:http';
export const requestErrorsScenario={id:'request-errors',title:'状态刷新与更新失败的来源、脱敏和恢复',expectedHttp:[{status:404,path:'/api/dsh-remote-ops/state',method:'GET'},{status:400,path:'/api/dsh-remote-ops/update',method:'POST',action:'check',code:'UPDATE_DOWNLOAD_FAILED'}],async run(t){
  const p=t.page;await p.getByRole('button',{name:'Remote Ops',exact:true}).click();await p.getByLabel('终端输入',{exact:true}).waitFor();
  const stateRoute=url=>new URL(url).pathname==='/api/dsh-remote-ops/state';
  const globalAlert=()=>p.locator('.dsh-remote-ops__error[role=alert]');
  await t.step('状态接口 404 显示来源、方法、地址和响应摘要，恢复后清除自身错误',async()=>{
    await p.route(stateRoute,route=>route.fulfill({status:404,contentType:'text/plain',body:'Not Found'}));
    try{
      await globalAlert().getByText('状态刷新失败',{exact:true}).waitFor();await globalAlert().getByText('错误详情',{exact:true}).click();
      const text=await globalAlert().innerText();assert.match(text,/请求：GET http.*\/api\/dsh-remote-ops\/state/);assert.match(text,/HTTP 404/);assert.match(text,/Not Found/);assert.doesNotMatch(text,/插件更新失败/);
      await globalAlert().getByRole('button',{name:'刷新状态',exact:true}).click();await p.getByText('刷新失败',{exact:true}).waitFor();await t.shot('state-404-details');
      await globalAlert().getByRole('button',{name:'关闭错误',exact:true}).click();await p.waitForTimeout(7000);assert.equal(await globalAlert().count(),0);
      await p.reload();await p.locator('html[data-e2e-ready=true]').waitFor();await p.getByRole('button',{name:'Remote Ops',exact:true}).click();await p.waitForTimeout(3500);assert.equal(await globalAlert().count(),0);
      await p.getByLabel('设置',{exact:true}).click();await p.getByRole('tablist',{name:'设置分类'}).getByRole('tab',{name:'通用',exact:true}).click();await p.getByRole('button',{name:'刷新状态',exact:true}).click();await globalAlert().getByText('状态刷新失败',{exact:true}).waitFor();
    }finally{await p.unroute(stateRoute);}
    await globalAlert().getByRole('button',{name:'刷新状态',exact:true}).click();await globalAlert().waitFor({state:'hidden'});
    await p.getByRole('button',{name:'返回工作区',exact:true}).click();
  });
  let requests=0;
  const server=createServer((_req,res)=>{requests++;res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not Found\nAuthorization: Bearer fixture-secret\nCookie: sid=fixture-cookie');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const address=`http://127.0.0.1:${server.address().port}/missing/latest.json`;
  const panel=()=>p.getByRole('region',{name:'插件更新',exact:true});
  const open=async()=>{await p.getByLabel('设置',{exact:true}).click();await p.getByRole('tablist',{name:'设置分类'}).getByRole('tab',{name:'更新',exact:true}).click();await panel().getByLabel('更新来源',{exact:true}).waitFor();};
  try{
    await t.step('真实更新源 404 与工作区刷新分离，重开设置保留失败详情',async()=>{
      await open();await panel().getByLabel('更新来源',{exact:true}).selectOption('custom');await panel().getByLabel('内网更新地址',{exact:true}).fill(address);await panel().getByRole('button',{name:'保存更新来源',exact:true}).click();await panel().getByText('更新来源已保存',{exact:true}).waitFor();assert.equal(requests,0);
      await panel().getByRole('button',{name:'仅检查版本',exact:true}).click();await panel().getByRole('alert').getByText('插件更新失败',{exact:true}).waitFor();await panel().getByRole('alert').getByText('错误详情',{exact:true}).click();
      const text=await panel().getByRole('alert').innerText();assert.ok(text.includes(address));assert.match(text,/读取版本清单/);assert.match(text,/HTTP 404/);assert.match(text,/插件接口.*HTTP 400/);assert.doesNotMatch(text,/fixture-secret|fixture-cookie/);assert.equal(requests,1);assert.equal(await globalAlert().count(),0);
      await t.shot('update-404-details');await p.getByRole('button',{name:'返回工作区',exact:true}).click();await open();assert.match(await panel().getByRole('alert').textContent(),/读取版本清单/);assert.equal(requests,1);
      await p.setViewportSize({width:390,height:844});assert.ok(await panel().evaluate(n=>n.scrollWidth<=n.clientWidth+1));await t.shot('update-404-narrow');
    });
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}};

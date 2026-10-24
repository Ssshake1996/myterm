import assert from 'node:assert/strict';
import {startApi} from '../harness/fake-api.mjs';
export const apiScenario={id:'api-workspace',title:'API 环境、登录、Agent 请求与页面切换',async run(t){
  const target=await startApi(),p=t.page;
  const agent=(tool,args={})=>p.evaluate(async({tool,args})=>{const response=await fetch('/e2e/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool,args})});return {status:response.status,data:await response.json()};},{tool,args});
  try {
    await t.step('API 独立环境通过 UI 保存到凭据服务',async()=>{
      await p.getByRole('button',{name:'Remote Ops',exact:true}).click();await p.getByRole('tab',{name:'API',exact:true}).click();
      await p.getByRole('button',{name:'新建 API 环境',exact:true}).click();
      await p.getByLabel('API 环境名称',{exact:true}).fill('API e2e');await p.getByLabel('Base URL',{exact:true}).fill(target.url);
      await p.getByLabel('API 用户名',{exact:true}).fill('tester');await p.getByLabel('API 密码',{exact:true}).fill('api-fixture-password');await p.getByLabel('Token JSON Pointer',{exact:true}).fill('/data/token');
      await p.getByRole('button',{name:'保存 API 环境',exact:true}).click();await p.getByRole('button',{name:'返回工作区',exact:true}).click();await p.getByRole('button',{name:'登录',exact:true}).waitFor();
    });
    let environment;
    await t.step('真实工具与 UI 共享 Token 登录和响应，敏感值不显示',async()=>{
      const listed=await agent('remote_api_environment_list');assert.equal(listed.status,200);environment=listed.data.environments[0].id;
      assert.equal((await agent('remote_api_login',{environment,requestId:'agent-login'})).data.state,'completed');
      const sent=await agent('remote_api_request',{environment,requestId:'agent-request',path:'items'});assert.equal(sent.data.httpStatus,200);
      await p.getByRole('tab',{name:'记录',exact:true}).click();await p.getByRole('button').filter({hasText:'items'}).first().click();await p.getByLabel('响应格式').selectOption('raw');await p.getByLabel('API 响应详情').getByText('device-01',{exact:false}).waitFor();
      assert.ok(!(await p.getByLabel('API 工作区').innerText()).includes('fixture-token'));
      await p.getByLabel('API 请求路径',{exact:true}).fill('items');await p.getByRole('button',{name:'发送请求',exact:true}).click();
      await p.getByLabel('API 响应详情').getByText('device-01',{exact:false}).waitFor();
    });
    await t.step('切换工作区不取消后台 API 请求，草稿保留',async()=>{
      await p.getByLabel('API 请求路径',{exact:true}).fill('slow');await p.getByRole('button',{name:'发送请求',exact:true}).click();
      await p.getByRole('tab',{name:'终端',exact:true}).click();await p.getByRole('tab',{name:'API',exact:true}).click();
      assert.equal(await p.getByLabel('API 请求路径',{exact:true}).inputValue(),'slow');
      await p.getByRole('tab',{name:'记录',exact:true}).click();await p.getByRole('button').filter({hasText:/slow.*200/s}).first().waitFor();assert.equal(target.calls.filter(c=>c.path==='/api/slow').length,1);
    });
    await t.step('Cookie 登录、CSRF 与多环境记录导出',async()=>{
      const ref=(await agent('remote_api_environment_list')).data.environments[0].auth.passwordRef;
      const saved=(await agent('remote_api_environment_save',{name:'Cookie API',baseUrl:target.url,auth:{mode:'cookie',username:'tester',passwordRef:ref,loginPath:'cookie-login',bodyFormat:'form',cookieName:'session',csrfCookie:'csrf'}})).data.environment;
      assert.equal((await agent('remote_api_login',{environment:saved.id,requestId:'cookie-login'})).data.state,'completed');
      assert.equal((await agent('remote_api_request',{environment:saved.id,requestId:'cookie-request',method:'POST',path:'items',body:{inspect:true}})).data.response.body.csrf,true);
      await p.getByRole('tab',{name:'记录',exact:true}).click();const download=p.waitForEvent('download');await p.getByRole('button',{name:'导出记录',exact:true}).click();assert.equal((await download).suggestedFilename(),'remote-ops-api-records.json');
    });
    await t.step('窄栏布局与 API 标签恢复',async()=>{
      await p.setViewportSize({width:390,height:780});await p.reload();await p.getByRole('button',{name:'Remote Ops',exact:true}).click();await p.getByLabel('API 工作区').waitFor();
      const overflow=await p.locator('.dsh-remote-ops').evaluate(node=>node.scrollWidth-node.clientWidth);assert.ok(overflow<=1);await t.shot('API 窄栏');
    });
  }finally{await target.close();}
}};

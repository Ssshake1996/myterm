import assert from 'node:assert/strict';
import {createServer} from 'node:http';
export const updateScenario={id:'plugin-updates',title:'手动更新源设置、检查与页面恢复',async run(t){
  const p=t.page,info=await t.info();let reads=0;
  const manifest={schemaVersion:1,package:'@dsh/remote-ops',version:info.pluginVersion,asset:`dsh-remote-ops-v${info.pluginVersion}.tgz`,checksum:`SHA256SUMS-dsh-remote-ops-v${info.pluginVersion}.txt`};
  const server=createServer((req,res)=>{reads++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(manifest));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/feed/`;
  const dialog=()=>p.getByRole('region',{name:'插件更新',exact:true});
  const open=async()=>{await p.getByLabel('设置',{exact:true}).click();await p.getByRole('tablist',{name:'设置分类'}).getByRole('tab',{name:'更新',exact:true}).click();await dialog().getByLabel('更新来源',{exact:true}).waitFor();};
  try {
    await t.step('打开与保存更新地址不触发外部检查',async()=>{
      await p.getByRole('button',{name:'Remote Ops',exact:true}).click();await open();assert.equal(reads,0);
      assert.deepEqual(await dialog().getByLabel('更新来源',{exact:true}).locator('option').evaluateAll(nodes=>nodes.map(n=>n.value)),['github','custom']);
      await dialog().getByLabel('更新来源',{exact:true}).selectOption('custom');await dialog().getByLabel('内网更新地址',{exact:true}).fill(url);assert.equal(await dialog().getByRole('button',{name:'仅检查版本',exact:true}).isEnabled(),false);
      await dialog().getByRole('button',{name:'保存更新来源',exact:true}).click();await dialog().getByText('更新来源已保存',{exact:true}).waitFor();assert.equal(reads,0);
      await dialog().getByRole('button',{name:'仅检查版本',exact:true}).click();await dialog().getByText(`当前已是最新版本 v${info.pluginVersion}`,{exact:true}).waitFor();assert.equal(reads,1);
    });
    await t.step('关闭重新打开保留 HTTP 来源，不自动检查版本',async()=>{
      await p.getByRole('button',{name:'返回工作区',exact:true}).click();await open();assert.equal(await dialog().getByLabel('内网更新地址',{exact:true}).inputValue(),url+'latest.json');assert.equal(reads,1);
    });
    await t.step('暗色窄屏 HTTP 更新窗口可用',async()=>{
      await p.emulateMedia({colorScheme:'dark'});await p.setViewportSize({width:390,height:844});assert.ok(await dialog().evaluate(n=>n.scrollWidth-n.clientWidth<=1));await t.shot('update-sources-narrow');
      await p.getByRole('button',{name:'返回工作区',exact:true}).click();await p.getByLabel('终端输入',{exact:true}).waitFor();
    });
    await t.step('安装期间关闭与重新加载前端后恢复进度，只派发一次安装',async()=>{
      await p.setViewportSize({width:1280,height:800});
      let installs=0,finish;
      let status={settings:{source:'github',url:''},currentVersion:info.pluginVersion,installedVersion:info.pluginVersion,busy:false,canInstall:true,phase:'idle',restartRequired:false};
      const complete=new Promise(resolve=>{finish=resolve;});
      await p.route('**/api/dsh-remote-ops/update',async route=>{
        if(route.request().method()==='POST') { assert.equal(route.request().postDataJSON().action,'install');installs++;status={...status,busy:true,phase:'installing'};await complete; }
        await route.fulfill({json:status}).catch(()=>{});
      });
      try {
        await open();await dialog().getByRole('button',{name:'检查并更新',exact:true}).click();
        await p.getByRole('button',{name:'返回工作区',exact:true}).click();await open();
        await dialog().getByText('正在安装，请稍候…',{exact:true}).waitFor();
        await p.reload();await p.locator('html[data-e2e-ready=true]').waitFor();await p.getByRole('button',{name:'Remote Ops',exact:true}).click();
        await dialog().getByText('正在安装，请稍候…',{exact:true}).waitFor();
        status={...status,busy:false,phase:'ready',installedVersion:'99.0.0',restartRequired:true};finish();
        await dialog().getByText('新版已安装，请手动重启 DSH 并刷新网页。',{exact:true}).waitFor();
        assert.equal(installs,1);assert.equal(await dialog().getByRole('button',{name:'检查并更新',exact:true}).isEnabled(),false);
        await p.getByRole('button',{name:'返回工作区',exact:true}).click();
        await p.reload();await p.locator('html[data-e2e-ready=true]').waitFor();await p.getByRole('button',{name:'Remote Ops',exact:true}).click();assert.equal(await dialog().isVisible(),false);
      } finally { finish();await p.unroute('**/api/dsh-remote-ops/update'); }
    });
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}};

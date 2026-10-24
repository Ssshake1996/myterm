import assert from "node:assert/strict";

export const windowsEnvironmentScenario = { id: "windows-environment", title: "Windows SSH 环境表单、诊断失败与窄屏布局", async run(t) {
  const p=t.page;
  await p.getByRole("button", {name:"Remote Ops",exact:true}).click();
  await p.getByRole("button", {name:"环境管理",exact:true}).click();
  await p.getByRole("button", {name:"+ 环境",exact:true}).click();
  await t.step("Windows Shell 和连接字段通过真实保存接口持久化", async()=>{
    await p.getByLabel("显示名称",{exact:true}).fill("Windows 演示环境");
    await p.getByLabel("主机地址",{exact:true}).fill("127.0.0.1");
    await p.getByLabel("端口",{exact:true}).fill("1");
    await p.getByLabel("用户名",{exact:true}).fill("HOST\\operator");
    await p.getByLabel("目标系统",{exact:true}).selectOption("windows");
    await p.getByLabel("SSH Shell",{exact:true}).selectOption("windows-powershell");
    await p.getByText("连接、编码与主机指纹",{exact:true}).click();
    await p.getByLabel("连接超时（毫秒）",{exact:true}).fill("1000");
    await p.getByLabel("默认 Shell 输入 / 输出编码",{exact:true}).selectOption("gb18030");
    await t.shot("Windows 环境表单");
    await p.getByRole("button",{name:"保存",exact:true}).click();
    await p.getByRole("button",{name:"测试 Windows 演示环境 连接",exact:true}).waitFor();
    const state=await p.evaluate(()=>fetch('/api/dsh-remote-ops/state').then(r=>r.json()));
    const value=state.environments.find(x=>x.name==='Windows 演示环境');
    assert.equal(value.platform,'windows');assert.equal(value.shell,'windows-powershell');assert.equal(value.encoding,'gb18030');assert.equal(value.readyTimeoutMs,1000);
  });
  await t.step("诊断报告实际连接失败，不显示虚假的系统或成功状态",async()=>{
    await p.getByRole('button',{name:'测试 Windows 演示环境 连接',exact:true}).click();
    const report=p.getByLabel('SSH 连接诊断',{exact:true});await report.waitFor();
    const text=await report.innerText();assert.match(text,/部分能力未通过/);assert.match(text,/ECONNREFUSED|timed out/i);
    assert.doesNotMatch(text,/检测通过/);await t.shot('连接失败阶段');
    await p.getByRole('button',{name:'收起诊断',exact:true}).click();
  });
  await t.step("390px 编辑表单保留返回按钮且系统切换恢复默认 Shell",async()=>{
    await p.setViewportSize({width:390,height:844});
    await p.locator('.dsh-remote-ops__env').filter({hasText:'Windows 演示环境'}).getByRole('button',{name:'编辑',exact:true}).click();
    assert.equal(await p.getByLabel('SSH Shell',{exact:true}).inputValue(),'windows-powershell');
    await p.getByLabel('目标系统',{exact:true}).selectOption('posix');
    assert.equal(await p.getByLabel('SSH Shell',{exact:true}).inputValue(),'server-default');
    assert.equal(await p.getByLabel('SSH Shell',{exact:true}).isDisabled(),true);
    const back=p.getByRole('button',{name:'返回工作区',exact:true});assert.equal(await back.isVisible(),true);
    assert.ok(await p.locator('.dsh-remote-ops').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    await t.shot('窄屏 Windows 表单');await back.click();
  });
} };

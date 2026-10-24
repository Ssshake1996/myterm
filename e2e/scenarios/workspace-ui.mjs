import assert from "node:assert/strict";

export const workspaceUiScenario={id:"workspace-ui",title:"工作区恢复、弹窗键盘、后台独立命令、文件批选与大量目录",async run(t){
  const p=t.page,info=await t.info();
  const workspace=body=>p.evaluate(async body=>{const response=await fetch("/api/dsh-remote-ops/workspace",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.code);return value;},{sessionId:info.sessionId,...body});
  const until=async predicate=>{for(let n=0;n<100;n++){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error("workspace did not settle");};
  await p.getByRole("button",{name:"Remote Ops",exact:true}).click();
  await p.getByLabel("终端输出",{exact:true}).waitFor();
  await p.locator(".e2e-conversation").evaluate(node=>{window.__conversationNode=node;});
  await t.step("工作区键盘切换与关闭、刷新恢复选中网页",async()=>{
    const terminal=p.getByRole("tablist",{name:"Remote Ops 工作区"}).getByRole("tab",{name:"终端",exact:true});
    await terminal.focus();await p.keyboard.press("ArrowRight");
    await p.getByRole("tabpanel",{name:"网页",exact:true}).waitFor();
    await p.getByLabel("网页地址",{exact:true}).fill("https://unsent.example.test/");
    await p.getByRole("button",{name:"关闭运维面板",exact:true}).click();
    await p.getByRole("button",{name:"Remote Ops",exact:true}).click();
    assert.equal(await p.getByLabel("网页地址",{exact:true}).inputValue(),"https://unsent.example.test/");
    await p.reload();await p.locator("html[data-e2e-ready=true]").waitFor();
    await p.getByRole("button",{name:"Remote Ops",exact:true}).click();
    assert.equal(await p.getByRole("tab",{name:"网页",exact:true}).getAttribute("aria-selected"),"true");
    await p.locator(".e2e-conversation").evaluate(node=>{window.__conversationNode=node;});
  });
  await t.step("独立命令弹窗约束焦点，Esc 返回入口，关闭与刷新后仍能恢复结果",async()=>{
    await p.getByRole("tab",{name:"终端",exact:true}).click();
    const trigger=p.getByRole("button",{name:"独立命令",exact:true});await p.getByLabel("终端操作",{exact:true}).click();await trigger.click();
    const dialog=p.getByRole("dialog",{name:/独立命令/});
    await p.getByRole("button",{name:"关闭独立命令",exact:true}).focus();await p.keyboard.press("Shift+Tab");
    assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);
    await p.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
    assert.equal(await p.getByLabel("终端操作",{exact:true}).evaluate(node=>document.activeElement===node),true);
    await p.getByLabel("终端操作",{exact:true}).click();await trigger.click();
    const command=process.platform==="win32"?"ping -n 3 127.0.0.1 >nul & echo BACKGROUND_OK":"sleep 1.5; printf BACKGROUND_OK";
    await p.getByLabel("独立命令内容",{exact:true}).fill(command);
    await dialog.getByRole("button",{name:"执行",exact:true}).click();
    const started=await until(async()=>{const jobs=(await workspace({action:"command-list",session:"local-cmd"})).jobs;return jobs.at(-1);});
    assert.equal(started.status,"running");
    await p.getByRole("button",{name:"关闭独立命令",exact:true}).click();
    await p.getByRole("tab",{name:"文件",exact:true}).click();
    await p.reload();await p.locator("html[data-e2e-ready=true]").waitFor();await p.getByRole("button",{name:"Remote Ops",exact:true}).click();
    await p.locator(".e2e-conversation").evaluate(node=>{window.__conversationNode=node;});
    const completed=await until(async()=>{const job=await workspace({action:"command-status",requestId:started.requestId});return job.status!=="running"&&job;});
    assert.equal(completed.result?.exitCode,0);assert.match(completed.result.stdout,/BACKGROUND_OK/);
    await p.getByRole("tab",{name:"终端",exact:true}).click();await p.getByLabel("终端操作",{exact:true}).click();await p.getByRole("button",{name:"独立命令",exact:true}).click();
    const output=dialog.getByRole("tabpanel",{name:"stdout",exact:true});await output.waitFor();
    await until(async()=>/BACKGROUND_OK/.test(await output.textContent()));
    assert.equal((await workspace({action:"command-list",session:"local-cmd"})).jobs.length,1);
    await p.getByRole("button",{name:"关闭独立命令",exact:true}).click();
  });
  await t.step("环境分组在面板内输入，Esc 取消，快捷命令分组可保存",async()=>{
    let browserDialogs=0;p.on("dialog",()=>browserDialogs++);
    await p.getByRole("button",{name:"环境管理",exact:true}).click();await p.getByRole("button",{name:"+ 分组",exact:true}).click();
    await p.getByLabel("环境分组名称",{exact:true}).fill("do-not-save");await p.keyboard.press("Escape");
    assert.equal(await p.getByText("do-not-save",{exact:true}).count(),0);
    await p.getByRole("button",{name:"返回工作区",exact:true}).click();
    await p.getByRole("button",{name:"管理快捷命令",exact:true}).click();await p.getByRole("button",{name:"新建分组",exact:true}).click();
    await p.getByLabel("快捷命令分组名称",{exact:true}).fill("常用检查");
    await p.getByRole("dialog",{name:"编辑名称",exact:true}).getByRole("button",{name:"确认",exact:true}).click();
    await until(async()=>await p.getByRole("dialog",{name:"管理快捷命令",exact:true}).getByLabel("快捷命令分组",{exact:true}).locator("option").allTextContents().then(names=>names.includes("常用检查")));
    assert.equal(browserDialogs,0);await p.getByRole("button",{name:"关闭快捷命令弹窗",exact:true}).click();
  });
  await p.route("**/api/dsh-remote-ops/workspace",async route=>{
    const body=route.request().postDataJSON();if(body.action!=="files")return route.continue();
    const path=body.endpoint.path==="."?"/fixture":body.endpoint.path;
    return route.fulfill({json:{path,entries:[{name:"folder",type:"d",size:0},...Array.from({length:1000},(_,index)=>({name:`file-${String(index).padStart(4,"0")}.log`,type:"-",size:100}))]}});
  });
  await t.step("大目录筛选、Shift 批选、Enter 打开目录与选择恢复",async()=>{
    await p.getByRole("tab",{name:"文件",exact:true}).click();
    const source=p.getByLabel("文件来源 A",{exact:true});await source.getByLabel("选择 file-0000.log",{exact:true}).waitFor();
    await p.getByLabel("筛选目录 A",{exact:true}).fill("file-000");
    await source.getByLabel("选择 file-0000.log",{exact:true}).check();await source.getByLabel("选择 file-0003.log",{exact:true}).click({modifiers:["Shift"]});
    assert.equal(await source.getByLabel("选择 file-0002.log",{exact:true}).isChecked(),true);
    await p.getByRole("tab",{name:"网页",exact:true}).click();await p.getByRole("tab",{name:"文件",exact:true}).click();
    assert.equal(await p.getByLabel("筛选目录 A",{exact:true}).inputValue(),"file-000");
    await until(async()=>await source.getByLabel("选择 file-0002.log",{exact:true}).isChecked());
    await p.getByLabel("筛选目录 A",{exact:true}).fill("");await source.getByRole("button",{name:"folder",exact:true}).press("Enter");
    await until(async()=>(await p.getByLabel("路径 A",{exact:true}).inputValue()).endsWith("/folder"));
  });
  const switching=[];
  for(let index=0;index<20;index++) switching.push(await p.evaluate(async index=>{const start=performance.now();document.querySelectorAll('[aria-label="Remote Ops 工作区"] [role="tab"]')[index%3].click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return performance.now()-start;},index));
  const p95=switching.sort((a,b)=>a-b)[18];
  await t.step(`20 次模块切换保留主对话，前端切换 p95 ${Math.round(p95)}ms`,async()=>{
    assert.ok(p95<250,"frontend switching exceeded 250ms: "+p95);
    assert.equal(await p.locator(".e2e-conversation").evaluate(node=>node===window.__conversationNode),true);
    await p.setViewportSize({width:390,height:844});
    for(const name of ["终端","网页","文件"]){await p.getByRole("tablist",{name:"Remote Ops 工作区"}).getByRole("tab",{name,exact:true}).click();assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  });
}};

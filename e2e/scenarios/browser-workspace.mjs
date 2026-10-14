import assert from "node:assert/strict";

export const websiteScenario = {
  id: "web-workspace", title: "可见网页登录、参数流程、防重复、对话取消、iframe 与弹出网页",
  async run(t) {
    const page = t.page, info = await t.info();
    const call = (path, body) => page.evaluate(async ({ path, body }) => {
      const response = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
      const value = await response.json(); if (!response.ok) throw new Error(JSON.stringify(value)); return value;
    }, { path, body });
    const api = body => call("/api/dsh-remote-ops/browser", { sessionId: info.sessionId, ...body });
    const snapshot = () => call(`/api/dsh-remote-ops/browser?sessionId=${info.sessionId}`);
    const tool = (name, args) => call("/e2e/agent", { tool: name, args });
    const until = async predicate => { for (let n = 0; n < 150; n++) { const result = await predicate(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error("Web state did not settle"); };
    const done = id => until(async () => { const current = (await snapshot()).sessions.find(item => item.id === id); return ["completed", "failed", "unknown", "stopped"].includes(current?.job?.status) ? current : false; });
    const css = value => ({ kind: "css", value });
    await api({ action: "site.save", site: { name: "Inactive first site", url: info.website.url } });
    await t.step("网页表单保存自动登录配置并按显示偏好打开浏览器", async () => {
      await page.getByRole("button", { name: "Remote Ops", exact: true }).click();
      await page.getByRole("button", { name: "网页", exact: true }).click();
      await page.getByText('高级：收藏网站与流程',{exact:true}).click();
      await page.getByRole("button", { name: "新增网站", exact: true }).click();
      await page.getByLabel("网站名称", { exact: true }).fill("Local console");
      await page.getByLabel("网站地址", { exact: true }).fill(`${info.website.url}/login`);
      await page.getByLabel("浏览器", { exact: true }).selectOption("chrome");
      await page.getByText("自动登录（可选，也可人工登录）", { exact: true }).click();
      await page.getByLabel("网页登录用户名", { exact: true }).fill("tester");
      await page.getByLabel("网页登录密码", { exact: true }).fill("local-test-password");
      await page.getByRole("button", { name: "配置自动登录定位", exact: true }).click();
      for (const [label, value] of [["用户名定位", "#username"], ["密码定位", "#password"], ["登录按钮定位", "//button[@type='submit']"], ["登录成功定位", "#signed-in"]]) {
        if (label === "登录按钮定位") await page.getByLabel(`${label}方式`, { exact: true }).selectOption("xpath");
        await page.getByLabel(label, { exact: true }).fill(value);
      }
      await page.getByRole("button", { name: "保存网站", exact: true }).click();
      await page.getByRole("button", { name: "打开浏览器", exact: true }).click();
      const opened=await until(async()=>(await snapshot()).sessions.find(v=>!v.closed));await tool('remote_browser_login',{browserId:opened.id,requestId:'login-once'});
      await until(async () => (await snapshot()).sessions[0]?.job?.status === "completed");
      assert.equal((await t.info()).website.log.logins, 1);
    });
    let state = await snapshot(), browser = state.sessions[0];
    await t.step("界面创建临时读取步骤并测试 XPath 唯一定位", async () => {
      await page.getByRole("button", { name: "添加步骤", exact: true }).click();
      await page.getByLabel("步骤 1动作", { exact: true }).selectOption("read");
      await page.getByLabel("步骤 1定位方式", { exact: true }).selectOption("xpath");
      await page.getByLabel("步骤 1定位", { exact: true }).fill("//*[@id='signed-in']");
      await page.getByRole("button", { name: "测试步骤 1定位", exact: true }).click();
      await page.getByText("匹配到 1 个元素，已在浏览器中高亮", { exact: true }).waitFor();
      await tool('remote_browser_run',{browserId:browser.id,requestId:'read-signed-in',steps:[{action:'read',target:{kind:'xpath',value:"//*[@id='signed-in']"}}]});
      assert.equal((await done(browser.id)).job.results[0].value, "Signed in");
    });
    const flow = (await api({ action: "flow.save", flow: { siteId: browser.siteId, name: "Run command", steps: [
      { action: "fill", target: { kind: "label", value: "Command" }, value: "{{command}}" },
      { action: "click", target: { kind: "role", value: "button", name: "Run" }, expect: { target: css("#output"), text: "OK:" } },
      { action: "read", target: css("#output") },
    ] } })).result;
    await t.step("参数流程由界面执行，模型轮询读取结果，重复请求不重复提交", async () => {
      await until(async () => (await snapshot()).flows.length === 1);
      await page.getByLabel("已保存流程", { exact: true }).selectOption(flow.id);
      await tool('remote_browser_run',{browserId:browser.id,requestId:'version-once',flowId:flow.id,variables:{command:'show version'}});
      assert.equal((await done(browser.id)).job.results.at(-1).value, "OK: show version");
      const args = { browserId: browser.id, flowId: flow.id, variables: { command: "show status" }, requestId: "command-once" };
      const first = await tool("remote_browser_run", args), same = await tool("remote_browser_run", args);
      assert.equal(first.id, same.id); await done(browser.id);
      const read = await tool("remote_browser_read", { browserId: browser.id });
      assert.match(read.page.text, /OK: show status/); assert.ok(!JSON.stringify(read).includes("local-test-password"));
      assert.deepEqual((await t.info()).website.log.commands, ["show version", "show status"]);
    });
    await t.step("切换模块保留执行，原生对话取消阻止后续动作", async () => {
      await tool('remote_browser_run',{browserId:browser.id,requestId:'cancel-after-current',steps:[
        {action:'click',target:css('#slow'),expect:{target:css('#output'),text:'Slow finished'}},
        {action:'click',target:css('#run')},{action:'read',target:css('#output')},
      ]});
      await page.getByRole('button',{name:'SFTP',exact:true}).click();
      assert.equal((await snapshot()).sessions[0].closed,false);
      await call('/e2e/turn/cancel',{});
      await page.getByRole('button',{name:'网页',exact:true}).click();
      const stopped=await done(browser.id);assert.equal(stopped.job.status,'unknown');assert.equal(stopped.job.index,0);
      assert.deepEqual((await t.info()).website.log.commands,['show version','show status']);
    });
    await t.step("iframe 操作与网页原生确认弹窗", async () => {
      await api({ action: "run", browserId: browser.id, requestId: "frame", steps: [{ action: "click", target: { ...css("#frame-action"), frame: "iframe" }, expect: { target: { ...css("#frame-result"), frame: "iframe" }, text: "Frame done" } }] });
      assert.equal((await done(browser.id)).job.status, "completed");
      await api({ action: "run", browserId: browser.id, requestId: "save", steps: [{ action: "click", target: css("#save"), expect: { target: css("#saved"), text: "Saved" } }] });
      await until(async () => (await snapshot()).sessions[0].dialog);
      await api({ action: "control", browserId: browser.id, control: "dialog-accept" });
      assert.equal((await done(browser.id)).job.status, "completed");
    });
    await t.step("新弹出网页进入自动化上下文，关闭重开保留登录", async () => {
      await api({ action: "run", browserId: browser.id, requestId: "popup", steps: [{ action: "click", target: css("#popup"), expectPopup: true, expect: { target: css("#popup-result"), text: "Popup ready" } }, { action: "read", target: css("#popup-result") }] });
      const completed = await done(browser.id); assert.equal(completed.job.results.at(-1).value, "Popup ready"); assert.equal(completed.pages.length, 2);
      await api({ action: "control", browserId: browser.id, control: "close" });
      browser = (await api({ action: "open", siteId: browser.siteId })).result;
      assert.equal((await api({ action: "login", browserId: browser.id, requestId: "retained" })).result.authenticated, true);
      assert.equal((await t.info()).website.log.logins, 1);
      await api({action:'display',browserId:browser.id,display:'embedded'});
      assert.equal((await tool('remote_browser_login',{browserId:browser.id,requestId:'mode-login'})).authenticated,true);
      await api({action:'display',browserId:browser.id,display:'window'});
      assert.equal((await t.info()).website.log.logins,1);
    });
    await t.step("390 像素下网页操作可滚动且无横向溢出", async () => {
      await page.getByRole("button", { name: "显示浏览器", exact: true }).first().waitFor();
      const library=page.getByText('高级：收藏网站与流程',{exact:true});if(await library.locator('..').getAttribute('open')!==null)await library.click();
      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.locator(".dsh-remote-ops__web").evaluate(node => ({ horizontal: node.scrollWidth - node.clientWidth, vertical: node.scrollHeight > node.clientHeight }));
      assert.ok(overflow.horizontal <= 1, JSON.stringify(overflow));
    });
    await t.step("DSH 网页刷新后恢复当前对话的活动网站", async () => {
      await page.reload(); await page.locator("html[data-e2e-ready=true]").waitFor();
      await page.getByRole("button", { name: "Remote Ops", exact: true }).click();
      await page.getByRole("button", { name: "网页", exact: true }).click();
      await page.getByText('高级：收藏网站与流程',{exact:true}).click();
      await page.getByRole("button", { name: "编辑网站", exact: true }).waitFor();
      assert.equal(await page.getByLabel("选择网站", { exact: true }).inputValue(), browser.siteId);
      await page.getByRole("button", { name: "显示浏览器", exact: true }).first().waitFor();
    });
  },
};

import assert from "node:assert/strict";

export const environmentPasswordScenario = { id: "environment-password", title: "环境密码按需查看、修改分离和关闭后清除", async run(t) {
  const p = t.page, original = "fixture-password-071", replacement = "fixture-replacement-071";
  const reveals = [], saves = [];
  p.on("request", request => {
    if (request.url().endsWith("/environment-password")) reveals.push(request.postDataJSON());
    if (request.url().endsWith("/action") && request.postDataJSON()?.action === "environment.save") saves.push(request.postDataJSON());
  });
  await p.evaluate(async password => {
    const response = await fetch("/api/dsh-remote-ops/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "environment.save", environment: { id: "password-071", name: "密码测试设备", host: "fixture.example", username: "admin" }, password }) });
    if (!response.ok) throw Error("Could not create the fixture environment");
  }, original);
  await p.getByRole("button", { name: "Remote Ops", exact: true }).click();
  await p.getByRole("button", { name: "环境管理", exact: true }).click();
  const edit = () => p.locator(".dsh-remote-ops__env").filter({ hasText: "密码测试设备" }).getByRole("button", { name: "编辑", exact: true }).click();
  const field = () => p.getByLabel("SSH 密码", { exact: true });
  const show = () => p.getByRole("button", { name: "显示 SSH 密码", exact: true });
  const hide = () => p.getByRole("button", { name: "隐藏 SSH 密码", exact: true });
  await edit();
  await t.step("打开编辑不读取密码，眼睛按钮支持显示和隐藏", async () => {
    assert.equal(reveals.length, 0); assert.equal(await field().inputValue(), ""); assert.equal(await field().getAttribute("type"), "password");
    await show().click(); await hide().waitFor(); assert.equal(await field().inputValue(), original); assert.equal(await field().getAttribute("type"), "text");
    assert.deepEqual(reveals[0], { environment: "password-071" });
    await hide().click(); assert.equal(await field().inputValue(), ""); assert.equal(await field().getAttribute("type"), "password");
  });
  await t.step("只查看后保存其他字段，不重新写入密码", async () => {
    await show().click(); await hide().waitFor();
    await p.getByLabel("显示名称", { exact: true }).fill("密码测试设备-改名");
    await p.getByRole("button", { name: "保存", exact: true }).click();
    await p.locator(".dsh-remote-ops__envName").getByText("密码测试设备-改名", { exact: true }).waitFor();
    assert.equal(saves.at(-1).password, undefined);
    const state = await p.evaluate(async () => (await fetch("/api/dsh-remote-ops/state")).text());
    assert.ok(!state.includes(original));
    assert.ok(!(await p.evaluate(() => JSON.stringify({ ...localStorage }))).includes(original));
    await edit(); assert.equal(await field().inputValue(), "");
  });
  await t.step("关闭抽屉和取消编辑后重新打开，密码恢复遮蔽", async () => {
    await show().click(); await hide().waitFor();
    await p.getByRole("button", { name: "关闭环境", exact: true }).click();
    const count = reveals.length;
    await p.getByRole("button", { name: "环境管理", exact: true }).click();
    assert.equal(await field().inputValue(), ""); assert.equal(await field().getAttribute("type"), "password"); assert.equal(reveals.length, count);
    await show().click(); await hide().waitFor(); await p.getByRole("button", { name: "取消", exact: true }).click();
    await edit(); assert.equal(await field().inputValue(), "");
  });
  await t.step("慢请求在关闭后不会带回旧密码，也不会覆盖新输入", async () => {
    let release, handled, started;
    const gate = new Promise(resolve => { release = resolve; }), done = new Promise(resolve => { handled = resolve; }), active = new Promise(resolve => { started = resolve; });
    await p.route("**/environment-password", async route => { started(); await gate; await route.fulfill({ json: { password: original } }).catch(() => {}); handled(); }, { times: 1 });
    await show().click(); await active; await p.getByRole("button", { name: "取消读取 SSH 密码", exact: true }).waitFor();
    await p.getByRole("button", { name: "取消", exact: true }).click(); await edit(); release(); await done;
    assert.equal(await field().inputValue(), ""); assert.equal(await field().getAttribute("type"), "password");
    let releaseSecond, handledSecond, startedSecond;
    const secondGate = new Promise(resolve => { releaseSecond = resolve; }), secondDone = new Promise(resolve => { handledSecond = resolve; }), secondActive = new Promise(resolve => { startedSecond = resolve; });
    await p.route("**/environment-password", async route => { startedSecond(); await secondGate; await route.fulfill({ json: { password: original } }).catch(() => {}); handledSecond(); }, { times: 1 });
    await show().click(); await secondActive; await p.getByRole("button", { name: "取消读取 SSH 密码", exact: true }).waitFor();
    await field().fill(replacement); releaseSecond(); await secondDone;
    assert.equal(await field().inputValue(), replacement);
  });
  await t.step("新密码可显示后保存，刷新并重新读取得到新值", async () => {
    const count = reveals.length;
    await show().click(); assert.equal(await field().inputValue(), replacement); assert.equal(reveals.length, count);
    await hide().click(); assert.equal(await field().inputValue(), replacement); assert.equal(await field().getAttribute("type"), "password");
    await p.getByRole("button", { name: "保存", exact: true }).click();
    await p.locator(".dsh-remote-ops__envName").getByText("密码测试设备-改名", { exact: true }).waitFor();
    assert.equal(saves.at(-1).password, replacement);
    await p.reload(); await p.getByRole("button", { name: "Remote Ops", exact: true }).click();
    await p.getByRole("button", { name: "环境管理", exact: true }).click(); await edit();
    assert.equal(await field().inputValue(), ""); await show().click(); await hide().waitFor(); assert.equal(await field().inputValue(), replacement); await hide().click();
  });
  await t.step("读取失败可重试，390px 下按钮和输入框可用", async () => {
    await p.route("**/environment-password", route => route.abort("failed"), { times: 1 });
    await show().click(); await p.getByRole("alert").filter({ hasText: "暂时无法读取密码" }).waitFor();
    assert.equal(await field().inputValue(), ""); await show().click(); await hide().waitFor(); assert.equal(await field().inputValue(), replacement); await hide().click();
    await p.setViewportSize({ width: 390, height: 844 });
    assert.ok(await p.locator(".dsh-remote-ops__drawer").evaluate(n => n.scrollWidth - n.clientWidth) <= 1);
    await show().focus(); await p.keyboard.press("Space"); await hide().waitFor(); assert.equal(await field().inputValue(), replacement);
  });
} };

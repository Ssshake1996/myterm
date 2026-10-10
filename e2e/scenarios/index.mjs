const pause = (page, ms) => page.waitForTimeout(ms);

async function openPanel(t) {
  await t.step("打开 Remote Ops", async () => {
    await t.page.getByRole("button", { name: "Remote Ops" }).click();
    await t.page.getByLabel("终端输出").waitFor();
    await t.page.getByLabel("终端输出").getByText("e2e@local$").waitFor();
  });
}

async function typeInTerminal(page, text) {
  await page.getByLabel("终端输出").click();
  await page.getByLabel("终端输入").focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function createDeviceEnvironment(t, name) {
  const info = await t.info();
  await t.step(`保存环境 ${name}`, async () => {
    await t.page.getByRole("button", { name: "环境", exact: true }).click();
    await t.page.getByRole("button", { name: "+ 环境" }).click();
    await t.page.getByLabel("显示名称").fill(name);
    await t.page.getByLabel("主机地址").fill(info.device.host);
    await t.page.getByLabel("用户名").fill(info.device.username);
    await t.page.getByLabel("端口").fill(String(info.device.port));
    await t.page.getByLabel("SSH 密码").fill("e2e-device-pass");
    await t.page.getByRole("button", { name: "保存" }).click();
    await t.page.getByText(name).waitFor();
  });
}

export const scenarios = [
  {
    id: "panel-local",
    title: "打开面板并在本地终端回显",
    async run(t) {
      await openPanel(t);
      await t.step("本地 echo 只回显一次", async () => {
        await typeInTerminal(t.page, "echo E2E-LOCAL-OK");
        await t.page.getByLabel("终端输出").getByText("E2E-LOCAL-OK", { exact: true }).waitFor();
      });
    },
  },
  {
    id: "no-auto-confirm",
    title: "设备 (y/n) 不会被自动回答",
    async run(t) {
      await openPanel(t);
      await createDeviceEnvironment(t, "确认阵列");
      await t.step("进入设备并停留在确认提示", async () => {
        await t.page.getByRole("button", { name: "进入" }).click();
        await t.page.getByLabel("终端输出").getByText("admin:/>").waitFor();
        await typeInTerminal(t.page, "delete lun 3");
        await t.page.getByLabel("终端输出").getByText("(y/n)").waitFor();
        await pause(t.page, 400);
        const info = await t.info();
        if (info.device.replies.some((reply) => /^y(es)?$/i.test(reply))) throw new Error(`device received an automatic confirmation: ${info.device.replies.join(",")}`);
        if (info.device.executed.length) throw new Error(`delete ran without a human answer: ${info.device.executed.join(",")}`);
      });
    },
  },
  {
    id: "resize-and-disconnect",
    title: "调整 SSH 终端大小并在掉线后提示重连",
    async run(t) {
      await openPanel(t);
      await createDeviceEnvironment(t, "尺寸阵列");
      await t.step("进入设备", async () => {
        await t.page.getByRole("button", { name: "进入" }).click();
        await t.page.getByLabel("终端输出").getByText("Welcome to Fake Array").waitFor();
      });
      await t.step("把 PTY 调到 200×50", async () => {
        await t.page.getByLabel("终端大小").selectOption("50x200");
        await t.page.waitForFunction(async () => {
          const info = await fetch("/e2e/info").then((response) => response.json());
          return info.device.windows.some((item) => item.rows === 50 && item.cols === 200);
        });
      });
      await t.step("设备断开后保留输出并给出重连，不重放命令", async () => {
        await typeInTerminal(t.page, "disconnect");
        await t.page.getByText("连接已断开").waitFor();
        await t.shot("断开横幅");
        const before = (await t.info()).device.commands;
        t.acceptNextDialog();
        await t.page.getByRole("button", { name: "重新连接" }).click();
        await t.page.getByText("连接已断开").waitFor({ state: "hidden" });
        await t.page.getByLabel("终端输出").getByText("Welcome to Fake Array").waitFor();
        const after = (await t.info()).device.commands;
        if (after.length !== before.length) throw new Error(`reconnect replayed commands: ${after.join(" | ")}`);
      });
    },
  },
  {
    id: "agent-shares-terminal",
    title: "Agent 发送与界面看到同一条输出，人工输入时拒绝",
    async run(t) {
      await openPanel(t);
      await t.step("Agent 发送出现在可见终端", async () => {
        const response = await t.page.request.post("/e2e/agent", { data: { tool: "remote_terminal_send", args: { session: "local-cmd", text: "echo AGENT-VISIBLE", quietMs: 40, timeoutSeconds: 5 } } });
        if (!response.ok()) throw new Error(await response.text());
        await t.page.getByLabel("终端输出").getByText("AGENT-VISIBLE", { exact: true }).waitFor();
      });
      await t.step("人工输入后 Agent 被拒绝，交还后恢复", async () => {
        await typeInTerminal(t.page, "draft");
        await pause(t.page, 100);
        const blocked = await t.page.request.post("/e2e/agent", { data: { tool: "remote_terminal_send", args: { session: "local-cmd", text: "echo SHOULD-NOT", quietMs: 40, timeoutSeconds: 3 } } });
        const body = await blocked.json();
        if (blocked.ok() || body.code !== "TERMINAL_MANUAL_CONTROL") throw new Error(JSON.stringify(body));
        await t.page.getByRole("button", { name: "交还 Agent" }).click();
        const allowed = await t.page.request.post("/e2e/agent", { data: { tool: "remote_terminal_send", args: { session: "local-cmd", text: "echo AGENT-AGAIN", quietMs: 40, timeoutSeconds: 5 } } });
        if (!allowed.ok()) throw new Error(await allowed.text());
        await t.page.getByLabel("终端输出").getByText("AGENT-AGAIN", { exact: true }).waitFor();
      });
    },
  },
  {
    id: "long-output-scroll",
    title: "长输出可以滚到末行，上移阅读时不被新输出抢走",
    async run(t) {
      await openPanel(t);
      await t.step("输出 200 行并看到最后一行", async () => {
        await typeInTerminal(t.page, "flood 200");
        await t.page.getByLabel("终端输出").getByText("line 0200").waitFor();
        await t.shot("200 行末尾");
      });
      await t.step("滚到顶部后新输出不抢位置", async () => {
        const output = t.page.getByLabel("终端输出");
        await output.hover();
        await t.page.mouse.wheel(0, -4000);
        await pause(t.page, 200);
        const before = await output.evaluate((node) => node.scrollTop);
        await typeInTerminal(t.page, "echo STAY");
        await output.getByText("STAY", { exact: true }).waitFor();
        const after = await output.evaluate((node) => node.scrollTop);
        if (Math.abs(after - before) > 80) throw new Error(`scroll jumped from ${before} to ${after}`);
      });
    },
  },
  {
    id: "narrow",
    title: "窄屏没有横向溢出",
    viewport: { width: 390, height: 844 },
    async run(t) {
      await openPanel(t);
      await t.step("390 像素下页面不超出视口", async () => {
        const overflow = await t.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) throw new Error(`horizontal overflow ${overflow}px`);
        await t.shot("窄屏");
      });
    },
  },
];

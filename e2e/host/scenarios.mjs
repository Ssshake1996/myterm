const pause = (page, ms) => page.waitForTimeout(ms);

async function clickIfVisible(page, names) {
  for (const name of names) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.count()) {
      await button.first().click();
      return name;
    }
  }
  return "";
}

async function dismissHostChrome(page) {
  const preview = page.getByRole("button", { name: "继续", exact: true }).or(page.getByRole("button", { name: "Continue", exact: true }));
  const later = page.getByRole("button", { name: "稍后配置", exact: true }).or(page.getByRole("button", { name: "Configure later", exact: true }));
  const shell = page.getByRole("button", { name: "打开右侧边栏" }).or(page.getByRole("button", { name: "Open right sidebar" }));
  await preview.or(later).or(shell).first().waitFor({ timeout: 15_000 });
  if (await preview.first().isVisible()) await preview.first().click();
  if (await later.first().isVisible() || await later.first().waitFor({ timeout: 2_000 }).then(() => true).catch(() => false)) {
    if (await later.first().isVisible()) await later.first().click();
  }
}

async function ensureSession(page) {
  const terminal = page.getByLabel("终端输出");
  if (await terminal.count()) return;
  const session = page.getByRole("button", { name: /新会话|New session/ });
  if (await session.count()) await session.first().click();
}

async function openPanel(t) {
  await t.step("打开 Remote Ops", async () => {
    await ensureSession(t.page);
    const launch = t.page.getByRole("button", { name: "Remote Ops" });
    if (await launch.count()) await launch.first().click();
    else {
      await clickIfVisible(t.page, ["打开右侧边栏", "Open right sidebar"]);
      const guide = t.page.getByRole("button", { name: /远程运维|Remote operations/ });
      if (!(await guide.count())) await clickIfVisible(t.page, ["新标签页", "New tab"]);
      await t.page.getByRole("button", { name: /远程运维|Remote operations/ }).click();
    }
    await t.page.getByLabel("终端输出").waitFor();
    await t.page.getByText(/v0\.2\.26/).waitFor();
  });
}

async function useLocalShell(page) {
  const tab = page.getByRole("button", { name: "本地 Shell", exact: true });
  if (await tab.count()) await tab.click();
}

async function typeInTerminal(page, text) {
  await page.getByLabel("终端输出").click();
  await page.getByLabel("终端输入").focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function createDeviceEnvironment(t, name) {
  await t.step(`保存环境 ${name}`, async () => {
    await t.page.getByRole("button", { name: "环境", exact: true }).click();
    await t.page.getByRole("button", { name: "+ 环境" }).click();
    await t.page.getByLabel("显示名称").fill(name);
    await t.page.getByLabel("主机地址").fill(t.device.host);
    await t.page.getByLabel("用户名").fill(t.device.username);
    await t.page.getByLabel("端口").fill(String(t.device.port));
    await t.page.getByLabel("SSH 密码").fill(t.device.password);
    await t.page.getByRole("button", { name: "保存" }).click();
    await t.page.getByText(name).waitFor();
  });
}

export const hostScenarios = [
  {
    id: "host-panel-local",
    title: "真宿主里打开面板并在本地终端回显",
    async run(t) {
      await openPanel(t);
      await useLocalShell(t.page);
      await t.step("本地 echo 回显", async () => {
        await typeInTerminal(t.page, "echo HOST-LOCAL-OK");
        await t.page.getByLabel("终端输出").getByText("HOST-LOCAL-OK", { exact: true }).waitFor();
      });
    },
  },
  {
    id: "host-no-auto-confirm",
    title: "真宿主里设备 (y/n) 不会被自动回答",
    async run(t) {
      await openPanel(t);
      await createDeviceEnvironment(t, "确认阵列");
      await t.step("进入设备并停留在确认提示", async () => {
        const replies = t.device.log.replies.length;
        const executed = t.device.log.executed.length;
        await t.page.locator(".dsh-remote-ops__env", { hasText: "确认阵列" }).getByRole("button", { name: "进入", exact: true }).click();
        await t.page.getByLabel("终端输出").getByText("admin:/>").waitFor();
        await typeInTerminal(t.page, "delete lun 3");
        await t.page.getByLabel("终端输出").getByText("(y/n)").waitFor();
        await pause(t.page, 600);
        const fresh = t.device.log.replies.slice(replies);
        if (fresh.some((reply) => /^y(es)?$/i.test(reply))) throw new Error(`device received an automatic confirmation: ${fresh.join(",")}`);
        if (t.device.log.executed.length !== executed) throw new Error("delete ran without a human answer");
      });
    },
  },
  {
    id: "host-resize-and-disconnect",
    title: "真宿主里调整 SSH 终端大小并在掉线后提示重连",
    async run(t) {
      await openPanel(t);
      await createDeviceEnvironment(t, "尺寸阵列");
      await t.step("进入设备", async () => {
        await t.page.locator(".dsh-remote-ops__env", { hasText: "尺寸阵列" }).getByRole("button", { name: "进入", exact: true }).click();
        await t.page.getByLabel("终端输出").getByText("Welcome to Fake Array").waitFor();
      });
      await t.step("把 PTY 调到 200×50", async () => {
        await t.page.getByLabel("终端大小").selectOption("50x200");
        const deadline = Date.now() + 10_000;
        while (!t.device.log.windows.some((item) => item.rows === 50 && item.cols === 200)) {
          if (Date.now() > deadline) throw new Error(`window change was not recorded: ${JSON.stringify(t.device.log.windows)}`);
          await pause(t.page, 100);
        }
      });
      await t.step("设备断开后保留输出并给出重连，不重放命令", async () => {
        await typeInTerminal(t.page, "disconnect");
        await t.page.getByText("连接已断开").waitFor();
        await t.shot("断开横幅");
        const before = t.device.log.commands.length;
        await t.page.getByRole("button", { name: "重新连接" }).click();
        await t.page.getByText("连接已断开").waitFor({ state: "hidden" });
        await t.page.getByLabel("终端输出").getByText("Welcome to Fake Array").waitFor();
        if (t.device.log.commands.length !== before) throw new Error(`reconnect replayed commands: ${t.device.log.commands.slice(before).join(" | ")}`);
      });
    },
  },
  {
    id: "host-manual-release",
    title: "真宿主里人工输入后可以交还",
    async run(t) {
      await openPanel(t);
      await useLocalShell(t.page);
      await t.step("输入后出现交还，点一下后按钮消失", async () => {
        await typeInTerminal(t.page, "echo HOST-MANUAL");
        await t.page.getByLabel("终端输出").getByText("HOST-MANUAL", { exact: true }).waitFor();
        const release = t.page.getByRole("button", { name: "交还 Agent" });
        await release.waitFor();
        await release.click();
        await release.waitFor({ state: "hidden" });
      });
    },
  },
  {
    id: "host-long-output-scroll",
    title: "真宿主里长输出可以滚到末行，上移阅读时不被新输出抢走",
    async run(t) {
      await openPanel(t);
      await useLocalShell(t.page);
      await t.step("输出 200 行并看到最后一行", async () => {
        await typeInTerminal(t.page, `python3 -c 'print("\\n".join(f"line {i:04d}" for i in range(1,201)))'`);
        await t.page.getByLabel("终端输出").getByText("line 0200").waitFor({ timeout: 20_000 });
        await t.shot("200 行末尾");
      });
      await t.step("滚到顶部后新输出不抢位置", async () => {
        const output = t.page.getByLabel("终端输出");
        await output.hover();
        await t.page.mouse.wheel(0, -4000);
        await pause(t.page, 300);
        const before = await output.evaluate((node) => node.scrollTop);
        await typeInTerminal(t.page, "echo HOST-STAY");
        await output.getByText("HOST-STAY", { exact: true }).waitFor();
        const after = await output.evaluate((node) => node.scrollTop);
        if (Math.abs(after - before) > 80) throw new Error(`scroll jumped from ${before} to ${after}`);
      });
    },
  },
  {
    id: "host-narrow",
    title: "真宿主里窄屏的 Remote Ops 面板没有横向溢出",
    viewport: { width: 390, height: 844 },
    async run(t) {
      await openPanel(t);
      await t.step("390 像素下插件面板不超出自身", async () => {
        const overflow = await t.page.locator(".dsh-remote-ops").evaluate((node) => node.scrollWidth - node.clientWidth);
        if (overflow > 1) throw new Error(`horizontal overflow ${overflow}px`);
        await t.shot("窄屏");
      });
    },
  },
];

export { dismissHostChrome };

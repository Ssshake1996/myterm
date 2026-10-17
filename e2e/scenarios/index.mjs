import { websiteScenario } from "./browser-workspace.mjs";
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
    await t.page.getByRole("button", { name: "环境管理", exact: true }).click();
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

export const scenarios = [workspaceUiScenario,liveBrowserScenario,
  websiteScenario,
  {
    id: "sftp-narrow",
    title: "窄屏传输历史不挤掉文件列表，来源与目标可切换访问",
    viewport: { width: 390, height: 844 },
    async run(t) {
      await openPanel(t);
      await t.page.addStyleTag({ content: ".e2e-sidebar{min-height:0;width:334px;max-width:100%}.e2e-sidebar-body{height:0}" });
      await t.page.route("**/api/dsh-remote-ops/workspace", async route => {
        const body = route.request().postDataJSON();
        if (body.action === "files") return route.fulfill({ json: { path: "/narrow", entries: Array.from({ length: 40 }, (_, index) => ({ name: `narrow-${index}.txt`, type: "-", size: 1 })) } });
        if (body.action === "transfers") return route.fulfill({ json: { tasks: Array.from({ length: 20 }, (_, index) => ({ id: "history-" + index, names: ["long-upload-name-" + index + ".txt"], status: "completed", finishedAt: "now", bytes: 100, target: { kind: "host", path: "/narrow" } })) } });
        return route.continue();
      });
      await t.step("目录保留可用高度，目标 B 可切换访问", async () => {
        await t.page.getByRole("tab", { name: "文件", exact: true }).click();
        await t.page.getByLabel("文件来源 A").getByLabel("选择 narrow-0.txt", { exact: true }).waitFor();
        await t.page.getByLabel("传输任务", { exact: true }).getByText("已结束的传输 · 20", { exact: true }).waitFor();
        const sizes = await t.page.locator(".dsh-remote-ops__sftpPane[data-focused=true] .dsh-remote-ops__sftpEntries").evaluateAll(nodes => nodes.map(node => node.clientHeight));
        if (sizes.some(height => height < 80)) throw new Error(`file lists collapsed to ${sizes.join(",")}px`);
        await t.page.getByRole("button", { name: "目标 B", exact: true }).click();
        await t.page.getByLabel("路径 B", { exact: true }).waitFor({state:"visible"});
        const inView = await t.page.getByLabel("路径 B", { exact: true }).evaluate(node => { const pane = node.closest(".dsh-remote-ops__sftpSplit").getBoundingClientRect(), rect = node.getBoundingClientRect(); return rect.top >= pane.top && rect.bottom <= pane.bottom; });
        if (!inView) throw new Error("target B path is clipped");
        if (await t.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("narrow SFTP overflows horizontally");
      });
    },
  },
  {
    id: "sftp-upload-navigation",
    title: "浏览器批量上传跨页面继续，返回后进度与文件内容正确",
    async run(t) {
      await openPanel(t);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let first = true;
      await t.page.route("**/api/dsh-remote-ops/browser-upload?*", async route => { if (first) { first = false; await gate; } await route.continue().catch(() => {}); });
      const payloads = [{ name: "navigation-one.txt", mimeType: "text/plain", buffer: Buffer.from("FIRST-UPLOAD-".repeat(10000)) }, { name: "navigation-two.txt", mimeType: "text/plain", buffer: Buffer.from("SECOND-UPLOAD\n") }];
      try {
        await t.step("开始批量上传并切换终端、关闭和重新打开运维面板", async () => {
          await t.page.getByRole("tab", { name: "文件", exact: true }).click();
          const fileRoot = (await t.info()).fileRoot;
          await t.page.getByLabel("路径 A", { exact: true }).fill(fileRoot);
          const directoryResponse = t.page.waitForResponse(response => { try { const body = response.request().postDataJSON(); return response.url().includes("/workspace") && body.action === "files" && body.endpoint.path === fileRoot; } catch { return false; } });
          await t.page.getByLabel("文件来源 A").getByRole("button", { name: "打开路径", exact: true }).click();
          await directoryResponse;
          await t.page.getByLabel("浏览器上传 A", { exact: true }).locator("input").waitFor({ state: "visible" });
          await t.page.waitForFunction(() => !document.querySelector('[aria-label="浏览器上传 A"] input').disabled);
          const started = t.page.waitForRequest(request => request.url().includes("/browser-upload?"));
          await t.page.getByLabel("浏览器上传 A", { exact: true }).locator("input").setInputFiles(payloads);
          await started;
          await t.page.getByRole("button", { name: "关闭 SFTP", exact: true }).click();
          await t.page.getByRole("button", { name: "查看上传进度", exact: true }).waitFor();
          await t.page.getByRole("button", { name: "关闭运维面板", exact: true }).click();
          await t.page.getByLabel("终端输出").waitFor({ state: "hidden" });
          await t.page.getByRole("button", { name: "Remote Ops", exact: true }).click();
          await t.page.getByRole("button", { name: "查看上传进度", exact: true }).click();
          await t.page.getByRole("button", { name: "取消上传", exact: true }).waitFor();
        });
        release();
        await t.step("两个文件继续上传并核对落盘内容", async () => {
          await t.page.getByLabel("传输任务", { exact: true }).getByText(/上传完成/).waitFor();
          const sessionId = (await t.info()).sessionId, path = await t.page.getByLabel("路径 A", { exact: true }).inputValue();
          for (const payload of payloads) {
            const response = await t.page.request.get(`/api/dsh-remote-ops/browser-file?${new URLSearchParams({ sessionId, kind: "host", path, name: payload.name })}`);
            if (!response.ok() || !(await response.body()).equals(payload.buffer)) throw new Error(`uploaded bytes differ: ${payload.name}`);
          }
          await t.page.getByLabel("文件来源 A").getByRole("button", { name: "navigation-two.txt", exact: true }).waitFor();
        });
      } finally { release(); await t.page.unroute("**/api/dsh-remote-ops/browser-upload?*"); }
    },
  },
  {
    id: "sftp-refresh",
    title: "历史传输不重复刷新目录，新完成任务合并刷新并保留选中和滚动",
    async run(t) {
      await openPanel(t);
      let listRequests = 0;
      t.page.on("request", request => { if (request.url().includes("/workspace") && request.method() === "POST" && request.postDataJSON()?.action === "files") listRequests++; });
      const tasks = ["old-one", "old-two", "old-three"].map(id => ({ id, names: [id], status: "completed", finishedAt: "now", target: { kind: "host", path: "/fixture" }, bytes: 1 }));
      let release, hold = false;
      await t.page.route("**/api/dsh-remote-ops/workspace", async route => {
        const body = route.request().postDataJSON();
        if (body.action === "transfers") return route.fulfill({ json: { tasks } });
        if (body.action === "files") {
          if (hold) await new Promise(resolve => { release = resolve; });
          return route.fulfill({ json: { path: body.endpoint.path === "/other" ? "/other" : "/fixture", entries: Array.from({ length: 100 }, (_, index) => ({ name: `file-${String(index).padStart(3, "0")}.txt`, type: "-", size: 10 })) } });
        }
        return route.continue();
      });
      try {
        await t.step("首次读取历史任务只加载两个面板", async () => {
          await t.page.getByRole("tab", { name: "文件", exact: true }).click();
          await t.page.getByLabel("文件来源 A").getByLabel("选择 file-000.txt", { exact: true }).check();
          await pause(t.page, 1700);
          if (listRequests !== 2) throw new Error(`historical jobs caused ${listRequests} directory requests`);
        });
        await t.step("同一轮两个新任务合并刷新，刷新中列表仍可见", async () => {
          const list = t.page.getByLabel("文件来源 A").locator(".dsh-remote-ops__sftpEntries");
          await list.evaluate(node => { node.scrollTop = 120; node.dispatchEvent(new Event("scroll", { bubbles: true })); });
          await t.page.getByLabel("路径 B", { exact: true }).fill("/other");
          await t.page.getByLabel("文件目标 B").getByRole("button", { name: "打开路径", exact: true }).click();
          await t.page.getByLabel("文件目标 B").getByLabel("选择 file-000.txt", { exact: true }).waitFor();
          const before = listRequests;
          hold = true;
          tasks.push(...["new-one", "new-two"].map(id => ({ ...tasks[0], id, names: [id] })));
          await t.page.waitForFunction(() => document.querySelector('[aria-label="文件来源 A"] .dsh-remote-ops__sftpEntries').getAttribute("aria-busy") === "true");
          if (listRequests !== before + 1) throw new Error(`new jobs caused ${listRequests - before} refresh requests`);
          if (!await t.page.getByLabel("文件来源 A").getByLabel("选择 file-000.txt", { exact: true }).isChecked()) throw new Error("selection was cleared during refresh");
          hold = false; release?.();
          await t.page.waitForFunction(() => document.querySelector('[aria-label="文件来源 A"] .dsh-remote-ops__sftpEntries').getAttribute("aria-busy") === "false");
          if (!await t.page.getByLabel("文件来源 A").getByLabel("选择 file-000.txt", { exact: true }).isChecked()) throw new Error("selection was cleared after refresh");
          if (await list.evaluate(node => node.scrollTop) !== 120) throw new Error("scroll position changed during refresh");
        });
      } finally { hold = false; release?.(); await t.page.unroute("**/api/dsh-remote-ops/workspace"); }
    },
  },
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
        await t.page.getByLabel("终端显示设置",{exact:true}).click();
        await t.page.getByLabel("终端大小").selectOption("50x200");
        await t.page.getByLabel("终端显示设置",{exact:true}).click();
        const deadline = Date.now() + 5000;
        while (!(await t.info()).device.windows.some(item => item.rows === 50 && item.cols === 200)) {
          if (Date.now() >= deadline) throw new Error("PTY size did not reach 200x50");
          await pause(t.page, 50);
        }
      });
      await t.step("设备断开后保留输出并给出重连，不重放命令", async () => {
        await typeInTerminal(t.page, "disconnect");
        await t.page.getByText("连接已断开").waitFor();
        await t.shot("断开横幅");
        const before = (await t.info()).device.commands;
        t.acceptNextDialog();
        await t.page.getByRole("button", { name: "重新连接" }).click();
        await t.page.getByRole("dialog",{name:"确认操作",exact:true}).getByRole("button",{name:"确认",exact:true}).click();
        await t.page.getByText("连接已断开").waitFor({ state: "hidden" });
        await t.page.getByLabel("终端输出").getByText("Welcome to Fake Array").waitFor();
        const after = (await t.info()).device.commands;
        if (after.length !== before.length) throw new Error(`reconnect replayed commands: ${after.join(" | ")}`);
      });
    },
  },
  {
    id: "agent-shares-terminal",
    title: "Agent 与人工共享终端输入，停止对话取消等待",
    async run(t) {
      await openPanel(t);
      await t.step("Agent 发送出现在可见终端", async () => {
        const response = await t.page.request.post("/e2e/agent", { data: { tool: "remote_terminal_send", args: { session: "local-cmd", text: "echo AGENT-VISIBLE", quietMs: 40, timeoutSeconds: 5 } } });
        if (!response.ok()) throw new Error(await response.text());
        await t.page.getByLabel("终端输出").getByText("AGENT-VISIBLE", { exact: true }).waitFor();
      });
      await t.step("Agent 等待期间人工可输入，停止对话取消等待后继续", async () => {
        const sending=t.page.request.post('/e2e/agent',{data:{tool:'remote_terminal_send',args:{session:'local-cmd',text:'echo AGENT-WAIT',quietMs:1000,timeoutSeconds:5}}});
        await t.page.getByLabel('终端输出').getByText('AGENT-WAIT',{exact:true}).waitFor();
        await typeInTerminal(t.page,'echo HUMAN-DURING-AGENT');
        await t.page.getByLabel('终端输出').getByText('HUMAN-DURING-AGENT',{exact:true}).waitFor();
        await t.page.request.post('/e2e/turn/cancel');
        const cancelled=await (await sending).json();if(cancelled.waitReason!=='cancelled')throw Error(JSON.stringify(cancelled));
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
import { liveBrowserScenario } from './browser-live.mjs';
import { workspaceUiScenario } from './workspace-ui.mjs';

import { visualRefreshScenario } from './visual-refresh.mjs';
scenarios.push(visualRefreshScenario);
import { terminalLogsScenario } from './terminal-logs.mjs';
scenarios.push(terminalLogsScenario);

# v0.20.1 网页定位提示清理验收

日期：2026-11-23。修复和测试仅在 Remote Ops 插件仓库实施，DSH 与 Agent 未修改。

## 原因与复现

`BrowserSessions.testTarget()` 在唯一匹配时调用 Playwright `locator.highlight()`，没有与之配对的清理。`remote_browser_read({target})` 和界面定位测试都走这条路径。对 `body` 测试即可让蓝色高亮覆盖整页；等待三秒仍保留，同时按钮和输入框仍可用，与本次澄清后的现象一致。

原版复现画面：`output/browser-highlight-repro/baseline-blue.png`。该证据来自本机隔离测试页，不是另一台电脑的业务页面。

## 修复范围

- 定位检查改为透明背景、无输入拦截的边框，1.5 秒后清理。
- 使用宿主已有 `agent/turn-stopping`、`agent/status`（idle）、`agent/error`、`agent/disposed` 事件及原生取消信号清理本对话提示，不增加 Agent 工具。
- 流程结束、导航和关闭也清理；连续显示与清理串行执行，过期计时器不能移除新提示。
- 只清理插件创建的 Playwright 定位高亮，不删除网页元素、不改业务样式、不关闭浏览器或重载页面。

## 自动化与真实运行

- `npm run check --prefix integrations/dsh-remote-ops`：572 项通过（desktop 11、unit 408、client 141、contract 12），语法检查及 smoke 通过。
- UI 契约检查：14 项通过，0 错误。现有提示是 DSH 插件没有 Codex manifest。
- `node test/browser-mcp-live.mjs`：真实 Chrome 与官方 Playwright MCP，11 项通过。整页提示超时后、显式结束清理后，截图与提示前逐像素一致；refs、坐标、人工修改使旧观察失效、多页和关闭 MCP 保留浏览器均通过。
- `e2e/runner/browser-mcp-native.mjs`：安装最终候选 tgz 到独立 `DSH_HOME`，未修改的 DSH **0.2.1-rc.5** 实际加载 **0.20.1**。9 项通过，浏览器错误 0。真实宿主会话加载随包 skill、通过工具读取/执行，定位时页面没有蓝色填充；正常结束和用户点击宿主停止按钮后边框清除；Agent 尚在运行时从嵌入画面点击输入并保留内容。

真实 DSH 使用本地确定性模型服务调用工具，验证宿主事件、工具调用和图像传输；不代表真实模型的视觉推理能力。证据：`output/browser-highlight-v0201-native/evidence.json`、`preview-outline.png`、`cancel-outline.png`、`native-mcp.png`。

追加时序断言：从定位工具返回到画面恢复，正常结束为 693 ms，停止对话为 315 ms，均早于 1.5 秒兜底计时器，证明宿主生命周期会主动清理。

## 最终候选

- 文件：`dsh-remote-ops-v0.20.1.tgz`
- 字节：247102458
- SHA256：`1bd3ef754a7527d07ff3943f0befb13b1860edbb0b57cbb6449b16989ecaca7a`

验收后将同一份候选包上传发布，并由发布工作流重新下载、验证锁定摘要。仅发布 tgz 和 SHA256 校验文件。

## 未验证范围

未连接用户另一台电脑或内网业务网站。没有升级本机日常 Desktop 实例；本轮验证使用隔离的真实 DSH Web 宿主。没有把定位提示、网页任务状态或边框当作业务执行成功的证据。

# dsh-remote-ops v0.3.0

新增可见网页工作区：在 Remote Ops 右侧栏中管理网站、登录和流程，Playwright 在同一台电脑打开独立浏览器，操作过程可见。保留左侧入口展开时左对齐、收起时图标居中，以及主对话和草稿不被替换的行为。

## 变化

- 支持专用 Chromium 与本机 Edge / Chrome；网页模块可安装 Chromium。浏览器 profile 按 DSH 对话和网站隔离，关闭重开保留可复用的登录 Cookie。
- XPath、CSS、role/name、label、text、placeholder、iframe、新弹出网页与多标签页；唯一定位测试与高亮。
- 声明式流程支持 11 种动作、文本参数、执行后结果检查、保存与复用；新增 6 个 `remote_browser_*` 工具，沿用 DSH Agent 与权限体系。
- 暂停、单步、停止、人工接管及交还控制；网页原生弹窗需显式响应，验证码/MFA 由用户完成。正在执行的动作结束前显示等待状态，不宣称撤销已发出的操作。
- 后端任务在切换终端/SFTP、关闭右栏或刷新 DSH 网页时继续；步骤结果、近期记录、当前网页文本和遮罩截图可查看。运行任务不跨插件卸载或 DSH 重启恢复。
- 同一请求 ID 去重，失败不自动重试；动作已发出后出错标记为结果待确认。密码使用本机 Harness 凭据引用，填充同时核对页面与 iframe 域名。
- 同步四份 README、新增包内 `WEB.md` 使用与边界说明，以及本地网站自动验收场景。

## 安装

下载本版本 tgz，在运行 DSH 的同一用户、`DSH_HOME` 和实际 profile 下安装，完全重启 DSH 并刷新浏览器：

```powershell
dsh plugin --profile web add .\dsh-remote-ops-v0.3.0.tgz
dsh web
```

确认标题为 `v0.3.0`，点击 **网页 → 新增网站 → 打开浏览器**。首次可从网页模块安装专用 Chromium，或选择已经安装的 Edge / Chrome。DSH 需运行在用户所在的交互桌面。详细配置、Agent 工具、结果语义和敏感数据位置见 [网页操作说明](https://github.com/Ssshake1996/myterm/blob/main/integrations/dsh-remote-ops/WEB.md)。

## 验证与边界

- `npm run check` 通过 37 个文件语法检查、143 项后端/发布测试、92 项客户端测试、11 项契约测试（共 246 项）及 smoke；新增并发保存、会话隔离、凭据域限制、接管、防重复执行和可运行安装器的回归。
- 浏览器 E2E 使用真实插件前后端、真实 Chrome 和本地验收网站，覆盖自动登录、XPath、参数命令、HTTP 请求次数、暂停/接管/单步/停止、iframe、弹窗、新标签页、重开登录与 390px 交互，并保留原有 SSH/SFTP 仿设备场景。
- 浏览器 E2E 10/10、E2E 单元 4/4；发布前最终报告位于 `output/e2e/browser0300-release/report.html`。Chromium 的首次下载、安装及 headed 启动亦实际通过。
- 最新候选包在隔离的真实 DSH `0.2.0-rc.2` 中通过 1280×900 和 390×844 验收：自动登录、网页命令、单步/接管/继续、模块切换、网页刷新后活动网站恢复、对话草稿与同一编辑器保留、可滚动且无横向溢出、无捕获页面异常。左侧图标/文字为 22/46px，收起后居中且 Tooltip 可用；原生右栏不覆盖主对话，Enter/Space 与重复点击复用标签页通过。
- DSH UI 静态契约 14 通过、0 错误。正式包下载、摘要校验与全新 profile 安装复验会记录在本 GitHub Release 的补充验收信息中。
- 本地验收不代表所有业务网站均兼容。验证码、MFA、业务权限与网站风控需按实际网站处理；本版不提供任意 JavaScript、录制器、嵌入视频流或跨电脑控制。已有 SSH/SFTP 业务和真实模型调用未因此获得新的外部验证。

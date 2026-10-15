# dsh-remote-ops v0.5.3 验收

日期：2026-10-15（Asia/Tokyo）。范围：Windows 11 x64 允许联网的浏览器整合包、浏览器运行时识别/安装、重启后的旧对话激活。所有修改位于插件、安装/发布工具和文档；不修改 Agent 或 DSH 内核。

## 自动验证

| 验证 | 环境 / 命令 | 结果 |
| --- | --- | --- |
| 完整门禁 | Windows 11 23H2 x64 / Node 24.11.1，`npm run check --prefix integrations/dsh-remote-ops` | 197 后端、104 前端、11 契约及 smoke 全通过 |
| 新增回归 | 运行时、整合包校验、安装回调/卸载、可选宿主服务、状态显示、发布资产完整性 | 共新增 18 组；全部通过 |
| UI 静态契约 | `check_dsh_ui_contract.mjs integrations/dsh-remote-ops` | 14 通过、0 错误；预期警告为 DSH 包没有 Codex manifest |
| 随包 skill | skill-creator UTF-8 校验、实际 Cordis / DSH skill 服务 | 校验、发现/加载、用户优先级及卸载清理通过 |
| 浏览器回归 | 仓库 E2E，Chrome 154.0.8037.99，实际插件和客户端、仿宿主及假设备 | 12/12 场景通过 |
| 真实联网安装恢复 | 空的专用缓存、实际锁定的 Playwright CLI | 无效下载地址失败后，可重试并成功下载完整 Chromium、Headless Shell 和辅助文件；两种模式均就绪 |

浏览器版本由已安装的 Playwright 1.64.0 / browsers.json 导出：Chromium 和 Headless Shell 为 156.0.8078.4、revision 1248；FFmpeg 1013、Winldd 1007。构建使用独立缓存，不改变全局 PLAYWRIGHT_BROWSERS_PATH，也不复制用户的登录 profile 或凭据。ZIP 保留 dotfiles、完整浏览器资源与许可证，并包含 Playwright LICENSE、NOTICE 和第三方声明。

## 真实安装与 DSH Web

安装及运行使用本机 Windows 11 x64、DSH 0.2.0-rc.2、pnpm 10.24.0、Node 24.11.1，独立的 DSH_HOME / web profile。DSH_HOME 和解压目录含空格；使用解压 ZIP 的 PowerShell 入口安装，依赖通过 DSH / pnpm 正常联网安装（允许复用已有 npm 缓存）。不声称完全断网或无依赖缓存安装通过。

- 脚本先检查全部文件与 SHA256，通过 DSH 安装本地 tgz，在管理目录放置运行时，实际启动插件内和独立窗口两种浏览器并执行点击检查。
- DSH 进程使用空的 PLAYWRIGHT_BROWSERS_PATH，真实 API 报告两种模式均来自插件 managed 运行时，证明不依赖本机既有 Chromium 缓存。
- 真实 DSH 主对话通过原生工具循环加载随包 skill、发出操作。19 组验收通过：保留对话与草稿的左侧入口/右栏、直接输入 URL、XPath/role 操作、Schema 与空值回归、流程边界、独立窗口执行、模式切换保留 Cookie、安装复用及 390px/深色/刷新恢复。无 pageerror、console 或非 favicon HTTP 错误。
- 下载解压目录移走后，重启 DSH 仍可启动；profile 中的 tgz 引用指向稳定的 `remote-ops/packages` 目录。
- 重启后在同一旧对话重新打开原 URL，登录 Cookie 保留；人工通过共享输入写入网页，原生 Agent 工具读取到相同内容。不会自动恢复旧 job 或重跑网页操作。
- 从已安装正式 v0.5.2 的独立 profile 升级后，`sites.json`、`flows.json`、`preferences.json` 的 SHA256 完全相同，保留站点/流程 ID 与显示偏好。

重启验收最初暴露插件对未声明 sessionController 的访问错误；修复为可选的宿主服务注入，并覆盖服务缺失、卸载、替换及原错误因果链。另修复旧安装进程的迟到回调覆盖重试状态，以及卸载期间启动下载的竞争条件。修复后的完整门禁和真实 DSH 流程均重跑通过。

候选功能验收先使用解压整合包安装；上述宿主服务修复经新的 tgz 正常安装后复验。正式发布资产的完整 ZIP / 新 profile / 重启复验将在发布后补录，不能把候选包结果等同于正式资产复验。

## 验证边界

模型提供方为本地确定性测试服务，网页为本地 HTTP 测试站点；实际 HTTP 模型请求包含的 37 个插件 Schema 均由 DSH 公开校验器及 Ajv 验证。此证据证明宿主、工具、浏览器和随包 skill 的执行链路，不代表用户另一台电脑、真实内网站点或特定模型生成行为已现场通过。其他 DSH 版本、Windows 10 / Server / ARM64 未做本次真实验收。

现有插件 Agent 提示段、工具 Schema、SSH/SFTP 命令执行逻辑未变；暂缓的 SSH 命令参数空格问题仍不在本次范围。测试仅使用独立 profile，用户日常 DSH 配置、全局 skill 和 Chrome/Edge 安装未修改。

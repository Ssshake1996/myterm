# DSH Remote Ops

`@dsh/remote-ops` 是面向 DeepSeek Harness 的 SSH 远程运维插件。本仓库已完成产品边界切换，不再包含 myterm 桌面应用、Tauri 宿主或第二套 Agent 内核。

## 网页操作参数修复（v0.5.1）

本版本修复 Agent 调用网页操作时，空 `flowId` 覆盖有效 `steps`、持续出现 `BROWSER_FLOW_NOT_FOUND` 的问题。修复、校验、工具说明和 `remote-ops-browser` skill 都随插件 tgz 分发，**不需要修改 Agent、DSH 内核或另行复制 skill**。

- 普通网页操作传 `steps` 数组并省略 `flowId`；为兼容空值，`null`、空字符串和空白字符串均按未提供流程 ID 处理。
- 保存流程只使用列表返回的真实 `flow.id`，且 `flow.siteId` 必须等于目标浏览器的 `siteId`。非空 `flowId` 与非空 `steps` 同时提供会被拒绝；保存流程可省略 `steps` 或传空数组。
- 参数冲突、未提供操作、步骤格式错误、流程不存在、流程网站不匹配分别返回具体错误与恢复办法。这些参数校验在动作派发前失败，不会自动重试、改选浏览器或放宽凭据域名限制。
- 插件加载后通过 DSH 原生 skill 服务全局提供 `remote-ops-browser` 指南，Agent 可自动发现并加载，也可在对话中用 `/remote-ops-browser` 调用；卸载插件后移除注册，不写入或覆盖用户的全局 skill 文件。此机制已验证于 DSH 0.2.0-rc.2。
- 升级后完全停止旧 DSH 进程，重新启动并刷新网页，使已安装插件、skill 和工具说明重新加载。无需迁移 Agent 配置；另一台内网电脑只需安装同一 tgz。

## 工作区与交互（v0.5.0）

- 顶部“终端 / 网页 / 文件”标签支持方向键、Home/End；环境管理独立展开在插件内，“更多设置”收纳诊断、刷新及更新。左侧入口仍打开 DSH 原生右栏，不替换主对话。
- 当前模块、选中终端和环境筛选按 DSH 对话恢复，关闭再打开面板及网页刷新均可恢复。文件路径、排序、滚动及书签沿用原有存储；文件筛选、路径草稿和仍存在的选中项在同一网页内跨模块/面板切换保留，整页刷新后重新读取目录，不恢复旧选择。
- 终端字号、换行和 PTY 大小收进“终端显示设置”，Agent 绑定、工具读取回执等收进“状态详情”。普通 ASCII/SGR 日志使用快速解析，光标控制、Unicode 和全屏程序仍使用 VT 屏幕模型。
- 网页默认“跟随面板”视口，可选 1024×768“桌面视口”；调整视口不主动导航或重载页面，网站自身响应式行为仍可能改变内容。独立窗口使用其自身尺寸。标签显示网页标题，可关闭当前标签页；显示模式切换前提示重载及未提交内容丢失。
- 文件工作区增加目录筛选、全选、Shift 连续选择及 Enter 打开文件夹；窄面板用“来源 A / 目标 B”切换，复制按钮标明目标，已结束的传输记录折叠。上传/下载中的“本机”指当前浏览器设备，DSH 主机仍作为单独位置。
- 独立命令在后端运行，关闭结果视图、切换模块或刷新 DSH 网页不会取消；重新打开可读取当前目标的最近任务与结果。结果只保留于本次 DSH 进程内，最多 32 项、完成后最多 10 分钟；草稿正文仅在当前网页内保留。DSH 重启后不恢复、不自动重跑；超时或远端退出未知均不表示进程已结束。
- 分组输入、删除/覆盖确认使用插件内弹层；Tab 保持在弹层控件中，Esc 关闭并返回入口。弹层限于插件区域，主对话继续可用。环境校验和目录重试就近显示；诊断默认显示事件摘要，原始 JSON 可展开。

人和 Agent 始终共享网页与终端；没有新增接管、暂停、停止按钮或对应工具。SSH 参数空格问题不在本版本修复范围。

## 共享网页操作（v0.5.0）

在“网页”模块直接输入网址并按 Enter，即可浏览，无需先保存网站。支持“插件内”实时交互画面和“独立窗口”，用户可配置；Agent 通过主对话操作当前网页。人和 Agent 共享同一页面，对话执行期间也可点击、滚动、输入和人工登录，不需要接管或交还。

网页与终端面板不保留接管、暂停、停止按钮，也不增加对应 Agent 工具。停止 Agent 使用 DSH 原生停止对话入口；网页后续步骤随对话取消，当前已发出的操作不会回滚。切换模块、收起右栏及刷新 DSH 页面不会取消后台网页任务。

支持 XPath/CSS/role/label/text/placeholder、iframe、弹出网页、可选登录配置与参数流程、结果检查和操作记录。密码使用本机 Harness 凭据服务，浏览器 profile 按对话和网站隔离。首次从“浏览器设置与高级功能”安装专用 Chromium，或选择本机 Edge / Chrome。独立窗口要求 DSH 与用户位于同一交互桌面；插件内模式在 DSH 网页中显示专用浏览器画面。切换显示方式会重新载入网页，保留登录 Cookie，未提交表单不会恢复。详见[网页操作使用说明与边界](integrations/dsh-remote-ops/WEB.md)。

## 能力

- DSH Web 左侧底部 `Remote Ops` 入口打开原生右侧 Sidebar，主对话和草稿保持可见；重复点击复用已有标签页。左侧入口展开时图标与文字左对齐，缩进与宿主原生入口一致；收起时仅显示居中的图标和 Tooltip。
- 三个工作区标签、面板内环境管理及统一的辅助设置入口。
- 环境分组、SSH 环境的创建、编辑、删除和持久化。
- 多 SSH 终端标签，终端始终作为主要工作区。
- 终端使用轻量 VT 屏幕模型处理 ConPTY 清屏、光标定位和回车覆盖；输出增量传输，完整滚动条可滚动到最后一行。
- 无 SSH 会话时默认进入本地 CMD，工作目录为 `$DSH_HOME/remote-ops`；可直接执行 `ssh` 等命令，SSH 断开后自动回退。
- Agent 与界面读取同一终端输出流；发送返回有界增量，可用 `streamId` 和游标续读，不因回显或静默重复发送。静默不等于命令完成。
- 终端显示连接、Agent 绑定及等待状态；阅读历史时保留位置，新输出可一键回到底部，SFTP 切换和窗口缩放保持滚动意图。
- 常用命令按钮位于终端下方，直接向当前终端下发；支持增删改查、分组、排序、隐藏按钮及按命令开启执行前确认。
- 常用命令窗格上边界可上下拖拽，不限两行，内部滚动且记住高度；检查更新和刷新均提供明确的进行中、成功或失败反馈。
- 多行命令一次性下发，不拆成大量短请求。
- SFTP 目录读取、文件读写、创建目录、删除和重命名。
- 环境连接复用/选择、逐个释放、断开后保留输出和显式重连；人工与 Agent 共享同一输入流，对话期间均可输入。
- 独立命令返回真实退出码、stdout/stderr 和耗时，不污染交互终端；工具回执仅表示实际返回过的输出范围。
- SFTP 双位置文件工作区、浏览器文件上传/下载、流式多选/目录传输、逐项结果与重试、覆盖预览、定位和路径偏好；脱敏诊断预览导出。
- 浏览器批量上传在同一浏览器页内跨终端、SFTP 和插件面板切换继续，返回可查看进度和取消；关闭/刷新整页、卸载插件或停止 DSH 可能中断，不支持断点续传。
- 目录刷新跳过历史完成任务，合并新完成任务并串行处理同一面板请求，保留列表、滚动位置及仍存在的选中项。
- 窄屏文件区使用来源/目标切换，历史传输折叠，保留可操作的文件列表高度。
- Multi-SSH 顺序协同工具、Agent 可读诊断和 Harness 凭据引用。
- Sidebar 显示插件版本，支持检查 GitHub Release 并一键安装升级；升级后重启 DSH 即可生效。

## 安装

从 [GitHub Releases](https://github.com/Ssshake1996/myterm/releases) 下载插件包，然后执行：

```powershell
dsh plugin --profile web add .\dsh-remote-ops-v0.5.1.tgz
dsh web
```

升级时，在运行 DSH 的同一用户和 `DSH_HOME` 下执行安装命令；`--profile web` 必须与实际启动的 profile 一致。安装完成后完全停止原 DSH 进程，重新启动并刷新浏览器，确认 Remote Ops 标题显示 `v0.5.1`。环境、快捷命令、网站和流程保留；终端与浏览器需重新打开，运行中的任务不跨 DSH 重启恢复。

在 DSH Web 左侧底部点击 `Remote Ops` 打开右侧 Sidebar，主对话不被替换。入口使用官方 `sidebar.footer.action` 操作位和 `sidebarRight.openTab`，不再注册切换主工作区的 `sidebar.panellist` / `main`。已在 DSH `0.2.0-rc.2` 实测；其他宿主版本尚未实测。若未出现入口，先核对安装 profile、DSH 版本及已安装插件版本，并确认旧 DSH 进程已退出；无需手工复制 bundle patch。窄屏下右栏可能按宿主规则展开为全屏，收起即可返回原对话。

本地开发检查：

```powershell
npm --prefix integrations/dsh-remote-ops ci
npm --prefix integrations/dsh-remote-ops test
npm --prefix integrations/dsh-remote-ops run check
```

## 目录

```text
integrations/dsh-remote-ops/
├─ lib/index.js       # 插件入口：apply 与对外导出
├─ lib/state/         # RemoteOpsState：按领域分层（环境、快捷命令、连接、终端读写、文件、更新…），入口 state/index.js
├─ lib/terminal-send.js     # 发送流程：预设、自动应答、输出渲染
├─ lib/terminal-script.js   # remote_terminal_script 多步骤执行
├─ lib/terminal-sessions.js # SSH/本地/宿主接管终端会话与 SendOperation
├─ lib/tools.js, routes.js  # Agent 工具注册与 HTTP 路由
├─ lib/cli-profile.js, cli-assist.js, output-render.js, ansi.js # 设备 CLI 辅助与输出渲染
├─ lib/client.js      # DSH Web 左侧入口与原生右侧 Sidebar
├─ cordis.patch.yml   # 官方 DSH bundle patch
└─ test/               # 单元、客户端行为、契约和烟测回归集
```

运行数据由插件独立保存到 `$DSH_HOME/remote-ops`：

```text
remote-ops/
├─ environments/<group>/environments.<group>.json
└─ quick-commands/<group>/commands.<group>.json
```

SSH 密码和私钥不写入 JSON；密码通过 Sidebar 表单保存到 Harness credentials，环境文件只保存引用。

## 发布

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/release-dsh-remote-ops.ps1 -Version 0.5.1
```

发布只有一份实现：`scripts/release-dsh-remote-ops.mjs`（Node，Windows/Linux/macOS 通用）。`scripts/release-dsh-remote-ops.ps1` 只是委托它的薄封装，`-SkipPublish` 对应 `--no-push`。

```sh
node scripts/release-dsh-remote-ops.mjs 0.5.1            # 校验、门禁、打包、提交、打 Tag、推送，并等待 Release 发布后核对包摘要
node scripts/release-dsh-remote-ops.mjs 0.5.1 --dry-run  # 只校验、跑门禁并打包，不动 git
```

选项：`--no-push`（只在本地提交和打 Tag）、`--no-wait`（推送后不等待 Release）、`--remote <name>`、`--branch <name>`、`--wait-minutes <n>`。GitHub Release 由推送 Tag 触发的 `.github/workflows/release.yml` 创建：它校验 Tag、`package.json` 版本和发布说明一致，执行完整门禁，打包并创建（或更新）Release，上传安装包与 SHA256 文件。脚本随后轮询 Release，比较 GitHub 报告的安装包摘要与本地摘要。

发布脚本在改动 git 之前先校验所有版本载体（`package.json`、锁文件、`version.js`、`client.js` 默认值、发布说明标题、四份 README 的安装示例及根 README 的发布示例）一致，再执行一次完整回归门禁（包含语法检查、单元、客户端行为、契约和烟测），通过后才打包、提交、创建 Tag 并推送。根目录中英文 README 与插件目录一起纳入发布提交。测试矩阵和 3080 页面验收要求见 `docs/testing/dsh-remote-ops-test-plan.md`。

## 边界

- Agent Loop、Session、Goal、Skill、MCP、权限和本地工具完全由 DeepSeek Harness 负责。
- 本插件提供 SSH、交互式终端、SFTP、快捷命令、共享网页、多 SSH 和远程诊断能力。
- 本仓库不再构建或启动 myterm 桌面程序。

详细说明见 [插件中文说明](integrations/dsh-remote-ops/README.zh-CN.md)、[插件英文说明](integrations/dsh-remote-ops/README.md)、[开发经验记录](docs/development-experience.md)、[开发交接说明](docs/development-handoff.md) 和 [新对话 Prompt](docs/prompts/new-development-session.md)。

# dsh-remote-ops 开发交接说明

> 基线日期：2026-10-10
> 基线版本：`dsh-remote-ops v0.2.25`
> 基线提交：以 `git log -1` 为准  
> 项目根目录：`F:\myterm`  
> GitHub：`Ssshake1996/myterm`

## 1. 产品边界

本仓库当前只维护 DeepSeek Harness 的 `@dsh/remote-ops` 插件，不再维护 myterm 桌面程序、Tauri 宿主、旧 Agent 内核或第二套模型循环。

DeepSeek Harness 负责：

- Agent Loop、Session、Goal、Skill、MCP、权限和本地工具。
- 对话、模型、上下文、长任务和 Harness Web UI。
- 插件生命周期、Sidebar 服务和 Agent 会话边界。

Remote Ops 插件负责：

- SSH 环境和分组持久化。
- 本地 CMD 工作区、SSH PTY 和多终端标签。
- 完整命令、原始按键、信号和多 SSH 顺序协同。
- SFTP 文件操作。
- 快捷命令及其分组。
- Agent 可调用的远程运维工具和诊断事件。
- DSH Web 右侧 Sidebar 的远程运维工作区。

开发时不能把 Agent Loop、权限系统、MCP 调度或旧 myterm 代码重新引入插件。

## 2. 当前版本状态

v0.2.25 在 v0.2.24（设备 CLI 的 `autoConfirm`/`autoQuitMore`/`autoSigint`）之上交付（`autoConfirm`/`confirmPattern` 之后已移除，见下）：环境 CLI 预设（`cliProfile`）、返回输出去 ANSI（`stripAnsi`）和长输出头尾摘要（`headTailChars`，被省略的原始偏移区间可用 `remote_terminal_read` 读回）、`remote_terminal_script` 多步骤应答、SSH 终端尺寸调整与掉线原因/重连提示、`lib/index.js` 按职责拆分、跨平台 Node 发布脚本，以及“工具只转发已声明参数”的加固（未声明的 `actor: "manual"` 曾可绕过人工输入保护）。详见 [v0.2.25 发布说明](releases/dsh-remote-ops-v0.2.25.md) 和开发经验第 46 节。

自动化测试全部使用脚本化 fake PTY/fake SSH 通道，没有连接真实设备 CLI，也没有做 3080 宿主页面验收；嵌套的工具参数 schema 只按宿主 DSL 规则校验，没有在真实 DSH 宿主上加载验证（注册失败只会在 `remote_diagnostics.toolWarnings` 中报告，不会让插件无法启动）。

以下为 v0.2.22 时的状态记录，仍然有效：

v0.2.22 提供终端下方直接执行的常用命令按钮及可上下拖拽的窗格。复用现有命令库，支持增删改查、多行、分组、搜索、排序、隐藏/恢复按钮和按命令启用确认。默认展开；高度按插件实际空间限制，不限两行或 360px，命令内部滚动，保留最低终端可视区域并持久化高度和展开状态。

下发锁定 owner、具体终端、输出流及命令版本，一次写入完整命令和 Enter，不经过模型，不自动连接/换目标/接管/重发。十分钟、最多 1024 条的进程内回执用于并发及网络重试去重，不宣称无限期持久幂等。当前浏览器未提交输入和 Agent 活动发送会阻止下发；写入回执不代表执行完成，未知错误保留阶段、错误码及堆栈。新增元数据使用正常缺省值，没有旧系统迁移或第二套命令数据。

v0.2.21 已撤回的跨浏览器输入权锁、连接编号/备注保持撤回。人工与 Agent 输入协调、owner/stream 校验、每会话每环境最多 3 条 SSH 连接及指定释放不变；其余 SFTP、独立命令和 VT 能力保留。不得用隐式锁替代已撤回的功能。

- 四层自动化测试接入 `npm test`，`npm run check` 是唯一发布门禁；Release 脚本再次调用。
- 当前检查通过：56 项后端/传输/路由/独立命令、27 项客户端、7 项契约及烟测，新增回归先红后绿。
- 测试矩阵见 [测试计划](testing/dsh-remote-ops-test-plan.md)，发布说明见 [v0.2.22](releases/dsh-remote-ops-v0.2.22.md)。
- 运行时提交 `9d02e2d`，Tag `dsh-remote-ops-v0.2.22`；[正式 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.2.22) 已发布。交接和验收记录另作文档提交，不再发布版本。

3080 主流程已验证 CMD 中文/多空格/多行，双击单请求，半条输入拒绝，确认/隐藏/恢复/排序/放弃修改/删除；36 条命令从 190px 拖到约 556px，收起、SFTP 往返及刷新保持高度。390px 窄屏保留 100px 输出区，主流程未捕获页面异常为零。240 行输出的历史阅读位置在调整高度及切换 SFTP 后保持 scrollTop=8581.6。一次本机点击至写入回执样本为 63ms，不是命令完成或其他电脑的性能承诺。

真实 SSH `笔记本` 的 `pty-2` 回显 `QUICK022-SSH  中文`，本地 CMD 游标未改变；重复请求复用回执，旧流请求 HTTP 400 / `TERMINAL_STREAM_CHANGED` / `quick.dispatch`。SFTP /tmp 列出 34 项，测试 SSH 已释放。

已从 GitHub 正式下载地址安装到 web profile 并重启 3080，页面显示 v0.2.22。正式包 SHA256 `222222091e1b06fb03c64bdf029330ac85ef8d314a0f40e5140b14950dc75698` 与 GitHub asset digest 一致，安装后的 client.js 与源码一致。正式复核 CMD 回显、双击单次下发、复制、SFTP 往返、高度恢复（492.4px）、分组改名拒绝旧版本编辑及 390px 编辑弹窗通过。在线检查更新返回 HTTP 200、current/latest=0.2.22；v0.2.21 的历史匿名 API 403 本轮未复现，未注入开发凭据。启动 stderr 仅宿主 SQLite ExperimentalWarning。

测试命令和临时分组已清理，保存环境未删除；本地输入已交还，窗格复位 190px。后台宿主日志：`output/dsh-022-release-stdout.log`、`output/dsh-022-release-stderr.log`；截图及临时验收脚本位于忽略的 `output/playwright/`，不能当成可移植自动化门禁。

本轮未重复真实模型调用、两台物理客户端、OS 输入法候选提交、文件传输字节校验及 top/vim；历史证据不能写成本轮成功。插件不能判断所有交互程序是否在等待输入，也不阻止其他浏览器同时输入。宿主没有运行时 PTY resize API，仍为 160×40 网格。3080 仅为开发验收环境，不是其他电脑的生产事实来源。

## 3. 目录和职责

```text
F:\myterm
├─ integrations/dsh-remote-ops/
│  ├─ lib/index.js          # 插件入口：apply 装配与对外导出（约 30 行）
│  ├─ lib/state/            # RemoteOpsState，按领域拆成可组合的层（每层 < 300 行）
│  │  ├─ index.js           #   组合入口：StateBase + 各层 mixin，导出 RemoteOpsState
│  │  ├─ base.js            #   构造函数、load、readJson（所有层共享的字段在此创建）
│  │  ├─ environments.js    #   环境/分组的持久化、规范化、查找、删除
│  │  ├─ quick-commands.js  #   快捷命令/分组、排序、按钮直接下发
│  │  ├─ connections.js     #   SSH 连接：spawn/open/reconcile、凭据、resize、掉线记录
│  │  ├─ terminal-io.js     #   输出帧、读取、输入协调、send/input/signal
│  │  ├─ snapshots.js       #   快照、目录、诊断事件、工具回执
│  │  ├─ local-terminal.js, commands.js, files.js, updates.js  # 本地 CMD、独立命令、文件/SFTP、更新检查
│  ├─ lib/terminal-send.js  # 发送流程：环境预设、提示规则/自动应答、输出渲染
│  ├─ lib/terminal-script.js # remote_terminal_script：校验后逐步执行并按检查停止
│  ├─ lib/terminal-sessions.js # SendOperation、SSH/本地/宿主接管终端会话
│  ├─ lib/tools.js          # Agent 工具与系统提示注册（含可选工具守卫）
│  ├─ lib/routes.js         # state/terminal/update/action HTTP 路由（action 为处理表）
│  ├─ lib/cli-profile.js    # cliProfile/终端尺寸校验与规范化、选项解析
│  ├─ lib/cli-assist.js     # 提示规则、answers 编译、污染检测
│  ├─ lib/output-render.js  # stripAnsi 分页读取与头尾摘要
│  ├─ lib/ansi.js           # ANSI 去除（带位置映射）与残缺转义检测
│  ├─ lib/common.js, errors.js, constants.js, output-buffer.js, release.js # 校验/错误/常量/输出缓冲/更新检查
│  ├─ lib/client.js         # DSH Web Sidebar 客户端和终端显示
│  ├─ lib/transfers.js      # 流式文件适配器、队列、冲突和取消
│  ├─ lib/commands.js       # 宿主 subprocess/SSH exec 非交互命令
│  ├─ lib/workspace-routes.js # 连接/控制/文件 HTTP 契约
│  ├─ lib/diagnostics.js    # 原始错误链与白名单导出
│  ├─ lib/version.js        # 插件名称、版本和仓库
│  ├─ cordis.patch.yml      # DSH bundle patch
│  ├─ package.json          # npm scripts 和运行依赖
│  └─ test/
│     ├─ unit.test.mjs      # 后端纯逻辑和缓冲区
│     ├─ routes/cli-assist/script/ssh-session/output-render.test.mjs # 路由、设备 CLI 辅助、脚本、SSH 会话、输出渲染
│     ├─ release-script.test.mjs # 发布脚本（临时 git 仓库 + 裸远端 + 脚本化 GitHub API）
│     ├─ helpers.mjs, server-source.mjs, check-syntax.mjs # 共享夹具、服务端源码读取、全量语法检查
│     ├─ client-behavior.test.mjs # 生产 client.js 的 VT/SSH 行为
│     ├─ contract.test.mjs  # 工具、路由、UI/发布契约
│     └─ smoke.mjs          # 静态烟测
├─ docs/testing/            # 测试矩阵和 3080 页面验收
├─ docs/releases/           # 每个插件版本的发布说明
├─ docs/development-experience.md # 按版本积累的开发经验
├─ e2e/                    # 浏览器验收：真实 Chrome、生产 client.js、假设备、自动截图和执行报告
├─ scripts/release-dsh-remote-ops.mjs # 唯一的发布实现（跨平台 Node）
├─ scripts/release-dsh-remote-ops.ps1 # 委托上面脚本的薄封装
└─ .github/workflows/ci.yml, release.yml # CI 门禁；推送 dsh-remote-ops-v* Tag 后发布 GitHub Release
```

插件包通过 `package.json.files` 只发布运行时文件和 README，不把测试目录打进生产包；测试仍保留在源码仓库和 CI 中。

## 4. 运行时架构

### 4.1 Host

`lib/index.js`（入口）通过 Harness 注入服务：

```text
connection / systemPrompt / tools / terminals / agents / credentials / subprocess
```

核心对象：

- `RemoteOpsState`（`lib/state/`）：环境、快捷命令、会话、事件、掉线记录和 Release 状态。它是由 `StateBase` 加九个领域层（mixin 工厂 `(Base) => class extends Base`）组合出的一个对象，方法原样分布在各层；没有任何层覆盖另一层的方法（`test/state-layers.test.mjs` 检查方法清单、唯一归属和每个文件不超过 300 行）。新增方法放进最相关的层，层太大就再拆，不要回到一个大文件。发送流程委托 `performSend`（`lib/terminal-send.js`）。
- `TerminalOutputBuffer`：有界 UTF-8 输出、绝对游标、增量读取和长轮询等待。
- `LocalCmdTerminalSession`：无 SSH 时默认启动的本地终端。
- `SshTerminalSession`：owner-scoped SSH PTY 会话。
- `SendOperation`：完整命令发送、等待和结果读取。
- `performSend`：解析环境预设与调用参数 → 提示规则循环（分页退出、`(y/n)`、脚本 answers，各有次数上限）→ 参数错误清行 → 渲染（去 ANSI、头尾摘要）。自动动作写入返回值 `autoActions` 和诊断事件。
- `runScript`：先编译全部步骤再逐步调用 `send`；`failOn` 通过 `collectRaw` 检查完整原始输出。

### 4.2 Client

`lib/client.js` 注册 DSH Web 右侧 Sidebar：

- 终端是主要工作区，一直占据主区域。
- 环境通过可隐藏抽屉管理。
- 常用命令位于终端下方，默认展开，记住展开状态及可拖拽高度；按钮直接下发，管理独立。
- SFTP 改为占满插件主区的本地/远端双栏工作区，诊断仍通过辅助面板打开。
- 没有 SSH 会话时显示本地 CMD。
- 面板启动按钮只打开右侧 Sidebar，不启动新的 DSH 对话。

终端显示使用轻量 VT 屏幕模型处理 ConPTY 的清屏、光标定位、回车覆盖、滚屏和控制键；不引入完整 xterm 依赖。输出通过 `/api/dsh-remote-ops/terminal` 以绝对游标增量和长轮询传递。

### 4.3 持久化

运行数据位于 `$DSH_HOME/remote-ops`：

```text
remote-ops/
├─ environments/<group>/environments.<group>.json
└─ quick-commands/<group>/commands.<group>.json
```

环境 JSON 不能保存明文 SSH 密码。密码由 Harness `credentials.set` 保存，环境只保存合法的 `passwordRef`。私钥只保存本机路径引用。

本地 CMD 的工作目录同样是 `$DSH_HOME/remote-ops`。SSH PTY 是进程内状态，重启后需要重新打开；环境定义和快捷命令会保留。

## 5. Agent 工具边界

当前 Host 工具包括：

- 环境：`remote_environment_list/create/delete`，以及环境分组的 create/rename/delete。
- 终端：`remote_terminal_open/send/input/read/signal/close/batch/resize/script`。
- 独立命令：`remote_command_execute`，不继承交互终端工作目录/环境变量。
- 快捷命令：`remote_quick_command_list/save/delete/group_create/group_delete/run`。
- SFTP：`remote_sftp_list/read/write/mkdir/delete/rename/upload/download`。
- 诊断：`remote_diagnostics`。

工具原则：

1. 无交互依赖的独立命令优先 `remote_command_execute`，显式写出所需目录/变量；需要当前 shell 状态的命令一次性发送完整文本，保留空格和换行。
2. Tab/方向键/密码/交互程序使用原始输入；观察执行进展使用游标增量读取，不通过重发命令轮询。
3. 多 SSH 目标必须显式命名，按目标顺序执行并观察结果后再继续。
4. MCP 返回的产品知识只能用于生成或校验命令，不能代替真正的 SSH 执行结果。
5. 不能凭环境元数据声称连接成功，必须有实际终端结果。
6. `session: "local-cmd"` 是插件共享的本地 CMD，不是 Harness 内置 bash/pwsh；SSH 复用明确 sessionId，环境多连接时拒绝猜测目标。
7. 发送默认返回 16 Ki 码元的新输出；续读传 `cursor=nextOffset`、`streamId`、`waitMs`，先读完 `hasMore`。流替换或游标过期必须处理 `reset/truncated`。
8. `completion: "unknown"` 是刻意的契约：静默、超时和存活 PTY 都不证明命令完成。工具输出是原始流，不是渲染后的屏幕，也不提供任意交互程序的可靠退出码。
9. 独立命令只有实际观察到正常退出才返回 `completion: "exited"`；取消/超时/没有退出消息保持 unknown。远端通道关闭不证明进程已结束，不能伪造 terminationConfirmed。
10. 工具回执是 owner/stream 上实际返回的数据范围，不代表模型理解；UI 读流不能产生工具回执。人工输入不再使用浏览器 clientId；Agent 写入仍受人工状态保护，SSH 连接仍按 owner 隔离。
11. 设备 CLI 辅助：`remote_terminal_send/batch/quick_command_run/script` 支持 `autoQuitMore`、`autoSigint`，逻辑在 `lib/terminal-send.js` 与 `lib/cli-assist.js`，只作用于 Agent 发送；每步写入返回值 `autoActions` 与诊断事件，分页退出最多 3 次。**插件不会自动回答 `(y/n)`**：v0.2.24/v0.2.25 的 `autoConfirm`/`confirmPattern` 已移除（自动输入 `y` 可能批准破坏性操作）。仍传这两个参数的调用得到 `notices`；`cliProfile.autoConfirm/confirmPattern` 在保存时被拒绝（`REMOTE_ENV_INVALID`），旧环境文件里的残留值读盘时丢弃。不要重新引入内置的 `y`/`yes` 规则；契约测试会检查。
12. 环境预设（0.2.25）：`cliProfile` 提供上述选项及 `stripAnsi`/`headTailChars` 的默认值，调用参数优先；落盘前规范化（去掉默认值），保存空值清除、省略字段保留，读盘时容错（坏字段丢弃但不隐藏环境）。预设可以让某环境默认自动确认，所以表单必须保留“也会回答高风险提示”的警示。
13. 输出渲染（0.2.25）：`stripAnsi`/`headTailChars` 只改变返回给模型的文本；偏移和游标始终是原始流。去 ANSI 的分页会向前延伸到转义序列结束（不在序列中间截断）；流末尾残缺的序列直接丢弃。摘要返回 `omitted` 原始区间，摘要后的发送在回执中记为 truncated。
14. `remote_terminal_script`：全部步骤先编译校验再输入；`answers` 只在输出末尾匹配时回答，每项有 `times` 上限；`expect` 看输出末尾，`failOn` 看完整原始输出（`collectRaw`），不会被摘要隐藏；超时、取消、会话退出和检查失败都会停止并保留已执行步骤。答案会回答所有匹配提示，只脚本化用户已批准的命令。
15. 可选工具通过 `registerOptionalTool` 注册：宿主拒绝嵌套 schema 时只在 `remote_diagnostics.toolWarnings` 报告，不会让插件无法启动。工具只转发已声明参数（`pick`/`pickSendOptions`），内部开关（`actor`、`answers`、`collectRaw`）不能由模型参数传入。
16. SSH 尺寸与掉线（0.2.25）：`SshTerminalSession.resize` 使用 ssh2 `setWindow`；终端帧带 `size`，客户端按它换行。本地 CMD 固定 40×160，宿主接管会话不可调整。会话记录 `closeReason`，意外掉线写入 `state.disconnects`（每 owner 最近 10 条）和 `ssh.disconnected` 事件，主动释放不记录；永久 client `error` 监听避免迟到的传输错误变成未捕获异常。

## 6. 测试和发布门禁

在插件目录执行：

```powershell
cd F:\myterm\integrations\dsh-remote-ops
npm ci
npm test
npm run check
```

四层测试：

1. 后端单元：校验、错误、输出缓冲、游标、长轮询；设备 CLI 辅助、输出渲染、脚本、SSH 会话（fake 通道/客户端）、路由处理表、发布脚本（临时 git 仓库 + 裸远端）。
2. 状态集成：环境/分组/快捷命令/凭据及 `cliProfile`/终端尺寸的保存、清除和重载。
3. 客户端行为：生产 `client.js` 的 VT 屏幕模型、SSH 命令解析、环境表单辅助和尺寸选择（渲染辅助函数并触发回调）。
4. 契约和 Smoke：工具、API、CSS、增量传输、串行输入、工具 schema 符合宿主 DSL、发布脚本和包边界。契约/烟测读取 `lib` 下全部服务端模块（`test/server-source.mjs`），语法检查覆盖每个 `lib/*.js`（`test/check-syntax.mjs`）。

测试夹具要隔离开发者的全局 git 配置：全局 `commit.gpgsign` 和 `core.fsmonitor` 会让临时仓库测试变慢且不稳定。

新增功能必须先补测试；历史缺陷必须保留回归用例。测试失败时不能跳过门禁，也不能只修改测试让它通过。

## 7. 3080 页面验收

自动化测试通过后，在拥有 DSH Web profile 的机器上：

1. 启动 `dsh web --port 3080 --no-open`。
2. 打开 Remote Ops，确认版本、Sidebar、本地 CMD 和工作目录。
3. 执行短命令，确认输出、提示符和光标行完整。
4. 连续输出至少 200 行，确认竖向滚动、末行显示和底部跟随。
5. 上移滚轮后继续输出，确认不会抢回阅读位置；滚到底部后确认跟随恢复。
6. 切换环境、快捷命令、SFTP、诊断面板，确认终端没有被挤出或覆盖。
7. 分别在底部和历史阅读位置切换 SFTP；缩放窗口、展开快捷命令，确认底部跟随和阅读位置恢复。
8. 用真实模型发送一次无副作用的回显命令，再以返回游标续读；查看实际工具入参/结果，并核对 UI。不要只引用模型的成功描述。

3080 页面验收是宿主集成检查，不能替代自动化测试；验收结果应写入对应 Release 说明。

## 8. 构建、提交和发布

发布前修改版本：

- `integrations/dsh-remote-ops/package.json`
- `integrations/dsh-remote-ops/package-lock.json`
- `integrations/dsh-remote-ops/lib/version.js`
- `integrations/dsh-remote-ops/lib/client.js` 中的默认版本
- 双语 README 和新的 `docs/releases/dsh-remote-ops-vX.Y.Z.md`（标题必须是 `# dsh-remote-ops vX.Y.Z`）

然后执行（任意平台）：

```sh
node scripts/release-dsh-remote-ops.mjs X.Y.Z            # 完整发布
node scripts/release-dsh-remote-ops.mjs X.Y.Z --dry-run  # 只校验、跑门禁、打包
```

Windows 也可用 `scripts/release-dsh-remote-ops.ps1 -Version X.Y.Z`（只委托 Node 脚本，`-SkipPublish` 对应 `--no-push`）。脚本会：

1. 校验版本载体一致（`package.json`、锁文件、`version.js`、`client.js` 默认值、发布说明标题），并拒绝发布集合之外的已暂存改动和游离 HEAD。
2. `npm run check`。
3. `npm pack` 和 SHA-256 文件生成。
4. 只提交发布集合，创建带注释的 Tag（幂等；Tag 指向别的提交则拒绝），推送当前分支和 Tag。
5. 等待推送 Tag 触发的 `release.yml` 创建 GitHub Release，并核对 GitHub 报告的安装包摘要与本地一致（`--no-wait` 跳过）。

发布后需要更新本机 3080 profile，重启 DSH，再做一次安装态页面验收。安装态验证不需要重复完整 2000 行性能测试，但必须确认版本、短命令、终端尺寸和输出末行。

## 9. 已知限制和后续方向

- 插件包不带浏览器运行时。仿宿主验收在 `e2e/`，完整宿主验收是 `npm run e2e:host`（Node 24，钉死的 `@deepseek-ai/dsh@0.2.0-rc.2`，临时 `DSH_HOME`）。
- SSH/SFTP 的真实可用性受网络、远端权限、凭据和目标系统影响，自动化测试使用 fake terminal，不伪装成真实远程成功。每个 owner 在单个环境最多保留 3 个连接，具体连接通过 sessionId 释放。
- 输出缓冲保留有界历史，过期游标会返回受控最近内容，不承诺无限终端回放。断开标签最多保留 12 个；编号/备注不跨进程恢复。
- SFTP 任务与未完成项重试不跨 DSH 重启；浏览器只保存会话级路径/排序/滚动/书签，不保存旧列表或勾选。覆盖预览只读，不能替代传输时的再次检查。
- 独立命令每目标最多一个、总计最多 8 个；默认 30 秒、最长 300 秒，stdout/stderr 各默认 64 KiB、上限 256 KiB，超限继续排空并明确截断。
- 本地 CMD 是插件共享终端；SSH 仍按 Agent owner 隔离。Agent 绑定状态不是输出已读回执，工具/界面视图也不代表 shell 命令完成。
- 本地 CMD 固定 40×160（宿主没有运行时 resize API）；SSH 连接可调整，但已输出内容不重排；插件重载后由宿主持有（adopted）的连接不可调整。
- 脚本 `answers` 会在其 pattern 匹配时输入调用里声明的文本（包括确认提示处的 `y`）；目前没有按命令内容的白名单或拒绝名单，也不识别密码类提示，所以只脚本化用户已批准的操作。这是下一步安全护栏的候选项。
- 设备 CLI 辅助、脚本和输出渲染用脚本化 fake 终端验证。完整宿主层在真实 `dsh web` 里打开面板、本地 Shell、假设备确认、尺寸、掉线和滚动。真实设备的提示文本、回车语义、清行效果，以及模型调用工具，仍要在目标环境验收。
- 掉线记录是进程内的最近 10 条，不跨宿主重启；插件不会自动重连或重放命令。
- 不新增第二套 Agent 循环、权限门禁、MCP 调度或长期记忆。
- 后续若引入新 Transport、终端渲染器或持久数据格式，必须先更新交接文档、测试矩阵和迁移说明。

## 10. 新对话开始时的最小动作

新的 AI 对话接手后，应按以下顺序工作：

1. 阅读本文件、`docs/testing/dsh-remote-ops-test-plan.md`、根 README 和最近的 Release 说明。
2. 检查 `git status`、当前版本、当前 Tag 和测试入口。
3. 先把用户需求映射到功能矩阵，指出影响范围和可能退化点。
4. 对非 `/goal` 请求先复述需求并等待确认；确认后先补测试，再实现。
5. 执行 `npm run check`，必要时执行 3080 页面验收。
6. 按用户既定流程提交 Git 并发布 Release，最终返回测试结果、commit、tag 和 Release 链接。

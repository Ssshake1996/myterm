# dsh-remote-ops 开发交接说明

> 基线日期：2026-09-15  
> 基线版本：`dsh-remote-ops v0.2.12`
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

v0.2.12 在 v0.2.11 的持续回归基础上，补充了 PTY 会话协调、宿主会话恢复、IME 输入和精确提交回传；本次交接重点是把需求、开发、测试和发布流程固化为新对话可直接使用的上下文：

- 四层自动化测试已经接入 `npm test`。
- `npm run check` 是唯一发布门禁。
- Release 脚本在打包、提交和发布前必须通过完整检查。
- 测试计划位于 [dsh-remote-ops-test-plan.md](testing/dsh-remote-ops-test-plan.md)。
- 正式 Release 位于 [GitHub Releases](https://github.com/Ssshake1996/myterm/releases)。

本机 DSH Web 的 3080 端口只是开发验收环境，不是生产数据或用户环境的事实来源。真实 SSH、SFTP、网络、凭据和 DSH 版本差异必须在对应环境单独验证。

## 3. 目录和职责

```text
F:\myterm
├─ integrations/dsh-remote-ops/
│  ├─ lib/index.js          # Harness Host、状态、SSH、SFTP、工具、路由
│  ├─ lib/client.js         # DSH Web Sidebar 客户端和终端显示
│  ├─ lib/version.js        # 插件名称、版本和仓库
│  ├─ cordis.patch.yml      # DSH bundle patch
│  ├─ package.json          # npm scripts 和运行依赖
│  └─ test/
│     ├─ unit.test.mjs      # 后端纯逻辑和缓冲区
│     ├─ client-behavior.test.mjs # 生产 client.js 的 VT/SSH 行为
│     ├─ contract.test.mjs  # 工具、路由、UI/发布契约
│     └─ smoke.mjs          # 静态烟测
├─ docs/testing/            # 测试矩阵和 3080 页面验收
├─ docs/releases/           # 每个插件版本的发布说明
├─ docs/development-experience.md # 按版本积累的开发经验
└─ scripts/release-dsh-remote-ops.ps1 # 统一发布脚本
```

插件包通过 `package.json.files` 只发布运行时文件和 README，不把测试目录打进生产包；测试仍保留在源码仓库和 CI 中。

## 4. 运行时架构

### 4.1 Host

`lib/index.js` 通过 Harness 注入服务：

```text
connection / systemPrompt / tools / terminals / agents / credentials / subprocess
```

核心对象：

- `RemoteOpsState`：环境、快捷命令、会话、事件和 Release 状态。
- `TerminalOutputBuffer`：有界 UTF-8 输出、绝对游标、增量读取和长轮询等待。
- `LocalCmdTerminalSession`：无 SSH 时默认启动的本地终端。
- `SshTerminalSession`：owner-scoped SSH PTY 会话。
- `SendOperation`：完整命令发送、等待和结果读取。

### 4.2 Client

`lib/client.js` 注册 DSH Web 右侧 Sidebar：

- 终端是主要工作区，一直占据主区域。
- 环境通过可隐藏抽屉管理。
- 快捷命令固定在终端下方，可拖拽调整高度。
- SFTP 和诊断通过右侧辅助面板打开。
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
- 终端：`remote_terminal_open/send/input/read/signal/close/batch`。
- 快捷命令：`remote_quick_command_list/save/delete/group_create/group_delete/run`。
- SFTP：`remote_sftp_list/read/write/mkdir/delete/rename`。
- 诊断：`remote_diagnostics`。

工具原则：

1. 已知命令优先一次性发送完整文本，保留参数之间的空格和换行。
2. 只有 CLI 状态不确定、需要 Tab/方向键/密码/交互程序时才使用原始输入或增量读取。
3. 多 SSH 目标必须显式命名，按目标顺序执行并观察结果后再继续。
4. MCP 返回的产品知识只能用于生成或校验命令，不能代替真正的 SSH 执行结果。
5. 不能凭环境元数据声称连接成功，必须有实际终端结果。

## 6. 测试和发布门禁

在插件目录执行：

```powershell
cd F:\myterm\integrations\dsh-remote-ops
npm ci
npm test
npm run check
```

四层测试：

1. 后端单元：校验、错误、输出缓冲、游标、长轮询。
2. 状态集成：环境/分组/快捷命令/凭据的保存和重载。
3. 客户端行为：生产 `client.js` 的 VT 屏幕模型和 SSH 命令解析。
4. 契约和 Smoke：工具、API、CSS、增量传输、串行输入、发布脚本和包边界。

新增功能必须先补测试；历史缺陷必须保留回归用例。测试失败时不能跳过门禁，也不能只修改测试让它通过。

## 7. 3080 页面验收

自动化测试通过后，在拥有 DSH Web profile 的机器上：

1. 启动 `dsh web --port 3080 --no-open`。
2. 打开 Remote Ops，确认版本、Sidebar、本地 CMD 和工作目录。
3. 执行短命令，确认输出、提示符和光标行完整。
4. 连续输出至少 200 行，确认竖向滚动、末行显示和底部跟随。
5. 上移滚轮后继续输出，确认不会抢回阅读位置；滚到底部后确认跟随恢复。
6. 切换环境、快捷命令、SFTP、诊断面板，确认终端没有被挤出或覆盖。

3080 页面验收是宿主集成检查，不能替代自动化测试；验收结果应写入对应 Release 说明。

## 8. 构建、提交和发布

发布前修改版本：

- `integrations/dsh-remote-ops/package.json`
- `integrations/dsh-remote-ops/package-lock.json`
- `integrations/dsh-remote-ops/lib/version.js`
- `integrations/dsh-remote-ops/lib/client.js` 中的默认版本
- `integrations/dsh-remote-ops/test/smoke.mjs` 中的版本断言
- 双语 README 和新的 `docs/releases/dsh-remote-ops-vX.Y.Z.md`

然后执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/release-dsh-remote-ops.ps1 -Version X.Y.Z
```

脚本会执行：

1. `npm run check`。
2. `npm pack` 和 SHA-256 文件生成。
3. Git commit、Tag、推送 `main`。
4. 创建或更新 GitHub Release 并上传包和校验文件。

发布后需要更新本机 3080 profile，重启 DSH，再做一次安装态页面验收。安装态验证不需要重复完整 2000 行性能测试，但必须确认版本、短命令、终端尺寸和输出末行。

## 9. 已知限制和后续方向

- 没有把完整浏览器运行时放进插件包；页面测试依赖 DSH Web 宿主。
- SSH/SFTP 的真实可用性受网络、远端权限、凭据和目标系统影响，自动化测试使用 fake terminal，不伪装成真实远程成功。
- 输出缓冲保留有界历史，过期游标会返回受控最近内容，不承诺无限终端回放。
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

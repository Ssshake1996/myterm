# dsh-remote-ops v0.2.25

## 变更

面向远端设备 CLI（自定义 REPL）和长任务的第二批改进，建立在 v0.2.24 的 `autoConfirm`/`autoQuitMore`/`autoSigint` 之上。以下能力只作用于 Agent 工具，界面手动输入不受影响。

- **环境 CLI 预设**：环境可带 `cliProfile`（`autoConfirm`、`confirmPattern`、`autoQuitMore`、`autoSigint`、`stripAnsi`、`headTailChars`）和默认 PTY 大小 `terminal: { rows, cols }`。环境表单新增“设备命令行（CLI）辅助与终端大小”，并明确提示自动确认也会回答删除、变更等高风险提示；`remote_environment_create` 也接受这两个字段。调用参数始终优先于预设。落盘前规范化（与默认值相同的项不存），保存空值清除、省略字段保留；读盘时容错，字段损坏不会让环境消失。
- **返回输出去 ANSI（`stripAnsi`）**：send/read/batch/快捷命令/script 返回文本去除控制序列。游标和偏移仍按原始流计数；分页向前延伸到转义序列结束，不会把半个序列带进文本；流末尾残缺的序列直接丢弃。
- **长输出头尾摘要（`headTailChars`）**：只返回首尾各 N 个字符并附标记，结果带 `summarized` 和 `omitted`（字符数、行数、原始 `startOffset`/`endOffset`），被省略的区间可用 `remote_terminal_read` 读回。摘要后的发送在工具回执中记为 truncated，不再声称整页已返回。
- **多步骤脚本 `remote_terminal_script`**：一次调用在同一明确会话上顺序执行最多 20 步。每步可声明 `answers`（pattern → text，按顺序、每项有次数上限）、`expect`（必须匹配该步输出末尾）和 `failOn`（在完整原始输出中搜索，摘要隐藏的部分也会检查）。所有内容先校验再输入；遇到第一个错误、超时、检查失败或会话退出即停止，返回已执行步骤和 `stopped`，其余步骤不执行；`completion` 仍为 `unknown`。
- **SSH 终端尺寸**：新增 `remote_terminal_resize` 和界面“大小”选择（ssh2 `setWindow`），环境可设置新连接的默认大小；终端帧回报 PTY 大小，界面 VT 模型按真实宽度换行。共享本地终端仍固定 40×160（宿主没有 resize API），插件重载后由宿主持有的连接不可调整。
- **掉线原因与重连提示**：连接记录关闭原因（传输错误、远端退出码）。意外掉线出现在 `remote_environment_list` 的 `disconnects` 和诊断事件中；向已断开连接发送会说明“未重放任何命令”及重新打开的方法；因掉线结束的发送带 `reconnect`；界面显示断开原因。主动释放不记为掉线。常驻 client `error` 监听避免迟到的传输错误变成未捕获异常。
- **安全加固**：`remote_terminal_send/read` 只转发已声明的参数。此前模型可传入未声明的 `actor: "manual"` 绕过“人工正在输入”的保护（新增回归在旧代码上确认失败）。
- **代码结构**：`lib/index.js`（约 1400 行）按职责拆成 `state`、`terminal-send`、`terminal-script`、`terminal-sessions`、`tools`、`routes`、`cli-profile`、`cli-assist`、`output-render`、`ansi`、`common`、`errors`、`constants`、`output-buffer`、`release`。拆分前后注册的工具、路由和系统提示逐字相同（拆分前后各抓取一次比对），行为不变；工具定义每个属性一行，`action` 路由改为处理表。
- **发布**：新增跨平台 `scripts/release-dsh-remote-ops.mjs`（校验所有版本载体 → 门禁 → 打包/校验和 → 只提交发布集合 → 幂等带注释 Tag → 推送 → 等待 Tag 工作流发布 Release 并核对包摘要）。PowerShell 脚本只委托它，不再有第二套实现。
- 没有新增运行时依赖。

## 设计取舍

- 预设让某个环境可以默认自动确认；这是明确的取舍，表单警示、工具描述和系统提示都说明它会回答所有匹配的提示，没有按命令内容的白名单（见“已知边界”）。
- 摘要和去 ANSI 只改变返回给模型的文本，不改变流本身：偏移、游标、回执和 UI 读取都基于原始流。
- `expect`/`failOn` 只描述看到的文本，不证明命令完成；超时、取消、会话退出一律停止脚本，不把下一步敲进可能还在运行的终端。
- 新增的嵌套对象参数都有守卫：脚本工具整体通过 `registerOptionalTool` 注册；核心工具 `remote_environment_create` 的 `cliProfile`/`terminal` 参数若被宿主拒绝，则回退为不带它们的版本。两种情况都只在 `remote_diagnostics.toolWarnings` 报告，不会让插件无法启动。

## 自动化验证

- `npm run check`：通过。120 项后端/状态/传输/路由/设备 CLI 辅助/输出渲染/脚本/SSH 会话/发布脚本、39 项客户端行为、11 项契约及静态 smoke。
- 新增测试覆盖：去 ANSI 分页（任意页大小拼接后等于整体去 ANSI，游标单调不停滞）、头尾摘要的原始区间可读回、代理对不被切开、预设优先级与持久化、脚本停止语义和 `failOn` 不被摘要隐藏、SSH 尺寸与掉线（fake ssh2 客户端/通道）、`action` 路由处理表、工具 schema 符合宿主 DSL、`actor` 绕过回归、环境表单与尺寸选择的渲染及回调、发布脚本的完整流程（临时 git 仓库 + 裸远端 + 脚本化 GitHub API）。
- 发现并记录：开发机全局 `commit.gpgsign` 和 `core.fsmonitor` 会让临时仓库测试变慢且不稳定，测试夹具现在隔离全局 git 配置。

## 已知边界

- 所有设备 CLI 相关测试使用脚本化 fake 终端，没有连接真实设备，也没有做 3080 宿主页面验收；界面改动只验证了辅助函数的渲染与回调，没有在浏览器里点击过。真实设备的提示文本、回车语义和清行效果仍需在目标设备上确认。
- 嵌套的工具参数 schema 按宿主 DSL 规则校验，没有在真实 DSH 宿主上加载过。
- `autoConfirm`（含预设和脚本 answers）没有命令内容白名单，也不识别密码类提示。
- 本地 CMD 的尺寸不可调；adopted 连接不可调；掉线记录是进程内的最近 10 条，不会自动重连或重放命令。

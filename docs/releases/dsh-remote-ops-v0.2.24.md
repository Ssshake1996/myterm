# dsh-remote-ops v0.2.24

## 变更

面向远端设备 CLI（自定义 REPL，非 shell 模式）的插件层自动处理，减少 LLM 在重复确认、分页和参数错误上的推理往返。三项均只作用于 Agent 发送，不影响界面手动输入，所有自动步骤通过返回值 `autoActions` 和诊断事件可追溯。

- **自动确认 y/n（P0）**：`remote_terminal_send` 新增 `autoConfirm`（默认 false）和 `confirmPattern`。开启后，输出末尾匹配 `\(y\/n\)\s*$`（忽略大小写、去 ANSI）时自动发送 `y` 加回车并继续等待，单次调用最多 3 次，之后把提示交还调用方。`confirmPattern` 可自定义正则，非法正则在写入前返回 `AUTO_CONFIRM_PATTERN_INVALID`。
- **命令行污染检测 + 自动 SIGINT（P1）**：本次发送输出的最后 2KB 含 `^` 箭头加 `[param=?]` 建议（`/\n\s+\^\s*\n\s*\[.*\=.*\]/m`）时，自动发送 SIGINT 清行，等待 500ms 读取恢复输出，并在返回的 `output` 末尾追加 `[auto-sigint: command line cleared]`。默认开启，`autoSigint: false` 可关闭；标记只在返回值中，不写入终端流和游标。
- **分页自动退出（P2）**：新增 `autoQuitMore`（默认 false）。输出末尾为 `--More--` 时发送 `q`（不加回车），等待 300ms 读取剩余输出，单次调用最多 3 次。
- `remote_terminal_batch` 和 `remote_quick_command_run` 透传上述参数；批量命令现在也会把取消信号传给每条发送。
- 工具描述和系统提示说明了新选项，并要求只对用户已批准的命令开启 `autoConfirm`。
- 实现位于 `RemoteOpsState.send()`，只使用宿主公开的 `startSend`，因此本地 CMD、SSH 和宿主接管的会话行为一致；纯函数放在新增的 `lib/cli-assist.js`。没有新增运行时依赖。

## 设计取舍

- 自动应答使用 `\r` 提交，与 LLM 手动 `send("y")` 的写入完全一致；`q` 不加回车。
- 污染检测只看本次发送输出的尾部，避免长输出中间偶然出现类似文本误触发 SIGINT，也不会被更早命令的残留重复触发。
- `confirm` 与 `quit-more` 各自最多 3 次，防止提示反复出现时死循环；用尽后原样返回，由调用方决定。
- 后续每一步复用同一次调用的总超时预算，不会因为自动步骤延长等待上限。
- `autoConfirm` 会对所有匹配提示回答 `y`，包括高风险操作；默认关闭，是否开启由调用方负责。
- 通过宿主重建的 adopted 会话换了输出缓冲，污染检测在该情形下不触发（自动确认和分页退出仍可用）。

## 自动化验证

- `npm run check`：通过。64 项后端/状态/传输/路由/独立命令/CLI assist 测试、31 项客户端行为、9 项契约和静态 smoke。
- 新增 `test/cli-assist.test.mjs`（8 项）：双层确认依次回答、默认不触发且手动发送不触发、3 次上限后交还提示、自定义正则与非法正则不写入、`--More--` 发 `q` 并取回剩余输出、参数错误触发一次 SIGINT 且标记不进入终端流、`autoSigint:false` 与普通输出不触发。
- 契约测试新增：三个工具都暴露 CLI assist 参数，且返回 `autoActions`。

## 验证边界

- 以上均使用脚本化 fake PTY 模拟设备输出，没有连接真实设备 CLI，也没有做 3080 宿主页面验收；真实设备的提示文本、回车语义和 SIGINT 清行效果仍需在目标设备上确认。

# dsh-remote-ops v0.15.2

修复录制期间 Agent 调用 `remote_browser_recording`、`remote_browser_list` 和 `remote_browser_read` 时可能收到 `INVALID_TOOL_OUTPUT` 的问题。

原因是无错误时的录制摘要包含 `error: undefined`，DSH 在渲染前会校验原始工具结果，拒绝非 JSON 值。现在明确返回 `error: null`；真实错误仍保留原文。开始、停止、读取录制以及包含录制状态的浏览器列表和页面读取均纳入回归检查。

原生 DSH 安装验收增加“录制仍进行时”的 Agent 开始、浏览器列表、页面读取、录制读取检查；不再只检查停止后的记录。人工操作录制、JSON 导出及 Windows/Linux x64 随包浏览器继续保留。

桌面版请通过 DSH 自带插件管理安装附件，按安装器提示允许随包准备脚本。安装后结束正在运行的任务，完整退出并重新打开 DSH，确认 Remote Ops 设置中“当前运行”和“已安装”均为 **0.15.2**。桌面 profile 由 Electron 管理，不使用通用 CLI 强行修改。

Web profile 可使用 `dsh plugin --profile web add ./dsh-remote-ops-v0.15.2.tgz`。首次从 v0.14.1 及更早版本升级仍需使用 DSH 插件管理或 CLI，旧更新器有 64 MiB 下载限制。Linux 主机仍需提供 Chromium 系统动态库。

附件：`dsh-remote-ops-v0.15.2.tgz` 与 `SHA256SUMS-dsh-remote-ops-v0.15.2.txt`。发布工作流通过 Windows 检查和 Linux 原生安装验收后发布正式包。

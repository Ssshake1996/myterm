# Windows 桌面操作

在 DSH 对话中让 Agent 打开 Windows 软件、填写表单、点击按钮并检查结果。右侧 Remote Ops 的 **桌面** 工作区显示实际窗口，用户可随时点击画面、发送文字和快捷键。

## 准备目标

使用 x64 Windows 11，或安装了 Desktop Experience 的 Windows Server；执行器依赖 .NET Framework 4.8 及以上。目标用户需要已经登录且桌面解锁。Server 的多用户会话按账户和会话 ID 分开选择。

- **DSH 本机：** 选择“本机 Windows”。这里指 DSH 服务运行的电脑。
- **远程 Windows：** 在“环境 → SSH”保存地址、端口和账号凭据，目标系统选择 Windows。SSH 账号与已登录桌面账号一致。OpenSSH 需允许 SFTP、PowerShell 命令与本地 TCP 转发；首次连接自动部署随包执行器，不需要另外安装 Python、Playwright 或 .NET SDK。

执行器在选定用户会话中运行。远程启动使用该账号的 InteractiveToken 计划任务，启动完成后移除临时任务注册。桌面 RPC 经 SSH 转发到目标 `127.0.0.1` 的随机端口，并验证仅该用户可读的随机凭证；无需开放额外入站端口。文件放在目标 SFTP 初始目录下 `.dsh-remote-ops/desktop/<内容摘要>/`。本机执行器使用插件数据目录中的版本隔离副本，更新安装包不会替换正在运行的原生文件。

## 第一次使用

1. 打开右侧插件的“桌面”，选择环境，点击“检查会话”。多个活动会话时明确选择一个。
2. 点击“连接桌面”，从列表选择已经打开的软件，或点击“打开应用”填写绝对 `.exe` 路径。启动参数每行一个，保留空格和中文。
3. 在主对话描述具体任务，例如：**“连接 Windows 测试机，打开指定程序，在标题框输入‘巡检记录’，点击保存，核实保存后的文件。”**
4. 在窗口画面中直接点击控件；底部发送框输入中文或多行文字，Enter 发送、Shift+Enter 换行。画面获得焦点时可发送 Ctrl+S、Tab、方向键等快捷键，也可在目标电脑直接操作。
5. 展开“操作记录”检查结果；“更多 → 导出本会话桌面日志”打包当前对话的桌面记录和最后一张窗口图。

画面是实际窗口截图的定时刷新预览。Agent 执行期间无需切换接管模式；停止任务沿用 DSH 停止对话。单个已经送到 Windows 的动作可能完成，后续批次步骤停止。断开连接保留应用窗口，便于人工继续。

## Agent 接口

| 工具 | 用途 |
| --- | --- |
| `remote_desktop_connect` | 部署、检查会话或连接，返回当前对话的 `desktopId` |
| `remote_desktop_launch` | 启动绝对路径程序，参数为真实字符串数组 |
| `remote_desktop_observe` | 获取窗口列表、UIA 控件、快照及可选图片；`listOnly:true` 仅列窗口 |
| `remote_desktop_act` | 基于快照执行点击、填写、选择、勾选、按键、文字、滚动及结果断言 |
| `remote_desktop_read` | 查看连接状态及最近操作记录 |
| `remote_desktop_disconnect` | 断开空闲连接，保留程序及近期日志 |
| `remote_desktop_log_export` | 导出当前或本对话全部保留的桌面日志 ZIP，返回下载地址和 SHA256 |

安装后 DSH 原生发现 `remote-ops-desktop` skill。优先按 UIA 控件引用操作；只有模型支持图片时才请求 `image:true`，图片通过宿主附件服务提供。显示文字、窗口标题与文件内容均作为任务数据。软件可能启动另一个进程，启动 PID 不是“已就绪”的证明；此时重新列出窗口并选定正确窗口。

每次有副作用的操作提供 `requestId`，相同 ID 与相同参数返回保留结果，变更参数会拒绝。`steps` 为 1–10 个动作对象组成的真实数组。点击完成后仍需检查 UI 或文件，业务成功与操作已送达分别显示。

## 状态与恢复

- 灰色表示连接已断开，绿色表示可操作，黄色表示正在处理动作。颜色配合文字显示。
- 桌面锁定、RDP 会话断开或安全桌面出现时，恢复用户会话后重新观察。需要管理员权限的应用先由用户按正常系统流程处理权限。
- `DESKTOP_SNAPSHOT_STALE`：窗口位置或快照已变化，重新观察后决定下一步。UIA 引用最长保留 45 秒，鼠标键盘快照最长 8 秒。
- `DESKTOP_OUTCOME_UNKNOWN` / 连接丢失：先看当前窗口或文件；不要更换请求 ID 盲目重发。断开、重连不会自动回放操作。
- `DESKTOP_CAPTURE_UNAVAILABLE`：当前窗口没有提供可用截图；若 UIA 控件可读，可继续使用控件操作。自绘或受保护窗口应按实际能力验收。

日志不记录发送的正文和程序参数。导出包含最后捕获的可见窗口，可能包含业务数据；按需要选择导出范围。关闭连接后最多保留 32 个连接的日志，每个连接最近 1000 条事件；它们属于当前插件运行期。热加载等待桌面任务完成，保留已连接会话与日志，新连接使用新版执行器。

## 构建与验证

在 Windows 执行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-desktop.ps1`，从固定版本、固定 SHA256 的 NuGet 包构建原生执行器。可以通过 `REMOTE_OPS_NUGET_SOURCE` 指定兼容 flat-container 的内部源。依赖与许可证均包含在插件 tgz 中，普通用户无需执行构建。

`npm run check` 运行回归门禁；`node test/desktop-live.mjs` 打开独立测试应用，验证真实 UIA、截图、中文输入、鼠标键盘及实际保存文件。`DESKTOP_SSH=1` 配合 `WINDOWS_OPENSSH_BIN` 使用隔离的真实 Windows OpenSSH。具体系统及 DSH 验收结果见仓库相应版本的测试记录。

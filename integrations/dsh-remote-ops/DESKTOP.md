# Windows 桌面操作

在 DSH 对话中让 Agent 打开 Windows 软件、填写表单、点击按钮并检查结果。右侧 Remote Ops 的 **桌面** 工作区显示实际窗口，用户可随时点击画面、发送文字和快捷键。

第一次配置远程电脑，依次阅读 [准备目标](#准备目标)、[远程电脑的一次性配置](#远程电脑的一次性配置) 和 [第一次使用](#第一次使用)。配置完成后，可直接复制 [打开记事本输入并保存](#完整示例打开记事本输入并保存) 中的任务给 Agent。

## 准备目标

使用 x64 Windows 11，或安装了 Desktop Experience 的 Windows Server；执行器依赖 .NET Framework 4.8 及以上。目标用户需要已经登录且桌面解锁。Server 的多用户会话按账户和会话 ID 分开选择。

- **DSH 本机：** 选择“本机 Windows”。这里指 DSH 服务运行的电脑。
- **远程 Windows：** 在“环境 → SSH”保存地址、端口和账号凭据，目标系统选择 Windows。SSH 账号与已登录桌面账号一致。OpenSSH 需允许 SFTP、PowerShell 命令与本地 TCP 转发；首次连接自动部署随包执行器，不需要另外安装 Python、Playwright 或 .NET SDK。

软件窗口出现在**目标 Windows 的用户桌面**，插件显示该窗口的画面。SSH 登录成功不会自动登录或解锁桌面。先在目标电脑本地登录，或通过远程桌面登录同一个账号；首次验收时保持会话连接、解锁。RDP 断开后如会话不可操作，先恢复会话再继续。

远程目标不需要再安装 DSH。账号需能写入自己的 SFTP 初始目录，并能创建、运行和移除自己的交互式计划任务；安装 OpenSSH 的管理员权限与日常操作账号的权限是两回事。实际验证范围为 Windows 11、Server 2022 / 2025 Desktop Experience；其他系统与软件组合需按实际环境验收。

执行器通过该账号的 InteractiveToken 计划任务进入选定用户会话，启动完成后移除临时任务注册。桌面 RPC 验证仅该用户可读的随机凭证；本机连接使用回环地址，远程连接经 SSH 转发到目标 `127.0.0.1` 的随机端口，无需开放额外入站端口。文件放在目标 SFTP 初始目录下 `.dsh-remote-ops/desktop/<内容摘要>/`。本机执行器使用插件数据目录中的版本隔离副本，更新安装包不会替换正在运行的原生文件。

## 远程电脑的一次性配置

以下操作在**目标 Windows** 上完成。已有可用 OpenSSH 服务时先核对配置；使用系统自带 OpenSSH 的新环境，可在管理员 Windows PowerShell 中执行：

```powershell
$ErrorActionPreference = 'Stop'
if (-not (Get-Service -Name sshd -ErrorAction SilentlyContinue)) {
    $sshCapability = Get-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
    if ($sshCapability.State -ne 'Installed') {
        Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
    }
}
Set-Service -Name sshd -StartupType Automatic
Start-Service -Name sshd
if (Get-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue) {
    Enable-NetFirewallRule -Name OpenSSH-Server-In-TCP
} else {
    New-NetFirewallRule -Name OpenSSH-Server-In-TCP `
        -DisplayName 'OpenSSH Server' -Direction Inbound `
        -Protocol TCP -LocalPort 22 -Action Allow
}
Get-Service -Name sshd
```

上述脚本按默认 SSH 端口 22 配置；如果服务改用了其他端口，防火墙和插件环境也使用该端口。安装可选功能可能需要访问组织的软件源。Server 2025 默认已安装 OpenSSH，仍需启动服务。安装方法见 [Microsoft OpenSSH 入门](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse)。

组织如果调整过 `%ProgramData%\ssh\sshd_config`，请核对该账号的**实际生效配置**：

- 可以执行 PowerShell 命令，且 SFTP 子系统可用。仅开放 SFTP 的账号不能启动桌面执行器。
- `AllowTcpForwarding` 为 `yes` 或 `local`；如设置了 `PermitOpen`，需要允许转发至目标机 `127.0.0.1` 上的执行器随机端口。
- 账号允许通过 SSH 登录，且对应已登录桌面的同一 Windows 用户。域账号或主机前缀保留管理员提供的实际形式。

只在需要时调整现有配置，检查适用的 `Match` 条件，不重复追加 `Subsystem sftp`。配置变更后由管理员重启 `sshd` 服务生效。参见 [Microsoft 服务端配置](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration) 和 [OpenSSH TCP 转发说明](https://man.openbsd.org/sshd_config#AllowTcpForwarding)。

从 **DSH 所在电脑** 确认目标 SSH 端口可达，然后在插件中保存和测试环境。不要把密码或私钥粘贴到对话中；使用环境内保存的凭据即可。

## 第一次使用

1. 远程电脑先打开 **Remote Ops → 环境 → SSH → + 环境**，例如命名为 `WIN-DEMO`；填写目标地址、SSH 端口和实际用户名，**目标系统选择 Windows**，首次可选择 Windows PowerShell 5.1。保存密码或填写 **DSH 所在电脑上**的私钥文件路径。本机操作跳过此步。
2. 点击环境的“测试”，核对系统、Shell、SFTP 和主机指纹。环境若未标记为 Windows，不会出现在桌面的远程环境下拉框中。SSH 测试通过后，仍需单独检查桌面会话。
3. 打开右侧插件的“桌面”，选择 `WIN-DEMO` 或“本机 Windows”，点击“检查会话”。多个活动会话时明确选择一个与账号匹配的已登录、解锁会话。
4. 点击“连接桌面”，从列表选择已经打开的软件，或点击“打开应用”填写目标电脑上的绝对 `.exe` 路径。启动参数每行一个，保留空格和中文。也可直接让 Agent 按下方示例连接和启动。
5. 在窗口画面中直接点击控件；底部发送框输入中文或多行文字，Enter 发送、Shift+Enter 换行。画面获得焦点时可发送 Ctrl+S、Tab、方向键等快捷键，也可在目标电脑直接操作。
6. 展开“操作记录”检查结果；“更多 → 导出本会话桌面日志”打包当前对话的桌面记录和最后一张窗口图。

画面是实际窗口截图的定时刷新预览。Agent 执行期间无需切换接管模式；停止任务沿用 DSH 停止对话。单个已经送到 Windows 的动作可能完成，后续批次步骤停止。断开连接保留应用窗口，便于人工继续。

## 完整示例：打开记事本、输入并保存

这个示例用于验证“连接 → 打开软件 → 图形界面输入 → 保存 → 独立检查文件”的完整过程。先准备好 `WIN-DEMO` 环境，并确认目标已安装记事本。将以下内容复制到 DSH 对话；把环境名称替换为你实际保存的名称：

```text
使用 remote-ops-desktop skill，连接已保存的 Windows 环境“WIN-DEMO”。

1. 检查该账号的桌面会话，使用已登录且解锁的会话；如果有多个候选，先让我选择。
2. 通过同一环境的 SSH 查询 USERPROFILE 和记事本实际可执行文件路径。
   在该用户目录下创建 RemoteOpsDemo 文件夹；使用带时间戳的新文件名
   desktop-demo-YYYYMMDD-HHmmss.txt，确认不会覆盖已有文件。
3. 通过桌面工具启动记事本，观察实际窗口后新建一个空白文档。
   不修改、关闭已有的未保存文档，不依赖固定坐标或预设控件引用。
4. 通过记事本界面输入以下三行：
   Remote Ops 桌面操作演示
   这段中文由 Agent 在 Windows 软件窗口中输入。
   这是用于核对文件内容的第三行。
5. 通过记事本的保存界面，把文档以 UTF-8 保存到上一步的新路径。
   不通过 PowerShell 或文件工具代写文档内容。
6. 保存后，通过同一环境的 SSH 独立读取该文件，核对三行内容。
   只有文件存在且内容一致才报告成功，否则报告实际差异。
7. 给我实际保存路径、核对结果和本次桌面连接的日志下载地址。
   保留记事本窗口，方便我查看。
```

Agent 会根据实际界面分步执行。Windows 11 新版记事本可能使用标签页、恢复旧文档或转交到另一个进程；Server 上的界面可能不同。应在打开、新建、保存对话框出现后重新观察，使用实际窗口和控件引用。

| 阶段 | Agent 使用的接口 | 用户能看到什么、如何验收 |
| --- | --- | --- |
| 准备 | 同一环境的 `remote_terminal_open` / `remote_command_execute` | 查询用户目录和程序路径，创建示例目录；这些 SSH 命令不代写正文 |
| 连接 | `remote_desktop_connect`，先 `inspect:true`，再带选定会话连接 | 目标会话及返回的 `desktopId` |
| 打开 | `remote_desktop_launch`，随后 `remote_desktop_observe` | 实际记事本窗口；仅返回 PID 尚不代表就绪 |
| 输入和保存 | `remote_desktop_act` 与 `remote_desktop_observe` 交替 | 新文档中的中文、保存对话框和已保存文件名 |
| 独立核对 | `remote_command_execute`，读取同一路径 | 文件确实存在，UTF-8 正文与要求一致 |
| 交付 | `remote_desktop_log_export({desktopId})` | 本次连接日志 ZIP 的下载地址与 SHA256 |

例如首次检查会话的工具入参是一个对象：

```json
{"environment":"WIN-DEMO","inspect":true}
```

后续使用实际返回的会话 ID、`desktopId` 和新快照；`remote_desktop_act` 的 `steps` 必须是动作对象数组。不要把整段数组转成字符串，也不要复用其他示例中的控件编号。

文件验收可使用下面的只读 PowerShell 脚本，将实际保存路径作为 `remote_command_execute` 的 `parameters.path` 传入，并指定 `shell:"windows-powershell"`。成功读取后还需比较正文；退出码或哈希本身不代表内容正确。

```powershell
param([string]$path)
$ErrorActionPreference = 'Stop'
$savedFile = Get-Item -LiteralPath $path
[pscustomobject]@{
    path = $savedFile.FullName
    bytes = $savedFile.Length
    text = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
} | ConvertTo-Json -Compress
```

这是一份可复用的操作任务模板。已有真实桌面验收使用隔离测试应用完成打开、输入和保存；记事本示例应在你的目标机器上执行后，以实际文件核对结果验收，不预先宣称成功。

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

- 找不到远程环境：在“环境 → SSH”确认目标系统已选择 Windows。
- SSH 能连接、桌面不能连接：依次检查同账号的活动解锁会话、SFTP 写权限、交互式计划任务权限和本地 TCP 转发；SSH 测试不能代替桌面连接测试。
- 灰色表示连接已断开，绿色表示可操作，黄色表示正在处理动作。颜色配合文字显示。
- 桌面锁定、RDP 会话断开或安全桌面出现时，恢复用户会话后重新观察。需要管理员权限的应用先由用户按正常系统流程处理权限。
- `DESKTOP_SNAPSHOT_STALE`：窗口位置或快照已变化，重新观察后决定下一步。UIA 引用最长保留 45 秒，鼠标键盘快照最长 8 秒。
- `DESKTOP_OUTCOME_UNKNOWN` / 连接丢失：先看当前窗口或文件；不要更换请求 ID 盲目重发。断开、重连不会自动回放操作。
- `DESKTOP_CAPTURE_UNAVAILABLE`：当前窗口没有提供可用截图；若 UIA 控件可读，可继续使用控件操作。自绘或受保护窗口应按实际能力验收。

日志不记录发送的正文和程序参数。导出包含最后捕获的可见窗口，可能包含业务数据；按需要选择导出范围。关闭连接后最多保留 32 个连接的日志，每个连接最近 1000 条事件；它们属于当前插件运行期。热加载等待桌面任务完成，保留已连接会话与日志，新连接使用新版执行器。

## 构建与验证

在 Windows 执行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-desktop.ps1`，从固定版本、固定 SHA256 的 NuGet 包构建原生执行器。可以通过 `REMOTE_OPS_NUGET_SOURCE` 指定兼容 flat-container 的内部源。依赖与许可证均包含在插件 tgz 中，普通用户无需执行构建。

`npm run check` 运行回归门禁；`node test/desktop-live.mjs` 打开独立测试应用，验证真实 UIA、截图、中文输入、鼠标键盘及实际保存文件。`DESKTOP_SSH=1` 配合 `WINDOWS_OPENSSH_BIN` 使用隔离的真实 Windows OpenSSH。具体系统及 DSH 验收结果见仓库相应版本的测试记录。

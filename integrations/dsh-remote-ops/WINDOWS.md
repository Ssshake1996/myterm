# Windows 桌面与 Server：OpenSSH 操作指南

本指南对应 v0.10.2 的 Windows OpenSSH 能力。具体系统、Shell 与认证的验证范围见仓库验收记录。

## 连接环境

目标机器需要已启用的 OpenSSH Server、可连接端口和有权限的账号。插件连接的是该账号的命令行环境；DSH 与目标可以位于不同电脑。Windows 桌面和 Server 使用同一套配置。

1. 打开 **Remote Ops → 环境 → SSH → + 环境**，填写主机、端口和用户名。保留实际账号形式，例如 `HOST\operator` 或管理员提供的域账号，不自动删除前缀。
2. **目标系统**选 Windows，**SSH Shell**选择 CMD、Windows PowerShell 5.1、目标已安装的 PowerShell 7，或服务器默认。
3. 输入密码，或填写 **DSH 主机上**已有私钥文件的路径。密码保存在 DSH 凭据服务中；已保存环境的密码留空表示保留。
4. “连接、编码与主机指纹”可配置连接超时和管理员核对的 `SHA256:...` 指纹。不填指纹时首次连接会记录密钥，后续变化会阻止终端及文件连接。首次记录不代表已独立核验服务器身份。
5. 保存后点击该环境的 **测试**。查看实际系统名称、版本、可用 Shell、PTY、SFTP 和指纹；未通过项会显示失败阶段。测试执行只读系统查询、打开通道，不验证文件写权限。
6. 点击进入环境，用户直接输入命令，或在 DSH 主对话中让 Agent 操作。已有会话保留创建时的环境设置，修改配置后新开连接生效。

服务器默认 Shell 由 OpenSSH 服务配置决定。显式选择 CMD / PowerShell 只影响当前新进程，使用 UTF-8。使用默认 Shell 的遗留编码时，在环境中选择与远端一致的输入/输出编码。外部程序自行输出其他编码仍需按实际程序处理。配置方法参见 [Microsoft OpenSSH Server 文档](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration)。

## 让 Agent 操作

安装插件后，DSH 原生 skill 注册表会提供 `remote-ops-windows`。可直接输入 `/remote-ops-windows`，或描述任务让 Agent 加载它。首次先让 Agent 列环境、测试目标，再使用返回的准确会话 ID。

例如：

> 使用“测试 Windows”环境，先测试连接并报告实际系统和主机指纹，再查询磁盘空间、网卡与指定服务的状态。只做查询，把终端日志打包给我。

可见的交互命令使用 `remote_terminal_send/read/input`。需要退出码的脚本使用 `remote_command_execute`；它与交互终端的目录和临时变量相互独立。Windows 脚本使用单独认证的 SSH 连接和同一主机指纹规则，不复用交互 PTY 所在连接。

```json
{
  "session": "remote_terminal_open 返回的 sessionId",
  "shell": "windows-powershell",
  "command": "param($folder) Get-ChildItem -LiteralPath $folder | Select-Object Name,Length | ConvertTo-Json -Compress",
  "parameters": { "folder": "C:\\Ops Data\\日志" },
  "workingDirectory": "C:\\Ops Data",
  "timeoutSeconds": 30
}
```

`parameters` 使用对象，可包含字符串、数字、布尔值、空值或这些值的数组；通过标准输入传递，不拼接到启动命令。CMD 的 `command` 是完整批处理脚本，使用批处理百分号、脱字符规则；传任意路径或文本时优先选择 PowerShell 命名参数。CMD 临时脚本在正常结束时删除；异常断连可能留下临时文件。

读取 `status`、`exitCode`、`stdout`、`stderr` 并确认业务结果。终端回显、空闲提示与 HTTP/SSH 传输成功都不是命令成功证明。停止 DSH 对话会取消该轮等待并尝试关闭通道，`terminationConfirmed: false` 表示尚不能确认远端进程停止，先查询实际状态再决定后续操作。

## 文件与日志

- 在 **文件**中选择同一 SSH 环境，使用实际盘符根目录，例如 `C:/`、`D:/`，或服务端返回的 `/C:/...` 路径。可处理中文、空格和括号；`C:folder` 是依赖工作目录的路径，应改用绝对路径。
- 上传、下载、重命名、目录创建沿用原入口和工具。覆盖需要明确选择；遇到权限或目录类型错误会报告失败。二进制传输后可让 Agent 在两端计算 SHA256 核对。
- 当前终端使用 TXT 导出；多终端使用 **更多 → 一键打包本会话全部日志**，或让 Agent 调用 `remote_terminal_logs` 和 `remote_terminal_log_export`。日志是保留的终端流，独立 exec 的结果另外返回，不混写成终端回显。

## 诊断顺序

| 阶段 | 需要核对的实际信息 |
| --- | --- |
| connection | 主机、端口、超时、OpenSSH 服务与网络连接 |
| host-key | 管理员提供的指纹与返回的差异，确认后才更新固定值 |
| authentication | 账号形式、密码或密钥、服务端账号授权 |
| platform / shell | 返回的系统事实、PowerShell 可用性、所选 Shell 是否安装 |
| sftp / sftp-path | SFTP 子系统、当前账号可访问路径、通道错误 |
| 独立命令 | 原始退出码及两条输出流；不因无回显自动重放 |

Windows `3221225794`（`0xC0000142`）表示 [DLL 初始化失败](https://winprotocoldoc.z19.web.core.windows.net/MS-ERREF/%5BMS-ERREF%5D.pdf)；它不是已成功执行的脚本结果。记录实际 Shell、OpenSSH 版本和服务端日志。SFTP 仅对这一启动失败在发送文件请求前再尝试一次，重复失败仍报错；命令和文件变更不自动重放。

需要打开软件窗口、点击按钮或填写图形界面时，使用插件“桌面”工作区与 `remote-ops-desktop` skill，详见 [Windows 桌面指南](DESKTOP.md)。命令行巡检、脚本和文件处理继续使用上述 OpenSSH 工具。WinRM 的执行记录和对象结果展示见仓库分阶段设计。

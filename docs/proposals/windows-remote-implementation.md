# Windows 桌面与 Server 远程操作：具体实现方案

2026-10-25 · 设计提案，尚未实施。v0.9.2 发布内容仅为工作区标签样式；下面的接口和文件名是拟议设计。

**推荐先完善 Windows OpenSSH，再接入 WinRM / PowerShell Remoting。** 两种连接都保存在现有环境管理中，执行过程进入终端工作区，文件与日志沿用现有入口。Windows 桌面和 Server 都按实际启用的服务选择协议，不按系统名称强行绑定一种协议。

## 1. 用户如何使用

1. 在“环境”中新建远程环境，选择“Windows → SSH”或“Windows → WinRM”，填写主机、账号和凭据，保存。
2. 点击“测试连接”，分别看到网络、身份验证、Shell、执行和文件能力；失败时给出具体阶段。首次测试只执行读取系统与能力信息的命令。
3. 打开环境。SSH 显示实时 CMD / PowerShell 终端；WinRM 在同一个工作区中显示逐条执行记录与脚本输入区。
4. 用户直接输入，或在 DSH 中让 Agent 操作；两者使用同一连接、任务记录和日志。按当前用户要求，不增加接管、暂停、停止按钮。
5. 查看输出与实际结果，通过当前下载入口导出日志，或由 Agent 调用日志接口打包。

建议首批实际场景：

| 场景 | 用户的指令 | 展示与验收 |
| --- | --- | --- |
| 桌面排障 | 检查这台电脑的磁盘空间、网卡和高占用进程 | 可见命令、逐步输出、目标机器身份；保留查询结果 |
| Server 运维 | 查询指定服务状态和最近错误事件 | PowerShell 对象显示为表格或 JSON，保留时间与错误详情 |
| 发布脚本 | 上传脚本到指定盘符并执行 | 文件传输进度、SHA256、执行记录与退出状态；路径含中文和空格也正确 |
| 多机巡检 | 查询几台服务器的版本并导出日志 | 每台机器独立连接、独立结果；一台失败不覆盖其他机器的结果 |

## 2. 两种通道的取舍

| 项目 | OpenSSH：第一阶段 | WinRM：第二阶段 |
| --- | --- | --- |
| 适合任务 | 持续交互、CMD / PowerShell、逐键输入、SFTP | Windows 系统管理、PowerShell 脚本和对象结果、企业域认证 |
| 用户可见形式 | 现有终端标签与实时回显 | 同一标签区域内的命令记录：排队、运行、输出、结果与耗时 |
| 复用能力 | `ssh2`、PTY、环境 CRUD、SFTP、日志 | 环境、工作区导航、日志与凭据；新增 PSRP 会话桥接 |
| 文件通道 | SFTP，覆盖盘符与中文路径 | 首版可关联同设备 SSH 文件环境；原生 WinRM 文件传输放入后续阶段 |
| DSH 主机 | 沿用插件已验证的运行平台，逐个平台补 Windows 目标验收 | 首版明确要求 Windows DSH 主机，使用系统 Windows PowerShell 5.1 桥接 |
| 成本重点 | Windows Shell 启动、参数引用、编码和路径 | 认证、长连接、流式对象、取消语义和错误分类 |

微软将 OpenSSH 作为 Windows 10 1809+、Windows 11、Server 2019+ 的系统能力；Server 2025 默认安装组件但仍需启用服务。实际安装与启用状态需要探测。[OpenSSH 官方概览](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-overview)

首批发布验收目标建议为 Windows 11 Pro / Enterprise 与 Server 2022（Desktop Experience、Server Core）。Server 2019 / 2025 在第二批矩阵验证后标注支持。Windows 10、Windows 11 Home 和更旧 Server 单列兼容验证，不能依据本地 CMD 或模拟 SSH 通过就宣布全部支持。

## 3. 当前代码能复用什么，缺口在哪里

本轮已检查以下实现，事实与设计区分如下：

| 现有文件 | 已有能力 | Windows 专项需要补齐 |
| --- | --- | --- |
| `lib/state/environments.js`、`lib/common.js`、`lib/tools.js` | SSH 环境增删改、分组、密码引用与私钥路径 | 协议、目标平台、Shell 和 WinRM 字段；前后端及工具共用校验 |
| `lib/terminal-sessions.js` | SSH PTY、解码、尺寸、原始输入和回显 | 当前请求设置 POSIX locale；Windows 应按能力选择启动方式与编码 |
| `lib/commands.js`、`lib/state/commands.js` | 独立 SSH exec、本地命令、请求去重与有界结果 | 当前 SSH exec 直接发送字符串、输出固定 UTF-8；缺少显式远端 Shell、Windows 工作目录与编码策略 |
| `lib/state/files.js`、`lib/transfers.js` | SFTP 和 DSH 主机文件传输 | 路径拼接与 mkdir 含 POSIX 假设；盘符根目录、UNC、大小写与跨盘路径需要专门测试 |
| `lib/client.js`、日志模块和随包 skill | 工作区、多终端、任务状态、TXT / ZIP 导出 | 增加 WinRM 记录视图与日志来源，不再增加一套全局工作区 |

现有代码未发现 WinRM / PSRP 适配。本次未连接真实远端 Windows 设备，当前通用 SSH 能连接某台 Windows 机器，并不代表 Windows 专项适配已经验收。

## 4. 环境数据与兼容

保留环境内部 ID、分组和已有凭据引用。缺少 `transport` 的旧环境继续解释为 SSH；平台默认 `auto`。新增字段只在明确保存时写入，更新环境不改变已经打开的连接，新的配置用于新连接。

| 字段 | 建议值与语义 |
| --- | --- |
| `transport` | `ssh` / `winrm` |
| `platform` | `auto` / `windows` / `posix`，表示用户意图；实际探测结果另存并带时间 |
| SSH `shell` | `server-default` / `cmd` / `windows-powershell` / `pwsh` |
| SSH `encoding` | 沿用现有枚举；增加 `cp437` / `cp936` 等前先验证解码库与输入输出一致性，不能只加下拉选项 |
| WinRM `scheme`、`port` | 默认 HTTPS / 5986；域内已有 HTTP / 5985 可显式配置 |
| WinRM `authentication` | 首版 Kerberos / Negotiate；显示请求方式及实际可确认的认证信息，不把 Negotiate 一律写成 Kerberos |
| WinRM `credentialMode` | `stored` / `current-user`；后者指运行 DSH 进程的 Windows 身份 |
| WinRM `configurationName` | 默认 `Microsoft.PowerShell`；PowerShell 7 / 自定义受限端点需要探测和单独验收 |
| `readyTimeoutMs` | 连接超时；执行超时是每次任务的独立参数 |

账号支持本地账号、`HOST\user`、`DOMAIN\user` 和 UPN，但不通过删改域前缀“修复”认证错误。密码沿用 DSH 凭据服务；工具返回配置状态，连接时在后端解析凭据。导入旧环境时不猜测为 Windows，也不自动更改目标系统的 SSH 默认 Shell。

## 5. 第一阶段：Windows SSH 的实现

**连接与终端。** 增加 `windows-shell.js` 作为局部适配器，由现有 SSH 会话调用。默认保留服务器 Shell；显式选择 CMD / PowerShell 时，只为当前连接启动经过探测的进程。Windows SSH 初始默认 Shell 是 CMD，管理员可以在服务端改变默认值。[Windows OpenSSH 配置](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration)

**命令与参数。** 交互输入保留原文；用于 Agent 的独立脚本执行明确 `shell`、脚本内容、参数和工作目录。PowerShell 路径通过 `-LiteralPath` 及结构化参数处理；跨 SSH exec 的启动命令可使用经过验证的 UTF-16LE `-EncodedCommand`，Base64 只解决编码和引用，不承担保密。CMD 使用独立的引用策略，不复用 POSIX 或 PowerShell 的转义规则。参数中的空格、引号、`& | % ! ^`、换行和中文都纳入验收。

**编码。** 分别检查交互终端、独立 exec 和原生程序输出，不假设它们总是同一种编码。优先使用明确的 UTF-8 任务封装；保留可配置的遗留编码策略。初始化只作用于当前会话，不改全局代码页或用户 profile。终端输出到达不代表命令完成，独立任务以退出状态及错误流判定。

**文件。** 以 SFTP 服务端返回的规范路径为准，将 Windows 显示路径与 SFTP 协议路径分开；先验证 `C:/`、其他盘符根目录、中文／空格文件名、重命名、目录创建、大小写和覆盖判断。UNC 路径在证实服务端可访问之前不作为已支持能力。

**目标身份。** 在共享 SSH 连接配置层增加主机指纹记录与校验，交互终端、exec、SFTP 使用同一策略。首次绑定显示指纹供核对，变化时给出具体差异，不能让文件通道绕过检查。

## 6. 第二阶段：WinRM 的具体结构

```text
用户 / Agent
  → 插件工具与 Web 路由（共用参数校验、目标和请求去重）
  → WindowsWorkspace（连接、串行队列、任务、输出游标）
  → 插件随包 bridge.ps1（Windows DSH 主机，JSONL 管道）
  → New-PSSession / Invoke-Command（PSRP over WinRM）
  → 远端 PowerShell endpoint
  → 输出事件 / 对象 / 错误 / 完成状态 → 终端记录与日志
```

建议新增 `lib/windows-workspace.js`、`lib/windows-bridge.js`、`lib/windows/bridge.ps1`、`lib/windows-tools.js`、`lib/windows-routes.js`；由 `lib/index.js` 统一创建、注册和清理。桥接脚本随 tgz 分发，首版不引入 Python 依赖，不另发 Windows ZIP。

- 每个对话的每个连接维护一个持续 PSSession，同一连接按提交顺序执行，其他连接可并行。PSSession 可保留远端变量等会话上下文。[New-PSSession](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/new-pssession?view=powershell-5.1)
- 采用 `Invoke-Command` / PowerShell SDK 的异步管线返回分段事件。stdout 专用于带 `connectionId / jobId / sequence / stream / time` 的 JSONL；普通脚本输出只能成为事件内容。stderr 留给桥接诊断，禁止把凭据放入进程参数或诊断日志。[Invoke-Command](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/invoke-command?view=powershell-5.1)
- 将 Output、Error、Warning、Verbose、Debug、Information、Progress 分流记录；对象提供有深度和大小限制的 JSON 与文本视图。PowerShell 非终止错误、脚本抛错和原生程序退出码分别保存。
- 默认每任务 30 秒，可显式延长至 300 秒；预览沿用现有输出限额，截断与遗漏必须可见。首版全局最多 8 个执行中任务、每连接 1 个执行中任务，有界队列显示“排队中”。
- `requestId` 绑定对话、连接和规范化参数摘要：相同 ID / 相同参数返回原记录，不重新执行；相同 ID / 不同参数报冲突。该保证只覆盖当前进程保留期，重启后不宣称“恰好执行一次”。
- 原型必须证明桥接在命令运行期间仍能接收取消消息；若流式输出、取消、认证任一项不达标，先解决桥接，再开发完整页面。

### 拟议插件接口

以下均为提案接口，不是 v0.9.2 已提供工具。

| 接口 | 主要入参 | 返回值与用途 |
| --- | --- | --- |
| 现有 `remote_environment_create/update/list` | 增加上表协议字段 | 保存与读取配置，保持旧 ID 和旧调用兼容 |
| 新增 `remote_environment_test` | `environment` | 分阶段诊断与 `capabilities`，不运行修复命令 |
| 现有 `remote_terminal_open/send/read` | SSH 环境与会话 ID | Windows SSH 沿用可见终端；返回实际 Shell 和能力 |
| 新增 `remote_windows_open` | `environment` | `connectionId`、机器信息、endpoint、能力与会话状态 |
| 新增 `remote_windows_run` | `connectionId, requestId, script, parameters?, workingDirectory?, timeoutSeconds?` | 流式写入共享记录，返回 `jobId`、结果和游标 |
| 新增 `remote_windows_read` | `jobId, cursor?, maxBytes?` | 增量事件、任务状态、截断信息，读取不重新执行 |
| 新增 `remote_windows_close` | `connectionId` | 释放连接，用于任务完成后的清理 |
| 现有 `remote_terminal_logs`、`remote_terminal_log_read`、`remote_terminal_log_export` | 增加 WinRM 记录来源 | 当前 TXT 与一键 ZIP 保持原入口，manifest 标记协议与任务 ID |

第一版 `remote_windows_run` 建议保持工具调用存活直到完成或超时，同时前端读取已产生的事件。这样可以直接沿用现有 `exec.signal` 接到 DSH“停止对话”。若后续改为立即返回后台 job，必须先验证宿主 turn 取消事件在工具返回后仍可订阅，不能只保存一个已结束调用的 signal。

关闭插件右栏、切换模块或网页刷新继续执行。停止对话会取消该轮创建的任务、尝试停止远端管线，用户独立提交的任务不受其影响。断线、超时或无法确认远端结束时标为“结果未知”，不自动重放；可继续只读查询实际状态。DSH 重启后不恢复执行。没有新接管／暂停／停止按钮，也不修改 Agent。

## 7. 展示设计

SSH 继续使用当前终端。WinRM 标签显示“主机名 · PowerShell”，内容区按一次请求一条记录排列：时间、来源、脚本摘要、状态、耗时；展开查看脚本、分流输出、对象表格与原始 JSON。用户输入区位于底部，可提交脚本；同时到来的请求进入可见队列，不区分控制权。

未完成显示“运行中”，出现 PowerShell 错误流时显示“完成但有错误”或“失败”，依据实际管线状态区分；断线则显示“结果未知”。只有传输成功不代表业务成功。后台新输出继续通过顶部“终端”徽标提示，设置收在现有总设置，导出沿用当前 TXT / 更多中的 ZIP。

WinRM 的首版脚本输入不提供任意逐键 PTY 或桌面程序操作；需要交互命令行时选择 SSH。RDP 桌面画面与鼠标键盘操作属于后续独立能力，当前目标是可见的远程命令执行。

## 8. 认证和部署路线

| 环境 | 推荐路线 | 具体处理 |
| --- | --- | --- |
| 桌面 / 工作组 | SSH 密码或密钥；WinRM 优先 HTTPS 5986 | 校验证书与主机名，使用保存的凭据；自有 CA 按企业流程建立信任 |
| 域内 Server | FQDN + Kerberos | 检查域关系、DNS、SPN 和 DSH 运行身份；按 endpoint 权限执行 |
| 已有 HTTP WinRM | 显式 HTTP 5985 + Kerberos / Negotiate | 检查消息加密和已有企业策略；不自动修改 TrustedHosts |

WinRM 使用 Kerberos / NTLM 等认证时可以提供消息级加密，不能仅因 HTTP 就判断内容全部明文；IP 地址或工作组场景通常不能使用 Kerberos，推荐配置 HTTPS 并验证服务端身份。[WinRM 安全说明](https://learn.microsoft.com/en-us/powershell/scripting/security/remoting/winrm-security?view=powershell-7.5)

首次部署由有权限的人启用目标 OpenSSH 或 WinRM 服务及受控防火墙规则，插件提供针对实际检测结果的命令说明。已有连接前，插件无法凭空替目标机启用远程服务。访问第二台文件服务器等“第二跳”问题单独报告，按企业配置处理，不自动启用 CredSSP 或通配信任。[PowerShell 第二跳](https://learn.microsoft.com/en-us/powershell/scripting/learn/remoting/ps-remoting-second-hop?view=powershell-7)

SSH 可见终端与 PowerShell-over-SSH 的对象化 remoting 是两种用法；后者需要 PowerShell 与 SSH subsystem 配置，可作为后续扩展，不纳入第一阶段部署前提。[PowerShell over SSH](https://learn.microsoft.com/en-us/powershell/scripting/security/remoting/ssh-remoting-in-powershell?view=powershell-7.6)

## 9. 分阶段交付与验收

| 阶段 | 交付 | 必须通过的真实验证 |
| --- | --- | --- |
| 0：验证关键假设 | Windows SSH CMD / PowerShell / SFTP 小样；WinRM 桥接小样 | Windows 11、Server 2022 各一台；流式事件、复杂参数、真实取消；域内 Kerberos 与工作组 HTTPS 各一条链路 |
| 1：Windows SSH | 环境字段、Shell / 编码 / 路径适配、连接诊断、可见终端与文件、随包 Windows 指南 | 密码和密钥、默认 CMD 和 PowerShell、中文及跨盘文件、摘要一致、断线不重放、旧 Linux / 设备 SSH 回归 |
| 2：WinRM | 桥接、持续会话、任务与对象记录、统一日志、插件工具和 skill | Kerberos / HTTPS 两组认证；非管理员 endpoint、证书错误、错误流、非零退出码、长输出、并发排队、停止对话及结果未知 |
| 3：按实际需求扩展 | Server 2019 / 2025 / 旧系统矩阵、多机结果对照、WinRM 原生文件、更多认证 | 每个新增组合单独列出操作系统版本、Shell、认证与文件能力的真实证据 |

所有阶段都验证：切换工作区和刷新不丢正在执行的任务；环境修改不误改存量连接；不同对话不能读写彼此的连接；用户和 Agent 的记录进入同一日志接口；全新安装、从旧版本升级、README 和随包 skill 与实际能力一致。

随包新增 `remote-ops-windows` skill（在功能实际实现的版本提供）：先列环境与能力 → 选择 SSH 或 WinRM → 打开连接 → 用返回的准确 ID 操作 → 检查错误流和业务结果 → 导出日志。样例必须使用可通过 Schema 的完整动作对象；超时后先查状态，不换 requestId 盲目重试。Agent 源码和用户的全局 Agent 配置保持现状。

**下一步推荐：先做阶段 0 的 SSH 验证，再交付阶段 1；WinRM 原型作为阶段 2 的进入条件。** 这样能尽快让桌面与 Server 都有可见终端和文件操作，同时在 WinRM 前端投入前验证认证、流式输出与取消这些关键风险。真实远端 Windows / 域测试环境需要在开始这些阶段时落实；域环境未就绪时可以先完成 Windows SSH，不能把 Kerberos 写成已验收。当前本地样式验收不能替代这些远程验证。

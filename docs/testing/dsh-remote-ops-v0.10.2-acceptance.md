# Remote Ops v0.10.2 验收记录

## 范围

当前对话 SSH 标签的全部关闭、黄色操作/绿色连接/灰色断开提示、本地 CMD 保留、部分失败反馈、跨对话隔离及关联 Windows 独立命令取消。不修改 Agent；发布附件仅 tgz 和 SHA256。

## 候选包验收

2026-10-26 完成，功能代码提交 `6ebe6270c5f823c5b284b43b20f0d883805bac1a`；发布标签提交 `ee730f10097031f377669cdac5ed4bbdf6e95107` 只另补充本验收记录。正式 Release 下载和重新安装单独核对，不以候选包结果代替。

| 验证层 | 结果与证据 |
| --- | --- |
| 标准回归 | 后端 286、客户端 117、契约 11，共 **414/414**，同步/语法检查和 smoke 通过。[Linux CI](https://github.com/Ssshake1996/myterm/actions/runs/40271656939) 与两种 Windows CI 均通过默认完整检查。 |
| 仿宿主浏览器 | 真实插件和客户端、隔离 SSH 测试服务，最终发布提交[完整复测 **22/22**](https://github.com/Ssshake1996/myterm/actions/runs/40272368031/attempts/2)；含批量关闭、部分失败保留、灰色断开清理、键盘/窄栏、后台状态、API JSON 树、错误详情和 SFTP。测试设施自测 **4/4**。首次 CI 性能失败见下方，原门槛未放宽。 |
| 真实 Windows OpenSSH | [Windows Server 2022 / 2025](https://github.com/Ssshake1996/myterm/actions/runs/40271657381) 分别 **12/12**。真实 CMD、PowerShell 5.1/7、PTY、独立 exec、SFTP、日志、主机密钥阻断与批量关闭隔离。 |
| 真实 DSH 安装 | 同一 CI 两种 Windows 分别 **8/8**。在独立 `DSH_HOME` 安装实际 tgz，宿主为 `@deepseek-ai/dsh@0.2.0-rc.2`；使用确定性的测试模型响应，通过宿主 Agent 调用实际插件工具，并在真实宿主页面验证交互。 |
| 本地 DSH 界面补验 | 同一候选 tgz，真实 DSH 加隔离 SSH 协议测试服务，**7/7**。只作为宿主界面证据，不作为真实 Windows 远端命令证据。 |
| UI 契约与随包 skill | UI 静态契约 **14 通过 / 1 提示 / 0 错误**；提示为 DSH 包没有 Codex 插件 manifest，不影响本宿主。六个 skill 格式检查及真实 DSH skill 注册/加载均通过。 |

原生 DSH 验证包含：

- 当前对话有两个 SSH，另一对话有独立 SSH；黄色状态下人工仍可输入，取消关闭确认后连接仍在。
- PTY 已退出而独立 Windows 命令仍在运行时保持黄色，关闭前仍需确认；批量关闭取消关联等待和 exec。
- 关闭后回到可输入的本地 CMD，其他对话连接、保存的环境与保留日志不受影响；已断开且无任务的标签直接清理。
- 窄栏深色主题仍显示“全部关闭”，减少动画偏好生效；灰色断开提示、焦点及宿主右侧栏显示正常。

候选 tgz SHA256：`07b181499349f2d5f45e6b98ad317cf6ea8c3f4631ca1015f7e4043989296f43`。两种 Windows 安装的包哈希一致。归档 73 个文件逐字节匹配源码，包含六个 skill，不包含测试、私钥、Agent 或本地输出。

本地证据保存在 `output/terminal-close-ci-final/`、`output/native-ui/final/`、`output/release0102-final/audit.json` 和 `output/e2e/`；CI 上传原生验收 JSON、截图和宿主日志。

## 正式发布包

[发布工作流](https://github.com/Ssshake1996/myterm/actions/runs/40272372001) 的 Linux 打包检查、Windows 完整回归和发布步骤均通过。[v0.10.2 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.10.2) 已公开并标记为 Latest，只有以下两个附件：

- `dsh-remote-ops-v0.10.2.tgz`
- `SHA256SUMS-dsh-remote-ops-v0.10.2.txt`

已从正式 Release 重新下载两个附件。tgz 实算 SHA256、校验文件、GitHub asset digest 与上述候选包哈希完全一致；73 个文件再次逐字节匹配发布源码。下载及审计保存在 `output/release0102-official/`。

正式 Release 下载包的[全新 DSH 安装复验](https://github.com/Ssshake1996/myterm/actions/runs/40272745418) 已通过：Windows Server 2022、2025 各完成 **414 项回归 + 12 项真实 SSH + 8 项原生 DSH 验收**。工作流以 `release_tag=dsh-remote-ops-v0.10.2` 下载公开附件、核对校验文件后安装；两份证据中的 `releaseTag`、`installedVersion`、`packageSha256` 分别与正式标签、`0.10.2` 和上述哈希一致，错误数组为空。证据与截图保存在 `output/terminal-close-ci-official/`，没有以本地重新打包代替正式附件。

## 修复过的验收问题

首次测试设施缺少环境准备、页面定位不唯一及输入区尚未可编辑；CI 缺少宿主安装所需 pnpm、浏览器语言不一致。已修正准备与等待条件，保留原失败输出，后续完整轮次通过，没有跳过断言。

本地完整默认并发测试和一次真实 Windows 原生测试遇到系统提交内存上限（Node 分配失败、PowerShell `System.OutOfMemoryException`），这些失败不计为通过。本地降低测试并发后的同一套 414 项通过；干净的 Windows Server CI 使用默认并发完成全部回归及真实 DSH 验收。未修改用户系统内存配置或终止无关进程。

发布提交的[首次 Linux 浏览器 CI](https://github.com/Ssshake1996/myterm/actions/runs/40272368031/attempts/1) 为 21/22，唯一失败是千条目录场景后的工作区切换 p95 **263.5ms**，超过原有 250ms 门槛；新增终端场景通过。保留该次报告，在不改源码、测试或门槛的情况下完整复测为 22/22、p95 **147ms**。这证明存在运行波动，不证明所有主机都能稳定达到该耗时；两轮证据分别保存在 `output/terminal-close-browser-main-failed/` 与 `output/terminal-close-browser-main-rerun/`。

## 边界

黄色只表示插件可观测的等待、独立命令或关闭状态，普通键盘输入和终端新输出不被当作可准确计时的命令。绿色仅表示连接，不证明命令结束或业务成功。

关闭会取消插件关联等待并请求 SSH 通道关闭，`terminationConfirmed: false` 仍不证明远端进程已停止。测试仅操作隔离 DSH_HOME、测试目录和回环 SSH；用户内网设备及其认证/企业策略未提供，不能视为已验收。

# dsh-remote-ops v0.13.0 验收记录

验证日期：2026-11-03。范围为 Telnet 环境、登录、可见终端、现有标签和日志集成。未修改 Agent 或 DSH 宿主源码。所有连接均为隔离测试服务，未访问用户生产设备或替换用户 Desktop 安装。

## 自动回归

- `npm run check --prefix integrations/dsh-remote-ops`：467 项通过（桌面 11、后端 317、客户端 127、契约 12），smoke 通过。日志：`output/telnet-dev/check-release.log`。
- 新增 Telnet 测试 15 项：环境/工具 Schema、保存与修改、分片 IAC、重复协商、TTYPE/NAWS、二进制与 NVT 的 CR NUL 区分、分片用户名/密码提示、自动密码回显脱敏、失败只提交一次、手动输入、超时、GB18030、Ctrl+C、关闭、日志及执行能力边界。混合目标批量请求在任何连接或命令发生前拒绝未经观察的 Telnet 登录流程。
- Chrome 156.0.8078.74 浏览器回归：24 场景、106 步骤通过。覆盖环境管理、终端标签与滚动、全部关闭、配色/日志、网页、文件、API 和 Windows 环境。证据：`output/playwright/telnet-v0.13.0-browser-final/report.json`。这一层是仿宿主外壳、真实插件与客户端、脚本化设备服务，独立于下方真实宿主验收。
- DSH UI 契约静态检查：14 项通过，1 项提示，0 错误。提示为本包不是 Codex 插件，没有 `.codex-plugin/plugin.json`；不作为 DSH 缺陷。两个更新的随包 skill 结构校验通过，工具示例同时接受实际注册的 JSON Schema 校验。

## 真实 DSH 安装验收

Windows 11 上使用未修改的 DSH **0.2.1-rc.5**、真实 Chrome、官方插件安装 CLI、原生 Agent 工具分发。每轮使用新的隔离 `DSH_HOME`。Telnet/SSH 设备、模型响应、HTTP 更新源是本地确定性测试服务；真实 TCP、Telnet 协商、工具执行、下载和插件热加载均实际发生。

最终候选包 SHA256：`48993d9b8ebcb0dec06d6de7410d560bf1735f58421be1fe72a617fce1b74ab1`。证据：`output/playwright/telnet-v0.13.0-native-final/evidence.json`，**6/6 通过，页面运行时错误 0**。

| 场景 | 验证 |
| --- | --- |
| 环境保存 | UI 选择 Telnet，默认端口 23，保存用户名密码登录模式与凭据引用 |
| 用户输入 | 实际协商/登录后在终端输入 `show human` 并读取设备返回 |
| Agent 操作 | 原生分发 list/read/send/log_export，在同一连接执行 `show version`，下载日志 ZIP 并核对 SHA256 |
| 原功能与页面恢复 | SSH 执行仍可用；文件环境列表只显示适用环境；刷新页面保持 Telnet sessionId/streamId |
| 热加载 | 经 HTTP 更新源实际安装合成后续版本，宿主进程、连接、输出流、对话草稿保留，后续命令执行且不重放 |
| 窄栏与关闭 | 390px 表单无横向溢出；全部关闭移除 SSH/Telnet，保留本地 CMD、保存环境与可导出的历史日志 |

设备端计数：TCP 连接 **1**、成功登录 **1**、密码提交 **1**；实际命令为 `show human`、`show version`、`show after` 各一次。热加载测试的 **0.13.1 是隔离合成夹具，不是发布版本**。

复现命令（PowerShell；DSH_CLI 指向已安装 DSH 的 `lib/bin.js`）：

```powershell
$env:DSH_CLI = 'path-to-dsh/lib/bin.js'
$env:TELNET_OUTPUT = 'output/playwright/telnet-native-new-run'
node e2e/runner/telnet-native.mjs path-to-package.tgz
```

## 修复迭代和验证边界

保留首次失败证据：`telnet-v0.13.0-native-1` 中测试脚本未把相对日志下载地址转换为绝对地址；`native-2` 中按钮名称多出空格导致定位失败。修复后 `native-3` 和最终候选均通过。首次浏览器回归为 21/24，三个失败为旧删除提示断言与关闭按钮定位；同步真实语义并修复标签后，完整重跑为 24/24。协议 CR NUL 和环境明文 password 字段验证均先增加失败测试再修复。

本轮验证不能替代具体厂商设备的登录提示符、权限、编码和命令验收。Telnet 为明文协议；自动保存密码的原样回显已脱敏，任意设备输出或手动输入不保证完全去除敏感内容。提示符匹配只表示登录就绪，静默和运行中的连接不证明命令成功。

## 发布门禁结果

v0.13.0 保留为未发布候选。Linux CI 暴露协商测试的等待时序错误：客户端看到提示符时，服务端的接收回调可能尚未处理客户端应答；测试立即读取已接收字节，误判缺少 NAWS。修改为等待最后一条协商应答实际到达后再断言，没有修改运行时代码或弱化协议断言。修复提交 `8bf3200` 的 [Linux CI](https://github.com/Ssshake1996/myterm/actions/runs/41568363892) 与 [浏览器回归](https://github.com/Ssshake1996/myterm/actions/runs/41568363740) 均通过。

已取消 v0.13.0 发布工作流，未上传该版本附件；保留原标签和失败记录。正式交付采用 [v0.13.1 验收记录](dsh-remote-ops-v0.13.1-acceptance.md)。

# dsh-remote-ops v0.13.1 验收记录

验证日期：2026-11-03。本版交付 Telnet 环境、登录、用户/Agent 共用终端、多标签及日志导出。README、中英文安装示例、Telnet 指南和随包环境/日志 skill 同步；没有修改 Agent 或 DSH 宿主。

## 回归与候选包

- 本地完整检查：467 项（桌面 11、后端 317、客户端 127、契约 12）及 smoke 通过。Telnet 新增测试 15 项，包括参数 Schema、分片协议、NVT/二进制、登录失败/超时、密码回显过滤、编码、关闭、日志与能力边界。
- Chrome 156.0.8078.74：24 场景、106 步骤通过，覆盖现有环境、终端、网页、文件、API 等交互。报告在 `output/playwright/telnet-v0.13.0-browser-final/`；v0.13.1 的界面业务逻辑相同，仅更改版本标识。修复后的 [Linux 浏览器 CI](https://github.com/Ssshake1996/myterm/actions/runs/41568363740) 也已通过。
- UI 契约：14 通过、0 错误；1 个提示为本包不是 Codex 插件。随包两个 skill 结构与工具 JSON 示例校验通过。
- 最终候选包 SHA256：`2dab11fb2807639c0feb51977280f2db5f9319aa23f553e885b0b4e525b5f748`。
- Windows 11、真实 DSH **0.2.1-rc.5**、Chrome、官方安装 CLI、原生 Agent 工具分发：**6/6 通过，页面运行时错误 0**。证据：`output/playwright/telnet-v0.13.1-candidate/evidence.json`。

六个真实宿主场景为：UI 保存 Telnet；真实 TCP 协商/登录与用户输入；Agent 读取、下发命令并打包/下载日志；SSH 回归和页面刷新；HTTP 源热加载保留状态；390px 表单与全部关闭保留本地 CMD。

设备、模型响应和 HTTP 更新源使用隔离本地测试服务。热加载前后实际 TCP 连接数为 **1**，登录 **1** 次，密码提交 **1** 次；sessionId、streamId、宿主进程和对话草稿保留，三条命令各执行一次。测试中 **0.13.2 是合成后续版本夹具，不发布**。没有访问生产设备，也没有替换用户本机 Desktop 安装。

协议测试的早期失败及修复过程保留在 [v0.13.0 候选记录](dsh-remote-ops-v0.13.0-acceptance.md)。v0.13.0 标签保留但未发布附件；v0.13.1 使用修复后的测试，未通过重跑掩盖失败，也未覆盖旧标签。

## 复现与边界

```powershell
npm run check --prefix integrations/dsh-remote-ops
$env:DSH_CLI = 'path-to-installed-dsh/lib/bin.js'
$env:TELNET_OUTPUT = 'output/playwright/telnet-new-run'
node e2e/runner/telnet-native.mjs path-to-release.tgz
```

具体设备仍需核实登录提示符、权限、编码和命令语义；本地脚本化设备不等于真实厂商硬件验收。Telnet 明文连接，提示符/静默不证明命令成功。自动密码原样回显会在可读输出和日志前过滤；任意手动输入和设备输出仍需检查敏感内容。

## 正式发布、下载和安装验收

- [v0.13.1 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.13.1) 已发布。Latest API 与列表首位均为 `dsh-remote-ops-v0.13.1`。标签指向 `e49b96fa88cd5d3c5d40a971c9892995385b389a`。
- 附件恰好两个：`dsh-remote-ops-v0.13.1.tgz`（677439 字节）及 `SHA256SUMS-dsh-remote-ops-v0.13.1.txt`（93 字节）。下载包、校验文件和 GitHub asset digest 一致：`f6ccf1abd8b7a825432cd03f5f2d2e1993d139b89ca8d974edafd0e84fc578a6`。
- 正式包重新构建了 Windows 桌面运行时，因此整体摘要与候选包不同；79 个运行时源码、客户端、随包 skill 和说明文件与已验证源文件逐字节一致。桌面运行时 manifest 校验通过。证据：`output/telnet-dev/official/verification.json`。
- 直接从 GitHub 下载的正式附件安装到新的隔离 DSH **0.2.1-rc.5** 后完成 **6/6** 项验收，页面运行时错误 **0**。热加载前后 TCP 连接、登录和密码提交仍各 **1** 次；相同 sessionId/streamId、草稿和日志保留。证据：`output/playwright/telnet-v0.13.1-official/evidence.json`。
- [发布工作流](https://github.com/Ssshake1996/myterm/actions/runs/41568766908) 的 Windows 构建/桌面门禁、Linux 打包、资产校验和 Latest 推广全部通过。
- 发布提交的 [Linux CI](https://github.com/Ssshake1996/myterm/actions/runs/41568766859)、[浏览器回归](https://github.com/Ssshake1996/myterm/actions/runs/41568758444)、[Windows 桌面验收](https://github.com/Ssshake1996/myterm/actions/runs/41568758456)、[Windows OpenSSH 验收](https://github.com/Ssshake1996/myterm/actions/runs/41568758318) 全部通过；后两项均包含 Server 2022 和 Server 2025。

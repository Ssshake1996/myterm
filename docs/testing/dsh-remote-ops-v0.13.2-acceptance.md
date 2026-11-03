# dsh-remote-ops v0.13.2 验收记录

验证日期：2026-11-03。本版开放 Agent 直接保存、修改 SSH／Telnet 和 API 环境的账号密码，密码写入 DSH credentials，环境文件只保存引用。同步 README 和随包环境/API skill；未修改 Agent 或用户现有 DSH 配置。

## 回归与候选包

- 完整检查：475 项（桌面 11、后端 325、客户端 127、契约 12）及 smoke 全部通过；E2E 报告工具的 4 项单测通过。
- 新增 8 项密码工具回归，覆盖 SSH、Telnet、API Token/Cookie 创建和替换、Unicode/空格保留、null/省略保留旧值、冲突/空值/非法参数、共享引用隔离、已有连接保留、重新加载、凭据服务失败不泄露密码。初始缺少功能时 8 项失败，实现后通过。
- Chrome 156.0.8078.74：24 场景、106 步骤通过，涵盖终端、环境管理、密码查看/隐藏、网页、文件、API 等。该层使用真实插件前后端和脚本化宿主。证据：`output/playwright/environment-password-v0.13.2-browser/report.json`。
- UI 契约：14 通过、0 错误；1 个提示为此包不是 Codex 插件。两个修改的随包 skill 结构检查通过，工具 Schema 回归通过。
- 最终候选包 SHA256：`cac274ae0d04dd8f99bbe8bbd15ef4a0e9ac9ec73f413d5f263b0852f73ff732`。
- Windows 11、真实 DSH **0.2.1-rc.5**、Chrome、官方安装 CLI、真实凭据服务和原生工具分发：**5/5 通过，页面运行时错误 0**。证据：`output/playwright/environment-password-v0.13.2-candidate-2/evidence.json`。

五个真实宿主场景：

1. 从对话提供的测试凭据创建 SSH、Telnet、Token 和 Cookie 四种环境，保存四个独立引用，配置和工具结果不含密码。
2. 保存的凭据实际完成 SSH/Telnet 登录、可见终端命令，以及 API Token/Cookie 登录和请求。
3. 通过工具替换四种密码，SSH/Telnet sessionId、streamId 和原连接保留；随后改名并省略/null 密码，不重写凭据。
4. GUI 按需查看 Agent 保存的新密码，隐藏后清除显示值；页面刷新恢复环境与终端回显。
5. 重启隔离 DSH 后凭据/配置仍在，新连接使用新密码；全部实际 API 登录 4 次、请求 4 次。

完整回归首次运行发现旧的公开方法清单没有新增保存方法，更新清单后通过。原生脚本第一次运行已通过密码流程；补充界面回显检查时，重启后仍等待旧活动终端导致超时，证据保留在 `output/playwright/environment-password-v0.13.2-candidate-final/`。脚本修正为在新进程选择本地 CMD，再创建新远程连接，最终 5/5 通过；没有通过放宽密码或连接断言掩盖失败。

## 复现与边界

```powershell
npm run check --prefix integrations/dsh-remote-ops
$env:DSH_CLI = 'path-to-installed-dsh/lib/bin.js'
$env:PASSWORD_OUTPUT = 'output/playwright/environment-password-new-run'
node e2e/runner/environment-password-native.mjs path-to-release.tgz
```

设备、API 和模型响应使用隔离的本地测试服务；测试实际经过 DSH 工具 Schema、分发和凭据保存，并执行真实 SSH/Telnet/HTTP 连接。该证据不代表任意模型均会选择正确工具，也不代替用户内网设备验收。没有访问生产账号，未替换用户 Desktop 中的安装。

环境 JSON 和插件工具结果不保存/返回明文密码；对话与工具入参历史由 DSH 管理，未宣称会从宿主历史中移除用户提供的密码。已有连接保留指配置修改期间；进程重启后需要新建连接。

## 正式发布、下载与安装验收

- [v0.13.2 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.13.2) 已发布；Latest API 和列表首位均为 `dsh-remote-ops-v0.13.2`。标签指向 `2ebb06ee0ebf2f3b62d7e8773d7f09b743ab3705`。
- 附件恰好两个：`dsh-remote-ops-v0.13.2.tgz`（679434 字节）和 `SHA256SUMS-dsh-remote-ops-v0.13.2.txt`（93 字节）。下载包、SHA256 文件、GitHub asset digest 一致：`950c35f72392c800ce18819d5ed4ada8153879c1bff4ac9dcd1fe4fd3990aec9`。
- 正式包在 CI 重新构建 Windows 桌面运行时，整体摘要与候选包不同。80 个源码、客户端、说明及随包 skill 文件与已验证源文件逐字节一致；桌面运行时 manifest 校验通过。证据：`output/environment-password-v0.13.2/official/verification.json`。
- 直接下载的正式 tgz 安装到新的隔离 DSH **0.2.1-rc.5** 后，**5/5** 项凭据与实际连接验收通过，页面运行时错误 **0**。验证密码创建/替换、旧连接保留、GUI 查看、重启持久化和新密码登录；API 登录 4 次、请求 4 次。证据：`output/playwright/environment-password-v0.13.2-official/evidence.json`。
- [发布工作流](https://github.com/Ssshake1996/myterm/actions/runs/41576632892)、[Linux CI](https://github.com/Ssshake1996/myterm/actions/runs/41576632848)、[浏览器回归](https://github.com/Ssshake1996/myterm/actions/runs/41576629225)、[Windows 桌面验收](https://github.com/Ssshake1996/myterm/actions/runs/41576629280) 和 [Windows OpenSSH 验收](https://github.com/Ssshake1996/myterm/actions/runs/41576629188) 全部通过。后两项均包含 Server 2022 和 Server 2025；OpenSSH 工作流包括真实 Windows 连接、安装到原生 DSH 后的跨会话终端、延后热加载与启动失败恢复。

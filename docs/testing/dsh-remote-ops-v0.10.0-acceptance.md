# Remote Ops v0.10.0 Windows OpenSSH 验收

**状态：候选包验证记录，v0.10.0 未生成正式 Release。** [发布流程 40115939529](https://github.com/Ssshake1996/myterm/actions/runs/40115939529)的 Windows 检查遇到 `RUNNER~1` 与 `runneradmin` 同一目录别名的测试误判；保留原标签及失败记录。修正测试后的正式版本见 [v0.10.1 验收记录](dsh-remote-ops-v0.10.1-acceptance.md)。

2026-10-25。第一阶段实现 Windows OpenSSH；真实 Windows 使用隔离测试账号的现有身份、回环 SSH 连接和测试目录，不代表用户的内网或生产设备。未改 Agent 源码或全局配置。测试服务器二进制不随插件发布。

## 实现与测试边界

- 环境管理、Windows Shell / 编码 / 参数 / 路径、身份校验、连接诊断、终端、SFTP、日志与随包 Windows skill。
- 真实 Windows 11 Home 10.0.22631 x64，Windows PowerShell 5.1；Microsoft OpenSSH 9.8.3.0p2 Preview，独立进程、回环端口、Ed25519 密钥认证。
- GitHub Windows Server 2022 / 2025 测试机，Microsoft OpenSSH 同版本、回环密钥认证。Server 功能与测试进程正常退出都纳入通过标准。
- DSH 0.2.0-rc.2，Chrome 155。使用独立 DSH_HOME、安装候选 tgz 和确定性模型服务，模型只发出可重复的测试工具调用，工具与 SSH 操作实际执行。
- 密码认证、域账号、Server Core、Server 2019、Windows 10、Pro / Enterprise 专项、跨机器网络与企业组策略仍需相应目标验收。不能由本机 CMD、模拟设备或回环密钥测试推断这些组合全部通过。

## 可重复执行

```powershell
npm ci --prefix integrations/dsh-remote-ops
npm run check --prefix integrations/dsh-remote-ops
node e2e/runner/index.mjs --output output/e2e/windows-validation

# 指向已解压的、核验 Microsoft 签名的 Win32 OpenSSH 测试目录。
$env:WINDOWS_OPENSSH_BIN = 'C:/test-tools/OpenSSH-Win64'
$env:WINDOWS_SSH_OUTPUT = 'output/windows-ssh-live'
node integrations/dsh-remote-ops/test/windows-ssh-live.mjs

# 实际 DSH 安装与原生工具；保持与生产 profile 隔离。
$env:DSH_CLI = 'C:/path/to/@deepseek-ai/dsh/lib/bin.js'
$env:WINDOWS_NATIVE_OUTPUT = 'output/windows-native'
node e2e/runner/windows-native.mjs output/release0100-candidate/dsh-remote-ops-v0.10.0.tgz
```

真实 SSH 脚本自动选回环端口，在输出目录创建临时主机/客户端密钥及独立 sshd_config，不安装系统服务，不修改防火墙、DefaultShell、用户 profile 或全局 authorized_keys。只上传 `evidence.json` 与 `sshd.log`，不上传测试私钥。

## 开发期间的失败与修复

1. 初次真实测试暴露数字 SFTP 错误被当作字符串处理的问题；统一保留错误码并修正分类。
2. Windows 11 同时保持 PTY 并执行命令时复现 `3221225794`。直接 ssh2 对照也发生过，不能只凭错误码认定是插件或 Windows 系统缺陷。保持两个 PTY 的对照中，复用连接 1/6 成功，独立连接 6/6 成功；因此 Windows 独立命令改用单独认证的 SSH 连接。
3. 更完整的文件操作序列仍暴露失败及进程收尾挂起。实际连接出现 CLOSE_WAIT；核查 ssh2 1.17 源码发现 `destroy()` 仅在 socket 可写时执行，先 `end()` 再 `destroy()` 可能无效。已改为在任务完成或主动关闭时直接释放所拥有的连接，终端、SFTP、诊断与独立任务采用相同清理方式。
4. 修正后本机完整九组真实 SSH 检查通过并正常退出；真实 DSH 三组检查也通过，包括六个 skill 原生加载、实际 Windows 工具链和环境表单/主对话草稿保留。后续加入第二盘符和已安装 PowerShell 7 的条件验收。
5. 指纹存储读取失败会明确拒绝连接，不退化为首次信任；诊断捕获 exec 失败并标注实际阶段，SFTP 路径查询可取消。

初次 Server CI：[40113184415](https://github.com/Ssshake1996/myterm/actions/runs/40113184415)。Server 2025 九组通过；Server 2022 九组功能通过但进程收尾超时，该次作业记为失败。失败证据保留，不用后续成功覆盖。

## 最终候选包验证

源代码提交 `fe6e38f`，版本 `0.10.0`。后续验收文档与测试截图断言不改变插件包内容。

| 层次 | 结果 | 证据与边界 |
| --- | --- | --- |
| 本机完整 check | 402/402 + smoke 通过 | 276 单元/后端、115 客户端、11 契约；包含原生 Windows PowerShell/CMD 子进程测试 |
| 浏览器回归 | 21/21 通过 | `output/e2e/windows0100`；真实插件前端、仿宿主及隔离设备/服务，不能替代原生 DSH |
| Windows 11 Home 10.0.22631 x64 | 10/10，通过并退出 | `output/windows-ssh-live-0100/evidence.json`；CMD、Windows PowerShell 5.1、C:/F:、中文/特殊字符、错误码/取消、SFTP/覆盖/二进制 SHA256、日志、跨对话隔离和主机密钥变化 |
| Server 2022 Datacenter 10.0.20348 x64 | 11/11，通过并退出 | Windows PowerShell 5.1、已安装 PowerShell 7、CMD、C:/D: 与同一完整 SSH 验收 |
| Server 2025 Datacenter 10.0.26100 x64 | 11/11，通过并退出 | 同上；独立实际 Windows 系统，不是模拟 SSH |
| 原生 DSH Windows 工具链 | 3/3 通过 | 安装候选包后，六个 skill 原生加载；13 次环境/诊断/PTY/脚本/SFTP/日志工具调用，中文参数/文件内容与 ZIP 摘要检查；环境编辑和主对话草稿保留 |
| 原生 DSH 通用界面 | 8/8 通过 | 终端、网页、API、文件、设置、环境返回、320/390/1280/1500px、深浅色、键盘操作与六个随包 skill |
| 原生 HTTP 更新 | 8/8 通过 | 官方 v0.9.2 → 候选 v0.10.0，经插件更新 UI 下载校验并安装，重启后激活；两次实际 DSH 重启、手动更新失败详情及状态 404 单次提示；非注入的意外 404 为 0 |
| 原生卸载 / 重启 | 通过 | 仅对隔离 profile 卸载；环境文件内容保留，重启后入口与面板移除，浏览器无异常 |
| 契约 / skill | 通过 | UI 静态契约 14 项；六个 skill 的结构验证通过。非 Codex 插件 manifest 提示不属于 DSH 错误 |

最终 Linux CI：[40115295730](https://github.com/Ssshake1996/myterm/actions/runs/40115295730)。最终 Server 双系统 CI：[40115295760](https://github.com/Ssshake1996/myterm/actions/runs/40115295760)，两个作业均成功；可下载各系统的 `evidence.json` 和 `sshd.log`。

候选 tgz 的 SHA256：

```text
a1ce18229c39e0d4a5f5ee198ee1ebcde085f9c61ab1d253b43216d4a3bee3db
```

此摘要只对应 v0.10.0 候选包，不能当作正式发布凭据。Windows 目标均使用隔离回环密钥认证，未将这些结果表述为用户内网或生产环境验收。

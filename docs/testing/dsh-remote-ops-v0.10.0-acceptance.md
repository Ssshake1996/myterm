# Remote Ops v0.10.0 Windows OpenSSH 验收

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

最终版本的回归、Server、安装升级和 Release 校验结果在发布完成后补充于本页。

# Remote Ops v0.10.1 Windows OpenSSH 验收

2026-10-25。Windows OpenSSH 实现和首次候选验证详见 [v0.10.0 开发验收记录](dsh-remote-ops-v0.10.0-acceptance.md)。v0.10.0 因发布阶段 Windows 路径别名的测试误判而中止，未生成正式 Release，原标签与失败日志保留。

v0.10.1 保留相同插件实现，仅同步版本、修正原生 PowerShell 测试的路径比较，并将完整 `npm run check` 加入 Server 2022 / 2025 的发布前矩阵。路径比较使用 `realpath`，仍验证参数内容与实际工作目录，不忽略工作目录错误。

真实测试范围：Windows 11 Home 10.0.22631、Server 2022 Datacenter 10.0.20348、Server 2025 Datacenter 10.0.26100；均为 x64、Microsoft OpenSSH 9.8.3.0p2 Preview、隔离回环、Ed25519 密钥认证。实际 DSH 版本 0.2.0-rc.2，Chrome 155。密码认证、域账号、Server Core、Server 2019、Windows 10、Pro / Enterprise 专项、跨机器内网与企业策略尚未实测。Agent 源码及全局配置未修改。

## 源码与发布前验证

发布源码提交：`d2c06b78b0b364e7bdd5e86bedf5a3ad011a5355`。标签：`dsh-remote-ops-v0.10.1`。

| 验证层次 | 结果 | 实际范围 |
| --- | --- | --- |
| 本地 Windows 完整回归 | 402/402 + smoke 通过 | 276 单元/后端、115 客户端、11 契约；包括原生 CMD / Windows PowerShell 子进程 |
| Server 2022 发布前检查 | 402/402 + smoke、11/11 真实 SSH 通过 | CMD、Windows PowerShell 5.1、已安装 PowerShell 7；C:/D:、中文和特殊字符参数、SFTP、二进制传输 SHA256、错误退出、取消、会话隔离、日志和主机密钥变化；测试进程正常退出 |
| Server 2025 发布前检查 | 402/402 + smoke、11/11 真实 SSH 通过 | 与 Server 2022 使用同一测试集，在独立真实 Windows 系统执行 |
| 原生 DSH 安装候选包 | 3/3 通过 | 六个 skill 从 DSH 原生注册表加载；13 次真实 Windows 环境/诊断/PTY/脚本/SFTP/日志工具调用；环境表单、返回工作区、主对话草稿、远端 CMD 可见输出和窄屏布局 |
| 原生 DSH HTTP 更新 | 8/8 通过 | GitHub 正式 v0.9.2 → 候选 v0.10.1；实际下载、校验、安装和重启激活；manifest / checksum / tgz 失败地址；状态 404 单次提示及重启重置；未注入的意外 404 为 0 |

- [Server 2022 / 2025 发布前矩阵](https://github.com/Ssshake1996/myterm/actions/runs/40116512205)：两个作业均成功，每个作业提供 `evidence.json` 与 `sshd.log`。
- [Linux CI](https://github.com/Ssshake1996/myterm/actions/runs/40116512180)：成功。
- 本地候选证据：`output/windows-native-0101-candidate/evidence.json`、`output/playwright/update0101-native-candidate-1792863146617-evidence.json`、`output/windows0101-package.log`。

本次还沿用 v0.10.0 相同插件实现的 21/21 浏览器回归、8/8 原生 DSH 通用界面、Windows 11 完整 10/10 SSH、隔离 profile 卸载及六个 skill 的结构验证。两版包逐文件比对，仅六个文件的版本字符串变化；没有将这些旧版验证标成新跑的 v0.10.1 测试。相关证据和测试边界见上一版开发验收记录。

## 可执行的 Windows 验证

```powershell
npm ci --prefix integrations/dsh-remote-ops
npm run check --prefix integrations/dsh-remote-ops

# Microsoft 签名已核验的 Win32 OpenSSH 解压目录。
$env:WINDOWS_OPENSSH_BIN = 'C:/test-tools/OpenSSH-Win64'
$env:WINDOWS_SSH_OUTPUT = 'output/windows-ssh-live'
node integrations/dsh-remote-ops/test/windows-ssh-live.mjs

# 真实 DSH CLI；脚本自行建立隔离的 DSH_HOME 和测试 profile。
$env:DSH_CLI = 'C:/path/to/@deepseek-ai/dsh/lib/bin.js'
$env:WINDOWS_NATIVE_OUTPUT = 'output/windows-native-0101'
node e2e/runner/windows-native.mjs path/to/dsh-remote-ops-v0.10.1.tgz
```

测试使用当前 Windows 账号的现有身份和独立 Ed25519 测试密钥，在回环端口启动 OpenSSH；不安装系统服务，不修改防火墙、DefaultShell、用户 profile 或全局 authorized_keys。临时密钥仅留在忽略的本地输出目录，不进入仓库和 Release。原生 DSH 使用确定性模型服务调度真实插件工具，没有替换 SSH 执行，也没有修改 Agent。

## 正式发布与下载后安装

[正式 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.10.1) 已发布并被 GitHub 标记为 Latest；不是草稿或预发布。[发布流水线](https://github.com/Ssshake1996/myterm/actions/runs/40116959769)的 Linux 打包、Windows 完整检查、发布三个作业全部成功。

从 GitHub 重新下载附件后验证：

- 仅有 `dsh-remote-ops-v0.10.1.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.10.1.txt` 两个 Release 附件。
- tgz 与候选包字节相同；本地 SHA256、校验文件与 GitHub 资产 digest 一致。
- 73 个包内文件逐一匹配发布标签源码；包含六个 skill 和 Windows 指南，不包含 Agent、测试私钥、OpenSSH 二进制或测试输出。
- **正式下载包安装到全新隔离 DSH_HOME 后，原生 Windows 验收 3/3 通过**：六个 skill 加载、13 次真实 Windows 工具调用、环境表单/草稿保留、远端 CMD 可见回显、390px 布局。安装版本确认为 `0.10.1`，浏览器异常列表为空，测试进程正常退出。

```text
SHA256 dsh-remote-ops-v0.10.1.tgz
3f18c5218b917701f2bd38db11c08aa8d228efa20e513c13fb92fd2f9958c96e
```

本地正式证据：`output/release0101-official/audit.json`、`output/release0101-candidate/git-source-audit.json`、`output/windows-native-0101-official/evidence.json` 及同目录环境/终端/窄屏截图。

观察到 Windows PowerShell 5.1 首次加载模块时，可能仍在 stderr 返回原始 CLIXML 进度信息；独立命令的退出码、stdout 和参数结果已验证，未将其描述为所有错误流均已格式化。判断执行结果应同时检查退出码和业务结果。

这些验证覆盖已列出的真实 Windows 系统和回环密钥认证，不代表用户尚未提供的内网设备、密码/域认证或企业安全策略已验收。

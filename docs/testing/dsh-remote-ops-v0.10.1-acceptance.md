# Remote Ops v0.10.1 Windows OpenSSH 验收

2026-10-25。Windows OpenSSH 实现和首次候选验证详见 [v0.10.0 开发验收记录](dsh-remote-ops-v0.10.0-acceptance.md)。v0.10.0 因发布阶段 Windows 路径别名的测试误判而中止，未生成正式 Release，原标签与失败日志保留。

v0.10.1 保留相同插件实现，仅同步版本、修正原生 PowerShell 测试的路径比较，并将完整 `npm run check` 加入 Server 2022 / 2025 的发布前矩阵。路径比较使用 `realpath`，仍验证参数内容与实际工作目录，不忽略工作目录错误。

真实测试范围：Windows 11 Home 10.0.22631、Server 2022 Datacenter 10.0.20348、Server 2025 Datacenter 10.0.26100；均为 x64、Microsoft OpenSSH 9.8.3.0p2 Preview、隔离回环、Ed25519 密钥认证。实际 DSH 版本 0.2.0-rc.2，Chrome 155。密码认证、域账号、Server Core、Server 2019、Windows 10、Pro / Enterprise 专项、跨机器内网与企业策略尚未实测。Agent 源码及全局配置未修改。

最终 CI、包校验及正式安装记录在发布后追加于本页。

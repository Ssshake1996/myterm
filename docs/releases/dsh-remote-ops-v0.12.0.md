# dsh-remote-ops v0.12.0

新增 Windows 桌面工作区：Agent 和用户可在同一个真实 Windows 软件窗口中操作，查看截图、填写内容、点击按钮并核实结果。支持 DSH 本机 Windows，以及已有 Windows SSH 环境中的已登录用户桌面。

- 随包提供 UIA3 执行器，优先使用控件引用，补充窗口坐标、键盘和 Unicode 输入。远程执行器通过 SFTP 部署，使用明确的交互会话，控制流走经过认证的 SSH 转发。
- 新增七个 `remote_desktop_*` 工具和 `remote-ops-desktop` skill，包含严格动作参数、快照有效期、请求去重、取消与未知结果处理。
- 桌面画面、窗口选择、打开应用和输入位于一个工作区；原生对话停止控制后续步骤，用户无需切换接管模式。
- 当前对话可一键导出桌面操作记录及最后窗口图。断开保留程序，热加载等待任务完成并交接连接。
- README、Windows 桌面指南和随包技能同步。Agent 与宿主核心无需修改。

目标需要 Windows 11 x64 或带 Desktop Experience 的 Windows Server、.NET Framework 4.8+ 和已登录解锁的用户会话。远程连接还需 OpenSSH SFTP、PowerShell 与本地 TCP 转发权限。

发布资产只有插件 `.tgz` 和 `SHA256SUMS` 校验文件，桌面运行时包含在 tgz 内。验证证据见 [验收记录](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.12.0-acceptance.md)。

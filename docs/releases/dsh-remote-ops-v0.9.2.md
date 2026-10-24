# dsh-remote-ops v0.9.2

工作区标签紧凑靠左排列，选中状态更清楚。

- “终端 / 网页 / 文件 / API”不再分散到整行两端，蓝色指示条覆盖完整标签按钮；标签内留白也可点击。
- 窄栏按可用宽度收紧留白，继续显示文字与后台任务徽标，保留方向键、Home / End 和工作区状态。
- README、真实 DSH 产品截图与随包环境管理 skill 同步。
- [Windows 远程连接实现方案](https://github.com/Ssshake1996/myterm/blob/main/docs/proposals/windows-remote-implementation.md)单独提供，覆盖 Windows 桌面和 Server、OpenSSH 与 WinRM；本版本未实现这些新增能力。

发布附件仅 `dsh-remote-ops-v0.9.2.tgz` 与 `SHA256SUMS-dsh-remote-ops-v0.9.2.txt`，不修改 Agent。内网源继续使用 HTTP/HTTPS 和手动检查更新。

验证结果见[验收记录](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.9.2-acceptance.md)。升级后完全停止旧 DSH 进程、重新启动并刷新网页，在“设置 → 通用”确认 v0.9.2。

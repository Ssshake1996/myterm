# dsh-remote-ops v0.16.0

本地终端支持 CMD、Windows PowerShell 5.1、PowerShell 7 和已安装的 WSL 发行版，默认启动只打开一个终端，其他终端按需新建。

- 标签旁的 **+** 新建默认终端，下拉菜单选择具体 Shell 或 WSL 发行版。未安装项显示原因，终端标签支持原有的左右滚动。
- **设置 → 终端 → 本地终端** 保存默认类型、启动目录及可选 WSL 用户，支持重新检测。配置只影响后续新建与下次启动。
- 新增 `remote_local_shells`、`remote_local_open`。Agent 默认复用符合启动配置且无已知任务的本地会话；用户明确新建时得到独立进程。后续输入、读取、脚本、信号和日志按精确 sessionId 操作。
- 多个本地终端跨对话共享，复制粘贴和回显高亮沿用现有交互。默认标签保留；额外本地标签可单独关闭。“全部关闭”仍只清理当前对话的远程连接。
- 终端退出后保留最后输出，提供显式重新打开入口；不会自动重放命令。TXT／ZIP 日志导出覆盖全部本地会话，兼容热加载保留现有进程。
- 默认会话沿用 `local-cmd` ID；实际 Shell 以返回的 `shell` 字段为准。同步中英文 README 与随包环境、日志 skill，不修改 Agent。

仅发布 `dsh-remote-ops-v0.16.0.tgz` 与 `SHA256SUMS-dsh-remote-ops-v0.16.0.txt`。PowerShell 7 和 WSL 发行版使用 DSH 主机上已安装的版本。

验证记录：[本地多终端验收](../testing/dsh-remote-ops-v0.16.0-acceptance.md)。

# @dsh/remote-ops

独立的 DeepSeek Harness 远程运维插件，不依赖 myterm 桌面程序。

## 能力

- 按分组保存环境，文件位于 `remote-ops/<分组>-environments.json`。
- 使用 `ctx.terminals` 管理按 Agent 隔离的 SSH 会话。
- 支持完整命令下发、交互式输入和信号控制。
- 支持多个目标顺序协同执行，并返回每个目标的结果。
- 支持 SFTP 列目录、读写、创建目录、删除和重命名。
- 支持快捷命令保存和执行。
- 提供 Agent 可读取的诊断事件，以及 DSH 右侧 Sidebar。
- 密码只通过 Harness credentials 的 `passwordRef` 引用，不保存明文。

## 安装

将本包安装到 DSH profile，并把 `cordis.patch.yml` 中的两行加入 profile patch。插件不修改 DSH 核心，也不依赖 myterm，可直接用于 DSH Web 或其他 DSH Host。

SSH PTY 遵循 Harness 约定，只在进程内存中存在；环境定义会持久化，DSH 重启后按需重新打开连接。

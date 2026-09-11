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
- 在 DSH Web Sidebar 底部提供可见的 `Remote Ops` 启动按钮，点击后只展开右侧 Sidebar，不隐藏当前对话。
- 密码只通过 Harness credentials 的 `passwordRef` 引用，不保存明文。

## 安装

使用 DSH 官方插件管理器安装 release 压缩包。包内的 `dsh.bundle.patch` 声明会自动把插件加入 profile，不需要手工复制 patch。

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.1.4.tgz
dsh web
```

如果使用已经发布到 registry 的包，则包名为：

```sh
dsh plugin --profile web add @dsh/remote-ops
```

本仓库以 GitHub Release 压缩包作为标准交付物；本地源码也可以先执行 `npm pack`，再用同样的命令安装。

插件与 myterm 完全独立，宿主只需要提供 DSH 文档中定义的服务即可。

SSH PTY 遵循 Harness 约定，只在进程内存中存在；环境定义会持久化，DSH 重启后按需重新打开连接。

DSH Web 启动后，点击 Sidebar 底部的 `Remote Ops` 即可主动展开右侧 Sidebar，同时保留当前对话。没有选中 DSH 对话时，按钮会先启动新的 DSH 对话；选择对话后，SSH 和 SFTP 操作仍由 Harness 会话管理。

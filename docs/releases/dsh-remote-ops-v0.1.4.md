# dsh-remote-ops v0.1.4

## 右侧 Sidebar 启动

- `Remote Ops` 按钮位于 DSH Web 左侧 Sidebar 底部操作区。
- 点击按钮只打开右侧 Sidebar，主对话保持可见，不再替换或隐藏对话。
- 没有活动对话时，按 DSH 官方 API 启动新会话后再打开面板。

## 会话初始化状态

- Agent 尚未初始化时，状态接口返回可展示的目录快照，不再返回 404。
- 右侧 Sidebar 显示“等待 Agent 初始化”，初始化完成后自动可用 SSH、终端和 SFTP 操作。
- 所有操作仍由当前 Harness Agent 会话执行，未绑定时按钮保持禁用。

## 安装

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.1.4.tgz
dsh web
```

## English

Version 0.1.4 keeps the DSH conversation visible and opens Remote Ops only in
the official right Sidebar. It also returns a normal catalog snapshot while a
new conversation is waiting for Harness Agent initialization, avoiding browser
404 errors before the first prompt.


# dsh-remote-ops v0.1.3

## 会话初始化状态

- 修复新建 DSH 对话但 Agent 尚未初始化时，Remote Ops 状态接口返回 404 的问题。
- 右侧 Sidebar 会展示“等待 Agent 初始化”，不再产生浏览器 404 错误。
- SSH、终端和 SFTP 操作仍只在 Harness Agent 会话建立后启用。

## 右侧 Sidebar 启动

- Sidebar 底部的 `Remote Ops` 按钮只展开右侧 Sidebar，不隐藏当前对话。

## 安装

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.1.3.tgz
dsh web
```

## English

Version 0.1.3 fixes the uninitialized-session state. A newly created DSH
conversation now shows a normal “waiting for Agent initialization” state in
Remote Ops instead of repeated 404 responses. The sidebar launch button keeps
the conversation visible and opens only the right Sidebar.

# dsh-remote-ops v0.1.1

## 主动启动入口

- DSH Web 左侧 Sidebar 增加 `Remote Ops` 全局入口按钮。
- 点击按钮后直接进入 Remote Ops 工作区，不需要等待 Agent 工具调用。
- 无 DSH 对话时仍可查看已保存环境和快捷命令，并可点击“新建 DSH 对话并继续”。
- 选择或创建 DSH 对话后，SSH、终端和 SFTP 操作仍通过 Harness 会话所有权执行。

## 安装

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.1.1.tgz
dsh web
```

## 验证

- 插件 `npm run check` 通过。
- 官方 DSH Web profile 成功加载插件 bundle 和客户端入口。
- Web 页面动态插件请求返回 200，浏览器控制台无插件加载错误。

## English

Version 0.1.1 adds an explicit `Remote Ops` launch button to the DSH Web
sidebar. It opens a global Remote Ops workspace immediately, even before a DSH
conversation exists. SSH, terminal, and SFTP mutations remain available only
after a DSH conversation is selected, preserving Harness-owned session
lifecycle and authorization.

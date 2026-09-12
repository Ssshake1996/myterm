# dsh-remote-ops v0.2.0

## 纯 DeepSeek Harness 插件

- 仓库主分支删除旧 myterm 桌面应用、Tauri 宿主、旧运行时和实验代码。
- Remote Ops 只作为官方 DeepSeek Harness Web 插件发布；Git 历史保留，后续 Release 不再构建桌面安装包。

## Sidebar 工作区

- 使用官方右侧 Sidebar 扩展点，主对话保持可见。
- 增加常驻窄导航栏和可隐藏环境抽屉。
- 环境抽屉支持分组、搜索、环境添加、编辑、删除和显式连接。
- SSH 终端始终作为主要区域，多 SSH 连接使用终端标签。
- 快捷命令固定在终端下方，支持分组、添加、编辑、删除和多行命令一次性执行。
- SFTP 和诊断作为辅助抽屉打开，不卸载或替换终端。

## 数据与工具

- 环境按分组目录保存为 `environments/<group>/environments.<group>.json`。
- 快捷命令按分组目录保存为 `quick-commands/<group>/commands.<group>.json`。
- 新增环境分组和快捷命令分组工具。
- SSH、终端、SFTP 和多 SSH Agent 工具继续由 Harness 会话管理。
- 密码和私钥仍使用 Harness credentials 引用，不写入 JSON。

## 安装

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.2.0.tgz
dsh web
```

## English

Version 0.2.0 is the first pure DeepSeek Harness plugin release. The main
branch no longer contains the myterm desktop application. Remote Ops now uses
a narrow rail, a hideable environment drawer, a persistent multi-session SSH
terminal, and a quick-command dock below the terminal while keeping the DSH
conversation visible.

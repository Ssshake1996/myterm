# DSH Remote Ops

`@dsh/remote-ops` 是面向 DeepSeek Harness 的 SSH 远程运维插件。本仓库已完成产品边界切换，不再包含 myterm 桌面应用、Tauri 宿主或第二套 Agent 内核。

## 能力

- DSH Web 右侧 Sidebar 插件，主对话保持可见。
- 窄导航栏与可隐藏的环境抽屉。
- 环境分组、SSH 环境的创建、编辑、删除和持久化。
- 多 SSH 终端标签，终端始终作为主要工作区。
- 快捷命令分组管理，快捷命令位于终端下方。
- 多行命令一次性下发，不拆成大量短请求。
- SFTP 目录读取、文件读写、创建目录、删除和重命名。
- Multi-SSH 顺序协同工具、Agent 可读诊断和 Harness 凭据引用。

## 安装

从 [GitHub Releases](https://github.com/Ssshake1996/myterm/releases) 下载插件包，然后执行：

```powershell
dsh plugin --profile web add .\dsh-remote-ops-v0.2.0.tgz
dsh web
```

本地开发检查：

```powershell
npm --prefix integrations/dsh-remote-ops install
npm --prefix integrations/dsh-remote-ops run check
```

## 目录

```text
integrations/dsh-remote-ops/
├─ lib/index.js       # Harness Host、SSH、SFTP、工具和持久化
├─ lib/client.js      # DSH Web Sidebar UI
├─ cordis.patch.yml   # 官方 DSH bundle patch
└─ test/smoke.mjs     # 插件静态烟测
```

运行数据由插件独立保存到 `$DSH_HOME/remote-ops`：

```text
remote-ops/
├─ environments/<group>/environments.<group>.json
└─ quick-commands/<group>/commands.<group>.json
```

密码和私钥不写入 JSON，使用 Harness credentials 的引用。

## 发布

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/release-dsh-remote-ops.ps1 -Version 0.2.0
```

发布脚本会执行插件检查、打包、提交、创建 Tag、推送主分支和发布 GitHub Release。

## 边界

- Agent Loop、Session、Goal、Skill、MCP、权限和本地工具完全由 DeepSeek Harness 负责。
- 本插件只提供 SSH、交互式终端、SFTP、快捷命令、多 SSH 和远程诊断能力。
- 本仓库不再构建或启动 myterm 桌面程序。

详细说明见 [插件中文说明](integrations/dsh-remote-ops/README.zh-CN.md)、[插件英文说明](integrations/dsh-remote-ops/README.md) 和 [开发经验记录](docs/development-experience.md)。

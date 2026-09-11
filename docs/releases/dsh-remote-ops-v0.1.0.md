# dsh-remote-ops v0.1.0

首个独立 DeepSeek Harness 远程运维插件版本。

## 交付范围

- 通过 DSH 官方插件管理器安装，不启动、不嵌入 myterm。
- SSH 环境分组持久化、按会话隔离的 PTY 终端和多目标顺序协同。
- 快捷命令、SFTP、诊断信息，以及 DSH Web 右侧 Sidebar 面板。
- Agent 工具覆盖环境、终端、批量执行、快捷命令、SFTP 和诊断。
- 插件自己的 `dsh.bundle.patch` 声明，不要求用户手工修改 DSH profile。

## 安装

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.1.0.tgz
dsh web
```

## 验证

- `npm --prefix integrations/dsh-remote-ops run check`
- 在已安装的官方 DSH Web profile 中执行 `dsh web --dump-config`，确认插件 bundle 行。
- 启动官方 DSH Web，确认插件客户端脚本加载且浏览器控制台无插件加载错误。

## English

This is the first standalone DeepSeek Harness remote-operations plugin. It is
installed by the official DSH plugin manager and does not start or embed
myterm. The release contains SSH environments, persistent PTY sessions,
multi-target execution, quick commands, SFTP, diagnostics, Agent tools, and a
native DSH Web right-sidebar panel.

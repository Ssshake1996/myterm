# myterm

[English](README.en.md) | 简体中文

myterm 是一款面向开发、运维和服务器管理场景的轻量级桌面终端。它使用 Tauri 2、Rust、React 和 xterm.js 构建，在一个紧凑工作区中整合 SSH、本地终端、服务器管理、SFTP、快捷命令和可执行工具的 AI Agent。

当前版本：`0.6.3`

## 核心功能

### 服务器与会话管理

- 新增、编辑、删除 SSH 和本地终端配置。
- 保存服务器名称、分组、环境、主机、端口、用户名、认证方式和终端类型。
- 密码、私钥口令和 AI API Key 只存入操作系统凭据库，配置文件仅保存引用。
- 点击服务器即可连接；应用重启后仍可使用已保存凭据自动登录。
- 支持会话搜索、树形分组、拖动标签排序和连接状态显示。

### 终端工作区

- 基于 xterm.js 的完整交互终端，支持 UTF-8、颜色、WebGL 渲染和自适应尺寸。
- 支持多个会话标签；关闭标签时会主动断开其全部连接。
- 支持向右分屏、调整比例和独立关闭任一分屏，不保留隐藏连接。
- 工作区工具栏可在终端与 SFTP 文件视图间切换。
- 本地终端与 SSH 会话使用相同的标签和分屏体验。

### 快捷命令库

- 按命令集管理常用、部署和排查命令，可承载几十条以上命令。
- 紧凑列表只展示命令名称，不在主界面暴露长命令正文。
- 支持搜索、新建、编辑、删除、排序和多列滚动浏览。
- 一个快捷命令可包含多行内容；执行时每一行会按终端回车语义发送。
- 快捷命令面板可调整高度、明确收起，并保持名称垂直居中。

### SFTP 文件管理

- 复用当前 SSH 会话浏览本地和远程目录。
- 支持上传、下载、新建、重命名和递归删除。
- 显示文件大小、修改时间和权限，并提供传输队列与取消操作。
- Agent 文件写入采用同目录临时文件、同步、权限保留、哈希锁和读回校验。

### Linux 运维 Agent

Agent 使用类似 Claude Code 的循环：

```text
任务输入 -> 模型决策 -> 工具调用 -> 结果返回 -> 继续循环 -> 最终答复
```

- 持久化任务、事件、审批、工具审计、后台 Job、取消和崩溃恢复。
- AI 面板按时间线展示模型决策、工具名称、参数摘要、stdout、stderr、结果和状态。
- 任务输入支持 `Shift+Enter` 换行和输入法保护，顶部拖柄可将输入区向上扩大到 Agent 面板高度的一半。
- 基础工具覆盖会话信息、终端上下文、终端输入、结构化 SSH 命令、主机事实、目录和文件操作；后续按显式目标扩展多 SSH 协同。
- 结构化命令执行分别记录 stdout/stderr、退出码、信号、超时、取消和断连结果。
- 长任务可转入后台 Job，并通过状态、分页输出和取消工具继续管理。
- 内置诊断 Runbook、上下文压缩、循环检测和敏感字段脱敏。

### 权限与安全策略

| 模式 | 行为 |
|---|---|
| 只读 | 仅自动执行被策略识别为读取的操作 |
| 确认 | 有副作用的操作需要用户逐次确认，默认模式 |
| 任务授权 | 在非生产、非 root 场景下允许任务范围内的低/中风险操作 |

危险命令硬拒绝、生产/root 提权、输出限制、审计和密钥脱敏不能被 Prompt、Skill、Hook 或 MCP 绕过。Bash 命令通过 tree-sitter 解析，语法不完整或无法分类时不会自动执行。

### Skill、MCP 与 Hooks

- 从本地目录发现 `SKILL.md`，读取元数据和内容哈希，并按任务需要加载已启用 Skill。
- 支持配置和测试常用 stdio MCP 服务器，连接后列出工具并由 Agent 调用。
- MCP 工具较多时使用搜索和显式调用，避免一次性占满模型上下文。
- 支持有界、确定性的任务生命周期 Hooks；Hooks 不能降低核心权限策略。

### 远端 CLI、REST 与多 SSH 规划

- CLI 指 Agent 通过 SSH 大量执行 `systemctl`、`journalctl`、`docker`、`kubectl` 和业务命令，并取得结构化结果；不是要求 myterm 对外提供一套 CLI 产品接口。
- REST 指从明确的远端 SSH 主机调用业务或基础设施 HTTP API，保留真实网络视角、凭据脱敏和审计；不是要求 myterm 对外暴露 Agent REST 服务。
- 多 SSH 采用一个 Task 绑定多个保存的服务器，每次工具调用显式指定目标，支持 A 操作、B 观察、条件满足后继续。
- OS 安装规划为由本地 Skill 触发的安装 Task。Skill 生成和校验计划，真正的写盘、启动和电源动作由受审批的 provisioning 工具通过虚拟化平台、云 API、MAAS 或 Redfish/BMC 执行。

以上能力的完整边界、方案优缺点和阶段计划见[多 SSH 协同与 Skill 驱动 OS 安装方案](docs/multi-ssh-os-installation-plan.md)。`0.6.3` 已删除早期实现的本机 Agent CLI 和 loopback REST；myterm 保持桌面应用边界，CLI/REST 只表示 Agent 在远端 SSH 环境中执行命令和 HTTP 请求。

### 外观与帮助

- 白色、护眼色和深色三套主题，设置会持久化并同步到终端画布。
- 紧凑的 34px 会话标签栏和全高侧栏，适配桌面及窄窗口。
- 标题栏右侧帮助按钮可在应用内打开离线使用说明书。

## 技术架构

```text
React UI
  -> typed IPC adapter
    -> Tauri commands
      -> Agent application service
        -> policy + audit + SQLite task store
        -> SSH targets / PTY / SFTP / Skill / MCP / Hooks
        -> planned provisioning adapters
```

- `src/`：React 界面、状态管理和类型化 IPC 边界。
- `src-tauri/`：Rust 服务、Agent 内核与 Tauri 桌面入口。
- `myterm-spec/`：产品、架构、里程碑和验收规范。
- `myterm-prototype/`：早期静态交互原型。
- `docs/`：使用说明书、Agent 规范、开发计划和经验记录。

## 开发环境

需要 Node.js/npm、Rust stable MSVC、Visual Studio 2022 C++ Build Tools、WebView2。Windows 原生依赖还需要 NASM，或在非 FIPS 构建中使用 `AWS_LC_SYS_PREBUILT_NASM=1`。

```powershell
npm install
npm run typecheck
npm run lint
npm test
npm run dev
```

浏览器开发模式使用 IPC 边界中的内存演示适配器。桌面开发使用真实 Rust 服务和操作系统凭据库：

```powershell
npm run tauri dev
```

## 集成验证

真实验证从操作系统凭据库读取已经保存的服务器和 AI 配置，不在示例、日志或仓库中嵌入密钥：

```powershell
cd src-tauri
cargo run --example live_check -- verify-profile
cargo run --example live_check -- verify-exec
cargo run --example live_check -- verify-files
cargo run --example live_check -- verify-agent
cargo run --example live_check -- verify-mcp
```

## 构建与安装

```powershell
npm run build:release
npm run check:dist
```

发行流程生成 Windows NSIS 安装器和 `dist-release/` 下的便携 ZIP。安装新版本时会清理已验证的旧安装目录并保留配置和系统凭据；便携模式通过 `--portable` 或程序旁的 `portable.flag` 启用。

## 文档

- [中文使用说明书](docs/user-guide.zh-CN.md)
- [Linux Agent 改进研究](docs/linux-agent-improvement-study.md)
- [Linux Agent 开发计划](docs/linux-agent-development-plan.md)
- [Linux Agent 规范](docs/linux-agent-specification.md)
- [多 SSH 协同与 Skill 驱动 OS 安装方案](docs/multi-ssh-os-installation-plan.md)
- [开发经验记录](docs/development-experience.md)

## 当前边界

当前 `0.6.3` 尚未实现多 SSH Task、结构化远端 HTTP 工具或 Skill 驱动的 OS 安装；这些能力按专项方案分阶段开发。第一版仍不实现复杂多 Agent、长期记忆、云端 Skill 市场和远程 MCP 传输。聚合 WebView2 进程组内存仍高于项目的 80 MiB 目标，原生 Agent 内核保持轻量，完整浏览器运行时优化继续作为后续工作。

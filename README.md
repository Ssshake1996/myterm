# myterm

[English](README.en.md) | 简体中文

myterm 是一款面向开发、运维和服务器管理场景的轻量级桌面终端。它使用 Tauri 2、Rust、React 和 xterm.js 构建，在一个紧凑工作区中整合 SSH、本地终端、服务器管理、SFTP、快捷命令和可执行工具的 AI Agent。

当前版本：`0.6.2`

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
- 基础工具覆盖会话信息、终端上下文、终端输入、结构化 SSH 命令、主机事实、目录和文件操作。
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

### CLI 与 REST API

桌面程序和自动化入口共用同一个 Agent、权限、SSH 和持久化内核：

```powershell
myterm agent run --server yuxiaservers --task "检查磁盘压力" --permission read-only
myterm agent run --server yuxiaservers --task - --output jsonl
myterm task list --output json
myterm task events TASK_ID --follow
myterm task approve TASK_ID APPROVAL_ID
myterm task cancel TASK_ID
```

REST API 默认关闭，只允许显式启动的回环地址服务：

```powershell
myterm api token create
myterm api serve --bind 127.0.0.1:9867
```

API 提供 Bearer Token 哈希存储、限流、幂等创建、任务查询、审批、取消、SSE 断点续传和 `/v1/openapi.json`。非回环监听在 TLS、RBAC 和服务器白名单一起实现前保持拒绝。

### 外观与帮助

- 白色、护眼色和深色三套主题，设置会持久化并同步到终端画布。
- 紧凑的 34px 会话标签栏和全高侧栏，适配桌面及窄窗口。
- 标题栏右侧帮助按钮可在应用内打开离线使用说明书。

## 技术架构

```text
React UI
  -> typed IPC adapter
    -> Tauri commands / CLI / loopback REST
      -> Agent application service
        -> policy + audit + SQLite task store
        -> SSH / PTY / SFTP / Skill / MCP / Hooks
```

- `src/`：React 界面、状态管理和类型化 IPC 边界。
- `src-tauri/`：Rust 服务、Tauri 桌面入口、CLI 与 REST。
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
- [开发经验记录](docs/development-experience.md)

## 当前边界

第一版不实现复杂多 Agent、长期记忆、云端 Skill 市场、远程 MCP 传输和公网 REST。聚合 WebView2 进程组内存仍高于项目的 80 MiB 目标，原生 Agent 内核保持轻量，完整浏览器运行时优化继续作为后续工作。

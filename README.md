# myterm

[English](README.en.md) | 简体中文

myterm 是一款面向开发、运维和服务器管理场景的轻量级桌面终端。它使用 Tauri 2、Rust、React 和 xterm.js 构建，在一个紧凑工作区中整合 SSH、本地终端、服务器管理、SFTP、快捷命令和可执行工具的 AI Agent。

当前版本：`0.10.1`

## 核心功能

### 服务器与会话管理

- 新增、编辑、删除 SSH 和本地终端配置。
- 保存服务器名称、分组、环境、主机、端口、用户名、认证方式和终端类型。
- 服务器环境按分组独立保存为 `environments/<分组名>.environments.json`，不再混入主 `config.json`；分组名在前后端都按 Windows 文件名规则校验。
- 密码、私钥口令和 AI API Key 只存入操作系统凭据库，配置文件仅保存引用。
- 点击服务器即可连接；应用重启后仍可使用已保存凭据自动登录。
- 支持会话搜索、树形分组、拖动标签排序和连接状态显示。

### 终端工作区

- 基于 xterm.js 的完整交互终端，支持 UTF-8、颜色、WebGL 渲染和自适应尺寸。
- SSH 和本地终端都显示可见的纵向滚动条，便于定位长日志与大段回显。
- 右键可切换自动换行；关闭后显示 myterm 自有的显式横向滚动条，避免 Windows WebView 原生滚动条隐藏或无法拖动。
- 支持多个会话标签；关闭标签时会主动断开其全部连接。
- 支持向右分屏、调整比例和独立关闭任一分屏，不保留隐藏连接。
- SSH 连接失败会保留原始阶段、错误码和详情；错误文本可直接选择，也可一键复制后交给排查人员或 Agent。
- 工作区工具栏可在终端与 SFTP 文件视图间切换。
- 本地终端与 SSH 会话使用相同的标签和分屏体验。

### 快捷命令库

- 按命令集管理常用、部署和排查命令，可承载几十条以上命令。
- 紧凑列表只展示命令名称，不在主界面暴露长命令正文。
- 支持搜索、新建、编辑、删除、排序和多列滚动浏览。
- 支持导入 Xshell 8/旧版导出的 UTF-16 `.qbl` 快捷命令集，导入前显示格式、命令集、重复、冲突和不支持项。
- 支持按当前命令集或全部命令导出版本化 myterm JSON；导入时可安全保留同名命令或明确覆盖。
- 一个快捷命令可包含多行内容；执行时每一行会按终端回车语义发送。
- 快捷命令面板可调整高度、明确收起，并保持名称垂直居中。

### SFTP 文件管理

- 复用当前 SSH 会话，并从本机用户目录与远端登录目录开始浏览，不假设固定部署路径。
- 本地与远端窗格独立加载；单侧目录失败不会阻止另一侧显示，错误会标明具体窗格和原因。
- 支持普通单选、`Ctrl` 切换选中项和 `Shift` 连续区间选择，并显示当前选中数量。
- 支持文件与目录批量上传、下载和递归删除；重命名保持单项操作，批量删除会报告部分失败。
- 显示文件大小、修改时间和权限，并提供传输队列与取消操作。
- Agent 文件写入采用同目录临时文件、同步、权限保留、哈希锁和读回校验。

### Linux 运维 Agent

Agent 使用类似 Claude Code 的循环：

```text
任务输入 -> 模型决策 -> 工具调用 -> 结果返回 -> 继续循环 -> 最终答复
```

- 持久化 Conversation 与 Turn：只有点击“新对话”才切换上下文，同一对话的后续要求、用户纠正、工具事实和精确命令可跨回合恢复。
- 持久化任务、事件、审批、工具审计、后台 Job、取消和崩溃恢复。
- AI 面板按时间线展示模型决策、工具名称、参数摘要、stdout、stderr、结果和状态。
- 任务输入支持 `Shift+Enter` 换行和输入法保护，顶部拖柄可将输入区向上扩大到 Agent 面板高度的一半。
- Agent 标题栏提供真正的“新对话”操作；对话历史按 Conversation 聚合并恢复其全部 Turn，不再只清空当前界面。
- Turn 运行期间输入框仍可编辑；“追加要求”会先持久化，再在下一次模型决策边界注入当前 Turn，“停止”保持为独立操作。
- 基础工具覆盖会话信息、终端上下文、终端输入、结构化 SSH 命令、主机事实、目录和文件操作；非活动服务器可通过会话目录发现并自动建立 SSH，内置 Multi-SSH Coordinator 支持多个目标的串行协同。界面中的活动 SSH 只作为候选元数据：通用问答、MCP、Skill 和历史任务不会自动读取终端；只有模型判断用户明确指向当前终端时才会设置 `use_active_session=true`，命名服务器则必须解析并传入明确的 `session_id`。
- 结构化命令执行分别记录 stdout/stderr、退出码、信号、超时、取消和断连结果。
- 长任务可转入后台 Job，并通过状态、分页输出和取消工具继续管理。
- 内置诊断 Runbook、上下文压缩、循环检测和敏感字段脱敏。
- 终端上下文采用无固定行数的 transcript 读取：Agent 通过 `offset`、`nextOffset` 和 `eof` 分段读取完整 `cat`、日志或命令输出；远程执行的超长 stdout/stderr 保留 artifact，可用分页工具继续读取。
- 对交互式产品 CLI，`cli_execute` 在同一个后端事务中锁定输入、读取 xterm 真实光标行、只发送完整目标命令的缺失后缀，并等待提示符、交互、静默兜底或超时边界；`cli_execute_batch` 可把 1-8 条互不依赖的已知命令合并为一次工具调用，避免 `showshow system...` 和大量短请求。
- Agent 会在任务时间线记录本轮模型请求数、工具调用数和 Token 用量；独立只读工具可在同一模型轮次并发执行，有副作用或存在依赖的步骤仍保持串行。
- AI 配置以版本化 JSON 持久化。一个配置可定义主模型、分析模型和备用模型；启用自动切换后，模型请求失败会按角色顺序切换并在 Agent 时间线标出实际使用的模型。
- Provider Context Adapter 统一支持 Responses 和 Chat Completions：无需手工选择协议，运行时优先复用 `previous_response_id` 与服务端原生压缩，确认网关不支持后按 Provider 配置指纹跨对话持久回退到本地 checkpoint + tail；Base URL、模型或认证方式变化会自动重新探测。
- AI 设置可按模型配置上下文窗口和压缩阈值；本地 Checkpoint v2 只合并“上一份 checkpoint + 新增 tail”，并按持久化引用注入用户纠正、原样 CLI 命令、工具事实和 Evidence，不再为每次压缩重放全部原始历史。
- 超过 8 KiB 的终端、文件、MCP 和查询结果原文单独落盘并记录 SHA-256；模型收到的是带 `resultId`、来源事实和精确摘录的 Result Capsule。需要核实时使用只读 `result_read` 按字面搜索或分页读取原始结果，不截断事实，也不重新执行可能有副作用的工具。
- Chat Completions 的上下文预算同时计入系统 Prompt、工具 Schema、消息、checkpoint 和输出预留；压缩请求若失败会携带上一次校验错误重试，初次请求加 3 次重试仍失败才终止当前 Turn。
- 安装版默认写入按天滚动的本地 JSON 诊断日志并保留 14 天；`--debug` 提升为 DEBUG 级，Provider 探测、缓存命中、回退和精确错误均使用稳定字段，方便维护 AI 直接读取定位。

### 权限与安全策略

| 模式 | 行为 |
|---|---|
| 只读 | 仅自动执行被策略识别为读取的操作 |
| 用户确认 | 有副作用的操作需要用户逐次确认，默认模式 |
| 完全授权 | 硬拒绝规则之外不再弹窗；适合明确承担任务风险的场景 |

危险命令硬拒绝、生产/root 提权、输出限制、审计和密钥脱敏不能被 Prompt、Skill、Hook 或 MCP 绕过。Bash 命令通过 tree-sitter 解析，语法不完整或无法分类时不会自动执行。

### Skill、MCP 与 Hooks

- 从本地目录发现 `SKILL.md`，读取元数据和内容哈希，并按任务需要加载已启用 Skill。
- 支持配置和测试 stdio 与 streamable-http MCP 服务器；测试成功后可展开 capability id、完整工具名称、标题、说明、Transport、Input/Output Schema 和 annotations，并复制结果。
- MCP 工具统一进入任务级 Capability Registry：小目录直接暴露，较大目录按任务语义选择并保留 `capability_search`；调用参数和结构化结果按服务端 Schema 校验。
- MCP 返回值会规范化为 `structuredContent`、`textContent`、错误状态与原始 Evidence artifact。Agent 根据完整证据整合产品 CLI 命令，并把 `evidence_refs` 交给 `cli_execute`；长结果可继续分页读取，不会把包装层、截断摘要或失败内容当成最终事实。
- Agent 可调用只读的 `mcp_status` 检查每个已配置服务器的启用状态、Transport、连接/工具发现阶段、工具数量、稳定错误码和服务端原始详情；该诊断不需要 SSH 会话。
- 支持有界、确定性的任务生命周期 Hooks；Hooks 不能降低核心权限策略。

### 插件化 Agent 内核

- Agent Loop 只负责任务生命周期、模型决策、效果感知调度、结果回填和循环保护；内置工具与 MCP 都转换为统一 Capability descriptor，而不是继续扩大固定工具分支。
- 桌面默认配置挂载内置 SSH/会话工具、本地 Skill、stdio/streamable-http MCP、生命周期 Hooks 和 OpenAI 兼容模型适配器。
- 每个插件都提供 manifest、版本、依赖提示和工具描述；工具事件和审计记录会携带插件 id。
- Agent 设置页展示插件清单，可缩小当前运行时启用的插件集合；留空表示使用桌面默认配置。
- `src-tauri/src/agent/protocol.rs` 定义了未来进程外插件使用的版本化 JSONL 协议；0.7.0 不会自动安装或执行未知第三方插件代码。

### 远端 CLI、REST 与多 SSH

- CLI 指 Agent 通过 SSH 大量执行 `systemctl`、`journalctl`、`docker`、`kubectl` 和业务命令，并取得结构化结果；不是要求 myterm 对外提供一套 CLI 产品接口。
- REST 指从明确的远端 SSH 主机调用业务或基础设施 HTTP API，保留真实网络视角、凭据脱敏和审计；不是要求 myterm 对外暴露 Agent REST 服务。
- Multi-SSH Coordinator 让一个 Task 使用多个保存的服务器；Agent 先按对话判断是否需要 SSH，再发现目标、必要时自动连接，并为每次会话工具显式指定 `session_id`。活动终端只有在用户明确提到“当前终端/这台服务器”时才可通过 `use_active_session=true` 选中；缺少目标时工具会闭合失败，不会静默落到当前焦点。默认串行支持 A 操作、B 观察和条件满足后继续。
- OS 安装规划为由本地 Skill 触发的安装 Task。Skill 生成和校验计划，真正的写盘、启动和电源动作由受审批的 provisioning 工具通过虚拟化平台、云 API、MAAS 或 Redfish/BMC 执行。

以上能力的完整边界、方案优缺点和阶段计划见[多 SSH 协同与 Skill 驱动 OS 安装方案](docs/multi-ssh-os-installation-plan.md)。`0.6.3` 已删除早期实现的本机 Agent CLI 和 loopback REST；myterm 保持桌面应用边界，CLI/REST 只表示 Agent 在远端 SSH 环境中执行命令和 HTTP 请求。

### 外观与帮助

- 白色、护眼色和深色三套主题，设置会持久化并同步到终端画布。
- 终端提供三套命令配色模板：石墨青金（稳定对比）、森林护眼（低蓝光）和午夜高对比（强区分）；命令输入使用高亮色，回显保持正文色。
- 支持界面字号从 90% 到 200% 七档，统一放大侧栏、标题、面板、弹窗和 xterm 终端；终端另提供 `12-22px` 基础字号，最终字号为“基础字号 × 界面倍率”。修改即时生效、重新适配行列且不会重连会话。
- AI 配置支持 `Bearer Token`（`Authorization: Bearer sk-...`）和 `API Key`（`Authorization: sk-...`）两种认证头格式。
- AI 与 Agent 的 HTTPS 请求使用 Rustls 并加载操作系统根证书库，支持已部署到系统信任库的企业 CA、内网 CA 和安全代理证书。
- 测试连接和 Agent 失败先显示失败位置与稳定错误码，点击详情后展开 HTTP 状态、Endpoint、响应体、传输错误、stderr、退出码、超时和调用堆栈；仅对密钥脱敏并限制诊断长度，不用推测性文字替换服务端结果。
- 紧凑的 34px 会话标签栏和全高侧栏，适配桌面及窄窗口。
- 标题栏右侧帮助按钮可在应用内打开离线使用说明书。
- AI 设置中的模型路由编辑器会把前端表单转换为后端 JSON schema；配置文件只保存 `api_key_ref`，API Key 仍由系统凭据库托管。
- AI 设置把“获取模型”和“测试模型”分为两个动作：前者完整列出 API Key 可访问的模型，后者用可编辑提示词向选定模型发起真实推理并展示正文、耗时、Endpoint、原始返回或错误详情。
- 已保存的 AI 服务配置可统一查看和删除；当前使用项必须先切换，删除配置不会删除对话历史。

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
- [标准构建与发布流程](docs/build-and-release.md)
- [Agent 插件架构说明](docs/agent-plugin-architecture.md)
- [Agent 优化路线与取舍](docs/agent-optimization-roadmap.md)
- [Codex 对话上下文实现说明](docs/agent-codex-context-plan.md)
- [Codex × Harness 架构审计](docs/architecture/codex-harness-audit.md)
- [dsh-codex-agent 实现说明](docs/architecture/dsh-codex-agent-implementation.md)
- [Codex 网络出口审计](docs/architecture/codex-network-audit.md)

## 当前边界

当前 `0.9.11` 将 Agent 重构为稳定 Conversation/Turn 和 Provider Context Adapter：支持跨回合纠正、运行中追加要求、Responses 增量续接与 Chat 本地 checkpoint 回退。本版同时增加终端可见滚动条，并把产品 CLI 补全收敛为“完整目标命令 + 当前光标行 + 精确缺失后缀”，保留参数间空格。

# Codex Core × DeepSeek Harness 架构审计

- 审计日期：2026-08-26
- Codex 源码：`2764e83626efe55f64e04d153fc99a157327f3c2`
- DeepSeek Harness 源码：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 结论

目标架构采用一个 Harness 函数插件 `dsh-codex-agent` 加一个同进程 N-API Rust 原生模块。Harness 只注册唯一 `AgentFactory`、提供工具实现、承载 UI/HTTP、投影事件和写外层审计；裁剪后的 Codex Core 独占 Agent Loop、Thread/Turn、上下文压缩、工具调用顺序、子 Agent 调度、Thread Store 和 Agent Graph Store。

不采用现有 `dsh-subagent-codex`。它通过 stdio 启动 `codex app-server`，每次运行创建一次性线程，无法提供本任务要求的 Thread/Graph 持久化，并且属于明确禁止的 Sidecar 架构。

## 方案取舍

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| N-API 同进程原生模块 | 无 Sidecar；Rust 状态只存在一份；Harness 卸载可直接等待所有任务；可复用 Rust 的 Shell/Sandbox/Store 能力 | 构建链比纯 TypeScript 复杂；原生包需按平台发布；JS/Rust 边界必须做严格 JSON 校验 | 采用 |
| Rust Sidecar/app-server | 进程隔离清晰；可直接使用现有 app-server 协议 | 明确违反目标；生命周期、取消和状态容易分裂；增加 IPC 与第二份会话状态 | 禁止 |
| 在 Harness 内重写 Agent Loop | 与 Harness API 最贴近 | 会形成第二套 Loop/Thread/Compaction/Graph；无法称为 Codex Core 集成 | 禁止 |
| 直接依赖完整 `codex-core` | 上游能力最全、同步成本低 | 当前默认编译 analytics、otel、login、remote compaction、exec-server、plugin/connectors 等禁用能力，静态链接后无法证明不存在出口 | 不采用；按源码切面裁剪 |

## 状态所有权矩阵

| 状态/行为 | 唯一所有者 | Harness 允许的动作 | 禁止动作 |
| --- | --- | --- | --- |
| Agent Loop | Codex Core | 创建/销毁 Core 实例，等待 quiescence | 挂载 `dsh-agent-loop` 驱动同一 Agent |
| Thread/Turn | Codex Core Thread Store | 读取投影、展示事件 | 以 Harness Session 反向恢复或覆盖 Thread |
| 消息历史 | Codex Core Thread Store | 将事件复制到 Session/UI | 调用 `Session.deriveMessages()` 生成模型请求 |
| 自动压缩 | Codex Core | 展示成功/失败事件 | 挂载 `dsh-compaction-basic` 处理同一 Thread |
| Tool Call 状态机/顺序 | Codex Core | 按 Core 请求执行一个 Provider 调用并返回结果 | Harness 独立重排、重试或继续同一 Tool Call |
| Agent Graph/子 Agent | Codex Core Agent Graph Store | 展示 Graph 快照与状态 | 挂载 Harness continuation/graph 管理同一子 Agent |
| 外部工具实现 | Harness Tool Provider | 审批、执行、返回规范结果 | 创建另一条模型调用或修改 Core Thread |
| 外部 MCP | Harness 显式配置的 HTTP MCP Provider | 连接白名单地址、列工具、执行并审计 | stdio、本地 server、自动发现、未知地址连接 |
| 外层 Session | Harness | 只追加投影事件 | 作为事实来源、压缩源或恢复源 |
| API Key | 宿主 Secret 注入 | 启动时把值传入内存 | keyring、配置、Thread/Session/Graph/日志落盘 |

## 模块审计表

| 模块路径 | 当前功能 | 保留 | 修改 | 删除/不编译 | 内容外发风险 | Harness 边界 | 状态所有者 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `deepseek-harness/packages/core/agent` | Agent 注册、唯一 Factory、生命周期与 initiator | 是 | `dsh-codex-agent` 注册唯一 Factory | 否 | 无直接网络 | Agent 创建/销毁边界 | Harness 生命周期；Core 语义 |
| `deepseek-harness/packages/core/agent-loop` | Harness 默认 Loop、Session 驱动、Tool 调度 | 否 | 自定义 profile 不挂载 | 是 | 模型与工具出口 | 不进入目标运行图 | 无 |
| `deepseek-harness/packages/core/session` | 事件日志、派生模型消息 | 仅投影 | 明确禁止 `deriveMessages()` 作为 Core 输入 | 模型历史所有权删除 | 日志可能含内容 | UI/外层审计投影 | Harness 投影 |
| `deepseek-harness/packages/compaction/*` | Harness 压缩 | 否 | profile 不挂载 | 是 | 模型摘要请求 | 不进入目标运行图 | 无 |
| `deepseek-harness/packages/subagent/*` | Harness 子 Agent/continuation | 否 | 仅可消费 Core Graph 投影 | 默认 providers/tools 删除 | 可能启动进程或远程服务 | 只读展示 | Core |
| `deepseek-harness/packages/subagent/subagent-codex` | stdio app-server 一次性 Codex | 否 | 无 | 是 | Codex 子进程网络 | 禁止使用 | 无 |
| `deepseek-harness/packages/core/tools` | 工具注册、审批与 Provider 执行 | 是 | Core 决定调用顺序；Harness 只执行请求 | Code Mode 不挂载 | 工具可读文件/联网 | 规范化 Tool Result | Core 调度，Harness Provider |
| `deepseek-harness/packages/mcp/mcp-client` | stdio 与 Streamable HTTP MCP | 部分 | 仅保留 HTTP，增加地址/工具白名单 | stdio 分支不进入构建/profile | 明确允许的 MCP 出口 | 外部 Tool Provider | Harness 连接；Core 调度 |
| `deepseek-harness/packages/telemetry/telemetry-otel` | OTLP 日志；默认配置含远程 URL | 否 | 无 | 从 profile 删除 | 高：日志/内容可能外发 | 无 | 无 |
| `deepseek-harness/packages/credentials/*` | 本地凭据服务 | 仅非模型秘密可选 | 模型 Key 不经过该服务 | Key 上传/持久化路径禁用 | 中 | 宿主注入只读环境变量 | 宿主 |
| `deepseek-harness/packages/identity/*` | 匿名身份 | 否 | 本地运行不需要 | 从 profile 删除 | 中：标识上报 | 无 | 无 |
| `deepseek-harness/packages/bundle/base` | 默认挂载模型、遥测、Web Search、Loop | 否 | 新建内网 profile | 默认远程项删除 | 高 | 仅作为参考 | 新 profile |
| `codex-rs/core` | 完整 Thread/Turn/工具/模型/远程能力 | 部分源码切面 | 裁剪为 `dsh-codex-core` | 禁止模块不加入依赖图 | 原版有多类出口 | N-API 单入口 | Core |
| `codex-rs/codex-api` | Responses/WS/Reatime 传输 | 否 | 新增独立 Chat Completions transport | Responses/WS/Realtime 不编译 | 高 | 无 | Core transport |
| `codex-rs/thread-store` | Thread 持久化，依赖 git-utils/otel | 行为保留 | 以最小 SQLite Store 重建 | 原 crate 不编译 | 原版依赖链不可证明 | Core 内部 | Core |
| `codex-rs/agent-graph-store` | 父子 Thread 图 | 接口语义保留 | SQLite 表与 Thread Store 同事务 | 原 `codex-state` 依赖不引入 | 无直接网络 | 只读事件投影 | Core |
| `compact_remote*` / remote compaction | 远程摘要 | 否 | 内网 Chat Completions 原子压缩替代 | 是 | 高 | 只投影 `CompactionFailed` | Core |
| analytics/otel/diagnostics/feedback | 遥测诊断 | 否 | 本地结构化 audit 替代 | 是 | 高 | 本地日志读取 | Harness 外审计/Core 内审计 |
| login/keyring/backend/cloud tasks | 登录、凭据和云任务 | 否 | Secret 注入、本地调度替代 | 是 | 高 | 无 | 宿主/Core |
| remote-control/remote-models/plugin/connectors | 远程控制与发现 | 否 | 显式配置替代 | 是 | 高 | 无 | 无 |
| File/Search/Patch/Shell/Sandbox | 本地 Coding 工具 | 是 | 作为 Harness Provider；Core 排序/状态机 | shell escalation/unified-exec 删除 | 按命令可能联网 | Tool Provider | Core 调度，Harness 执行 |
| Web Search | 显式搜索出口 | 可选 | 必须配置独立白名单和审计 | 默认 DeepSeek endpoint 删除 | 明确允许的出口 | Tool Provider | Harness 连接，Core 调度 |

## 生命周期

1. Cordis 加载 `dsh-codex-agent`，插件验证 `baseUrl/model/apiKeyEnv/stateDir`，从环境变量读取 Key。
2. 原生模块打开本地 Thread/Graph/Audit SQLite；Key 只进入内存中的 HTTP client。
3. 插件通过 `ctx.agents.setFactory()` 注册唯一 Factory。目标 profile 不挂载 `dsh-agent-loop`。
4. `createAgent/resume` 在 Core 创建或恢复 Thread，再创建 Harness Session 投影与 Agent 包装器，最后一次性发布。
5. 用户输入由包装器交给 Core。Core 独占模型循环和 Tool Call 顺序；需要工具时调用 Harness Provider 回调并等待规范结果。
6. Core 事件被单向追加到 Harness Session/UI。任何投影失败都不能改写 Core Thread。
7. 插件卸载先停止接收新请求，取消所有 Root/Subagent，等待后台任务和工具回调 quiescence，再卸载 Factory 和关闭 Store。

外部 Provider 的关闭发生在上述排空之后：先关闭 Native Thread/Graph Store，再注销固定
Web Search，最后关闭 MCP Client，避免活动工具回调遇到提前断开的 Provider。

压缩请求首次失败后最多重试 3 次（合计最多 4 次），退避为 100/250/500ms。每次尝试都不写 Thread/Graph；任一次成功后才执行单事务提交。三次重试全部失败时才投影最终 `CompactionFailed` 并终止 Turn，期间不发起普通模型请求。

## 网络出口基线

允许的生产 HTTP 客户端只有三类：

1. `INTRANET_LLM_BASE_URL`：Chat Completions 与 Compaction。
2. 显式配置且通过地址白名单的外部 MCP Streamable HTTP。
3. 显式配置且通过地址白名单的 Web Search Provider。

Web Search 未配置时不会注册；桥接层也会拒绝宿主中其他插件提供的同名 Web 工具，防止
默认 Provider 绕过目标地址白名单。

其余 URL、动态发现、遥测、更新、远程模型列表、远程插件、远程控制和云任务均不进入目标依赖图。构建验收阶段会对源码与最终产物分别扫描。

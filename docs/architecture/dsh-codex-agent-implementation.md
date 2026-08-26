# dsh-codex-agent 第一版实现说明

- 完成日期：2026-08-26
- DeepSeek Harness 审计基线：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Codex 审计基线：`2764e83626efe55f64e04d153fc99a157327f3c2`

## 1. 修改文件清单

| 分组 | 文件 |
| --- | --- |
| 根构建与审计 | `.gitignore`、`package.json`、`vite.config.ts`、`scripts/audit-codex-network.ts` |
| 审计与说明 | `docs/architecture/codex-harness-audit.md`、`docs/architecture/codex-network-audit.md`、本文件 |
| Harness 插件 | `integrations/dsh-codex-agent/src/agent.ts`、`index.ts`、`native.ts`、`projection.ts`、`policy.ts`、`mcp-http.ts`、`web-search-http.ts`、`types.ts` |
| 裁剪 Core | `native/src/lib.rs`、`runtime.rs`、`store.rs`、`types.rs`、`error.rs`、`model_transport.rs`、`chat_completions_transport.rs`、`chat_completions_sse.rs` |
| 构建配置 | 插件 `package.json`/Lockfile、`cordis.patch.yml`、`README.md`、Cargo manifest/Lockfile、N-API `build.rs`、TypeScript/Biome/Vitest 配置 |
| 测试 | `tests/apply.spec.ts`、`tests/native.spec.ts` 和各 Rust 模块内单元/集成测试 |

生成目录 `lib/`、`native-dist/` 和 `native/target/` 不提交；发布时由构建流程生成。

## 2. 插件架构和生命周期

插件由一个 Harness 函数插件和一个同进程 N-API Rust 模块组成：

```text
Harness UI / HTTP
       |
唯一 AgentFactory (TypeScript)
       |
N-API：事件投影 / 单次工具 Provider 回调
       |
Trimmed Codex Core (Rust)
  Loop + Thread/Turn + Compaction + Multi-Agent + SQLite Store
```

启动时先验证固定模型地址、阈值和 Secret 环境变量，再打开 SQLite、连接显式外部
Provider，最后注册唯一 `AgentFactory`。创建 Agent 时先创建/恢复 Core Thread，再发布
Harness Session 投影；失败会回滚未发布 Thread。

卸载时按固定顺序停止接收新 Agent、取消并排空 Root/Subagent 和工具回调、关闭 Native
Store、注销 Web Search、最后关闭 MCP。测试已锁定该顺序，避免 MCP 先断开而活动 Turn
仍在等待工具结果。

## 3. 状态所有权

| 状态 | 唯一所有者 | Harness 行为 |
| --- | --- | --- |
| Agent Loop、Thread/Turn、模型历史 | Codex Core | 创建/销毁包装器，只接收投影 |
| 自动压缩与 Token 预算 | Codex Core | 展示重试、成功、失败事件 |
| Tool Call 顺序与状态 | Codex Core | 按 Core 的单次请求执行 Provider，不重排、不驱动下一步 |
| Root/Subagent、Agent Graph | Codex Core | 只展示 Graph/状态投影 |
| Thread/Graph/Compaction/Audit Store | Codex Core SQLite | 不以 Harness Session 恢复模型历史 |
| Tool Provider、审批、Sandbox | Harness | 返回规范 Tool Result |
| 外部 MCP/Web Search 连接 | Harness 插件层 | 仅显式 URL/工具白名单 |

集成测试确认 `Session.deriveMessages()` 始终为空；Core Thread Store 是模型请求的唯一历史
来源。完整审计矩阵见 `codex-harness-audit.md`。

## 4. Chat Completions Adapter

Rust Core 直接构造 `POST /chat/completions`，不使用 Responses API、response ID、登录或
远程会话状态。Adapter 支持：

- SSE 分片、CRLF、多行 data 和无尾空行；
- 文本增量、多个 `tool_calls`、参数增量、Call ID 和稳定 index 顺序；
- `finish_reason`、usage、多轮 Assistant/Tool Result 消息；
- 空响应、畸形 SSE、HTTP 状态/原始响应体和分阶段超时；
- `rustls-tls-native-roots`，加载系统证书库以适应内网 CA。

API Key 只作为 N-API 构造器的独立内存参数进入 Bearer Header，不属于 JSON 配置。SQLite
二进制扫描测试确认测试 Secret 不落盘。

## 5. 自动压缩失败行为

达到阈值后，Core 使用同一内网 Chat Completions Provider 发送无工具定义的严格摘要
请求。响应必须是无额外字段且摘要非空的 `{"summary":"..."}`。

失败策略已按最新要求实现：

1. 首次请求失败；
2. 最多重试 3 次，总计最多 4 次；
3. 退避为 100ms、250ms、500ms；
4. 每次失败只写本地重试审计，不写摘要、边界或 revision；
5. 任一次成功后，摘要、Thread revision、Subagent Graph revision 和本地审计在一个
   SQLite 事务提交；
6. 四次全部失败，投影结构化 `CompactionFailed`，终止当前 Turn，不发普通模型请求，
   不截断历史，不 fallback，不写半成品。

测试覆盖全失败、第三次重试后恢复、空摘要、非严格 JSON、无工具压缩请求、失败后历史
不变，以及 Subagent 压缩失败向 Root 传播。

## 6. 多 Agent 和 Agent Graph

Core 内置 `spawn_agent`、`wait_agent`、`cancel_agent`。每个 Subagent 创建独立持久 Thread，
继承同一个 Provider 和 Harness Tool Provider 集合，由本地 Tokio Task 调度。Root 可以
并发创建多个 Subagent、带超时等待、取消并汇总结果。

Thread、Graph edge、状态、结果、结构化错误和压缩 revision 均写入同一个 SQLite。
重启后可恢复关系与状态。测试证明两个子 Agent 同时进入运行态、等待超时不破坏任务、
失败可传播、Graph 可重开恢复，销毁后活动子任务计数归零。

## 7. 外部 MCP 白名单策略

第一版只导入 MCP Client 的 Streamable HTTP Transport：

- Server URL 必须显式配置且只能是 HTTP(S)，URL 禁止内嵌用户名/密码；
- 每个 Server 必须列出非空工具白名单，禁止 `*`；
- 只注册 Server 实际声明且在白名单内的工具；名称归一化冲突会拒绝启动；
- Header 值只能从环境变量读取；
- 禁止 stdio、本地 Server、Registry/插件发现、未知地址连接和自动重连；
- 审计只记录工具名、固定目标、参数摘要、结果状态，不记录 Header/Secret。

测试包含拒绝未配置工具、白名单执行，以及真实本地 Streamable HTTP MCP Server 的连接、
Header 注入、工具过滤和调用。

## 8. 删除或不编译的模块

目标生产依赖图没有链接完整 `codex-core`，因此以下能力没有进入裁剪 crate：

- analytics、OTEL、diagnostics、feedback、response-debug-context；
- OpenAI/ChatGPT 登录、keyring、backend/cloud config、Cloud Tasks；
- Remote Control/Models/Plugin、Code Mode、external-agent migration；
- remote compaction、git-utils、shell escalation、exec server、unified exec；
- updater、远程模型列表、插件发现/分享；
- Browser/Computer Use、Realtime、Image Generation、Responses WebSocket。

Harness profile 同时禁用其 Agent Loop、Compaction、Subagent/Workflow、Telemetry、Credential
Store、默认模型、默认 DeepSeek Web Search 和 Code Runtime row。保留的 File/Search/Patch/
Shell/Exec Policy/Sandbox/Process Hardening/Skill 工具由 Harness Provider 提供，Core 只拥有
调用顺序。

## 9. 测试结果

| 验证 | 结果 |
| --- | --- |
| Rust 单元/集成测试 | 20 passed |
| TypeScript/Harness/N-API 集成测试 | 9 passed |
| Rust debug/release 编译 | 通过；仅 MSVC linker 生成 import library 的提示 |
| Harness 插件 TypeScript build/typecheck | 通过 |
| Biome lint + `cargo fmt --check` | 通过 |
| NPM 发布内容 dry-run | 通过；只含生产 JS/声明、profile、README 和 Windows native binary |
| 静态网络审计 | PASS，3 个允许出口，0 个未知出口 |
| myterm 前端回归 | 44 passed；生产前端 build 通过 |

关键测试包括真实本地 Chat Completions SSE、真实 Streamable HTTP MCP、固定 Web Search
HTTP、API Key 不落盘、Thread/Session 唯一历史、Graph 恢复、多 Agent 并发/超时/失败/
销毁，以及压缩四次失败终止 Turn。

## 10. 静态网络审计结果

允许出口只有：内网 Chat Completions、显式 HTTP MCP、显式 Web Search。源码、生产直接
依赖、Cargo Lockfile、构建 JS 和 Windows N-API 二进制扫描为 0 finding。详细调用点、
禁用 Harness row 和扫描规则见 `codex-network-audit.md`。

## 11. 尚存风险和后续待办

- 当前 Core 是按审计基线抽取并重建的最小兼容切面，不直接依赖完整上游 crate；优点是
  能证明禁用模块不在依赖图，缺点是上游 Thread/Tool 语义变更需要人工同步审计。
- 目前发布产物只构建 Windows x64 MSVC。Linux/macOS 需要各自 CI、原生包命名与审计。
- 固定 URL 白名单没有解析后 CIDR 策略；高安全部署应由出口网关限制，或后续加入 DNS/IP
  校验。
- Web Search 采用通用固定 POST 协议，需要企业搜索网关适配返回格式。
- 外部 MCP 不自动重连；优点是不会产生隐式后台网络，缺点是断线后需要显式重载插件。
- 仓库原有 Tauri Agent 仍是独立旧实现。接入产品主界面时必须以本插件替换旧 Agent
  状态所有者，不能把两套 Loop、keyring 模型 Secret 或 stdio MCP 同时启用。
- 额外执行旧 Tauri `cargo check` 时，当前机器缺少 `NASM`；关闭汇编后又缺少 `cmake`，
  因而旧应用的 `aws-lc-sys` 构建检查未完成。该依赖不在 `dsh-codex-core` 依赖图中，
  本插件 Rust debug/release 构建与测试均已通过。

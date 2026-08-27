# myterm Agent 插件架构

## 目标

0.7.1 将 Agent 从“循环里写死工具名称”的实现收敛为一个轻量插件内核，并统一了插件错误的诊断边界。内核只保留任务生命周期、模型请求、权限判断、审批、取消、审计和事件流；具体能力由插件注册和挂载。这样可以继续保持桌面端启动快、依赖少，同时为后续多 SSH、远端 HTTP、provisioning 和外部 Skill 留出稳定扩展边界。

## 当前边界

默认 `desktop` profile 挂载以下插件：

| 插件 | 类型 | 第一版职责 |
|---|---|---|
| `builtin.tools` | tool | 会话信息、终端上下文、终端输入、SSH 执行、主机事实、目录和文件工具 |
| `multi-ssh-coordinator` | workflow | 目标目录、保存 profile 自动连接、显式 session_id 和串行多 SSH 协同 |
| `builtin.skills` | capability | 从本地目录发现并按需加载 `SKILL.md` |
| `builtin.mcp` | capability | 连接 stdio/streamable-http MCP、列出工具、搜索工具和显式调用 |
| `builtin.hooks` | lifecycle | 复用现有 SessionStart、PreToolUse、PostToolUse 等生命周期钩子 |
| `builtin.model.openai` | model | OpenAI 兼容模型适配器的能力声明 |

`AgentRuntime` 为一次运行创建 `PluginRegistry`。模型拿到的是注册表生成的工具 schema，而不是直接访问某个 Rust 方法。工具调用经过同一个权限策略和审批管线，然后由插件执行；事件中的 `pluginId` 用于 UI 时间线、持久化审计和故障定位。

## 关键契约

### Manifest

每个插件必须提供稳定的 `id`、显示名称、版本、类型、描述和依赖提示。依赖提示用于配置展示和后续启动校验，不代表插件可以自行提升权限。`core.*` 依赖是内核服务能力，不是可被第三方替换的插件。

### Capability descriptor 与注册表

0.9.9 起，内置工具与 MCP 工具在模型边界统一为 Capability descriptor。描述包含稳定 capability id、模型安全名称、Provider/Transport、标题、说明、Input/Output Schema 和 annotations。Agent Loop 不维护 MCP 工具白名单，也不再以固定工具总数决定“全部挂载或全部隐藏”。小目录可直接挂载；大目录按任务语义和 Schema 字节预算选择相关能力，同时始终保留 `capability_search` 和准确 ID 调用入口。

Capability Registry 负责发现、索引和上下文选择；Provider adapter 负责真实调用。当前外部 Provider 是 MCP，后续加入 SSH 文档、远端 API 或 provisioning 时复用同一 descriptor 和证据契约，不把协议细节写回 Codex Core。

### Evidence ledger

外部能力的完整原始结果按任务保存为 Evidence artifact，并登记 evidence id、capability id、路径和字节数。模型默认只收到有界预览与结构化内容；长结果通过 `evidence_read(offset, limit)` 继续读取。CLI 命令由 MCP 结果合成时必须把 evidence id 传给 `cli_execute`，宿主验证引用属于当前任务。MCP 的 `isError`、Schema 校验失败和原始返回不会被转写成成功结果。

### 效果感知调度

Codex Core 的工具定义增加 `parallel_safe`。只有宿主明确标记的独立只读工具才会在同一模型响应内并发；CLI 写入、外部副作用、审批、Subagent 和依赖链保持串行。`cli_execute_batch` 与 `capability_invoke_batch` 用一个工具调用承载多项已知工作，减少模型往返，但不会自动批处理依赖前一步输出的命令。

### Tool context

插件只收到受限的 `ToolContext`：当前运行和调用 id、目标会话、Agent 设置、MCP 客户端、事件 sink 和取消 receiver。插件不能绕过 `AgentService` 的凭据库、权限策略、输出上限、脱敏或审计边界。

### 动态 SSH 目标契约

前端传入的活动 pane 只形成 `active_session_candidate`，不再写入 Task 的绑定会话，也不会成为工具执行器的隐式 fallback。模型对每个会话工具都必须做出可审计选择：命名目标传 `session_id`；只有用户明确说当前终端、这台服务器或可见 SSH 时才传 `use_active_session=true`。两者都没有时执行器闭合失败。这样通用问答、MCP、Skill 和任务历史可以保持无终端上下文，同时保留当前终端任务的一步可用性。

取舍：显式目标能避免 UI 焦点变化导致误操作，也让多 SSH 调度复用同一契约；代价是模型遗漏选择时会多一次可见错误，含糊表述需要向用户确认。myterm 接受这个代价，不在前端增加关键词路由器，也不让宿主猜测模型意图。

### MCP 诊断与结果规范化

任务启动为每个配置的 MCP 服务器记录 `ready`、`disabled`、`connection_failed` 或 `tool_discovery_failed`，并保留 Transport、工具数量、稳定错误码和原始详情。模型可通过只读 `mcp_status` 查询，不依赖任何 SSH。工具调用结果同时提供 Schema 校验后的 `structuredContent`、合并文本块得到的 `textContent`、错误/截断状态和 Evidence 引用；SDK 包装层只保留在原始 artifact 中。

### Error contract

插件失败返回稳定的 `errorCode` 和原始 `detail`。`detail` 通过 `AppError::detail()`、IPC `{ code, message }` 和 Agent 事件 `content` 贯通；HTTP 状态/响应体、进程 stderr/退出码、MCP 启动错误和 JSON 解析位置不能被宿主改写成泛化提示。测试连接诊断额外包含 `stage`、`summary` 和可展开的 `stack`；UI 默认只展示 `summary + code`，点击详情后展示 `detail + stack`。宿主只负责密钥脱敏和 16,000 字符有界截断。

### JSONL protocol

`src-tauri/src/agent/protocol.rs` 定义协议版本 1：

- `ExternalPluginManifest`：进程外插件握手和工具目录。
- `PluginRequest`：`manifest`、`tool.execute` 等请求，单行 JSON，最大 256 KiB。
- `PluginResponse`：按请求 id 返回 result 或结构化 error。

协议只定义消息格式，不在 0.7.0 自动发现、下载、安装或执行第三方进程。后续实现进程外插件时，宿主仍需增加签名/信任、命令路径白名单、环境变量过滤、启动/调用超时、崩溃回收和资源上限。

## 为什么选择这一版

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 继续在 Agent Loop 增加 `match` | 改动小 | 工具、模型和生命周期持续耦合，难以测试和扩展 | 不再作为新增能力的入口 |
| 进程内注册表（本版） | 零额外进程、低延迟、权限和取消天然共用，适合桌面 MVP | 插件崩溃仍与主进程同域，第三方代码尚未隔离 | 0.7.0 默认方案 |
| 立即引入完整外部插件市场 | 隔离和生态想象空间大 | 签名、升级、沙箱、兼容矩阵和供应链成本会显著膨胀 | 暂不实现 |

## 安全与性能约束

1. 插件不是权限边界。所有有副作用的工具仍由统一策略决定，`deny > ask > allow`。
2. Skill、MCP 和未来外部插件只能声明或调用内核工具，不能注入第二套执行器。
3. MCP schema 按任务语义与字节预算挂载；输入和声明过的结构化输出执行本地 JSON Schema 校验，事件参数沿用现有摘要、截断和脱敏规则。
4. 默认注册表不启动常驻子进程。只有任务启用 MCP 时才创建任务级客户端，并在任务结束时释放。
5. 任何新增插件都必须补充 manifest 测试、工具 schema 测试、拒绝路径测试和一次发布构建检查。
6. 并发标记由宿主代码决定，不能直接信任第三方 annotation 作为权限或并发安全证明。

## 后续演进

- M1：已接入 `multi-ssh-coordinator` 内置 workflow plugin；后续可将目标锁、条件等待和批次策略继续抽取为可替换 operations plugin。
- M2：增加 `remote_http_request`、`wait_condition` 等结构化远端工具，复用同一插件和审计契约。
- M3：增加 provisioning plugin 与 plan-only OS 安装 Skill；写盘和电源动作必须由目标 OS 之外的控制面完成。
- 后续：在协议稳定后，按需加入签名的进程外插件，不建设云端 Skill/插件市场。

## 验证清单

- 默认 profile 能列出五类插件，显式启用列表能缩小挂载集合。
- 工具 schema 由注册表生成，工具事件包含插件 id。
- Skill、MCP、权限确认、取消和审计回归测试保持通过。
- JSONL 请求/响应往返、错误版本、空 id、格式错误和 256 KiB 上限均有单元测试。
- release 构建和覆盖安装不会删除现有服务器、AI 配置或凭据引用。

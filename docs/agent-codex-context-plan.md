# myterm Codex 对话上下文重构方案

> 文档状态：0.9.11 已实施，同时作为后续回归基线  
> 适用范围：`dsh-codex-agent` 对话、模型请求、压缩、追加要求与任务历史

## 1. 结论

当前实现不等同于完整的 Codex 上下文方案。

- `dsh-codex-core` 已具备本地 thread、message、summary 和压缩数据结构。
- myterm 每次发送都会创建新的 `run_id` 和新的 core thread，上一轮用户修正不会自动进入下一轮。
- “新建对话”目前只清空前端展示，没有创建或切换持久 conversation。
- 单个 Task 内，在触发压缩前，每次模型决策都会重发该 Task 的全部有效消息；触发阈值后才改为本地摘要加增量消息。
- 当前压缩是自定义 Chat Completions 摘要，不是 Codex 的 thread/turn/steer 协议，也不是 Responses API 的原生不透明 compaction item。

因此，本方案把“对话身份”“一次用户回合”“一次执行任务”分开，并在 provider 层兼容原生 Responses 上下文和本地 Chat 回退。

## 2. 重构前能力审计

| 能力 | 当前状态 | 问题 |
|---|---|---|
| 本地 thread/message 持久化 | 已有 | myterm 每次发送新建 thread，无法形成连续对话 |
| 同一对话多轮修正 | 未接通 | “参数之间有空格”等修正下一轮不可见 |
| 新建对话 | 仅前端清空 | 没有独立 conversation 记录和隔离边界 |
| 运行中追加要求 | 不支持 | 输入区在运行时禁用，不能 steer 当前 turn |
| 自动压缩 | 已有本地摘要 | 固定按 128K/96K 阈值，不能适配不同模型能力 |
| 压缩失败重试 | 已有 | 初次加 3 次重试后终止 Task |
| Tool/Event/Artifact 审计 | 已有 | 可继续作为本地事实源 |
| 多模型回退 | 已有 | provider 上下文游标尚未抽象，切换时容易重复发送或丢上下文 |

## 3. 方案对比

### 方案 A：只采用 Responses API 与服务端 Conversation

优点：

- 最接近 OpenAI 原生上下文与压缩机制。
- 后续请求只提交新增输入，减少重复请求体。
- 原生 compaction item 可直接延续长对话。

缺点：

- 仅实现 Chat Completions 的兼容网关无法使用。
- 对话状态依赖远端 provider，离线审计和跨模型故障切换较弱。
- 不适合作为 myterm 的唯一实现。

### 方案 B：保留本地 thread，仅修复 thread 复用

优点：

- 改动较小，现有 Chat Completions provider 均可继续使用。
- 可以较快修复跨轮记忆和用户纠正丢失。

缺点：

- 压缩前仍需重发有效历史。
- 无法得到原生 turn/steer 和 provider compaction 能力。
- 后续再接 Responses 时仍需二次重构。

### 方案 C：稳定 Conversation/Turn + Provider Context Adapter（推荐）

优点：

- myterm 本地保存稳定的对话、回合、工具证据和审批，是可审计的事实源。
- Responses provider 使用原生 conversation、previous response 或 compaction；Chat provider 使用本地 checkpoint + tail。
- 兼容当前自建网关、多模型聚合和跨 provider 回退。
- 一次完成多轮对话、运行中追加要求和真正的新建对话边界。

缺点：

- 需要迁移数据库身份、runtime 生命周期、前端历史层级和 provider 状态。
- 跨 provider 切换时必须严格防止工具副作用重放。
- 测试范围大于局部修补。

### 方案 D：直接嵌入完整 Codex App Server

优点：

- thread、turn、steer、interrupt 和 compact 语义成熟。

缺点：

- 引入额外进程或更重依赖，与 myterm 现有权限、SSH、MCP、审计内核重复。
- 软件体积、启动时间和故障面都会增加。
- 不符合 myterm 轻量内核目标。

## 4. 推荐架构

```text
AgentConversation（稳定，多轮）
  └─ AgentTurn（一次用户发送，可被 steer）
       ├─ UserInput / SteeringInput
       ├─ ModelDecision
       ├─ ToolCall / ToolResult
       ├─ Approval / Event / Artifact
       └─ ProviderCheckpoint
```

### 4.1 身份和存储

- 新增稳定 `conversation_id`，只有点击“新建对话”才创建新的值。
- 每次普通发送创建 `turn_id`；当前 `run_id` 迁移为一次 turn 的执行标识。
- `AgentTask` 增加 `conversation_id` 和 `turn_index`，历史显示改为“对话 → 回合”。
- core runtime 以 `conversation_id` 创建或恢复 thread，不再每次发送后销毁整个对话上下文。
- 旧任务迁移为各自独立的 legacy 单回合 conversation，不丢失历史记录。

### 4.2 Turn、追加要求与停止

- 对话空闲时发送：`turn_start(conversation_id, input)`。
- turn 运行时输入框继续可用，发送按钮显示“追加要求”。
- 追加内容先持久化，再进入上限 32 条的 steering mailbox。宿主同时校验活动 `conversation_id`，事件记录实际 `turn_id`，防止串入其他对话。
- runtime 在下一次模型决策边界读取追加内容；存在未处理追加内容时不能提前给出最终答复。
- “停止”映射为 `turn_interrupt`，保留已完成工具结果和未完成状态，不伪造成功。
- 一个 conversation 同时只允许一个活动 turn，避免并发写入污染上下文。

### 4.3 Provider Context Adapter

当前实现统一定义两种 provider 上下文状态：

1. `responses`：保存 `previous_response_id` 和本地已覆盖消息序号，后续请求只发送新增消息，并使用 Responses 的 `context_management` 压缩。
2. `local_rollout`：仅支持 Chat Completions 或用户强制本地模式时，发送最新 checkpoint、checkpoint 之后的消息和动态上下文。

本地事件、工具结果与 Artifact 始终是权威审计记录；provider 游标只是可重建的加速状态。能力探测失败不能让仅支持 Chat Completions 的配置失效。

### 4.4 压缩策略

- 按实际 provider/model 的 context window 和 usage 决定压缩，不再对所有模型固定使用同一阈值。
- Responses 模式优先使用原生 compaction，并保存不透明 compaction item 或 provider cursor。
- `local_rollout` 使用版本化结构 checkpoint，至少包含：目标、约束、用户纠正、精确字面命令、工具事实、Evidence 引用、未解决问题和权限状态。
- 命令必须以 JSON 字符串保存，空格和换行按字节保真；禁止自然语言摘要改写命令。
- 后续请求只发送 checkpoint 与 checkpoint 之后的消息；大输出只发送 Artifact 引用，需要时分页读取。
- system prompt、Skill 和工具 schema 作为动态上下文重新装配，不固化进陈旧摘要。
- 压缩初次失败后最多重试 3 次；仍失败则以原始错误结束当前 turn。

### 4.5 前端适配

- Agent 顶部显示当前 conversation 名称与状态。
- “新建对话”创建真实持久 conversation，而不是只清空气泡。
- 历史弹窗按 conversation 聚合，可展开查看每个 turn。
- 运行时输入框保持可编辑，发送操作变为“追加要求”。
- 时间线显示追加要求被接收、进入哪个 turn、何时被模型消费。
- 调试详情显示本次请求是 `new`、`reused`、`compacted` 或 `local fallback`，但不泄露 API Key。

## 5. CLI 空格纠正如何进入上下文

目标完整命令始终保存为精确字符串，例如：

```json
{
  "command": "show system general",
  "visible_input": "show",
  "sent_suffix": " system general"
}
```

如果用户随后说明“参数之间是有空格的”，该纠正作为 conversation 级约束写入当前 turn 的输入和下一份 checkpoint。工具仍只接受完整目标命令，由宿主根据终端真实可编辑前缀按字节计算缺失后缀：

- 当前为 `show`：发送 ` system general`。
- 当前为 `show `：发送 `system general`。
- 当前为 `show system`：发送 ` general`。
- 当前前缀不兼容：不发送，返回冲突详情给模型。

模型不负责手工拼接后缀，避免模型补空格、终端补前缀和前端回显三套逻辑互相打架。

## 6. 验收标准

1. 同一 conversation 的下一轮能读取上一轮用户纠正；新建 conversation 后不能串入旧约束。
2. CLI 四个精确前缀案例均有 Rust 回归测试，空格按字节一致。
3. turn 运行时可以追加要求，且下一次模型决策必须包含该要求。
4. Responses 模式只发送增量和 provider cursor；Chat 模式只发送 checkpoint + tail。
5. 原生或本地压缩后，用户约束、精确命令、工具证据和未完成事项不丢失。
6. 压缩初次请求加 3 次重试均失败后，结束 turn 并显示原始错误链。
7. 大终端输出和 MCP 结果使用 Artifact/Evidence 引用，不在每次模型请求中重复传输。
8. 模型故障切换不得重放已经产生副作用的工具调用。
9. 停止、应用重启和 provider 断线后，对话与 turn 状态可恢复或明确标记为中断。

## 7. 0.9.11 实施结果

- Agent SQLite schema 升级为 v5，增加持久 Conversation、Turn 序号和旧任务迁移；旧任务各自变为独立单回合 Conversation。
- Core thread id 稳定使用 `conversation_id`，每次发送生成新 Turn；重启 runtime 会从 SQLite 恢复消息、checkpoint 和 provider cursor。
- 运行中可追加要求；追加内容先写入 Agent 事件，再经有界 mailbox 在下一次决策前消费。无未消费追加时才允许结束 Turn。
- Provider Context Adapter 实现 `auto` / `responses` / `local_rollout` 配置。Auto 对明确不支持结果持久回退，对瞬时错误保留后续重试机会。
- Responses 运输实现增量 input、function call/output、`previous_response_id`、usage 和 provider checkpoint；Chat Completions 保留 SSE 流式输出。两条路径都遵守 Bearer 或原始 Authorization API Key 配置。
- 本地压缩使用严格 JSON checkpoint，并从已持久工具调用中反向注入 `cli_execute` / `cli_execute_batch` 完整命令，防止摘要改写空格。
- 前端按 Conversation 创建、删除、恢复历史，显示上下文模式和 steering 状态，并为每个模型配置窗口/压缩阈值。

本版本仍不增加云端长期记忆、工作流 DAG 或云端 Skill 市场。Responses 当前采用完整 JSON 响应，Chat Completions 保持 SSE 增量文本；这一取舍优先保证续接、工具调用和兼容回退的正确性，后续可在不改 Conversation 存储契约的前提下增加 Responses SSE。

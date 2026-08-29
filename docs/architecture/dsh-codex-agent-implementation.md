# dsh-codex-agent 0.11.0 实现说明

> 更新日期：2026-08-29。桌面端只保留一套 Agent Loop：精简 Codex Core 负责 Thread/Turn、模型工具循环、上下文和 Subagent Graph；myterm 宿主负责 Goal、权限、SSH、Skill、MCP、后台 Job、审计与 UI 投影。

## 1. 设计目标与取舍

本版本采用“精简 Core + 轻量 Goal 控制面”，不接入完整 codex app-server。

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只保留固定 Step 的单 Turn | 实现最小 | 64 Step 会把可继续任务误判失败；等待外部结果和重启恢复割裂 | 不采用 |
| 精简 Core 上增加 Goal 控制面 | 复用现有 Core；普通输入自动获得长任务能力；体积和依赖可控 | 宿主需维护 Goal/Turn 映射和恢复不变量 | 采用 |
| 完整 codex-core/app-server | 上游能力最完整 | 依赖、协议、网络出口和未使用功能显著增加，偏离轻量桌面目标 | 排除 |

用户不需要输入 `/goal`，也不需要判断长短任务。每个普通输入自动创建或复用 Goal；短任务在一个 Turn 完成，长任务透明续跑。

## 2. 状态所有权

| 状态 | 唯一所有者 | 关键不变量 |
|---|---|---|
| Goal、输入队列、Job、Evidence、Goal Skill | myterm AgentService/AgentStore | 一个 Conversation 同时最多一个非终态 Goal |
| Thread/Turn、消息、工具调用顺序、Checkpoint、Subagent Graph | dsh-codex-core | 宿主不能重排 Core 工具调用或维护第二份模型历史 |
| AI Profile、模型路由、凭据引用 | Config/AiService | API Key 只从系统凭据库解析，不进入 JSON、事件和 artifact |
| SSH/SFTP/文件、权限、审批、Hooks | myterm 宿主 | 所有效果工具共用策略、取消、输出限制、锁和审计 |
| MCP Transport、连接池、目录与原始结果 | CapabilityProvider/McpManager | Core 不依赖 MCP SDK、stdio 进程或 HTTP 会话类型 |
| Agent 时间线 | 持久 Event 投影 | 先持久化再发送 UI；UI 断开不丢事实 |

## 3. 自动 Goal 与长任务续跑

Goal 状态包括 `active`、`paused`、`waiting_approval`、`waiting_external`、`blocked`、`completed`、`failed` 和 `canceled`。

Core 仍保留单 Turn 默认 64 Step 的安全让出边界，但达到边界返回 `continuation_required`，不是 `maximum step count` 错误。宿主按以下顺序处理：

1. 提交当前 Turn 的工具结果、Token 用量和 Checkpoint。
2. 将 Turn 标记成功让出，不改变 Goal 为失败。
3. 若没有暂停、取消、审批或外部等待，自动创建下一 Turn。
4. 新 Turn 从同一 Thread 的持久历史与最新 Goal checkpoint 继续，不重做已验证步骤。

默认 Goal 没有隐藏 Token 总预算。循环保护依靠重复工具签名、无进展 checkpoint、策略错误和明确取消，不用固定总 Step 数替代进展判断。

运行中输入提供两种明确语义：

- `steer`：持久化后在最近的模型决策边界注入当前 Turn。
- `queue`：当前 Turn 结束后作为下一条输入继续同一 Goal。

后台 Job 完成后使用事件驱动 `Notify` 唤醒等待中的 Goal。回调先注册通知再检查活动状态，避免完成事件与 Turn 收尾之间的丢唤醒竞态；没有固定 30 秒轮询和任意任务级超时。

## 4. 澄清、暂停与恢复

系统 Prompt 要求先做安全只读发现。只有目标、范围、预期结果或安全边界仍存在会改变执行路径的实质歧义时，模型才调用 `goal_update(status=waiting_approval)`，并写入准确的未决问题。允许多轮澄清；用户回答后重新激活同一 Goal。

应用重启时：

- 运行中 Job 标记 `lost`，等待中的审批拒绝；
- 被中断的 Turn 标记失败，但非终态 Goal 只暂停；
- Conversation、Goal、队列、Evidence 和 Skill 继续可读，用户恢复后从 checkpoint 继续。

应用退出会中止活动 Turn、取消 Job、拒绝审批、释放 Core Runtime 并关闭 MCP 连接。Runtime 按 Conversation/Provider 指纹缓存，默认最多 12 个、空闲 30 分钟；最多 4 个 Conversation 并发，活动 Runtime 不参与空闲/LRU 淘汰，必要时允许暂时超过缓存上限。

## 5. 上下文与原始证据

上下文选择完全自适应，前端不提供协议、上下文窗口或压缩阈值开关：

- 优先使用 Responses 增量上下文；明确不支持时按 Provider 配置指纹持久回退 Chat Completions。
- 瞬时错误不写成永久不支持；Base URL、模型或认证变化会生成新指纹重新探测。
- 本地 Checkpoint v2 只输入上一 checkpoint 与新增 tail，同一活动模型完成压缩。
- 压缩初次失败后最多重试 3 次；全部失败只终止当前 Turn，原历史不截断、不提交半成品。

超过 8 KiB 的工具结果写入不可变 artifact，并保存字节数与 SHA-256。模型上下文只接收 Result Capsule；`result_read` 可按查询或 UTF-8 安全范围读取原文。MCP 原始返回以 Goal Evidence 保存，可跨 Turn 用 `evidence_read` 分页，但不能跨 Goal 引用。

## 6. 多 Provider 路由与可靠性

一个 AI Profile 可定义主、分析、备用模型；每个模型路由可以引用另一份已保存 Provider Profile，从而组合不同 Base URL、认证方式和系统凭据。删除仍被路由引用的 Provider 会被后端拒绝。

路由按角色和启用状态选择，失败可跨模型、跨 Provider 回退。每条路由独立维护：

- 瞬时请求最多 3 次总尝试，退避 400ms、1000ms；
- 已经产生流式增量后不自动重放，避免重复文本或工具调用；
- 连续 3 次终态瞬时失败后熔断 30 秒；
- 结构化日志保留路由、阶段、错误码和原始诊断，只脱敏凭据。

Core 配置同时接受新的 `turnStepBudget` 和旧 `maxSteps` 字段；这是插件边界兼容，不是用户可见的 Goal 总上限。

## 7. CapabilityProvider 与 MCP

MCP 统一实现为 Transport 无关 `CapabilityProvider`：

- Transport：`stdio` 与 `streamable-http`。
- 能力：Tools、Resources、Prompts、进度事件和诊断。
- 连接池：配置指纹复用，目录缓存 5 分钟、空闲 30 分钟、上限 16。
- 恢复：发现/list/read 操作断线后重连一次；工具调用失败不自动重放，以免重复副作用，但清除故障连接供下一次显式调用重连。
- 安全：输入和 `structuredContent` 按服务端 Schema 校验；HTTP Header 名校验；Secret 不进入参数摘要。
- 证据：规范化 `structuredContent`、合并 `textContent`、`isError`、原始 JSON 和 Evidence 引用。

每次调用结束、错误或超时都会清除该次 progress sink，避免池化客户端把旧回调泄漏到后续 Goal。模型只能使用实际发现的能力；空目录不得猜测工具、Resource 或 Prompt。

## 8. Skill 与多 SSH

Skill 从本地目录发现 `SKILL.md`，支持常见 hyphenated 元数据和 YAML block list。宿主执行 `model-invocable`、platform、allowed-tools、信任和风险校验；已激活 Skill 按 Goal 持久化，每个 Turn 恢复完整正文（单个上限 128 KiB），不能绕过权限策略。

活动 SSH 只是候选目标。通用问答、MCP、Skill 和历史不自动读取终端；用户明确说当前终端时使用 `use_active_session=true`，命名服务器先 `session_catalog`/`session_connect`，后续工具必须携带 `session_id`。

同一 Session 的状态变更通过独立操作锁串行，不同 Session 可并发。`session_wait_until` 在目标 B 上有界轮询静态只读命令，支持精确条件、进度、取消和 4 MiB 捕获上限，用一次工具调用表达“A 完成后观察 B”，减少短小模型请求。

交互 CLI 使用完整目标命令。宿主在一个事务中读取真实 xterm 光标行，只发送缺失后缀；冲突时零写入。`terminal_edit` 通过预期光标行守卫支持删除、移动和替换错误输入。

## 9. 会话删除与资源清理

删除 Conversation 前检查活动 Turn 和 `running/canceling` Job。允许删除时：

1. 递归解析并删除 Root/Subagent Thread 树；
2. 删除 Core audit、工具结果索引和原始 artifact；
3. 释放缓存 Runtime；
4. 清理 Goal/Task Evidence 目录和宿主数据库记录。

所有 artifact key 必须通过安全字符校验，清理失败记录准确 warning；不会对未解析目录执行递归删除。

## 10. 测试与构建门禁

发布前必须通过：

- myterm 前端 Vitest、TypeScript、Biome 和生产构建；
- Tauri 宿主 Rust 全量测试、`cargo fmt --check`、`cargo check -j1`；
- dsh-codex-core Rust 全量测试；
- Harness N-API 集成测试。

Harness 测试会先重建 `native-dist/*.node` 再运行 TypeScript，禁止用陈旧 N-API 二进制验证新源码。Release 构建固定单线程 Rust，并执行分发审计、35 秒内存/句柄采样、SHA256、提交、标签和 GitHub Release 上传。

## 11. 保持裁剪的边界

本版本仍不引入完整 Codex app-server、Cloud Tasks、ChatGPT 登录、Telemetry、远程插件市场、通用 DAG、自动长期记忆或第二套 Agent Loop。OS 安装仍处于 Skill + Provisioning Provider 方案阶段，高风险写盘不会退化为一条自由文本 shell 命令。

该边界的优点是依赖图、网络出口、内存和维护面可控；缺点是上游 Codex 的 Goal/app-server 新能力需要经过审计后人工同步，而不是自动继承。

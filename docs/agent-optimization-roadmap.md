# myterm Agent 优化路线与取舍

本文记录 0.8.0 对 Agent 的直接改进，以及后续保持轻量内核时最值得投入的优化。路线按风险、收益和对现有插件边界的影响排序；它不是把 myterm 扩展成通用编排平台的清单。

## 0.9.10 已落地：动态 SSH 目标与 MCP 可诊断性

- 活动 SSH 从“Task 默认绑定”降为被动候选。模型只有在用户明确指向当前终端时才设置 `use_active_session=true`；命名服务器必须经 `session_catalog`/`session_connect` 解析为明确 `session_id`，缺少目标时闭合失败。
- 通用问答、MCP 配置/故障、Capability 发现、Skill 和历史任务不再固定读取终端上下文。前端不做关键词分类，真实选择来自模型看到的系统 Prompt 与工具 Schema。
- `mcp_status` 把所有配置服务器的连接/发现阶段、工具数、错误码和原始详情提供给 Agent；MCP 调用结果规范化为结构化内容、完整文本内容和 Evidence 引用，降低模型只看到包装层或截断摘要的概率。

取舍：动态目标解析避免把 UI 焦点误当用户意图，并自然扩展到多 SSH；代价是模型漏传目标时会收到一次明确错误，含糊任务需要询问。相比宿主静默 fallback，这个失败可见、可审计且不会把命令下发到错误主机。

## 0.9.9 已落地：请求合并、Capability Registry 与证据链

- `cli_execute` 把“读取真实 xterm 光标行、补齐完整命令、等待完成边界、返回本次输出增量”收敛为一个原子主机工具；`cli_execute_batch` 在一次工具调用中串行执行 1-8 条互不依赖的已知命令。
- Codex Core 支持在同一模型响应内并发执行宿主明确标记为 `parallel_safe` 的独立只读工具，并聚合本轮模型请求数、工具调用数和 Token 用量。副作用和依赖步骤仍串行。
- MCP 工具进入任务级 Capability Registry。目录选择由任务相关度和 Schema 字节预算决定，固定 48 工具分支被移除；Input/Output Schema、title 和 annotations 保持完整。
- MCP 结果形成 Evidence Ledger：原始返回落盘、长内容分页读取、`isError` 保持失败、CLI 命令引用 evidence id。模型不能把一次目录搜索的摘要当作实际命令依据。

取舍：这套方案不引入代码解释器、通用 DAG、长期记忆或常驻服务，内核仍保持“模型轮次 + 工具边界”。代价是静默兜底无法像设备专用适配器一样识别所有 CLI 提示符，复杂依赖链也不会被强行批处理；它们以明确的完成原因、超时和后续模型决策处理。

## 0.8.0 已落地：完整输出与 JSON 多模型路由

- `TerminalBuffer` 继续只保留轻量的 256 KiB 内存窗口，但 Agent 不再把窗口解释成“最近 N 行”。`terminal_context` 以 `offset/limit/nextOffset/eof` 返回 transcript range，模型可以按需读取完整长输出；远程执行 artifact 使用同样的分页思想。
- `AiProfile` 增加 `models[]` 和 `routing`。主模型、分析模型和备用模型按角色排序，传输、HTTP、JSON 失败时只重试模型请求，不重放终端写入或远程副作用。
- `AppConfig.version` 升至 2。旧配置的 `model` 自动迁移为 `models.primary`；前端通过 typed IPC 编辑结构化表单，后端以原子 JSON 文件作为唯一事实来源，API Key 仍只保存凭据引用。

取舍：不把整个终端历史无限堆入模型上下文，避免内存和 token 成本失控；完整内容通过小范围读取工具获得。多模型先做确定性的顺序故障切换，不做并行投票、复杂仲裁和多 Agent 编排，以保持 Agent 内核低延迟、少依赖。

## 0.7.1 已落地：可诊断的错误契约

错误不再由 UI 或服务层猜测原因。Rust 的 `AppError` 统一提供 `code` 和 `detail`，IPC 返回 `{ code, message }` 时，`message` 保留底层详情；Agent 事件增加 `errorCode`，`content` 携带原始详情。HTTP、传输、JSON、工具、MCP 和审批失败都经过同一条事件/审计链路。

界面默认显示阶段标签和原始诊断文本，保留换行、HTTP 状态、Endpoint、响应体、stderr、退出码和超时信息。只有两类处理会改变文本：密钥及明显的 `sk-...` Token 脱敏，以及 16,000 字符上限；超限会追加明确的截断标记。不会把 401 自行解释成“密钥过期”，也不会把一个 MCP 启动错误改写成“连接失败”。

## 优化优先级

### P0：保持当前边界，继续做可靠性

| 项目 | 收益 | 代价与风险 | 验收 |
|---|---|---|---|
| 原始诊断契约（已完成） | 人可以直接定位网关、SSH、MCP 和工具问题；模型能区分失败阶段 | 详情可能很长，必须脱敏并限制内存 | HTTP 401/502、超时、JSON、stderr 和 MCP spawn 错误在设置页、Agent 时间线和历史任务中一致可见 |
| 结构化工具结果 | 让 Agent 区分非零退出、传输断开、超时、取消和权限拒绝，减少盲目重试 | 旧插件返回字符串，需要兼容迁移 | 每种状态都有稳定 code、原始 detail、retryable；非零退出不被当成 SSH 断线 |
| 证据与完成判定（MCP→CLI 已完成） | 避免 Agent 只凭一句模型话术宣称成功 | 长证据需要一次分页读取，增加少量本地 I/O | MCP 生成的 CLI 引用任务内 evidence id；后续扩展到变更类 Skill 的最终验证 |

### P1：拆分可替换能力，但不增加常驻服务

| 项目 | 优点 | 缺点 | 建议 |
|---|---|---|---|
| Provider 插件契约 | 模型请求、重试、工具调用协议可单测；未来可支持不同 OpenAI 兼容差异 | 要迁移当前 `AgentService`，取消和流式事件边界较复杂 | 先抽出 `ModelProvider` trait，保留一个进程内 OpenAI 实现 |
| 内置工具按域拆分 | SSH、文件、任务 Job 各自拥有 schema、测试和错误映射，减少巨型 dispatch | 模块数量增加；过细会变成“一个函数一个插件” | 只按会话/执行/文件/任务四个稳定域拆分 |
| MCP 进程监管 | 启动失败能看到 stderr；支持健康检查、超时、退避和任务结束清理 | 子进程生命周期、Windows 信号和日志截断需要专门实现 | 先做 stderr 捕获和启动/调用超时，再做有界重启；不做常驻 MCP 守护进程 |
| 上下文预算与结果引用 | 长 stdout、MCP schema 和 Skill 不会撑满模型上下文，成本更可预测 | 需要 token 估算器或 provider 适配；引用读取增加一次工具调用 | 先做字符预算和头尾保留，再按 provider 增加 token 预算 |
| 可恢复的重试策略 | 网络瞬态错误可有限重试，权限拒绝和非零退出不会被错误重放 | 重试可能重复副作用；必须和幂等性绑定 | 只允许模型请求、只读探针和明确幂等工具重试，写操作默认不重试 |

### P2：多目标与长任务

1. 多 SSH target graph：一个 Task 显式绑定 A/B/C，读操作可有界并发，副作用默认串行；每一步记录目标、前置条件和观察证据。
2. Checkpoint/resume：在工具边界保存 plan hash、输入摘要和完成证据；恢复时重新验证目标身份，不自动重放未知副作用。
3. Skill 驱动 provisioning：Skill 只生成和校验安装计划，写盘、电源和引导动作交给虚拟化、云、MAAS 或 Redfish/BMC 插件；当前 SSH 不能作为重装后的唯一控制面。
4. 进程外插件：在 JSONL 协议稳定后增加签名、信任、命令路径白名单、环境过滤、资源上限和崩溃回收。没有这些前置条件，不启用任意第三方进程。

## 明确暂不做

- 复杂多 Agent 团队、通用 DAG 和长期记忆。
- 云端 Skill/插件市场或自动下载未知代码。
- 常驻 CLI/REST 服务。CLI/REST 只表示 Agent 从明确的远端 SSH 来源执行 Linux 命令和 HTTP 请求。
- 用大依赖替换现有小型循环；新增依赖必须说明体积、MSRV、license 和维护状态。

## 推荐交付顺序

`结构化工具结果 -> Capability Registry/证据链（已完成） -> Provider trait -> MCP stderr/健康监管 -> 变更完成判定 -> 多 SSH target -> checkpoint/resume -> provisioning -> 进程外插件`。

每个阶段都必须通过 Rust/前端单测、错误原文回归、取消与权限回归、release 构建和覆盖安装检查。性能门槛保持不变：Agent 内核不增加常驻进程；工具输出有界或落盘引用；记录启动时间、工具首事件延迟、空闲 CPU、峰值内存和安装包体积。

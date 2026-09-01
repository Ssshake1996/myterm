# myterm Agent 插件架构

> 当前日期：2026-09-01。myterm 使用官方 DeepSeek Harness ACP，不再维护旧 `dsh-codex-agent` 或第二套自研 Agent Loop。

## 目标

Agent 要保持“脑、手、边界”分离：

- DeepSeek Harness 是 Agent 内核，负责模型循环、持久 Session、Goal、上下文压缩、本地工具和 Skill。
- Harness Local Tools 是本机的手，负责 PowerShell/Bash 和本地文件。
- myterm Host MCP 是远程系统的手，负责 SSH、交互式 CLI、SFTP、保存服务器、多 SSH 和外部 MCP。
- myterm AgentService 是产品控制面，负责权限、审批、取消、审计、UI 事件和模型路由。

这不是“删除工具后只保留对话”。本地与远程工具都保留，只是由不同所有者实现，避免 Harness 本地 Shell 被误当成远程 SSH。

## 组件

| 组件 | 类型 | 职责 |
|---|---|---|
| `deepseek-harness` | 官方 ACP sidecar | Agent Loop、Session、Goal、compaction、本地工具、Skill |
| `harness-local-tools` | Harness 插件组 | PowerShell/Bash、本地文件读取/搜索/编辑 |
| `myterm-host-mcp` | 回环 Streamable HTTP MCP | SSH/CLI/SFTP/会话/Job/外部 Capability |
| `multi-ssh-coordinator` | myterm 内置工作流工具 | 保存目标连接、显式 session_id、跨 SSH 条件协同 |
| `CapabilityProvider` | myterm Provider 抽象 | stdio/streamable-http MCP 的连接、发现、调用和诊断 |

## Host MCP 契约

Host MCP 每次 Agent 运行临时创建，绑定 `127.0.0.1:0`，使用随机路径和随机 Bearer Token。它只启用 Tools；任务结束时关闭 listener。工具定义来自 myterm 现有 Schema 和运行时发现的外部 Capability。

所有远程工具调用都执行以下顺序：

```text
Harness tool call
  -> Host MCP 认证
  -> 目标解析与 policy
  -> deny / myterm 用户审批 / allow
  -> SSH、CLI、SFTP 或外部 MCP Provider
  -> 精确结果或原始错误
  -> ACP tool update + myterm 时间线/审计
```

`pluginId` 使用 `myterm-host-mcp`；自动连接与条件等待使用 `multi-ssh-coordinator`，便于日志区分 Agent 内核和远程执行插件。

## 工具分层规则

1. 本机操作优先使用 Harness Local Tools。
2. 远程 Linux、SSH、交互式设备 CLI 和 SFTP 必须使用 Host MCP。
3. 活动 SSH 只是候选。用户明确说“当前终端/这台服务器”时才设置 `use_active_session=true`；命名目标先用 `session_catalog`/`session_connect`，后续始终传 `session_id`。
4. 已知 CLI 命令一次提交完整命令和空格；现场已有前缀时由 `cli_execute` 在宿主事务内安全补齐缺失后缀。
5. 不确定的产品 CLI 先查询 MCP Capability，解析 `structuredContent` 或文本结果，再生成完整命令。不得猜测或拆成大量短模型请求。
6. Tools、Skill 和 Prompt 都不能降低 myterm hard deny。

## MCP 能力

外部 MCP 仍由 myterm 的统一 Transport 抽象连接：

- stdio：myterm 管理命令、环境、stderr、退出与清理。
- streamable-http：myterm 管理 URL、Header、TLS、连接与发现错误。

官方 Harness ACP 当前原生消费 MCP Tools，不消费 Resources/Prompts。myterm 将 Resources/Prompts 包装为 Host MCP 工具，因此能力仍然可由模型按需列出、读取或获取。`mcp_status` 独立于 SSH，保留连接阶段、稳定错误码和原始错误详情。

## 权限与审批

| 模式 | Harness 本地工具 | myterm 远程工具 |
|---|---|---|
| 只读 | read-only sandbox | 写操作拒绝 |
| 用户确认 | ACP permission request | myterm policy approval |
| 完全授权 | danger-full-access | hard deny 外自动放行 |

远程 MCP 工具不申请 Harness Shell 沙箱升级，因此一次远程操作只由 myterm 权威策略确认一次。

## 生命周期和恢复

- 每个 Conversation 保存一个 ACP session id，并在后续运行或应用重启时 `session/resume`。
- 每次运行启动独立 Harness 进程和 Host MCP；空闲时没有 Agent sidecar 或 listener。
- 停止发送 `session/cancel`，关闭 stdin，等待有限时间后终止残留进程。
- 模型路由失败只重启 Harness 模型路线，不重放已经成功的远程副作用。
- ACP v1 没有真正 mid-turn steering；运行中追加输入在当前响应后立即提交下一次 prompt，持久排队则由 myterm Goal 队列负责。

## 方案取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 继续维护裁剪 Codex Core | 体积小、协议完全可控 | 长期追上游、修模型兼容和 Agent 能力的成本高 | 已删除 |
| 官方 Harness ACP + Host MCP | 官方 Agent/Goal/Skill/工具持续升级；SSH 边界不变 | 携带 Node 后运行时约 236 MiB；Harness 仍是 Developer Preview | 当前方案 |
| 让 Harness 直接拥有全部 SSH/MCP | 配置看似简单 | 绕过 myterm 会话、审批、错误和多 SSH 契约，容易形成第二执行栈 | 不采用 |

## 验证清单

- `npm run test:harness-runtime`：官方版本/profile 和 ACP session smoke。
- `npm run audit:codex-network`：版本统一、本地工具、Goal、Skill、compaction 与注入入口检查。
- Rust 测试：Provider JSON、Bearer/原始 Authorization、系统 Prompt、ACP reason、SSH/CLI policy。
- 前端测试：运行中追加、权限显示、工具时间线和 Agent 配置。
- `npm run build:release && npm run check:dist`：安装器和便携包必须包含 launcher、profile、依赖和私有 `node.exe`。

完整 sidecar 与构建说明见 [DeepSeek Harness 集成说明](architecture/deepseek-harness-integration.md)。

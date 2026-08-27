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

### Tool descriptor

工具描述包含名称、说明、JSON Schema 和所属插件 id。Schema 由插件返回，Agent Loop 不维护工具白名单。MCP 工具在工具数量较少时直接挂载；目录过大时只挂载搜索和显式调用入口，避免一次运行撑满模型上下文。

### Tool context

插件只收到受限的 `ToolContext`：当前运行和调用 id、目标会话、Agent 设置、MCP 客户端、事件 sink 和取消 receiver。插件不能绕过 `AgentService` 的凭据库、权限策略、输出上限、脱敏或审计边界。

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
3. MCP schema 按需挂载；事件参数沿用现有摘要、截断和脱敏规则。
4. 默认注册表不启动常驻子进程。只有任务启用 MCP 时才创建任务级客户端，并在任务结束时释放。
5. 任何新增插件都必须补充 manifest 测试、工具 schema 测试、拒绝路径测试和一次发布构建检查。

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

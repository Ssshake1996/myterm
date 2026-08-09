# myterm Linux Agent 开发计划

> 文档状态：待实施基线
> 当前产品基线：`0.1.4`
> 对应说明书：[`linux-agent-specification.md`](linux-agent-specification.md)
> 研究依据：[`linux-agent-improvement-study.md`](linux-agent-improvement-study.md)

## 1. 计划目标

本计划把当前有限 Agent 闭环演进为面向 Linux 服务器的可靠执行系统，并在核心稳定后增加 CLI 和 RESTful API。计划不以功能数量为目标，而以以下结果为完成标准：

- 命令有明确开始、结束、退出码、stdout、stderr、超时和取消结果。
- 权限由统一策略引擎判定，桌面端、CLI、REST 和 MCP 不能绕过。
- 每次系统变更都能关联审批、执行证据、验证证据和审计记录。
- 任务在 UI 断开、CLI 退出或 SSE 重连后仍可查询，不会重复执行。
- CLI 和 REST 复用同一 Agent 应用服务，不形成第二套 SSH 或 shell 实现。

本计划不承诺日历工期。每个里程碑必须通过退出门槛并独立提交，才能开始依赖它的下一里程碑。

## 2. 实施原则

1. **先内核，后入口**：先完成执行、任务、权限、审计，再开发 CLI 和 REST。
2. **契约先行**：先更新说明书中的类型、状态、事件和错误码，再修改实现。
3. **纵向交付**：每个里程碑必须包含 Rust、IPC/UI、迁移和测试，不留下不可运行的半层实现。
4. **默认保守**：无法解析、无法分类、生产环境、root 和远程副作用自动提升风险，不用模型猜测安全性。
5. **同一管线**：内置工具、Skill 脚本和 MCP 工具共用审批、取消、输出限制与审计。
6. **一次只扩大一个边界**：多 Agent、长期记忆和通用工作流编排不与执行内核同时开发。
7. **轻量是发布门槛**：每个里程碑记录原生内核与完整进程组的体积、内存、CPU、启动和吞吐差异，超预算不发布。
8. **经验同步**：每个里程碑完成时更新 `docs/development-experience.md` 的决定、失败和验证记录。

## 3. 版本与里程碑

| 版本 | 里程碑 | 核心交付 | 依赖 |
|---|---|---|---|
| `0.2.0-alpha.1` | A0 契约与存储骨架 | 统一任务模型、版本化事件、SQLite 迁移、旧配置迁移 | 当前 `0.1.4` |
| `0.2.0-alpha.2` | A1 结构化执行 | `remote_exec`、流式输出、退出码、超时和取消 | A0 |
| `0.2.0-beta.1` | A2 权限与风险 | 三级权限、命令解析、allow/ask/deny、危险操作规则 | A1 |
| `0.2.0` | A3 任务控制与审计 | 后台任务、循环保护、证据验证、持久历史、Agent 控制台 | A2 |
| `0.3.0` | B1 Linux 运维工具 | 主机事实、文件工具、标准排查 runbook | A3 |
| `0.4.0` | C1 CLI | Agent 任务命令、JSONL、审批、取消和退出码 | A3；建议 B1 |
| `0.5.0` | C2 RESTful API | `/v1` 任务资源、SSE、认证、幂等和 OpenAPI | C1 |
| `0.6.0` | D1 扩展层增强 | MCP 长连接、Hooks、Skill v2、上下文压缩 | A3；可与 C1/C2 独立排期 |
| 后续评估 | E1 受限子 Agent | 只读并行排查、权限继承和摘要返回 | D1 稳定后 |

`0.2.0` 是第一条完整完成线：只有 A0-A3 全部通过，才可称为可靠的 Linux Agent 执行版。

## 4. 依赖顺序

```text
A0 任务契约与事件存储
  -> A1 结构化远程执行
    -> A2 权限与风险引擎
      -> A3 后台任务、证据、审计与控制台
        -> B1 主机事实、文件工具和 runbook
        -> C1 CLI -> C2 RESTful API
        -> D1 MCP、Hooks、Skill v2 -> E1 只读子 Agent
```

C1 不能先于 A3。C2 不能先于 C1 的跨入口契约测试通过。D1 可以在 A3 后与 B1/C1 并行设计，但不得并行修改同一权限与事件契约。

## 5. 里程碑明细

### A0 统一任务契约与存储骨架

目标：把当前仅存在于组件内存中的一次运行升级为可查询、可恢复、可复用的任务域。

交付物：

- 按说明书实现 `AgentTask`、`AgentEventEnvelope`、`ToolCallRecord`、`ApprovalRequest`、`ExecutionJob` 和统一错误类型。
- 将 Agent 服务拆分为应用服务、循环运行时、工具注册表、策略接口、事件存储接口；暂不抽成独立 crate。
- 引入 SQLite 持久化，建立 schema 版本、顺序迁移、事务和崩溃恢复规则。
- 建立可重复的 release 性能基准脚本，记录 `0.1.4` 的启动、原生主进程、完整进程组、CPU、包体积和输出吞吐基线。
- 事件先落盘再发布给 Tauri Channel，UI 重连可按 `run_id + sequence` 补取。
- 把旧 `full_access` 持久设置迁移为 `confirm`；任务级授权只存在于一次运行中。
- 保持现有四个内置工具和现有 UI 可运行，增加兼容适配测试。

退出门槛：

- 状态转换测试覆盖全部合法路径，并拒绝终态回到运行态。
- 连续写入 10,000 个事件后顺序唯一且可按游标恢复。
- 在事件写入、任务快照和迁移中模拟中断，数据库可重新打开且无半条审批。
- 从 `0.1.4` 配置升级后，AI profile、Skill、MCP 和服务器 profile 均保留。
- SQLite 未使用时不启动忙轮询；A0 相对基线的原生进程增量不超过说明书预算。
- `cargo test`、Clippy、TypeScript、Biome 和前端测试全部通过。

### A1 结构化远程执行

目标：普通 Linux 命令不再依赖 PTY 屏幕快照判断结果。

交付物：

- 基于现有 SSH 连接打开独立 exec channel，实现 `remote_exec`。
- 分离 stdout/stderr，记录退出码、signal、开始时间、耗时、超时、截断和连接中断。
- 增量输出写入事件和受限 artifact；发给模型的内容使用首尾预览。
- stdout/stderr 使用固定内存窗口并合并输出事件，不按行或字节无限排队。
- 取消从 Agent 任务传播到 SSH channel；超时后按说明书执行关闭和最终状态落盘。
- 保留 `terminal_send`，并在工具说明中限定为交互式 PTY 场景。
- 增加 `job_status`、`job_output`、`job_cancel` 的底层接口，A3 再开放完整后台 UI。

退出门槛：

- `true` 返回 0，`false` 返回非零，stdout 与 stderr 不串流。
- 超时、用户取消、SSH 断线和远端 signal 具有不同结果与错误码。
- 10MB 输出不阻塞 UI，模型预览不超过配置上限，完整 artifact 可读取。
- 10MB 输出吞吐、峰值内存和事件延迟满足说明书效率预算。
- 取消后没有仍被 myterm 持有的 SSH channel 或本地任务。
- 交互式 PTY 回归测试证明终端输入、分屏和快捷命令未受影响。

### A2 权限与风险引擎

目标：从“每次都问/全部放行”升级为可解释、不可绕过的策略。

交付物：

- 新增 `read_only`、`confirm`、`task_grant`，删除可持久化的 `full_access`。
- 使用成熟 Bash 语法解析器生成命令结构；A0 技术决策记录最终依赖，禁止仅靠字符串前缀。
- 建立 effect、resource、risk 和 `deny > ask > allow` 规则求值器。
- 实现危险操作硬拒绝、root/生产环境限制、受保护路径和无法解析命令升级确认。
- 审批支持拒绝、仅本次调用允许、本次任务精确规则允许；审批 5 分钟后失效。
- UI 显示主机、用户、环境、风险、解析效果、资源和规则范围。

退出门槛：

- 表驱动测试覆盖说明书列出的所有危险类别、管道、重定向、命令替换和多命令组合。
- 任意宽泛 allow 规则都不能覆盖 hard deny。
- root 和 production 任务不能启用宽泛 `task_grant`。
- 未识别语法不能自动执行；模型、Skill、MCP 都不能修改策略结果。
- 审批过期、重复响应和任务结束后的响应均安全失败。

### A3 任务控制、证据、审计与控制台

目标：形成第一条可靠 Linux Agent 完成线。

交付物：

- 完整开放前台/后台 job 生命周期、状态、输出、取消和清理。
- 相同工具与参数连续调用 3 次触发循环保护；每类错误有独立重试预算。
- 对有副作用的工具记录预期后置条件，完成前运行验证并保存证据。
- 审计记录入口、调用方、主机、模型、审批、工具、脱敏参数、结果和 artifact 引用。
- AI 面板升级为任务控制台：任务清单、风险、stdout/stderr、耗时、退出码、验证状态和历史。
- 支持任务历史查看、恢复事件、导出和删除；实施存储配额与保留策略。

退出门槛：

- UI 刷新或重开应用后能查看已完成任务及完整事件顺序。
- 有副作用任务缺少验证时不能报告成功；验证失败使用独立 finish reason。
- 重复工具调用、步骤上限、审批拒绝、取消和连接中断都有明确终态。
- secret 注入测试证明配置、事件、artifact、日志和 UI 中均无明文。
- 在隔离 Linux 测试机完成磁盘排查、服务排查和安全配置修改的端到端验收。

### B1 Linux 主机事实、文件工具与 runbook

目标：提高跨发行版命令正确性，并减少模型用 shell 拼装文件操作。

交付物：

- 连接后采集带有效期的主机事实快照。
- 实现 `file_stat`、`file_read`、`file_search`、`file_write`、`file_patch`、上传和下载。
- 文件写入使用临时文件、权限保留、原子替换和 readback；审批展示 diff。
- 提供磁盘、内存/CPU、服务、端口、日志、TLS、Docker 等有限 runbook。
- 确定性采集步骤写成代码，模型只负责选择、解释和综合。

退出门槛：

- Debian/Ubuntu、RHEL 系和 Alpine 测试镜像选择正确包管理器和 init 行为。
- 路径穿越、symlink 逃逸、超大文件、二进制文件和敏感路径测试通过。
- 每个 runbook 有固定输入、证据字段、停止规则和至少一个失败用例。

### C1 CLI

目标：提供适合人工终端、脚本和 CI 的 Agent 入口。

交付物：

- `myterm agent run`、`task status`、`task events`、`task approve` 和 `task cancel`。
- 人类输出与版本化 JSONL 输出；稳定退出码和 `Ctrl+C` 取消语义。
- CLI 连接本机 Agent 服务，不直接创建另一套 SSH 执行器。
- Desktop 未运行时按任务启动同一内核的临时 headless service；不注册系统自启动，安全空闲 300 秒后退出。
- 非交互审批返回可恢复状态，不自动提升权限。
- 帮助、shell completion 和 CLI 契约测试。

退出门槛：

- 桌面端和 CLI 对同一任务输出相同 `run_id`、状态、事件和 finish reason。
- JSONL 每行都是独立合法 JSON，断线后可从 sequence 继续。
- secret 不出现在 argv、进程列表、标准输出和 shell history 示例中。
- 无运行/等待 Task、REST listener 和未清理 Job 时，临时 headless service 在 idle timeout 后不再留存进程或端口。
- 所有退出码与说明书一致，并有黑盒测试。

### C2 RESTful API

目标：在不扩大执行权限的前提下提供可自动化集成的服务接口。

交付物：

- `/v1/tasks` 任务创建、查询、SSE 事件、审批和取消接口。
- loopback 默认监听；远程启用需要 TLS、认证、RBAC 和 profile 白名单。
- 生成高熵 bearer token、仅存 hash、一次性显示、轮换和吊销流程。
- 幂等创建、幂等审批/取消、速率限制、并发限制和输出限制。
- OpenAPI 3 文档、错误码映射和最小客户端示例。
- API 审计记录调用方身份、入口和请求关联 ID。

退出门槛：

- OpenAPI 契约测试与实际响应一致。
- `Last-Event-ID` 重连不丢事件、不重复执行任务。
- 相同幂等键只创建一个任务；并发竞态测试通过。
- 未认证、越权 profile、过期 token、重放审批和超限请求均被拒绝并审计。
- 非 loopback 无 TLS 时服务拒绝启动。

### D1 MCP、Hooks、Skill v2 与上下文

目标：扩展能力时仍保持统一边界。

交付物：

- MCP 运行内长连接、健康检查、重连、stderr 日志和按工具授权。
- 工具目录搜索与按需 schema 加载，避免全部 MCP 定义占用上下文。
- Hooks 生命周期与确定性 deny/ask/context/verify 行为。
- Skill frontmatter 权限、风险、适用系统、按需引用、实时刷新和内容哈希。
- 上下文压缩保留任务、权限、证据和未完成验证。

退出门槛：

- MCP 崩溃和恢复不丢失任务终态，超大输出进入 artifact。
- Hook 与 Skill 脚本不能覆盖 hard deny 或绕过审计。
- 压缩前后任务目标、已批准规则和待验证事项一致。
- 48 个以上工具时采用搜索/按需加载，提示上下文不线性增长。

### E1 受限只读子 Agent

只有 D1 稳定并完成独立安全评审后才立项。第一阶段只允许读取主机事实、日志和文件，不允许写入、后台进程或并发服务器变更。子 Agent 继承主任务权限，只向主任务返回摘要和证据引用。

## 6. 需求追踪

| 里程碑 | 负责的说明书需求 |
|---|---|
| A0 | FR-TASK-001、002、008、009；FR-AUD-001..003；FR-ENTRY-001..005；FR-EFF-001、002、004..006 |
| A1 | FR-TASK-005；FR-EXEC-001..007；FR-EFF-003 |
| A2 | FR-EXEC-008；FR-POL-001..007、009 |
| A3 | FR-TASK-003、004、006、007、010；FR-POL-008；FR-AUD-004..007 |
| B1 | FR-OPS-001..004 |
| C1 | FR-CLI-001..003，并回归 FR-ENTRY-001..005 |
| C2 | FR-API-001..004，并回归 FR-ENTRY-001..005 |
| D1 | FR-EXT-001..004，并回归 FR-EXEC-008、FR-POL-009 |
| E1 | 立项前先在说明书增加子 Agent 正式需求；当前不进入实现 |

需求范围使用闭区间，例如 `FR-EXEC-001..007` 表示 001 至 007。A0 之后每个里程碑都必须回归 `FR-EFF-001..006`。每条正式需求必须在对应里程碑的测试报告中映射到自动测试或人工验收证据。

## 7. 资源与效率预算

| 指标 | 硬门槛 |
|---|---|
| 原生主进程空闲 private working set | `<= 12MiB` |
| 完整 desktop/WebView2 进程组空闲 private working set | `< 80MiB`；`0.1.4` 实测 `93.01MB`，是待关闭阻断项 |
| headless Agent service 空闲 private working set | `<= 20MiB` |
| 空闲 CPU | desktop 进程组和 headless service 分别 `<= 1%` |
| NSIS 与便携 ZIP | 各 `< 20MiB` |
| 单里程碑压缩体积增长 | `> 1MiB` 必须 ADR 和用户可见说明 |
| 启动回归 | 相比 `0.1.4` 中位数不超过 `10%` |
| 10MiB 输出 | `>= 5MiB/s`，峰值内存增量 `<= 25MiB`，UI 不阻塞 |
| Event 本地发布/查询 | 发布 p95 `<250ms`；10,000 条游标查询 p95 `<100ms` |

测量必须使用 release 构建和固定验证机，记录硬件、OS、WebView2、采样方法、原生进程与完整进程组。不得把主进程 `6.69MB` 当作整机占用。新增依赖前记录压缩体积和空闲内存差；超出预算时优先移除依赖、懒加载或削减功能，不以提高预算作为默认处理。

运行时约束：REST 默认关闭且无 listener；MCP 随 Task 启停；CLI 不安装自启动 daemon；SQLite 无忙轮询；命令输出使用固定内存窗口并流式落盘；Desktop/CLI/REST 共享 Tokio、SSH、HTTP、模型与存储实现。

## 8. 全程测试门槛

每个里程碑至少运行：

```text
npm run typecheck
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

涉及 SSH、进程、安装或 API 时，还必须运行对应的隔离环境集成测试。真实服务器验收只能使用专用测试 profile，凭据从 OS vault 读取，不得写进脚本、文档、命令行或 CI 日志。

发布候选版额外执行：

- 三主题、窄窗口和长内容的桌面视觉检查。
- 旧版本安装升级、配置迁移、凭据保留和回滚验证。
- 安装包体积、空载内存、10MB 输出吞吐和事件存储性能测量。
- secret 扫描、依赖审计、危险策略回归和 API 攻击面检查。

## 9. 迁移与兼容策略

- SQLite schema 只做向前迁移；升级前备份数据库，迁移失败则保留原文件并拒绝启动 Agent 服务。
- 桌面 IPC 在 `0.2.x` 保持现有方法可用，由适配器转换成新任务契约；弃用项至少保留一个 minor 版本。
- `full_access` 配置升级为 `confirm`，不能静默转成 `task_grant`。
- CLI JSONL、REST JSON 和持久事件都带 schema 版本；新增字段向后兼容，删除或改义必须提升 API 主版本。
- `terminal_send` 保留用于交互终端，不作为一般命令的兼容回退。
- 每个 release candidate 必须验证从已发布前一版本升级，安装器继续执行旧版卸载后安装新版。

## 10. 风险与预案

| 风险 | 发现方式 | 预案 |
|---|---|---|
| SSH exec channel 在不同 shell 上行为不一致 | Debian/RHEL/Alpine 集成矩阵 | 使用主机事实选择明确 shell；未知环境只读并请求确认 |
| Bash 解析与真实 shell 语义偏差 | 语料回归、差分测试、fuzz | 无法完整解析即升级审批；hard deny 另做 token/资源兜底 |
| 取消后远程进程继续运行 | PID/marker 集成测试 | 关闭 channel 后验证；无法确认时标记 `cancel_unknown`，不报告已停止 |
| SQLite 写入阻塞 Tokio | 压力测试和延迟指标 | 使用专用存储 worker/`spawn_blocking`，批量但不越过持久化后发布顺序 |
| artifact 泄露 secret 或占满磁盘 | secret corpus、配额测试 | 写前脱敏、权限限制、单任务/总配额和保留期清理 |
| CLI/REST 与桌面行为漂移 | 跨入口契约测试 | 所有入口只调用应用服务，禁止复制策略和工具实现 |
| REST 暴露到不可信网络 | 启动配置测试和安全检查 | 默认 loopback；非 loopback 强制 TLS、认证、RBAC 和显式开关 |
| 新依赖推高包体积或 MSRV | 每里程碑构建审计 | 依赖先写 ADR；记录体积/MSRV，未达标则替换或推迟 |
| 常驻服务和轮询使空闲资源持续增长 | 60 秒 CPU/内存采样、进程与端口审计 | REST/MCP/SQLite 按需启停；禁止默认 daemon 和短周期刷新 |
| 模型误报完成 | 后置条件和故障注入 | 有副作用任务无验证证据不得进入成功终态 |

## 11. 每个里程碑的完成定义

只有同时满足以下条件才能标记完成：

- 对应说明书需求有实现和测试映射，没有未解释偏差。
- 自动检查、专项集成测试和人工验收全部通过。
- 新错误路径有用户可理解的状态，没有“日志报错但 UI 显示成功”。
- 数据迁移可恢复，secret 检查无命中，危险操作策略回归通过。
- release 性能报告同时列出原生主进程和完整进程组，所有适用效率预算通过。
- 开发经验记录已经补充决定、失败、验证数据和剩余风险。
- 版本号、安装包、便携包和升级测试只在形成用户可用版本时更新，不为内部文档或半成品发布。
- 每个里程碑一个可回滚提交；验证通过后再推送并进入下一阶段。

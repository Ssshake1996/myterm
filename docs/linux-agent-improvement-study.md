# myterm Linux Agent 改进研究

> 研究日期：2026-08-09
> 范围：对照 Codex、Claude Code、OpenCode 和 work-buddy，评估 `myterm` 面向 Linux 服务器运维时的下一步改进，并为后续 CLI 和 RESTful API 入口预留统一架构。本文是设计输入，不代表当前版本已经实现这些能力。

实施文档：[`linux-agent-development-plan.md`](linux-agent-development-plan.md) 和 [`linux-agent-specification.md`](linux-agent-specification.md)。研究报告解释“为什么”，实施时以说明书的正式契约为准。

## 1. 结论

`myterm` 下一阶段最重要的工作不是增加多 Agent，而是建立一个可验证、可中止、可审计的 Linux 执行层。

当前 Agent 已经具备最小闭环：模型决策、内置工具、MCP、Skill、逐次审批、步骤展示和停止能力。但普通命令仍通过活动终端 PTY 写入文本，等待固定时间后读取屏幕快照。这个方式适合交互式命令，却无法可靠提供退出码、标准错误、超时、后台进程句柄和完成边界。模型因此很难区分“命令已发送”“命令仍在运行”和“命令已经成功”。

对于远程 Linux，尤其是 `root` 会话，本地应用沙箱也不能限制已经通过 SSH 发到服务器的命令。真正有效的防线必须同时覆盖：应用侧权限策略、命令语义分析、服务器侧最小权限账号、受限 `sudo` 和完整审计。

## 2. 对照来源与边界

| 项目 | 可核验来源 | 值得借鉴 | 不能直接照搬 |
|---|---|---|---|
| Codex | `openai/codex`，Apache-2.0 | 沙箱与审批分层、结构化进程执行、事件流、Hooks、上下文压缩、受限并行子 Agent | 面向本地代码工作区的沙箱不能保护远程 SSH 主机 |
| Claude Code | `anthropics/claude-code` 公共仓库与官方文档 | Plan/默认/自动等权限模式、受保护路径、root 禁止跳过权限、检查点、Hooks、后台任务、Skill 渐进加载 | 公共仓库包含插件和发布资料，但不是完整 Agent 核心源码；远程副作用也无法靠文件检查点撤销 |
| OpenCode | 当前仓库 `anomalyco/opencode`，MIT | 细粒度 allow/ask/deny、会话级“始终允许”、重复调用保护、自动压缩、按需 Skill | 官方设计明确说明 shell 并未被沙箱隔离，外部路径扫描只是提示，不是安全边界 |
| work-buddy | `KadenMc/work-buddy`，GPL-3.0，预发布 | 少量网关工具加动态发现、确定性步骤与模型判断分离、持久任务状态、证据计划和停止规则、长任务 supervisor | 它偏个人知识工作且包含复杂编排，不适合直接纳入 myterm 第一阶段 |

名称需要特别说明：腾讯公开的是 `Tencent/workbuddy-bench` 评测项目，不是可确认的 WorkBuddy Agent 核心实现。本文提到的开源 `work-buddy` 指 `KadenMc/work-buddy`，二者不是同一个项目。

## 3. myterm 当前基线

基于当前代码：

- `src-tauri/src/agent/service.rs` 维护单个活动运行，执行最多 1-12 个模型步骤，工具结果最多保留 12,000 字符。
- 内置工具只有 `terminal_context`、`terminal_send`、`session_info` 和 `list_directory`。
- `terminal_send` 写入活动 PTY，等待 700ms 后返回最近 60 行；没有独立退出码、stdout/stderr、超时或进程句柄。
- 权限只有 `confirm` 与 `full_access`；确认模式对每次工具调用统一询问，未根据命令、路径、主机和副作用分级。
- Skill 会发现选中的 `SKILL.md` 并整体注入系统提示；尚无按需加载附件、工具限制、可信来源和实时刷新。
- stdio MCP 会在列工具和每次调用时分别启动客户端，调用后取消；没有会话级长连接、健康状态、重连和独立权限规则。
- 前端能显示工具、参数、结果和状态，但记录只存在于当前组件状态，没有持久运行历史、退出码、耗时、风险等级和验证状态。

这些约束适合作为第一版，但不足以安全、稳定地执行几十秒到几十分钟的系统操作。

## 4. 下一迭代：必须先完成

### 4.1 结构化远程执行工具

新增 `remote_exec`，让一般命令不再依赖屏幕快照判断结果。输入和输出至少包括：

- 输入：`command`、`cwd`、超时、受控环境变量、是否允许后台运行、最大输出量。
- 输出：`exit_code`、`stdout`、`stderr`、开始/结束时间、耗时、截断信息、后台 `job_id`。
- 运行中：增量输出事件、取消、超时终止和 SSH 断线状态。
- 后台任务：`job_status`、`job_output`、`job_cancel`，并设置输出文件上限和会话退出清理策略。

保留 `terminal_send`，但只用于 `sudo` 密码提示、REPL、交互式安装器等确实需要 PTY 的场景。模型工具说明必须明确二者边界。

验收标准：执行 `true`、`false`、超时命令、stdout/stderr 混合命令和长输出命令时，Agent 都能得到确定且互不混淆的结构化结果。

### 4.2 分层权限与风险策略

将二元权限改为三个用户可理解的模式：

| 模式 | 默认行为 | 适用场景 |
|---|---|---|
| 只读/计划 | 只允许采集信息，禁止修改 | 排查、审计、先看方案 |
| 用户确认 | 低风险读取自动执行，变更和敏感读取确认 | 默认模式 |
| 本次任务授权 | 仅在当前运行内按规则自动执行，结束即失效 | 受控批处理 |

权限判定采用 `deny > ask > allow`，同时检查工具、解析后的命令、规范化路径、目标服务器、登录用户和服务器环境标签。审批提供“仅本次允许”“本次任务允许精确规则”“拒绝”，而不是持久化一个全局完全授权开关。

下列操作必须硬拒绝或始终单独确认，不能被宽泛规则覆盖：

- 块设备、文件系统和全盘破坏：`mkfs`、对设备执行 `dd`、不受限的递归删除。
- 关机、重启、关键服务停止、网络和防火墙规则修改。
- 用户、SSH、`sudoers`、cron、systemd unit 和认证材料修改。
- 写入 `/etc`、`/boot`、`/root/.ssh` 等受保护位置。
- `curl | sh`、远程脚本直接执行、动态 `eval`、fork bomb 等无法可靠预判的组合命令。
- 在生产标签服务器或 `root` 会话中启用任务级自动授权。

命令策略不能只做字符串前缀匹配。第一步至少应使用保守的 shell token/管道/重定向解析；无法可靠解析的表达式自动升级为确认。

### 4.3 远程 root 的服务器侧约束

远程执行的安全边界在服务器上，而不在 Windows 客户端：

- 默认推荐单独的非 root Agent 账号。
- 需要提权的动作使用明确的 `sudoers` 命令白名单和 `sudo -n`，避免让模型持有通用 root shell。
- 服务器记录 `production`、`staging`、`development` 标签；生产服务器使用更严格的不可覆盖策略。
- root 会话显示持续的高风险标识；任务级授权不得成为保存的默认值。
- 后续可提供容器、namespace 或受限 shell 运行配置，但不能宣称本地沙箱已经隔离远程命令。

### 4.4 循环保护和错误恢复

- 同一工具与相同参数连续出现 3 次时暂停并请求用户决定，借鉴 OpenCode 的重复调用保护。
- 每种工具有独立重试预算；超时、权限拒绝、连接断开、命令非零退出和协议错误使用不同错误类型。
- 模型收到结构化失败原因和建议动作，不能把截断文本误判成成功。
- 取消必须向正在运行的 SSH channel 或后台任务传播，而不只是停止下一次模型调用。

### 4.5 证据式完成

对修改系统状态的任务，最终答复前必须有验证步骤：

- 服务变更后检查 `systemctl is-active` 和关键日志。
- 配置修改后运行对应语法检查，再 reload/restart，再检查运行状态。
- 软件安装后检查版本和包管理器状态。
- 文件修改保留变更前摘要、差异或备份引用，并执行读取回验。

每个任务保存“目标声明、风险、执行证据、验收证据、停止原因”。这借鉴 work-buddy 的 claims/evidence/stop rules，但不引入完整 DAG 编排。

### 4.6 持久审计记录

每个运行写入结构化事件，至少记录：运行 ID、主机、用户、cwd、模型、步骤、工具、脱敏参数、审批决定、时间、耗时、退出码、输出摘要或文件引用、取消和最终原因。

审计默认不保存密码、API Key、私钥、完整环境变量和疑似 token。完整长输出写到有限额的本地文件，事件中只保留首尾预览、哈希和路径。用户可以恢复、导出和删除记录。

## 5. 紧随其后的增强

### 5.1 Linux 主机事实快照

连接后通过只读探针采集并带过期时间缓存：发行版、内核、架构、hostname、当前用户、init 系统、包管理器、SELinux/AppArmor、容器环境、磁盘、内存和常用命令可用性。模型据此选择 Debian、RHEL、Alpine 等正确命令，不依赖猜测。

### 5.2 文件工具

新增 `file_stat`、`file_read`、`file_search`、`file_write`、`file_patch`、上传和下载。所有路径先规范化，设置大小限制；写入使用临时文件加原子替换，审批展示 diff，敏感路径进入更高风险等级。

### 5.3 上下文和 MCP

- 长输出保留首尾并落盘，模型按引用读取后续片段，避免固定截断丢失真正错误。
- 压缩后保留任务清单、审批规则、主机身份、关键证据和未完成验证。
- MCP 在一次 Agent 运行内复用连接，提供启动超时、调用超时、健康状态、stderr 日志、断线重连和停止清理。
- MCP 工具按服务器和工具单独授权；工具注解只用于风险提示，不能替代本地策略。
- 工具较多时先搜索目录再按需加载 schema，避免把全部定义长期占用模型上下文。

### 5.4 Hooks 和 Skill v2

先支持确定性 Hooks：`SessionStart`、`PreToolUse`、`PostToolUse`、`ToolFailure`、`PreCompact`、`Stop`。Hooks 可以拒绝、升级审批、追加上下文和触发验证，但不能覆盖硬拒绝规则。

Skill v2 再增加：

- frontmatter 中的适用系统、允许工具、风险类别、是否允许模型自动调用。
- `SKILL.md` 只注入摘要，引用文档和脚本按需读取。
- 本地目录实时刷新、内容哈希、来源和信任状态。
- Skill 脚本也必须通过同一权限与审计管线，不能成为绕过策略的第二执行入口。

## 6. 后续 CLI 与 RESTful 命令入口

CLI、RESTful API 和桌面端必须只是同一个 Agent 应用服务的不同适配器，不能分别拼接提示词、直接启动 shell 或维护各自的权限逻辑。三种入口共用：

- 服务器 profile 与凭据引用。
- Agent 运行状态机、工具注册表、权限和风险引擎。
- `run_id`、`job_id`、事件格式、审批、取消、恢复和审计记录。
- 输出限额、secret 脱敏、并发限制和证据式完成规则。

建议统一任务状态为 `queued`、`running`、`waiting_approval`、`succeeded`、`failed` 和 `canceled`。事件格式必须带 schema 版本、单调递增序号和时间戳，使桌面端、CLI 和 API 客户端能从游标恢复，不因断线丢失关键状态。

### 6.1 CLI

第一阶段 CLI 面向脚本和 CI，同时保留人工控制能力。建议命令形态：

```text
myterm agent run --server <profile-id> --task <text> --output jsonl
myterm task status <run-id>
myterm task events <run-id>
myterm task approve <run-id> <approval-id>
myterm task cancel <run-id>
```

- 人类模式输出适合终端阅读；`--output jsonl` 逐行输出版本化事件，并让进程退出码反映最终任务状态。
- 非交互模式遇到审批时不能无限等待：可以退出为“等待审批”，也可以由显式策略预先授权；不得自动转成完全授权。
- 密码、API Key 和私钥不能出现在命令行参数中，只接受凭据引用、标准输入或系统凭据库。
- `Ctrl+C` 先请求任务取消并等待清理，重复中断才强制退出，同时保留可查询的最终状态。
- 默认只连接本机 Agent 服务；CLI 不直接打开第二条 SSH 执行路径。

### 6.2 RESTful API

REST 第一阶段保持小而完整，使用版本化资源接口：

```text
POST /v1/tasks
GET  /v1/tasks/{run_id}
GET  /v1/tasks/{run_id}/events
POST /v1/tasks/{run_id}/approvals/{approval_id}
POST /v1/tasks/{run_id}/cancel
```

事件流优先采用 SSE，并支持 `Last-Event-ID` 续传；控制动作保持普通 HTTP。若以后需要双向交互，再评估 WebSocket，不在第一阶段同时维护两种流协议。

- 默认只监听 loopback。允许远程访问时必须启用 TLS、身份认证、服务器 profile 白名单和角色权限。
- 创建任务支持幂等键，避免客户端重试造成重复命令；审批和取消也必须是幂等操作。
- API 只能引用服务端已保存的凭据，响应中永不返回 secret。
- 设置请求体、事件、输出、并发任务和速率上限；长输出通过受控下载资源获取。
- 审批包含过期时间、决策人和精确规则，服务重启后不能悄悄把未决审批当作允许。
- 所有调用进入与桌面端相同的审计链，记录调用方身份和入口类型。

CLI 和 REST 的实施应排在结构化执行、任务持久化、权限引擎和审计之后。否则会把当前 PTY 快照的不确定性放大成自动化接口风险。

验收时必须证明：同一个任务通过三个入口产生一致状态和事件；断线续传不会重复执行；无交互审批不会绕过策略；API 重试不会创建重复任务；所有取消都会传播到远程进程。

## 7. AI 面板需要展示的控制信息

下一版不需要复制代码 Agent 的聊天界面，应更贴近运维控制台：

- 顶部固定显示目标主机、环境标签、登录用户、当前目录和权限模式。
- 每个命令显示风险等级、解析出的影响对象、等待审批时间、执行耗时和退出码。
- stdout 与 stderr 分开，可看首尾预览并打开完整输出。
- 展示任务清单、当前步骤、重试原因、后台任务状态和验证状态。
- 审批卡展示将修改的主机、文件、服务或软件包，并提供精确的会话级允许规则。
- 最终状态区分：完成、完成但验证失败、用户取消、权限阻止、步骤上限和连接中断。

## 8. 测试门槛

下一迭代完成的最低验证集：

1. 单元测试覆盖命令解析、规则优先级、路径规范化、脱敏、重复调用检测和输出截断。
2. SSH 集成测试覆盖退出码、stderr、超时、取消、断线、长输出和后台进程回收。
3. 风险回归测试证明危险命令在 `root`、生产标签和任务级授权下仍会被阻止或单独确认。
4. 审计测试证明每次变更都能关联审批和验证证据，且日志不包含测试 secret。
5. UI 测试覆盖长命令、长路径、多步骤、审批、失败、取消和窄窗口，无重叠或不可见操作。
6. MCP 测试覆盖进程复用、崩溃重连、超时、超大输出和按工具权限。
7. CLI 与 REST 开发时增加跨入口契约测试、JSONL/SSE 断线续传、幂等创建、认证授权和取消传播测试。

## 9. 暂不纳入

- 通用多 Agent、Agent 团队和并发写操作。
- 任意任务 DAG 编排；只为确定的运维 runbook 保留结构化步骤。
- 自动长期记忆；不得把原始终端、密码或服务器机密自动沉淀为记忆。
- 云端 Skill 市场、远程 MCP 市场和自动安装第三方执行代码。
- 用另一个模型自动批准高风险远程操作。自动审查可以提供建议，但不能绕过硬规则。

当上述执行层稳定后，可以增加只读排查子 Agent，并要求它继承主任务权限、只返回摘要、禁止并发修改服务器。

## 10. 推荐实施顺序

```text
remote_exec + 进程句柄
  -> 权限/风险引擎
  -> 审批 UI 与服务器环境标签
  -> 取消、后台任务、重复调用保护
  -> 证据式验证与持久审计
  -> 统一任务协议与持久事件流
  -> CLI
  -> RESTful API
  -> 文件工具与主机事实快照
  -> MCP 长连接、上下文压缩、Hooks、Skill v2
  -> 受限只读子 Agent
```

这个顺序先解决“模型是否真的知道发生了什么”，再逐步扩大自治范围。任何新增工具都必须进入同一套权限、取消、审计和验证管线。

## 11. 官方与项目来源

- Codex：[GitHub 仓库](https://github.com/openai/codex)、[沙箱](https://learn.chatgpt.com/docs/sandboxing)、[审批与安全](https://learn.chatgpt.com/docs/agent-approvals-security)、[Hooks](https://learn.chatgpt.com/docs/hooks)、[非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)、[子 Agent](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- Claude Code：[公共仓库](https://github.com/anthropics/claude-code)、[权限模式](https://code.claude.com/docs/en/permission-modes)、[工作原理与检查点](https://code.claude.com/docs/en/how-claude-code-works)、[Hooks](https://code.claude.com/docs/en/hooks-guide)、[扩展能力](https://code.claude.com/docs/en/features-overview)
- OpenCode：[当前仓库](https://github.com/anomalyco/opencode)、[Agent 与权限](https://opencode.ai/docs/agents/)、[V2 权限](https://opencode.ai/v2/docs/permissions)、[V2 shell 安全边界](https://github.com/anomalyco/opencode/blob/dev/specs/v2/session.md)、[Skill](https://opencode.ai/docs/skills)
- work-buddy：[开源仓库](https://github.com/KadenMc/work-buddy)
- 腾讯 WorkBuddy Bench：[评测仓库](https://github.com/Tencent/workbuddy-bench)

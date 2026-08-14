# myterm Linux Agent 改进研究

> 研究日期：2026-08-09
> 范围：对照 Codex、Claude Code、OpenCode、work-buddy 和成熟基础设施工具，评估 `myterm` 面向 Linux 服务器运维时的改进，并研究远端 CLI/REST、多 SSH 协同与 Skill 驱动 OS 安装。本文同时记录已实施结论和后续设计，具体状态以各节说明为准。

实施文档：[`linux-agent-development-plan.md`](linux-agent-development-plan.md) 和 [`linux-agent-specification.md`](linux-agent-specification.md)。研究报告解释“为什么”，实施时以说明书的正式契约为准。

## 1. 结论

`myterm` 下一阶段最重要的工作不是增加多 Agent，而是把已经可验证、可中止、可审计的单主机执行层扩展为显式多目标协同，并为 OS 安装增加独立于目标 OS 的 provisioning 控制面。

当前 `0.7.0` 已具备插件化 Agent 内核，以及持久 Task、结构化 `remote_exec`、后台 Job、权限策略、证据、审计、文件工具、Skill、stdio MCP、Hooks 和可观察时间线。PTY 只保留给交互式命令，普通命令已经能够返回退出码、标准错误、超时、取消和完成边界。

对于远程 Linux，尤其是 `root` 会话，本地应用沙箱不能限制已经通过 SSH 发到服务器的命令。真正有效的防线必须同时覆盖：应用侧权限策略、命令语义分析、服务器侧最小权限账号、受限 `sudo` 和完整审计。OS 安装进一步要求 Redfish/BMC、MAAS、虚拟化或云 API 等独立控制面；SSH 不能跨越系统盘重装继续充当主控制链路。

## 2. 对照来源与边界

| 项目 | 可核验来源 | 值得借鉴 | 不能直接照搬 |
|---|---|---|---|
| Codex | `openai/codex`，Apache-2.0 | 沙箱与审批分层、结构化进程执行、事件流、Hooks、上下文压缩、受限并行子 Agent | 面向本地代码工作区的沙箱不能保护远程 SSH 主机 |
| Claude Code | `anthropics/claude-code` 公共仓库与官方文档 | Plan/默认/自动等权限模式、受保护路径、root 禁止跳过权限、检查点、Hooks、后台任务、Skill 渐进加载 | 公共仓库包含插件和发布资料，但不是完整 Agent 核心源码；远程副作用也无法靠文件检查点撤销 |
| OpenCode | 当前仓库 `anomalyco/opencode`，MIT | 细粒度 allow/ask/deny、会话级“始终允许”、重复调用保护、自动压缩、按需 Skill | 官方设计明确说明 shell 并未被沙箱隔离，外部路径扫描只是提示，不是安全边界 |
| work-buddy | `KadenMc/work-buddy`，GPL-3.0，预发布 | 少量网关工具加动态发现、确定性步骤与模型判断分离、持久任务状态、证据计划和停止规则、长任务 supervisor | 它偏个人知识工作且包含复杂编排，不适合直接纳入 myterm 第一阶段 |

名称需要特别说明：腾讯公开的是 `Tencent/workbuddy-bench` 评测项目，不是可确认的 WorkBuddy Agent 核心实现。本文提到的开源 `work-buddy` 指 `KadenMc/work-buddy`，二者不是同一个项目。

## 3. myterm 当前基线

基于 `0.7.0` 当前代码和验收记录：

- Agent Task、Event、Approval、Audit 和 Artifact 已持久化，模型循环、取消和崩溃恢复有明确终态。
- `remote_exec` 通过独立 SSH exec channel 返回 stdout、stderr、exit code、timeout、cancel 和 disconnect；`terminal_send` 仅用于 PTY 交互。
- tree-sitter Bash 策略、三级权限、生产/root 升级、hard deny 和预持久化脱敏已经实施。
- 主机事实、远端文件原子写入、后台 Job、Skill v2、stdio MCP、Hooks 和上下文压缩已经交付。
- AI 面板展示工具、目标摘要、审批、输出、耗时和验证状态；原生 headless 内核保持轻量。
- 仍是单主要目标模型：工具调用没有统一的 `target_alias`，不能可靠表达 A 操作、B 观察和跨主机门控。
- 当前远端 REST 只能由模型通过 `remote_exec` 运行 `curl` 等 CLI；凭据注入、网络执行来源、状态码和幂等语义尚未结构化。
- 当前没有独立 provisioning 状态机和 provider adapter，不能安全宣称支持系统盘安装或重装。

因此下一阶段应复用现有内核，增加多目标、远端 HTTP 和 provisioning 三个纵向能力，而不是重写 Agent 或引入通用编排平台。

## 4. 已实施的执行层结论

本节是 `0.6.0` 之前形成并已在 `0.6.0` 交付的设计依据，保留用于解释当前实现为什么采用结构化 SSH、统一权限和证据式完成。

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

## 5. 已实施的扩展层结论

本节能力已经在 `0.6.0` 交付。后续多 SSH 和 OS 安装必须复用这些边界，不创建旁路。

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

## 6. 远端 CLI 与 REST 的正确定位

CLI 是 SSH 目标上的运维命令，REST 是从明确 SSH 目标发出的 HTTP 请求。二者必须复用 `remote_exec`、凭据库、权限、取消、审计和证据管线，不是 myterm 自身的对外入口。

远端 REST 有两个选择：

| 选择 | 优点 | 缺点 | 建议 |
|---|---|---|---|
| 远端 `curl`/`httpie` | 兼容已有 runbook，表达能力完整 | secret、重试、状态码和输出难结构化 | 保留为通用 CLI 路径 |
| `remote_http_request` | 网络来源、凭据、HTTP 语义和脱敏可控 | 需要远端 helper，不能覆盖全部 curl 功能 | 作为 Agent 首选工具 |

HTTP 结果必须记录 `execution_origin=remote:<target_alias>`。第一版不让模型从 Windows 本机发请求，避免测试结果与服务器真实网络路径不同。

`0.6.3` 已删除早期误解下形成的本机 Agent CLI/loopback REST。优点是产品边界更清晰，减少协议、安全、依赖和测试维护面；缺点是旧的本机脚本调用不再兼容。项目当前没有已知的外部调用者，因此选择收敛到桌面入口。

## 7. 多 SSH 协同

多 SSH 由一个 Task 绑定多个保存的 profile，每次工具调用显式声明 `target_alias`。执行器需要每目标连接池、写锁和事件归属；模型可以按顺序在 A 变更，再使用 B 的 HTTP/CLI 探针观察，只有类型化条件连续满足后才继续。

第一版只增加显式目标、`remote_http_request` 和 `wait_condition`，不引入通用 DAG。只读探针可有界并发，副作用默认串行；并行写必须列出全部目标并单独审批。该设计借鉴 Ansible 的 [`serial`/`throttle`](https://docs.ansible.com/projects/ansible-core/2.17/playbook_guide/playbooks_strategies.html)、[委派](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_delegation.html)和[`wait_for`](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/wait_for_module.html)，但保持 myterm 单 Agent 和轻量内核边界。

## 8. Skill 驱动 OS 安装调研

OS 安装可行，但系统盘重装时旧 SSH 通道消失，必须使用目标 OS 之外的控制面。Skill 适合承载安装手册、模板、校验器和 provider 选择规则；开放 [Agent Skills 规范](https://agentskills.io/specification)并不定义破坏性执行权限，所以 Skill 只能调用 myterm 的类型化 provisioning 工具，不能直接运行写盘脚本。

方案优缺点：

| 方案 | 优点 | 缺点 |
|---|---|---|
| SSH 内安装脚本 | 最少新代码 | SSH 会随重装消失，无法可靠控制空白机和失败恢复，不采用 |
| Redfish + PXE/iPXE | 独立于 OS，控制直接 | 厂商差异、网络和镜像基础设施复杂 |
| MAAS adapter | 提供 BMC、commission、PXE、curtin、cloud-init 和状态链 | 需要单独部署和维护 MAAS |
| 虚拟化/云 adapter | API、状态、快照和回滚较结构化 | 每个平台需要独立适配 |

推荐先在隔离 VM 上实现 Ubuntu Autoinstall Skill，再接入 MAAS 管理物理机，最后按需提供认证型号的直接 Redfish adapter 和云 provider。完整状态机、审批、身份重建、测试和来源见[`multi-ssh-os-installation-plan.md`](multi-ssh-os-installation-plan.md)。

## 9. AI 面板新增控制信息

- 顶部展示 Task 的全部目标、alias、环境、用户、连接和写锁状态。
- 每个工具步骤显示执行目标和 execution origin，不能只显示命令。
- `wait_condition` 显示观察主机、被观察对象、最近结果、连续成功次数和剩余时间。
- OS 安装显示 plan hash、硬件身份、系统盘/保留盘、镜像 digest、provider、审批阶段和恢复状态。
- SSH 预期中断与异常断线使用不同状态；安装期间以控制面事件为主。
- 最终答复按目标聚合执行证据、观察证据、验证结果和未恢复风险。

## 10. 新增测试门槛

1. 多目标测试覆盖 alias 解析、焦点切换、profile 编辑、逐目标断线、写锁和有界并发。
2. A/B 集成测试覆盖 A 变更、B 观察、连续成功、超时停止、回滚门控和证据归属。
3. HTTP 测试覆盖远端网络来源、TLS、状态码、截断、secret 脱敏、非幂等重试和取消。
4. provisioning fake adapter 覆盖全部状态、崩溃恢复、审批 hash 失效和 destructive phase 后的取消语义。
5. Ubuntu VM 安装覆盖正常安装、镜像错误、网络失败、磁盘身份不匹配、引导失败和 SSH host key 重建。
6. 性能测试证明未使用多 SSH/provisioning 时没有常驻 provider 连接、轮询线程或显著体积回归。

## 11. 暂不纳入

- 通用多 Agent、Agent 团队和任意 DAG 编排。
- 生产物理机无人审批重装、任意并行写和自动批量重装。
- 通过 `dd`、`curl | sh` 或交互 PTY 直接重装系统。
- 在 myterm 内自建 DHCP/PXE/镜像仓库或静态打入全部 provider SDK。
- 自动长期记忆、云端 Skill 市场和自动安装未知第三方执行代码。
- 用另一个模型自动批准高风险操作。

## 12. 推荐实施顺序

```text
显式多目标 Task + 每目标连接/锁/事件
  -> remote_http_request + wait_condition
  -> A 操作 / B 观察的协同 UI 与集成测试
  -> provisioning plan + fake adapter + 两阶段审批
  -> Ubuntu VM Autoinstall Skill
  -> MAAS 或 Redfish 物理机 adapter
  -> RHEL / Windows / cloud provider 按需扩展
```

## 13. 官方与项目来源

- Agent 参考：Codex [GitHub 仓库](https://github.com/openai/codex)、Claude Code [公共仓库](https://github.com/anthropics/claude-code)、OpenCode [仓库](https://github.com/anomalyco/opencode)、work-buddy [仓库](https://github.com/KadenMc/work-buddy)
- Skill：[Agent Skills 规范](https://agentskills.io/specification)
- 多主机行为：Ansible [执行策略](https://docs.ansible.com/projects/ansible-core/2.17/playbook_guide/playbooks_strategies.html)、[任务委派](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_delegation.html)、[`wait_for`](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/wait_for_module.html)
- 物理机控制面：DMTF [Redfish 规范](https://redfish.dmtf.org/schemas/v1/DSP0266_1.14.0.pdf)、[iPXE 文档](https://ipxe.org/docs)、Canonical [MAAS 部署](https://canonical.com/maas/docs/latest/explanation/deploying-machines/)
- 自动安装：Ubuntu [Autoinstall](https://canonical-subiquity.readthedocs-hosted.com/en/latest/reference/autoinstall-reference.html)、Red Hat [Kickstart](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html-single/automatically_installing_rhel/index)、Microsoft [Windows Setup 自动化](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/automate-windows-setup?view=windows-11)

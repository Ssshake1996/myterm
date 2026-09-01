# DeepSeek Harness 集成说明

> 更新日期：2026-09-01。本文描述 myterm 当前唯一 Agent 运行时；旧的 `dsh-codex-agent`/裁剪 Codex Core 已从生产代码和构建链路删除。

## 结论

myterm 通过标准 ACP 启动官方 DeepSeek Harness sidecar。Harness 负责 Agent Loop、持久会话、Goal、上下文压缩、本地 Shell/文件工具和 Skill；myterm 继续拥有 SSH、交互式 CLI、SFTP、保存服务器、多 SSH 协同、外部 MCP 连接、权限和审计。

工具没有被裁掉，而是分成两个边界清晰的工具包：

| 工具层 | 运行位置 | 主要能力 |
|---|---|---|
| Harness Local Tools | 本机 sidecar | PowerShell/Bash、本地文件读取、搜索、编辑、Goal、Skill |
| myterm Host MCP | Tauri 主进程 | SSH/CLI/SFTP、服务器目录、会话连接、多 SSH、后台 Job、外部 MCP Capability |

模型看到 `myterm-host-tools` MCP。所有远程操作仍进入 myterm 原有的目标选择、权限、审批、取消、错误保真和审计管线，不允许 Harness 私自创建第二套 SSH 栈。

## 运行流程

```text
React Agent 面板
  -> Tauri AgentService / Goal / 审计
  -> ACP v1（NDJSON/stdin/stdout）
  -> 官方 DeepSeek Harness
       -> Harness 本地工具（只操作本机）
       -> myterm-host-tools（127.0.0.1 随机端口、随机路径、Bearer）
            -> SSH / CLI / SFTP / 多 SSH
            -> myterm 外部 MCP CapabilityProvider
```

每次运行只在回环地址启动一个临时 Streamable HTTP MCP 服务，使用随机 URL 路径和随机 Bearer Token。任务结束或取消后服务关闭。外部 MCP 仍由 myterm 预连接和发现，因此单个外部服务器失败不会让整个 Harness 会话无法创建，`mcp_status` 也能返回原始连接/发现错误。

## 会话、长任务与运行中追加要求

- Conversation 对应一个持久 Harness ACP Session；session id 按 Conversation 保存，应用重启后使用 `session/resume`。
- 普通任务和长任务使用同一入口。Harness Goal、checkpoint、compaction 和持久会话负责继续工作，不保留旧 Core 的 64 Step 整体任务上限。
- ACP v1 当前没有真正的 mid-turn steering。界面的“响应后继续”会把输入送入当前运行队列，在本次模型响应结束后立即发起下一次 ACP prompt；“排队执行”则进入 myterm Goal 的持久输入队列。
- 停止会发送 ACP `session/cancel`，随后回收 sidecar 和临时 Host MCP。

## 模型与系统 Prompt

前端 AI 配置仍保存为 myterm JSON，API Key 只从凭据库读取。每条模型路由在启动时转换为官方 `dsh-llm-deepseek` 配置，并固定交给 `deepseek-official` 路由；myterm 只注入 `apiKeyEnv`、精确 Base URL、推理强度和模型列表，认证由原生 Provider 以 Bearer 方式处理。主模型失败时由 myterm 按已配置的备用模型和备用 DeepSeek 服务启动下一条 Harness 路由。

AI 配置 schema 为 v6，只保留原生 Provider 所需字段。开发阶段不迁移旧兼容 Provider 配置；首次打开 v6 时旧 AI 服务会被清空，用户需要重新保存 DeepSeek 服务，服务器、环境、快捷命令、Skill、MCP 和系统凭据不受影响。

系统 Prompt 真实进入模型上下文：Rust 把内置 myterm Agent 契约与用户配置的附加 System Prompt 合并到 `MYTERM_HARNESS_SYSTEM_PROMPT`，官方 `dsh-system-prompt` 插件通过 `persona` 字段注入。运行时检查和 Rust 单元测试会验证该注入链路存在。

## MCP 与工具结果

官方 ACP MCP 客户端当前只消费 Tools。myterm 因此把外部 MCP 的 Tools 直接投影为 Host MCP 工具，同时把 Resources/Prompts 包装为 `capability_resource_*` 和 `capability_prompt_*` 工具。模型可以先用 `mcp_status`/`capability_search` 查看能力，再使用精确 Capability ID 调用。

终端和后台输出仍由 myterm 的分页/Artifact 机制控制；`terminal_context`、`job_output` 等工具可以使用 offset 连续读取，不设“最近 N 行”的模型层固定限制。Harness 会话在上下文压力下使用官方 compaction 和 tool-result pruner，避免把历史查询噪声反复发送给模型；当前决策需要的结构化结果和精确错误必须在压缩前完成解析或通过 myterm 分页工具重新读取。

## 权限

- 只读：Harness 本地沙箱为只读，myterm 远程写操作拒绝。
- 用户确认：Harness 本地高风险操作通过 ACP 请求确认；远程工具由 myterm 策略请求确认。
- 完全授权：本地和远程普通操作不逐次确认，但 myterm hard deny 仍优先。

MCP 工具本身不依赖 Harness 本地 Shell 提权，因此远程工具只经过 myterm 的一次权威审批，不把一次操作拆成两次确认。

## 官方更新同步

版本由 `integrations/deepseek-harness-runtime/package.json`、`package-lock.json` 和 `harness.lock.json` 三处固定。升级步骤：

1. 把所有 `@deepseek-ai/dsh-*` 依赖升级到同一官方版本。
2. 更新 lock 文件中的 Harness/ACP 版本并运行 `npm install --package-lock-only`。
3. 执行 `npm run test:harness-runtime` 和 `npm run audit:harness-runtime`。
4. 执行 Rust/前端测试和 `npm run build:release`，确认安装包内包含 launcher、profile、node_modules 和私有 Node runtime。

这种方式的优点是 Agent 内核、Goal、压缩、本地工具和 Skill 可以跟随官方包升级，myterm 只维护 ACP/Host MCP 边界。缺点是官方 Harness 仍处于 Developer Preview，升级可能需要调整 profile 或 ACP 映射；安装包还需要携带 Node，当前未压缩运行时约 236 MiB。相比继续维护一份裁剪 Core，这个体积代价换取了更低的长期分叉维护成本。

## 构建与验证

```powershell
cd F:\myterm
npm run test:harness-runtime
npm run audit:harness-runtime
npm run prepare:harness-runtime
npm run typecheck
npm test -- --pool=threads --poolOptions.threads.singleThread
npm run lint
cd src-tauri
cargo fmt --all -- --check
cargo check -j 1
cargo test -j 1
cd ..
npm run build:release
npm run check:dist
```

`prepare:harness-runtime.ps1` 使用 `package-lock.json` 的 SHA-256 判断是否需要重新执行 `npm ci`，再把官方依赖、ACP launcher/profile 和当前 Node 运行时复制到 Tauri resources。安装版不依赖用户机器预装 Node。

# 03 开发计划

按里程碑顺序执行,每个里程碑对应 `prompts/` 里的一条 AI 指令。**前一个里程碑验收通过并提交后,才开始下一个。**

## 里程碑总览

```
M0 脚手架 ──┬─→ M1 Provider ──┐
            ├─→ M2 工具层 ──→ M3 权限 ──┤
            └─→ M4 会话存储 ────────────┴─→ M5 Agent 循环 ─→ M6 CLI(MVP ✅)─→ M7 TUI
```

M1、M2、M4 三者互不依赖,如果你并行开多个 AI 会话,可以同时做。

## 各里程碑明细

### M0 工程脚手架(prompts/01-scaffold.md)

- 产出:Bun + TypeScript strict + Biome + `bun test` 的空工程,`src/types.ts` 按架构文档逐字落地,目录骨架就位。
- 验收:`bun install && bun run typecheck && bun run lint && bun test` 全部通过(允许 0 个测试)。

### M1 Provider 层(prompts/02-provider.md)

- 产出:`Provider` 接口的 Anthropic 实现,流式 + tool use + 重试。
- 验收:`bun test test/provider` 通过(mock 测试);设置 `ANTHROPIC_API_KEY` 后 `bun run scripts/smoke-provider.ts` 能流式打印一段回复。

### M2 工具层(prompts/03-tools.md)

- 产出:6 个工具(read/write/edit/bash/grep/glob)+ 工具注册表。
- 验收:`bun test test/tool` 通过(每个工具 ≥ 5 个用例,含路径逃逸、超时、错误分支)。

### M3 权限系统(prompts/04-permissions.md)

- 产出:`PermissionGate` 三种模式实现 + 终端确认交互。
- 验收:`bun test test/permission` 通过。

### M4 会话持久化(prompts/05-session.md)

- 产出:JSON 文件版 `SessionStore`,存于 `~/.mycode/sessions/`。
- 验收:`bun test test/session` 通过(含损坏文件、并发追加用例)。

### M5 Agent 核心循环(prompts/06-agent-loop.md)

- 产出:`Agent` 实现,串起 M1–M4;上下文截断;中断处理。
- 验收:`bun test test/agent` 通过 —— 全部用 **FakeProvider(脚本化的假 LLM)** 驱动,不打真实 API。

### M6 CLI REPL(prompts/07-cli.md)— MVP 完成线

- 产出:`mycode` 可执行入口:参数解析、REPL、流式渲染、Ctrl+C、`-p` 非交互模式。
- 验收:
  1. `bun test` 全绿;
  2. **端到端人工验收**:在一个真实小仓库里跑通产品规格 U1–U8 全部用户故事;
  3. **端到端自动验收**:`mycode --yolo -p "创建 hello.txt,内容为 hi"` 在临时目录中执行后文件存在且内容正确。

### M7 TUI(prompts/08-tui.md)— MVP 之后

- 产出:全屏终端界面(消息流、diff 高亮、状态栏)。
- 验收:功能与 REPL 等价,U1–U8 在 TUI 下复验通过。

## 执行纪律(每个里程碑都适用)

1. **一个里程碑 = 一个分支 = 一个 PR**,commit 信息用 `feat(module): ...` 格式。
2. AI 产出后,你(或另一个 AI 会话)按此清单 review:
   - 是否逐字遵守了 `02-architecture.md` 的接口?
   - 是否引入了未登记的依赖?
   - 工具实现里有没有 throw(违反错误处理约定)?
   - 测试是不是真的在测行为,而不是测实现细节?
3. 验收命令跑不过,把**完整报错原文**贴回给 AI 修,不要自己瞎猜着改。
4. 中途发现接口设计有问题:停下 → 改 `02-architecture.md` → 让 AI 按新接口重构 → 再继续。

## 风险与预案

| 风险 | 预案 |
|---|---|
| Anthropic SDK 的流式事件格式与预期不符 | M1 的 smoke 脚本尽早跑真实 API 验证,发现偏差立即修 provider 的适配层,`StreamEvent` 接口不动 |
| AI 在 M5 写出与截断策略冲突的历史管理 | M5 测试里专门有「截断后 tool_call/tool_result 配对完整性」用例把关 |
| bash 工具安全隐患 | confirm 模式默认拦截 + 30s 超时 + 输出截断,MVP 不做沙箱,`--yolo` 风险自负并在 README 声明 |
| token 估算(÷4)偏差大导致超窗报错 | provider 捕获超窗错误后返回明确报错,agent 收到后强制多截一轮重试一次 |

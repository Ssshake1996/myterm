# M7 任务指令:TUI(MVP 之后的第一个增强)

> 前提:M6 已验收,MVP 在 REPL 形态下完全可用。本任务是渐进增强,**REPL 模式必须保留**(`--no-tui` 回退)。

## 需要附上的上下文

- `01-product-spec.md`、`02-architecture.md`
- `src/cli/`(现有入口与 REPL)、`src/agent/loop.ts`(AgentEvent 定义)

## 依赖变更(先在 02-architecture.md 登记再动手)

- 新增依赖:`ink`(React 式终端 UI)+ `react`。这是本项目第一次为 UI 破例引依赖,登记进架构文档的依赖表。

## 任务

把交互界面升级为全屏 TUI,功能与 REPL 等价(用户故事 U1–U8 全部在 TUI 下成立)。

## 界面规格

```
┌─ mycode ─ claude-sonnet-4-5 ─ confirm ────────────┐
│  (消息流,可上下滚动)                              │
│  > user 消息                                       │
│  assistant 流式文本(markdown 粗渲染:代码块高亮)  │
│  ⏺ bash: $ bun test          ✓                    │
│  ⏺ write_file: src/x.ts      (展开显示 diff)      │
├────────────────────────────────────────────────────┤
│ 输入框(多行,Enter 发送,Shift+Enter 换行)         │
└─ tokens: in 1.2k out 300 ─ Ctrl+C interrupt ──────┘
```

- **消息流区**:渲染 AgentEvent;工具卡片默认折叠(一行),光标选中后 Enter 展开完整输出/diff;diff 以 +绿/-红 着色。
- **权限确认**:实现一个 Ink 版 `Prompter`(替换 terminal-prompter):弹出内联确认卡片,y/n/a 键选择,diff 全文可滚动查看。
- **状态栏**:模型、权限模式、会话累计 token、当前状态(idle / thinking / running tool)。
- **按键**:Ctrl+C 中断当前运行(空闲时提示退出方式),Ctrl+D 或 `/exit` 退出,PgUp/PgDn 滚动历史。

## 交付物

1. `src/tui/app.tsx` 及子组件(MessageList、ToolCard、InputBox、StatusBar、ConfirmDialog)
2. `src/tui/prompter.ts`(Ink 版 Prompter)
3. `src/cli/main.ts` 改造:默认进 TUI,`--no-tui` 或 `!process.stdout.isTTY` 时回退 REPL
4. 测试:组件用 `ink-testing-library` 做渲染断言(事件流 → 帧输出);核心交互(确认对话框的 y/n/a)必须有测试

## 架构约束(重申)

- TUI 只消费 `AgentEvent` 与调用 `Agent.run`,**不得**直接 import provider/tool/session 的实现——如果发现做不到,说明 agent 的事件接口缺东西,回头先改 `02-architecture.md`。
- 业务逻辑零改动:本任务理论上不触碰 `src/agent|provider|tool|session|permission` 下的任何文件(新增 Prompter 实现除外)。

## 验收

1. `bun run typecheck && bun run lint && bun test` 全绿
2. 人工在 TUI 下复验 U1–U8
3. `mycode --no-tui` 行为与 M6 完全一致

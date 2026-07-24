# 02 架构设计(单一事实来源)

本文档定义 mycode 的技术栈、模块边界和**全部跨模块接口**。任何模块的实现与本文档冲突时,以本文档为准;要改接口,先改这里。

## 技术栈

| 项 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript(strict 模式) | 类型即接口契约,AI 生成代码的错误能被编译器拦截 |
| 运行时 | Bun ≥ 1.1 | 自带测试框架/打包器,启动快,opencode 同款 |
| 测试 | `bun test` | 零配置 |
| Lint/格式化 | Biome | 单工具搞定 lint + format |
| LLM SDK | `@anthropic-ai/sdk` | 官方 SDK,流式 + tool use 支持完善 |
| 依赖原则 | 除上述外**不引入任何依赖**,需要新依赖必须先在本文档登记 | 控制 AI 乱装包 |

## 目录结构

```
mycode/
├── src/
│   ├── types.ts            # 本文档「核心类型」一节的全部类型(逐字一致)
│   ├── provider/
│   │   ├── provider.ts     # Provider 接口 + 注册表
│   │   └── anthropic.ts    # Anthropic 实现
│   ├── tool/
│   │   ├── tool.ts         # Tool 接口 + 工具注册表
│   │   ├── read.ts / write.ts / edit.ts / bash.ts / grep.ts / glob.ts
│   ├── permission/
│   │   └── permission.ts   # PermissionGate
│   ├── session/
│   │   └── store.ts        # SessionStore(JSON 文件实现)
│   ├── agent/
│   │   └── loop.ts         # Agent 核心循环
│   ├── cli/
│   │   ├── main.ts         # 入口:参数解析、装配依赖
│   │   └── repl.ts         # REPL 交互
│   └── config.ts           # 配置解析(argv/env/默认值)
├── test/                   # 与 src/ 镜像的测试目录
├── package.json
├── tsconfig.json
└── biome.json
```

**依赖方向(只允许从下往上引用):**

```
cli → agent → { provider, tool, permission, session } → types
```

`provider`、`tool`、`permission`、`session` 四个模块相互之间**不得 import**,它们只依赖 `types.ts`。装配(把它们连起来)只发生在 `cli/main.ts` 和 `agent/loop.ts`。

## 核心类型(`src/types.ts`,逐字实现)

```typescript
// ── 消息 ────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ToolCallPart {
  type: "tool_call";
  id: string;                          // provider 返回的调用 id
  name: string;                        // 工具名
  arguments: Record<string, unknown>;  // 已解析的 JSON 参数
}

export interface ToolResultPart {
  type: "tool_result";
  toolCallId: string;                  // 对应 ToolCallPart.id
  content: string;                     // 工具输出(纯文本)
  isError: boolean;
}

export type Part = TextPart | ToolCallPart | ToolResultPart;

export interface Message {
  role: MessageRole;
  parts: Part[];
}

// ── Provider ────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema(object 类型),直接透传给 LLM API */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  maxTokens: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens";

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "done"; stopReason: StopReason; usage: Usage };
// 错误不作为事件:provider 在流中遇到不可恢复错误时直接 throw

export interface Provider {
  id: string;
  chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

// ── 工具 ────────────────────────────────────────────────

export type PermissionLevel = "read" | "write" | "execute";

export interface ToolContext {
  /** 仓库根目录的绝对路径,所有相对路径基于它解析 */
  cwd: string;
  signal: AbortSignal;
}

export interface ToolResult {
  content: string;
  isError: boolean;
}

export interface Tool {
  definition: ToolDefinition;
  permissionLevel: PermissionLevel;
  /**
   * 面向用户的操作描述,用于确认提示。
   * 例如 write_file 返回将写入的 diff,bash 返回将执行的命令。
   */
  describe(args: Record<string, unknown>): string;
  /** 实现内部禁止 throw:任何失败都返回 { isError: true } */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// ── 权限 ────────────────────────────────────────────────

export type PermissionMode = "confirm" | "readonly" | "yolo";

export type PermissionDecision = "allow" | "deny";

export interface PermissionGate {
  mode: PermissionMode;
  /** description 来自 Tool.describe(args) */
  check(tool: Tool, description: string): Promise<PermissionDecision>;
}

// ── 会话 ────────────────────────────────────────────────

export interface SessionMeta {
  id: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;
  title: string;       // 取首条用户消息前 50 字符
  totalUsage: Usage;
}

export interface Session extends SessionMeta {
  messages: Message[];
}

export interface SessionStore {
  create(): Promise<Session>;
  get(id: string): Promise<Session | null>;
  /** 返回按 updatedAt 倒序的元信息列表 */
  list(): Promise<SessionMeta[]>;
  appendMessage(id: string, message: Message): Promise<void>;
  addUsage(id: string, usage: Usage): Promise<void>;
}

// ── Agent ───────────────────────────────────────────────

/** Agent 在执行过程中向外发出的事件,UI 层消费 */
export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string; description: string }
  | { type: "tool_end"; name: string; result: ToolResult }
  | { type: "tool_denied"; name: string }
  | { type: "turn_end"; usage: Usage };

export interface Agent {
  /**
   * 处理一条用户输入,驱动「LLM → 工具 → LLM」循环直到模型停止。
   * 消息的持久化由 Agent 内部完成。
   */
  run(userInput: string, signal: AbortSignal): AsyncIterable<AgentEvent>;
}
```

## Agent 循环(核心算法,伪代码)

```
run(userInput, signal):
  append user Message 到 session
  loop (最多 50 轮,防失控):
    history = truncate(session.messages)          # 见下方截断策略
    stream = provider.chat({system, history, tools}, signal)
    assistantParts = []
    收集 stream:
      text_delta   → yield {text_delta};累积到当前 TextPart
      tool_call    → 记录到 assistantParts
      done         → 记录 stopReason;session.addUsage;yield {turn_end}
    append assistant Message(assistantParts) 到 session
    if stopReason != "tool_use": return           # 模型说完了,结束

    toolResultParts = []
    for call in assistantParts 中的 ToolCallPart:
      tool = registry[call.name]                  # 未知工具 → isError 结果,不 throw
      desc = tool.describe(call.arguments)
      if permissionGate.check(tool, desc) == "deny":
        yield {tool_denied}
        result = { content: "User denied this operation.", isError: true }
      else:
        yield {tool_start}
        result = tool.execute(call.arguments, {cwd, signal})
        yield {tool_end}
      toolResultParts.push(ToolResultPart(result))
    append tool Message(toolResultParts) 到 session
    # 回到 loop 顶部,把工具结果喂回模型
```

**截断策略(MVP)**:估算 token(字符数 ÷ 4)。若超过模型窗口的 80%,从最旧的消息开始成对丢弃(user + 其后的 assistant/tool 消息),但永远保留第一条 user 消息和最近 6 条消息。丢弃处插入一条 user 消息:`"[Earlier conversation truncated]"`。注意不得把 tool 消息与其对应的 assistant(含 tool_call)消息拆开,必须整组丢弃。

## System Prompt(MVP 版,放在 `agent/loop.ts` 顶部常量)

```
You are mycode, an AI coding assistant operating in the user's repository.

Working directory: {cwd}

Rules:
- Use the provided tools to read, search, and modify files. Never guess file contents — read them first.
- Prefer minimal, focused changes. Do not refactor beyond the user's request.
- After making changes, verify them when possible (e.g. run relevant commands via bash).
- All file paths must be relative to the working directory.
- Reply in the language the user writes in.
```

## 错误处理约定

| 层 | 约定 |
|---|---|
| Provider | 网络/限流错误在内部指数退避重试 3 次(1s/2s/4s);仍失败则 throw,由 REPL 捕获并打印,进程不退出 |
| Tool | **绝不 throw**,一切失败(文件不存在、命令非零退出、超时)都返回 `{ isError: true, content: 错误说明 }`,交给模型自己纠错 |
| Agent | 捕获 provider 的 throw 后向上抛;AbortSignal 触发时立刻停止并保证 session 处于一致状态(不留悬空的 tool_call) |
| CLI | 顶层 catch 所有异常,打印错误,回到提示符 |

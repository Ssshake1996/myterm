# M5 任务指令:Agent 核心循环

## 需要附上的上下文

- `02-architecture.md` 全文(重点:**Agent 循环伪代码、截断策略、System Prompt、错误处理约定**)
- `src/types.ts`
- `src/provider/provider.ts`、`src/tool/tool.ts`、`src/permission/permission.ts`、`src/session/store.ts`(接口签名)

## 任务

实现 `Agent`:整个系统的心脏。把 provider、工具注册表、权限门、会话存储组装成「LLM → 工具 → LLM」的循环。**严格按架构文档中的伪代码实现**,本指令只补充细节。

## 交付物

### 1. `src/agent/loop.ts`

- ```typescript
  export interface AgentOptions {
    provider: Provider;
    tools: Map<string, Tool>;
    permissionGate: PermissionGate;
    sessionStore: SessionStore;
    sessionId: string;
    model: string;
    cwd: string;
    maxTokens?: number;        // 默认 8192(响应上限)
    contextWindow?: number;    // 默认 200000(截断阈值基数)
  }
  export function createAgent(options: AgentOptions): Agent
  ```
- 实现细节补充(伪代码之外):
  - **System prompt**:用架构文档中的模板,`{cwd}` 替换为实际路径。
  - **工具定义下发**:每次 chat 请求把注册表内全部工具的 `definition` 传给 provider。
  - **未知工具名**(模型幻觉出不存在的工具):不 throw,生成 `{ isError: true, content: "unknown tool: X" }` 的 ToolResultPart 回传,让模型自己纠正。
  - **参数校验**:调用工具前不做 JSON Schema 校验(MVP 简化),工具自身对缺参返回 isError 即可。
  - **轮次上限**:同一次 `run` 内最多 50 轮 LLM 调用,超出则 append 一条说明性 assistant 消息并结束(防止死循环烧钱)。
  - **中断一致性**:`signal` 触发时——若正在收流,丢弃未完成的 assistant 消息(不持久化);若已持久化含 tool_call 的 assistant 消息但工具还没跑完,为**每个**未完成的 tool_call 补一条 `{ isError: true, content: "interrupted by user" }` 的 ToolResultPart 并持久化,然后结束。保证任何时刻 session 里 tool_call 与 tool_result 配对完整。
  - **provider 抛错**:直接向上抛(REPL 处理),但抛之前同样要完成上述配对补全。
  - **usage 事件**:每收到 done 事件,调用 `sessionStore.addUsage` 并 yield `turn_end`。

### 2. `src/agent/truncate.ts`

- `export function truncateHistory(messages: Message[], contextWindow: number): Message[]`
- 按架构文档的截断策略实现,纯函数,单独导出便于测试。token 估算:全部 parts 文本长度 ÷ 4。

### 3. `test/agent/fake-provider.ts`

- 脚本化假 provider:构造时给定一组「响应脚本」,每次 `chat` 依次消费一个脚本,按脚本产出 StreamEvent 序列。同时记录每次收到的 `ChatRequest` 供断言。这是 M5/M6 测试的基础设施,认真实现。

### 4. `test/agent/loop.test.ts` + `test/agent/truncate.test.ts`

全部用 FakeProvider + 内存/临时目录依赖,覆盖:

1. 纯文本回答:事件序列正确(text_delta* → turn_end),session 持久化 user + assistant 两条消息
2. 单工具调用:脚本 = [tool_use 响应, 文本响应] → 工具真的被执行、第二次请求的 history 含正确配对的 tool 消息、最终事件序列含 tool_start/tool_end
3. 一次响应含 2 个 tool_call → 2 个结果都回传且 toolCallId 对应正确
4. 权限 deny:工具未被执行,回传 "User denied" 的 isError 结果,yield tool_denied
5. 未知工具名 → isError 结果回传,循环继续不崩溃
6. 50 轮上限:脚本永远返回 tool_use → 恰好在上限处停止
7. 中断:在工具执行中 abort → session 中 tool_call/tool_result 配对完整,run 终止
8. truncate:超窗历史被正确裁剪——保留第一条 user 与最近消息、插入截断标记、**不存在孤立的 tool_call 或 tool_result**;未超窗时原样返回

## 禁止事项

- 不要在 agent 里做任何终端 IO(打印、读输入)——agent 只 yield 事件,IO 是 CLI 的职责。
- 不要直接 import anthropic 实现(只依赖 `Provider` 接口)。
- 不要自作主张加"上下文摘要压缩"等 MVP 之外的功能。

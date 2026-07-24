# M1 任务指令:LLM Provider 层

## 需要附上的上下文

- `02-architecture.md` 全文(重点:`Provider`、`ChatRequest`、`StreamEvent`、错误处理约定)
- `src/types.ts`

## 任务

实现 `Provider` 接口的 Anthropic 版本:把 mycode 的消息格式转成 Anthropic Messages API 格式,发起流式请求,把 SDK 的流事件归一化为 `StreamEvent`。

## 交付物

### 1. `src/provider/provider.ts`

- `export function createProvider(id: string): Provider` —— 目前只认 `"anthropic"`,其他 id throw `Error("unknown provider: ...")`。这是未来多 Provider 的扩展点。

### 2. `src/provider/anthropic.ts`

- `export function createAnthropicProvider(): Provider`,`id` 为 `"anthropic"`。
- API key 从 `process.env.ANTHROPIC_API_KEY` 读取;缺失时在**首次调用 `chat` 时** throw 一个消息清晰的错误(不要在构造时 throw,方便测试)。
- **消息格式转换**(mycode → Anthropic):
  - `role: "user"` + TextPart → user 消息的 text block
  - `role: "assistant"` + TextPart/ToolCallPart → assistant 消息的 text/tool_use block
  - `role: "tool"` + ToolResultPart → **user 消息**的 tool_result block(注意:Anthropic 把工具结果放在 user 角色里)
  - `ToolDefinition` → Anthropic 的 `tools` 数组(`input_schema` 字段)
- **流式归一化**(Anthropic SDK stream → `StreamEvent`):
  - `content_block_delta`(text_delta)→ `{ type: "text_delta" }`
  - tool_use block:SDK 以 `content_block_start`(拿到 id/name)+ 多个 `input_json_delta`(参数 JSON 分片)+ `content_block_stop` 的形式给出。你需要**累积 JSON 分片,在 block stop 时解析**,再发出一个完整的 `{ type: "tool_call" }` 事件。参数 JSON 解析失败时发出 arguments 为 `{}` 的事件并在 content 中说明(不 throw)。
  - `message_delta`(含 stop_reason)+ `message_stop` → 映射为 `{ type: "done" }`;Anthropic 的 stop_reason 映射:`end_turn`→`end_turn`,`tool_use`→`tool_use`,`max_tokens`→`max_tokens`,其他一律按 `end_turn` 处理。
  - usage 从 message_start(input)和 message_delta(output)中取。
- **重试**:仅对可重试错误(HTTP 429/5xx/网络错误)重试,指数退避 1s/2s/4s,共 3 次;4xx(如 key 无效、请求超窗)不重试直接 throw。**流已经开始产出事件后发生的错误不重试**(避免重复输出),直接 throw。
- **中断**:`signal` 触发时立即终止请求并停止产出事件(把 signal 透传给 SDK)。

### 3. `scripts/smoke-provider.ts`

真实 API 冒烟脚本:发一条 "Say hello in one sentence",流式打印 text_delta,最后打印 usage。**不进入测试套件**,手动运行用。

### 4. `test/provider/anthropic.test.ts`

不打真实 API。做法:`createAnthropicProvider` 接受一个可选参数注入底层 client 工厂(默认为真实 SDK),测试注入 fake client,fake client 返回预先构造的事件序列。用例至少覆盖:

1. 纯文本响应 → 正确的 text_delta 序列 + done(end_turn)+ usage 正确
2. 含 tool_use 的响应(参数 JSON 分 3 片下发)→ 恰好一个 tool_call 事件且 arguments 解析正确,done(tool_use)
3. 消息格式转换:含全部三种 role 的历史 → 转换后的请求体结构正确(tool 消息进了 user 角色)
4. 429 两次后成功 → 最终事件正确,共调用 3 次
5. 401 → 不重试,throw
6. 流中途 abort → 迭代终止,不再产出事件

## 禁止事项

- 不要实现除 Anthropic 外的任何 provider。
- 不要在本模块处理"上下文截断"(那是 agent 的职责)。
- 不要把 SDK 的类型泄漏到本模块的公共签名里(公共签名只用 `types.ts` 的类型)。

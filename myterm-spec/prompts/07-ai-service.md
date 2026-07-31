# M6 任务指令:内置 AI(Rust 服务 + AI 面板)

## 需要附上的上下文

- `02-architecture.md` 全文(重点:AiProfile/AiMessage 类型、IPC 契约的 AI 部分、AI 数据面、AI 提示词模板、安全红线)
- `src-tauri/src/types.rs`、`src-tauri/src/session/manager.rs`(buffer_lines)、`src-tauri/src/config/`、`src/ipc.ts`、`src/components/shell/`

## 任务

实现产品的灵魂功能:Rust 侧 OpenAI 兼容客户端(SSE 流式、多配置档、测试连接)+ 前端 AI 面板(流式聊天、抓屏提问、命令回填)+ AI 设置页。完成产品规格 U6/U7。

## 交付物

### 1. `src-tauri/src/ai/service.rs`

- `AiService`:
  - 配置档管理:`ai_profiles` 的 CRUD 走 ConfigService;Key 经 `aiProfileSave(profile, apiKey?)` 写入 vault(ref 规则:`ai.<profileId>.key`),删除配置档时级联删 vault;
  - `test_connection(profile_id)`:GET `{base_url}/models`,Bearer 头;返回 `{ ok, models?, error? }`,错误含状态码与 body 摘要;
  - `chat(profile_id, messages, attach_session_id, delta_sink, abort)`:
    - `attach_session_id` 非空时:取该会话 `buffer_lines(context_lines)`,按架构文档的提示词模板拼进最后一条 user 消息;
    - system 消息:AiProfile.system_prompt(空则用架构文档默认值);
    - POST `{base_url}/chat/completions`,`stream: true`;SSE 解析按最宽容实现:`data: ` 前缀行、`[DONE]` 结束、空行/注释行/未知字段忽略、`choices[0].delta.content` 取增量;
    - delta 逐段发给 `delta_sink`;HTTP 非 2xx 读 body 组装错误;
    - 全局同时只允许一个进行中请求,`abort` 触发后立即停流并以 `aborted` 结束;
  - **Key 只在发请求的瞬间从 vault 读出,不缓存、不入日志、不进错误消息**;日志只记配置档 id、模型、耗时。

### 2. `src-tauri/src/ipc.rs`(AI 部分)

- 按 IPC 契约实现:`ai_profile_list/save/delete`、`ai_test_connection`、`ai_chat`(delta 走 `Channel<string>`)、`ai_abort`。

### 3. 前端 `src/components/ai/`

- **AI 面板**(右侧,可折叠,宽度可拖):
  - 顶部:配置档下拉切换 + 设置按钮;
  - 消息流:用户/助手气泡;助手内容流式追加;Markdown 渲染支持粗体/行内码/围栏代码块(自写 ~100 行解析器,**所有文本节点走 textContent 防注入**);
  - 代码块右上角:「复制」「▶ 回填终端」——回填即 `terminalWrite(activeSession, code)`(**绝不带回车**);
  - 输入区:多行输入框 + 「附带终端上下文」开关(默认开,悬浮显示将附带的行数)+ 发送/停止按钮;请求中显示停止(→ `aiAbort`);
  - 抓屏内容以可折叠的引用块显示在自己的消息气泡内(用户看得到发出了什么);
  - 多轮:面板内历史保留在内存(zustand),发送时携带最近 20 条;新提问自动 `aiAbort` 未完成请求;
  - Ctrl+Shift+A:聚焦输入框并打开「附带上下文」。
- **AI 设置页**(面板内切换视图):
  - 配置档列表(增删);编辑表单:名称 / 服务商预设按钮(OpenAI、DeepSeek、Ollama 本地、自定义——预设只是填充 base_url+model 的快捷方式)/ Base URL / API Key(密码框,保存走 `aiProfileSave` 第二参,回显「已保存」占位)/ 模型 / System Prompt / 上下文行数;
  - 「测试连接」按钮 → `aiTestConnection`,就地显示 ✓/✗ 与详情。

### 4. 测试

- Rust(HTTP 层注入 mock,禁止打真实 API):
  1. SSE 解析:多 chunk 拆包、`[DONE]`、keep-alive 空行、未知字段 → delta 序列正确;
  2. 抓屏拼装:attach_session_id 非空时,发出的请求体最后一条 user 消息含缓冲内容与模板结构;
  3. 非 2xx(401/404/500)→ reject,message 含状态码与 body 摘要,**不含 Key**(用例断言);
  4. abort:触发后 delta_sink 不再收到数据,finishReason 为 aborted;
  5. 并发第二个 chat → 拒绝或排队(按"全局唯一进行中"约定);
  6. test_connection 成功/失败两分支;
  7. 配置档删除级联删 vault 条目(MemoryVault 验证)。
- 前端(vitest,ipc mock):
  1. delta 序列 → 气泡内容流式增长;
  2. 代码块「回填」→ `terminalWrite` 收到不带 `\r` 的命令;
  3. 停止按钮 → `aiAbort` 被调用;
  4. Markdown:XSS 载荷(`<img onerror>`)不产生元素节点;
  5. 设置表单:预设按钮填充、保存参数正确、Key 输入后不回显明文。

## 端到端人工验收(交付说明中给出步骤)

- 用本地 Ollama(`http://localhost:11434/v1`)或任一兼容网关:连接服务器 → 故意 `cat /etc/shadow` 得到 Permission denied → Ctrl+Shift+A 提问 → 面板流式给出解释与 sudo 建议 → 点「回填终端」→ 命令出现在提示符后未执行;切换 DeepSeek 配置档再问一轮。

## 禁止事项

- 不要引入 openai/SSE/Markdown 第三方库(reqwest + 自写解析)。
- 不要自动执行命令、不要实现 Agent 循环(回填永远不带回车)。
- 不要把对话内容写入任何日志或磁盘(MVP 不持久化对话)。

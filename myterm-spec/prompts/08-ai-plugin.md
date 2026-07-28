# M7 任务指令:AI 助手插件(MVP 完成线)

## 需要附上的上下文

- `02-architecture.md` 全文(重点:插件 SDK、插件清单示例)
- `packages/myterm-plugin-sdk/`、`plugins/ai-assistant/plugin.json`、`plugins/snippets/`(作实现风格参考)

## 任务

实现官方 AI 助手插件:对接**任意 OpenAI 兼容服务**(可配 Base URL / API Key / 模型),提供聊天面板与"抓屏提问",回答中的命令可一键回填终端。这是插件体系的验收之作——**只允许使用公开 SDK,不得走任何私有通道**。完成产品规格 U8。

## 交付物(全部在 `plugins/ai-assistant/` 内)

### 1. manifest(`plugin.json`)

- 权限:`terminal:read`、`terminal:write`、`sessions:read`、`secrets`、`network`;
- contributes:命令 `ai.ask`(快捷键 Ctrl+Shift+A)、面板 `ai.chat`、configuration:`ai.baseUrl`(默认 `https://api.openai.com/v1`)、`ai.model`、`ai.systemPrompt`、`ai.contextLines`(默认 80,抓屏行数);
- activationEvents:`onCommand:ai.ask`、`onPanel:ai.chat`。

### 2. 插件后端(`src/extension.ts` + `src/openai.ts`)

- `openai.ts`:OpenAI 兼容客户端,仅依赖 `fetch`:
  - `chatStream(cfg, messages, onDelta, signal)`:POST `{baseUrl}/chat/completions`,`stream: true`,解析 SSE(`data: {...}` 行,`[DONE]` 结束),逐 delta 回调;HTTP 非 2xx 时读 body 组装可读错误;
  - `testConnection(cfg)`:GET `{baseUrl}/models`,返回成功与否 + 模型数或错误信息;
  - Key 经 `myterm.secrets.get("apiKey")` 读取,**任何日志/错误消息不得包含 Key**;
- `extension.ts`:
  - `ai.ask` 命令:`sessions.active` → `terminal.getBuffer(sessionId, contextLines)` → 组装 user 消息(模板:先贴终端输出的 fenced block,再附固定问题"解释当前终端状态,若有报错给出修复命令")→ 打开面板并发起 chatStream;
  - 面板消息协议(与 UI 的 postMessage 契约,写成 TS 类型放 `src/protocol.ts`):`userMessage`、`assistantDelta`、`assistantDone`、`error`、`runCommand`(UI → 后端:`terminal.sendText(active, cmd, false)`)、`saveSettings` / `loadSettings` / `testConnection`;
  - 多轮:面板会话内保留历史(内存即可,MVP 不持久化);发送时携带 systemPrompt + 最近 20 条;
  - 中断:新提问自动 abort 上一个未完成的流。

### 3. 面板 UI(`ui/index.html` + `ui/panel.ts`,构建产物进 `dist/`)

- 聊天区:流式渲染;Markdown 支持粗体/行内码/围栏代码块即可(自写 ~100 行解析器,不引依赖;**所有文本节点走 textContent 防注入**);
- 代码块右上角两个按钮:「复制」「▶ 回填终端」(回填即 `runCommand`,绝不自动回车);
- 设置视图(齿轮切换):Base URL / API Key(密码框,保存即 `secrets.set`,回显占位)/ 模型 / System Prompt / 上下文行数 + 「测试连接」按钮显示结果;
- 状态:请求中显示停止按钮(abort);error 消息红色显示完整原因。

### 4. 测试(vitest;SDK 与 fetch 均用 fake)

1. SSE 解析:多 chunk 拆包、`[DONE]`、混入 keep-alive 空行 → delta 序列正确;
2. 非 2xx(401/404/500)→ error 含状态码与 body 摘要,且不含 Key;
3. `ai.ask`:getBuffer 返回值被正确嵌入 prompt 模板;
4. `runCommand` → sendText(active, cmd, false) 参数正确;
5. abort:新提问后旧流的 onDelta 不再触发;
6. Markdown 渲染器:代码块/行内码/XSS 载荷(`<img onerror>`)不产生元素节点。

## 端到端人工验收(交付说明中给出步骤)

- 用本地 Ollama(`http://localhost:11434/v1`)或任一兼容网关配置后:连接一台服务器 → 故意 `cat /etc/shadow` 得到 Permission denied → Ctrl+Shift+A → 面板给出解释与 sudo 建议 → 点「回填终端」→ 命令出现在提示符后未执行。

## 禁止事项

- 不要引入 openai npm SDK 或任何 Markdown/HTTP 库(fetch + 自写解析,控制插件体积)。
- 不要绕过 SDK 直接访问宿主 RPC 或 Node fs(插件必须是"普通插件开发者写得出来的"形态)。
- 不要实现自动执行命令、Agent 循环(超出 MVP;回填永远不带回车)。

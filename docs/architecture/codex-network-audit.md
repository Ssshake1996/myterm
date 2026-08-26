# dsh-codex-agent 静态网络审计

- 审计日期：2026-08-26
- 生产构建范围：`integrations/dsh-codex-agent`
- 可重复命令：`npm run audit:codex-network`

## 结论

源码、生产直接依赖、Rust `Cargo.lock`、编译后的 TypeScript 和 Windows N-API
Release 二进制扫描均通过。生产运行图只存在三个网络调用点，不包含 OpenAI 公网
URL、ChatGPT URL、遥测、远程压缩、keyring、stdio MCP、Cloud Task 或 Remote
Control 标记。

本审计针对本任务新增的 Harness 插件生产图。仓库原有 Tauri 应用是独立的旧运行图，
没有被链接进 `dsh-codex-agent`；其旧 AI/keyring/stdio MCP 实现仍属于迁移边界，不能
与本插件同时作为同一个 Agent 的状态或模型历史所有者。

## HTTP 客户端调用点

| 调用点 | 唯一用途 | 目标来源 | Secret 来源 | 限制与审计 |
| --- | --- | --- | --- | --- |
| `native/src/chat_completions_transport.rs` | 普通模型调用与自动压缩 | 固定 `baseUrl` | 宿主注入的 `apiKey` 内存参数 | 仅 Chat Completions；Bearer Header；原始 HTTP/SSE 错误结构化返回；Key 不进入请求 JSON 或 Store |
| `src/mcp-http.ts` | 外部 Streamable HTTP MCP | `externalMcp[].url` | `headersFromEnv` 指定的环境变量 | URL 和工具双白名单；无通配符；无 stdio；无动态发现；无自动重连；工具名、目标、参数摘要和状态投影审计 |
| `src/web-search-http.ts` | 可选 Web Search | 固定 `webSearch.url` | `headersFromEnv` 指定的环境变量 | 未配置则工具不存在且桥接层拒绝同名宿主工具；固定 POST；响应大小与超时上限；目标和状态审计 |

`@modelcontextprotocol/sdk` 内部执行 MCP HTTP 请求，但它只能接收插件已经验证的固定
URL。插件不导入 SDK 的 stdio Client，也不启动 MCP Server。

## Harness 默认出口处置

`cordis.patch.yml` 必须作为最后一个 bundle layer 安装，并显式禁用：

- `session-telemetry-otel`、`credentials`、`session-title-llm`；
- `llm-deepseek`、`llm-pi-ai`、`llm-retry`、`agent-default-model`；
- `web-search-deepseek`、`web`、`tool-web`；
- `agent-loop`、Harness Compaction、Harness Subagent/Workflow 和 Code Runtime。

这样既移除了默认远程端点，也避免 Harness 与 Core 重复拥有 Loop、压缩和 Agent Graph。

## 自动化扫描内容

扫描脚本会失败退出，条件包括：

- 生产源码出现 OpenAI/ChatGPT 公网 URL、remote compaction、telemetry/OTEL、
  analytics、keyring、stdio MCP、Cloud Task、Remote Control 等标记；
- 出现未分类的 `reqwest`、`fetch` 或 Streamable HTTP MCP 调用点；
- 生产直接依赖或 Rust Lockfile 出现禁止依赖；
- Harness 竞争状态所有者或默认远程 row 未被禁用；
- 压缩策略不是首次失败后重试 3 次，或退避不为 100/250/500ms；
- 编译后的 JS/N-API 二进制包含禁止标记。

最后一次扫描结果：`PASS`，3 个已分类网络出口，0 个未知出口。

## 边界与风险

- 地址白名单目前是“精确配置 URL”，没有额外 CIDR/DNS 解析后 IP 校验。如果部署方
  需要防 DNS 重绑定，应在内网网关或后续版本增加解析后地址策略。
- Web Search 使用通用固定 POST JSON 协议；不同搜索后端需要在网关侧适配。
- 本次只生成并扫描了 Windows x64 MSVC 原生二进制；其他平台必须分别构建和扫描。
- `@modelcontextprotocol/sdk` 包含未导入的其他传输文件；生产入口只导入
  `client/streamableHttp.js`。若未来改成单文件 bundle，应继续检查 tree-shaking 产物。

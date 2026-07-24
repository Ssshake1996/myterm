# M6 任务指令:CLI 入口与 REPL(MVP 完成线)

## 需要附上的上下文

- `01-product-spec.md`(重点:命令行接口、用户故事 U1–U8)
- `02-architecture.md` 全文
- `src/types.ts`、`src/agent/loop.ts`、`src/provider/provider.ts`、`src/tool/tool.ts`、`src/permission/permission.ts`、`src/permission/terminal-prompter.ts`、`src/session/store.ts`(接口签名)

## 任务

实现 mycode 的可执行入口:解析参数、装配所有模块、运行交互式 REPL 或非交互单任务模式。完成后整个 MVP 端到端可用。

## 交付物

### 1. `src/config.ts`

- ```typescript
  export interface Config {
    model: string;               // 默认 "claude-sonnet-4-5",可被 MYCODE_MODEL / --model 覆盖
    mode: PermissionMode;        // 默认 "confirm";--readonly / --yolo 互斥,同时给出则报错退出
    continueLast: boolean;       // --continue
    sessionId?: string;          // --session <id>
    prompt?: string;             // -p / --prompt <text>,非交互模式
    debug: boolean;              // --debug
  }
  export function parseConfig(argv: string[], env: Record<string, string | undefined>): Config
  ```
- 手写参数解析(依赖原则:不引库)。未知参数 → 打印 usage 并抛错。纯函数,可测。

### 2. `src/cli/repl.ts`

- `export async function runRepl(agent: Agent, session: Session): Promise<void>` 与 `export async function runOnce(agent: Agent, prompt: string): Promise<void>`(非交互模式)。
- REPL 行为:
  - 启动横幅:版本、模型、权限模式、会话 id;`--continue` 恢复时简要重放历史(每条消息第一行)。
  - 提示符 `> `,用 `node:readline/promises` 循环读输入;空行忽略;`/exit` 或 stdin EOF(Ctrl+D)退出;`/help` 打印可用命令。
  - **事件渲染**(消费 `AgentEvent`):
    - `text_delta` → 直接写 stdout(流式)
    - `tool_start` → 灰色打印 `⏺ ${name}: ${description 的第一行}`
    - `tool_end` → 成功打印 `  ✓`,失败打印 `  ✗ ${result.content 第一行}`
    - `tool_denied` → 打印 `  ⊘ denied`
    - `turn_end` → 打印一行 `tokens: in=N out=N`
  - 颜色用原生 ANSI 转义码(`\x1b[...m`),`process.stdout.isTTY` 为 false 时不输出颜色。
  - **Ctrl+C(SIGINT)**:第一次按下中止当前 `agent.run`(通过 AbortController),回到提示符;在提示符空闲状态按下则提示 `(use /exit to quit)`。**不退出进程**。
  - agent 抛出的错误(如 API key 缺失、网络失败):打印红色错误消息,回到提示符。
- `runOnce`:执行一轮 `agent.run(prompt)`,渲染同上,结束后进程退出;agent 抛错时退出码 1。

### 3. `src/cli/main.ts`

- 带 `#!/usr/bin/env bun` shebang。流程:
  1. `parseConfig(process.argv.slice(2), process.env)`
  2. 建 store;按 `--continue`/`--session` 取会话(找不到 → 报错退出码 1),否则 `create()`
  3. 装配:`createProvider("anthropic")` + `builtinTools()` 注册表 + `createPermissionGate(mode, createTerminalPrompter())` + `createAgent({..., cwd: process.cwd()})`
  4. `config.prompt` 存在 → `runOnce`,否则 `runRepl`
- `--debug`:装一个 provider 包装器,把每次请求摘要(模型、消息数、估算 token)和响应(stopReason、usage)追加写入 `~/.mycode/logs/<date>.log`。

### 4. 测试

- `test/config.test.ts`:参数解析全分支(默认值、每个 flag、env 覆盖、互斥冲突、未知参数)。
- `test/cli/repl.test.ts`:用 M5 的 FakeProvider 构造 agent,把 `runOnce` 的输出捕获到 buffer,断言:文本流式输出、工具事件渲染格式、usage 行、agent 抛错时的错误输出与退出码逻辑。REPL 的 readline 交互不做自动化(人工验收)。

### 5. 端到端自动验收脚本 `scripts/e2e.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
dir=$(mktemp -d)
cd "$dir"
bun /path/to/src/cli/main.ts --yolo -p "Create a file named hello.txt containing exactly: hi"
grep -q "hi" hello.txt && echo "E2E PASS"
```
(路径在脚本里用仓库绝对路径变量处理;需要 `ANTHROPIC_API_KEY`,不进 `bun test`。)

## 验收

1. `bun run typecheck && bun run lint && bun test` 全绿;
2. `scripts/e2e.sh` 输出 `E2E PASS`;
3. 人工按产品规格逐条验收 U1–U8。

## 禁止事项

- 不要做全屏 TUI、不要引入 ink/blessed 等 UI 库(M7 再说)。
- 不要把业务逻辑写进 CLI(截断、循环控制等都在 agent 里,CLI 只做 IO 与装配)。

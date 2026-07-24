# M3 任务指令:权限系统

## 需要附上的上下文

- `02-architecture.md` 全文(重点:`PermissionGate`、`PermissionMode`)
- `src/types.ts`
- `src/tool/tool.ts`(仅接口部分,让 AI 了解 permissionLevel 的来源)

## 任务

实现 `PermissionGate`:agent 在执行每个工具前调用它,由它根据模式和工具的 `permissionLevel` 决定放行、拒绝或询问用户。

## 决策矩阵(必须严格按此实现)

| permissionLevel \ mode | `readonly` | `confirm` | `yolo` |
|---|---|---|---|
| `read` | allow | allow | allow |
| `write` | **deny** | **询问用户** | allow |
| `execute` | **deny** | **询问用户** | allow |

## 交付物

### 1. `src/permission/permission.ts`

- ```typescript
  export interface Prompter {
    /** 向用户展示操作描述,返回其决定 */
    confirm(title: string, description: string): Promise<PermissionDecision>;
  }
  export function createPermissionGate(mode: PermissionMode, prompter: Prompter): PermissionGate
  ```
- `check(tool, description)` 按决策矩阵执行;需要询问时调用 `prompter.confirm(tool.definition.name, description)`。
- **会话内记住选择(简化版)**:`Prompter.confirm` 的返回扩展为 `"allow" | "deny" | "always"`;用户选 `always` 时,本 gate 实例后续对**同一工具名**直接 allow,不再询问。`check` 对外仍只返回 `allow | deny`。
- readonly 模式下的 deny 不询问用户,直接返回。

### 2. `src/permission/terminal-prompter.ts`

- `export function createTerminalPrompter(): Prompter`
- 交互:打印标题与描述(描述可能是多行 diff,原样打印),然后 `[y]es / [n]o / [a]lways: `,读取一行 stdin。`y`→allow,`a`→always,其余输入(含空输入、EOF)一律 deny(**默认拒绝**)。
- 用 Node `readline`(`node:readline/promises`)实现,注意每次询问后释放接口,避免与 REPL 的 stdin 抢占冲突(创建-使用-关闭)。

### 3. `test/permission/permission.test.ts`

用 fake Prompter(记录调用并返回预设值)覆盖:

1. 决策矩阵全部 9 格(3 模式 × 3 级别)
2. readonly 下不调用 prompter(断言调用次数为 0)
3. yolo 下不调用 prompter
4. confirm 下选 always 后:同名工具第二次不再询问,不同名工具仍询问
5. prompter 返回 deny → check 返回 deny

terminal-prompter 不做自动化测试(纯 IO 薄层,M6 端到端人工验收)。

## 禁止事项

- 不要在本模块 import 任何具体工具实现。
- 不要做"按路径/按命令白名单"这类高级规则(MVP 之外)。

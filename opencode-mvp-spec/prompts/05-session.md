# M4 任务指令:会话持久化

## 需要附上的上下文

- `02-architecture.md` 全文(重点:`Session`、`SessionMeta`、`SessionStore`)
- `src/types.ts`

## 任务

实现 `SessionStore` 的本地 JSON 文件版本。

## 存储设计

- 目录:`~/.mycode/sessions/`(可通过构造参数覆盖,便于测试),每个会话一个文件 `<id>.json`,内容为完整 `Session` 对象的 pretty JSON。
- `id`:`crypto.randomUUID()`。
- `title`:首条 user 消息的文本前 50 字符(尚无用户消息时为 `"new session"`),在 `appendMessage` 时惰性更新。
- `updatedAt`:每次 `appendMessage` / `addUsage` 时刷新。

## 交付物

### 1. `src/session/store.ts`

- `export function createFileSessionStore(dir?: string): SessionStore`
- 实现要点:
  - 目录不存在时自动创建(`create` 和读取时都要容错)。
  - `get`:文件不存在 → `null`;**JSON 损坏 → 也返回 `null`,同时把坏文件改名为 `<id>.json.corrupt` 留档**,不 throw。
  - `list`:扫描目录读取所有会话,只返回 `SessionMeta` 字段,按 `updatedAt` 倒序;单个坏文件跳过,不影响整体。
  - `appendMessage` / `addUsage`:读-改-写。**写入必须原子**:先写 `<id>.json.tmp` 再 `rename`,防止进程中途被杀留下半个 JSON。
  - 同一 store 实例内,对同一会话的写操作用一个简单的 per-id promise 队列串行化,防止读-改-写交错丢数据。
  - 对不存在的 id 执行 append/addUsage → throw(这是编程错误,不是运行时容错场景)。

### 2. `test/session/store.test.ts`

全部用 `fs.mkdtemp` 临时目录。覆盖:

1. create → get 往返一致(字段完整)
2. appendMessage 后消息追加、`updatedAt` 变化、首条 user 消息生成 title(含 >50 字符截断)
3. addUsage 累加正确
4. list 排序正确、只含 meta 字段
5. 损坏 JSON:get 返回 null 且生成 `.corrupt` 文件;list 跳过坏文件
6. 并发:同一会话 `Promise.all` 追加 20 条消息,最终恰好 20 条、无丢失
7. 对不存在 id 的 append → 抛错

## 禁止事项

- 不要引入数据库或第三方存储库。
- 不要做会话删除/导出等额外功能。
- 不要在本模块处理"截断历史"(agent 的职责,存储层永远保存全量)。

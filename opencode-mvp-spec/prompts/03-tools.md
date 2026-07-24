# M2 任务指令:工具层

## 需要附上的上下文

- `02-architecture.md` 全文(重点:`Tool`、`ToolContext`、`ToolResult`、错误处理约定)
- `src/types.ts`

## 任务

实现 6 个内置工具和工具注册表。这是模型与真实世界交互的唯一通道,重点是:**绝不 throw、路径安全、输出对 LLM 友好**。

## 全局要求(适用于每个工具)

- `execute` 内部任何失败都返回 `{ isError: true, content: "<简明英文错误说明>" }`,绝不向外抛异常。
- 路径参数一律相对 `ctx.cwd` 解析;解析后若逃逸出 `ctx.cwd`(用 `path.resolve` + 前缀检查,注意 `..` 和绝对路径),返回 isError:`"path escapes working directory"`。**bash 除外**(它靠权限确认把关)。
- 输出上限 30000 字符,超出则截断并在末尾追加 `"\n[output truncated]"`。
- `definition.description` 和参数描述要面向 LLM 认真编写(说明何时用这个工具、参数含义、路径为相对路径)——这些文本直接影响模型调用质量。
- `describe(args)` 返回给用户看的一句话(权限确认时展示),见各工具要求。

## 交付物

### 1. `src/tool/tool.ts`

- `export function createToolRegistry(tools: Tool[]): Map<string, Tool>`(重名 throw)。
- `export function builtinTools(): Tool[]` 返回下述 6 个工具实例。
- 共享工具函数:路径解析与校验、输出截断(供各工具文件复用)。

### 2. `src/tool/read.ts` — `read_file`(permissionLevel: read)

- 参数:`path`(必填)、`offset`(可选,起始行号,1 起)、`limit`(可选,行数,默认 2000)。
- 输出:`cat -n` 风格带行号的内容。文件不存在 → isError。二进制文件(内容含 `\0`)→ isError `"binary file"`。
- describe:`read ${path}`。

### 3. `src/tool/write.ts` — `write_file`(permissionLevel: write)

- 参数:`path`、`content`。父目录不存在时自动创建。
- describe:**返回 unified diff**——文件已存在时是旧内容→新内容的 diff,新文件时是全部为 `+` 行的 diff。自己实现一个简单的行级 LCS diff(几十行代码),不引依赖。
- 输出:`"wrote N bytes to ${path}"`。

### 4. `src/tool/edit.ts` — `edit_file`(permissionLevel: write)

- 参数:`path`、`old_string`、`new_string`、`replace_all`(可选,默认 false)。
- 语义:精确字符串替换。`old_string` 未找到 → isError `"old_string not found in file"`;找到多处且未开 replace_all → isError `"old_string occurs N times; provide more context or set replace_all"`(这个约束是为了逼模型给出无歧义的替换目标)。
- describe:返回被改动区域的 unified diff(复用 write 的 diff 函数)。

### 5. `src/tool/bash.ts` — `bash`(permissionLevel: execute)

- 参数:`command`、`timeout_ms`(可选,默认 30000,上限 120000)。
- 用 `Bun.spawn` 以 `["bash", "-c", command]` 执行,cwd 为 `ctx.cwd`,合并 stdout+stderr。
- 非零退出码:`isError: true`,content 含退出码和输出。超时:杀掉进程组,isError `"command timed out after Nms"`。响应 `ctx.signal` 中断。
- describe:`$ ${command}`。

### 6. `src/tool/grep.ts` — `grep`(permissionLevel: read)

- 参数:`pattern`(JS 正则)、`path`(可选,默认 `.`)、`glob`(可选,如 `*.ts`)。
- 纯 TS 实现:递归遍历(跳过 `node_modules`、`.git`、隐藏目录),逐行匹配,输出 `path:lineNo:line`,最多 200 条匹配(超出时在末尾注明)。无匹配 → 正常结果(非 error)`"no matches"`。非法正则 → isError。
- describe:`grep /${pattern}/ in ${path}`。

### 7. `src/tool/glob.ts` — `glob`(permissionLevel: read)

- 参数:`pattern`(如 `src/**/*.ts`)。
- 用 `Bun.Glob` 实现,跳过 `node_modules`/`.git`,按修改时间倒序,最多 200 条。无匹配 → 正常结果 `"no files found"`。
- describe:`glob ${pattern}`。

### 8. 测试 `test/tool/*.test.ts`(每个工具一个文件)

每个工具 ≥ 5 个用例,必须覆盖:正常路径、错误分支(不存在/未找到/非零退出)、**路径逃逸攻击(`../../etc/passwd` 和绝对路径)**、输出截断、edit 的多重匹配拒绝、bash 的超时与非零退出。全部使用 `fs.mkdtemp` 临时目录。

## 禁止事项

- 不要调用系统的 `grep`/`rg`/`find` 命令(grep/glob 必须纯 TS 实现,保证跨平台)。
- 不要在工具里做权限判断(那是 PermissionGate 的职责,工具只声明 `permissionLevel`)。
- 不要给 read/grep/glob 加确认交互。

# M0 任务指令:工程脚手架

## 需要附上的上下文

- `02-architecture.md` 全文(重点:目录结构、核心类型、技术栈)

## 任务

初始化 mycode 工程骨架。这是整个项目的第一个任务,仓库当前为空。

## 交付物

1. **`package.json`**
   - `"name": "mycode"`,`"type": "module"`,`"bin": { "mycode": "./src/cli/main.ts" }`
   - scripts:
     - `"typecheck": "tsc --noEmit"`
     - `"lint": "biome check ."`
     - `"lint:fix": "biome check --write ."`
     - `"test": "bun test"`
   - devDependencies:`typescript`、`@biomejs/biome`、`@types/bun`
   - dependencies:`@anthropic-ai/sdk`

2. **`tsconfig.json`**:`strict: true`、`noUncheckedIndexedAccess: true`、`module/moduleResolution` 适配 Bun(`"moduleResolution": "bundler"`)、`target: "esnext"`。

3. **`biome.json`**:启用推荐 lint 规则 + formatter(2 空格缩进,行宽 100)。

4. **`src/types.ts`**:把架构文档「核心类型」一节的 TypeScript 代码**逐字**落地(含 JSDoc 注释)。

5. **目录骨架**:按架构文档创建 `src/provider/`、`src/tool/`、`src/permission/`、`src/session/`、`src/agent/`、`src/cli/` 及镜像的 `test/` 目录。每个 src 子目录放一个只含 `// implemented in M1..M6` 占位注释的 `index.ts` 是不允许的——**不要创建任何占位实现文件**,空目录用 `.gitkeep` 保持。

6. **`test/types.test.ts`**:一个冒烟测试,import `src/types.ts` 并构造一个合法的 `Message` 对象,断言其结构。作用是保证 types.ts 可编译、测试链路通。

7. **`.gitignore`**:`node_modules/`、`*.log`、`.env`。

8. **`README.md`**:一段话项目简介 + 开发命令(install/typecheck/lint/test)。

## 验收命令

```bash
bun install
bun run typecheck
bun run lint
bun test        # 1 个测试通过
```

## 禁止事项

- 不要实现任何业务逻辑(provider/tool/agent 等一律不写)。
- 不要添加 CI 配置、husky、commitlint 等本任务未要求的东西。

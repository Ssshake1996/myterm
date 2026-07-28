# M0 任务指令:工程脚手架

## 需要附上的上下文

- `02-architecture.md` 全文(重点:目录结构、技术栈、内核类型、前端 IPC 契约、插件 SDK)

## 任务

搭建 myterm 的完整工程骨架:Tauri 2 应用 + npm workspaces,把三份契约文件(`types.rs`、`ipc.ts`、SDK 类型)按架构文档逐字落地,建立统一的检查/测试脚本。**本任务不实现任何业务逻辑**,所有 service 只建空模块。

## 交付物

### 1. Tauri 应用骨架

- `src-tauri/`:Tauri 2 工程,`Cargo.toml` 只含已登记依赖;`main.rs` 起一个空窗口;`tauri.conf.json` 中应用 id 为 `dev.myterm.app`,窗口默认 1200×800。
- `src-tauri/src/types.rs`:架构文档「内核类型」一节**逐字**落地,`cargo check` 通过。
- 目录骨架:`session/`、`sftp/`、`config/`、`plugin/`、`ipc.rs` 全部就位,内容为空的 `mod` + `// implemented in M1..M5` 注释。

### 2. 前端骨架

- Vite + React 18 + TypeScript strict;`src/main.tsx` 渲染一个占位布局(左侧栏 / 标签区 / 状态栏三块灰盒)。
- `src/ipc.ts`:架构文档「前端 IPC 契约」的全部 TS 类型 + 每个命令的 `invoke` 封装(此时调用会因命令未注册而 reject,允许)。

### 3. npm workspaces

- 根 `package.json` 声明 workspaces:`.`(前端)、`plugin-host`、`packages/myterm-plugin-sdk`、`plugins/*`。
- `packages/myterm-plugin-sdk`:架构文档「插件 SDK」一节的类型**逐字**落地(纯 `.d.ts` + 空实现桩,实现在 M6 注入)。
- `plugin-host/`:空的 Node 20 TS 工程,`main.ts` 只打印版本后退出。
- `plugins/theme-pack`、`plugins/snippets`、`plugins/ai-assistant`:各含合法的 `plugin.json`(内容按架构文档示例风格,权限按各插件实际所需最小声明)和空的 `src/extension.ts`。

### 4. 工具链

- Biome 配置(lint + format,全 workspace 生效);`rustfmt.toml`。
- 根 `package.json` scripts:`typecheck`、`lint`、`test`(vitest,聚合全 workspace)、`tauri`(转发 tauri CLI)。
- `.github/workflows/ci.yml`:push 时跑「完成定义」中的全部命令(Windows runner)。

## 验收命令

```bash
cargo check && cargo clippy -- -D warnings
npm install && npm run typecheck && npm run lint && npm test   # 允许 0 个测试
npm run tauri dev    # 人工:能打开空窗口
```

## 禁止事项

- 不要实现任何 SSH/SFTP/插件逻辑。
- 不要给占位 UI 引入组件库或 CSS 框架(手写少量 CSS 即可)。
- 不要修改架构文档中的类型哪怕一个字段名。

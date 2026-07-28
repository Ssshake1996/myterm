# 03 开发计划

按里程碑顺序执行,每个里程碑对应 `prompts/` 里的一条 AI 指令。**前一个里程碑验收通过并提交后,才开始下一个。**

## 里程碑总览

```
M0 脚手架 ─┬─→ M1 SSH内核 ──→ M2 终端UI ──┬─→ M4 SFTP ────────────┐
           ├─→ M3 配置与凭据 ─────────────┤                        ├─→ M7 AI插件(MVP ✅)─→ M8 打包
           └─→ M5 插件宿主 ───────────────┴─→ M6 插件API+内置插件 ──┘
```

M1、M3、M5 互不依赖,如果你并行开多个 AI 会话,可以同时做。

## 各里程碑明细

### M0 工程脚手架(prompts/01-scaffold.md)

- 产出:Tauri 2 + React/Vite + npm workspaces(plugin-host、sdk、plugins)的空工程;`types.rs`、`ipc.ts`、SDK 类型按架构文档逐字落地;CI 可跑的检查脚本。
- 验收:`cargo check && cargo clippy -- -D warnings && npm run typecheck && npm run lint && npm test` 全部通过(允许 0 个测试);`npm run tauri dev` 能打开空窗口。

### M1 SSH 会话内核(prompts/02-ssh-core.md)

- 产出:`SessionManager`(russh 连接、密码/私钥认证、shell channel、resize、输出环形缓冲)+ Tauri 会话命令与事件。
- 验收:`cargo test -p myterm --test ssh_integration` 通过(依赖本地 Docker sshd,任务内提供 compose 文件);含认证失败、断线状态、并发多会话用例。

### M2 终端视图与标签页(prompts/03-terminal-ui.md)

- 产出:xterm.js 终端组件(二进制数据泵、resize、复制粘贴、搜索)、标签页 + 左右分屏、会话管理器 UI(树/搜索/连接)。
- 验收:`npm test` 通过;人工验收 U2/U3(vim、top、中文、10MB cat 不卡)。

### M3 配置服务与凭据保险库(prompts/04-config-vault.md)

- 产出:`ConfigService`(JSON 持久化 + 原子写)、`CredentialVault`(keyring)、profile CRUD 命令、`--portable` 模式。
- 验收:`cargo test -p myterm config vault` 通过(vault 测试用内存实现注入;keyring 真实读写用 `#[ignore]` 标注手动跑);配置文件中无任何明文密码字符串。

### M4 SFTP 双栏文件管理(prompts/05-sftp.md)

- 产出:`SftpService`(同连接 sftp channel、传输队列、进度事件)+ 双栏 UI(浏览、拖拽、队列面板、取消/重试)。
- 验收:`cargo test -p myterm --test sftp_integration` 通过(Docker sshd);人工验收 U5(100MB 文件上传下载,进度与速度正确,取消生效)。

### M5 插件宿主与权限代理(prompts/06-plugin-host.md)

- 产出:`PluginSupervisor` + `PermissionBroker`(Rust)、plugin-host 骨架(NDJSON JSON-RPC、manifest 扫描、activationEvents 懒加载)、插件安装/授权命令。
- 验收:`cargo test -p myterm plugin` + `npm test -w plugin-host` 通过;含"未授权调用被拒""宿主 kill 后自动重启并恢复激活插件""坏 manifest 被拒绝"用例。

### M6 插件 SDK 与内置插件(prompts/07-plugin-api-builtins.md)

- 产出:SDK 全量 API 落地(terminal/sessions/sftp/config/secrets/window/commands)、前端插件插槽(侧边栏 iframe、命令面板、状态栏)、内置插件 theme-pack 与 snippets。
- 验收:`npm test`(SDK 用 fake RPC 测试);人工验收 U6/U7:安装 snippets 插件弹权限确认,面板点击片段回填终端。

### M7 AI 助手插件(prompts/08-ai-plugin.md)— MVP 完成线

- 产出:ai-assistant 插件:设置页(Base URL/Key/模型/测试连接)、聊天面板(SSE 流式、Markdown、代码块"回填终端"按钮)、`ai.ask` 抓屏提问。
- 验收:
  1. `npm test -w plugins/ai-assistant` 全绿(fetch 用 mock;SSE 解析、抓屏 prompt 组装、错误分支);
  2. **端到端人工验收**:配置任一 OpenAI 兼容服务跑通 U8(推荐用本地 Ollama 或任意兼容网关);
  3. Key 存于 OS 凭据库(`secrets` API),配置 JSON 中无 Key 明文。

### M8 打包与分发(prompts/09-packaging.md)

- 产出:NSIS 安装包 + 便携版单 .exe、Node sidecar 随包、自动更新配置、`--debug`/`--portable` 收尾。
- 验收:干净的 Windows 虚拟机上,两种形态均可双击运行并完成 U1–U8;安装包体积与内存指标达到产品规格的非功能要求。

## 执行纪律(每个里程碑都适用)

1. **一个里程碑 = 一个分支 = 一个 PR**,commit 信息用 `feat(module): ...` 格式。
2. AI 产出后,你(或另一个 AI 会话)按此清单 review:
   - 是否逐字遵守了 `02-architecture.md` 的接口和 RPC 方法表?
   - 是否引入了未登记的依赖?
   - 权限校验是否都发生在 Rust 侧(宿主/前端里的"检查"只能是提示,不算安全边界)?
   - 终端数据面有没有混入 JSON 序列化或逐字节 JS 处理(违反性能约定)?
   - 测试是不是真的在测行为,而不是测实现细节?
3. 验收命令跑不过,把**完整报错原文**贴回给 AI 修,不要自己瞎猜着改。
4. 中途发现接口设计有问题:停下 → 改 `02-architecture.md` → 让 AI 按新接口重构 → 再继续。

## 风险与预案

| 风险 | 预案 |
|---|---|
| russh 对某些老旧 sshd/加密套件不兼容 | M1 集成测试矩阵加 OpenSSH 7.x 容器;确有缺口时在 ssh.rs 适配层解决,`SessionManager` 接口不动 |
| Tauri Channel 二进制通道吞吐不达标 | M2 验收带 10MB cat 基准;不达标则改共享环形缓冲 + requestAnimationFrame 批量取,契约(onData)不动 |
| WebView2 在老 Windows 上缺失 | NSIS 安装包内置 WebView2 Evergreen Bootstrapper;便携版启动时检测并引导下载 |
| Node sidecar 体积拖累"轻量"口碑 | 安装包做成可选组件("插件支持");不装插件宿主时主程序完全可用 |
| iframe 插件 UI 的 XSS 波及主 UI | iframe 加 sandbox 属性 + plugin:// 协议只允许读取该插件自己的目录;主 UI 与 iframe 只经 postMessage 结构化数据通信 |
| AI 插件把公司内网数据发给外部 API | 权限模型中 `network` 在安装时明示;AI 插件文档强调自建网关/内网模型选项(Base URL 可配即天然支持) |

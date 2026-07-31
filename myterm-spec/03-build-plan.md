# 03 开发计划

按里程碑顺序执行,每个里程碑对应 `prompts/` 里的一条 AI 指令。**前一个里程碑验收通过并提交后,才开始下一个。**

## 里程碑总览

```
MVP:
M0 脚手架 ─┬─→ M1 SSH内核 ──→ M2 终端UI+快捷命令 ─┬─→ M4 SFTP ──────┬─→ M6 内置AI ──→ M7 打包(MVP ✅)
           ├─→ M3 配置与凭据 ─────────────────────┤                 │
           └─────────────────────────────────────┴─→ M5 本地终端 ───┘

P2(MVP 发布后):
M8 插件宿主与权限代理 ──→ M9 插件SDK+验证插件
```

M1、M3 互不依赖;M4、M5 互不依赖。如果你并行开多个 AI 会话,可以同时做。

## 各里程碑明细

### M0 工程脚手架(prompts/01-scaffold.md)

- 产出:Tauri 2 + React/Vite 工程;`types.rs`、`ipc.ts` 按架构文档逐字落地;P2 目录(plugin-host、SDK、plugins)只建骨架;CI 可跑的检查脚本。
- 验收:`cargo check && cargo clippy -- -D warnings && npm run typecheck && npm run lint && npm test` 全部通过(允许 0 个测试);`npm run tauri dev` 能打开空窗口。

### M1 SSH 会话内核(prompts/02-ssh-core.md)

- 产出:`SessionManager`(russh 连接、密码/私钥认证、shell channel、resize、输出环形缓冲)+ Tauri 会话命令与事件。
- 验收:`cargo test -p myterm --test ssh_integration` 通过(依赖本地 Docker sshd,任务内提供 compose 文件);含认证失败、断线状态、并发多会话用例。

### M2 终端视图、标签页与快捷命令(prompts/03-terminal-ui.md)

- 产出:xterm.js 终端组件(二进制数据泵、resize、复制粘贴、搜索)、标签页 + 左右分屏、会话管理器 UI(树/搜索/连接)、**底部快捷命令栏**(分组命令集、点击发送、可选自动回车、右键增删改)。
- 验收:`npm test` 通过;人工验收 U2/U3/U8(vim、top、中文、10MB cat 不卡、快捷命令发送正确)。

### M3 配置服务与凭据保险库(prompts/04-config-vault.md)

- 产出:`ConfigService`(JSON 持久化 + 原子写)、`CredentialVault`(keyring)、profile 与快捷命令的 CRUD 命令、`--portable` 模式。
- 验收:`cargo test -p myterm config vault` 通过(vault 测试用内存实现注入;keyring 真实读写用 `#[ignore]` 标注手动跑);配置文件中无任何明文密码字符串。

### M4 SFTP 双栏文件管理(prompts/05-sftp.md)

- 产出:`SftpService`(同连接 sftp channel、传输队列、进度事件)+ 双栏 UI(浏览、拖拽、队列面板、取消/重试)。
- 验收:`cargo test -p myterm --test sftp_integration` 通过(Docker sshd);人工验收 U5(100MB 文件上传下载,进度与速度正确,取消生效)。

### M5 本地终端(prompts/06-local-terminal.md)

- 产出:`session/local.rs`(portable-pty 封装 PowerShell/cmd/WSL)、`localShellList` 检测、会话管理器中的本地终端入口;本地会话同样进环形缓冲(AI 可读)。
- 验收:`cargo test -p myterm local` 通过;人工验收 U9(PowerShell 交互、WSL 内 vim、AI/快捷命令对本地终端可用)。

### M6 内置 AI(prompts/07-ai-service.md)— 产品灵魂

- 产出:`AiService`(Rust:OpenAI 兼容客户端、SSE 流式、多配置档、测试连接)+ AI 面板(流式 Markdown、代码块回填/复制、抓屏提问 Ctrl+Shift+A、停止按钮)+ AI 设置页(服务商预设/Base URL/Key/模型/System Prompt/上下文行数)。
- 验收:
  1. `cargo test -p myterm ai` 全绿(HTTP 层 mock:SSE 拆包、非 2xx、abort、Key 不出现在错误与日志);
  2. `npm test`(面板渲染、回填参数、设置表单);
  3. **端到端人工验收**:配置本地 Ollama 或任一兼容网关跑通 U6/U7;
  4. Key 存于 OS 凭据库,config.json 中无 Key 明文。

### M7 打包与分发(prompts/08-packaging.md)— MVP 完成线

- 产出:NSIS 安装包 + 绿色便携版、`--debug`/`--portable`/`--profile` 收尾、自动更新配置。
- 验收:干净的 Windows 虚拟机上,两种形态均可双击运行并完成 U1–U10;安装包 < 20MB、空载内存 < 80MB。

### M8 插件宿主与权限代理(prompts/p2-plugin-host.md)— P2

- 产出:`PluginSupervisor` + `PermissionBroker`(Rust)、plugin-host(Node sidecar、NDJSON JSON-RPC、manifest 扫描、懒激活)、插件安装/授权命令与 UI。
- 验收:见指令文件(未授权拒绝、崩溃重启、坏 manifest 拒绝等用例)。

### M9 插件 SDK 与验证插件(prompts/p2-plugin-api.md)— P2

- 产出:SDK 全量 API、前端插件插槽(侧边栏 iframe、命令面板、状态栏)、验证插件(theme-pack、log-highlighter)。
- 验收:见指令文件;人工验收原 U6/U7 类场景(安装弹权限、面板可用、读屏高亮)。

## 执行纪律(每个里程碑都适用)

1. **一个里程碑 = 一个分支 = 一个 PR**,commit 信息用 `feat(module): ...` 格式。
2. AI 产出后,你(或另一个 AI 会话)按此清单 review:
   - 是否逐字遵守了 `02-architecture.md` 的接口(含 P2 的 RPC 方法表)?
   - 是否引入了未登记的依赖?
   - Key/密码是否可能出现在日志、错误消息、配置文件里(一票否决)?
   - 终端数据面有没有混入 JSON 序列化或逐字节 JS 处理(违反性能约定)?
   - 测试是不是真的在测行为,而不是测实现细节?
3. 验收命令跑不过,把**完整报错原文**贴回给 AI 修,不要自己瞎猜着改。
4. 中途发现接口设计有问题:停下 → 改 `02-architecture.md` → 让 AI 按新接口重构 → 再继续。

## 风险与预案

| 风险 | 预案 |
|---|---|
| russh 对某些老旧 sshd/加密套件不兼容 | M1 集成测试矩阵加 OpenSSH 7.x 容器;确有缺口时在 ssh.rs 适配层解决,`SessionManager` 接口不动 |
| Tauri Channel 二进制通道吞吐不达标 | M2 验收带 10MB cat 基准;不达标则改共享环形缓冲 + requestAnimationFrame 批量取,契约(onData)不动 |
| 各家"OpenAI 兼容"服务的 SSE 细节有出入(字段缺省、keep-alive、错误体格式) | M6 的 SSE 解析器按最宽容实现(未知字段忽略、空行跳过),测试用例覆盖 OpenAI/DeepSeek/Ollama 三家真实抓包样本 |
| WebView2 在老 Windows 上缺失 | NSIS 安装包内置 WebView2 Evergreen Bootstrapper;便携版启动时检测并引导下载 |
| WSL 不存在/未启用时本地终端体验 | `localShellList` 只返回真实可用的 shell;WSL 缺失时不显示入口 |
| AI 把公司内网数据发给外部 API 的合规担忧 | 抓屏内容发送前在面板中可见;Base URL 可配,天然支持自建网关/内网模型;文档明示数据流向 |
| iframe 插件 UI 的 XSS 波及主 UI(P2) | iframe 加 sandbox 属性 + plugin:// 协议只允许读取该插件自己的目录;主 UI 与 iframe 只经 postMessage 结构化数据通信 |

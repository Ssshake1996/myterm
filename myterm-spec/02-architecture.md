# 02 架构设计(单一事实来源)

本文档定义 myterm **MVP** 的技术栈、进程模型和全部跨模块接口。任何模块的实现与本文档冲突时,以本文档为准;要改接口,先改这里。

P2 的插件体系(插件宿主、权限模型、SDK)单独定义在 [04-plugin-system-p2.md](./04-plugin-system-p2.md),MVP 期间不实施、不引用。

## 技术栈

| 项 | 选择 | 理由 |
|---|---|---|
| 应用框架 | Tauri 2(Rust stable) | 用系统 WebView2 渲染,不打包 Chromium;内核是原生二进制,资源效率最高 |
| SSH/SFTP | `russh` + `russh-sftp` | 纯 Rust,无 OpenSSH 外部依赖,连接/加密/传输全在原生代码 |
| 本地终端 | `portable-pty` | PowerShell / cmd / WSL 的 ConPTY 封装 |
| AI 客户端 | `reqwest`(rustls + stream 特性),SSE 手写解析 | OpenAI 兼容协议只需 `POST /chat/completions` + `GET /models`;放 Rust 侧使 Key 不出原生层、抓屏零跨进程 |
| 凭据存储 | `keyring` crate | 落到 Windows 凭据管理器 / macOS Keychain / libsecret |
| 前端 | TypeScript(strict)+ Vite + React 18 | UI Shell 逻辑轻;React 生态成熟,AI 生成质量高 |
| 终端渲染 | `@xterm/xterm` + webgl / fit / search / web-links addon | VSCode 同款,高吞吐验证充分 |
| Rust 测试 | `cargo test`(集成测试用本地 Docker sshd) | — |
| 前端测试 | `vitest` + `@testing-library/react` | — |
| Lint/格式化 | `clippy` + `rustfmt` / Biome | — |
| 依赖原则 | 除上述外**不引入任何依赖**,需要新依赖必须先在本文档登记 | 控制 AI 乱装包 |

已登记的其他依赖:`serde` / `serde_json` / `tokio` / `thiserror` / `tracing` / `tracing-appender` / `dirs` / `uuid`(Rust);`zustand` / `clsx`(前端)。

## 目录结构

```
myterm/
├── src-tauri/                    # Rust 内核(Tauri app)
│   ├── src/
│   │   ├── main.rs               # 入口:装配、Tauri builder、命令注册
│   │   ├── types.rs              # 本文档「内核类型」一节的全部类型(逐字一致)
│   │   ├── session/
│   │   │   ├── manager.rs        # SessionManager:会话生命周期(SSH + 本地统一管理)
│   │   │   ├── ssh.rs            # russh 封装:握手、认证、shell channel
│   │   │   ├── local.rs          # portable-pty 封装:PowerShell / cmd / WSL
│   │   │   └── buffer.rs         # 每会话 256KB 输出环形缓冲(供 AI 抓屏)
│   │   ├── sftp/
│   │   │   └── service.rs        # SftpService:目录操作 + 传输队列
│   │   ├── ai/
│   │   │   └── service.rs        # AiService:OpenAI 兼容客户端 + 配置档管理
│   │   ├── config/
│   │   │   ├── service.rs        # ConfigService:JSON 配置读写 + 校验(profile/快捷命令/AI 配置档/设置)
│   │   │   └── vault.rs          # CredentialVault:keyring 封装
│   │   └── ipc.rs                # Tauri 命令/事件定义(前端契约的实现)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                          # 前端(WebView)
│   ├── main.tsx
│   ├── ipc.ts                    # 本文档「前端 IPC 契约」的 TS 类型 + invoke 封装(逐字一致)
│   ├── store/                    # zustand:会话/标签/布局状态
│   ├── components/
│   │   ├── terminal/             # TerminalView(xterm.js 挂载与数据泵)
│   │   ├── tabs/                 # 标签页 + 分屏
│   │   ├── quickbar/             # 底部快捷命令栏(命令集切换、按钮、编辑)
│   │   ├── sftp/                 # 双栏文件管理器 + 传输队列面板
│   │   ├── sessions/             # 会话管理器(分组树/搜索/编辑表单)
│   │   ├── ai/                   # AI 面板(聊天/设置)
│   │   └── shell/                # 活动栏、状态栏、toast
├── package.json
└── biome.json
```

**依赖方向(只允许从下往上引用):**

```
前端组件 → src/ipc.ts → (进程边界:Tauri IPC) → src-tauri/ipc.rs → 各 service → types.rs
```

`session`、`sftp`、`ai`、`config` 四个 Rust 模块相互之间**不得 use**,例外仅两处:`sftp` 依赖 `session` 拿连接,`ai` 依赖 `session` 读环形缓冲。它们都只依赖 `types.rs`;装配只发生在 `main.rs`。

## 进程模型与数据面

```
┌─ myterm.exe(Tauri,单进程)────────────────────────────────┐
│  Rust 内核(tokio 多线程运行时)                              │
│   SessionManager(SSH+本地)/ SftpService / AiService /      │
│   ConfigService / CredentialVault                           │
│         ▲ Tauri commands / events / Channel(二进制|流式)    │
│  WebView2 前端(UI Shell + xterm.js + AI 面板)               │
└─────────────────────────────────────────────────────────────┘
```

- **终端数据面**(唯一性能敏感路径):SSH channel / 本地 pty 输出 → Rust 直接经 Tauri `Channel<ArrayBuffer>`(二进制,不经 JSON)推给对应 TerminalView 写入 xterm.js;键入方向走 `terminalWrite` 命令。禁止在中间做任何按字节的 JS 处理。
- **读屏能力**:内核在 `session/buffer.rs` 为每个会话(含本地)维护 256KB 原始输出环形缓冲,AI 抓屏从内核读该缓冲(去除 CSI/OSC 转义后按行返回),**不经前端**,读屏与 UI 解耦。
- **AI 数据面**:前端只发"提问 + 是否附带某会话上下文";AiService 在 Rust 侧拼装消息(注入环形缓冲快照)、发起 SSE 请求、把 delta 经 `Channel<string>` 流回前端。**Key 全程不出内核**。
- **快捷命令**:纯前端行为——点击按钮 → `terminalWrite(activeSession, command [+ "\r"])`;数据经 ConfigService 持久化。

## 内核类型(`src-tauri/src/types.rs`,逐字实现)

```rust
use serde::{Deserialize, Serialize};

// ── 会话配置 ─────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthMethod {
    /// 密码存 vault,此处只有引用键
    Password { vault_ref: String },
    /// OpenSSH 私钥;passphrase(如有)存 vault
    PrivateKey { key_path: String, passphrase_ref: Option<String> },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionTarget {
    Ssh { host: String, port: u16, username: String, auth: AuthMethod },
    /// 本地终端;shell 为可执行名,如 "powershell.exe" / "cmd.exe" / "wsl.exe"
    Local { shell: String },
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionProfile {
    pub id: String,          // uuid v4
    pub name: String,
    pub group: String,       // "/" 分隔的分组路径,如 "prod/db"
    pub target: SessionTarget,
}

// ── 会话运行态 ───────────────────────────────────────────

pub type SessionId = String;   // uuid v4,一次连接一个

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState { Connecting, Connected, Disconnected, Failed }

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: SessionId,
    pub profile_id: String,
    pub state: SessionState,
    /// state == Failed 时的用户可读原因
    pub error: Option<String>,
}

// ── SFTP ────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,        // 绝对路径
    pub is_dir: bool,
    pub size: u64,
    pub modified: i64,       // unix 秒
    pub permissions: String, // "rwxr-xr-x"
}

pub type TransferId = String;

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferState { Queued, Running, Done, Failed, Cancelled }

#[derive(Clone, Serialize, Deserialize)]
pub struct TransferProgress {
    pub transfer_id: TransferId,
    pub state: TransferState,
    pub transferred: u64,
    pub total: u64,
    pub bytes_per_sec: u64,
    pub error: Option<String>,
}

// ── 快捷命令 ─────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct QuickCommand {
    pub id: String,           // uuid v4
    pub label: String,        // 按钮显示名
    pub group: String,        // 命令集名,如 "常用" / "部署"
    pub command: String,      // 发送到终端的文本
    pub send_newline: bool,   // 是否自动回车
    pub sort: u32,            // 组内排序
}

// ── AI ──────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct AiProfile {
    pub id: String,             // uuid v4
    pub name: String,           // 显示名,如 "DeepSeek"
    pub base_url: String,       // 形如 https://api.deepseek.com/v1
    pub api_key_ref: String,    // vault 引用,绝不含明文 Key
    pub model: String,
    pub system_prompt: String,
    pub context_lines: u32,     // 抓屏行数,默认 80
}

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiRole { System, User, Assistant }

#[derive(Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: AiRole,
    pub content: String,
}
```

## 前端 IPC 契约(`src/ipc.ts`,逐字实现;Rust 侧在 `ipc.rs` 对应)

Tauri 命令(前端 → 内核)。所有命令失败时 reject 一个 `{ code: string, message: string }`。

```typescript
// ── 会话 ──
// 连接(SSH 或本地,由 profile.target 决定):成功 resolve SessionId;
// 输出经 onData channel 二进制推送
sessionConnect(profileId: string, cols: number, rows: number,
               onData: Channel<ArrayBuffer>): Promise<string>
sessionDisconnect(sessionId: string): Promise<void>
sessionList(): Promise<SessionInfo[]>
terminalWrite(sessionId: string, dataUtf8: string): Promise<void>
terminalResize(sessionId: string, cols: number, rows: number): Promise<void>

// ── 会话配置 ──
profileList(): Promise<SessionProfile[]>
profileSave(profile: SessionProfile): Promise<void>     // upsert
profileDelete(profileId: string): Promise<void>
vaultSet(ref: string, secret: string): Promise<void>    // 密码/passphrase 写入 OS 凭据库
vaultDelete(ref: string): Promise<void>
localShellList(): Promise<string[]>                     // 检测本机可用 shell(powershell/cmd/wsl)

// ── 快捷命令 ──
quickCommandList(): Promise<QuickCommand[]>
quickCommandSave(cmd: QuickCommand): Promise<void>      // upsert
quickCommandDelete(id: string): Promise<void>
// 发送即复用 terminalWrite;send_newline 由前端拼接 "\r",内核不做特殊处理

// ── SFTP ──
sftpReadDir(sessionId: string, path: string): Promise<RemoteEntry[]>
sftpMkdir(sessionId: string, path: string): Promise<void>
sftpRename(sessionId: string, from: string, to: string): Promise<void>
sftpDelete(sessionId: string, path: string, recursive: boolean): Promise<void>
sftpUpload(sessionId: string, localPath: string, remotePath: string): Promise<TransferId>
sftpDownload(sessionId: string, remotePath: string, localPath: string): Promise<TransferId>
transferCancel(transferId: string): Promise<void>

// ── AI ──
aiProfileList(): Promise<AiProfile[]>                   // 返回值不含 Key(只有 api_key_ref)
aiProfileSave(profile: AiProfile, apiKey?: string): Promise<void>  // apiKey 提供时写入 vault
aiProfileDelete(profileId: string): Promise<void>
aiTestConnection(profileId: string): Promise<{ ok: boolean; models?: number; error?: string }>
// 发起对话:messages 为面板内历史(不含抓屏内容);attachSessionId 非空时,
// 内核把该会话环形缓冲最近 context_lines 行拼进最后一条 user 消息
// (拼接结果同时回传前端展示,用户看得到发出了什么);
// delta 经 onDelta 流回,流结束时 resolve;网络/服务错误 reject { code, message }
aiChat(profileId: string, messages: AiMessage[], attachSessionId: string | null,
       onDelta: Channel<string>): Promise<{ finishReason: "stop" | "aborted" }>
aiAbort(): Promise<void>                                // 中断当前进行中的请求(MVP 全局同时只有一个)
```

Tauri 事件(内核 → 前端,`listen` 订阅):

```typescript
"session://state"      // payload: SessionInfo(连接中/成功/断开/失败)
"transfer://progress"  // payload: TransferProgress(≤10 次/秒/任务节流)
```

## AI 提示词模板(MVP 版,放在 `ai/service.rs` 顶部常量)

抓屏提问时,内核把上下文拼进最后一条 user 消息:

```
[Terminal output of session "{profile_name}" (last {n} lines)]
```
{buffer_snapshot}
```

{user_question}
```

默认 system prompt(用户可在 AiProfile 覆盖):

```
You are a senior Linux operations assistant embedded in an SSH terminal client.
Rules:
- Answer based on the terminal output provided by the user. Do not invent output.
- When suggesting a fix, give the exact command in a fenced code block, one command per block.
- Never suggest destructive commands (rm -rf, dd, mkfs...) without an explicit warning.
- Reply in the language the user writes in.
```

## 错误处理约定

| 层 | 约定 |
|---|---|
| session/ssh | 连接/认证失败不 panic,置 `SessionState::Failed` 并携带用户可读 `error`;连接意外断开发 `session://state`(Disconnected),资源即刻回收 |
| session/local | pty 进程退出即置 `Disconnected`;shell 可执行不存在时 `Failed` 且 error 指明缺失的 shell |
| sftp | 单任务失败置 `TransferState::Failed` 不影响队列其他任务;取消要能中断进行中的读写循环 |
| ai | 网络/服务错误不自动重试(用户可见可重发),reject 的 message 含 HTTP 状态码与 body 摘要,**绝不含 Key**;`aiAbort` 后进行中的流立即停止且 finishReason 为 aborted;日志只记元数据(配置档/模型/token 量级)不记对话内容 |
| config/vault | 配置 JSON 损坏时改名 `.bak-<时间戳>` 后用默认配置,tracing 记 warn,不静默丢弃;所有写入为原子写(临时文件 + rename) |
| 前端 | 所有 invoke 失败 toast 展示 `message`;终端数据通道异常时该标签显示断开态 |

## 安全红线(全模块适用)

1. 密码、私钥 passphrase、AI Key 只存 OS 凭据库;配置文件、日志、错误消息中出现明文即 review 一票否决。
2. AI 请求只发往用户配置的 Base URL;抓屏内容在发送前对用户可见。
3. 终端数据面不经任何第三方处理层。

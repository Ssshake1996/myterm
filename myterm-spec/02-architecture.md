# 02 架构设计(单一事实来源)

本文档定义 myterm 的技术栈、进程模型和**全部跨进程/跨模块接口**。任何模块的实现与本文档冲突时,以本文档为准;要改接口,先改这里。

## 技术栈

| 项 | 选择 | 理由 |
|---|---|---|
| 应用框架 | Tauri 2(Rust stable) | 用系统 WebView2 渲染,不打包 Chromium;内核是原生二进制,资源效率最高 |
| SSH/SFTP | `russh` + `russh-sftp` | 纯 Rust,无 OpenSSH 外部依赖,连接/加密/传输全在原生代码 |
| 凭据存储 | `keyring` crate | 落到 Windows 凭据管理器 / macOS Keychain / libsecret |
| 前端 | TypeScript(strict)+ Vite + React 18 | UI Shell 逻辑轻;React 生态成熟,AI 生成质量高 |
| 终端渲染 | `@xterm/xterm` + webgl / fit / search / web-links addon | VSCode 同款,高吞吐验证充分 |
| 插件宿主 | Node 20 LTS(Tauri sidecar 随包分发) | 换取完整 npm 生态;懒启动,零插件时占用为 0 |
| 宿主↔内核协议 | JSON-RPC 2.0 over stdio(NDJSON 分帧) | 简单、可测、语言无关 |
| Rust 测试 | `cargo test`(集成测试用本地 Docker sshd) | — |
| 前端/宿主/插件测试 | `vitest` | — |
| Lint/格式化 | `clippy` + `rustfmt` / Biome | — |
| 依赖原则 | 除上述外**不引入任何依赖**,需要新依赖必须先在本文档登记 | 控制 AI 乱装包 |

已登记的其他依赖:`serde` / `serde_json` / `tokio` / `thiserror` / `tracing` / `tracing-appender` / `dirs`(Rust);`zustand`(前端状态);`clsx`(前端)。

## 目录结构

```
myterm/
├── src-tauri/                    # Rust 内核(Tauri app)
│   ├── src/
│   │   ├── main.rs               # 入口:装配、Tauri builder、命令注册
│   │   ├── types.rs              # 本文档「内核类型」一节的全部类型(逐字一致)
│   │   ├── session/
│   │   │   ├── manager.rs        # SessionManager:连接生命周期
│   │   │   ├── ssh.rs            # russh 封装:握手、认证、shell channel
│   │   │   └── buffer.rs         # 每会话 256KB 输出环形缓冲(供插件读屏)
│   │   ├── sftp/
│   │   │   └── service.rs        # SftpService:目录操作 + 传输队列
│   │   ├── config/
│   │   │   ├── service.rs        # ConfigService:JSON 配置读写 + 校验
│   │   │   └── vault.rs          # CredentialVault:keyring 封装
│   │   ├── plugin/
│   │   │   ├── supervisor.rs     # PluginSupervisor:宿主进程拉起/监控/重启
│   │   │   ├── rpc.rs            # JSON-RPC 编解码 + 方法分发
│   │   │   └── permission.rs     # PermissionBroker:权限唯一裁决点
│   │   └── ipc.rs                # Tauri 命令/事件定义(前端契约的实现)
│   ├── sidecar/                  # 打包进资源的 node.exe(M8 引入)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                          # 前端(WebView)
│   ├── main.tsx
│   ├── ipc.ts                    # 本文档「前端 IPC 契约」的 TS 类型 + invoke 封装(逐字一致)
│   ├── store/                    # zustand:会话/标签/布局状态
│   ├── components/
│   │   ├── terminal/             # TerminalView(xterm.js 挂载与数据泵)
│   │   ├── tabs/                 # 标签页 + 分屏
│   │   ├── sftp/                 # 双栏文件管理器 + 传输队列面板
│   │   ├── sessions/             # 会话管理器(分组树/搜索)
│   │   └── shell/                # 侧边栏插槽、状态栏、命令面板
│   └── plugin-ui/                # 插件 Webview 的 iframe 装载与 postMessage 桥
├── plugin-host/                  # 插件宿主(独立 Node 工程)
│   ├── src/
│   │   ├── main.ts               # 入口:stdio JSON-RPC、插件加载
│   │   ├── loader.ts             # manifest 解析 + activationEvents 调度
│   │   ├── api.ts                # 把 RPC 封装成 myterm SDK 门面
│   │   └── rpc.ts                # NDJSON 分帧 + JSON-RPC 客户端/服务端
│   └── package.json
├── packages/
│   └── myterm-plugin-sdk/        # 插件开发者用的类型包(@myterm/plugin-sdk)
├── plugins/                      # 内置/官方插件(各自独立可测)
│   ├── theme-pack/
│   ├── snippets/
│   └── ai-assistant/
├── package.json                  # npm workspaces:src、plugin-host、packages、plugins
└── biome.json
```

**依赖方向(只允许从下往上引用):**

```
前端组件 → src/ipc.ts ─┐
插件 → SDK → plugin-host ─┤→ (进程边界:Tauri IPC / JSON-RPC) → src-tauri(ipc.rs / rpc.rs) → 各 service → types.rs
```

`session`、`sftp`、`config`、`plugin` 四个 Rust 模块相互之间**不得 use**(`sftp` 允许依赖 `session` 拿连接),它们只依赖 `types.rs`。装配只发生在 `main.rs`。

## 进程模型

```
┌─ myterm.exe(Tauri)──────────────────────────────────────────┐
│  Rust 内核(tokio 多线程运行时)                                │
│   SessionManager / SftpService / ConfigService /              │
│   CredentialVault / PermissionBroker / PluginSupervisor       │
│         ▲ Tauri commands / events / Channel<binary>           │
│  WebView2 前端(UI Shell + xterm.js + 插件 iframe 插槽)        │
└──────────┬────────────────────────────────────────────────────┘
           │ JSON-RPC 2.0 over stdio(懒启动,崩溃自动重启)
┌──────────▼───────────────────────────┐
│ plugin-host(Node sidecar,单进程)    │
│  所有插件运行于此;每个插件一个         │
│  模块沙箱(独立 require 域 + API 门面) │
└──────────────────────────────────────┘
```

- **终端数据面**:SSH channel 输出 → Rust 直接经 Tauri `Channel<ArrayBuffer>`(二进制,不经 JSON)推给对应 TerminalView 写入 xterm.js;键入方向走 `terminal_write` 命令。这是唯一的性能敏感路径,禁止在中间做任何按字节的 JS 处理。
- **读屏能力**:内核在 `session/buffer.rs` 为每个会话维护 256KB 原始输出环形缓冲。插件读屏从内核读该缓冲(去除 CSI 转义后按行返回),**不经前端**,保证读屏与 UI 解耦。
- **插件 UI**:插件面板是前端里的 iframe,经自定义协议 `plugin://<pluginId>/<path>` 从插件目录加载静态资源;iframe 与插件后端代码之间的消息由前端 → 内核 → 宿主转发(`ui/panelMessage` 双向)。

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
pub struct SessionProfile {
    pub id: String,          // uuid v4
    pub name: String,
    pub group: String,       // "/" 分隔的分组路径,如 "prod/db"
    pub host: String,
    pub port: u16,           // 默认 22
    pub username: String,
    pub auth: AuthMethod,
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

// ── 插件与权限 ───────────────────────────────────────────

/// 权限字符串是封闭集合;新增权限必须先改本文档
pub const PERMISSIONS: &[&str] = &[
    "terminal:read",    // 读屏幕缓冲、订阅输出
    "terminal:write",   // 向终端写入文本
    "sessions:read",    // 列出会话/订阅会话事件
    "sftp:read",        // 远程读目录/下载
    "sftp:write",       // 上传/改名/删除
    "secrets",          // 读写本插件命名空间下的加密存储
    "network",          // 宿主内发起任意网络请求(声明式,宿主不做拦截,仅用于安装时告知用户)
    "clipboard",        // 读写剪贴板
];

#[derive(Clone, Serialize, Deserialize)]
pub struct PluginRecord {
    pub id: String,               // manifest.name
    pub version: String,
    pub dir: String,              // 插件安装目录绝对路径
    pub granted: Vec<String>,     // 用户已同意的权限
    pub enabled: bool,
}
```

## 前端 IPC 契约(`src/ipc.ts`,逐字实现;Rust 侧在 `ipc.rs` 对应)

Tauri 命令(前端 → 内核)。所有命令失败时 reject 一个 `{ code: string, message: string }`。

```typescript
// ── 会话 ──
// 连接:成功 resolve SessionId;输出经 onData channel 二进制推送
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

// ── SFTP ──
sftpReadDir(sessionId: string, path: string): Promise<RemoteEntry[]>
sftpMkdir(sessionId: string, path: string): Promise<void>
sftpRename(sessionId: string, from: string, to: string): Promise<void>
sftpDelete(sessionId: string, path: string, recursive: boolean): Promise<void>
sftpUpload(sessionId: string, localPath: string, remotePath: string): Promise<TransferId>
sftpDownload(sessionId: string, remotePath: string, localPath: string): Promise<TransferId>
transferCancel(transferId: string): Promise<void>

// ── 插件 ──
pluginList(): Promise<PluginRecord[]>
pluginInstallFromDir(dir: string): Promise<PluginRecord>   // 返回含申请权限,前端弹授权 UI
pluginSetGranted(id: string, granted: string[]): Promise<void>
pluginSetEnabled(id: string, enabled: boolean): Promise<void>
pluginCommandInvoke(command: string, args?: unknown): Promise<void>  // 命令面板/快捷键触发
panelPostMessage(panelId: string, message: unknown): Promise<void>   // iframe → 插件后端
```

Tauri 事件(内核 → 前端,`listen` 订阅):

```typescript
"session://state"      // payload: SessionInfo(连接中/成功/断开/失败)
"transfer://progress"  // payload: TransferProgress(≤10 次/秒/任务节流)
"plugin://ui"          // payload: PluginUiEvent(见下),插件对 UI 的全部指令
"plugin://crashed"     // payload: { restarts: number },宿主崩溃重启通知
```

```typescript
type PluginUiEvent =
  | { type: "registerCommand"; pluginId: string; command: string; title: string }
  | { type: "registerPanel"; pluginId: string; panelId: string; title: string;
      icon: string; entry: string }               // entry: 插件目录内相对路径,经 plugin:// 加载
  | { type: "setStatusBarItem"; pluginId: string; itemId: string;
      text: string; tooltip?: string; command?: string }
  | { type: "removeStatusBarItem"; pluginId: string; itemId: string }
  | { type: "panelMessage"; panelId: string; message: unknown }   // 插件后端 → iframe
  | { type: "showMessage"; level: "info" | "warn" | "error"; text: string };
```

## 插件清单(`plugin.json`,置于插件目录根)

```json
{
  "name": "ai-assistant",
  "version": "0.1.0",
  "displayName": "AI 助手",
  "description": "OpenAI 兼容协议的终端 AI 问答",
  "main": "dist/extension.js",
  "engines": { "myterm": "^0.1.0" },
  "activationEvents": ["onCommand:ai.ask", "onPanel:ai.chat"],
  "permissions": ["terminal:read", "terminal:write", "secrets", "network"],
  "contributes": {
    "commands": [{ "command": "ai.ask", "title": "AI: 询问当前屏幕" }],
    "panels": [{ "id": "ai.chat", "title": "AI 助手", "icon": "sparkles", "entry": "ui/index.html" }],
    "keybindings": [{ "command": "ai.ask", "key": "ctrl+shift+a" }],
    "configuration": {
      "ai.baseUrl": { "type": "string", "default": "https://api.openai.com/v1" },
      "ai.model": { "type": "string", "default": "gpt-4o-mini" }
    }
  }
}
```

约定:

- `activationEvents` 支持 `onCommand:<id>`、`onPanel:<id>`、`onStartup`(慎用);未触发不加载 `main`。
- `contributes` 是纯声明,由宿主在扫描 manifest 时上报内核 → 前端渲染;插件代码未激活时命令/面板已可见,首次触发时才激活。
- `permissions` 只声明不授予;用户在安装时勾选授予,内核持久化到 `PluginRecord.granted`。

## 插件 SDK(`@myterm/plugin-sdk`,逐字实现)

插件 `main` 导出 `activate(ctx)` / 可选 `deactivate()`:

```typescript
export interface ExtensionContext {
  /** 插件安装目录绝对路径 */
  extensionPath: string;
  /** 注册可释放资源,插件停用时统一 dispose */
  subscriptions: { dispose(): void }[];
}

export namespace myterm {
  export namespace commands {
    /** 注册 manifest 中声明过的命令的实现 */
    export function registerCommand(command: string,
      handler: (args?: unknown) => void | Promise<void>): Disposable;
  }

  export namespace window {
    export function showMessage(level: "info" | "warn" | "error", text: string): void;
    /** 取得 manifest 声明的面板的消息通道 */
    export function getPanel(panelId: string): PanelHandle;
  }
  export interface PanelHandle {
    postMessage(message: unknown): void;
    onDidReceiveMessage(cb: (message: unknown) => void): Disposable;
  }

  export namespace terminal {
    /** 活动终端会话 id;无终端时 undefined。需 sessions:read */
    export function activeSessionId(): Promise<string | undefined>;
    /** 读屏:返回去除转义序列后的最近 lines 行。需 terminal:read */
    export function getBuffer(sessionId: string, lines: number): Promise<string>;
    /** 订阅输出(节流为 ≥100ms 批次)。需 terminal:read */
    export function onDidWriteData(sessionId: string,
      cb: (chunkUtf8: string) => void): Disposable;
    /** 写入文本;addNewline 默认 false。需 terminal:write */
    export function sendText(sessionId: string, text: string,
      addNewline?: boolean): Promise<void>;
  }

  export namespace sessions {
    export function list(): Promise<SessionInfo[]>;                       // 需 sessions:read
    export function onDidChangeState(cb: (s: SessionInfo) => void): Disposable;
  }

  export namespace sftp {
    export function readDir(sessionId: string, path: string): Promise<RemoteEntry[]>; // sftp:read
    export function upload(sessionId: string, local: string, remote: string): Promise<void>;   // sftp:write
    export function download(sessionId: string, remote: string, local: string): Promise<void>; // sftp:read
  }

  export namespace config {
    /** 读 manifest configuration 声明的键(含用户覆盖值) */
    export function get<T>(key: string): Promise<T>;
    export function set(key: string, value: unknown): Promise<void>;
  }

  export namespace secrets {
    /** 按插件 id 命名空间隔离,底层走 CredentialVault。需 secrets */
    export function get(key: string): Promise<string | undefined>;
    export function set(key: string, value: string): Promise<void>;
    export function delete_(key: string): Promise<void>;
  }
}
```

## 宿主 ↔ 内核 JSON-RPC 方法表

NDJSON 分帧(每行一个 JSON-RPC 2.0 消息)。内核为 server 的方法带 `pluginId` 参数,**内核逐调用经 PermissionBroker 校验**,未授权返回 error `{ code: -32001, message: "permission denied: <perm>" }`。

| 方向 | 方法 | 参数 → 结果 | 权限 |
|---|---|---|---|
| 宿主→核 | `host/ready` | manifest 扫描结果(全部插件的 contributes)→ ack | — |
| 宿主→核 | `terminal/getBuffer` | `{pluginId, sessionId, lines}` → `{text}` | terminal:read |
| 宿主→核 | `terminal/subscribe` | `{pluginId, sessionId}` → `{subId}` | terminal:read |
| 宿主→核 | `terminal/sendText` | `{pluginId, sessionId, text, addNewline}` → ack | terminal:write |
| 宿主→核 | `sessions/list` | `{pluginId}` → `SessionInfo[]` | sessions:read |
| 宿主→核 | `sessions/active` | `{pluginId}` → `{sessionId?}` | sessions:read |
| 宿主→核 | `sftp/readDir` 等 | 同 SDK | sftp:* |
| 宿主→核 | `config/get` / `config/set` | `{pluginId, key, value?}` | — |
| 宿主→核 | `secrets/get` / `set` / `delete` | `{pluginId, key, value?}` | secrets |
| 宿主→核 | `ui/event` | `PluginUiEvent` → ack(转发给前端) | —(registerPanel 等仅限自己的 pluginId) |
| 核→宿主 | `plugin/activate` | `{pluginId, reason}` → ack | — |
| 核→宿主 | `plugin/deactivate` | `{pluginId}` → ack | — |
| 核→宿主 | `command/invoke` | `{command, args}` → ack | — |
| 核→宿主 | `terminal/data`(通知) | `{subId, chunkUtf8}` | — |
| 核→宿主 | `sessions/stateChanged`(通知) | `SessionInfo` | — |
| 核→宿主 | `ui/panelMessage`(通知) | `{panelId, message}`(iframe → 插件) | — |

## 错误处理约定

| 层 | 约定 |
|---|---|
| session/ssh | 连接/认证失败不 panic,置 `SessionState::Failed` 并携带用户可读 `error`;连接意外断开发 `session://state`(Disconnected),资源即刻回收 |
| sftp | 单任务失败置 `TransferState::Failed` 不影响队列其他任务;取消要能中断进行中的读写循环 |
| PermissionBroker | 拒绝即 RPC error,**绝不 panic**;每次拒绝写 tracing 日志(插件 id + 方法 + 缺失权限) |
| PluginSupervisor | 宿主进程退出即重启(1s/2s/4s 退避,10 分钟窗口内超过 5 次则放弃并通知前端);重启后重发 `plugin/activate` 恢复已激活插件 |
| plugin-host | 单个插件 `activate`/handler 抛异常只记日志 + `ui/event(showMessage)`,不得拖垮宿主进程;所有 RPC 调用 30s 超时 |
| 前端 | 所有 invoke 失败 toast 展示 `message`;终端数据通道异常时该标签显示断开态 |

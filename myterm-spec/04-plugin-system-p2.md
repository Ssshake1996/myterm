# 04 插件体系设计(P2,单一事实来源)

本文档定义 myterm P2 阶段的插件体系:插件宿主、权限模型、SDK 与 RPC 契约。**MVP 期间不实施**;实施时本文档与 `02-architecture.md` 同级,冲突时先改文档再写码。

设计目标:像 VSCode 一样"内核极小、扩展靠插件",同时补上 VSCode 没有的**安装期权限模型**——插件的每一次敏感调用都经 Rust 内核裁决。

## 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 插件语言 | TypeScript(npm 生态) | 开发者基数最大,与写 VSCode 插件体验一致 |
| 插件宿主 | Node 20 LTS(Tauri sidecar 随包分发,安装包中为可选组件) | 换取完整 npm 生态;懒启动,零插件时占用为 0 |
| 宿主↔内核协议 | JSON-RPC 2.0 over stdio(NDJSON 分帧) | 简单、可测、语言无关 |
| 插件 UI | 前端 iframe + 自定义协议 `plugin://` | sandbox 隔离,主 UI 只经 postMessage 通信 |

新增目录(在 `02-architecture.md` 目录结构基础上):

```
├── src-tauri/src/plugin/
│   ├── supervisor.rs     # PluginSupervisor:宿主进程拉起/监控/重启
│   ├── rpc.rs            # JSON-RPC 编解码 + 方法分发
│   └── permission.rs     # PermissionBroker:权限唯一裁决点
├── src-tauri/sidecar/    # 打包进资源的 node.exe(不入 git)
├── plugin-host/          # 插件宿主(独立 Node 工程:main/loader/api/rpc)
├── packages/myterm-plugin-sdk/   # @myterm/plugin-sdk 类型包
└── plugins/              # 验证插件:theme-pack / log-highlighter
```

## 进程模型

```
myterm.exe(Rust 内核 + WebView 前端)
   │ JSON-RPC 2.0 over stdio(懒启动,崩溃自动重启)
plugin-host(Node sidecar,单进程)
   所有插件运行于此;每个插件一个模块沙箱(独立 require 域 + 注入 pluginId 的 API 门面)
```

- 零 enabled 插件时宿主进程不启动;全部禁用后 30s 空闲回收。
- 插件面板是前端 iframe(`plugin://<pluginId>/<path>`,sandbox="allow-scripts",协议只允许读取该插件自己的安装目录);iframe ↔ 插件后端的消息由前端 → 内核 → 宿主双向转发。
- 安全边界在内核:宿主即使被恶意插件攻破,拿不到未授权的能力。

## 内核类型(实施时并入 `types.rs`)

```rust
/// 权限字符串是封闭集合;新增权限必须先改本文档
pub const PERMISSIONS: &[&str] = &[
    "terminal:read",    // 读屏幕缓冲、订阅输出
    "terminal:write",   // 向终端写入文本
    "sessions:read",    // 列出会话/订阅会话事件
    "sftp:read",        // 远程读目录/下载
    "sftp:write",       // 上传/改名/删除
    "secrets",          // 读写本插件命名空间下的加密存储
    "network",          // 宿主内发起任意网络请求(声明式,仅用于安装时告知用户)
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

## 前端 IPC 契约增补(实施时并入 `ipc.ts`)

```typescript
pluginList(): Promise<PluginRecord[]>
pluginInstallFromDir(dir: string): Promise<PluginRecord>   // 返回含申请权限,前端弹授权 UI
pluginSetGranted(id: string, granted: string[]): Promise<void>
pluginSetEnabled(id: string, enabled: boolean): Promise<void>
pluginCommandInvoke(command: string, args?: unknown): Promise<void>  // 命令面板/快捷键触发
panelPostMessage(panelId: string, message: unknown): Promise<void>   // iframe → 插件后端
focusSession(sessionId: string): Promise<void>   // 前端窗格聚焦时上报,支撑 sessions/active
```

事件:

```typescript
"plugin://ui"        // payload: PluginUiEvent(见下),插件对 UI 的全部指令
"plugin://crashed"   // payload: { restarts: number },宿主崩溃重启通知
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
  "name": "log-highlighter",
  "version": "0.1.0",
  "displayName": "日志高亮",
  "description": "按关键词规则统计终端输出并在侧栏展示",
  "main": "dist/extension.js",
  "engines": { "myterm": "^0.2.0" },
  "activationEvents": ["onCommand:loghl.toggle", "onPanel:loghl.stats"],
  "permissions": ["terminal:read", "sessions:read"],
  "contributes": {
    "commands": [{ "command": "loghl.toggle", "title": "日志统计: 开/关" }],
    "panels": [{ "id": "loghl.stats", "title": "日志统计", "icon": "chart", "entry": "ui/index.html" }],
    "keybindings": [{ "command": "loghl.toggle", "key": "ctrl+shift+l" }],
    "configuration": {
      "loghl.rules": { "type": "array", "default": ["ERROR", "WARN", "Exception"] }
    }
  }
}
```

约定:

- `activationEvents` 支持 `onCommand:<id>`、`onPanel:<id>`、`onStartup`(慎用);未触发不加载 `main`。
- `contributes` 是纯声明,由宿主扫描 manifest 时上报内核 → 前端渲染;插件代码未激活时命令/面板已可见,首次触发才激活。
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
    /** 读 manifest configuration 声明的键(含用户覆盖值),键自动加 plugin.<pluginId>. 前缀 */
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
| 宿主→核 | `secrets/get` / `set` / `delete` | `{pluginId, key, value?}`(vault ref:`plugin.<pluginId>.<key>`) | secrets |
| 宿主→核 | `ui/event` | `PluginUiEvent` → ack(转发给前端;registerPanel 等仅限自己的 pluginId) | — |
| 核→宿主 | `plugin/activate` | `{pluginId, reason}` → ack | — |
| 核→宿主 | `plugin/deactivate` | `{pluginId}` → ack | — |
| 核→宿主 | `command/invoke` | `{command, args}` → ack | — |
| 核→宿主 | `terminal/data`(通知) | `{subId, chunkUtf8}` | — |
| 核→宿主 | `sessions/stateChanged`(通知) | `SessionInfo` | — |
| 核→宿主 | `ui/panelMessage`(通知) | `{panelId, message}`(iframe → 插件) | — |

## 错误处理约定

| 层 | 约定 |
|---|---|
| PermissionBroker | 拒绝即 RPC error,**绝不 panic**;每次拒绝写 tracing 日志(插件 id + 方法 + 缺失权限);方法→权限映射表之外的方法一律拒绝,不留"默认放行"分支 |
| PluginSupervisor | 宿主进程退出即重启(1s/2s/4s 退避,10 分钟窗口内超过 5 次则放弃并通知前端);重启后重发 `plugin/activate` 恢复已激活插件 |
| plugin-host | 单个插件 `activate`/handler 抛异常只记日志 + `ui/event(showMessage)`,不得拖垮宿主进程;所有 RPC 调用 30s 超时 |

## 验证插件(与插件系统一起交付,用自家插件打磨 API)

- **theme-pack**:contributes.configuration 声明主题名;前端读取该配置键应用 CSS 变量(声明式消费,验证 configuration 贡献点)。
- **log-highlighter**:订阅终端输出,按关键词规则统计,侧栏面板展示计数(验证 terminal:read、面板 postMessage、activationEvents 懒加载)。

对应任务指令:`prompts/p2-plugin-host.md`(宿主与权限)、`prompts/p2-plugin-api.md`(SDK、前端插槽与验证插件)。

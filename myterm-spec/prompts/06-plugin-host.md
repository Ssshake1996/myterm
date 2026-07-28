# M5 任务指令:插件宿主与权限代理

## 需要附上的上下文

- `02-architecture.md` 全文(重点:进程模型、插件清单、宿主↔内核 JSON-RPC 方法表、权限模型、错误处理约定)
- `src-tauri/src/types.rs`、`src-tauri/src/main.rs`、`plugin-host/src/main.ts`

## 任务

打通"内核 ⇄ 插件宿主"这条通道:Rust 侧实现宿主进程管理 + JSON-RPC 分发 + 权限裁决,Node 侧实现宿主骨架(manifest 扫描、懒激活、RPC 双向通信)。**本任务不实现 SDK 的具体 API 语义**(M6),RPC 方法先接到内核已有能力(terminal/sessions)+ 桩。

## 交付物

### 1. `src-tauri/src/plugin/supervisor.rs`

- `PluginSupervisor`:
  - 懒启动:首个 enabled 插件出现时才 spawn 宿主(开发期用系统 `node plugin-host/dist/main.js`,路径可配;sidecar 打包在 M8);
  - stdio 管道接 `rpc.rs`;stderr 直通 tracing;
  - 崩溃重启:按错误处理约定的退避与放弃策略,重启后重发 `plugin/activate` 恢复已激活集合,并向前端发 `plugin://crashed`;
  - 零 enabled 插件时不启动;全部禁用后 30s 空闲则回收进程。

### 2. `src-tauri/src/plugin/rpc.rs`

- NDJSON 分帧的 JSON-RPC 2.0 编解码;方法表按架构文档**逐条**注册;
- 内核为 server 的方法先过 PermissionBroker,再分发到对应 service;`ui/event` 校验 pluginId 与事件归属一致后转发前端 `plugin://ui`;
- 内核为 client 的方法(`plugin/activate` 等)带 30s 超时。

### 3. `src-tauri/src/plugin/permission.rs`

- `PermissionBroker`:`check(plugin_id, permission) -> Result<(), Denied>`;
- 数据源:`PluginRecord.granted`(存于 ConfigService 的 settings 命名空间 `plugins.records`);
- 每次拒绝记 tracing(插件 id + 方法 + 缺失权限);方法 → 所需权限的映射表就放本文件,与架构文档方法表逐条对应。

### 4. `src-tauri/src/ipc.rs`(插件部分)

- `plugin_list` / `plugin_install_from_dir`(校验 manifest:必填字段、permissions ∈ 封闭集合、engines 兼容;非法则拒绝并给出具体原因)/ `plugin_set_granted` / `plugin_set_enabled` / `plugin_command_invoke` / `panel_post_message`。

### 5. `plugin-host/src/`(rpc.ts / loader.ts / main.ts)

- rpc.ts:NDJSON JSON-RPC 客户端 + 服务端(stdin/stdout);
- loader.ts:启动时扫描传入的插件目录列表 → 解析 manifest → 汇总 contributes 经 `host/ready` 上报;维护 activationEvents 索引;收到 `plugin/activate` 时 `require` 插件 main 并调用 `activate(ctx)`,`command/invoke` 触发对应 handler;
- 隔离:每个插件独立的 API 门面实例(注入 pluginId,M6 填充具体实现);插件代码抛异常只影响该插件(try/catch + 日志 + `ui/event` showMessage);
- main.ts:进程入口,未捕获异常记日志后退出码 1(交给 supervisor 重启)。

### 6. 测试

- Rust(`src-tauri/tests/plugin_host.rs`,用一个假宿主脚本——Node 一行 echo server——替代真宿主):
  1. 未授权的 `terminal/getBuffer` → error -32001;
  2. 授权后同调用 → 正常返回(接 M1 的环形缓冲);
  3. kill 宿主进程 → 自动重启 → `plugin/activate` 重发;
  4. 10 分钟窗口 5 次崩溃 → 放弃并发前端事件;
  5. 坏 manifest(缺 main / 未知权限)→ `plugin_install_from_dir` 拒绝且原因明确。
- Node(vitest,内存双工流替代 stdio):
  1. `host/ready` 汇总两个插件的 contributes;
  2. `onCommand` 触发才 require(用计数桩验证懒加载);
  3. 插件 activate 抛异常 → 宿主存活,`ui/event` 收到 error showMessage;
  4. RPC 请求/响应 id 配对与并发正确性。

## 禁止事项

- 不要实现 SDK 各命名空间的业务语义(M6)。
- 不要用 Node 的 `vm` 或 worker 做强沙箱(MVP 接受同进程模块隔离,安全边界在内核权限层)。
- 权限映射表之外的方法一律拒绝,不要留"默认放行"分支。

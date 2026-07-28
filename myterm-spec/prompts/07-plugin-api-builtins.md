# M6 任务指令:插件 SDK 与内置插件

## 需要附上的上下文

- `02-architecture.md` 全文(重点:插件 SDK、宿主↔内核 RPC 方法表、PluginUiEvent、前端 IPC 契约的插件部分)
- `packages/myterm-plugin-sdk/`、`plugin-host/src/api.ts`、`src/components/shell/`、M5 产出的 rpc/loader

## 任务

把插件系统做到"插件开发者可用":SDK 全量 API 接通 RPC、前端渲染插件贡献的 UI(侧边栏面板 / 命令面板 / 状态栏 / 快捷键),并交付两个内置插件验证闭环。完成产品规格 U6、U7。

## 交付物

### 1. `plugin-host/src/api.ts` + SDK 实现注入

- 按 SDK 接口**逐字**实现全部命名空间(commands / window / terminal / sessions / sftp / config / secrets),内部走 M5 的 RPC 客户端,注入调用方 pluginId;
- `terminal.onDidWriteData`:宿主对 `terminal/subscribe` 的通知做 ≥100ms 批量合并后回调;Disposable.dispose 取消订阅;
- `config.get/set`:键自动加 `plugin.<pluginId>.` 前缀存 ConfigService settings;manifest `configuration` 声明的 default 在 get 时兜底;
- 权限不足时 SDK 方法 reject `Error("permission denied: <perm>")`,不吞错。

### 2. 内核补齐 RPC 方法

- M5 留桩的 `sftp/*`、`config/*`、`secrets/*` 接到对应 service(secrets 的 vault ref 规则:`plugin.<pluginId>.<key>`);
- `sessions/active`:内核跟踪前端活动窗格的 sessionId(前端在窗格聚焦时上报,`src/ipc.ts` 增补 `focusSession(sessionId)` 命令——此为本任务允许的唯一契约增补,需同步更新架构文档)。

### 3. 前端插件 UI 插槽 `src/components/shell/` + `src/plugin-ui/`

- 订阅 `plugin://ui` 渲染:
  - 侧边栏:registerPanel → 活动栏图标 + iframe(`plugin://<id>/<entry>`,sandbox="allow-scripts";与主 UI 只经 postMessage);iframe 消息 → `panelPostMessage`;`panelMessage` 事件 → iframe postMessage;
  - 命令面板:Ctrl+Shift+P 打开,列出全部 registerCommand 的命令,回车 → `pluginCommandInvoke`;
  - 状态栏项、showMessage toast;
  - manifest keybindings 注册到全局快捷键 → `pluginCommandInvoke`;
- `plugin://` 自定义协议(Rust 侧):只允许读取该插件安装目录内文件,路径穿越一律 404;
- 插件管理页:列表(启用开关)、"从目录安装"(弹权限确认清单,确认后 `pluginSetGranted`)。

### 4. 内置插件

- `plugins/theme-pack`:contributes.configuration 声明 `theme.name`(dark/light/solarized);activate 时读取配置并经 panelMessage 之外的约定——直接由前端读取该配置键应用 CSS 变量(说明:主题是纯声明式消费,插件代码只负责在配置变化时 showMessage 提示重载;保持简单);
- `plugins/snippets`:侧边栏面板列出用户片段(存 config),点击 → `terminal.sendText(active, text, false)`;面板内可增删片段;声明权限 `terminal:write`、`sessions:read`。

### 5. 测试

- SDK(vitest,fake RPC 服务端):每个命名空间 ≥2 用例,含权限拒绝路径、onDidWriteData 批量合并、dispose 后不再回调;
- 前端:PluginUiEvent 序列 → 面板/命令/状态栏正确渲染;命令面板回车调用 `pluginCommandInvoke`;iframe postMessage 双向桥;
- Rust:`plugin://` 协议的路径穿越用例(`../` 被拒);
- snippets 插件:面板消息 → sendText 参数正确(fake SDK)。

## 人工验收

- 安装 snippets:权限确认弹出 → 同意 → 侧边栏出现图标 → 添加片段"ls -la"→ 点击 → 活动终端出现文本未回车。

## 禁止事项

- 不要实现 AI 插件(M7)。
- 不要给 iframe 放开 sandbox(不允许 allow-same-origin)。
- SDK 公共签名不得偏离架构文档;发现不够用,按流程先改文档。

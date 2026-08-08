# M9 任务指令(P2):插件 SDK、前端插槽与验证插件

## 需要附上的上下文

- `04-plugin-system-p2.md` 全文(插件体系的单一事实来源)
- `packages/myterm-plugin-sdk/`、`plugin-host/src/api.ts`、`src/components/shell/`、M8 产出的 rpc/loader

## 任务

把插件系统做到"插件开发者可用":SDK 全量 API 接通 RPC、前端渲染插件贡献的 UI(侧边栏面板 / 命令面板 / 状态栏 / 快捷键),并交付两个验证插件闭环。

## 交付物

### 1. `plugin-host/src/api.ts` + SDK 实现注入

- 按 04 文档 SDK 接口**逐字**实现全部命名空间(commands / window / terminal / sessions / sftp / config / secrets),内部走 M8 的 RPC 客户端,注入调用方 pluginId;
- `terminal.onDidWriteData`:宿主对 `terminal/subscribe` 的通知做 ≥100ms 批量合并后回调;Disposable.dispose 取消订阅;
- `config.get/set`:键自动加 `plugin.<pluginId>.` 前缀存 ConfigService settings;manifest `configuration` 声明的 default 在 get 时兜底;
- 权限不足时 SDK 方法 reject `Error("permission denied: <perm>")`,不吞错。

### 2. 内核补齐 RPC 方法

- M8 留桩的 `sftp/*`、`config/*`、`secrets/*` 接到对应 service(secrets 的 vault ref 规则:`plugin.<pluginId>.<key>`);
- `sessions/active`:内核跟踪前端活动窗格的 sessionId(前端窗格聚焦时经 `focusSession` 上报)。

### 3. 前端插件 UI 插槽 `src/components/shell/` + `src/plugin-ui/`

- 订阅 `plugin://ui` 渲染:
  - 侧边栏:registerPanel → 活动栏图标 + iframe(`plugin://<id>/<entry>`,sandbox="allow-scripts";与主 UI 只经 postMessage);iframe 消息 → `panelPostMessage`;`panelMessage` 事件 → iframe postMessage;
  - 命令面板:Ctrl+Shift+P 打开,列出全部 registerCommand 的命令,回车 → `pluginCommandInvoke`;
  - 状态栏项、showMessage toast;
  - manifest keybindings 注册到全局快捷键 → `pluginCommandInvoke`(与内置快捷键冲突时内置优先并在插件管理页提示);
- `plugin://` 自定义协议(Rust 侧):只允许读取该插件安装目录内文件,路径穿越一律 404;
- 插件管理页:列表(启用开关)、"从目录安装"(弹权限确认清单,确认后 `pluginSetGranted`)。

### 4. 验证插件

- `plugins/theme-pack`:contributes.configuration 声明 `theme.name`(dark/light/solarized);前端读取该配置键应用 CSS 变量;插件代码只在配置变化时 showMessage 提示(验证 configuration 贡献点的声明式消费);
- `plugins/log-highlighter`:`onDidWriteData` 订阅活动会话输出,按 `loghl.rules` 关键词计数,侧栏面板实时展示;`loghl.toggle` 命令开关统计(验证 terminal:read、面板 postMessage、懒加载)。

### 5. 测试

- SDK(vitest,fake RPC 服务端):每个命名空间 ≥2 用例,含权限拒绝路径、onDidWriteData 批量合并、dispose 后不再回调;
- 前端:PluginUiEvent 序列 → 面板/命令/状态栏正确渲染;命令面板回车调用 `pluginCommandInvoke`;iframe postMessage 双向桥;
- Rust:`plugin://` 协议的路径穿越用例(`../` 被拒);
- log-highlighter:输出片段流入 → 计数消息正确(fake SDK)。

## 人工验收

- 从目录安装 log-highlighter:权限确认弹出(terminal:read、sessions:read)→ 同意 → 侧边栏出现图标 → 终端里 `echo ERROR` 三次 → 面板计数 +3;Ctrl+Shift+P 执行「日志统计: 开/关」生效。

## 禁止事项

- 不要给 iframe 放开 sandbox(不允许 allow-same-origin)。
- SDK 公共签名不得偏离 04 文档;发现不够用,按流程先改文档。
- 不要动 MVP 已交付模块的公共接口。

# 环境抽屉与顶部空间优化：本地验收

日期：2026-11-10。本文记录公开发布前的本机验收，验收时使用独立本地包。正式版本说明见 [v0.15.3 发布说明](../releases/dsh-remote-ops-v0.15.3.md)。

## 改动

- 环境管理改为插件工作区内的左侧抽屉。默认 360px 浮层；面板小于 480px 时占满工作区；达到 960px 后可固定为 320px，并记住固定偏好。收窄时自动恢复浮层。
- 顶部工具栏约 40px、工作区标签按钮 36px，收紧按钮间距和网页地址栏留白。保留图标、文字、键盘操作及后台状态徽标。
- 抽屉集中展示搜索、分组选择和环境列表。行内保留“连接/使用”和“更多”，编辑、测试、删除位于更多菜单。SSH 与 API 表单共用抽屉，保存/取消操作固定在底部。
- 关闭、Esc 和点击遮罩返回原工作区；焦点返回环境入口。保留普通草稿，关闭时清除已查看的密码并取消未完成的密码读取。
- 终端、网页和 API 保持挂载。浮层开关不改变网页视口、不关闭连接、不停止录制。API 环境内容通过宿主 ReactDOM portal 放入插件自己的抽屉节点。

## 自动验证

- `npm run check --prefix integrations/dsh-remote-ops`：491 项通过（338 单元、130 客户端、12 契约、11 桌面），语法、生成文件一致性和 smoke 均通过。
- DSH UI 契约检查：源码和验收包均通过。
- 6 组真实浏览器回归通过：环境抽屉、环境管理、密码显示与清理、终端标签、工作区状态保持、API 请求。
- 覆盖 390px/570px/宽屏、暗色、固定后收窄、Esc 与焦点、请求草稿、同一终端 DOM 和网页会话、抽屉打开期间 Agent 操作及录制导出。
- 报告：`output/e2e/environment-drawer-3/`、`output/e2e/drawer-terminal-tabs/`、`output/e2e/drawer-layout/`、`output/e2e/drawer-api/`。

## 本机 DSH 验证

- Windows，DSH Desktop 0.2.1-rc.5，窗口 1282×822；实际 desktop profile 通过插件管理界面安装并完整重启。
- 更新页“当前运行”和“已安装”均显示 0.15.3。使用独立本地验收包区分已有 0.15.2 缓存；当时仓库发布版本元数据仍为 0.15.2，尚未打标签或公开发布。
- 浮层、全屏固定、退出全屏恢复浮层均通过；Esc 后按回车能重新打开，SSH/API 未保存草稿保留，终端输出保留。
- 专用内置 Chromium 正常打开本地测试网页，安装包自带运行时检查通过，无需额外下载安装浏览器。
- 抽屉开关前后分别输入 `DRAWER_BEFORE_0153` / `DRAWER_AFTER_0153`，页面保存次数连续从 1 增至 2。停止并从 UI 导出 25 条事件；同一 browser/page，两个标记均存在，抽屉搜索输入未进入网页记录，无未完成动作。
- 验收仅使用本地测试页和本地 CMD；未连接现有外部设备。390px/暗色和 Agent 并发操作在浏览器测试环境验证，本机 UI 验证的是人工操作连续性。
- 安装日志包含既有可选 `cpu-features` 编译警告；插件安装成功，自带浏览器检查和实际启动通过。

## 证据与构建

- 汇总：`output/local-drawer/evidence.json`；可重复核对：`node output/local-drawer/verify-evidence.mjs`。
- 原始录制：`output/local-drawer/native/drawer-recording.json`。
- 界面截图：`output/local-drawer/native/overlay.jpg`、`pinned.jpg`、`api-form.jpg`、`recording-preserved.jpg`、`version.jpg`。
- 本地包：`output/local-drawer/dsh-remote-ops-0.15.3.tgz`，SHA256 `0622232bdde98ffcc4e4be90d9899d989848245ebb3f9f668525faffecd70720`。
- 验收包从通过检查的源码打包，仅在独立 staging 中修改版本及客户端文件名；已核对安装后的客户端与源码仅版本标记不同。README 操作说明随后在仓库中更新。
- 安装前 profile 配置备份：`<DSH_HOME>/backups/remote-ops-environment-drawer-20261110/`。其余两个本地插件依赖保持原值。

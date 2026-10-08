# dsh-remote-ops v0.2.23

## 变更

- 兼容 DSH `0.2.0-rc.2` 的 `Regular` 图标导出，同时保留旧版按尺寸命名导出的回退，修复 Remote Ops 面板因图标组件为 `undefined` 而空白的问题。
- 右侧 Sidebar 启动入口改用同一套宿主图标，避免依赖字体渲染特殊字符。
- 启动失败提示改由 DSH `shell.overlay` 插槽渲染，跟随宿主生命周期，不再通过 `document.body` 创建 `position:fixed` 全局浮层。
- 没有新增运行时依赖，未改变 SSH、SFTP、终端、快捷命令或 Agent 工具契约。

## 自动化验证

- `npm run check`：通过。
- 56 项后端/状态/传输测试、31 项生产客户端行为测试、8 项契约测试和静态 smoke 全部通过。
- 新增两类回归：DSH 新旧两套图标导出都能渲染完整面板；启动错误必须进入宿主 overlay，禁止 body portal 和全局 fixed 浮层。

## 本机 3080 验收

- 宿主：DSH `0.2.0-rc.2` Web profile，端口 `3080`。
- 安装候选包后确认 Remote Ops v0.2.23 不再空白，终端本地 `echo DSH023_UI` 只回显一次。
- 环境抽屉打开后再次点击可收回；SFTP 可切换到插件主区并返回终端；顶部操作按钮和错误/辅助功能的无障碍名称可见。
- 本轮只验证本地 CMD 和界面切换；未把保存的 SSH 环境、SFTP 连接、真实模型调用或跨电脑输入法结果写成成功证据。

## 已知验证边界

- 通用 `check_dsh_ui_contract.mjs` 对本插件报告失败：它只扫描 `package.main` 的 `lib/index.js`，没有识别实际 `lib/client.js`，并强制要求左侧 `sidebar.panellist/main`，与本插件当前 DSH 右侧 `sidebarRight` / `sidebar.right.pane.tab` 形态不匹配。该结果已保留，不作为本插件运行时门禁。

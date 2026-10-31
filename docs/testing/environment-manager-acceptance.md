# 环境管理页验收（2026-10-31）

本地开发改动，基于 v0.12.1，尚未提交、推送或发布。候选包同时包含此前的终端标签左右滚动改动。未修改 Agent、DSH 宿主或环境管理后端接口。

后续发布：这些改动已随 v0.12.2 发布；正式包验收见 [v0.12.2 记录](dsh-remote-ops-v0.12.2-acceptance.md)。以下保留开发阶段的版本和证据。

## 交付行为

- SSH / API 共用分组导航、搜索与列表布局；宽栏显示左侧分组，窄栏使用分组下拉框。
- SSH 保留进入、编辑、测试；API 保留使用、编辑。行尾更多菜单收纳删除及新建独立 SSH 连接。
- 批量管理显示选择框，确认时冻结环境 ID 并展示名称、地址与影响；取消不删除，重复点击不会重复执行，部分失败保留对应选择及原因。
- SSH 分组可重命名、删除空分组；API 继续通过环境编辑表单设置分组。未改变两类分组的存储方式。
- 编辑取消保留搜索和分组；返回工作区保留请求草稿。更多菜单支持键盘展开、Esc 关闭和焦点返回。
- README 中英文四份、随包 `remote-ops-environments` / `remote-ops-api` skill 已同步操作路径。

## 验证结果

| 层次 | 结果 | 证据 |
| --- | --- | --- |
| 插件回归 | `npm run check`：444 项通过（桌面 11、后端 300、客户端 121、契约 12），smoke 通过 | `output/playwright/environment-layout-check.log` |
| 浏览器回归 | 24 个场景、106 个步骤通过；无未预期 HTTP / 控制台 / 页面错误 | `output/playwright/environment-layout-regression/report.html` |
| DSH UI 静态契约 | 14 项通过、0 错误；1 条 Codex manifest 提示不适用于本 DSH 插件 | `check_dsh_ui_contract.mjs integrations/dsh-remote-ops` |
| 安装候选包后的真实 DSH | 13 项通过，其中终端与对话隔离 8 项、环境管理 5 项；无页面运行时异常 | `output/playwright/environment-layout-native-accepted/evidence.json` |

真实宿主为 Windows 11、DSH 0.2.0-rc.2、Chrome 156.0.8078.74。在独立 `DSH_HOME` 安装候选包，通过真实右侧栏验证宽栏和 390px 窄栏、深色主题、确认取消、批量删除及原对话草稿保留。SSH 目标是本地脚本化测试服务；不代表已连接用户另一台电脑或生产设备。

浏览器回归还覆盖密码查看/替换、Windows SSH 表单与失败诊断、API 登录及执行、终端、网页和 SFTP 的既有交互。新增客户端测试验证确认期间新增环境不被误删、相同名称按 ID 区分、取消/卸载不继续派发、部分失败报告原因。

首轮原生窄栏检查遇到 DSH 响应式布局尚未完成的时序问题；失败截图已显示正确的窄栏。验收脚本改为等待分组选择器可见，重新完整运行通过；保留首轮证据于 `output/playwright/environment-layout-native/`，未因此改变产品实现。

## 包与截图

- 本地候选包：`output/playwright/environment-layout-package/dsh-remote-ops-0.12.1.tgz`。
- SHA256：`398bd625b0120ea8e543f165a40499bdb6c1281451a6e778490ca8b7db9aa531`。
- 工作区客户端、版本化客户端和实际安装客户端 SHA256 一致：`c858feeeeb563a8fe3ad45587abbd83e13097c331128d563f26407c392e77312`。
- 两份更新后的随包 skill 与实际安装文件 SHA256 一致。
- 宽栏 SSH 实录：`output/playwright/environment-layout-native-accepted/step-9.png`。
- 窄栏 API 深色实录：`output/playwright/environment-layout-native-accepted/step-13.png`。

复现原生验收：配置 `DSH_CLI` 为 DSH `lib/bin.js`，执行 `node e2e/runner/terminal-tabs-native.mjs <tgz>`。可用 `TERMINAL_TABS_OUTPUT` 指定输出目录。测试使用隔离配置和确定性模型初始化对话，不修改已有 Agent。

# dsh-remote-ops v0.2.26

## 变更

- 去掉自动回答 `(y/n)`。`autoConfirm` 和 `confirmPattern` 从发送、批量、快捷命令、脚本、环境预设和环境表单中移除。插件不再自己输入 `y` 或 `yes`。仍传入这两个参数时，结果里会有 `notices`。保存环境时如果预设里带它们，会拒绝保存。旧环境文件里的残留值在读取时丢弃。`autoQuitMore` 和 `autoSigint` 保留。`remote_terminal_script` 的 `answers` 仍只输入调用里写明的文本。
- `RemoteOpsState` 拆到 `lib/state/`。一个基类加九个领域层，每个文件不到 200 行。方法源码与拆分前逐字相同，对外调用方式不变。
- 新增仿宿主浏览器验收 `e2e/`。真实 Chrome 加载生产 `client.js`，后端是生产插件，SSH 连到进程内假设备。6 个场景覆盖打开面板、本地回显、确认不会被自动回答、终端尺寸、掉线后重连且不重放、Agent 与界面同一条输出、人工输入拒绝、长输出滚动和 390px 窄屏。每步截图，并生成 HTML、Markdown、JSON 和 JUnit 报告。
- 没有新增运行时依赖。浏览器测试的依赖放在独立的 `e2e/`，不进插件包。

## 自动化验证

- `npm run check`：插件语法、单元、客户端行为、契约和 smoke。
- `npm test --prefix e2e` 与 `npm run e2e --prefix e2e`：假设备单元测试和 6 个浏览器场景通过。GitHub Actions 的 `Remote Ops browser` 工作流通过。

## 验证边界

- 浏览器场景没有启动完整 DSH 宿主，也没有连接真实设备。
- 已发布的 v0.2.24 和 v0.2.25 仍会自动回答 `(y/n)`。从这一版起不再这样做。

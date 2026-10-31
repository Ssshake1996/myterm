# 终端标签滚动验收（2026-10-31）

本地开发改动，基于 v0.12.1；尚未发布新版本。修改仅涉及终端标签导航、回归场景与使用说明，未修改 Agent。

后续发布：这些改动已随 v0.12.2 发布；正式包验收见 [v0.12.2 记录](dsh-remote-ops-v0.12.2-acceptance.md)。以下保留开发阶段的版本和证据。

- 标签溢出时显示左右按钮，到达边界置灰；标签全部可见时隐藏按钮。维持单行、32px 桌面标签和固定工具区。
- 手动滚动不改变当前终端，后台输出与状态刷新不拉回位置；切换标签、改变面板宽度、关闭当前标签后定位可见目标。
- `npm run check`：441 项通过，smoke 通过。日志：`output/playwright/terminal-tab-scroll-check.log`。
- DSH UI 契约：14 项通过、0 错误；Codex manifest 提示不适用于本 DSH 插件。
- 浏览器回归：`terminal-tabs`、新增 `terminal-tab-scroll`、`terminal-close` 三个场景全部通过。报告：`output/playwright/terminal-tabs-regression/report.html` 和 `output/playwright/terminal-tab-close-regression/report.html`。
- 新场景在修改实现前确认旧界面缺少左右按钮；随后通过 12 个 SSH 标签的左右遍历、边界、连续点击、后台刷新、Home/End、390px 窄屏、深色、减少动画、单个及批量关闭验证。
- 原生宿主：Windows 11、DSH 0.2.0-rc.2、Chrome 156.0.8078.74，独立 `DSH_HOME` 安装候选包后 8 项全部通过，浏览器无运行时异常。另验证了对话切换后标签隔离、旧连接与草稿保留。

原生证据：`output/playwright/terminal-tabs-native-accepted/evidence.json` 及同目录截图。候选 tgz 的 SHA256 为 `7a3303bec0136ffd52c3a1c1e2b47429ec8b44cce23dd191d6446007dbffa398`；安装后的客户端与验证时工作区客户端 SHA256 均为 `08f5bf3999e9686e06c2f61ca12022d9fc883a2d6eadf780a31ff71b2e6c9005`。

SSH 目标是本地脚本化测试服务；此记录证明界面和原生宿主集成，不代表连接用户另一台电脑或生产设备的验收。原生测试脚本：`node e2e/runner/terminal-tabs-native.mjs <tgz>`，需配置 `DSH_CLI`。

# dsh-remote-ops v0.12.2 验收记录

## 范围与候选包验证

本版发布 SSH / API 环境管理布局、批量管理和终端标签左右滚动。未修改 Agent、DSH 宿主及环境管理后端接口。

- 开发阶段完整回归：444 项检查及 smoke 通过；24 个浏览器场景、106 个步骤通过，覆盖新界面以及终端、网页、SFTP、密码、Windows SSH 表单和 API 请求既有操作。
- 正式版本号候选包：`output/playwright/v0.12.2-candidate-package/dsh-remote-ops-0.12.2.tgz`，SHA256 `31092fc2fa4420a9fffbc38d8f4e5783c03e2539d87d216f60dd8369ded69e57`。
- Windows 11 / DSH 0.2.0-rc.2 / Chrome 156.0.8078.74：安装上述候选包到隔离 `DSH_HOME` 后，13 项全部通过，无页面运行时异常；真实验证左右滚动、后台输出、对话隔离、分组与删除、API 草稿、390px 窄栏和深色界面。
- 证据：`output/playwright/v0.12.2-candidate-native/evidence.json` 及同目录截图。
- 静态 UI 契约：14 项通过、0 错误，1 条非 Codex 插件的 manifest 提示。

SSH 目标是本地隔离测试服务。上述结果证明插件界面、传输和原生 DSH 集成，不代表连接用户的生产设备。完整开发验收见 [环境管理记录](environment-manager-acceptance.md) 与 [终端标签记录](terminal-tab-scroll-acceptance.md)。正式 GitHub 发布包的下载校验和安装验证在发布后补录。

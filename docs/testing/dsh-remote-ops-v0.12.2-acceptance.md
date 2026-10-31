# dsh-remote-ops v0.12.2 验收记录

## 范围与候选包验证

本版发布 SSH / API 环境管理布局、批量管理和终端标签左右滚动。未修改 Agent、DSH 宿主及环境管理后端接口。

- 开发与 v0.12.2 发布前完整回归：444 项检查及 smoke 通过；24 个浏览器场景、106 个步骤通过，覆盖新界面以及终端、网页、SFTP、密码、Windows SSH 表单和 API 请求既有操作。发布门禁日志：`output/playwright/v0.12.2-release.log`。
- 正式版本号候选包：`output/playwright/v0.12.2-candidate-package/dsh-remote-ops-0.12.2.tgz`，SHA256 `31092fc2fa4420a9fffbc38d8f4e5783c03e2539d87d216f60dd8369ded69e57`。
- Windows 11 / DSH 0.2.0-rc.2 / Chrome 156.0.8078.74：安装上述候选包到隔离 `DSH_HOME` 后，13 项全部通过，无页面运行时异常；真实验证左右滚动、后台输出、对话隔离、分组与删除、API 草稿、390px 窄栏和深色界面。
- 证据：`output/playwright/v0.12.2-candidate-native/evidence.json` 及同目录截图。
- 静态 UI 契约：14 项通过、0 错误，1 条非 Codex 插件的 manifest 提示。

SSH 目标是本地隔离测试服务。上述结果证明插件界面、传输和原生 DSH 集成，不代表连接用户的生产设备。完整开发验收见 [环境管理记录](environment-manager-acceptance.md) 与 [终端标签记录](terminal-tab-scroll-acceptance.md)。

## 正式 Release 下载与安装验收

- [GitHub Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.12.2) 已发布为稳定版，Latest API 和 Release 列表首位均为 `dsh-remote-ops-v0.12.2`。
- 发布提交与不可变标签目标：`454513fb188b468f12090dd543f64c7a9dce8164`。
- 附件恰好两个：`dsh-remote-ops-v0.12.2.tgz`（660439 字节）和 `SHA256SUMS-dsh-remote-ops-v0.12.2.txt`。
- 直接下载的正式 tgz、SHA256 文件和 GitHub asset digest 三方一致：`a0a60933012224ffbc1f159a0fafaf389f6bd9b4bb2b2784fcbd3c7d8d5bce84`。CI 重新构建桌面运行时，因此正式包与本地候选包摘要不同，分别核验。
- 正式附件安装到新的隔离 `DSH_HOME`，实际运行版本为 0.12.2；13 项原生 DSH 验收再次全部通过，页面运行时异常 0。证据：`output/playwright/v0.12.2-official-native/evidence.json` 和同目录截图。
- 正式安装的版本化客户端与本次验证源文件 SHA256 一致：`0edf610340466ebd32f5451f65e0932b093aaf1570f105dff3821c4048de71e7`。
- [发布工作流](https://github.com/Ssshake1996/myterm/actions/runs/41160927544) 的 Windows 检查及实际桌面门禁、Linux 检查与打包、上传与 Latest 验证全部通过；[浏览器工作流](https://github.com/Ssshake1996/myterm/actions/runs/41160925515) 和 [Linux CI](https://github.com/Ssshake1996/myterm/actions/runs/41160927507) 通过。

上述正式包验收使用同一 Windows 11 / DSH 0.2.0-rc.2 / Chrome 156.0.8078.74 组合与隔离测试服务，不复用候选包安装目录。

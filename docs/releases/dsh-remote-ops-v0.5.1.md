# dsh-remote-ops v0.5.1

- 修复网页操作工具与 HTTP 入口中，空白 `flowId` 覆盖有效 `steps`，导致 `BROWSER_FLOW_NOT_FOUND`、普通网页动作无法执行的问题。
- 工具和 HTTP 共用操作来源校验；拒绝非空流程与非空步骤混用、错误步骤类型及未提供操作。保存流程支持 ID 首尾空白和空的可选步骤数组。
- 分别报告流程缺失与网站绑定不匹配，并给出恢复方式；失败前不派发动作、不自动重试或改选浏览器，保留网站与凭据隔离。
- 插件自带 `remote_browser_run` 的工具及参数说明同步完善；新增随包安装的 `remote-ops-browser` skill，通过 DSH 原生服务全局注册，自动发现或使用 `/remote-ops-browser` 加载。卸载插件后移除注册，不覆盖用户 skill 文件。
- 所有改动随 tgz 分发，未修改 Agent 实现或 DSH 内核，未新增依赖；内网电脑无需迁移 Agent 配置或另行复制 skill。
- 补齐工具/HTTP 回归和真实浏览器步骤验证；验收详情见 [v0.5.1 验收说明](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.5.1-acceptance.md)。

安装到实际使用的 DSH 用户、`DSH_HOME` 和 profile，完全停止旧 DSH 进程后重启并刷新网页，确认面板显示 `v0.5.1`。环境、快捷命令、网站和保存流程保留；运行中的终端、浏览器及任务不跨重启恢复。

另一台电脑、真实内网网站和不同模型组合仍需现场验收；本次不包含此前已暂缓的 SSH 参数空格问题。

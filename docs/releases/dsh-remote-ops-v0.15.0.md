# dsh-remote-ops v0.15.0

此标签的发布流程已取消，未上传正式安装包。正式版本为 [v0.15.1](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.15.1)，补齐了旧版浏览器实例热加载时的录制初始化。

网页操作可以保存为持久记录：在网页工具栏点击“开始录制”，完成人工或 Agent 操作后点击“停止录制”，再从“录制记录”读取和导出 JSON。Agent 使用 `remote_browser_recording` 的 `start`、`stop`、`read`、`export` 调用相同能力。停止录制不停止网页任务。

记录包含 Agent 步骤、人工网页输入与点击、页面导航、iframe 与弹出网页上下文、元素定位候选和动作结果。记录按对话隔离并持久保存；重启后可读取中断记录。敏感输入和 URL 查询值脱敏，未知结果、未完成动作及录制上限均保留明确状态。

随包新增 `remote-ops-web-recordings` Skill，通过 DSH 原生 Skill 服务注册。Agent 据此还原操作过程、区分观察与断言、将设备入口地址参数化，并按用户指定的框架或项目模板生成代码。插件只记录过程，不引入代码生成器或测试执行框架。

正式 tgz 包含匹配 Playwright 版本的 Windows x64 和 Linux x64 Chromium Headless Shell。安装时检查随包运行时；缺少当前平台时，安装脚本可从匹配缓存或下载源补齐，遵循宿主安装脚本权限。完整随包平台无需另行下载浏览器。独立窗口仍可使用主机 Chrome / Edge；Linux 主机需要 Chromium 所需的系统动态库，其他平台未纳入本版实机验收。

**首次从 v0.14.1 及更早版本升级，请通过 DSH 插件管理或 CLI 安装。** 浏览器使 tgz 超过旧更新器的 64 MiB 限制，不要使用旧版“检查并更新”下载本包。安装时使用运行 DSH 的同一用户、`DSH_HOME` 和实际 profile：

```powershell
dsh plugin --profile web add ./dsh-remote-ops-v0.15.0.tgz
```

安装完成后通过“重试应用已安装版本”激活；宿主不支持热加载时重启 DSH。确认“当前运行”和“已安装”均为 0.15.0。新版更新器支持最大 512 MiB 压缩包、1 GiB 解压数据，流式检查清单，保留 SHA256 和插件身份校验。

附件为 `dsh-remote-ops-v0.15.0.tgz` 与 `SHA256SUMS-dsh-remote-ops-v0.15.0.txt`。已验证范围及边界见[验收记录](https://github.com/Ssshake1996/myterm/blob/dsh-remote-ops-v0.15.0/docs/testing/dsh-remote-ops-v0.15.0-acceptance.md)。

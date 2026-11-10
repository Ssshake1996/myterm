# dsh-remote-ops v0.15.2 验收记录

修复本机 DSH Desktop 0.2.1-rc.5 验收 v0.15.1 时发现的 `INVALID_TOOL_OUTPUT`：活动录制摘要中的 `error: undefined` 不符合 DSH 原始工具结果的 JSON 校验。无错误时改为 `null`，真实错误仍保留。

| 验收层 | 内容与结果 |
| --- | --- |
| 回归复现 | 原实现无法通过原始工具结果的 JSON 往返比较；修复后开始、停止、读取录制、浏览器列表和页面读取通过。 |
| 完整本地检查 | `npm run check`：338 项单元、130 项客户端、12 项契约、11 项桌面测试及语法、smoke 通过。 |
| 原生 DSH 候选包 | Windows x64、DSH 0.2.1-rc.5，隔离 home、空浏览器缓存、禁用浏览器下载；安装 v0.15.2 后直接启动随包浏览器。 |
| 活动录制回执 | 确定性模型经真实 DSH 调用开始录制、浏览器列表、页面读取、录制读取，均通过宿主校验；能读取已完成的 Agent 操作且录制继续进行。 |
| 完整录制流程 | 随包 Skill 发现、人工与 Agent 操作、UI 停止和读取、JSON 导出、刷新后读取通过，共 21 个事件。 |

候选包验收证据为 `output/release-v0.15.2-native/evidence.json`。这项验收使用确定性模型服务；不能替代用户本机 Desktop 配置模型的最终升级验收。正式 CI 附件重新构建，摘要以 Release 附件及其 SHA256 文件为准。

```powershell
npm run check --prefix integrations/dsh-remote-ops
$env:DSH_CLI = '<DSH>/lib/bin.js'
node e2e/runner/browser-recording-native.mjs ./dsh-remote-ops-v0.15.2.tgz
```

本版没有改变录制格式、权限或浏览器打包范围。设备真实环境、其他宿主版本、ARM/macOS 未纳入这次补丁验收；录制事件本身不代表生成的自动化代码已经通过回放验证。

# dsh-remote-ops v0.15.1 验收记录

本版增加网页操作记录和内置浏览器随包安装。验收使用隔离 DSH home、本地测试网页和确定性模型服务；模型经真实 DSH 调用插件工具，不连接生产设备。

| 验收层 | 内容与结果 |
| --- | --- |
| 完整本地检查 | `npm run check`：338 项单元、130 项客户端、12 项契约、11 项桌面测试及语法、smoke 通过。 |
| 浏览器运行时 | 缺失包从匹配文件补齐，禁止浏览器下载仍成功；重复安装复用完整运行时。 |
| 真实浏览器 | 随包 Headless Shell 启动；人工/Agent 操作、快速 Agent 输入归属、跨域 iframe、弹出网页、敏感输入脱敏、停止后不再采集通过。 |
| UI 与生命周期 | 1280px/390px 仿宿主真实浏览器测试通过：录制、读取、JSON 下载、无横向溢出、模块切换、页面刷新、独立窗口与插件内切换。 |
| 原生 DSH | Windows x64、DSH 0.2.1-rc.5：空浏览器缓存并禁用浏览器下载，安装后直接打开内置网页；原生 Agent 读取随包 Skill，人工/Agent 录制、停止、读取、导出、刷新恢复通过。 |
| 旧版热迁移 | 从正式 v0.14.1 tgz 经 CLI 安装 v0.15.1 并热激活；原浏览器和页面 ID 保留，现有页面开始录制、导航、人工/Agent 输入、导出通过。无需重建当前网页即可启用录制。 |
| 连续热更新回归 | 原生 DSH 0.2.1-rc.5 共 9 项通过：活动 API 和批量上传等待、连接及网页身份保留、状态读取恢复、宿主配置重组、候选版本启动失败回退。后续版本使用本地合成包，不发布。 |
| 宿主 UI 静态契约 | 14 项通过，0 错误；非 Codex 插件缺少 Codex manifest 的提示保留。右侧栏注册方式延续已有契约。 |
| 更新包 | 大包流式清单扫描、分块边界、损坏及重复清单拒绝、SHA256 与包身份校验通过；正式附件由 CI 重建并生成自己的摘要。 |

发布工作流在 Windows 验证桌面运行时，在 Linux 组装包含两种平台浏览器的 tgz，再安装该 tgz 执行原生 DSH 串口和网页录制验收；全部通过后才创建 Release。工作流结果和正式附件摘要以该 tag 的 GitHub Actions 与 SHA256 文件为准。

## 重现

```powershell
npm run check --prefix integrations/dsh-remote-ops
node --test e2e/test/recording-live.mjs
node e2e/runner/index.mjs --grep web
$env:DSH_CLI = '<DSH>/lib/bin.js'
node e2e/runner/browser-recording-native.mjs ./dsh-remote-ops-v0.15.1.tgz
```

录制每份上限 10,000 事件 / 16 MiB；未完成动作、崩溃中断和上限状态不代表测试通过。浏览器 UI、原生文件选择器、封闭 Shadow DOM 等不能完整重建。录制不等于回放验证；生成的自动化代码由 Agent 按用户框架处理，并另行验证。其他 DSH 版本、真实硬件、多机环境和 ARM/macOS 未纳入本次验收；系统动态库不包含在 Linux 浏览器包中。

卸载后持久录制文件随插件数据目录保留，随包 Skill Provider 随插件卸载注销。已有通用宿主布局和卸载逻辑沿用原实现，本版未重新覆盖所有宿主版本的卸载矩阵。

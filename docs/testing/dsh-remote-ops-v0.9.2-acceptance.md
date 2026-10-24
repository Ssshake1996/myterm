# Remote Ops v0.9.2 验收

日期：2026-10-25（Asia/Tokyo）。本次发布范围为顶部工作区标签间距、选中条及窄栏样式；Windows 远程连接是独立设计提案，没有实现 WinRM 或新增 Windows 工具。未修改 Agent。

## 本地验证

- `npm run check --prefix integrations/dsh-remote-ops`：262 个后端、115 个客户端、11 个契约测试，共 388 项通过；生成客户端同步、语法与 smoke 通过。
- 浏览器套件 20/20 通过，含工作区键盘切换、后台徽标、状态保留、SFTP、网页、API、请求错误和终端日志。该套件是实际插件前后端加仿宿主、隔离测试服务；不能替代真实 DSH 验收。模块切换样本 p95 为 131ms。
- DSH UI 静态契约 14 项通过、0 错误，保留未提供 Codex manifest 的提示。随包环境管理 skill 格式校验通过。
- 首轮完整检查提示缺少 v0.9.2 发布说明，补齐后通过；首轮真实 DSH 窄栏检查发现 390px 带徽标标签略宽，补充 480px 以下的留白规则后通过。失败日志保留，没有放宽断言。

本地日志：`output/release092-check-final.log`、`output/e2e/release092-final/report.json`、`output/release092-ui-contract.log`、`output/release092-skill-check-final.log`。

## 候选包真实 DSH

DSH 0.2.0-rc.2、Chrome 155，Windows 开发机。隔离 DSH_HOME / profile 和确定性测试模型，真实 DSH 工具连接本地 SSH、网页及 API 测试服务。

候选 tgz SHA256：`397f5c45ca074e30ea666712e8cda0f79093a21815b3a3bfac630785db77b27e`。

8 组完整功能验收通过：真实 Agent 终端和网页调用、TXT / ZIP 导出、SSH 尺寸、设置与草稿保留、环境返回、API 与 JSON Pointer、窄栏深色及键盘、工作区标签几何与完整按钮点击、5 个随包 skill 发现和读取。部分相关检查合并在同一组中。

| 浏览器视口 | 实际工作区栏宽 | 有“新输出”徽标的终端标签 | 其余标签 |
| --- | --- | --- | --- |
| 1500px | 674px | 120px | 各 88px |
| 1280px | 599px | 120px | 各 88px |
| 390px | 389px | 112px | 各 72px |
| 320px | 319px | 87px | 各 64px |

相邻标签间距为 4px，首项贴近左侧内边距；当前选中条覆盖整个按钮。四个视口中实际四标签与徽标无横向溢出，留白点击、Home / End、选中状态与工作区切换均通过。宽度不足且后台徽标更多时，标签栏自身允许横向滚动，避免文字重叠或撑宽页面。

候选证据：`output/playwright/release092-native-candidate-1792857118258-acceptance.json`。README 三张产品截图来自该次真实 DSH 安装。

候选 HTTP 升级与故障验收 8 组通过：官方 0.9.1 → 候选 0.9.2、旧进程下重载、实际重启、更新文件诊断、提示去重及手动刷新。`pageErrors: []`。停止并重启宿主的过渡阶段记录到状态与终端接口各一条自然 404；新进程启动后状态恢复，`afterRestart.alerts: []`，没有持续刷新失败。此现象保留在 `output/playwright/update092-native-candidate-1792857498581-evidence.json` 中，不将其隐去或当作另一台电脑持续 404 的根因证明。

## 发布与官方附件复验

- 发布提交 `641307935e435773ac0889dcdbed782919a51fca`。[Linux 插件 CI](https://github.com/Ssshake1996/myterm/actions/runs/40109492757) 与[浏览器 CI](https://github.com/Ssshake1996/myterm/actions/runs/40109492752) 均通过，浏览器 20/20，切换样本 p95 为 212ms。
- [发布流程](https://github.com/Ssshake1996/myterm/actions/runs/40109707394) Windows 首轮再次触发既有 `routes.test.mjs` 固定等待 20ms 的初始化竞态。实际状态和操作路由等待 `state.ready`，此失败发生在测试直接读取 mock 终端时；保留首轮日志，同一提交复跑后 Linux 打包、Windows 检查、发布均通过。另在 `79ecd54` 将仓库测试夹具修正为通过状态接口等待初始化，移除三个固定等待，功能断言保留并新增终端已创建断言；Windows 本机完整 388 项、[Linux CI](https://github.com/Ssshake1996/myterm/actions/runs/40110218553) 和[浏览器 CI](https://github.com/Ssshake1996/myterm/actions/runs/40110218551) 均通过。测试文件不进入 tgz；发布标签和包内容不变。
- 正式 Release 仅两个附件：tgz 和 SHA256。下载后摘要校验通过，与候选包一致；67 个包内文件逐字节匹配当前仓库，包括 5 个随包 skill。`latest.json` 生成成功，仅供部署内网源使用，没有增加 Release 附件。

- 正式 tgz 全新安装到真实 DSH，8 组完整验收全部通过，`errors: []`；真实 skill 工具读取到新版标签导航说明。证据：`output/playwright/release092-native-official-1792858373638-acceptance.json`。安装后的客户端 SHA256 为 `28a66a68007dde4faaf4818e428034f77c714b645f4daf1113d2b6543348d8fc`。
- 下载的正式附件通过本地 HTTP 源从官方 0.9.1 更新到 0.9.2，8 组升级与故障验收全部通过：真实安装、浏览器重载、两次实际宿主重启、清单 / 校验文件 / 安装包诊断、提示去重与主动刷新。`pageErrors: []`、稳定运行期间的 `unexpected404s: []`；受控故障与主动停机期间的请求分别以 `faultInjected`、`hostTransition` 标记，原始记录保留。新进程启动后无错误提示。缺失附件场景使用 0.9.3 测试清单，没有安装该版本。证据：`output/playwright/update092-native-official-1792858373156-evidence.json`。
- 正式版本预览已更新，五张截图、键盘切换、1440px / 390px 排版与无横向溢出验证通过。Windows 方案 HTML 的 9 个章节、官方文档链接和宽窄视口也完成渲染检查。

## 范围边界

没有连接用户另一台电脑、生产设备或远端 Windows 桌面 / Server。Windows 文档中的协议、字段、桥接、工具与系统矩阵属于拟议实现，不能作为已支持或已验收能力。没有变更已发布的 v0.9.1 历史记录。

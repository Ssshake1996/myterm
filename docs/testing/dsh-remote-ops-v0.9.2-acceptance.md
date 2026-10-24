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

## 发布与官方附件复验

待发布流程完成后补充 Linux / Windows CI、正式附件摘要、重新下载安装及 HTTP 更新结果。最终验收以正式附件复验为准。

## 范围边界

没有连接用户另一台电脑、生产设备或远端 Windows 桌面 / Server。Windows 文档中的协议、字段、桥接、工具与系统矩阵属于拟议实现，不能作为已支持或已验收能力。没有变更已发布的 v0.9.1 历史记录。

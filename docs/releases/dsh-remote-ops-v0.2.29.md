# dsh-remote-ops v0.2.29

修正左侧 Remote Ops 入口的目的地：点击打开 DSH 原生右侧 Sidebar，保留主对话及草稿。v0.2.27–v0.2.28 使用主工作区的实现不符合此交互要求。本版本保留 v0.2.28 的上传生命周期、刷新去重和选择/滚动保护。

## 变化

- 移除 Remote Ops 的 `sidebar.panellist` / `main` 注册。DSH 0.2.0-rc.2 的 panellist 点击固定调用 `selectPanel`，无法作为右栏 action。
- 在官方 `sidebar.footer.action` 操作位提供唯一的左侧底部入口，调用 `sidebarRight.openTab`，复用已有右栏标签页。使用 currentColor 图标、宿主主题 token 和公开 Tooltip，支持折叠、Enter / Space 和焦点提示。
- 右栏内容使用宿主传入的会话 owner，并在 owner 变化时重新挂载。删除主工作区选中时抑制右栏的旧逻辑；保留已发布的 tab ID、kind、工具和存储格式。
- 保留有界服务重试、错误反馈和生命周期清理，不新建替代对话。四份 README、安装和发布示例同步版本及入口行为。
- 反向修正并发布 [dsh-plugin-ui Skill v0.1.2](https://github.com/Ssshake1996/dsh-plugin-ui-skill/releases/tag/v0.1.2)：按用户要求区分主工作区和右栏目的地，完整的右栏集成不再被静态检查误判为缺少 main。

## 安装

从 GitHub Release 下载本版本 tgz，在运行 DSH 的同一用户、`DSH_HOME` 和实际 profile 下安装，然后完全重启 DSH 并刷新浏览器：

```powershell
dsh plugin --profile web add .\dsh-remote-ops-v0.2.29.tgz
dsh web
```

确认标题显示 `v0.2.29`，点击左侧底部 Remote Ops 后，桌面主对话仍可见。

## 验证

- 先用导航回归复现旧版本仍注册主工作区，再验证右栏目的地、唯一入口、会话 owner、服务/slot 卸载重载、locale、Tooltip 和错误重试。发布门禁为 129 项后端/发布、92 项客户端、11 项契约测试，共 232 项，以及 32 文件语法检查和 smoke。
- E2E 单元 4/4、Chrome 浏览器场景 9/9；使用真实 client/插件后端及仿宿主，SSH 为假设备。报告：`output/e2e/2026-10-12T03-53-09-467Z/report.html`。
- 独立 profile、真实 DSH `0.2.0-rc.2`：打开右栏前后为同一主对话编辑器，测试草稿保留；桌面主对话与插件区域无覆盖，重复点击仅一个标签页；收起/关闭/重新打开、Enter / Space、宿主折叠 Tooltip、本地 CMD、reduced-motion 均通过。
- 真实宿主右栏关闭/重开后未提交终端输入仍阻止快捷命令拼接，Ctrl+C 后恢复。SFTP 批量上传在关闭右栏标签页后继续，重开可查看进度；两个文件下载回读字节一致；取消停止后续文件。历史任务只产生两次初始目录读取，同目录刷新保留有效选择和最新滚动位置。
- 1280×900 和 390×844 验证。等待宿主布局收敛后，390px 文档宽 390px、面板宽 389px、两侧列表高度 157px/156px，目标 B 可访问，无水平溢出。证据：`output/right029-candidate-*.log` 和 `output/playwright/right029-*.png`。验收脚本等待两次初始目录读取完成后再输入测试路径，避免初始加载覆盖测试输入。
- 客户端源码与候选安装包一致，SHA256：`592CCFD779F75EF4B0632658964D867CC3D41638BFB57892011F5247ECED08C0`。Skill 检查 14 通过、0 错误，仅纯 DSH 包缺少 Codex manifest 的提示；Skill checker 15 项测试通过。
- 发布后从正式 GitHub Release 下载并核对摘要，在另一独立 profile 安装复验；最终结果单独记录于交付报告。

## 边界

右栏的宽度、停靠与窄屏全屏行为由 DSH 控制；390px 下可能自动全屏，收起后返回原对话。上传属于当前浏览器页的插件生命周期，整页关闭/刷新或停止 DSH 仍可能中断；取消不是回滚，服务端已接收的当前文件可能完成。真实远端 SSH/SFTP、其他物理电脑、IME 与模型调用未验证。

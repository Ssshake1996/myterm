# Remote Ops v0.9.0 验收

日期：2026-10-24。Windows 开发机，真实 DSH 0.2.0-rc.2，Chrome 155。使用独立 DSH_HOME / profile、确定性测试模型与本地 SSH、网页、API 测试服务。没有修改 Agent 源码、日常 Agent 配置或全局 skill。

## 本地回归与打包

- 发布门禁 `npm run check`：259 个后端、109 个客户端行为、11 个契约用例，共 379 项通过；52 个文件的语法检查、API 客户端内联同步与 smoke 通过。
- 布局候选完整浏览器套件 19/19 场景通过，覆盖后台任务徽标、API JSON Pointer 转义和折叠、复制失败回退、2xx 业务结果提示、工作区草稿、SFTP 上传与目录刷新、终端标签键盘切换、环境返回和窄栏。
- DSH UI 契约 14 项通过、0 错误；唯一提示为本项目没有 Codex 插件 manifest。五个随包 skill 格式校验通过。
- 安装包检查确认版本为 0.9.0，包含最新五个随包 skill、locale 与运行代码；打包文本统一为 LF，包内不含 node_modules、开发输出或 Agent 实现。

## v0.9.0 候选包真实 DSH 安装

通过 DSH 原生插件管理器把 tgz 安装到全新隔离 profile，再启动宿主。六组验收通过，浏览器异常为零：

1. 原生 Agent 工具实际执行本地 CMD 命令，建立三个 SSH 会话并读取回显；本地与 SSH 使用同一标签栏，可切换相应输出。
2. 原生 Agent 打开网页、填写字段并读取结果；打开设置、返回工作区时保留实际网页节点、地址草稿和主对话编辑器。
3. 环境页左上角返回入口在滚动表单时固定可见；返回原终端、恢复焦点，SSH 连接保持。
4. API 环境保存、实际请求、状态提示、JSON Pointer 复制与记录导出可用。
5. 390px、深色、减少动画、方向键和 Home/End 可用，活动终端滚动到可见区域；右栏入口复用同一标签，主对话草稿保留。
6. 原生 Agent 发现并逐个调用 `skill` 读取 browser、environments、terminal-logs、api、updates 五个随包 skill，检查到新版操作路径。

候选包 SHA256：`c611418612a44686e216f54ec97b5c2ac638edc67af19f93c5b3f8b1da37879a`。

本地证据：`output/release090-dry-run.log`、`output/playwright/environment-back-all/report.json`、`output/playwright/release090-candidate-1792831162223-acceptance.json`；这些开发输出没有打包。根 README 三张截图来自该候选包的真实 DSH 安装。

## 正式发布复验

首次 [Linux 浏览器 CI](https://github.com/Ssshake1996/myterm/actions/runs/40079056669) 为 17/19：两条新增用例写死了 Windows 的「本地 CMD」名称，Linux 实际正确显示「本地 Shell」。按测试运行平台使用对应名称修正断言，保留标签可见性、选中状态和切换检查；插件功能代码未因此改变。该失败记录保留，修正后的结果在下方补充。

- 修正后 [Linux 浏览器 CI](https://github.com/Ssshake1996/myterm/actions/runs/40079445147) 19/19 通过，20 次工作区切换样本 p95 为 194ms；这不是所有机器的性能保证。[主分支插件 CI](https://github.com/Ssshake1996/myterm/actions/runs/40079445178) 通过。
- [发布流程](https://github.com/Ssshake1996/myterm/actions/runs/40079667760) 的 Linux 打包检查、Windows 检查和发布任务均成功。发布标签 `dsh-remote-ops-v0.9.0` 指向 `6874379a9cf5f33f9b41adb59fe6c77138c2f28f`。
- [正式 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.9.0) 的附件只有 `dsh-remote-ops-v0.9.0.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.9.0.txt`。
- 从 GitHub 下载正式附件后，SHA256 文件、GitHub asset digest、下载包和本地候选包摘要全部一致：`c611418612a44686e216f54ec97b5c2ac638edc67af19f93c5b3f8b1da37879a`。解包后逐文件与源码比较一致。
- 独立 profile 先通过 DSH 原生插件管理器安装正式 v0.8.2，再覆盖安装下载的 v0.9.0，启动宿主后重新执行上述六组验收，全部通过；设置页显示 v0.9.0，五个随包 skill 均被原生 Agent 发现并读取新版内容，页面异常为零。这证明了安装路径和升级后运行，不代表已验证用户旧会话的运行现场迁移。
- 正式包证据：`output/release090-official/verification.json`、`output/playwright/release090-official-1792832105638-acceptance.json`。安装后的 `client.js` 摘要与本次源码一致。

## 验证边界

真实宿主验证使用本机隔离 SSH、网页和 API 服务，不代表用户另一台电脑、实际内网设备或所有 DSH 版本已验收。没有在本轮新增 Windows 远程协议实现。原生安装和界面验收与浏览器仿宿主回归分别记录；现有 HTTP/HTTPS 更新机制未改动，本轮没有重做内部 CA 与依赖镜像验证。重启 DSH 后需重新打开终端与浏览器，进程内日志与运行任务不跨重启保留。

# Remote Ops v0.11.0 验收记录

本版本实现插件更新后的延后热加载。验证区分源码回归、真实 DSH 候选包验收、正式 Release 下载包验收；测试合成的后续版本仅作为升级夹具，不发布。

## 源码与浏览器回归

- `npm run check --prefix integrations/dsh-remote-ops`：427 项测试通过，另有 smoke 门禁通过；[最终源码 CI](https://github.com/Ssshake1996/myterm/actions/runs/40455261077)。
- 浏览器完整回归：22/22 场景通过，[最终浏览器 CI](https://github.com/Ssshake1996/myterm/actions/runs/40455261120)；本地报告 `e2e/output/hot-reload-e2e/report.json`。这是仿宿主浏览器层，区别于下方真实宿主验收。
- 热加载新增回归覆盖版本依赖隔离、任务阻挡、流式下载结束/取消、激活失败恢复、状态协议不兼容、更新重试不重复下载安装。
- Windows CI 的既有多对话验收暴露了终端异步聚焦抢占宿主富文本输入的问题。浏览器回归先复现焦点丢失，再验证修复：带 `role=textbox` 和普通 `contenteditable` 的宿主编辑器均保留焦点，输入草稿不进入终端。修复后 117 项客户端回归及 `terminal-tabs` 场景通过；证据 `e2e/output/hot-reload-focus-repro`、`e2e/output/hot-reload-focus-fixed`。
- 补充批量上传的文件间隙保护、跨对话隔离、取消前尚未完成登记、浏览器退出后等待过期的回归。最终客户端测试 118 项，上传切换场景通过；证据 `output/hot-reload-check-batches.log` 和 `e2e/output/hot-reload-batch-e2e/report.json`。

## 本地真实 DSH

DSH 0.2.0-rc.2，Windows 本机，真实 Chrome，独立 `DSH_HOME`。本地确定性模型驱动原生 Agent 工具，SSH 连接本地协议测试服务；网页和 API 请求访问隔离 HTTP 服务。不使用用户生产设备，不修改 Agent。

`e2e/runner/hot-reload-native.mjs` 验证：

1. 安装包在真实宿主暴露热加载能力。
2. 原生 Agent 打开 SSH，保存环境，创建网页和 API 登录会话。
3. 长 API 请求期间安装新版，前后端版本均保持不变，不取消请求；结束后才应用。
4. 同一 DSH 进程保持运行，对话草稿、SSH 和本地终端输出流标识、网页连接、API 登录状态与请求记录、更新来源均保留。前端确实加载带有新版本标记的测试资源。
5. 热加载后原生 Agent 继续执行独立 SSH 命令、读取原网页和 API 记录。
6. 同一进程再次更新；真实界面批量上传两个文件，在第一个已落盘、第二个请求尚未到达服务器时安装新版，前后端均等待，两个文件内容完整后才应用。
7. 调整宿主的其他 UI 配置触发 profile 重组，当前运行版本和前端保持一致。
8. 故意让下一版启动抛错，恢复旧运行版本；已安装版本仍单独显示，SSH 连接保留且能继续执行命令。

最终候选验收证据：`output/hot-reload-native-1793078744637/evidence.json`，八项通过，包含更新页“新版已生效”的界面断言。失败试验也保留在各自输出目录：早期测试等待了 API 超时、API 工具空字段不符合 JSON 契约、失败候选的宿主启动错误阻断恢复；批量上传测试最初把文件面板额外建立的 SFTP 连接计入终端连接断言，改为两侧均使用隔离主机目录后验证通过。

## Windows Server CI 候选包

[Windows OpenSSH acceptance](https://github.com/Ssshake1996/myterm/actions/runs/40455261211) 在发布提交 `bbf72003d896c45050f434e579ea285cf9dcb64a` 上通过。两个 runner 分别安装其生成的候选 tgz，未修改 Agent。

| 系统 | 真实 Windows OpenSSH | 原生 DSH Windows 与多对话终端 | 原生 DSH 热加载 |
| --- | --- | --- | --- |
| Windows Server 2022 | 12/12 | 8/8 | 8/8 |
| Windows Server 2025 | 12/12 | 8/8 | 8/8 |

OpenSSH 验证包含真实 PTY、CMD/PowerShell、独立退出码、中文参数、SFTP 文件内容与 SHA256、跨盘、主机指纹、日志和跨对话关闭范围。热加载场景使用隔离 SSH 协议服务及本地网页/API 服务，区分于前两列的真实 Windows SSH 目标。CI 附件与本地 `output/hot-reload-ci-final/windows-ssh-windows-{2022,2025}/` 保存对应证据。

## 正式 Release 下载包

[v0.11.0 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.11.0) 由[发布工作流](https://github.com/Ssshake1996/myterm/actions/runs/40455894756)生成并发布，标签指向上述发布提交。发布后重新下载正式资产核验，而非复用本地候选包。

- 仅上传 `dsh-remote-ops-v0.11.0.tgz`（345600 字节）与 `SHA256SUMS-dsh-remote-ops-v0.11.0.txt`。
- tgz 的 SHA256：`8d5537a0714ef372c2a6fdda93f551c3bdc1e22a86140dfe84d2bfde952e824e`，与校验文件及 GitHub asset digest 三方一致。
- 76 个包内文件逐一匹配发布源码，包含 6 个随包 skill，前端导出为 `lib/client-v0.11.0.js`；记录 `output/release0110-official/audit.json`。
- 将该正式 tgz 安装到独立 DSH profile，重新执行上文八项真实宿主验收，全部通过，浏览器异常为零；记录 `output/hot-reload-official0110/evidence.json`，截图 `updated.png`、`rollback.png`。用于连续升级与失败恢复的 v0.11.1–v0.11.3 仅为本地合成夹具，未发布。
- GitHub `/releases/latest` 实际返回 `dsh-remote-ops-v0.11.0`；Release 为正式稳定版本，非 draft/prerelease。

## 范围与边界

- 首次从 v0.10.x 或更早版本升级仍需重启一次；旧运行代码无法自行获得新版的热加载入口。
- 宿主缺少公开 Loader/HMR 接口或新版状态协议不兼容时保留明确的重启路径。其他 DSH 版本尚未实测。
- 手工终端长命令不以静默判断结束，热加载保留其底层连接。现有连接继续使用创建时的传输实现，新建连接使用新版实现。
- 浏览器批量上传每 30 秒续期；浏览器关闭或断网后，批次等待最多保留五分钟，实际执行中的传输仍独立阻挡重载。过期批次不能继续发送后续文件，需先检查已上传结果。
- 运行实例恢复不等于安装目录降级；完整 DSH 重启会载入磁盘已安装版本，仍遵守原有内存记录生命周期。
- Windows Server OpenSSH 实测范围如上；Windows 桌面系统作为远程 SSH 目标未新增实测。既有系统能力基线见 [v0.10.2 记录](dsh-remote-ops-v0.10.2-acceptance.md)。

# Remote Ops v0.8.2 验收

日期：2026-10-24。Windows 开发机，真实 DSH 0.2.0-rc.2，Chrome 155。内网更新仅支持 HTTP/HTTPS；文件目录、共享盘和 SFTP 更新入口及实现已移除。测试使用独立 DSH_HOME / profile 和确定性模型服务，没有修改 Agent、全局 skill 或日常环境。

## 回归与候选安装

- `npm run check --prefix integrations/dsh-remote-ops`：259 个后端、104 个客户端行为、11 个契约用例，共 374 项通过；语法检查、API 内联同步与 smoke 通过。
- HTTP 地址与版本清单、同源重定向、GitHub 签名下载、稳定版本比较、校验失败、包身份、重复点击、待重启、失败处理、配置损坏修复与清单生成均有回归。显式拒绝 filesystem/SFTP 配置及 file/FTP/SFTP URL，且不写入错误配置。
- 完整浏览器套件 17/17 场景通过。更新场景验证来源选择仅为 GitHub / HTTP(S)、打开和保存不访问更新源、手动检查、配置恢复、390px，以及关闭/重新加载前端后恢复安装状态且不重复派发。
- DSH UI 契约 14 项通过、0 错误，唯一提示为非 Codex 插件没有 Codex manifest；随包 `remote-ops-updates` skill 格式校验通过。
- 真实 DSH 候选 11 组验收通过：HTTP 与 HTTPS 分别实际安装、区分运行/磁盘版本、重启激活、保留更新设置和 SSH 环境；HTTP 损坏包被 SHA256 拒绝；关闭/重开更新窗口不影响安装，主对话草稿保留，原本地终端仍可执行命令。
- HTTPS 使用本地测试证书，只通过该隔离 DSH 进程的 `NODE_EXTRA_CA_CERTS` 信任，未关闭 TLS 校验，也未修改系统证书库。原生 Agent 成功发现并读取更新 skill。深色主题与 390px 右栏截图已检查。

升级起点为将当前更新器标为 v0.8.0 的专用测试包，不是旧正式 v0.8.0。旧正式版先手动安装一次 v0.8.2 后才能配置新来源。DSH 安装后会热重载前端；窗口打开状态按对话恢复，再读取后端结果，后端仍需手动重启生效。

## 正式发布与安装复验

v0.8.1 在生成 Release 前取消，只有历史标签与候选记录。[v0.8.2 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.8.2) 正式附件仅为 tgz 和 SHA256；`latest.json` 在内网部署时生成。

v0.8.2 首次发布流程也在生成 Release 前停止，用于修正随包 README 能力列表中残留的一句旧来源描述。确认没有 Release 或正式附件后同步发布标签；最终发布与复验均以修正后的包为准。

- 正式包 SHA256 与官方校验文件、GitHub digest、本地最终包一致：`d896358f176bea5928b60d81ef07a84f216fe77d4eb98ac022bbffd936708655`。
- 从 GitHub 下载正式包后，HTTP/HTTPS 的上述 11 组原生 DSH 流程全部再次通过；页面异常为 0。关闭后恢复进度、实际安装、重启、版本/设置/环境保留、终端可用、skill 发现及深色窄栏均通过。
- 正式包解包后，在没有额外 node_modules 的目录直接执行随包清单生成脚本成功；安装包不含已删除的文件/SFTP 更新实现。
- [Linux/Windows 发布检查](https://github.com/Ssshake1996/myterm/actions/runs/40057431126) 与主分支/标签插件 CI 通过。
- [浏览器 CI](https://github.com/Ssshake1996/myterm/actions/runs/40057428270) 首次 16/17，已有 20 次页面切换性能用例 p95 为 260ms，超过 250ms；更新功能场景通过。相同功能代码的前次 CI 为 17/17。按相同代码及原门槛复测 17/17 通过，p95 为 215ms；首次失败保留，不把一次复测通过解释为所有机器的性能保证。

## 验证边界

真实 DSH 的安装、界面、版本及 skill 已验证，更新站点为本机隔离服务。没有连接用户实际内网、企业 CA 或依赖镜像。依赖沿用 DSH 的源、代理与构建批准设置；更新地址不提供 npm 依赖，Chromium 仍按需安装。更新不自动重启，运行中任务不跨重启恢复。

证据（不随安装包分发）：`output/update082-check-final.log`、`output/update082-release-final.log`、`output/e2e/update082-full/report.json`、`output/playwright/update082-candidate-1792811316933-acceptance.json`、`output/playwright/update082-official-1792811860129-acceptance.json` 及截图。早期脚本版本断言与尚未写入发布说明导致的测试失败保留在同目录日志中，修正后完整门禁与原生流程均通过。

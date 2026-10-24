# dsh-remote-ops v0.8.1

**本版本未发布。** 2026-10-24 在生成 Release 前取消工作流，更新范围改为仅 HTTP/HTTPS，正式版本见 v0.8.2。以下为已取消候选的历史说明，不代表当前功能。

Remote Ops 现在支持从内网 HTTP/HTTPS、DSH 主机文件目录或共享盘、SFTP 目录手动检查并安装更新。设置在「更多设置 → 检查更新」中；保存来源后点击「仅检查版本」或「检查并更新」。SFTP 复用已保存 SSH 环境的凭据，不打开终端。

- 三种自定义来源共用 `latest.json`；随包提供 `scripts/create-update-manifest.mjs`，校验官方 tgz/SHA256 后生成可跨来源复用的相对路径清单。
- 打开面板和更新窗口不访问更新源，没有定时检查或自动重启。当前运行版本、已安装版本和等待重启状态分开显示；重复点击复用安装任务，待重启版本不重复安装，旧版本不自动降级。
- 下载后校验 SHA256、包名、版本及 DSH bundle，再通过当前 profile 的 DSH 插件管理器安装，继承已有依赖源、代理、兼容性与构建批准策略。安装成功后需手动重启 DSH 并刷新页面。
- 新增随包 `remote-ops-updates` 操作 skill，README 同步源配置、清单生成、更新和排错步骤。未修改 Agent。
- 更新期间关闭窗口不取消安装；DSH 热重载插件前端后会恢复已打开的更新窗口并读取实际安装结果。

验证：377 项回归与 smoke、17 个浏览器场景通过；HTTP、文件目录及 SFTP 的 15 组真实 DSH 候选验收通过。详细范围见 [验收记录](../testing/dsh-remote-ops-v0.8.1-acceptance.md)。

发布资产仍仅为 `dsh-remote-ops-v0.8.1.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.8.1.txt`。`latest.json` 在内网部署时生成，不新增 GitHub Release 资产。

HTTP 来源首版支持无需额外认证头的地址；内部 HTTPS 证书需由 DSH Node 信任。文件共享使用运行 DSH 的账号权限，Windows 映射盘必须对该账号可见。SFTP 使用绝对远端路径。更新设置在同一 DSH home 共享，安装仅作用于当前 profile；环境数据保留，运行中的连接和任务不跨重启恢复。旧版电脑需要先手动升级一次才能配置新来源。

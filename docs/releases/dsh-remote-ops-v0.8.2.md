# dsh-remote-ops v0.8.2

Remote Ops 支持配置内网 HTTP/HTTPS 更新地址，在「更多设置 → 检查更新」中保存后，手动点击「仅检查版本」或「检查并更新」。可填写目录地址或 `latest.json` 地址，默认 GitHub Release 来源继续可用。

- 随包提供 `scripts/create-update-manifest.mjs`，校验官方 tgz 和 SHA256 后生成 `latest.json`。先上传安装包和校验文件，最后发布版本清单。
- 打开面板或更新窗口不访问更新源；没有定时检查或自动重启。仅安装更高的稳定版本，待重启时不重复安装，不自动降级。
- 下载后校验 SHA256、包名、版本和 DSH bundle，通过当前 profile 的原生 DSH 插件管理器安装，使用已有依赖源、代理、兼容性和构建批准配置。
- 窗口区分当前运行版本和已安装版本。安装期间关闭窗口不取消安装，DSH 重载前端模块后恢复已打开的窗口并读取实际结果；安装后手动重启 DSH 并刷新网页生效。
- README 与随包 `remote-ops-updates` skill 同步配置、清单生成及排错步骤；不修改 Agent。

验证：374 项回归和 smoke、17 个浏览器场景、11 组真实 DSH 候选验收通过，包含实际 HTTPS 下载与安装。[完整验收记录](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.8.2-acceptance.md)。

发布附件仅为 `dsh-remote-ops-v0.8.2.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.8.2.txt`。`latest.json` 在部署内网更新源时生成，不增加 GitHub 附件。

自定义更新来源仅接受 HTTP/HTTPS，不支持文件目录、共享盘、FTP 或 SFTP。HTTP 服务需无需额外认证头，文件及重定向限于同一来源；内部 HTTPS 证书需由 DSH Node 信任。依赖需有可访问的源，Chromium 仍按需安装。旧版电脑先手动安装一次本版本，再配置内网更新地址。

v0.8.1 的发布流程已取消，未生成 Release；本版本为精简后的正式交付。

# dsh-remote-ops v0.8.2

Remote Ops 支持配置内网 HTTP/HTTPS 更新地址，在「更多设置 → 检查更新」中保存后，手动点击「仅检查版本」或「检查并更新」。可填写目录地址或 `latest.json` 地址，默认 GitHub Release 来源继续可用。

- 随包提供 `scripts/create-update-manifest.mjs`，校验官方 tgz 和 SHA256 后生成 `latest.json`。先上传安装包和校验文件，最后发布版本清单。
- 点击检查按钮后读取更新源，找到更高的稳定版本后可安装；安装完成后提示重启生效。
- 下载后校验 SHA256、包名、版本和 DSH bundle，通过当前 profile 的原生 DSH 插件管理器安装，使用已有依赖源、代理、兼容性和构建批准配置。
- 窗口区分当前运行版本和已安装版本。安装期间关闭窗口不取消安装，DSH 重载前端模块后恢复已打开的窗口并读取实际结果；安装后手动重启 DSH 并刷新网页生效。
- README 与随包 `remote-ops-updates` skill 提供配置、清单生成及排错步骤。

验证：374 项回归和 smoke、本地 17 个浏览器场景通过；候选包与 GitHub 正式包分别通过 11 组真实 DSH 验收，包含实际 HTTPS 下载、安装及重启。正式 SHA256 与本地包、GitHub digest 一致。CI 结果与边界见 [完整验收记录](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.8.2-acceptance.md)。

发布附件为 `dsh-remote-ops-v0.8.2.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.8.2.txt`。部署内网更新源时，使用随包脚本生成 `latest.json`。

配置 HTTP/HTTPS 目录地址或 `latest.json` 地址时，使用可由 DSH 主机直接读取的 URL，包含协议、主机和路径。文件及重定向须保持同源，内部 HTTPS 证书需由 DSH Node 信任。依赖使用可访问的 npm/pnpm 源，Chromium 可按需安装。旧版电脑先手动安装本版本，再配置内网更新地址。

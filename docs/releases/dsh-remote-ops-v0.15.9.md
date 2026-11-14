# dsh-remote-ops v0.15.9

Windows 上使用 DSH 安装本地插件包时，pnpm 在处理大型 Chromium 文件时可能报 `ERR_PNPM_ENOTEMPTY`。本版将大文件分成每片最多 32 MiB 的条目，随同一个标准插件包分发。插件在本机自动还原并校验 Chromium 后打开网页。

在 DSH 的「插件 → 添加插件 → 安装第三方插件」中，填入 `dsh-remote-ops-v0.15.9.tgz` 的完整路径并安装。重启 DSH 后，在 Remote Ops 的「设置 → 更新」确认「当前运行」和「已安装」均为 `v0.15.9`。已有内网更新源的用户也可以在管理员部署新版后点击「检查并更新」。

已在 Windows 的 DSH Desktop `0.2.2-rc.1` 中从 `v0.15.7` 直接升级并打开测试网页。安装包支持 Windows x64 和 Linux x64。[下载插件包](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.9/dsh-remote-ops-v0.15.9.tgz) · [SHA256 校验文件](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.9/SHA256SUMS-dsh-remote-ops-v0.15.9.txt)

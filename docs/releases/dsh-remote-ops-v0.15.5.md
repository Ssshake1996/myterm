# dsh-remote-ops v0.15.5

安装或升级 myterm 后，在「网页」中输入网址即可打开。Windows x64 和 Linux x64 的插件内 Chromium 随包提供。首次加载时，插件在当前用户的短路径缓存中校验浏览器文件并验证启动。打开网址会等待准备完成，缓存损坏会从插件包自动修复。

Agent 可直接调用 `remote_browser_open`。自动准备失败时，「设置 → 网页」显示原因并提供「重试离线修复」。独立窗口沿用用户选择的引擎，显式选择专用 Chromium 时可单独下载。Linux 需要 Chromium 的系统动态库。

**全新安装**可在 DSH 插件管理中安装完整包。[下载安装包](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.5/dsh-remote-ops-v0.15.5.tgz) · [安装包 SHA256](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.5/SHA256SUMS-dsh-remote-ops-v0.15.5.txt)

**内网一键升级**请将 ZIP 和校验文件交给能够部署现有 HTTP/HTTPS 更新源的 Agent。按说明部署后，v0.14.0、v0.14.1 会通过 v0.14.3 小包自动升级，使用稳定更新源的 v0.15.4 可直接升级。用户在「设置 → 更新」点击一次「检查并更新」即可。[内网升级 ZIP](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.5/myterm-intranet-upgrade-0.14.3-to-0.15.5.zip) · [ZIP SHA256](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.5/SHA256SUMS-myterm-intranet-upgrade-0.14.3-to-0.15.5.txt) · [中文部署说明](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.5/myterm-intranet-upgrade-guide.zh-CN.md)

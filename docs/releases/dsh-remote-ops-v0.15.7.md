# dsh-remote-ops v0.15.7

**网页截图跟随页面显示。** Agent 获取的截图保留网页的原始画面。密码框默认显示圆点，网页切换到「显示密码」后，截图也会显示明文。普通输入框中的文字同样可见。

**新网页录制以明文保存实际填写的密码。** 人工输入、Agent 直接或通过参数填写，以及使用已保存的网站凭据登录，都可从录制记录和导出的 JSON 中读回实际填写的值。空字符串表示清空字段。旧录制仍可读取，已省略的密码无法从旧文件恢复。随包的 `remote-ops-browser` 和 `remote-ops-web-recordings` 两份 Skill 已更新。

完整安装包包含 Windows x64 和 Linux x64 的内嵌 Chromium。Linux 主机需要提供 Chromium 的系统动态库。[下载完整安装包](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.7/dsh-remote-ops-v0.15.7.tgz) · [安装包 SHA256](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.7/SHA256SUMS-dsh-remote-ops-v0.15.7.txt)

内网 HTTP/HTTPS 更新源可部署一键升级 ZIP。v0.14.0、v0.14.1 客户端通过 v0.14.5 过渡包升级到 v0.15.7，使用稳定清单的 v0.15.x 客户端直接升级。用户点击一次「设置 → 更新 → 检查并更新」即可。[内网升级 ZIP](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.7/myterm-intranet-upgrade-0.14.5-to-0.15.7.zip) · [升级包 SHA256](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.7/SHA256SUMS-myterm-intranet-upgrade-0.14.5-to-0.15.7.txt) · [中文部署说明](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.7/myterm-intranet-upgrade-guide.zh-CN.md)

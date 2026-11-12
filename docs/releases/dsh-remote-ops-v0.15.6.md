# dsh-remote-ops v0.15.6

**内嵌浏览器**会随分栏调整大小。固定宽度的设备网页可以等比显示，桌面视口仍可选择原始大小。每个标签都有关闭按钮，右侧的 ＋ 可新建网页。标签溢出时，当前标签自动滚入可见区域。

**网页录制**同时保留人工与 Agent 的操作。新记录给出元素的测试 ID、角色和名称、表单标签或 CSS，并标注定位是否唯一。设备地址与同源页面路径分别记录，iframe 和可见状态区域的反馈也会保存。Agent 可以把同一份记录用于不同管理 IP 的设备，保留表单中输入的业务 IP。已有版本 1 的录制仍可读取。

**两份随包 Skill 已更新。** `remote-ops-web-recordings` 说明如何选择定位、参数化设备地址，以及如何把观察到的反馈用于用户指定框架的用例。`remote-ops-browser` 支持 Agent 使用用户提供的密码完成登录，录制会遮蔽密码字段。

Windows x64、Linux x64 安装包内含插件使用的 Chromium。Linux 需要系统提供 Chromium 所需的动态库。可以在 DSH 的插件管理中安装完整包。[下载完整安装包](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.6/dsh-remote-ops-v0.15.6.tgz) · [安装包 SHA256](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.6/SHA256SUMS-dsh-remote-ops-v0.15.6.txt)

内网 HTTP/HTTPS 更新源可部署下方 ZIP。v0.14.0、v0.14.1 通过 v0.14.4 小包继续升级到 v0.15.6，已使用稳定清单的 v0.15.x 客户端直接升级。两条路径均从插件内点击一次「检查并更新」。[内网一键升级 ZIP](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.6/myterm-intranet-upgrade-0.14.4-to-0.15.6.zip) · [升级包 SHA256](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.6/SHA256SUMS-myterm-intranet-upgrade-0.14.4-to-0.15.6.txt) · [中文部署说明](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.6/myterm-intranet-upgrade-guide.zh-CN.md)

# myterm v0.15.7 内网更新部署

本说明供维护现有 HTTP/HTTPS 更新源的管理员或 Agent 使用。客户端继续从「设置 → 更新 → 检查并更新」升级。

1. 下载 `myterm-intranet-upgrade-0.14.5-to-0.15.7.zip` 和对应的 SHA256 校验文件。在 Windows 上运行 `Get-FileHash -Algorithm SHA256 -LiteralPath .\myterm-intranet-upgrade-0.14.5-to-0.15.7.zip` 核对摘要。解压 ZIP，并备份服务器现有的更新清单。
2. 上传整个 `stable/v0.15.7/` 目录，再发布 `stable/latest.json`。从客户端网络下载稳定清单指向的 tgz，核对 SHA256。已使用稳定清单的 v0.15.x 客户端会直接升级。
3. 对于 v0.14.0、v0.14.1 客户端，先上传 ZIP 根目录的 v0.14.5 小包和校验文件，最后发布根目录的 `latest.json`。用户点击一次更新后，过渡包会校验并自动安装 `stable/v0.15.7/` 中的完整包。
4. 保留现有版本目录，让正在运行 v0.14.2、v0.14.3 或 v0.14.4 过渡包的电脑完成各自已开始的安装。已升级到 v0.15.x 且仍指向根入口的客户端，可将更新源改为 `stable/latest.json`。

在更新页核对「当前运行」和「已安装」均为 v0.15.7。要验收网页录制，打开一个本机可访问的登录页，开始录制后输入测试密码，再停止录制并导出 JSON。输入事件的 `input.value` 应包含实际填写的密码，Agent 填写的操作步骤另有 `details.step.value`。截图应与网页当时的密码显示状态一致。

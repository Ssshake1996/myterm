# myterm v0.15.6 内网更新部署

把本说明、`myterm-intranet-upgrade-0.14.4-to-0.15.6.zip` 和对应的 SHA256 校验文件交给管理现有 HTTP/HTTPS 更新源的 Agent。客户端沿用「设置 → 更新 → 检查并更新」入口。

1. 在暂存目录运行 `Get-FileHash -Algorithm SHA256 -LiteralPath .\myterm-intranet-upgrade-0.14.4-to-0.15.6.zip`，对照校验文件。解压 ZIP，备份更新服务器现有的清单。
2. 先上传完整的 `stable/v0.15.6/`，再发布 `stable/latest.json`。从客户端网络下载稳定清单指向的 tgz 并核对 SHA256。使用此清单的 v0.15.x 客户端可直接升级。
3. 需要支持 v0.14.0、v0.14.1 时，将根目录中的 v0.14.4 小包和校验文件上传至旧更新源，最后发布根目录的 `latest.json`。根清单公告 v0.14.4，过渡包校验并安装 `stable/v0.15.6/` 内的完整包。用户点击一次即可完成两阶段安装。
4. 正在通过 v0.14.2 或 v0.14.3 迁移的电脑仍会使用各自固定的目标。让正在迁移的这批电脑完成后再切换根清单，保留原有版本目录。已安装 v0.15.x 且仍指向过渡包根入口的客户端，可在设置中将源改为 `stable/latest.json`。

在更新页核对「当前运行」和「已安装」均为 v0.15.6。打开「网页」，输入本机能访问的设备地址。可请 Agent 读取 `remote-ops-browser` 和 `remote-ops-web-recordings`，或录制一次按钮点击并导出 JSON，核对其中的 `target.locators` 和同源页面的 `devicePath`。内嵌 Chromium 随完整包提供，Linux x64 需要相应的系统动态库。

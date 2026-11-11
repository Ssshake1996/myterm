# myterm 内网一键升级包

供使用内网 HTTP/HTTPS 更新源的旧版 Remote Ops 客户端升级到 v0.15.4。v0.14.1 的更新文件上限为 64 MiB，过渡包 v0.14.2 小于 1 MiB。旧插件安装过渡包后，过渡包会自动下载、校验并安装带有内置浏览器的完整包。

## 发给 Agent 的任务

> 请把这台旧电脑的 myterm 升级到 v0.15.4。先读取 Remote Ops 的当前版本和已配置的内网更新地址。检查该地址是否已经提供本说明中的过渡包和完整包。如果需要部署，请使用已有的内网发布通道，按下方顺序发布并校验文件。然后在旧电脑的插件更新页只点击一次「检查并更新」，等待自动完成。最后报告升级前版本、当前运行版本、已安装版本，以及内置 Chromium 打开内网页面的结果。

在 **Remote Ops → 设置 → 更新** 可读取「当前运行」「已安装」和内网地址。确认两项版本已达到 v0.15.4 或更高时，直接验收即可。如果当前运行 v0.14.2，先观察正在进行的第二阶段。若 Agent 只能访问客户端，且内网源还缺文件，向内网管理员索取该更新目录的部署通道，或把本说明交给管理员。客户端访问清单的 HTTP 地址本身不提供写入权限。

## 获取并校验部署包

从 myterm 的 v0.15.4 发布页取得 `myterm-intranet-upgrade-0.14.2-to-0.15.4.zip` 和 `SHA256SUMS-myterm-intranet-upgrade-0.14.2-to-0.15.4.txt`。在无法访问 GitHub 的网络，可以从联网电脑一并传入这两个文件。[GitHub 发布页](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.15.4)

将两个文件放在同一个暂存目录，在该目录用 PowerShell 校验并解压。

```powershell
$zip = 'myterm-intranet-upgrade-0.14.2-to-0.15.4.zip'
$sums = 'SHA256SUMS-myterm-intranet-upgrade-0.14.2-to-0.15.4.txt'
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip -ErrorAction Stop).Hash.ToLowerInvariant()
if ((Get-Content -LiteralPath $sums -Raw -ErrorAction Stop).Trim() -ne "$actual  $zip") {
    throw '部署包 SHA256 校验失败，请重新取得 ZIP 和对应的校验文件。'
}
Expand-Archive -LiteralPath $zip -DestinationPath './myterm-feed' -ErrorAction Stop
```

在 Linux 上也可在暂存目录运行 `sha256sum -c SHA256SUMS-myterm-intranet-upgrade-0.14.2-to-0.15.4.txt`，确认输出 `OK` 后用 `unzip` 解压。

## 管理员部署

1. 找到旧电脑已配置的更新地址。如果地址是 `https://intranet.example/plugins/myterm/latest.json`，部署目录就是内网服务器上映射为 `/plugins/myterm/` 的目录。如果原来填的是目录，沿用该目录。备份将要替换的清单，保留同目录的其他发布文件。
2. 先上传 `stable/v0.15.4/` 中的三个文件，再发布 `stable/latest.json`。如果该稳定渠道已经公告了更高版本，保留已有清单，过渡包会读取固定版本目录。然后上传根目录的 `dsh-remote-ops-v0.14.2.tgz` 及其对应的校验文件。
3. 从客户端所在网络，以更新入口为基址，按解压出的清单解析相对 URL，下载两个 tgz，分别与包内对应的 `SHA256SUMS-*.txt` 核对。确认 `stable/v0.15.4/latest.json` 公告 v0.15.4 后，**最后替换根目录的 `latest.json`**。重新读取根入口，确认包名为 `@dsh/remote-ops`、版本为 `0.14.2`。若这些清单和文件已经就位，直接执行客户端验收即可。
4. 让清单请求重新校验缓存。如果部署验证失败且已切换根入口，恢复此前备份的根清单。保留已发布的版本文件，供正在升级的客户端完成下载。

ZIP 供管理员部署。DSH 下载其中的两个 tgz，用户在插件里操作即可。在正常工作的旧版安装上，整个过程沿用 DSH 原有安装机制和构建审批策略。第二阶段需要能从内网完整下载约 234 MiB。

## 用户操作

在 **Remote Ops → 设置 → 更新** 点击一次 **检查并更新**。经过 v0.14.2 时保持 DSH 运行，第二阶段会自动开始。已有终端任务或文件传输正在执行时，插件会等待后再切换版本。

界面热加载后如设置页收起，重新打开查看结果。「当前运行」和「已安装」都应显示 **v0.15.4**。在网页面板选择内置 Chromium，打开这台电脑本来就能访问的内网页面，核对页面内容，再确认原有环境仍在。无法访问目标电脑时，分别报告服务器部署结果和待执行的客户端验收。

已在 Windows x64 的 DSH Desktop 0.2.2-rc.1 上分别从 v0.14.0、v0.14.1 验证一次点击升级，并验证了临时 HTTP 错误自动重试、DSH 在第二阶段退出后再次启动继续升级，以及损坏包被校验拒绝。

## 后续维护

- `stable/v0.15.4/` 是过渡包固定使用的目标目录。仍有旧电脑待升级期间，保留这里的清单、tgz 和校验文件。过渡包对完整包还会核对内置的 SHA256。
- 单配置电脑校验完整包后，插件会把更新地址自动切换到同一内网站点的 `stable/latest.json`。若同一个 DSH 数据目录下的其他配置还装着旧插件，原入口会保留到最后一份旧配置迁移。以后完整包发布到 `stable/` 渠道，原有过渡目标可以继续服务后上线的旧电脑。
- 根入口在迁移期间固定公告 v0.14.2。**已经运行 v0.15.x、仍指向根入口**的客户端在此期间会保持当前版本。旧电脑全部完成后，可将根入口重新公告正式版本。使用包内的 v0.15.4 时，可以把 `stable/latest.json` 中的 `asset` 和 `checksum` 路径各加上 `stable/` 前缀，把这份新清单发布为根目录的 `latest.json`。
- 校验不符时，过渡包会停止安装并在插件的更新页显示错误。恢复服务器上的对应文件后，可从该页重试。临时下载错误会自动重试。已装好过渡包时退出 DSH，下一次启动会自动继续。

## 包的来源

完整包来自官方 `dsh-remote-ops-v0.15.4.tgz`，原包 SHA256 为 `9c912712cf3d4576620e5342aafba4b20a696e82ca2a835b8de300b9126e0942`。为保留一次点击，内网包移除了浏览器补装用的 `postinstall` 声明。Windows x64、Linux x64 的内置浏览器、应用文件和依赖声明均沿用正式包，内网包的 SHA256 见随包校验文件。

## Windows 自定义数据目录

如果「当前运行」和「已安装」均为 v0.15.4，但内置 Chromium 返回 `BROWSER_LAUNCH_FAILED`，请单独核对浏览器运行时报告的可执行文件路径。在一个使用深层 DSH 数据目录的 Windows 测试中，热加载后的可执行文件路径长达 264 个字符，系统返回 `ENOENT`。较短的配置路径通过了网页访问验收。

如果设备已经安装 Google Chrome，可以在网页设置中将「浏览器引擎」选为「Google Chrome」，「网页显示方式」选为「插件内」，再打开内网页面。在上述深目录样例中，此方式已通过实际页面访问验证。报告时分别注明插件升级已完成、随包 Chromium 的错误和路径长度，以及使用本机 Chrome 的验证结果。该操作无需再次安装插件。

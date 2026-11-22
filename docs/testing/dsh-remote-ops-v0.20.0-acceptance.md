# Remote Ops v0.20.0 验收记录

日期：2026-11-22。范围：GitHub Release 下载进度、故障重试、断点续传和原有安装／热加载衔接。不修改 Agent，不改动内网 HTTP(S) 下载流程。

## 发布包

- 包名：`dsh-remote-ops-v0.20.0.tgz`。
- SHA256：`a61c3336c3a858c3bcac0642d02c4046d5c12c58e8f9595e030c525548167b25`。
- 真实 DSH 最终验收读取的包与发布候选包 SHA256 一致。CI 使用仓库中的 `.sha256` 固定该包，不以重新构建的另一个包替换它。
- Release 仅包含上述 tgz 和 `SHA256SUMS-dsh-remote-ops-v0.20.0.txt`。

## 自动化与界面

`npm run check --prefix integrations/dsh-remote-ops`：563 项测试通过（桌面 11、单元 399、客户端 141、契约 12），syntax 和 smoke 通过。

新增 18 项 GitHub 下载专项覆盖：真实 HTTP 断流、落盘偏移、带 If-Range 的续传、新签名重定向、重启恢复、完整缓存复用及缓存缺失、200 忽略 Range、206 范围／ETag 不匹配、416、持续慢速与空闲超时、限流等待、单写入者、资产变化、SHA256／包身份失败、取消、未知文件大小、死进程锁恢复以及一次安装。

浏览器更新场景 5 个步骤通过：保存来源不联网、重新打开设置、390px 窄屏、下载／重试／继续下载／未知长度显示、安装过程关闭和重载前端后恢复。该层使用真实客户端与插件后端、模拟宿主；真实宿主验证另列。DSH UI 契约静态检查通过；非 Codex 插件没有 `.codex-plugin/plugin.json` 的提示保留。

## 真实 DSH

Windows 本机，DSH `0.2.1-rc.5`、Chrome，在独立 DSH_HOME/profile 中安装最终候选包。通过测试进程专用 fetch 适配器将 GitHub URL 指向本地可控 HTTP 服务；实际插件、HTTP 响应、文件落盘、SSH 连接、DSH 安装器和热加载均运行。此适配器不进入发布包，不改变日常 DSH 或 Agent。

1. 安装包每次传输 1 MiB 后断开；初次下载和三次自动重试共保留 4 MiB。界面显示字节和恢复入口，切换工作区后进度保留。
2. 重启隔离 DSH 后显示原版本和 4 MiB 偏移；没有自动请求安装包或安装。
3. 创建真实 SSH 连接、CMD 终端和活动 API 请求，保存对话草稿。
4. 点击继续下载，从 `bytes=4194304-` 携带匹配的 If-Range 继续；完整校验后等待活动 API 请求结束，再执行安装与热加载。运行和安装版本匹配，进程未重启，CMD／SSH streamId 保持，SSH 服务端连接数仍为 1，草稿保留，更新后 SSH 命令成功。

为验证未来更新，目标使用从最终包派生的合成 `0.20.1`，只存在于隔离测试服务，未发布为正式 Release。测试的是候选 `0.20.0` 更新器执行后续更新的能力。

原始记录：`output/github-update-v0.20.0-native-final/evidence.json`；包含断流恢复、等待任务和生效截图。复现入口：

```powershell
$env:DSH_CLI='<已安装 DSH 的 lib/bin.js>'
$env:GITHUB_UPDATE_OUTPUT='<独立的测试输出目录>'
node e2e/runner/github-update-native.mjs <候选 tgz>
```

## 真实 GitHub 网络

- 使用正式 `v0.10.1` 小安装包完成中断与全文件验收：保存 69,312 字节，新的 GitHub 跳转返回 206，从该偏移继续，最终 SHA256 和包身份均通过。仅下载和校验，没有安装或降级。记录：`output/github-update-v0.20.0-live-small/github-download-live.json`。
- 对正式 `v0.19.3` 的 247,109,336 字节包进行真实低速观察：首次保留 1,063,586 字节后继续。整个观察持续 753 秒，结束时已保存 29,427,072 字节，文件仍在更新，没有触发原来的 10 分钟总时限。
- 大包公网试验是有界的传输观察，未完成全文件下载，随后停止测试进程；不能把它算成一次公网完整升级。大包完整下载、校验、安装与连接保留已在上述真实 DSH／可控 HTTP 环境验证。未声称其他电脑或代理具备相同网络吞吐。

真实网络复现（只下载、不安装）：

```powershell
node integrations/dsh-remote-ops/test/github-download-live.mjs <独立输出目录> dsh-remote-ops-v0.10.1
```

## 使用边界

续传依赖服务端接受范围请求；响应不匹配或缺少可靠标识时按界面提示重新下载。下载完成、安装完成与热加载生效分别确认。旧运行版本执行中的下载仍使用旧逻辑，安装 v0.20.0 后才具备此次能力。

# Remote Ops Windows 11 x64 整合包

此包携带与插件 Playwright 匹配的完整 Chromium、Headless Shell 和辅助文件。插件运行依赖通过 DSH 正常联网安装，需要已安装可运行的 DSH、Node.js 22+ 和 pnpm，并能访问所配置的 npm 源。这不是完全离线安装包。

1. 解压 ZIP。在 PowerShell 中进入解压目录。
2. 使用运行 DSH 的同一 Windows 用户、DSH_HOME 和 profile 安装：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profile web
# 自定义 DSH_HOME 时明确指定目录：
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profile web -DshHome 'D:\DSH data'
```

脚本校验全部文件摘要，再通过 DSH 安装本地插件包、放置浏览器并实际启动两种模式检查。检查时会短暂出现一个独立浏览器窗口。脚本不停止正在运行的 DSH；安装完成后自行重启 DSH 并刷新网页，核对插件版本。

浏览器位于 `$DSH_HOME/remote-ops/browser/runtimes/`，登录资料位于相邻的 `profiles/`，网站、流程和偏好保持原有位置。插件 tgz 保存在 `$DSH_HOME/remote-ops/packages/`，所以安装完成后可以移走下载的 ZIP 和解压目录。升级复用匹配的运行时；浏览器版本变化时使用新版整合包。旧版本目录保留，供回退使用。

如果 npm 依赖安装失败，检查 npm 源和代理、pnpm 是否可用，然后重跑同一命令。浏览器缺失时，也可在插件“浏览器设置与高级功能”点击“安装 / 检查 Chromium”联网补齐；支持 Playwright 的 HTTPS_PROXY、PLAYWRIGHT_DOWNLOAD_HOST 和 PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT 环境变量，在启动 DSH 前设置。不提供密码或令牌给 Agent。

仅校验解压文件：`powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -VerifyOnly`。DSH 安装位置不在 PATH 时，可用 `-DshEntry '...\@deepseek-ai\dsh\lib\bin.js'` 指定已安装的 DSH CLI。不会修改 Agent、全局浏览器设置或用户 Chrome/Edge 安装。

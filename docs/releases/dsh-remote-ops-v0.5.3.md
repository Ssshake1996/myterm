# dsh-remote-ops v0.5.3

Windows 11 x64 新增允许联网的 Chromium 整合包。普通 tgz 继续提供；整合 ZIP 携带完整 Chromium、Headless Shell 及辅助文件，插件 npm 依赖通过 DSH 正常联网安装。安装后无需手工配置浏览器路径。

- PowerShell 安装入口支持明确的 DSH_HOME/profile，校验全量 SHA256、通过 DSH 安装本地插件包，再实际检查两种浏览器模式。tgz 留在稳定目录，移走下载文件不破坏 profile 中的 file: 引用。
- 浏览器按锁定的 Playwright 版本保存，自动选择匹配的插件运行时，并兼容已有匹配缓存；Chrome/Edge 保留原有显式选择。登录 profile、网站、流程和偏好保持原有位置。
- 设置分别显示插件内和独立窗口的准备状态，提供联网安装输出、失败重试和缺失/版本不匹配恢复说明。重复安装复用完整浏览器，缺少 Headless Shell 不再误报全部就绪。
- 修复 DSH 重启后旧对话未激活时访问未声明的 sessionController 服务所导致的网页打开失败；通过宿主可选服务恢复原有会话，缺少该服务的宿主仍可启动插件。不修改 Agent 的激活实现。
- README、WEB 和随包 remote-ops-browser skill 同步更新。不修改 Agent、DSH 内核、已有工具 Schema 或 SSH/SFTP 执行逻辑；共享输入及原生对话取消行为保持不变。

安装：下载并校验 `dsh-remote-ops-v0.5.3-windows-x64.zip`，解压后执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profile web
```

自定义 DSH_HOME 时添加 `-DshHome '实际目录'`，必须与运行 DSH 的同一用户和 profile 一致。依赖安装要求可运行的 DSH、Node.js 22+、pnpm 及 npm 源访问权限。安装检查会短暂打开测试窗口；脚本不停止正在运行的 DSH，完成后重启 DSH 并刷新网页，确认 v0.5.3。也可正常安装小包：`dsh plugin --profile web add .\dsh-remote-ops-v0.5.3.tgz`，然后在浏览器设置联网准备 Chromium 或选择本机 Chrome/Edge。

发布验收记录见 `docs/testing/dsh-remote-ops-v0.5.3-acceptance.md`。实际用户电脑、内网站点和其他 DSH 版本的兼容性需在相应环境验证；本版本不包含暂缓的 SSH 命令参数空格问题。

# dsh-remote-ops v0.5.4

修复网页工具步骤与定位器的格式兼容，独立窗口默认跟随 Windows 默认浏览器，并改为轻量 tgz 发布、由插件按需安装 Chromium。不修改 Agent 或 DSH 内核。

- `steps` 支持动作数组、单个动作字典、仅含 steps 数组的包装字典及其 JSON 字符串。`target` 支持定位字典、JSON 字符串定位字典和 CSS / XPath 字符串；参数 Schema、工具说明、运行时及随包 skill 同步。所有动作先完整校验，等价参数使用同一请求 ID 去重。实际缺失的目标仍须补齐，不猜测点击位置。
- 独立窗口新增独立引擎偏好，Windows 默认跟随当前用户的 HTTP(S) 默认 Chrome / Edge，使用隔离 profile。插件内引擎设置保留。显式网站/调用选择优先；默认不受支持或无法读取时明确报错，不静默改开 Edge。已有页面不会因引擎选择变化自动关闭。
- 新增插件工具 `remote_browser_runtime`：status 检查、install 按需联网下载当前插件 Playwright 锁定的 Chromium 与 Headless Shell；轮询状态确认就绪。安装复用已有匹配运行时、保留登录 profile，不修改浏览器偏好或全局 Agent 设置。
- 后续 Release 只提供 `dsh-remote-ops-v0.5.4.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.5.4.txt`。保留 Linux、Windows 测试门禁，移除 Windows ZIP 构建与要求；历史 v0.5.3 资产保留。

安装校验后的包：

```powershell
dsh plugin --profile web add .\dsh-remote-ops-v0.5.4.tgz
```

完成后重启 DSH 并刷新网页，确认 v0.5.4。需要专用 Chromium 时可在主对话让 Agent 按需安装，或使用设置中的“安装 / 检查 Chromium”。下载依赖网络，代理/镜像环境变量应在启动 DSH 前设置；独立窗口需要同一交互桌面。支持 DSH 0.2.0-rc.2；其他宿主版本、用户另一台电脑及实际内网站点需在对应环境验证。

验证：321 项测试及 smoke、12 个浏览器 E2E 场景、20 组真实 DSH 验收通过，另完成 Windows 默认浏览器真实进程核对、DSH 重启共享输入和正式 v0.5.3 升级验证。详情见 [v0.5.4 验收记录](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.5.4-acceptance.md)。

正式包复验完成：Release 仅含 tgz 和校验文件，SHA256、发布源码和 51 个安装文件一致；正式 tgz 新装后 20 组真实 DSH 验收再次通过，重启和升级复验通过。Linux、Windows 发布门禁及主分支浏览器 E2E 均通过。

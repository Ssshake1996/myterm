# Remote Ops v0.9.1 验收

日期：2026-10-24。Windows 开发机，真实 DSH 0.2.0-rc.2，Chrome 155。使用隔离 DSH_HOME / profile、确定性测试模型及本地 SSH、网页、API 和 HTTP 更新源。没有修改 Agent 源码、日常 Agent 配置或全局 skill。

## 本地回归

- `npm run check --prefix integrations/dsh-remote-ops`：262 个后端、115 个客户端、11 个契约测试，共 388 项通过；语法检查、生成客户端同步和 smoke 通过。
- 浏览器套件 20/20 通过；覆盖紧凑标签、侧栏缩放、相同活动标签的 Home/End 定位、无输出时 SSH 尺寸同步、当前 TXT / 全部 ZIP 导出、背景任务、SFTP、网页、API、状态 404 和更新源 404。
- 新增请求诊断回归覆盖 JSON / 非 JSON / 空响应、网络失败、AbortError、带签名的重定向、错误摘要限长与凭据脱敏、清单 / 校验文件 / tgz 三阶段，以及诊断状态恢复。
- 重复提示回归验证同一运行标识内关闭后继续重试但不重弹，页面重载后仍去重，手动刷新仍可反馈，更换运行标识后重新提示。
- 浏览器测试 runner 的 4 项测试通过；仅当前故障场景声明的精确状态码、路径、方法和错误代码允许作为预期错误，其余网络和控制台错误仍导致失败。
- DSH UI 契约 14 项通过、0 错误；唯一提示为没有 Codex 插件 manifest。修改的两个随包 skill 格式校验通过。

## 候选包真实 DSH

候选 tgz SHA256：`5dee9da39bd77bb0451dfce6541e68086b0952f1e409eb79a9ff721a4282f7b6`。

完整功能验收 7 组通过：原生 Agent 实际调用本地 CMD、三个 SSH 会话与网页工具；紧凑栏与真实日志下载；SSH 200×50 尺寸与无输出反馈；设置保留网页节点、主对话草稿；环境返回；API 请求和 JSON Pointer；窄栏、深色、键盘与五个随包 skill 的原生发现和读取。桌面单行终端栏测得 37px，标签主体 28px、外框约 32px。

内网升级与故障验收 8 组通过：

1. 官方 0.9.0 安装后保存不存在的 HTTP 源，空闲不会检查源。
2. 手动检查缺失清单时显示更新错误。
3. 经真实 DSH 插件管理器从 HTTP 源升级到候选 0.9.1。
4. 升级后旧进程继续运行、浏览器重载及 DSH 重启，状态刷新正常。
5. 新进程运行 0.9.1，保留更新源设置。
6. 使用故意返回 404 的测试源，分别验证清单、校验文件、安装包的地址和阶段，以及关闭重开后的错误详情；测试凭据未出现在详情中。用于触发缺失文件的 0.9.2 是测试清单，未安装该版本。
7. 在真实 DSH 浏览器中主动使状态请求返回 404，验证“状态刷新失败”、地址和响应详情；关闭后不重复、刷新网页不重复、手动刷新可反馈、恢复后清除。
8. 保持同一个服务端口，真正停止并重新启动隔离 DSH，验证后端运行标识改变；再注入同类 404，允许重新提醒一次。

状态 404 是故障注入，不代表复现了另一台电脑的根因。正常升级过程中没有观察到状态接口 404。若接口从启动开始一直不可用，浏览器暂按当前标签页去重，读取到后端运行标识后再按运行周期管理。

本地证据：`output/release091-check-final.log`、`output/e2e/release091-final/report.json`、`output/playwright/release091-native-candidate-1792836567269-acceptance.json`、`output/playwright/update091-native-candidate-1792836590733-evidence.json`。最后一份原始记录的 `real404s` 汇总字段包含重启步骤中主动注入的 404；判断请依据逐项步骤与原始 network 记录，不能把它当作自然发生的升级故障。后续正式包复验使用明确的 `faultInjected` 分类。

README 三张截图取自上述候选包真实安装。没有验证其他 DSH 版本、另一台电脑或真实生产设备；原始 404 根因需由新版详情提供的具体地址继续定位。

## 正式发布复验

- 发布提交 `d4c5105c7ac218ed8bbf3a0b6694eaa7b1cbe452`。[Linux 插件 CI](https://github.com/Ssshake1996/myterm/actions/runs/40085051704) 通过。
- [Linux 浏览器 CI](https://github.com/Ssshake1996/myterm/actions/runs/40085051645) 首轮 19/20：功能检查通过，20 次模块切换的 p95 为 260.3ms，超过原有 250ms 门槛。同一提交、相同门槛复跑 20/20，通过时 p95 为 212ms；没有为重试改代码或放宽门槛。Windows 本地该样本为 93ms。这些是对应测试运行的样本，不是所有机器的性能保证。
- 发布流程的 Windows 首轮在既有 `routes.test.mjs` 测试失败：测试固定等待 20ms 后直接访问尚未创建的 `terminals[0].output`。实际路由会等待 `state.ready`；该测试在本次提交中未修改，本地和 Linux 已通过。保留首轮日志；同一提交复跑 Windows 检查通过，没有修改产品或降低断言。该固定等待仍是既有测试的时序脆弱点。
- 发布标签 `dsh-remote-ops-v0.9.1` 指向上述提交。[发布流程](https://github.com/Ssshake1996/myterm/actions/runs/40085536037) 的 Linux 打包、Windows 检查和发布均通过。
- [正式 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.9.1) 仅包含 tgz 与 SHA256 校验文件。重新下载后校验通过，SHA256 与候选包一致，67 个包内文件均逐字节匹配仓库源码，包含 5 个随包 skill；README 截图对应同一包内容。
- 正式 tgz 全新安装到隔离的真实 DSH，重新完成全部 7 组功能验收，`errors: []`。实际原生 skill 工具读取到新版“状态刷新失败”和每次运行仅提示一次的说明。证据：`output/playwright/release091-native-official-1792837870516-acceptance.json`。
- 使用下载的正式附件建立本地 HTTP 更新源，重新完成全部 8 组升级与故障验收：官方 0.9.0 → 0.9.1 安装、网页重载、真实 DSH 重启、清单／校验文件／安装包 404 诊断，以及同一运行周期提示去重、手动刷新、实际同端口重启后重新提示。`pageErrors: []`、`unexpected404s: []`；故障注入以 `faultInjected` 单独标记。证据：`output/playwright/update091-native-official-1792837870515-evidence.json`。
- 随包脚本对正式附件生成 `latest.json` 成功；该清单供用户部署内网源使用，没有增加 Release 附件。预览已更新为正式包真实界面，1440px／390px、五张图片、键盘标签切换及无横向溢出检查通过。

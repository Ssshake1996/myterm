# Remote Ops v0.12.0 验收记录

本版本新增 Windows 桌面工作区、随包 UIA3 执行器和七个桌面工具。用户与 Agent 操作同一个已登录的 Windows 桌面，优先使用控件引用，也可发送窗口坐标、键盘和 Unicode 输入。本记录区分源码回归、真实系统、安装候选包与正式下载包；未修改 Agent 或宿主核心。

## 源码与浏览器回归

- `npm run check --prefix integrations/dsh-remote-ops`：441 项通过（桌面 11、后端 300、客户端 118、契约 12），另有 smoke 通过。本地证据：`output/desktop-regression-final441.log`。
- 原有终端、网页、文件、API 浏览器回归 22/22 通过，[最终浏览器 CI](https://github.com/Ssshake1996/myterm/actions/runs/40913687833) 与本地 `output/desktop-e2e-regression/report.json` 留存证据。此层使用真实插件前后端与隔离协议服务，不代替原生 DSH 验收。
- 覆盖参数 Schema、完整批次先校验、空字符串填写、跨对话隔离、请求去重、取消后续步骤、未知结果不重放、图片模型能力检查、真实附件引用、日志下载鉴权和关闭后导出。
- 发布脚本增加三项校验回归：CI 重编译包按实际下载字节验证、拒绝损坏包或错名校验文件、GitHub 未提供可选摘要时仍核对 SHA256。下载资产不转发 GitHub API 令牌。
- DSH UI 契约检查无错误；缺少 Codex 插件 manifest 的提示不适用于本 DSH 包。

## Windows 11 真实桌面

系统为 Windows 11 Home x64，10.0.22631；执行器运行在已登录且解锁的用户会话。用独立 WinForms 应用测试，最终结果以实际文件内容验证，测试结束仅关闭测试应用。

- 本机真实桌面：10/10 通过，`output/desktop-pipe-race-after/evidence.json`，包括连续探测竞态回归。
- 隔离的真实 Windows OpenSSH：9/9 通过，`output/desktop-ssh-final-source/evidence.json`。SSH 服务和桌面目标在同一台 Windows 11 上，用真实协议验证 SFTP 部署、InteractiveToken 启动及 SSH TCP 转发，未使用另一台物理电脑。
- 检查包括同一运行时复用执行器、两个独立连接分别关闭、启动等待、UIA 与截图、中文填写、点击后落盘、重复请求不重复保存、实际 Ctrl+A/Unicode/坐标输入、过期执行器和虚构控件引用拒绝。

## 原生 DSH 安装候选包

DSH 0.2.0-rc.2，独立 `DSH_HOME`，真实 Chrome 与真实 Windows 测试窗口。使用本地确定性模型接口驱动原生工具调用；这验证宿主集成与工具执行，不代表开放式模型规划质量。

`e2e/runner/desktop-native.mjs` 四组通过，最终修复后证据 `output/desktop-native-pipe-fixed/evidence.json`：

1. 安装 tgz 后原生发现 skill，调用桌面连接、启动、观察、填写、保存、导出和读取工具。真实 JPEG 通过 DSH 附件服务传入模型请求，保存文件内容正确。
2. 右侧桌面工作区显示实际应用窗口，主对话草稿保留；390px 窄窗口无横向溢出。
3. 用户点击预览、连续按 Ctrl+A、发送中文，再点击保存，与 Agent 操作相同应用；文件内容实际改变。
4. ZIP 下载经过鉴权且为有效二进制；断开后软件继续运行，关闭连接的日志仍能由前端按钮导出。

## Windows Server 真实系统

[最终 Server 桌面工作流](https://github.com/Ssshake1996/myterm/actions/runs/40913687523) 在功能提交 `504daee` 上通过：Windows Server 2022 Datacenter（20348）与 Server 2025 Datacenter（26100），均为具有活动桌面的 x64 GitHub Windows runner，已包含管道探测竞态修复和压力回归。

| 系统 | 本机真实桌面 | OpenSSH 到交互桌面 | 安装候选包的原生 DSH |
| --- | --- | --- | --- |
| Windows Server 2022 | 10/10 | 9/9 | 4/4 |
| Windows Server 2025 | 10/10 | 9/9 | 4/4 |

已下载该轮 CI 证据到 `output/desktop-server-release-gate/desktop-windows-{2022,2025}/`，包含系统信息、执行结果和实际窗口截图。同提交的 [441 项源码 CI](https://github.com/Ssshake1996/myterm/actions/runs/40913687430) 通过。

[既有 Windows OpenSSH 与热加载工作流](https://github.com/Ssshake1996/myterm/actions/runs/40913687668) 同样通过：两个 Server 均完成实际 PTY/exec/SFTP 检查、8 项原生 DSH 多对话终端验证及 8 项热加载/失败恢复验证。证据 `output/desktop-existing-final/`。早期一次 Server 2025 系统探测超时保留在旧 CI 中，最终验收完整通过，未删除断言或用模拟结果代替。

## 排查中修复的问题

- Windows 原生文件锁：按内容摘要复制到独立运行目录，更新包不替换正在加载的 DLL。
- 窗口启动与焦点：启动 PID 与窗口就绪分开；窗口句柄归一到顶层，避免把输入控件当成整个应用。
- 高 DPI：在目标窗口 DPI 上下文捕获，预览留白和缩放映射回物理坐标。
- Windows OpenSSH：部署与单次启动使用有明确输入结束的命令，交互流量改为经过认证的回环 TCP 与 SSH 转发；移除不稳定的长期标准输入桥接。
- Server 冷启动与进程生命周期：本机和远程均通过用户交互会话计划任务启动，保留结构化启动错误并给予冷启动时间。
- 连续人工输入：预览点击与快捷键按顺序发送，避免异步忙状态直接丢弃后一条输入。
- 包内容：运行时必须符合固定文件清单及各文件 SHA256，额外的端点或状态文件会阻止打包。
- 复测发现启动管道探测的竞态：探测客户端立即断开时，Windows 偶尔在接受连接阶段返回管道关闭错误。新增连续 160 次探测，在旧执行器上复现退出，修复后同一执行器保持存活并继续 UIA/鼠标操作。证据 `output/desktop-pipe-race-before` 与 `output/desktop-pipe-race-after`；本机门禁增加至 10 项。
- 独立目录重打包时，运行时检查间接导入了尚未安装的 `ssh2`，使热加载验收夹具打包失败。完整性检查已拆成仅使用 Node 内置模块的模块；回归同时检查无依赖打包、额外端点文件和被篡改二进制。修复后本地真实 DSH 八项热加载通过，证据 `output/desktop-hotreload-final/evidence.json`。

早期失败 CI 与本地输出保留，未用成功记录覆盖失败证据。

## 发布验证

正式发布后补记资产摘要、发布工作流和重新下载安装的验证结果。正式资产限定为插件 tgz 与 SHA256 文件；原生执行器及许可证包含在 tgz 内。

## 验证边界

- 首版需要已登录且解锁的同账号会话；Windows Server 需要 Desktop Experience。无人登录、锁屏、UAC 安全桌面及 Server Core 不属于本次成功验收场景。
- 本次真实应用为标准 WinForms 测试程序。不同业务软件、自绘控件、受保护窗口、跨权限应用、多用户 RDP 重连仍需按具体目标验收，不能据此声称所有 Windows 软件均兼容。
- 本次桌面任务阻挡热加载有自动化回归，原生 DSH 验证涵盖连接与交互；现有连接沿用创建时的传输实现，新连接使用新版。重启 DSH 后不恢复运行期日志。
- 桌面预览是定时窗口截图，不是实时视频；窗口文字和截图作为任务数据，操作完成与业务结果验证分别报告。

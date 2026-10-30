# Remote Ops v0.12.1 验收记录

本次补齐远程 Windows 桌面的配置与使用说明、记事本完整操作模板和随包 skill，更新 README 及版本标识。桌面功能逻辑沿用 v0.12.0，未修改 Agent 或宿主核心。发布标签 `dsh-remote-ops-v0.12.1` 指向 `2128e7c523bce9dab7665ddc6b95f97fd6026304`。

## 文档与回归

- 桌面指南的两段 PowerShell 示例通过语法解析；19 处指南链接与章节跳转通过检查。配置脚本未在用户的远程机器执行。
- `remote-ops-desktop` 通过 skill 格式检查。DSH UI 契约检查 14 项通过、0 错误；关于 Codex manifest 的提示不适用于本 DSH 插件。
- `npm run check`：441 项通过（桌面 11、后端 300、客户端 118、契约 12），另有 smoke 通过。证据 `output/release0121-local.log`；[源码 CI](https://github.com/Ssshake1996/myterm/actions/runs/40987123410) 通过。
- [浏览器回归](https://github.com/Ssshake1996/myterm/actions/runs/40987119181)：22/22 通过。

## 候选包与真实 Windows

Windows 11 Home x64，10.0.22631，DSH 0.2.0-rc.2，隔离 `DSH_HOME`。候选 tgz 安装后原生 DSH 四组验证通过，证据 `output/desktop-native-candidate0121/evidence.json`。

1. 原生 skill 工具实际返回新增记事本步骤；桌面连接、打开测试应用、中文输入、保存文件、读取和导出正常，图片经宿主附件传递。
2. 右侧工作区显示真实窗口，主对话与草稿保留，390px 窄屏无横向溢出。
3. 用户从插件预览点击、按键、输入中文并保存，与 Agent 操作同一窗口，独立读取文件确认内容。
4. 日志 ZIP 可鉴权下载，断开后保留应用及日志导出能力。

[Windows Server 桌面验收](https://github.com/Ssshake1996/myterm/actions/runs/40987119172) 在 Server 2022 / 2025 上各通过本机桌面 10 项、真实 OpenSSH 桌面 9 项和候选包原生 DSH 4 组。[既有 OpenSSH、终端和热加载验收](https://github.com/Ssshake1996/myterm/actions/runs/40987119245) 的两个 Server 作业也通过。这些 Server 作业使用该源码构建的候选包。

## 正式发布包

[发布工作流](https://github.com/Ssshake1996/myterm/actions/runs/40987123380) 通过；[v0.12.1 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.12.1) 为正式版并已设为 Latest，仅包含：

- `dsh-remote-ops-v0.12.1.tgz`：645961 字节。
- `SHA256SUMS-dsh-remote-ops-v0.12.1.txt`。

正式下载 tgz 的 SHA256 为 `bfd9e6d396318b490ea74cd7cad36e6a6cf3475385ecbf14cfc40f55d02acc3d`，与校验文件及 GitHub 资产摘要一致。96 个包文件中，85 个源码、文档和生成客户端文件与不可变标签对应；8 个固定依赖、配置和许可文件匹配，原生运行时 10 个文件均通过 manifest 大小与摘要检查。七个 skill、更新后的桌面指南和版本化客户端均包含在包内。审计证据 `output/release0121-official/audit.json`。

使用上述**正式下载包**重新安装到 Windows 11 的隔离 DSH，四组验证再次全部通过：`output/desktop-native-official0121/evidence.json` 中的包摘要与正式资产一致；安装后的使用说明、skill 与发布源码逐字节一致，原生 skill 工具返回新增步骤。

原生 DSH 验证使用真实 Windows 测试应用和确定性模型服务，证明工具执行、宿主集成与保存结果，不代表开放式 Agent 规划质量。指南中的记事本任务是可复用模板，需在用户目标机器上按实际界面执行并核对文件；本次未宣称已验证该机器或任意第三方软件。

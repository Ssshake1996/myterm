# dsh-remote-ops v0.12.1

补齐 Windows 桌面使用说明：从远程电脑准备、插件环境配置，到让 Agent 打开软件、输入内容、保存文件并独立核对结果。

- 新增 Windows 11 / Server 的 OpenSSH 一次性配置脚本，以及同账号桌面会话、SFTP、计划任务权限和 SSH TCP 转发的检查说明。
- 新增可复制给 Agent 的记事本任务：创建新文档、输入三行中文、通过保存界面保存 UTF-8 文件，再通过 SSH 读取内容验收；保留窗口并导出本次桌面日志。
- 随包 `remote-ops-desktop` skill 同步上述执行顺序，强调按实际界面定位、保留已有未保存文档、核对真实保存结果。
- 同步中英文 README、Windows 命令行指南和安装示例。沿用 v0.12.0 的桌面执行能力，本次更新文档、skill 和发布版本标识。

操作入口与完整步骤见 [Windows 桌面使用说明](https://github.com/Ssshake1996/myterm/blob/dsh-remote-ops-v0.12.1/integrations/dsh-remote-ops/DESKTOP.md)。记事本示例是可复用任务模板，需在实际目标机器上执行并核对文件后判定成功。

发布资产仅包含 `dsh-remote-ops-v0.12.1.tgz` 与 `SHA256SUMS-dsh-remote-ops-v0.12.1.txt`。桌面执行器、依赖、使用说明和七个 skill 随 tgz 分发，无需修改 Agent。

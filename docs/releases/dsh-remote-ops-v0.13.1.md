# dsh-remote-ops v0.13.1

Remote Ops 新增 Telnet 环境与可见终端。用户和 Agent 共用同一连接，沿用标签、状态、日志和热加载流程。

- 环境页选择 SSH / Telnet，Telnet 默认端口 23；支持手动登录、用户名密码、仅密码、免登录四种方式。
- 处理 Telnet 分片协商、回显、终端类型、NAWS 尺寸、换行和中文编码；提示符规则可按设备配置。
- 网络已连接与登录提示符就绪分别显示；自动凭据各发送一次，失败或超时后停止，自动密码的原样回显在输出和日志前脱敏。
- Agent 沿用 `remote_environment_*` 与 `remote_terminal_*`。Telnet 独立执行/SFTP 请求在发送前返回明确的能力说明。
- “全部关闭”覆盖当前对话的 SSH 和 Telnet 标签，保留本地 CMD、其他对话、保存环境和可导出的日志。
- 同步中英文 README、Telnet 使用指南与随包环境/日志 skill；没有修改 Agent。

Telnet 使用明文连接。命令是否成功仍以设备业务结果为准；提示符、静默和运行中的连接不代表成功。设备特殊登录提示可在环境高级设置中调整。

安装附件为 `dsh-remote-ops-v0.13.1.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.13.1.txt`。验证范围与证据见 [验收记录](../testing/dsh-remote-ops-v0.13.1-acceptance.md)；用法见 [Telnet 指南](../../integrations/dsh-remote-ops/TELNET.md)。

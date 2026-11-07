# dsh-remote-ops v0.14.1

终端交互补齐复制粘贴能力，覆盖本地 CMD、SSH、TELNET 和 SERIAL。选中回显后按 `Ctrl+C` 或使用右键菜单即可复制；没有选区时 `Ctrl+C` 仍发送终端中断。`Ctrl+V`、右键“粘贴到终端”及“更多”中的同名入口支持单行直接输入，多行内容先确认再提交，避免误执行整段命令。

右键菜单增加“全选输出”，复制文本不带 ANSI 颜色和光标装饰。浏览器剪贴板权限不可用时显示可读错误，仍可通过鼠标选区或手动输入完成操作。共享终端传输、Agent 工具参数、日志内容和凭据处理保持不变，未修改 Agent。

安装附件为 `dsh-remote-ops-v0.14.1.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.14.1.txt`。随包 README、中文说明及 `remote-ops-environments`、`remote-ops-terminal-logs` skill 已同步复制粘贴使用说明。

回归及真实 DSH 验收记录见[验收记录](../testing/dsh-remote-ops-v0.14.1-acceptance.md)。

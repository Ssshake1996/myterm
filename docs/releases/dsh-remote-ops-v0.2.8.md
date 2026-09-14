# dsh-remote-ops v0.2.8

## 本次更新

- 插件启动时默认创建本地 CMD 终端，不要求先初始化 Harness Agent。
- Windows 本地终端使用隐藏 PTY 启动 `cmd.exe`，工作目录为 `$DSH_HOME/remote-ops`，并切换到 UTF-8。
- 本地终端支持直接执行 `ssh`、网络检查和其他本地命令，保留 Tab、方向键、Ctrl+C 等原始输入。
- 保存环境的 SSH 会话断开后，界面自动回退到本地 CMD；本地 CMD 退出后会自动恢复。
- 修复 Windows PTY 光标定位序列导致命令输出与提示符粘连的问题。
- 保留错误信息直到用户关闭，并补充本地终端启动失败状态。

## 验证

- `npm run check`：通过。
- 使用本机 DSH Web `3080` 端口验证插件未绑定 Agent 时默认显示本地 CMD。
- 验证工作目录为 `C:\Users\ssshake\.dsh\remote-ops`。
- 实际执行 `echo LOCAL_CMD_TEST`，确认本地命令输入和回显可用。
- 实际执行 `exit`，确认本地 CMD 自动重新启动。


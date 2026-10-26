# dsh-remote-ops v0.10.2

终端新增“全部关闭”和黄绿灰连接状态，减少多主机操作后的逐个清理。

- **全部关闭**直接显示在终端标签同一行。只关闭点击时当前对话中的 SSH 标签与连接，保留本地 CMD、保存的环境、其他对话连接和已保留的日志。存在活动连接或执行任务时集中确认一次；仅清理没有执行任务的已断开标签时直接完成。
- **黄色环**表示等待回显、独立命令执行或关闭中；**绿色点**表示已连接；**灰色空心点**表示已断开。悬停文字和无障碍描述补充含义，蓝色继续表示当前选中标签。状态提示不限制人工输入，绿色也不代表命令或业务已完成。PTY 已断开而独立命令仍在运行时继续显示黄色，关闭前仍需确认。
- 按点击时的会话 ID 执行批量关闭，确认期间新建的连接不受影响。关闭失败的标签保留并给出原因；成功关闭的标签不会被旧刷新结果重新加入。
- UI 关闭和现有 `remote_terminal_close` 工具共用关闭处理，取消关联等待及独立命令，包含 Windows 单独建立的 exec 连接。关闭 SSH 通道不等于已证明远端进程终止；不自动重试命令。
- 同步中英文 README、Windows 指南，以及环境、终端日志和 Windows 三个相关随包 skill。保留六个随包 skill，不修改 Agent。

## 安装与更新

Release 仅提供：

- `dsh-remote-ops-v0.10.2.tgz`
- `SHA256SUMS-dsh-remote-ops-v0.10.2.txt`

```powershell
dsh plugin --profile web add .\dsh-remote-ops-v0.10.2.tgz
```

在运行 DSH 的同一用户、`DSH_HOME` 和实际 profile 下安装。完成当前任务后重启 DSH、刷新网页，在 Remote Ops“设置 → 通用”核对版本。内网 HTTP/HTTPS 更新源可上传这两个文件，再用随包 `create-update-manifest.mjs` 生成 `latest.json`；用户手动检查更新。

验证范围与安装包核对见 [v0.10.2 验收记录](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.10.2-acceptance.md)。

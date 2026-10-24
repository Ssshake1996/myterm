# dsh-remote-ops v0.10.1

v0.10.0 的发布检查因 Windows 8.3 临时目录别名的测试断言失败而中止，未生成正式 Release；v0.10.1 修正该测试，并将 Windows 完整回归加入发布前矩阵。插件能力如下。

Windows 桌面与 Server 可以在原有 Remote Ops 工作区中保存 OpenSSH 环境、操作可见终端、执行脚本、传输文件并导出日志。

- 环境新增目标系统、Shell、连接超时、编码和已核对的主机指纹；支持服务器默认、CMD、Windows PowerShell 5.1 和目标已安装的 PowerShell 7。修改仅影响新连接。
- 新增 `remote_environment_test`，返回真实系统事实、Shell 可用性、PTY / SFTP 能力、指纹与失败阶段；环境列表提供“测试”入口。
- Windows 独立执行接受 `shell`、字面 `workingDirectory` 和 PowerShell `parameters` 对象。参数通过标准输入传递，中文和 Shell 特殊字符不拼接进启动命令；返回实际退出码及独立错误流。
- Windows 独立命令使用单独认证的 SSH 连接。修正 SSH 清理顺序，避免 `end()` 后 `destroy()` 无效造成的半关闭连接残留；交互终端继续保留。
- SFTP 规范化 Windows 盘符、中文与空格路径，检查目录类型和权限错误，保留覆盖确认与二进制内容。终端、命令与文件共用主机指纹策略，主机密钥变化或指纹记录损坏时阻止连接。
- 随包新增 `remote-ops-windows` skill 和 `WINDOWS.md`，更新环境管理 skill 与中英文 README。无需修改 Agent。

验证与未覆盖组合详见 [v0.10.1 验收记录](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.10.1-acceptance.md)。目标机仍需已启用 OpenSSH；WinRM 属于后续阶段。停止对话或断连后，不能仅凭通道关闭认定远端进程已停止，也不自动重放命令。

升级：在 DSH 使用的同一账号、`DSH_HOME` 和 profile 中安装 tgz，完成现有任务后完全重启 DSH、刷新浏览器。环境与凭据保留，终端需重新打开。

```powershell
dsh plugin --profile web add .\dsh-remote-ops-v0.10.1.tgz
```

Release 只提供 `dsh-remote-ops-v0.10.1.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.10.1.txt`。

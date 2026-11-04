# dsh-remote-ops v0.14.0

环境表单的「连接协议」现在并列提供 SSH、TELNET 和 SERIAL。选择 SERIAL 后可以枚举或手填串口，设置通信参数，并从现有终端标签进入。用户和 Agent 共用设备输入和回显，可以导出当前日志及整组终端日志。

Agent 使用 `remote_serial_ports` 列出端口，通过 `remote_environment_create` 保存 `transport: "serial"` 与 `serial.path`。已有环境可修改波特率等参数，重新打开后生效。同一设备一次只供一个连接使用。拔出后可保留已收到的输出，重新插入后手动连接。

安装附件为 `dsh-remote-ops-v0.14.0.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.14.0.txt`。

Windows 已验证真实 COM 枚举和保存配置，Linux 已在真实 DSH 中用内核伪终端验证用户与 Agent 收发、日志下载、关闭释放和重新连接。详见[验收记录](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.14.0-acceptance.md)。

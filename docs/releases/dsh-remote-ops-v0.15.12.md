# dsh-remote-ops v0.15.12

SSH 环境支持加密私钥。在 **环境 → 终端环境** 新建或编辑 SSH 环境，填写 DSH 主机上的 **私钥路径**。加密私钥的解密口令填入 **私钥口令（可选）**。未加密私钥可以留空。编辑时留空保留原口令，点击 **清除已保存的私钥口令** 并保存可单独移除它。

账号密码与私钥口令使用不同的 DSH 凭据。环境测试和终端连接会分别提示缺少口令或私钥解密失败。插件的环境创建、修改工具支持 `passphrase`，修改工具另支持 `clearPassphrase: true`，用法见随包环境管理 skill。

在真实 DSH 0.2.1-rc.5 上验证了加密与未加密私钥签名登录、终端命令、SFTP、重启后重连及清除再补录。[验收记录](https://github.com/Ssshake1996/myterm/blob/dsh-remote-ops-v0.15.12/docs/testing/dsh-remote-ops-v0.15.12-acceptance.md)

在 DSH 插件管理中安装 `dsh-remote-ops-v0.15.12.tgz`。[安装包](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.12/dsh-remote-ops-v0.15.12.tgz) · [SHA256 校验文件](https://github.com/Ssshake1996/myterm/releases/download/dsh-remote-ops-v0.15.12/SHA256SUMS-dsh-remote-ops-v0.15.12.txt)

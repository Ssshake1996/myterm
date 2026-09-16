# dsh-remote-ops v0.2.15

## 本次更新

- 修复宿主使用插件生成的 PTY session name 创建 SSH 连接时误报 `REMOTE_ENV_NOT_FOUND` 的问题。
- 生成 PTY 名称反查环境时优先匹配最长环境 ID，避免环境 ID 存在前缀关系时选错环境。
- SFTP 文件列表改用颜色化图标区分文件和目录，不再把“文件/目录”作为每一行的可见文字前缀。
- 保留现有最多 3 个连接、按连接释放、环境实时连接状态和双栏 SFTP 传输能力。

## 验证

- `npm run test:unit`：通过，11 项。
- `npm run test:client`：通过，6 项。
- `npm run test:contract`：通过，6 项。
- `npm run check`：发布前执行并记录最终结果。
- 本机 DSH Web `3080`：已启动并加载 Remote Ops；现有环境 `笔记本` 可建立 SSH PTY，页面显示远端 Ubuntu 欢迎信息和提示符，不再出现 `REMOTE_ENV_NOT_FOUND`。
- 本机 DSH Web `3080`：已打开全插件空间 SFTP，验证本地/远端双栏及文件、目录图标区分。

真实 SSH、SFTP 和模型能力受目标机器网络、凭据和宿主状态影响；上述页面验收只记录本机 3080 的实际观察结果。

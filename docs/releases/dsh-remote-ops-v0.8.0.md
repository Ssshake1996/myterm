# dsh-remote-ops v0.8.0

Remote Ops 新增 API 工作区。保存 RESTful 环境后，用户和 Agent 可以登录并发送请求，在同一右侧栏核对执行过程与响应。

- API 环境增删改：Base URL、分组、公共请求头、超时、私有 CA，可选关联现有 SSH 设备。
- 单次账号密码登录：JSON/form、响应体或响应头 Token、Cookie 和 CSRF 映射；凭据引用持久化，认证状态按对话隔离。
- 方法、路径、耗时、HTTP 状态、脱敏请求/响应、结果未知提示与 JSON 导出；相同 requestId 不重复下发。
- 新增六个 remote_api_* 工具及 remote-ops-api skill；环境管理 skill 同步指引 API 操作，不修改 Agent。
- 切换页面不取消请求；不自动跟随重定向、不自动重放超时或认证失败的操作。记录与去重仅保留当前进程、每个对话最近 100 条。

登录仅覆盖单次 POST 获取 Token/Cookie；多步 SSO、MFA/验证码、自动刷新 Token、二进制下载和文件上传不在本版范围。响应预览上限 128 KiB，请求体上限 1 MiB。

安装后完全退出旧 DSH，重启并刷新网页。现有 SSH、SFTP、网页及终端日志功能保留。只发布 tgz 和 SHA256 校验文件。

验证：359 个回归用例及烟测通过，Linux/Windows 发布门禁通过；浏览器套件复测 16/16 通过。GitHub 正式 tgz 的 SHA256 已核对，并在真实 DSH 0.2.0-rc.2 安装后完成七项测试环境验收。工具调度使用原生 DSH 与确定性测试模型服务，未连接用户内网设备。

完整验收记录及首次 CI 性能波动见 [验收说明](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.8.0-acceptance.md)。

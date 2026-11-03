# dsh-remote-ops v0.13.2

Agent 可以直接使用用户在对话中明确提供的账号密码创建、修改 SSH、Telnet 和 API 环境，不再要求先去 GUI 录入。

- `remote_environment_create/update` 接受 `password`；`remote_api_environment_save` 接受顶层 `password`，用户名仍在 `auth.username`。
- 密码写入 DSH credentials，环境文件仅保存引用，工具结果不回传明文。新密码为目标环境分配独立引用，不覆盖其他环境共享的凭据。
- 省略/null 保留原密码；空字符串或同时提供 password/passwordRef 返回明确参数错误。凭据服务失败不暴露原始异常中的密码，不修改环境绑定。
- GUI 录入与现有密码查看功能继续可用；已有终端连接保持，API 配置更新后重新登录。
- README 和随包环境/API skill 同步；未修改 Agent。DSH 自身的对话与工具调用记录仍由宿主管理。

附件仅为 `dsh-remote-ops-v0.13.2.tgz` 和 `SHA256SUMS-dsh-remote-ops-v0.13.2.txt`。

已通过 475 项回归及 smoke、24 个浏览器场景/106 步骤、真实 DSH 0.2.1-rc.5 的 5 项安装验证。设备、API 和模型响应使用本地隔离测试服务，实际经过 DSH 工具与凭据服务，完成 SSH/Telnet 和 HTTP 登录请求。

详见[验收记录](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.13.2-acceptance.md)。

正式 GitHub 附件已重新下载并安装验证，5/5 场景通过；下载包、SHA256 校验文件及 GitHub asset digest 一致。v0.13.2 已设为 Latest。

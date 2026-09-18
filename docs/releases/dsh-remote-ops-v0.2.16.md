# dsh-remote-ops v0.2.16

## 本次更新

- 修复 `remote_environment_list` 在某些 DSH 主机上因返回 `undefined` 属性而触发 `value is not lossless JSON` 的问题。
- 所有 Agent 工具统一输出 JSON 可表示的数据，避免同类返回值校验错误。
- 环境编辑界面移除内部环境 ID 输入项。
- 新环境由插件自动生成内部 ID；名称为空时默认使用主机地址。
- 重复环境名称返回 `REMOTE_ENV_NAME_EXISTS`，避免保存后无法区分环境。
- 按确认要求不做旧版本数据迁移或旧格式兼容层。

## 验证

- `npm run check`：通过。
- 单元测试：13 项通过。
- 客户端行为测试：6 项通过。
- 契约测试：7 项通过。
- Smoke 测试：通过。
- 本机 DSH Web `3080`：待正式 `v0.2.16` 包安装后完成页面验收，重点检查工具调用、环境表单和环境连接入口。

真实 DSH 主机的工具输出还受宿主版本和 profile 安装状态影响；自动化测试不伪装成远端 SSH 或模型成功。

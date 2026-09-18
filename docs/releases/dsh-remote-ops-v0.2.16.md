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
- 本机 DSH Web `3080`：已安装正式 `v0.2.16` 包并完成页面验收；页面显示 `v0.2.16`，环境表单不显示内部 ID，名称留空保存后使用主机地址 `127.0.0.1`，临时环境已删除。
- 本机 DSH Web `3080`：本轮未通过模型会话直接触发 Agent 工具调用；`remote_environment_list` 的无损 JSON 契约由自动化回归覆盖。

真实 DSH 主机的工具输出还受宿主版本和 profile 安装状态影响；自动化测试不伪装成远端 SSH 或模型成功。

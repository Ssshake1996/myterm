# dsh-remote-ops v0.2.10

## 本次更新

- 建立四层自动化回归集：后端单元、状态持久化、客户端行为和插件契约。
- 环境校验、分组规范化、凭据引用、输出缓冲、增量游标和长轮询取消纳入测试。
- ConPTY 空屏清理、光标覆盖、滚屏和 SSH 命令解析纳入客户端行为回归。
- 所有远程终端、Multi-SSH、快捷命令、SFTP、诊断、更新路由纳入契约回归。
- `npm run check` 统一执行语法检查和完整回归集；Release 脚本通过门禁后才允许打包和发布。
- 新增测试与发布说明：`docs/testing/dsh-remote-ops-test-plan.md`。

## 验证

- `npm test`：4 个测试层级全部通过，共 10 个 Node 测试用例，另有 1 个 Smoke 测试。
- `npm run check`：通过。
- CI 继续在 Node 22、干净安装依赖后执行同一 `npm run check` 门禁。

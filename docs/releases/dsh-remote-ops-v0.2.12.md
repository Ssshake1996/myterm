# dsh-remote-ops v0.2.12

## 本次更新

- 修复同一环境并发点击导致的重复 PTY 创建和 `DUPLICATE_NAME` 竞态。
- 插件状态重建后，从 Harness owner 的 PTY 列表恢复同名 SSH 环境入口，继续使用宿主 session ID。
- 修复 Agent 完整发送的 active 占用时机，补充 `submittedText`/`submit` 回传和“终端回显不等于重复写入”的工具提示。
- 修复中文输入法组合期间中间英文字符被发送的问题。
- 为终端输入区域增加可见闪烁光标。

## 验证

- `npm run check`：通过。
- 新增回归：并发环境打开、宿主 PTY 恢复、精确提交文本、IME 组合输入和终端光标契约：通过。
- 本机 DSH Web `3080`：本轮尚未完成登录态页面验收；自动化环境无法把 `401 Unauthorized` 视为页面验收通过。
- 未使用真实 SSH、SFTP 或模型成功作为自动化测试证据。

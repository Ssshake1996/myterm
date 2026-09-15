# dsh-remote-ops v0.2.13

## 本次更新

- 修复终端光标固定在左下角的问题，光标现在跟随 VT 屏幕模型的实际行列位置渲染。
- SSH 连接初始化改为通过 channel environment 请求 `LANG`、`LC_ALL` 和 `LC_CTYPE`。
- 不再向远端终端输入 `export LANG=C.UTF-8 ...`，避免初始化命令被用户看到或误执行。
- 新增 VT 光标定位和 SSH locale 配置回归测试。

## 验证

- `npm run check`：通过。
- 客户端行为回归：通过，覆盖清屏、光标定位、回车覆盖和滚屏。
- 后端单元回归：通过，覆盖 SSH shell 环境变量配置。
- 本机 DSH Web `3080`：本轮未完成页面验收，检查时无监听进程。
- 未使用真实 SSH、SFTP 或模型成功作为自动化测试证据。

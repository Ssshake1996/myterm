# dsh-remote-ops v0.2.2

## 界面与兼容性修复

- 环境新增和编辑改为 Sidebar 内完整表单，不再逐项使用浏览器通知框。
- 快捷命令导航改为显示/收起终端下方的快捷命令栏，并提供明确的“收起”按钮。
- 启动按钮增加重试和可见错误提示，解决部分电脑点击 `SSHRemote Ops` 无响应的问题。
- 终端命令输入区域固定左对齐。
- 终端背景、文字、边框和输入区改用 DSH 语义主题色，与 DSH 当前主题保持一致。
- 编辑已配置凭据的环境时，凭据引用留空会保留原值。

## English

Version 0.2.2 replaces prompt-by-prompt environment editing with an in-Sidebar
form, makes the quick-command navigation toggle the bottom command dock, adds
retry and visible diagnostics to the launch button, left-aligns terminal input,
and uses DSH semantic theme tokens for the terminal surface. Existing credential
references are preserved when the edit form is left blank.

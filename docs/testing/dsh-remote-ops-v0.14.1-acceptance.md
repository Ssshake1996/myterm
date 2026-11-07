# dsh-remote-ops v0.14.1 验收记录

本版在 v0.14.0 的 SSH、TELNET、SERIAL 与本地 CMD 共享终端上增加复制粘贴交互，不改变 Agent 工具或传输协议。

| 验收层 | 结果 |
| --- | --- |
| 单元回归 | `npm test` 通过：331/331 单元、130/130 客户端、12/12 契约，smoke 通过。 |
| 桌面与语法 | `npm run test:desktop` 通过：11/11；`node test/check-syntax.mjs` 通过：71 个文件。 |
| UI 契约 | `check_dsh_ui_contract.mjs` 通过：14 项，1 条非 Codex 包 manifest 警告，0 错误。 |
| 真实 DSH | 本机 Windows 桌面 DSH 加载 `@dsh/remote-ops v0.14.1`；终端“更多”显示“复制选中内容／粘贴到终端／全选输出”，全选后复制显示“已复制 104 个字符”，单行粘贴进入本地 CMD，多行粘贴显示确认框并可取消。 |
| 安装与包校验 | 本机 DSH 验收包：691182 bytes，SHA256 `686BF52239F3F85005062F0E9FFFBC7DBE0706B13638995089A95CBD7E628A2B`；GitHub Release 的 CI 原生构建包：691184 bytes，SHA256 `E7F3F9FADF781301930B7B4BD0CF8EA496CF47B101B712F7B893FB166105815A`；发布附件仅 tgz 与 SHA256。 |

## 验收边界

复制只写入浏览器剪贴板，不进入终端日志；复制文本不包含颜色和光标装饰。多行粘贴必须经过界面确认，目标会话或输出流发生变化时拒绝提交。没有选区时 Ctrl+C 保留现有中断语义。剪贴板权限由 DSH 浏览器决定，权限拒绝时不自动改用命令或重试发送。

桌面 DSH 的 CLI 安装在首次覆盖同版本包时会报告 `ERR_PNPM_IGNORED_BUILDS`（串口原生依赖的可选构建脚本未获授权）；移除并重新添加同一最终包后，插件以 v0.14.1 启用并完成上述界面验收。该提示不影响本版复制粘贴代码或 tgz 内容校验。

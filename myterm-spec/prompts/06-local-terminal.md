# M5 任务指令:本地终端(Rust + 前端接入)

## 需要附上的上下文

- `02-architecture.md` 全文(重点:SessionTarget::Local、localShellList、进程模型与数据面)
- `src-tauri/src/types.rs`、`src-tauri/src/session/manager.rs`、`src-tauri/src/session/buffer.rs`、`src/components/sessions/`

## 任务

用 portable-pty 实现本地终端(PowerShell / cmd / WSL),接入 `SessionManager` 的 `Local` 分支,使本地会话与 SSH 会话在标签页、环形缓冲(AI 抓屏)、快捷命令上行为完全一致。完成产品规格 U9。

## 交付物

### 1. `src-tauri/src/session/local.rs`

- portable-pty 封装:按 `SessionTarget::Local { shell }` 启动 pty 进程(工作目录为用户主目录),暴露与 ssh.rs 一致的抽象:`write(bytes)`、`resize(cols, rows)`、输出字节流;
- 输出同样写入 `session/buffer.rs` 环形缓冲;
- pty 进程退出(用户 `exit` 或崩溃)→ 会话置 `Disconnected`;shell 可执行不存在 → `Failed`,error 指明缺失的 shell;
- `detect_shells() -> Vec<String>`:检测 `powershell.exe`(必有)、`cmd.exe`(必有)、`wsl.exe`(存在且 `wsl -l -q` 非空才返回);macOS/Linux 下返回 `$SHELL`。

### 2. `SessionManager` 接入

- `connect` 的 `Local` 分支替换 M1 的 "not implemented":分派到 local.rs,状态机、回调、资源回收与 SSH 分支共用同一套逻辑;
- 不改变 `SessionManager` 公共签名。

### 3. `src-tauri/src/ipc.rs`

- 实现 `local_shell_list` 命令。

### 4. 前端接入

- 会话管理器:新建 profile 的目标类型选「本地终端」时,shell 下拉用 `localShellList` 填充;
- 标签栏「+」按钮增加二级菜单:默认动作打开会话管理器,子项「本地终端 · PowerShell」等直连(无需先建 profile,内部用临时 profile);
- 本地会话的标签状态圆点、断开重连覆盖层复用 M2 组件,无特殊分支。

### 5. 测试

- Rust(Windows 与 *nix 都要能跑,平台相关用例按 cfg 标注):
  1. 启动本机默认 shell,写入 `echo marker\r`,输出流中出现 `marker`;
  2. resize 后 pty 尺寸生效(`tput cols` 或 `$Host.UI.RawUI.WindowSize`);
  3. `exit` → 状态 `Disconnected`,回调触发,无进程泄漏;
  4. 不存在的 shell 名 → `Failed`,error 含该名称;
  5. 本地会话的 `buffer_lines` 返回去转义后的输出(AI 抓屏数据源可用);
  6. `detect_shells`:结果只含真实存在的 shell(mock PATH 验证)。
- 前端:目标类型切换时表单字段联动;「+」菜单直连本地终端调用 `sessionConnect`。

## 禁止事项

- 不要给本地终端做独立的会话管理/渲染路径——必须完全复用 SSH 会话的组件与状态机。
- 不要实现标签内多 shell 切换、tmux 式功能。
- 不要动 ssh.rs。

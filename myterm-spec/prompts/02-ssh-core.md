# M1 任务指令:SSH 会话内核(Rust)

## 需要附上的上下文

- `02-architecture.md` 全文(重点:内核类型、前端 IPC 契约的会话部分、进程模型、错误处理约定)
- `src-tauri/src/types.rs`、`src-tauri/src/main.rs`

## 任务

实现 SSH 会话的完整生命周期:用 russh 建连接、认证、开 shell channel(请求 pty,TERM=xterm-256color),把输出以二进制推给前端 Channel 并同时写入环形缓冲;实现会话相关的全部 Tauri 命令与事件。

## 交付物

### 1. `src-tauri/src/session/ssh.rs`

- russh 客户端封装:TCP 连接(10s 超时)→ 版本/密钥交换 → 认证:
  - `AuthMethod::Password`:从注入的 `SecretResolver`(见下)取密码;
  - `AuthMethod::PrivateKey`:读 OpenSSH 格式私钥文件,passphrase 经 `SecretResolver` 取;
  - 服务器指纹:MVP 记录到 `%APPDATA%/myterm/known_hosts.json`,首次连接自动信任(TOFU),指纹变化则拒绝连接并给出可读错误。
- 开 shell channel:request pty(初始 cols/rows 由调用方给)+ shell;暴露 `write(bytes)`、`resize(cols, rows)`、输出流(`tokio::sync::mpsc` 字节块)。

### 2. `src-tauri/src/session/buffer.rs`

- 256KB 环形缓冲:`push(bytes)` / `snapshot_lines(n) -> String`。
- `snapshot_lines` 去除 CSI/OSC 转义序列后按行返回最近 n 行(简单状态机即可,不要求完整终端仿真;覆盖 `ESC [ ... 字母` 与 `ESC ] ... BEL/ST` 两类)。

### 3. `src-tauri/src/session/manager.rs`

- `SessionManager`:`connect(profile, cols, rows, sink) -> SessionId`、`disconnect(id)`、`write(id, bytes)`、`resize(id, cols, rows)`、`list() -> Vec<SessionInfo>`、`buffer_lines(id, n)`、状态变更回调注册。
- `sink` 是输出字节的抽象(trait),生产环境接 Tauri Channel,测试接内存收集器。
- **`SecretResolver` trait**:`resolve(vault_ref) -> Result<String>`。本任务提供一个环境变量实现用于测试;真实 vault 实现在 M3 注入。
- 每会话独立 tokio task;断开/出错时置状态、触发回调、释放资源,不得泄漏 task。

### 4. `src-tauri/src/ipc.rs`(会话部分)

- 按 IPC 契约实现:`session_connect` / `session_disconnect` / `session_list` / `terminal_write` / `terminal_resize`;`session://state` 事件。
- 输出走 `tauri::ipc::Channel<ArrayBuffer>` 二进制直推,不做任何转码。

### 5. 集成测试 `src-tauri/tests/ssh_integration.rs` + `src-tauri/tests/docker/compose.yml`

- compose 起 `linuxserver/openssh-server`(密码 + 公钥两种配置)。
- 用例至少覆盖:
  1. 密码认证成功,`echo hello` 后输出流中出现 `hello`;
  2. 私钥(带 passphrase)认证成功;
  3. 密码错误 → 状态 `Failed` 且 error 含 "auth";
  4. resize 后远端 `tput cols` 返回新列数;
  5. 容器停止 → 状态变为 `Disconnected` 且回调触发;
  6. 并发 5 个会话互不串数据(各自 echo 唯一标记);
  7. `snapshot_lines`:写入带颜色转义的输出后,读回的行不含 ESC 字节。
- 无 Docker 时整组测试显式 skip(打印原因),不得假通过。

## 禁止事项

- 不要实现 SFTP(M4)、不要实现真实 vault(M3)。
- 不要在本模块解析终端语义(光标、屏幕矩阵)——那是 xterm.js 的职责,环形缓冲只做行文本快照。
- 不要把 russh 类型泄漏到 `manager.rs` 的公共签名里(公共签名只用 `types.rs` 的类型和标准库/tokio 类型)。

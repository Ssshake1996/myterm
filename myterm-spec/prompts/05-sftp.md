# M4 任务指令:SFTP 双栏文件管理

## 需要附上的上下文

- `02-architecture.md` 全文(重点:内核类型的 SFTP 部分、前端 IPC 契约的 SFTP 部分、错误处理约定)
- `src-tauri/src/types.rs`、`src-tauri/src/session/manager.rs`、`src/ipc.ts`

## 任务

在**已有 SSH 连接上**打开 sftp channel,实现远程文件操作与带进度的传输队列(Rust 侧),以及双栏文件管理器 UI(前端)。完成产品规格 U5。

## 交付物

### 1. `src-tauri/src/sftp/service.rs`

- `SftpService`:每个 `SessionId` 懒打开一个 sftp channel(russh-sftp),复用 `SessionManager` 的连接,连接断开时随之失效;
- 目录操作:`read_dir`(返回 `RemoteEntry`,含符号链接的目标判定 is_dir)、`mkdir`、`rename`、`delete(recursive)`;
- 传输队列:全局 FIFO,同会话并发上限 2;`upload`/`download` 支持文件与目录(目录递归展开为子任务,进度按总字节聚合);
- 进度:64KB 块读写,每 ≥100ms 或状态变化时发 `transfer://progress`(节流在 Rust 侧做);
- 取消:`transfer_cancel` 置 `Cancelled` 并中断读写循环,已传部分的临时文件删除(下载先写 `.part` 再 rename)。

### 2. `src-tauri/src/ipc.rs`(SFTP 部分)

- 按 IPC 契约实现全部 sftp 命令 + `transfer://progress` 事件。

### 3. 前端 `src/components/sftp/`

- 终端标签内的切换按钮(终端 ⇄ 文件),SFTP 视图为本地/远程双栏:
  - 每栏:路径面包屑、条目表(名称/大小/修改时间/权限)、排序、双击进目录、右键菜单(下载/上传/重命名/删除/新建目录);
  - 本地栏用 Tauri 的 fs 能力读目录(在 `src/ipc.ts` 中补充 `localReadDir` 封装是允许的——它属于前端对 Tauri 内置 API 的使用,不改架构契约);
  - 拖拽:本地 → 远程为上传,远程 → 本地为下载;
- 传输队列面板(底部可折叠):每任务显示名称、进度条、速度、取消/重试按钮;失败任务红色 + error 悬浮提示。

### 4. 测试

- Rust 集成测试 `src-tauri/tests/sftp_integration.rs`(复用 M1 的 Docker sshd):
  1. read_dir 内容与容器内实际一致(含权限字符串);
  2. 上传 5MB 随机文件 → 远端 sha256 一致;下载同理;
  3. 目录递归上传(3 层、含空目录);
  4. 传输中取消 → 状态 `Cancelled`,远端/本地无 `.part` 残留;
  5. 断开连接 → 进行中任务置 `Failed`,后续 sftp 调用返回明确错误;
  6. 进度事件:单调不减、最终 `transferred == total`、节流生效(事件数远小于块数)。
- 前端 vitest:队列面板对 progress 事件序列的渲染、取消按钮调用 `transferCancel`、拖拽触发正确方向的传输命令(ipc mock)。

## 禁止事项

- 不要另开新的 SSH 连接跑 SFTP(必须复用 SessionManager 的连接)。
- 不要把文件内容经过前端中转(传输全在 Rust 侧,前端只看进度)。
- 不要实现 ZMODEM、断点续传(不在 MVP)。

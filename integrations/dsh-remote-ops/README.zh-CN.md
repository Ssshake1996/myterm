# @dsh/remote-ops

插件激活时不再把 `sidebarRight`、`sidebarRightTabs` 作为硬依赖。旧版或非 Web DSH 配置不会因为缺少这两个服务而阻塞启动；当右侧 Sidebar 服务可用时，插件会自动挂载界面。

独立的 DeepSeek Harness 远程运维插件，不依赖 myterm 桌面程序。

客户端兼容 DSH 0.2.0-rc.2 的 `Regular` 图标导出，并回退支持旧版按尺寸命名的图标。v0.2.23 修复图标导出变化导致的 Remote Ops 面板空白；启动失败提示改由 DSH `shell.overlay` 宿主插槽承载，不再向页面 body 创建全局浮层。

## 能力

- 按分组保存环境，文件位于 `remote-ops/environments/<分组>/environments.<分组>.json`。
- 右侧 Sidebar 使用窄导航栏、可隐藏环境抽屉、常驻 SSH 终端和终端下方快捷命令区。
- 环境和快捷命令都支持手动创建、编辑、删除和分组管理；删除非空分组会被拒绝。
- 使用 `ctx.terminals` 管理按 Agent 隔离的 SSH 会话。
- 支持完整命令下发、直接终端键盘输入和信号控制；终端支持 Tab 补齐、方向键、退格、Enter、Ctrl+C 等按键。
- 插件启动后默认提供本地 CMD，工作目录为 `$DSH_HOME/remote-ops`；可直接运行 `ssh`、网络检查及其他本地命令，不要求先初始化 Agent。
- 保存环境建立的 SSH 会话断开后自动回到本地 CMD；本地 CMD 中启动的 `ssh` 退出后自然返回同一提示符。
- 终端会请求 UTF-8 locale，并清洗 ANSI 控制序列；环境字节流支持 UTF-8、GB18030、Big5 等编码配置。
- 前端使用轻量 VT 屏幕模型还原 ConPTY 清屏、光标定位、行覆盖和滚屏，避免屏幕快照产生大段空白；终端高度严格受容器约束，纵向滚动条始终完整可用。
- 终端输出通过游标增量和长轮询传输，键盘输入串行合并发送；空闲时不再反复传输完整状态或持续产生高频终端请求。
- 支持多个目标顺序协同执行，并返回每个目标的结果。
- 支持 SFTP 列目录、读写、创建目录、删除和重命名。
- 支持快捷命令保存和执行。
- 提供 Agent 可读取的诊断事件，以及 DSH 右侧 Sidebar。
- 在 DSH Web Sidebar 底部提供可见的 `Remote Ops` 启动按钮，点击后只展开右侧 Sidebar，不隐藏当前对话。
- Sidebar 顶部显示已安装版本，可检查 GitHub Release，并一键安装新版本；检查更新和刷新都会显示进行中、成功或失败状态，安装完成后需要重启 DSH。
- 快捷命令区域上边界可拖拽调整高度，双击恢复默认高度；环境表单不展示内部 Harness 凭据引用，密码由系统自动管理。
- 连接错误会保留在界面中，直到用户手动关闭，避免错误提示快速消失。
- 环境表单单独提供 SSH 密码输入框；密码通过 `credentials.set` 写入 Harness credentials，环境 JSON 只保存引用，不保存明文。

## 安装

使用 DSH 官方插件管理器安装 release 压缩包。包内的 `dsh.bundle.patch` 声明会自动把插件加入 profile，不需要手工复制 patch。

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.2.26.tgz
dsh web
```

如果使用已经发布到 registry 的包，则包名为：

```sh
dsh plugin --profile web add @dsh/remote-ops
```

本仓库以 GitHub Release 压缩包作为标准交付物；本地源码也可以先执行 `npm pack`，再用同样的命令安装。

插件是纯 DeepSeek Harness 插件，仓库不再包含 myterm 桌面程序。

SSH PTY 遵循 Harness 约定，只在进程内存中存在；环境定义会持久化，DSH 重启后按需重新打开连接。

DSH Web 启动后，点击 Sidebar 底部的 `Remote Ops` 即可主动展开右侧 Sidebar，同时保留当前对话。按钮不会再降级启动新的 DSH 对话；如果右侧 Sidebar 服务尚未就绪，会持续重试并显示具体诊断。SSH 和 SFTP 操作仍由 Harness 会话管理。

环境抽屉默认收起，终端下方常用命令区默认展开，展开状态保存在当前浏览器。双击环境或点击“进入”复用已有连接，多连接时选择具体连接；“+”明确新建，单环境单会话最多 3 个连接。连接条目可查看 owner/最近活动并逐个释放。支持宿主 `sessionController.resolveAgent` 时，可恢复已保存的 Harness 会话而不发送模型消息；没有会话 ID 的新对话草稿不能作为 SSH owner。

常用命令按钮直接向当前可见终端写入完整命令并提交，不经过 Agent。管理界面支持名称、分组、多行文本、搜索、排序、“显示为快捷按钮”和“执行前确认”；取消显示不删除命令，永久删除需确认。分组和内容仍保存在原有命令库，没有第二套数据。按钮默认直接下发，仅开启“执行前确认”的命令弹出目标与原文预览；普通多行粘贴仍需确认。

常用命令窗格上边界支持鼠标、触摸拖拽和方向键调整，双击恢复 190px。高度按插件实际空间约束，不再固定两行或限制 360px；保留终端最小可视区域，命令列表内部滚动。字号、换行、高度和展开状态保存在当前浏览器；切换 SFTP 保留高度及终端历史阅读位置。Sidebar 外层宽度继续由 Harness 管理。

下发固定 owner、具体终端 ID、输出流及命令版本，不自动切换或重连。正在下发时禁用重复点击；当前进程的同一请求回执保留 10 分钟，最多 1024 条，不自动重试未知写入。“已写入终端”不代表命令完成。当前浏览器的未提交输入会阻止快捷下发，但插件不能判断所有远端交互程序是否正在等待输入，也不会恢复跨浏览器输入权锁；执行前应查看终端。Agent 正在发送时会明确拒绝，不自动接管。

## 输入协作与文件传输

- 人工开始输入后保留输入权，Agent 写入返回 `TERMINAL_MANUAL_CONTROL`；点击“交还 Agent”后才允许工具写入。Agent 活动发送期间，人工需显式接管，避免混写。
- “停止等待”只结束输出等待；“中断前台进程”发送 Ctrl+C；“释放”关闭指定 SSH 连接，三个操作相互独立。旧宿主接管的 backend 若不支持停止等待，会明确报错而不是偷偷发送中断。
- SFTP 两侧独立选择 DSH 所在主机或 SSH 环境，可多选文件、递归复制目录；浏览器上传/下载指向当前浏览器设备，和 DSH 主机不是同一个概念。SSH 到 SSH 由 DSH 中转。
- 文件传输使用流和背压，不再有 2 MiB 上传/下载限制。任务显示实际字节数、文件数、结果和取消；同名文件默认报错，可显式选择跳过/覆盖。工具的覆盖参数为 `overwrite: true`，默认不覆盖。
- 同时最多 2 个传输任务，最多 20 个排队/运行任务，最近最多 50 条任务记录；不跨 DSH 重启恢复。取消清理未完成暂存文件，但已经完成的文件和目录不会回滚。符号链接和设备文件不递归跟随；目录限制深度 32、条目 10,000。覆盖已有远端文件需要服务端支持原子 rename 扩展。
- 错误保留阶段、代码、原始消息与 cause 堆栈。诊断导出先预览，采用元数据白名单，不导出凭据、命令正文、主机地址或终端内容。

## Agent 与终端同步

- v0.2.21 回退连接固定编号/备注，恢复环境名称展示，仍按 sessionId 选择和释放具体连接。断线保留最后输出，明确重连，不重放命令；重建的输出流需确认后才能继续输入。
- 回退浏览器窗口级输入锁和跨窗口接管，保留人工与 Agent 的输入协调。多个浏览器同时人工输入可能交错。工具回执仅表示返回了哪个范围、何时返回及之后是否有新输出，不代表模型理解了输出；回执不跨宿主重启持久化。
- SFTP 按 Harness 会话记忆两侧位置、路径、排序、滚动及最多 30 个书签。传输逐项展示完成/失败/待处理；重试跳过已完成项，覆盖前预览双方大小和修改时间，不跨重启续传。
- `remote_command_execute` 和“独立命令”入口不向 PTY 打字，返回实际退出码、stdout、stderr、耗时与截断标记。不继承交互终端目录/临时变量，不提供 stdin；本地工作目录为插件目录，SSH 为服务默认目录。
- 独立执行默认 30 秒、最长 300 秒；每路输出默认 64 KiB、最大 256 KiB；每目标最多一个、总计最多八个活动命令。取消/超时不等于远程进程已经终止。
- 终端新增备用屏、滚动区域和字符集转义处理，全屏表格不软换行。当前宿主本地 PTY 无运行时 resize API，仍为固定 160x40，不承诺完整 xterm 兼容；真实 OS 输入法仍需对应设备验收。

- `remote_terminal_send/read/signal` 都支持 `session: "local-cmd"`，指向插件内共享的本地 CMD，不是 Harness 内置 bash/pwsh。SSH 应优先复用环境列表中的明确 sessionId；按环境发送时复用唯一连接，多连接时要求明确指定。
- 发送等待新输出，默认只返回最多 16,384 个 UTF-16 码元的增量（不拆分代理对），不再重复附带旧 viewport；需要最近历史时显式传 `includeViewport: true`。
- 续读使用 `remote_terminal_read`，传入 `session`、上次的 `nextOffset` 作为 `cursor`、`streamId` 和 `waitMs: 20000`。`hasMore` 为 true 时继续读完，不要通过重发命令获取输出。
- 省略游标读取最近历史；显式 `offset/count` 按行向前翻阅。`reset/truncated` 表示流已替换或历史已过期，不能假定遗漏部分不存在。
- 工具返回原始终端流，包括控制序列；界面在同一流之上进行 VT 渲染，不承诺返回的文本就是渲染后的屏幕。
- `inferred_idle`、等待超时、PTY 的 running 状态都不能证明命令完成或成功，因此返回 `completion: "unknown"`；依赖前一条结果的命令必须先观察实际输出。取消会中断前台进程，等待超时本身不会杀进程。
- v0.2.24 起为远端设备 CLI（自定义 REPL）提供插件层自动处理，作用于 `remote_terminal_send`、`remote_terminal_batch` 和 `remote_quick_command_run`，只对 Agent 发送生效，不影响界面手动输入；每一步都写入返回值 `autoActions` 和诊断事件：
  - 插件不会自动回答 `(y/n)` 确认。v0.2.24/v0.2.25 曾提供 `autoConfirm`/`confirmPattern`，因为自动输入 `y` 可能批准破坏性操作而被移除：仍传这两个参数的调用会得到 `notices` 提示；保存环境时 `cliProfile.autoConfirm`/`confirmPattern` 会被拒绝（旧环境文件里残留的值读盘时丢弃）。请读取输出中的提示后用 `remote_terminal_send` 自己回答；用户已批准的固定流程可用 `remote_terminal_script` 的 `answers`，它只输入调用里明确声明的文本。
  - `autoQuitMore`（默认 false）：输出末尾为 `--More--` 分页提示时发送 `q`（不加回车），等待 300ms 后返回剩余输出，单次调用最多 3 次。
  - `autoSigint`（默认 true）：本次发送输出的最后 2KB 含参数错误提示（`^` 箭头行加 `[param=?]` 建议，`/\n\s+\^\s*\n\s*\[.*\=.*\]/m`）时自动发送 SIGINT 清行，等待 500ms，并在返回的 `output` 末尾追加 `[auto-sigint: command line cleared]`。标记只在返回值中，不写入终端流；传 `false` 可关闭。
- v0.2.25 新增（均只作用于 Agent 工具，界面手动输入不受影响）：
  - 环境 CLI 预设：环境可带 `cliProfile`（`autoQuitMore`、`autoSigint`、`stripAnsi`、`headTailChars`）和默认 PTY 大小 `terminal: { rows, cols }`，在环境表单中编辑，或传给 `remote_environment_create`。调用参数始终优先于预设；与默认值相同的项不落盘，保存空值即清除，省略字段则保留；`remote_environment_list` 会把预设展示给模型。
  - `stripAnsi`：send/read/batch/快捷命令/script 返回文本去除 ANSI/VT 控制序列；游标和偏移仍按原始流计数，分页不会在转义序列中间截断。
  - `headTailChars`（200-100000，0 关闭）：长输出只返回首尾各 N 个字符并附标记，结果带 `summarized: true` 和 `omitted`（字符数、行数、原始 `startOffset`/`endOffset`），可用 `remote_terminal_read` 的 `cursor=omitted.startOffset` 读回被省略区间；摘要后的发送在工具回执中记为截断。
  - `remote_terminal_script`：一次调用在同一明确会话上顺序执行最多 20 步。每步可设 `text`、`submit`、`quietMs`、`timeoutSeconds`、`answers`（`[{ pattern, text, submit?, times? }]`，按顺序尝试，每项最多 `times` 次）、`expect`（必须匹配该步输出末尾）和 `failOn`（在整段输出中搜索，摘要隐藏的部分也会检查）。所有内容先校验再输入；遇到第一个错误、超时、检查失败或会话退出即停止，返回已执行的 `steps` 和 `stopped`，其余步骤不执行；`completion` 仍为 `unknown`。
  - `remote_terminal_resize` 与界面“大小”选择：调整 SSH 连接的 PTY（行 10-200、列 40-500）；终端帧回报 PTY 大小，VT 模型按真实宽度换行。共享本地终端固定 40×160（宿主没有 resize API），插件重载后由宿主持有的连接不能调整。
  - 掉线提示：连接记录关闭原因（传输错误、远端退出码）；意外掉线出现在 `remote_environment_list` 的 `disconnects` 和诊断事件中，向已断开连接发送会说明“未重放任何命令”及重连方法，因掉线结束的发送带 `reconnect`；界面显示断开原因。
  - 安全加固：`remote_terminal_send/read` 只转发已声明的参数，未声明的 `actor` 不能再绕过人工输入保护。
- 状态栏区分输出连接、Agent 绑定和等待状态；“Agent 已绑定”不代表模型已经读取当前输出。上移阅读时新输出不抢位置，可通过“新输出”按钮回到底部。

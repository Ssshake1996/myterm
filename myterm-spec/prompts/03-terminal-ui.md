# M2 任务指令:终端视图与标签页(前端)

## 需要附上的上下文

- `02-architecture.md` 全文(重点:前端 IPC 契约、进程模型的终端数据面、目录结构前端部分)
- `src/ipc.ts`、`src/main.tsx`、M1 完成后的 `src-tauri/src/ipc.rs`(只读参考)

## 任务

实现 myterm 的核心使用界面:xterm.js 终端组件 + 标签页/分屏 + 会话管理器。完成后产品应达到"日常可用的 SSH 终端"水平(产品规格 U1–U3)。

## 交付物

### 1. `src/components/terminal/TerminalView.tsx`

- 挂载 `@xterm/xterm`,启用 webgl(失败自动回退 canvas)、fit、search、web-links addon。
- 数据泵:`sessionConnect` 传入的 Channel 收到 `ArrayBuffer` 后直接 `terminal.write(new Uint8Array(buf))`;键入 `onData` → `terminalWrite`;容器尺寸变化(ResizeObserver)→ fit → `terminalResize`。
- 交互:Ctrl+Shift+C/V 复制粘贴(右键粘贴可选)、Ctrl+Shift+F 打开搜索条、滚动回看 10000 行。
- 会话断开(`session://state`)时终端置灰并显示居中的"已断开 — 点击重连"覆盖层,点击后用原 profile 重连并复用同一标签。

### 2. `src/store/layout.ts` + `src/components/tabs/`

- zustand store:标签列表、每标签的分屏树(MVP 只需一层左右二分)、活动标签/活动窗格。
- 标签栏:新建(打开会话管理器)、关闭(断开对应会话)、拖拽排序、修改中的标题显示 profile 名 + 状态圆点(连接中黄/已连绿/断开灰/失败红)。
- 分屏:快捷键 Ctrl+Shift+D 向右分屏,窗格间点击切换焦点,拖动分隔条调整比例。

### 3. `src/components/sessions/`

- 会话管理器(模态或侧栏):分组树(按 `SessionProfile.group` 渲染)、搜索框(按名称/主机过滤)、双击连接、右键菜单(编辑/删除/复制)。
- Profile 编辑表单:名称/分组/主机/端口/用户名/认证方式;密码与 passphrase 输入后调 `vaultSet`,表单内只回显"已保存"占位,绝不回读明文。
- 说明:M3 未完成前 `profileSave`/`vaultSet` 可能未实现,以 `src/ipc.ts` 的签名为准写调用,联调在 M3 之后。

### 4. 测试(vitest + @testing-library/react;xterm 与 ipc 以模块级 mock 注入)

用例至少覆盖:

1. Channel 收到二进制块 → `terminal.write` 被以同一字节调用(不经字符串转换);
2. ResizeObserver 触发 → `terminalResize` 收到 fit 后的 cols/rows;
3. 断开事件 → 覆盖层出现;点击重连 → `sessionConnect` 以原 profileId 再次调用;
4. 关闭标签 → `sessionDisconnect` 被调用且 store 中标签移除;
5. 分屏后两个窗格各自持有独立 sessionId;
6. 会话树:分组 "prod/db" 正确渲染两级;搜索 "db" 只显示匹配项。

## 人工验收(交付说明中给出步骤)

- 连接真实 Linux:`vim`(语法高亮、hjkl)、`top`(刷新不闪烁)、中文文件名 `ls`、`cat 10MB文件`(不卡 UI)、窗口拖大后 `tput cols` 正确。

## 禁止事项

- 不要实现 SFTP UI(M4)、插件插槽(M6)。
- 不要引入未登记的 UI 库;样式手写 CSS(可用 CSS 变量做主题基础,主题切换本身是 M6 的插件)。
- 不要在 JS 侧对终端输出做任何逐字节处理/解析(性能红线)。

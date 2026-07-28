# myterm-spec:轻量级 SSH 终端(类 Xshell)开发蓝本

本目录是一套完整的开发蓝本,目标是**用 AI 辅助,从零构建一个轻量级的类 Xshell 桌面终端**:

- 核心功能只有两块:**SSH 终端** 和 **SFTP 文件传输**(Xftp 的能力),其他复杂功能一律不做;
- 内核用**资源效率最高的方案**实现:Tauri 2 + Rust,产物是原生 .exe(安装包 + 绿色便携版),空载内存目标 < 80MB;
- 扩展性靠**类 VSCode 的插件体系**:独立插件宿主进程 + TypeScript SDK + 声明式贡献点 + 权限模型;
- 第一个官方插件是 **AI 助手**(OpenAI 兼容协议,可配 Base URL / API Key / 模型,抓取终端上下文问答、回填命令)。

产品代号:**myterm**(可全局替换为你自己的名字)。

## 目录结构

| 文件 | 内容 |
|---|---|
| [01-product-spec.md](./01-product-spec.md) | 产品规格:MVP 范围、用户故事、明确不做的事 |
| [02-architecture.md](./02-architecture.md) | 架构设计:技术栈、进程模型、**全部跨进程/跨模块接口定义(单一事实来源)** |
| [03-build-plan.md](./03-build-plan.md) | 开发计划:里程碑、任务依赖顺序、每步验收标准 |
| [prompts/](./prompts/) | 每个模块可直接复制给 AI 的任务指令 |

## prompts/ 目录

| 文件 | 对应模块 | 依赖 |
|---|---|---|
| [00-common.md](./prompts/00-common.md) | 通用约定(每条指令的前置内容) | — |
| [01-scaffold.md](./prompts/01-scaffold.md) | M0:工程脚手架 | — |
| [02-ssh-core.md](./prompts/02-ssh-core.md) | M1:SSH 会话内核(Rust) | M0 |
| [03-terminal-ui.md](./prompts/03-terminal-ui.md) | M2:终端视图与标签页(前端) | M1 |
| [04-config-vault.md](./prompts/04-config-vault.md) | M3:配置服务与凭据保险库 | M0 |
| [05-sftp.md](./prompts/05-sftp.md) | M4:SFTP 双栏文件管理 | M1、M2 |
| [06-plugin-host.md](./prompts/06-plugin-host.md) | M5:插件宿主与权限代理 | M0 |
| [07-plugin-api-builtins.md](./prompts/07-plugin-api-builtins.md) | M6:插件 SDK 与内置插件 | M2、M5 |
| [08-ai-plugin.md](./prompts/08-ai-plugin.md) | M7:AI 助手插件(MVP 完成线) | M6 |
| [09-packaging.md](./prompts/09-packaging.md) | M8:打包与分发 | M7 |

## 使用方法

1. **按里程碑顺序执行**(见 `03-build-plan.md`),不要跳步:后面的模块编译依赖前面的接口。
2. 给 AI 下任务时,消息由三部分拼成:
   - `prompts/00-common.md` 的全文(通用约定);
   - 对应模块的指令文件全文;
   - 指令中"需要附上的上下文"一节列出的现有代码文件。
   如果你用 Cursor / Claude Code 这类能直接读仓库的 agent,只需引用文件路径,不必手动粘贴。
3. **每个任务独立验收**:跑指令中列出的验收命令,全绿才提交,一个任务一个 commit。
4. 发现接口不合理时,**先改 `02-architecture.md`,再让 AI 按新接口重构**。接口文档永远是单一事实来源,禁止代码和文档各说各话。

## 核心原则(为什么这样拆)

- **内核极小,一切皆插件**:主程序只做会话、终端、SFTP、插件运行时四件事;主题、命令片段、AI 助手全部以插件实现,用自家插件先把 API 打磨到能用。
- **资源效率是硬指标**:不打包 Chromium(用系统 WebView2),SSH/SFTP 全在 Rust 原生代码里跑,插件宿主零插件时不启动、有插件时按需懒加载。
- **安全边界在原生层**:插件权限的唯一裁决点是 Rust 内核的 PermissionBroker,插件宿主即使被恶意插件攻破也拿不到未授权的能力。
- **接口先行**:三个进程(Rust 内核 / WebView 前端 / Node 插件宿主)之间只通过 `02-architecture.md` 定义的契约通信,AI 在任何单个模块里犯错都不会扩散。
- **测试是唯一验收手段**:每条指令都带测试要求和可执行的验收命令,不通过不合入。

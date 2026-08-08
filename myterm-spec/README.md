# myterm-spec:轻量级 SSH 终端(类 Xshell / MobaXterm)开发蓝本

本目录是一套完整的开发蓝本,目标是**用 AI 辅助,从零构建一个原生内置 AI 的轻量级桌面终端**:

- 核心功能:**SSH 终端**、**SFTP 文件传输**、**本地终端**(PowerShell/WSL)、**快捷命令集**(对标 Xshell),其他重功能一律不做;
- **AI 是一等公民**:内核内置 OpenAI 兼容客户端(可配 Base URL / API Key / 模型,支持 OpenAI/DeepSeek/Ollama/自建网关),右侧 AI 面板抓屏问答、命令一键回填;
- 内核用**资源效率最高的方案**实现:Tauri 2 + Rust,产物是原生 .exe(安装包 + 绿色便携版),空载内存目标 < 80MB;
- **类 VSCode 的插件体系**(插件宿主 + TypeScript SDK + 权限模型)作为 P2,契约已定义、MVP 后实施。

产品代号:**myterm**(可全局替换为你自己的名字)。界面原型见仓库 `myterm-prototype/`(可直接用浏览器打开)。

## 目录结构

| 文件 | 内容 |
|---|---|
| [01-product-spec.md](./01-product-spec.md) | 产品规格:MVP 范围、用户故事 U1–U10、明确不做的事 |
| [02-architecture.md](./02-architecture.md) | MVP 架构:技术栈、进程模型、**全部跨模块接口定义(单一事实来源)** |
| [03-build-plan.md](./03-build-plan.md) | 开发计划:里程碑 M0–M7(MVP)+ M8–M9(P2)、依赖顺序、验收标准 |
| [04-plugin-system-p2.md](./04-plugin-system-p2.md) | P2 插件体系:宿主、权限模型、manifest、SDK、RPC 契约 |
| [prompts/](./prompts/) | 每个模块可直接复制给 AI 的任务指令 |

## prompts/ 目录

| 文件 | 对应里程碑 | 依赖 |
|---|---|---|
| [00-common.md](./prompts/00-common.md) | 通用约定(每条指令的前置内容) | — |
| [01-scaffold.md](./prompts/01-scaffold.md) | M0:工程脚手架 | — |
| [02-ssh-core.md](./prompts/02-ssh-core.md) | M1:SSH 会话内核(Rust) | M0 |
| [03-terminal-ui.md](./prompts/03-terminal-ui.md) | M2:终端视图、标签页与快捷命令 | M1 |
| [04-config-vault.md](./prompts/04-config-vault.md) | M3:配置服务与凭据保险库 | M0 |
| [05-sftp.md](./prompts/05-sftp.md) | M4:SFTP 双栏文件管理 | M1、M2 |
| [06-local-terminal.md](./prompts/06-local-terminal.md) | M5:本地终端 | M2 |
| [07-ai-service.md](./prompts/07-ai-service.md) | M6:内置 AI | M1、M2、M3 |
| [08-packaging.md](./prompts/08-packaging.md) | M7:打包与分发(MVP 完成线) | M6 |
| [p2-plugin-host.md](./prompts/p2-plugin-host.md) | M8(P2):插件宿主与权限代理 | MVP |
| [p2-plugin-api.md](./prompts/p2-plugin-api.md) | M9(P2):插件 SDK 与验证插件 | M8 |

## 使用方法

1. **按里程碑顺序执行**(见 `03-build-plan.md`),不要跳步:后面的模块编译依赖前面的接口。
2. 给 AI 下任务时,消息由三部分拼成:
   - `prompts/00-common.md` 的全文(通用约定);
   - 对应模块的指令文件全文;
   - 指令中"需要附上的上下文"一节列出的现有代码文件。
   如果你用 Cursor / Claude Code 这类能直接读仓库的 agent,只需引用文件路径,不必手动粘贴。
3. **每个任务独立验收**:跑指令中列出的验收命令,全绿才提交,一个任务一个 commit。
4. 发现接口不合理时,**先改契约文档(02 或 04),再让 AI 按新接口重构**。接口文档永远是单一事实来源,禁止代码和文档各说各话;原型阶段不做补丁式修订,必要时整篇重构文档。

## 核心原则(为什么这样拆)

- **内核极小、AI 原生**:主程序只做会话、终端、SFTP、快捷命令、AI 五件事;AI 客户端放 Rust 内核而非前端/插件,Key 不出原生层、抓屏零跨进程开销。
- **资源效率是硬指标**:不打包 Chromium(用系统 WebView2),SSH/SFTP/AI 全在 Rust 原生代码里跑;P2 的插件宿主零插件时不启动。
- **接口先行**:模块之间只通过契约文档定义的接口耦合,AI 在任何单个模块里犯错都不会扩散。
- **安全红线全局适用**:密码/Key 只存 OS 凭据库;抓屏内容发送前对用户可见;配置、日志、错误消息出现明文凭据即一票否决。
- **测试是唯一验收手段**:每条指令都带测试要求和可执行的验收命令,不通过不合入。

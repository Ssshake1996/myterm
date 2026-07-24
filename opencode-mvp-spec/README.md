# opencode-mvp-spec:AI 编程助手 MVP 开发蓝本

本目录是一套完整的开发蓝本,目标是**用 AI 辅助,从零构建一个类似 [opencode](https://github.com/anomalyco/opencode) 的终端 AI 编程助手(coding agent)的 MVP**。

产品代号:**mycode**(可全局替换为你自己的名字)。

## 目录结构

| 文件 | 内容 |
|---|---|
| [01-product-spec.md](./01-product-spec.md) | 产品规格:MVP 范围、用户故事、明确不做的事 |
| [02-architecture.md](./02-architecture.md) | 架构设计:技术栈、模块边界、**全部核心接口定义(单一事实来源)** |
| [03-build-plan.md](./03-build-plan.md) | 开发计划:里程碑、任务依赖顺序、每步验收标准 |
| [prompts/](./prompts/) | 每个模块可直接复制给 AI 的任务指令 |

## prompts/ 目录

| 文件 | 对应模块 | 依赖 |
|---|---|---|
| [00-common.md](./prompts/00-common.md) | 通用约定(每条指令的前置内容) | — |
| [01-scaffold.md](./prompts/01-scaffold.md) | M0:工程脚手架 | — |
| [02-provider.md](./prompts/02-provider.md) | M1:LLM Provider 层 | M0 |
| [03-tools.md](./prompts/03-tools.md) | M2:工具层 | M0 |
| [04-permissions.md](./prompts/04-permissions.md) | M3:权限系统 | M2 |
| [05-session.md](./prompts/05-session.md) | M4:会话持久化 | M0 |
| [06-agent-loop.md](./prompts/06-agent-loop.md) | M5:Agent 核心循环 | M1–M4 |
| [07-cli.md](./prompts/07-cli.md) | M6:CLI REPL(MVP 完成线) | M5 |
| [08-tui.md](./prompts/08-tui.md) | M7:TUI(MVP 之后) | M6 |

## 使用方法

1. **按里程碑顺序执行**(见 `03-build-plan.md`),不要跳步:后面的模块编译依赖前面的接口。
2. 给 AI 下任务时,消息由三部分拼成:
   - `prompts/00-common.md` 的全文(通用约定);
   - 对应模块的指令文件全文;
   - 指令中"需要附上的上下文"一节列出的现有代码文件。
   如果你用 Cursor / Claude Code / opencode 这类能直接读仓库的 agent,只需引用文件路径,不必手动粘贴。
3. **每个任务独立验收**:跑指令中列出的验收命令,全绿才提交,一个任务一个 commit。
4. 发现接口不合理时,**先改 `02-architecture.md`,再让 AI 按新接口重构**。接口文档永远是单一事实来源,禁止代码和文档各说各话。

## 核心原则(为什么这样拆)

- **AI 是加速器不是自动售货机**:每条指令的边界都控制在"一次会话能高质量完成"的范围内(约 300–800 行产出)。
- **接口先行**:所有模块围绕 `02-architecture.md` 里的 TypeScript 接口编写,模块之间只通过接口耦合,AI 在任何单个模块里犯错都不会扩散。
- **测试是唯一验收手段**:每条指令都带测试要求和可执行的验收命令,不通过不合入。
- **UI 最后做**:先用纯文本 REPL 验证 agent 循环端到端跑通,TUI 是 MVP 之后的事。

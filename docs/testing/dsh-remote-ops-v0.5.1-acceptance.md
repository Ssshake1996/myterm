# dsh-remote-ops v0.5.1 验收

日期：2026-10-15（Asia/Tokyo）。目标是修复空 `flowId` 抢占有效 `steps` 的网页操作失败，并把校验和工具说明全部放进插件包，供另一台内网电脑安装。

## 修改边界

- 产品代码修改插件的操作来源校验、工具/HTTP 参数入口、流程查找错误及版本号；插件自带工具 description/参数说明及 `remote-ops-browser` skill 随 tgz 分发。
- skill 通过 DSH 原生 provider 全局注册，卸载时由 Cordis 清理，不写入或覆盖用户 skill 文件；没有 skill 服务的宿主仍可执行网页操作与参数校验。
- 未修改 Agent 实现、已有 Agent 提示段或 DSH 内核；未新增依赖。真实宿主验收使用独立测试 profile 的本地确定性模型与网页夹具，不是对日常 Agent 的改造。
- 原生右栏、主对话、共享输入、停止对话、网站与凭据隔离、请求去重继续沿用现有机制。

## 回归证据

先增加 7 组工具/HTTP 回归，旧实现 **7 组失败**，再修改实现并全部通过。覆盖 omitted/null/空/空白流程 ID、保存 ID 去除首尾空白及可选空步骤、双操作来源冲突、字段类型、缺少来源、流程不存在及同来源网站仍不同 siteId 的隔离。失败前不派发动作、不创建回执；修正未接受的请求后可执行，同一已接受请求仍去重。

随后补入 2 组 skill 回归，验证原生 provider 的发现/加载契约、示例步骤可通过真实参数校验，以及缺少可选 skill 服务不会阻断网页模块。skill-creator 校验通过。

| 验证层级 | 命令 / 环境 | 结果 |
| --- | --- | --- |
| 完整门禁 | `npm run check --prefix integrations/dsh-remote-ops`，Windows / Node 24.11.1 | 172 后端、103 前端、11 契约测试及 smoke 全通过 |
| UI 静态契约 | `check_dsh_ui_contract.mjs integrations/dsh-remote-ops` | 14 通过、0 错误；预期警告为 DSH 包没有 Codex manifest |
| 浏览器回归 | `node e2e/runner/index.mjs --output output/browser051-e2e-release`，Chrome 154.0.8037.99 | 12/12；真实插件 + 仿宿主 + 假 SSH/SFTP + 本地测试网站 |
| 候选包真实宿主 | 隔离 DSH 0.2.0-rc.2 Web profile，实际 Chrome，1280×900 / 390×844 | 以下 12 组流程全部通过；无 pageerror、console 或非 favicon HTTP 错误 |
| 原生 skill 生命周期 | 实际 Cordis 与 DSH skill 服务，安装包 provider | 可发现和加载；用户 skill 保持优先级；卸载 provider 后定义与缓存目录均移除 |

## 真实 DSH 工具调用

本地确定性模型从 DSH 主对话发出真实 `remote_browser_run` 和 `remote_browser_read`，经宿主工具派发与插件执行，读取实际 Chrome 网页结果。失败调用也经过同一路径；测试没有改写或绕过 Agent 工具执行器。

1. 左侧入口左对齐，Space 复用同一个原生右栏；工作区方向键可用，主对话编辑器 DOM 与草稿保留。
2. 插件输入 URL 后直接打开网页，不需要预先创建网站或流程。
3. `flowId: ""` 的 XPath 输入、role 按钮点击、结果检查和读取成功，网页计数为 1。
4. `flowId: null` 的临时读取成功，不要求 Agent 配置变更。
5. 空白流程 ID 执行成功，计数为 2；相同请求再次调用返回同一 job，计数保持 2。
6. 非空 ID 与步骤混用、没有操作来源、流程不存在分别得到 `BROWSER_RUN_SOURCE_CONFLICT`、`BROWSER_RUN_SOURCE_REQUIRED`、`BROWSER_FLOW_NOT_FOUND`，前一 job 和网页计数均未改变。
7. 保存流程在同 URL 的临时网站浏览器上返回 `BROWSER_FLOW_SITE_MISMATCH`，没有改选浏览器或执行点击。
8. JSON 字符串形式的步骤得到 `BROWSER_STEP_INVALID`，网页计数不变。
9. 修正先前未接受的请求，使用同一 requestId 和临时步骤成功，计数变为 3。
10. 打开匹配的保存网站后，带首尾空白的真实流程 ID 与空 steps 数组可运行保存流程，结果检查通过。
11. 切换终端/网页保留主对话与草稿；刷新恢复网页工作区，深色与 390px 布局可用，实时画面可见。
12. 实际模型请求的原生 skill catalog 包含 `remote-ops-browser`；现有 `skill` 工具从安装包加载完整指南后，再执行网页工具。没有修改 Agent 实现或配置。

每次请求还检查模型实际收到的工具元数据包含新版说明、skill 可发现且能加载，证明说明由已安装的插件导出，不依赖另行迁移 Agent 配置。候选包加入 skill 后的首次脚本在宿主尚未启动就绪时超时，未进入网页操作；宿主就绪后重跑 12 组通过，并延长验收脚本的启动等待。此处记录该启动等待失败，未把它归为产品参数问题。

## 发布包复验

正式 [v0.5.1 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.5.1) 已发布，tag 指向源码提交 `9cec73fe93e0ed32ef8d9d29e086a04af8f4d81f`；[GitHub Actions 发布门禁](https://github.com/Ssshake1996/myterm/actions/runs/38669646494)（Linux / Node 22）通过。

- 重新下载正式 `dsh-remote-ops-v0.5.1.tgz` 与校验文件，SHA256 为 `0e9419dd308dd5b8d9cbdf30e254919472c18085847ccbe216950b1e0ebd13eb`，与本地发布包、校验文件及 GitHub 资产 digest 一致。
- 正式 tgz 共 47 个文件，逐文件与源码、新装 profile 和升级 profile 的安装目录比对，全部相同；包括 `lib/browser-skill.js` 及 `skills/remote-ops-browser/SKILL.md`。
- 用正式资产新建另一隔离 DSH 0.2.0-rc.2 profile，复跑上述 12 组真实宿主流程全部通过；页头显示 `v0.5.1`，1280px / 390px 截图已检查，无 pageerror、console 或非 favicon HTTP 错误。
- 正式安装目录的 provider 经真实 Cordis / DSH skill 服务再次验证：发现、加载、用户 skill 优先级与卸载清理通过。
- 将已安装正式 v0.5.0 的独立 profile 升级到该正式资产：`sites.json`、`flows.json`、`preferences.json` 的 SHA256 升级前后和新版加载后均不变，原网站/流程 ID 与浏览器/显示偏好保持。
- 验收仅使用独立测试 profile，没有改动日常 DSH profile、Agent 实现或用户的全局 skill 文件。测试浏览器、DSH 与本地模型/网站服务已关闭。

## 限制

验证宿主为本机 DSH 0.2.0-rc.2，模型和网站为本地测试夹具；没有直接访问用户的另一台电脑或真实内网登录网站，不能保证任意旧宿主与模型组合。无效的非空流程 ID 仍需按具体错误修正，不会被自动替换为任意流程。动作发出后的 unknown/超时仍需检查结果，不能当成参数校验失败而重跑。

升级必须安装到实际 DSH 用户、`DSH_HOME` 和 profile，完全停止旧进程后重启并刷新网页，确认显示 `v0.5.1`。运行中的任务不跨重启恢复。本次没有处理已暂缓的 SSH 参数空格问题。

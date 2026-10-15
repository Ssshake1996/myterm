# dsh-remote-ops v0.5.2 验收

日期：2026-10-15（Asia/Tokyo）。修复范围：插件参数 Schema、网页步骤空值兼容与字段错误定位；不修改 Agent 或 DSH 内核。

## 修改边界与回归

- 注册层将插件既有字段定义转换为标准对象 JSON Schema；网页工具有完整动作/定位器枚举和条件必填字段。DSH 一次请求会携带插件全部工具，因此统一修正 37 个工具的元数据，SSH/SFTP 执行函数未改动。
- 网页可选 null、空白 iframe 字段归一化；保留空文本填充与精确空 role 名称。必填字段、非法动作、字段类型、非空 expect 缺少 target 等仍拒绝，错误包含步骤下标和字段路径，不回显输入值。
- 全部步骤校验后才创建 job/回执；等价空值与省略共用请求哈希。凭据引用、域名限制、共享输入、对话取消及不自动重试未知结果等机制沿用。
- Agent 实现、已有插件 Agent 提示段及 DSH 内核未修改。Ajv 8.17.1 仅为开发测试依赖；候选包在新的 DSH profile 安装时没有安装 Ajv，运行时依赖仍为原有 playwright-core 与 ssh2。

先增加 8 组回归，旧实现 **8 组失败、原有 23 组通过**；修复后 31 组通过。新增测试使用独立 Ajv 校验完整工具定义，而非把字段表当成 Schema；覆盖条件必填、空值、空文本与精确空名称、错误路径、整次不派发、去重及随包 skill 示例。

| 验证 | 环境 / 命令 | 结果 |
| --- | --- | --- |
| 完整发布门禁 | Windows / Node 24.11.1，`npm run check --prefix integrations/dsh-remote-ops` | 180 后端、103 前端、11 契约及 smoke 全通过 |
| 标准参数协议 | 实际 Cordis / DSH tools 服务及 Ajv | 37/37 工具 Schema 通过，其中网页 6 个 |
| UI 静态契约 | `check_dsh_ui_contract.mjs integrations/dsh-remote-ops` | 14 通过、0 错误，预期警告为 DSH 包没有 Codex manifest |
| 浏览器回归 | `node e2e/runner/index.mjs --output output/browser052-e2e-release`，Chrome 154.0.8037.99 | 发布源码提交 eb6afb5 的 12/12 场景通过；真实插件/客户端 + 仿宿主 + 假 SSH/SFTP + 本地网页 |
| 候选包真实宿主 | 新隔离 DSH 0.2.0-rc.2 Web profile，实际 Chrome，1280×900 / 390×844 | 以下 16 组通过，无 pageerror、console 或非 favicon HTTP 错误 |
| 随包 skill | skill-creator 校验、实际 DSH skill 服务 | 示例符合导出 Schema；可发现/加载、用户优先级和卸载 provider 后移除定义/缓存均通过 |

## 真实 DSH 验证

主对话经 DSH 原生工具循环发出网页调用。测试提供方检查真实 HTTP 模型请求中全部 `remote_*` 工具定义，使用 DSH 公开校验器和 Ajv 校验，并保存实际发送的 37 个 Schema。另有一例从收到的动作分支、定位器枚举和 required 字段构造调用，再在实际 Chrome 中执行并检查结果，补上此前只验证固定参数执行链路的遗漏。

1. 左侧入口左对齐，键盘激活复用原生右栏，主对话编辑器及草稿保留。
2. 直接输入网址打开，不需保存网站或流程。
3. 空 flowId 的 XPath 输入、role 点击、结果检查与读取成功，网页计数为 1。
4. 安装包的 `remote-ops-browser` 出现在原生 skill catalog，通过现有 skill 工具加载新版指南。
5. 实际模型请求中的 37 个插件参数 Schema 均通过校验，不由夹具代为包装字段表。
6. null flowId 可读取当前页面。
7. 空白 flowId 执行后计数为 2；同一请求去重，不重复点击。
8. 来源冲突、来源缺失和流程不存在在动作发出前拒绝。
9. 同 URL 的临时网站不能运行另一个保存网站的流程，不自动换站。
10. JSON 字符串 steps 被拒绝，不执行动作。
11. 修正先前未接受的请求后，同一 requestId 可执行，计数变为 3。
12. 可选字段 null、空 iframe、填入后清空文本成功，计数为 4；省略这些字段重试返回同一 job，计数不变。
13. 第二步缺少 target、frame 类型错误、expect 缺少 target 分别返回具体字段路径；第一步的标记没有写入页面，之前 job 和计数不变，报错不回显标记。
14. 测试提供方依据实际请求 Schema 构造步骤并执行，页面显示 `Schema from wire`，计数变为 5。
15. 打开匹配保存网站后，真实 flowId 与空 steps 数组运行成功。
16. 切换、刷新、深色及 390px 布局保持选中网页、草稿与实时画面。

## 正式发布包复验

正式 [v0.5.2 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.5.2) 已发布，tag 指向源码提交 `eb6afb55823ef7729cea26a8d894954bf6d7404d`；[GitHub Actions 发布门禁](https://github.com/Ssshake1996/myterm/actions/runs/38674698392)（Linux / Node 22）通过。

- 从 GitHub 重新下载正式 tgz 与校验文件，SHA256 为 `afdf424f11f80a0687a780c66795a04743ceb1509f0005bb42b6115498fee58e`，与本地发布包、校验文件及 GitHub 资产 digest 一致。
- 正式包 49 个文件与源码、新装 profile、升级 profile 的安装目录逐文件一致，包括两个 Schema 模块和新版随包 skill；新的运行 profile 没有安装 Ajv。
- 新的隔离 DSH 0.2.0-rc.2 profile 安装正式包后，复跑上述 16 组全部通过；实际模型请求中的 37 个 Schema 全部通过 DSH 校验器及 Ajv 校验。1280px 与 390px 截图已检查，页头显示 v0.5.2，Schema 构造的步骤结果为 5，界面完成状态为 3/3。
- 正式包原生 skill 发现、加载、用户优先级及 provider 卸载清理再次通过；无 pageerror、console 或非 favicon HTTP 错误。
- 已安装正式 v0.5.1 的另一独立 profile 升级至该正式资产后，`sites.json`、`flows.json`、`preferences.json` 的 SHA256 在升级前后及新版加载后均不变；网站/流程 ID 与浏览器/显示偏好保留。
- 验收仅使用隔离 profile，没有修改日常 DSH profile、Agent 实现或用户全局 skill 文件。所有测试浏览器、DSH 与本地模型/网站服务已关闭，3091/3092 测试端口已释放。

## 验证限制

真实宿主为本机 DSH 0.2.0-rc.2；模型提供方是本地确定性测试夹具，网站是本地测试网页。验证证明实际模型请求的 Schema 与宿主执行路径，不能代替用户另一台电脑、真实内网站点或特定模型生成行为的现场验收。另一台电脑的完整失败入参仍未取得，不能将本次复现等同于现场唯一根因。

本轮不包含此前暂缓的 SSH 命令参数空格问题，也未改变 SSH 命令文本发送逻辑。升级应安装到实际 DSH 用户、DSH_HOME 和 profile，停止旧进程、重启并刷新网页，确认显示 v0.5.2；运行中的任务不会跨重启恢复。

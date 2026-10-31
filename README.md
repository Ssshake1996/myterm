# DSH Remote Ops

`@dsh/remote-ops` 是面向 DeepSeek Harness 的终端、网页、Windows 桌面与 API 运维插件。用户和 Agent 在同一工作区操作终端和软件窗口、浏览网页、传输文件并调用业务接口。

在主对话中描述任务，右侧即可查看命令回显、网页操作和 API 请求结果，也可以直接在插件里操作。

**终端 · 多会话与命令回显**

本地 CMD 与 SSH 共用一套标签。示例中 Agent 连接三个本地 SSH 测试会话、执行版本查询；当前终端与后台新输出均清晰标识。

[![v0.9.2 真实 DSH：本地 CMD 与三个 SSH 会话统一标签，显示版本查询回显](docs/images/remote-ops/terminal.png)](docs/images/remote-ops/terminal.png)

**网页 · 同一页面内操作与观察**

输入网址即可打开网页。示例中 Agent 在插件内的本地测试页面填写内容、读取结果，用户也可直接点击和输入。

[![v0.9.2 真实 DSH：插件内网页显示 Agent 填写的测试内容](docs/images/remote-ops/browser.png)](docs/images/remote-ops/browser.png)

**API · 请求、响应与业务结果**

选择保存的 API 环境发送请求，查看状态码和可折叠 JSON；点击字段复制 JSON Pointer，便于配置登录 Token 提取路径。

[![v0.9.2 真实 DSH：HTTP 状态、业务结果提醒与可折叠 JSON 响应树](docs/images/remote-ops/api.png)](docs/images/remote-ops/api.png)

<details>
<summary>截图环境与版本</summary>

三张截图来自 Remote Ops v0.9.2 在真实 DSH 0.2.0-rc.2 中的安装验收，安装包与正式 Release 的 SHA256 一致，未拼接或模拟插件界面。测试使用独立 profile、确定性模型服务及本地 SSH、网页、API 服务，工具调用和请求实际执行；不代表连接了用户的生产设备。

</details>

---

## Windows 桌面操作

新增“桌面”工作区：连接本机 Windows 或保存的 Windows SSH 环境，在插件中查看真实软件窗口，让 Agent 打开程序、填写内容、点击按钮并核实结果。用户可随时在同一画面操作，停止任务沿用 DSH 停止对话。支持按当前对话导出桌面记录和最后窗口图。

执行器和依赖包含在 tgz 内，安装后原生发现 `remote-ops-desktop` skill。目标需要已登录、解锁的 Windows 11 或带 Desktop Experience 的 Server；远程账号需对应此用户会话。热加载会等待桌面任务完成，并保留连接与日志。具体准备步骤、工具参数和恢复方式见 [Windows 桌面指南](integrations/dsh-remote-ops/DESKTOP.md)。

首次使用可按 [远程 Windows 配置步骤](integrations/dsh-remote-ops/DESKTOP.md#远程电脑的一次性配置) 启用 OpenSSH，再复制 [让 Agent 打开记事本、输入并保存的完整示例](integrations/dsh-remote-ops/DESKTOP.md#完整示例打开记事本输入并保存)。示例通过软件界面输入和保存，再独立读取文件核对内容。

## 更新后热加载

从 v0.11.0 起，在 **设置 → 更新** 点击“检查并更新”，插件完成下载、SHA256 校验和安装后，会等待任务结束并自动应用新版，无需重启 DSH。等待范围包括各对话的执行任务、终端等待及独立命令、文件传输、网页操作、浏览器安装和 API 请求。批量上传等待整批完成或取消，文件之间的请求间隙也不会触发重载。界面会显示等待原因。

热加载保留当前对话与草稿、已保存配置、现有终端和网页连接、日志及 API 登录状态和请求记录；不会重放命令或请求。人工终端里的长命令不以“输出安静”判断结束，连接在版本交接时保留。新建连接使用新版实现，已有连接保持其创建时的传输实现。

若新版启动失败，恢复旧运行实例，并显示“重试应用已安装版本”；磁盘上的已安装版本与当前运行版本会分别显示。缺少宿主热加载接口或版本的状态格式不兼容时，界面明确提示需要重启。

**首次从 v0.10.x 或更早版本升级到本版，仍需重启 DSH 一次以加载热加载能力。** 此后通过插件更新界面升级兼容版本即可自动热加载。使用 CLI 或宿主插件管理安装后，可在本插件“设置 → 更新”点击“重试应用已安装版本”。仅刷新浏览器不等于后端已更新。真实 DSH 验证范围见 [v0.11.0 验收记录](docs/testing/dsh-remote-ops-v0.11.0-acceptance.md).

## SSH 标签状态与全部关闭

终端标签栏直接提供“全部关闭”：只关闭点击时当前对话中的全部 SSH 标签及对应连接，保留本地 CMD、保存的环境和其他对话连接。存在连接或已知执行任务时集中确认一次，并显示正在操作的数量；仅清理没有执行任务的已断开标签时直接完成。关闭失败的标签保留并列出原因，可核对后重试。确认期间新开的标签不加入本次关闭。

| 提示 | 含义 |
| --- | --- |
| 黄色环 | 插件正在等待回显、执行独立命令或关闭连接；悬停可查看具体状态及是否为 Agent 操作 |
| 绿色点 | 连接已建立；不代表命令已经完成或业务成功 |
| 灰色空心点 | 已断开且没有已知执行任务；保留最后输出，便于查看或导出 |

颜色同时配合形状、文字说明和无障碍描述；蓝色仍表示当前选中的标签。黄色是状态提示，用户仍可同时操作。插件不把普通按键输入或新输出当作可准确计时的命令任务。

关闭会取消该标签关联的等待与独立命令，并请求关闭 SSH 通道；远端进程是否已停止仍需核实，不自动重放命令。关闭标签不清除已保留的日志，可在保留期限内通过日志工具或“更多 → 一键打包本会话全部日志”导出。

## Windows OpenSSH

Windows 桌面与 Server 沿用现有 SSH 环境、终端、文件和日志入口。在“环境 → SSH”中选择目标系统与 Shell，可使用服务器默认、CMD、Windows PowerShell 5.1 或目标已安装的 PowerShell 7。“测试”会分别报告身份验证、系统识别、PTY 和 SFTP，并显示主机指纹。

Agent 可通过 `remote_environment_create/update/test` 管理和诊断环境；`remote_command_execute` 接受 Windows Shell、字面工作目录及 PowerShell 命名参数，返回退出码和独立错误流。Windows 独立命令使用单独的 SSH 连接，保留可见终端。SFTP 支持盘符、中文和空格路径，文件与多终端日志沿用原有接口。

随包提供 `remote-ops-windows` skill，安装插件后由 DSH 原生发现。用法见 [Windows 操作指南](integrations/dsh-remote-ops/WINDOWS.md)，已完成与待验证的组合见 [验证记录](docs/testing/dsh-remote-ops-v0.10.2-acceptance.md)。Agent 无需修改。

## 工作区标签

顶部“终端 / 网页 / 文件 / API”紧凑靠左排列，蓝色选中条覆盖完整标签按钮。窄栏收紧留白，保留文字、后台任务徽标和方向键 / Home / End 操作；切换仍保留当前工作区内容。

后续 WinRM 方向见[分阶段设计](docs/proposals/windows-remote-implementation.md)。

## 终端布局与请求诊断

- 终端标签、全部关闭、搜索和当前日志导出合并为一行，桌面标签约 32px 高；全部日志打包位于“更多”。路径显示在底部状态栏，常用命令保留在下方，SSH 尺寸统一在“设置 → 终端”调整。
- 错误提示区分“状态刷新失败”“终端输出刷新失败”和“插件更新失败”。展开“错误详情”查看失败请求的方法、地址、HTTP 状态、阶段、时间和响应摘要；网络失败明确显示未收到 HTTP 响应。
- 更新失败进一步定位到版本清单、SHA256 校验文件或安装包，并显示实际失败地址。更新源的 HTTP 状态与插件接口的 HTTP 状态分别标注。
- 同一次 DSH / 插件运行期间，同一后台刷新错误只自动提示一次；关闭后、切换工作区或刷新网页不会反复弹出。后台重试继续，手动“刷新状态”仍反馈本次结果；状态恢复清除对应错误，识别到新的后端运行标识后重新允许提示。
- 诊断信息遮蔽 URL 查询参数及常见密码、Token、Cookie、Authorization 字段，响应摘要限制长度；不采集请求体或请求头。

若出现 404，先展开详情确认失败的是 `/api/dsh-remote-ops/state` 还是更新源文件，再检查对应的插件加载、服务路由或发布目录。状态刷新失败不代表更新检查失败；版本检查仍由用户手动触发。

## 工作区布局

- 四个工作区共用一个“设置”入口：通用、终端、网页、更新。环境入口统一管理 SSH / API，表单与凭据仍分别保存。
- 本地 CMD 与 SSH 使用同一终端标签栏，当前标签通过底色、边框和加粗文字突出，支持方向键切换；SSH 和 API 环境页左上角常驻“返回工作区”，滚动时保持可见，返回后保留原终端或请求草稿。终端栏直接显示全部关闭、搜索、当前 TXT 导出和“更多”；快捷命令默认显示紧凑条，展开或进入“命令库”管理。
- 顶部标签提示终端新输出、文件传输和网页执行状态；查看对应终端后清除新输出。传输总量可靠时显示百分比，否则显示“传输中”。
- API 结果按“响应 / 记录”切换。JSON 树可折叠，点击字段名复制 JSON Pointer；复制失败可手动选择路径。HTTP 状态码带颜色和文字，2xx 提示“请检查业务结果”。大响应按节点分批显示，原文仍可查看。
- 标签与设置切换保留终端、网页和 API 面板状态；后台任务继续，隐藏网页暂停画面取帧。

## RESTful 环境与执行工作区

- **API** 工作区：保存环境的 Base URL、分组、公共请求头、超时、私有 CA 和登录配置。API 环境独立于 SSH，可选关联同一设备的 SSH 环境。
- 支持一次 POST 账号密码登录，通过 JSON/form 提交，从响应 JSON Pointer 或响应头提取 Token，或保存符合域名、路径、Secure 和过期规则的 Cookie；支持 Cookie 到 CSRF 请求头的映射。密码写入 DSH 凭据服务，环境只保存引用。登录会话按对话隔离，仅保留于本次进程。
- 手动与 Agent 请求共享可见记录：登录、方法、路径、HTTP 状态、耗时、脱敏响应、错误及结果未知状态；可一键导出当前对话记录。HTTP 2xx 不代表业务操作成功，仍需检查响应中的业务结果。
- `remote-ops-api` skill 提供 Agent 操作指南：先通过 `remote_api_environment_list` 选择环境，用 `remote_api_environment_save/delete` 管理配置，再按实际 ID 调用 `remote_api_login`、`remote_api_request` 和 `remote_api_records`。
- Base URL 的路径前缀会保留；`/items` 和 `items` 均基于该前缀。请求由 DSH 主机发送，不自动跟随重定向，不自动登录重试或重放业务请求。超时/中断后无法确定结果时先查询设备状态。
- 配置持久化于 `$DSH_HOME/remote-ops/api/environments.json`；记录与去重仅覆盖当前对话、本次进程最近 100 次请求。响应预览最多 128 KiB，请求体最多 1 MiB。配置修改清除登录态，已发请求保持原目标；切换页签不取消请求。
- 凭据和已知认证值会脱敏，业务响应仍应按其实际数据敏感性处理。

## 本地 CMD 命令和目录配色

终端采用参考 [Catppuccin](https://catppuccin.com/palette/) 的 Latte / Mocha 配色，跟随 DSH 深浅主题：命令紫色、目录青色、文件蓝色，浅色强调色适当加深以保证文字对比度。错误、警告和成功前缀也有高亮，颜色用于辅助阅读，结果应结合实际输出核对。插件外围使用宿主样式。

默认本地 CMD 中，用户手动输入、Agent 完整命令及原始按键方式输入的命令，在实际回显后统一使用强调色、字重和淡背景。识别在终端光标重绘之后进行，编辑、退格和历史回显可保持可读；不会为了着色额外执行命令或显示隐藏输入。

标准 `dir` 列表的目录名使用青绿色、文件名使用蓝色，日期、大小和统计信息保留原样；原有 ANSI 颜色继续保留。支持常见 CMD、PowerShell 和带 `user@host` 的 Shell 提示符。自定义提示符、`dir /b` 等缺少类型信息的格式不猜测分类。全屏程序不添加这些语义颜色，“设置 → 终端”可统一关闭；复制、搜索和日志导出的文字不因配色改变。

## 环境密码按需查看

环境编辑页的 SSH 密码旁提供眼睛按钮。默认遮蔽，点击后读取当前生效的已保存密码；再次点击隐藏，关闭编辑页或抽屉后清除读取结果。新输入的密码也可显示核对。

仅查看不会修改密码，查看后保存其他字段仍保留原凭据；输入新密码才会更新。未配置、凭据缺失或服务不可用时会明确提示，并可重试或重新输入。明文不写入浏览器持久存储、环境列表、诊断记录或 Agent 工具返回值。随包环境管理 skill 提供查看路径。

## 终端日志

- 终端标签右侧的下载按钮导出当前终端 UTF-8 TXT；“更多 → 一键打包本会话全部日志”导出 ZIP，包含仍保留的已关闭 SSH 记录和共享本地终端。ZIP 每个终端一个文件，附 `manifest.json` 标明来源、时间和保留范围。
- `remote_terminal_logs`、`remote_terminal_log_read`、`remote_terminal_log_export`。Agent 可列出日志、按原始游标分页读取，再直接调用插件打包接口获得下载链接和 SHA256；打包不需要先读完日志或在终端执行压缩命令。Web 对话返回当前已验证 DSH 地址的完整下载链接；无法获得浏览器地址时仍可从终端工具栏导出，不猜测地址。
- 随包 `remote-ops-terminal-logs` skill 由 DSH 原生服务自动发现，也可用 `/remote-ops-terminal-logs` 加载。安装包包含接口和使用指南。
- 日志仅保留于本次 DSH 进程：每个终端最多 4 MiB，超限保留末尾 3 MiB；已关闭记录共享 16 MiB / 32 条上限。接口显式返回截断及淘汰情况，重启后不恢复。只采集设备回显，不额外记录隐藏输入；程序主动打印的敏感内容仍可能包含在日志中。
- 单包最多 32 条记录 / 32 MiB 原始输出；下载缓存最多 10 包 / 32 MiB，链接有效期最长一小时，缓存淘汰或重启会提前失效。导出冻结当前记录；后续输出需重新导出。终端文本保留进度刷新内容，不等于全屏界面录像；独立命令和网页操作记录不在此接口范围。

## Agent 环境管理

- `remote_environment_update`：按已有环境 ID 或名称修改名称、地址、端口、用户、分组、凭据引用、编码及 CLI/终端预设。只修改明确提供的非 null 字段，保留内部 ID 和其他配置；重复名称、非法值和未声明字段在写入前拒绝。
- 随包 `remote-ops-environments` skill 通过 DSH 原生服务自动注册，可自动加载或使用 `/remote-ops-environments`。
- 更新保存配置不会中断或改变现有 SSH 连接，新配置用于新连接。`passwordRef: "configured"` 仅为显示标记，更新时省略该字段即可保留凭据；新密码仍通过环境表单写入凭据服务。
- 前端环境管理与 Agent 使用同一份持久化数据。接口及安装说明见 [插件 README](integrations/dsh-remote-ops/README.zh-CN.md)。

## 界面与交互

- 终端、网页、文件及环境、快捷命令、诊断采用统一的字号、间距、控件和深浅色层次。顶部保留工作区标签，版本、诊断和“界面密度”收进“设置 → 通用”，更新位于“设置 → 更新”；舒适/紧凑密度在本浏览器中保存。
- 本地 CMD 和 SSH 共用一行标签，搜索、导出等工具固定在右侧。标签放不下时，两端显示左右箭头，点击即可滚动查看更早或更新的标签，到达边界时对应箭头置灰；无需关闭连接。方向键及 Home/End 可切换并定位当前终端，后台输出和状态刷新保留手动滚动位置。
- 网页以地址和实时画面为主。“设置 → 网页”统一管理引擎、Chromium 安装、视口与缩放；“收藏”管理网站与流程；“操作记录”在画面下方展开。返回工作区保留地址草稿和当前网页。
- 已打开网页切换“插件内 / 独立窗口”时先确认，取消不会派发切换；确认后会重载页面，未提交表单可能丢失。执行中禁止重复切换。
- 文件列表选中项目后才显示复制、删除等操作；上传入口与其他按钮统一，浏览器上传展示字节进度。切换模块保留选择、草稿与后台任务，目录完成刷新继续合并。

左侧入口打开 DSH 原生右栏；人和 Agent 共享输入，停止对话使用 DSH 原生入口。

## 浏览器参数与按需安装

浏览器运行在 DSH 主机上。Chromium 可由 Agent 调用插件工具按需安装，或在“设置 → 网页”中安装。依赖和浏览器下载需有可访问的源。

- 独立窗口默认跟随运行 DSH 的 Windows 用户的 HTTP(S) 默认浏览器，支持已安装的 Chrome / Edge，并使用隔离的插件 profile。插件内网页继续默认使用匹配的 Chromium。两种模式的浏览器设置独立保存；已保存网站的显式引擎和调用中的显式 `browser` 优先。系统默认不受支持或读取失败时明确报错，不静默改开 Edge；远程主机的默认浏览器不等于打开 DSH 网页的客户端默认浏览器。
- `steps` 推荐传动作数组，兼容单个动作字典、仅含 `steps` 数组的包装字典，以及这些形式的 JSON 字符串。`target` 推荐 `{kind,value,name?,frame?}` 定位字典，兼容 JSON 字符串定位字典、`css=#id`、`xpath=//button` 和普通 CSS / XPath 字符串。所有步骤在派发前归一化并校验，等价格式沿用同一 `requestId` 去重。
- 需要 Chromium 时，让 Agent 先调用 `remote_browser_runtime` 的 `action: "status"`；缺失时调用 `action: "install"`，再轮询 `status`，确认所需模式就绪后打开网页。安装使用当前插件锁定的 Playwright CLI，下载匹配的 Chromium 与 Headless Shell；设置中“安装 / 检查 Chromium”使用同一机制。下载需要网络，可在启动 DSH 前设置 `HTTPS_PROXY`、`PLAYWRIGHT_DOWNLOAD_HOST`、`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`。完整已有运行时复用，网站、流程和登录 profile 保留。
- `BROWSER_STEP_INVALID` 指明字段路径、正确格式和未派发状态。应纠正具体字段，不重复发送相同错误参数；校验失败未占用请求 ID。参数格式和恢复步骤见随包 `remote-ops-browser` skill。升级后停止旧 DSH、重新启动并刷新网页，在“设置 → 通用”确认当前版本。

## 工作区与交互

- 环境管理采用“分组导航 + 环境列表”：宽栏左侧选择分组，窄栏改用下拉框。SSH 行直接显示“进入 / 编辑 / 测试”，API 行直接显示“使用 / 编辑”；删除与新建独立 SSH 连接位于行尾“更多”。“批量管理”才显示选择框，删除前列出所选名称与地址，取消不修改配置，部分失败会保留失败项并显示原因。SSH 分组菜单支持重命名及删除空分组；API 分组在环境编辑表单中设置。左上角“返回工作区”保留原工作区内容。
- 顶部“终端 / 网页 / 文件 / API”标签支持方向键、Home/End；环境管理独立展开在插件内，“设置 → 通用”收纳诊断和刷新，更新位于“设置 → 更新”。左侧入口仍打开 DSH 原生右栏，不替换主对话。
- 当前模块、选中终端和环境筛选按 DSH 对话恢复，关闭再打开面板及网页刷新均可恢复。文件路径、排序、滚动及书签沿用原有存储；文件筛选、路径草稿和仍存在的选中项在同一网页内跨模块/面板切换保留，整页刷新后重新读取目录，不恢复旧选择。
- “设置 → 终端”统一管理字号、换行、高亮及当前 SSH 连接尺寸。终端标签旁可直接搜索和导出当前日志，“更多”提供独立命令和全部日志打包；路径与技术状态位于底部状态栏。普通日志使用快速解析，光标控制、Unicode 和全屏程序使用 VT 屏幕模型。
- 网页默认“跟随面板”视口，可选 1024×768“桌面视口”；调整视口不主动导航或重载页面，网站自身响应式行为仍可能改变内容。独立窗口使用其自身尺寸。标签显示网页标题，可关闭当前标签页；显示模式切换前提示重载及未提交内容丢失。
- 文件工作区增加目录筛选、全选、Shift 连续选择及 Enter 打开文件夹；窄面板用“来源 A / 目标 B”切换，复制按钮标明目标，已结束的传输记录折叠。上传/下载中的“本机”指当前浏览器设备，DSH 主机仍作为单独位置。
- 独立命令在后端运行，关闭结果视图、切换模块或刷新 DSH 网页不会取消；重新打开可读取当前目标的最近任务与结果。结果只保留于本次 DSH 进程内，最多 32 项、完成后最多 10 分钟；草稿正文仅在当前网页内保留。DSH 重启后不恢复、不自动重跑；超时或远端退出未知均不表示进程已结束。
- 分组输入、删除/覆盖确认使用插件内弹层；Tab 保持在弹层控件中，Esc 关闭并返回入口。弹层限于插件区域，主对话继续可用。环境校验和目录重试就近显示；诊断默认显示事件摘要，原始 JSON 可展开。

人和 Agent 共享网页与终端，可在对话期间同时操作。

## 共享网页操作

在“网页”模块直接输入网址并按 Enter，即可浏览，无需先保存网站。支持“插件内”实时交互画面和“独立窗口”，用户可配置；Agent 通过主对话操作当前网页。人和 Agent 共享同一页面，对话执行期间也可点击、滚动、输入和人工登录。

停止 Agent 使用 DSH 原生停止对话入口；网页后续步骤随对话取消，当前已发出的操作不会回滚。切换模块、收起右栏及刷新 DSH 页面不会取消后台网页任务。

支持 XPath/CSS/role/label/text/placeholder、iframe、弹出网页、可选登录配置与参数流程、结果检查和操作记录。密码使用本机 Harness 凭据服务，浏览器 profile 按对话和网站隔离。首次从“设置 → 网页”安装专用 Chromium，或选择本机 Edge / Chrome。独立窗口要求 DSH 与用户位于同一交互桌面；插件内模式在 DSH 网页中显示专用浏览器画面。切换显示方式会重新载入网页，保留登录 Cookie，未提交表单不会恢复。详见[网页操作指南](integrations/dsh-remote-ops/WEB.md)。

## 能力

- DSH Web 左侧底部 `Remote Ops` 入口打开原生右侧 Sidebar，主对话和草稿保持可见；重复点击复用已有标签页。左侧入口展开时图标与文字左对齐，缩进与宿主原生入口一致；收起时仅显示居中的图标和 Tooltip。
- 终端、网页、API、文件四个工作区标签，配合面板内环境管理和“设置 → 通用”。
- 环境分组、SSH 环境的创建、编辑、删除和持久化。
- 多 SSH 终端标签，终端始终作为主要工作区。
- 终端使用轻量 VT 屏幕模型处理 ConPTY 清屏、光标定位和回车覆盖；输出增量传输，完整滚动条可滚动到最后一行。
- 无 SSH 会话时默认进入本地 CMD，工作目录为 `$DSH_HOME/remote-ops`；可直接执行 `ssh` 等命令，SSH 断开后自动回退。
- Agent 与界面读取同一终端输出流；发送返回有界增量，可用 `streamId` 和游标续读，不因回显或静默重复发送。静默不等于命令完成。
- 终端显示连接、Agent 绑定及等待状态；阅读历史时保留位置，新输出可一键回到底部，SFTP 切换和窗口缩放保持滚动意图。
- 常用命令按钮位于终端下方，直接向当前终端下发；支持增删改查、分组、排序、隐藏按钮及按命令开启执行前确认。
- 常用命令窗格上边界可上下拖拽，不限两行，内部滚动且记住高度；检查更新和刷新均提供明确的进行中、成功或失败反馈。
- 多行命令一次性下发，不拆成大量短请求。
- SFTP 目录读取、文件读写、创建目录、删除和重命名。
- 环境连接复用/选择、逐个释放、断开后保留输出和显式重连；人工与 Agent 共享同一输入流，对话期间均可输入。
- 独立命令返回真实退出码、stdout/stderr 和耗时，不污染交互终端；工具回执仅表示实际返回过的输出范围。
- SFTP 双位置文件工作区、浏览器文件上传/下载、流式多选/目录传输、逐项结果与重试、覆盖预览、定位和路径偏好；脱敏诊断预览导出。
- 浏览器批量上传在同一浏览器页内跨终端、SFTP 和插件面板切换继续，返回可查看进度和取消；关闭/刷新整页、卸载插件或停止 DSH 可能中断，重新进入后可检查已完成文件并重新上传剩余文件。
- 目录刷新跳过历史完成任务，合并新完成任务并串行处理同一面板请求，保留列表、滚动位置及仍存在的选中项。
- 窄屏文件区使用来源/目标切换，历史传输折叠，保留可操作的文件列表高度。
- Multi-SSH 顺序协同工具、Agent 可读诊断和 Harness 凭据引用。
- “设置 → 通用”显示插件版本，“设置 → 更新”可手动从 GitHub 或 HTTP/HTTPS 检查并安装更新；任务结束后自动热加载生效。

## 安装

从 [最新稳定版](https://github.com/Ssshake1996/myterm/releases/latest) 下载插件包，然后执行：

```powershell
dsh plugin --profile web add .\dsh-remote-ops-v0.12.2.tgz
dsh web
```

CLI 安装须使用运行 DSH 的同一用户、`DSH_HOME` 和实际 profile。从旧版首次升级后重启一次，后续更新优先使用插件“设置 → 更新”。确认“当前运行”和“已安装”均为目标版本，才表示升级已经生效。

在 DSH Web 左侧底部点击 `Remote Ops` 打开右侧 Sidebar，主对话不被替换。已在 DSH `0.2.0-rc.2` 实测；其他宿主版本尚未实测。若未出现入口，先核对安装 profile、DSH 版本及已安装插件版本，并确认旧 DSH 进程已退出；无需手工复制 bundle patch。窄屏下右栏可能按宿主规则展开为全屏，收起即可返回原对话。

本地开发检查：

```powershell
npm --prefix integrations/dsh-remote-ops ci
npm --prefix integrations/dsh-remote-ops test
npm --prefix integrations/dsh-remote-ops run check
```

## 内网 HTTP/HTTPS 手动更新

当前版本为 [v0.12.2](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.12.2)。本版统一 SSH / API 环境管理布局，增加批量管理和终端标签左右滚动；详见 [发布说明](docs/releases/dsh-remote-ops-v0.12.2.md)。桌面能力、安装与热加载的验证范围见 [v0.12.0 验收记录](docs/testing/dsh-remote-ops-v0.12.0-acceptance.md)。

Remote Ops → **设置 → 更新**，选择并保存来源，点击 **仅检查版本** 或 **检查并更新**。默认来源为 GitHub Release，也可配置内网 HTTP/HTTPS 地址。检查由点击按钮触发，找到更高的稳定版本后可安装。窗口分别显示运行版本与已安装版本；安装完成后显示等待原因，任务结束后自动热加载；“新版已生效”与运行版本共同确认结果。

在 HTTP/HTTPS 服务上提供以下目录：

```text
remote-ops/
  latest.json
  dsh-remote-ops-v0.12.2.tgz
  SHA256SUMS-dsh-remote-ops-v0.12.2.txt
```

上传方先放入官方 tgz 和 SHA256，再运行随包脚本生成清单：

```sh
node integrations/dsh-remote-ops/scripts/create-update-manifest.mjs ./release/dsh-remote-ops-v0.12.2.tgz
```

已安装的包中脚本位于 `<plugin-root>/scripts/create-update-manifest.mjs`。可加第二个参数指定上级目录的 `latest.json`，从而把各版本保存在子目录；输出目录需已存在。脚本校验 SHA256、包名、版本和 bundle 后原子写入清单，拒绝覆盖更高版本。**先上传 tgz 和 SHA256，最后发布 latest.json**；将该目录发布到 HTTP/HTTPS 服务。GitHub Release 提供 tgz 和 SHA256 校验文件。

- HTTP/HTTPS：填写可直接读取的目录地址或 `latest.json` 地址。URL 使用协议、主机和路径，文件及重定向须保持同源；服务需允许 DSH 主机直接下载这些文件。内部 HTTPS 证书需由 DSH 的 Node 进程信任。
- 依赖使用 DSH 的 npm/pnpm 源、代理和构建批准配置；内网需有可访问的依赖源。Chromium 可按需安装。

更新包下载到 DSH 主机缓存，校验 SHA256 和包身份后，通过当前 profile 的 DSH 插件管理器安装。设置保存在 `$DSH_HOME/remote-ops/update-settings.json`，同一 DSH home 共享；安装作用于当前 profile。失败时可查看错误原因与宿主安装日志。热加载失败时保留旧运行实例并显示原因，可修正后重试应用，不重复安装同一版本。首次从旧版升级须重启一次；完整重启不会恢复内存中的任务、连接和记录。配置、清单生成与排错步骤见随包 `remote-ops-updates` skill。

## 目录

```text
integrations/dsh-remote-ops/
├─ lib/index.js       # 插件入口：apply 与对外导出
├─ lib/state/         # RemoteOpsState：按领域分层（环境、快捷命令、连接、终端读写、文件、更新…），入口 state/index.js
├─ lib/terminal-send.js     # 发送流程：预设、自动应答、输出渲染
├─ lib/terminal-script.js   # remote_terminal_script 多步骤执行
├─ lib/terminal-sessions.js # SSH/本地/宿主接管终端会话与 SendOperation
├─ lib/tools.js, routes.js  # Agent 工具注册与 HTTP 路由
├─ lib/cli-profile.js, cli-assist.js, output-render.js, ansi.js # 设备 CLI 辅助与输出渲染
├─ lib/client.js      # DSH Web 左侧入口与原生右侧 Sidebar
├─ cordis.patch.yml   # 官方 DSH bundle patch
└─ test/               # 单元、客户端行为、契约和烟测回归集
```

运行数据由插件独立保存到 `$DSH_HOME/remote-ops`：

```text
remote-ops/
├─ environments/<group>/environments.<group>.json
├─ quick-commands/<group>/commands.<group>.json
├─ browser/                 # 网站、流程、显示偏好及专用 profile
├─ api/environments.json    # API 环境和凭据引用
└─ update-settings.json     # 更新源配置
```

SSH 密码和私钥不写入 JSON；密码通过 Sidebar 表单保存到 Harness credentials，环境文件只保存引用。

## 发布

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/release-dsh-remote-ops.ps1 -Version 0.12.2
```

发布只有一份实现：`scripts/release-dsh-remote-ops.mjs`（Node，Windows/Linux/macOS 通用）。`scripts/release-dsh-remote-ops.ps1` 只是委托它的薄封装，`-SkipPublish` 对应 `--no-push`。

```sh
node scripts/release-dsh-remote-ops.mjs 0.12.2            # 校验、门禁、打包、提交、打 Tag、推送，并等待 Release 发布后核对包摘要
node scripts/release-dsh-remote-ops.mjs 0.12.2 --dry-run  # 只校验、跑门禁并打包，不动 git
```

选项：`--no-push`（只在本地提交和打 Tag）、`--no-wait`（推送后不等待 Release）、`--remote <name>`、`--branch <name>`、`--wait-minutes <n>`。GitHub Release 由推送 Tag 触发的 `.github/workflows/release.yml` 创建：它校验 Tag、`package.json` 版本和发布说明一致，执行完整门禁，打包并创建（或更新）Release，上传安装包与 SHA256 文件。脚本随后下载正式包，核对其实际 SHA256、校验文件及 GitHub 提供的摘要。

本地打包前，在 Windows 上运行 `powershell -File integrations/dsh-remote-ops/scripts/build-desktop.ps1` 构建桌面运行时；也可使用 CI 生成的运行时文件。发布工作流会在 Windows 上重新编译并验证，因此本地候选包和正式包的摘要可以不同。正式分发以 Release 中的 tgz 和配套 SHA256 为准。

上传完成后，发布流程分页读取正式 Release，按主版本、次版本、补丁版本的数值选择附件完整的最高版本，显式设为 Latest，并核对 `/releases/latest`。重跑旧版发布不会将最新版降回旧版；下载与更新使用 Latest 入口，不依赖列表位置或版本字符串排序。

发布脚本在改动 git 之前先校验所有版本载体（`package.json`、锁文件、`version.js`、`client.js` 默认值、发布说明标题、四份 README 的安装示例及根 README 的发布示例）一致，再执行一次完整回归门禁（包含语法检查、单元、客户端行为、契约和烟测），通过后才打包、提交、创建 Tag 并推送。根目录中英文 README 与插件目录一起纳入发布提交。测试矩阵和 3080 页面验收要求见 `docs/testing/dsh-remote-ops-test-plan.md`。

## 边界

- Agent Loop、Session、Goal、Skill、MCP、权限和本地工具完全由 DeepSeek Harness 负责。
- 本插件提供 SSH、交互式终端、Windows 桌面操作、SFTP、快捷命令、共享网页、RESTful API、执行记录、多 SSH 和远程诊断能力。

详细说明见 [插件中文说明](integrations/dsh-remote-ops/README.zh-CN.md)、[插件英文说明](integrations/dsh-remote-ops/README.md)、[开发经验记录](docs/development-experience.md)、[开发交接说明](docs/development-handoff.md) 和 [新对话 Prompt](docs/prompts/new-development-session.md)。

# @dsh/remote-ops

插件激活时不再把 `sidebarRight`、`sidebarRightTabs` 作为硬依赖。旧版或非 Web DSH 配置不会因为缺少这两个服务而阻塞启动；当右侧 Sidebar 服务可用时，插件会自动挂载界面。

独立的 DeepSeek Harness 远程运维插件，不依赖 myterm 桌面程序。

客户端兼容 DSH 0.2.0-rc.2 的 `Regular` 图标导出，并回退支持旧版按尺寸命名的图标。v0.2.23 修复图标导出变化导致的 Remote Ops 面板空白；启动失败提示改由 DSH `shell.overlay` 宿主插槽承载，不再向页面 body 创建全局浮层。

## 内网 HTTP/HTTPS 手动更新（v0.8.2）

Remote Ops → **更多设置 → 检查更新**，选择并保存来源，点击 **仅检查版本** 或 **检查并更新**。保留 GitHub Release 默认来源，内网更新仅支持 HTTP/HTTPS 地址。打开面板或更新对话框不会访问更新源，没有定时检查或自动重启。安装后显示运行版本与已安装版本，需完全重启 DSH 并刷新网页后生效；等待重启时不会重复安装。

在 HTTP/HTTPS 服务上提供以下目录：

```text
remote-ops/
  latest.json
  dsh-remote-ops-v0.8.2.tgz
  SHA256SUMS-dsh-remote-ops-v0.8.2.txt
```

上传方先放入官方 tgz 和 SHA256，再运行随包脚本生成清单：

```sh
node integrations/dsh-remote-ops/scripts/create-update-manifest.mjs ./release/dsh-remote-ops-v0.8.2.tgz
```

已安装的包中脚本位于 `<plugin-root>/scripts/create-update-manifest.mjs`。可加第二个参数指定上级目录的 `latest.json`，从而把各版本保存在子目录；输出目录需已存在。脚本校验 SHA256、包名、版本和 bundle 后原子写入清单，拒绝覆盖更高版本。**先上传 tgz 和 SHA256，最后发布 latest.json**；将该目录发布到 HTTP/HTTPS 服务。GitHub 仍只发布 tgz 和 SHA256。

- HTTP/HTTPS：填写目录地址或 `latest.json` 地址，文件及重定向限于同一来源。首版不支持地址内密码、查询令牌或自定义认证头。内部 HTTPS 证书需由 DSH 的 Node 进程信任。
- 依赖沿用 DSH 的 npm/pnpm 源、代理和构建批准配置；内网需有可用的依赖源。Chromium 仍按需安装，不在更新包中。

更新包下载至 DSH 主机缓存，校验 SHA256 和包身份后，通过当前 profile 的 DSH 插件管理器安装。校验失败不安装；旧版不自动降级；设置保存在 `$DSH_HOME/remote-ops/update-settings.json`，同一 DSH home 共享，安装只影响当前 profile。失败时显示原因和宿主安装日志入口；DSH 恢复 manifest/锁文件不等于清理全部依赖缓存。升级不主动关闭现有连接，运行中的任务不跨重启恢复。旧版电脑需先手动安装一次本版本。随包 `remote-ops-updates` skill 提供源配置、清单生成和排错说明，不修改 Agent。

## RESTful 环境与执行工作区（v0.8.0）

- 新增 **API** 工作区：保存环境的 Base URL、分组、公共请求头、超时、私有 CA 和登录配置。API 环境独立于 SSH，可选关联同一设备的 SSH 环境；已有 SSH 数据无需迁移。
- 支持一次 POST 账号密码登录，通过 JSON/form 提交，从响应 JSON Pointer 或响应头提取 Token，或保存符合域名、路径、Secure 和过期规则的 Cookie；支持 Cookie 到 CSRF 请求头的映射。密码写入 DSH 凭据服务，环境只保存引用。登录会话按对话隔离，仅保留于本次进程。
- 手动与 Agent 请求共享可见记录：登录、方法、路径、HTTP 状态、耗时、脱敏响应、错误及结果未知状态；可一键导出当前对话记录。HTTP 2xx 不代表业务操作成功，仍需检查响应中的业务结果。
- 随包新增 'remote-ops-api' skill 和 'remote_api_environment_list/save/delete'、'remote_api_login'、'remote_api_request'、'remote_api_records'。安装插件即由 DSH 发现，无需修改 Agent。先列环境、按返回 ID 登录和请求，再核对记录。
- Base URL 的路径前缀会保留；'/items' 和 'items' 均基于该前缀。请求由 DSH 主机发送，不自动跟随重定向，不自动登录重试或重放业务请求。超时/中断后无法确定结果时先查询设备状态。
- 配置持久化于 '$DSH_HOME/remote-ops/api/environments.json'；记录与去重仅覆盖当前对话、本次进程最近 100 次请求。响应预览最多 128 KiB，请求体最多 1 MiB。配置修改清除登录态，已发请求保持原目标；切换页签不取消请求。
- 首版不包含多步 SSO、验证码/MFA、自动刷新 Token、二进制下载与文件上传。凭据和已知认证值会脱敏，业务响应仍应按其实际数据敏感性处理。发布仍只有 tgz 和 SHA256。

## 本地 CMD 命令和目录配色（v0.7.2）

终端采用参考 [Catppuccin](https://catppuccin.com/palette/) 的 Latte / Mocha 配色，跟随 DSH 深浅主题：命令紫色、目录青色、文件蓝色，浅色强调色适当加深以保证文字对比度。插件外围继续使用宿主样式。

默认本地 CMD 中，用户手动输入、Agent 完整命令及原始按键方式输入的命令，在实际回显后统一使用强调色、字重和淡背景。识别在终端光标重绘之后进行，编辑、退格和历史回显可保持可读；不会为了着色额外执行命令或显示隐藏输入。

标准 `dir` 列表的目录名使用青绿色、文件名使用蓝色，日期、大小和统计信息保留原样；原有 ANSI 颜色继续保留。支持常见 CMD、PowerShell 和带 `user@host` 的 Shell 提示符。自定义提示符、`dir /b` 等缺少类型信息的格式不猜测分类。全屏程序不添加这些语义颜色，“终端显示设置”可统一关闭；复制、搜索和日志导出的文字不因配色改变。安装后即可生效，不需要修改 Agent 或命令。

## 环境密码按需查看（v0.7.1）

环境编辑页的 SSH 密码旁新增眼睛按钮。默认遮蔽，点击后读取当前生效的已保存密码；再次点击隐藏，关闭编辑页或抽屉后清除读取结果。新输入的密码也可显示核对。

仅查看不会修改密码，查看后保存其他字段仍保留原凭据；输入新密码才会更新。未配置、凭据缺失或服务不可用时会明确提示，并可重试或重新输入。明文不写入浏览器持久存储、环境列表、诊断记录或 Agent 工具返回值；不新增 Agent 密码读取工具，不修改 Agent。随包环境管理 skill 已补充用户查看路径。

## 终端高亮与日志接口（v0.7.0）

- Agent 提交后实际回显的单行命令使用强调色，普通回显保留常见 ANSI 配色；错误、警告及成功前缀适度高亮。“终端显示设置”可关闭语义高亮。显示处理不改变发给设备的字节；隐藏输入不会被补写进终端；v0.7.2 补充了常见提示符后的手动与原始按键回显高亮。关键词颜色不代表已验证执行成功，全屏程序不添加语义高亮。
- 终端工具栏“导出终端日志”支持当前终端 UTF-8 TXT，以及本会话全部日志 ZIP；包含仍保留的已关闭 SSH 记录和共享本地终端。ZIP 每个终端一个文件，附 `manifest.json` 标明来源、时间和保留范围。
- 新增 `remote_terminal_logs`、`remote_terminal_log_read`、`remote_terminal_log_export`。Agent 可列出日志、按原始游标分页读取，再直接调用插件打包接口获得下载链接和 SHA256；打包不需要先读完日志或在终端执行压缩命令。Web 对话返回当前已验证 DSH 地址的完整下载链接；无法获得浏览器地址时仍可从终端工具栏导出，不猜测地址。
- 随包 `remote-ops-terminal-logs` skill 由 DSH 原生服务自动发现，也可用 `/remote-ops-terminal-logs` 加载。安装同一 tgz 即包含接口和指南，不修改 Agent 或用户 skill 文件。
- 日志仅保留于本次 DSH 进程：每个终端最多 4 MiB，超限保留末尾 3 MiB；已关闭记录共享 16 MiB / 32 条上限。接口显式返回截断及淘汰情况，重启后不恢复。只采集设备回显，不额外记录隐藏输入；程序主动打印的敏感内容仍可能包含在日志中。
- 单包最多 32 条记录 / 32 MiB 原始输出；下载缓存最多 10 包 / 32 MiB，链接有效期最长一小时，缓存淘汰或重启会提前失效。导出冻结当前记录；后续输出需重新导出。终端文本保留进度刷新内容，不等于全屏界面录像；独立命令和网页操作记录不在此接口范围。

## Agent 环境管理补齐（v0.6.1）

新增 `remote_environment_update`，补齐 Agent 对 SSH 环境的增删改查。随包 `remote-ops-environments` skill 说明目标选择、更新、分组、凭据和已有连接行为，与 `remote-ops-browser` 一起通过 DSH 原生 skill 服务自动注册；支持自动发现和 `/remote-ops-environments` 调用，用户/项目 skill 优先级保持更高，卸载后移除注册。不修改 Agent 或 DSH 内核，不写入用户 skill 文件。Release 仍只包含 tgz 和 SHA256。

## 界面与交互更新（v0.6.0）

- 终端、网页、文件及环境、快捷命令、诊断采用统一的字号、间距、控件和深浅色层次。顶部保留工作区标签，版本、更新、诊断和“界面密度”收进“更多设置”；舒适/紧凑密度在本浏览器中保存。
- 终端的目标与工具集中在同一栏，只有多个会话时才显示会话条；输入、搜索、独立命令和快捷命令保持可用。
- 网页以地址和实时画面为主。“网页设置”收纳引擎、Chromium 安装、收藏网站与流程；“操作记录”按需打开；画面底部“画面设置”调整视口。关闭设置保留网址草稿和当前网页。
- 已打开网页切换“插件内 / 独立窗口”时先确认，取消不会派发切换；确认后会重载页面，未提交表单可能丢失。执行中禁止重复切换。
- 文件列表选中项目后才显示复制、删除等操作；上传入口与其他按钮统一，浏览器上传展示字节进度。切换模块保留选择、草稿与后台任务，目录完成刷新继续合并。

左侧入口继续打开 DSH 原生右栏；人和 Agent 共享输入，停止对话使用 DSH 原生入口。仅发布 tgz 与 SHA256 校验文件，Chromium 按需联网安装，不修改 Agent。

## 浏览器参数与按需安装（v0.5.4）

后续 Release 只提供插件 `tgz` 和对应 `SHA256SUMS`，不再生成 `windows-x64.zip`；历史 v0.5.3 资产继续保留。插件不携带浏览器二进制，需要联网安装 npm 依赖；Chromium 可在需要时由 Agent 调用插件工具安装。

- 独立窗口默认跟随运行 DSH 的 Windows 用户的 HTTP(S) 默认浏览器，支持已安装的 Chrome / Edge，并使用隔离的插件 profile。插件内网页继续默认使用匹配的 Chromium。两种模式的浏览器设置独立保存，旧版插件内引擎设置保留；已保存网站的显式引擎和调用中的显式 `browser` 优先。系统默认不受支持或读取失败时明确报错，不静默改开 Edge；远程主机的默认浏览器不等于打开 DSH 网页的客户端默认浏览器。
- `steps` 推荐传动作数组，兼容单个动作字典、仅含 `steps` 数组的包装字典，以及这些形式的 JSON 字符串。`target` 推荐 `{kind,value,name?,frame?}` 定位字典，兼容 JSON 字符串定位字典、`css=#id`、`xpath=//button` 和普通 CSS / XPath 字符串。所有步骤在派发前归一化并校验，等价格式沿用同一 `requestId` 去重；不猜测缺失目标、不执行任意 JavaScript。
- 需要 Chromium 时，让 Agent 先调用 `remote_browser_runtime` 的 `action: "status"`；缺失时调用 `action: "install"`，再轮询 `status`，确认所需模式就绪后打开网页。安装使用当前插件锁定的 Playwright CLI，下载匹配的 Chromium 与 Headless Shell；设置中“安装 / 检查 Chromium”使用同一机制。下载需要网络，可在启动 DSH 前设置 `HTTPS_PROXY`、`PLAYWRIGHT_DOWNLOAD_HOST`、`PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`。完整已有运行时复用，网站、流程和登录 profile 保留。
- `BROWSER_STEP_INVALID` 指明字段路径、正确格式和未派发状态。应纠正具体字段，不重复发送相同错误参数；校验失败未占用请求 ID。修复、Schema、工具说明及随包 skill 随 tgz 分发，不修改 Agent 或 DSH 内核。升级后停止旧 DSH、重新启动并刷新网页，在“更多设置”确认当前版本。

## 参数 Schema 与空值兼容（v0.5.2）

本版本修复插件工具参数未转换为标准 JSON Schema，以及网页步骤可选空值导致 `BROWSER_STEP_INVALID` 的问题。工具定义、运行时校验及随包 `remote-ops-browser` skill 一起更新，所有改动随 tgz 分发，不需要修改 Agent 或 DSH 内核。

- 插件全部工具按 DSH 契约提供标准参数 Schema；网页动作和定位器有枚举，按动作声明必填字段。`goto` 需要 `url`，其他步骤需要结构化 `target`，包括 `read`；整页观察可直接使用 `remote_browser_read`。
- 网页可选字段的 `null` 按未提供处理；`target.frame` 为空白时使用主页面。清空输入所需的 `value: ""` 保留；`fill`、`press`、`select` 缺少实际值仍会拒绝，密码继续只使用保存网站的引用。
- 错误指出字段路径，如 `steps[1].target.frame`；整次步骤先完成校验再派发，第二步无效也不会执行第一步。空值与省略归一化后使用同一请求仍去重，不自动重试或猜测定位器。
- 门禁新增完整 Schema 校验；真实 DSH 验收检查实际模型请求中的工具定义和页面执行结果。升级后停止旧 DSH 进程、重启并刷新网页，在“更多设置”确认当前版本；随包 skill 自动注册，无需手工复制。

## 网页操作参数修复（v0.5.1）

本版本修复 Agent 调用网页操作时，空 `flowId` 覆盖有效 `steps`、持续出现 `BROWSER_FLOW_NOT_FOUND` 的问题。修复、校验、工具说明和 `remote-ops-browser` skill 都随插件 tgz 分发，**不需要修改 Agent、DSH 内核或另行复制 skill**。

- 普通网页操作传 `steps` 数组并省略 `flowId`；为兼容空值，`null`、空字符串和空白字符串均按未提供流程 ID 处理。
- 保存流程只使用列表返回的真实 `flow.id`，且 `flow.siteId` 必须等于目标浏览器的 `siteId`。非空 `flowId` 与非空 `steps` 同时提供会被拒绝；保存流程可省略 `steps` 或传空数组。
- 参数冲突、未提供操作、步骤格式错误、流程不存在、流程网站不匹配分别返回具体错误与恢复办法。这些参数校验在动作派发前失败，不会自动重试、改选浏览器或放宽凭据域名限制。
- 插件加载后通过 DSH 原生 skill 服务全局提供 `remote-ops-browser` 指南，Agent 可自动发现并加载，也可在对话中用 `/remote-ops-browser` 调用；卸载插件后移除注册，不写入或覆盖用户的全局 skill 文件。此机制已验证于 DSH 0.2.0-rc.2。
- 升级后完全停止旧 DSH 进程，重新启动并刷新网页，使已安装插件、skill 和工具说明重新加载。无需迁移 Agent 配置；另一台内网电脑只需安装同一 tgz。

## 工作区与交互（v0.5.0）

- 顶部“终端 / 网页 / 文件”标签支持方向键、Home/End；环境管理独立展开在插件内，“更多设置”收纳诊断、刷新及更新。左侧入口仍打开 DSH 原生右栏，不替换主对话。
- 当前模块、选中终端和环境筛选按 DSH 对话恢复，关闭再打开面板及网页刷新均可恢复。文件路径、排序、滚动及书签沿用原有存储；文件筛选、路径草稿和仍存在的选中项在同一网页内跨模块/面板切换保留，整页刷新后重新读取目录，不恢复旧选择。
- 终端字号、换行和 PTY 大小收进“终端显示设置”，Agent 绑定、工具读取回执等收进“状态详情”。普通 ASCII/SGR 日志使用快速解析，光标控制、Unicode 和全屏程序仍使用 VT 屏幕模型。
- 网页默认“跟随面板”视口，可选 1024×768“桌面视口”；调整视口不主动导航或重载页面，网站自身响应式行为仍可能改变内容。独立窗口使用其自身尺寸。标签显示网页标题，可关闭当前标签页；显示模式切换前提示重载及未提交内容丢失。
- 文件工作区增加目录筛选、全选、Shift 连续选择及 Enter 打开文件夹；窄面板用“来源 A / 目标 B”切换，复制按钮标明目标，已结束的传输记录折叠。上传/下载中的“本机”指当前浏览器设备，DSH 主机仍作为单独位置。
- 独立命令在后端运行，关闭结果视图、切换模块或刷新 DSH 网页不会取消；重新打开可读取当前目标的最近任务与结果。结果只保留于本次 DSH 进程内，最多 32 项、完成后最多 10 分钟；草稿正文仅在当前网页内保留。DSH 重启后不恢复、不自动重跑；超时或远端退出未知均不表示进程已结束。
- 分组输入、删除/覆盖确认使用插件内弹层；Tab 保持在弹层控件中，Esc 关闭并返回入口。弹层限于插件区域，主对话继续可用。环境校验和目录重试就近显示；诊断默认显示事件摘要，原始 JSON 可展开。

人和 Agent 始终共享网页与终端；没有新增接管、暂停、停止按钮或对应工具。SSH 参数空格问题不在本版本修复范围。

## 共享网页操作（v0.5.0）

在“网页”模块直接输入网址并按 Enter，即可浏览，无需先保存网站。支持“插件内”实时交互画面和“独立窗口”，用户可配置；Agent 通过主对话操作当前网页。人和 Agent 共享同一页面，对话执行期间也可点击、滚动、输入和人工登录，不需要接管或交还。

网页与终端面板不保留接管、暂停、停止按钮，也不增加对应 Agent 工具。停止 Agent 使用 DSH 原生停止对话入口；网页后续步骤随对话取消，当前已发出的操作不会回滚。切换模块、收起右栏及刷新 DSH 页面不会取消后台网页任务。

支持 XPath/CSS/role/label/text/placeholder、iframe、弹出网页、可选登录配置与参数流程、结果检查和操作记录。密码使用本机 Harness 凭据服务，浏览器 profile 按对话和网站隔离。首次从“网页设置”安装专用 Chromium，或选择本机 Edge / Chrome。独立窗口要求 DSH 与用户位于同一交互桌面；插件内模式在 DSH 网页中显示专用浏览器画面。切换显示方式会重新载入网页，保留登录 Cookie，未提交表单不会恢复。详见[网页操作使用说明与边界](WEB.md)。

## 能力

- 按分组保存环境，文件位于 `remote-ops/environments/<分组>/environments.<分组>.json`。
- 运维工作区使用“终端 / 网页 / 文件”标签、面板内环境管理和终端下方快捷命令区。
- 环境和快捷命令都支持手动创建、编辑、删除和分组管理；删除非空分组会被拒绝。
- 使用 `ctx.terminals` 管理按 Agent 隔离的 SSH 会话。
- 支持完整命令下发、直接终端键盘输入和信号控制；终端支持 Tab 补齐、方向键、退格、Enter、Ctrl+C 等按键。
- 插件启动后默认提供本地 CMD，工作目录为 `$DSH_HOME/remote-ops`；可直接运行 `ssh`、网络检查及其他本地命令，不要求先初始化 Agent。
- 保存环境建立的 SSH 会话断开后自动回到本地 CMD；本地 CMD 中启动的 `ssh` 退出后自然返回同一提示符。
- 终端会请求 UTF-8 locale，界面保留常见 ANSI 配色并处理 VT 控制序列；环境字节流支持 UTF-8、GB18030、Big5 等编码配置。
- 前端使用轻量 VT 屏幕模型还原 ConPTY 清屏、光标定位、行覆盖和滚屏，避免屏幕快照产生大段空白；终端高度严格受容器约束，纵向滚动条始终完整可用。
- 终端输出通过游标增量和长轮询传输，键盘输入串行合并发送；空闲时不再反复传输完整状态或持续产生高频终端请求。
- 支持多个目标顺序协同执行，并返回每个目标的结果。
- 支持 SFTP 列目录、读写、创建目录、删除和重命名。
- 支持快捷命令保存和执行。
- 提供 Agent 可读取的诊断事件，以及 DSH 右侧 Sidebar。
- DSH Web 左侧底部 `Remote Ops` 入口打开原生右侧 Sidebar，保留主对话与草稿；重复点击复用已有标签页，收起右栏即可返回对话。左侧入口展开时图标与文字左对齐，缩进与宿主原生入口一致；收起时仅显示居中的图标和 Tooltip。
- “更多设置 → 检查更新”支持 GitHub 或 HTTP/HTTPS 更新源；手动检查并安装，显示运行版本和已安装版本，安装后需重启 DSH 并刷新网页。
- 快捷命令区域上边界可拖拽调整高度，双击恢复默认高度；环境表单不展示内部 Harness 凭据引用，密码由系统自动管理。
- 连接错误会保留在界面中，直到用户手动关闭，避免错误提示快速消失。
- 环境表单单独提供 SSH 密码输入框；密码通过 `credentials.set` 写入 Harness credentials，环境 JSON 只保存引用，不保存明文。

## 安装

使用 DSH 官方插件管理器安装 release 压缩包。包内的 `dsh.bundle.patch` 声明会自动把插件加入 profile，不需要手工复制 patch。

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.8.2.tgz
dsh web
```

升级时，在运行 DSH 的同一用户和 `DSH_HOME` 下安装，并把 `--profile web` 改为实际使用的 profile。安装后完全停止旧 DSH 进程，重新启动并刷新浏览器，确认 Remote Ops“更多设置”显示 `v0.8.2`。环境、快捷命令、网站和流程保留；终端与浏览器需重新打开，运行中的任务不跨 DSH 重启恢复。

如果使用已经发布到 registry 的包，则包名为：

```sh
dsh plugin --profile web add @dsh/remote-ops
```

本仓库以 GitHub Release 压缩包作为标准交付物；本地源码也可以先执行 `npm pack`，再用同样的命令安装。

插件是纯 DeepSeek Harness 插件，仓库不再包含 myterm 桌面程序。

SSH PTY 遵循 Harness 约定，只在进程内存中存在；环境定义会持久化，DSH 重启后按需重新打开连接。

DSH Web 启动后，点击左侧底部 `Remote Ops` 打开原生右侧 Sidebar。入口通过官方 `sidebar.footer.action` 调用 `sidebarRight.openTab`，不再注册替换主对话的 `sidebar.panellist` / `main`。技术包名、右侧 tab ID、环境数据与工具名称保持兼容。入口有界重试并在卸载时清理定时器；SSH 和 SFTP 操作仍归属对应 Harness 会话。

已在 DSH `0.2.0-rc.2` 实测；其他宿主版本尚未实测。若看不到入口，核对插件版本、DSH 版本和安装 profile，确认旧进程已退出。窄屏下 DSH 可能按原生布局将右栏展开为全屏，收起后返回原对话。

## 输入协作与文件传输

- 人工与 Agent 共享终端输入，不锁定输入权；对话执行期间可以直接输入，无需接管或交还。键盘写入按请求顺序发送，多个输入来源仍可能改变同一命令行。
- 使用 DSH 原生停止对话结束 Agent；正在等待的终端发送收到取消信号时会尝试 Ctrl+C。已经返回或远程后台运行的进程可能继续，不能把停止对话当成进程退出证明。终端仍支持直接键盘 Ctrl+C，“释放”关闭指定 SSH 连接。
- SFTP 两侧独立选择 DSH 所在主机或 SSH 环境，可多选文件、递归复制目录；浏览器上传/下载指向当前浏览器设备，和 DSH 主机不是同一个概念。SSH 到 SSH 由 DSH 中转。
- 浏览器批量上传由插件持有，切换终端、SFTP 或离开再返回 Remote Ops 不会中止已开始的上传；标题中的上传按钮可返回查看进度和取消。任务固定使用开始时的 Harness 会话、目标路径和冲突策略，切换会话不会转移任务或取消权限。覆盖预览在批次开始前逐项确认；确认过程中离开文件页不会开始上传。
- 取消上传会中止当前浏览器请求并停止批次剩余文件；取消/失败信息在返回后仍可见。取消不是回滚：服务端已接收的当前文件可能已经完成，已完成文件保留。关闭或刷新整个浏览器页会提示仍有上传，继续离开、卸载插件或停止 DSH 可能中断；上传不跨页面刷新恢复，不提供字节级断点续传。
- 首次读取传输历史只建立基线；新完成任务每轮按面板合并刷新，正在读取的目录只排一次后续刷新。刷新保留已有列表、滚动位置和仍存在的选中项，进入不同目录仍清空旧选择。
- 窄屏通过“来源 A / 目标 B”切换位置；完成历史折叠，文件列表保留可用高度。
- 文件传输使用流和背压，不再有 2 MiB 上传/下载限制。任务显示实际字节数、文件数、结果和取消；同名文件默认报错，可显式选择跳过/覆盖。工具的覆盖参数为 `overwrite: true`，默认不覆盖。
- 同时最多 2 个传输任务，最多 20 个排队/运行任务，最近最多 50 条任务记录；不跨 DSH 重启恢复。取消清理未完成暂存文件，但已经完成的文件和目录不会回滚。符号链接和设备文件不递归跟随；目录限制深度 32、条目 10,000。覆盖已有远端文件需要服务端支持原子 rename 扩展。
- 错误保留阶段、代码、原始消息与 cause 堆栈。诊断导出先预览，采用元数据白名单，不导出凭据、命令正文、主机地址或终端内容。

## Agent 管理 SSH 环境

- 查询：`remote_environment_list`；新增：`remote_environment_create`；修改：`remote_environment_update`；删除：`remote_environment_delete`。v0.6.0 及以前未明确提供修改工具，旧英文 README 将其列入 Agent 工具的描述不准确。
- 先查询列表，修改/删除优先使用返回的内部 `id`。新增必填 `host`、`username`，ID 自动生成，省略名称时使用主机地址。分组使用 `remote_environment_group_create/rename/delete`；只能删除空分组。
- 修改示例，参数传给 `remote_environment_update`：

```json
{"environment":"列表返回的实际ID","name":"生产存储","group":"生产环境"}
```

可修改 `name`、`host`、`username`、`group`、`port`、`privateKeyPath`、`passwordRef`、`encoding`、`cliProfile`、`terminal`。内部 ID 不变，省略或传 null 的字段保持原值；没有任何非 null 修改时拒绝。名称、地址、用户、分组必须是非空字符串，端口为 1–65535 整数。重名、非法嵌套设置、未声明字段和凭据显示标记 `configured` 在写入前拒绝。精确 ID 优先于相同的显示名称。

提供 `cliProfile` 或 `terminal` 时替换整个对应区块，`{}` 重置该区块为默认值。`passwordRef`、`privateKeyPath` 传空字符串可清除该项，但不会删除凭据本体或密钥文件。工具不接收明文密码，新密码可在环境表单中输入并交给宿主凭据服务保存。列表中的 `passwordRef: "configured"` 仅表示已配置，保留认证时应省略该字段。

修改配置不会断开、重连或切换现有 SSH 连接；已有连接继续使用打开时的名称、地址、认证及 CLI/终端预设，新配置用于新建连接。`saved: true` 仅代表保存成功，不代表连通性通过。删除环境会移除保存定义并关闭当前调用对话拥有的连接，不关闭其他对话已打开的连接。迁移分组会自动创建不存在的目标分组，原分组保留。

## Agent 与终端同步

- v0.2.21 回退连接固定编号/备注，恢复环境名称展示，仍按 sessionId 选择和释放具体连接。断线保留最后输出，明确重连，不重放命令；重建的输出流需确认后才能继续输入。
- 回退浏览器窗口级输入锁和跨窗口接管，人工与 Agent 共享输入。多个来源同时输入可能交错。工具回执仅表示返回了哪个范围、何时返回及之后是否有新输出，不代表模型理解了输出；回执不跨宿主重启持久化。
- SFTP 按 Harness 会话记忆两侧位置、路径、排序、滚动及最多 30 个书签。传输逐项展示完成/失败/待处理；重试跳过已完成项，覆盖前预览双方大小和修改时间，不跨重启续传。
- `remote_command_execute` 和“独立命令”入口不向 PTY 打字，返回实际退出码、stdout、stderr、耗时与截断标记。不继承交互终端目录/临时变量，不提供 stdin；本地工作目录为插件目录，SSH 为服务默认目录。
- 独立执行默认 30 秒、最长 300 秒；每路输出默认 64 KiB、最大 256 KiB；每目标最多一个、总计最多八个活动命令。取消/超时不等于远程进程已经终止。
- 终端新增备用屏、滚动区域和字符集转义处理，全屏表格不软换行。当前宿主本地 PTY 无运行时 resize API，仍为固定 160x40，不承诺完整 xterm 兼容；真实 OS 输入法仍需对应设备验收。

- `remote_terminal_send/read/signal` 都支持 `session: "local-cmd"`，指向插件内共享的本地 CMD，不是 Harness 内置 bash/pwsh。SSH 应优先复用环境列表中的明确 sessionId；按环境发送时复用唯一连接，多连接时要求明确指定。
- 发送等待新输出，默认只返回最多 16,384 个 UTF-16 码元的增量（不拆分代理对），不再重复附带旧 viewport；需要最近历史时显式传 `includeViewport: true`。
- 续读使用 `remote_terminal_read`，传入 `session`、上次的 `nextOffset` 作为 `cursor`、`streamId` 和 `waitMs: 20000`。`hasMore` 为 true 时继续读完，不要通过重发命令获取输出。
- 省略游标读取最近历史；显式 `offset/count` 按行向前翻阅。`reset/truncated` 表示流已替换或历史已过期，不能假定遗漏部分不存在。
- 工具返回原始终端流，包括控制序列；界面在同一流之上进行 VT 渲染，不承诺返回的文本就是渲染后的屏幕。
- `inferred_idle`、等待超时、PTY 的 running 状态都不能证明命令完成或成功，因此返回 `completion: "unknown"`；依赖前一条结果的命令必须先观察实际输出。取消正在等待的发送会尝试中断前台进程，不能据此断言远程进程已退出；等待超时本身不会杀进程。
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

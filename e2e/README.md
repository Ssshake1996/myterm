# Remote Ops 浏览器测试

## 顶部布局与终端对比度

`node e2e/runner/index.mjs --grep header-layout` 检查两行导航、各工作区环境入口、返回焦点和深浅主题 ANSI 对比度。`terminal-tabs-native.mjs <tgz>` 在真实 DSH 中运行同样的检查，通过本地 CMD 调用 PowerShell 输出标准色、256 色、真彩色及默认前景样例，再验证 12 个 SSH 标签与环境管理。原始文本、背景颜色、关闭保护和当前对话内容均需保留。

## 本地 CMD、PowerShell 和 WSL

Windows 主机设置 `DSH_CLI` 为宿主的 `lib/bin.js`，执行 `node e2e/runner/local-terminal-native.mjs <tgz>`。测试主机需有 CMD、Windows PowerShell 5.1、PowerShell 7；设置 `LOCAL_WSL_DISTRIBUTION` 指定允许执行测试命令的已安装 WSL 发行版。不设置时明确记录 WSL 未验收，不自动安装发行版。`LOCAL_SHELL_OUTPUT` 可指定新的独立证据目录。

脚本在隔离 DSH_HOME 安装候选包，真实启动本地 Shell，验证单终端启动、GUI 按需新建、Agent 加载随包 skill 并复用会话、中文及空格路径、真实退出码、输入隔离、退出重开、日志 ZIP 下载、默认配置重启与窄栏。WSL 在 `/tmp/dsh-remote-ops-0160.txt` 写入固定测试内容。热加载脚本同时检查额外本地终端的 sessionId 和输出流保持，并在新运行版本中继续下发命令。

## SSH 私钥口令

在 Windows 上将 `DSH_CLI` 指向宿主的 `lib/bin.js`，再运行 `node e2e/runner/environment-password-native.mjs <tgz>`。可用 `PASSWORD_OUTPUT` 指定一个新的验收目录。脚本在独立 DSH 配置中安装该包，通过 Chrome 操作环境表单和 DSH 工具。两个仅接受公钥的本地 SSH 服务分别验证未加密、已加密 Ed25519 私钥的签名。验收还会重启宿主，检查留空、错误口令、清除和补录。结果和签名次数写入 `evidence.json`，表单截图为 `ssh-key-form.png`。测试结束后移除生成的私钥。

## 嵌入网页的视口与滚动条

设置 `DSH_CLI` 为宿主的 `lib/bin.js`，执行 `node e2e/runner/browser-recording-native.mjs <tgz>`。脚本将候选包安装进独立的 DSH 配置，使用本地 HTTP 测试页。可用 `RECORDING_NATIVE_OUTPUT` 指定证据目录。

- 默认自动适配：首次加载即至少 1280 CSS 像素。测试 1027×768、390×640、640×480 和 1440×900 面板，完整画面等比显示，逻辑视口保持稳定，四角按钮可达，位置标示可见。重载宿主后显示设置保留。
- 手动选择原始大小，用真实宿主窗口调出 1027×768 的网页可视区，打开最低宽度 1280 的测试页。画面以 1280 CSS 像素显示，底部滚动条占用的空间从可用高度扣除。拖到最右端时偏移为 253 像素。点击右上按钮，网页结果及录制中的元素和坐标均需匹配；Agent 点击时外层画面应自动跟随。
- 在设置中为网址保存最低宽度，打开仅在初次加载时判定宽度的页面，检查初始宽度和控件可用性。清空并保存后，再次打开要恢复面板宽度。
- 手动选择跟随面板适应后，测试持续拖动分栏、定宽页面、跨域内嵌表单、四角命中和切换标签。记录宿主版本、安装包 SHA256、画面尺寸及点击结果到 `evidence.json` 和 `panel-layout.json`。

`npm run test:browser:adaptive --prefix integrations/dsh-remote-ops` 使用真实浏览器检查首次视口、稳定宽度学习、跨进程恢复、待处理视口与 MCP 坐标、跨域 iframe 操作位置，以及不增加录制步骤。`browser-mcp-native.mjs <tgz>` 在真实 DSH Agent 取得图片后拖动宿主侧栏，再用同一观察执行坐标点击。

## 真实 DSH 热加载验收

Windows 主机可运行 `node e2e/runner/hot-reload-native.mjs <tgz>`，设置 `DSH_CLI` 为待验收 DSH 的 `lib/bin.js`，并先安装插件与 `e2e` 的依赖。升级回归需分别覆盖 0.2.0-rc.2、0.2.1-rc.2 与 0.2.1-rc.5。可用 `HOT_RELOAD_OUTPUT` 指定证据目录，`NPM_CLI` 覆盖 npm 的 `bin/npm-cli.js` 路径；设置 `BOOTSTRAP_PACKAGE` 为旧版正式 tgz，可验证先通过 DSH CLI 迁移到修复版，再执行后续热加载。

测试安装传入包到独立 `DSH_HOME`，使用真实 DSH、Chrome、确定性模型和本地 SSH/网页/API 服务；从真实更新按钮提交，临时合成后续版本以验证等待任务结束、前后端同步生效、连接与记录保留、同进程第二次升级及启动失败恢复，并注入短暂 404 与状态读取失败以验证恢复时不重复安装。回退后先等待原对话重新绑定，再核验同一 SSH ID 和连接次数；不会自动重连掩盖连接丢失。合成版本仅为测试夹具，不会发布。证据包含版本、包 SHA256、原生 Agent 工具结果检查与截图；不代表连接用户的生产设备。Windows Server CI 同时运行此验收。

## 浏览器回归（隔离插件后端）

以下 `npm run e2e` 在真实 Chrome 里跑生产 `client.js`。后端是生产插件，SSH 连到进程内的假设备。它不启动完整的 DSH 宿主，所以不覆盖宿主登录、工作区选择和侧栏服务本身；上面的原生验收单独覆盖宿主集成。

## 运行

终端标签滚动的原生宿主验收：设置 `DSH_CLI` 为本机 DSH 的 `lib/bin.js`，运行 `node e2e/runner/terminal-tabs-native.mjs <tgz>`。可用 `TERMINAL_TABS_OUTPUT` 指定证据目录。该脚本把候选包安装到独立 `DSH_HOME`，在真实 DSH / Chrome 中连接 12 个本地 SSH 测试环境，验证左右滚动、后台刷新、窄屏、关闭和对话隔离；输出截图与 `evidence.json`。SSH 设备为脚本化测试服务，不代表生产设备验收。

```sh
npm ci --prefix integrations/dsh-remote-ops
npm ci --prefix e2e
npm test --prefix e2e
npm run e2e --prefix e2e
```

只跑一个场景：

```sh
npm run e2e --prefix e2e -- --grep 窄屏
```

需要本机的 Google Chrome。报告写到 `output/e2e/<时间>/`，包含 `report.html`、`report.md`、`report.json`、`junit.xml` 和每个关键步骤的截图。`report.html` 把截图内嵌进去，可以直接打开。

每个场景使用独立的数据目录和假设备。步骤结束、失败和明确调用截图时都会留下画面。控制台异常和 `/favicon.ico` 以外的 HTTP 错误会让场景失败。

## 场景

- SSH/API 环境分组导航、常用操作与更多菜单、键盘展开和 Esc 返回、编辑取消保留筛选、删除空分组、批量确认与取消、API 使用后保留请求草稿、390px 分组下拉框。`terminal-tabs-native.mjs` 同时在安装候选包的真实 DSH 中运行这些操作。
- 浏览器批量上传跨终端/运维面板卸载继续，下载回读内容一致（生产插件后端和本地文件系统，上传文件写入场景的独立临时目录）
- 历史传输不重复刷新，新完成任务合并刷新并保留选中和滚动（真实客户端，受控目录/任务 API 响应）
- 窄屏且传输历史较多时，两侧文件列表保留可用高度，目标 B 可滚动访问（受约束的 334px 面板与受控 API）
- 打开面板并在本地终端回显
- 多终端标签溢出时仅通过左右按钮遍历全部标签，后台输出不拉回滚动位置；覆盖边界置灰、Home/End、连续点击、390px 窄屏、关闭后定位与箭头隐藏
- 设备 `(y/n)` 不会被自动回答
- 调整 SSH 终端大小，掉线后提示重连且不重放命令
- Agent 与界面读取同一终端输出；执行期间人工输入可用，原生对话取消信号结束发送等待
- 输入网址直接打开插件内实时网页；Agent 与人工共享点击/中文输入、取消阻止后续步骤、空白标签与键盘切换、模式切换和刷新恢复
- 可选登录配置与参数流程、XPath 唯一定位、iframe/原生弹窗/popup、Cookie 保留与显示偏好
- 长输出滚到末行，上移阅读时不被新输出抢走
- Agent/人工命令回显与 `dir` 文件/目录配色、深浅主题文字对比度、关键前缀高亮、日志分页读取、TXT/ZIP 实际下载及窄屏导出
- 环境密码按需显示/隐藏、关闭后清除、查看不改写、替换密码、慢请求取消及失败重试
- 390 像素窄屏没有横向溢出

测试宿主通过 `agent/pre-step` 绑定 canonical turn signal，取消端点模拟 DSH 的对话取消。原生停止按钮和主对话/右侧栏行为须在真实 DSH 验收。

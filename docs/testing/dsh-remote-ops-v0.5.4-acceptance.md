# Remote Ops v0.5.4 验收

验证日期：2026-10-15。基线：v0.5.3 / c79b983。环境：本机 Windows 11 x64、Node.js 24.11.1、DSH 0.2.0-rc.2、Playwright 1.64.0；系统默认浏览器为 Google Chrome。测试网站和模型提供者为本地确定性服务，使用真实 DSH 的会话、工具调用、skill 服务与已安装插件，没有修改 Agent。

## 自动化门禁

- `npm run check`：206 后端/参数/发布测试、104 客户端测试、11 契约测试，共 321 项通过，另含语法检查和 smoke。
- 浏览器 E2E：12/12，通过网页、共享输入、原生对话取消、终端、SFTP 上传跨页面、目录刷新及窄屏回归。
- UI skill 静态检查：14 项通过，1 个无 Codex 插件 manifest 的既有提示，0 错误；随包 skill 格式校验通过。
- 先添加失败回归再修复：JSON 步骤/定位字符串、动作字典、安装工具、Windows 默认引擎、切换失败保留页面、宿主 Schema 子集及发布资产策略。

## 真实 DSH

安装候选 tgz 到隔离 DSH_HOME，在真实 DSH Web 完成 20 组验收，前端 console/page/HTTP 错误为 0：

- 左侧入口左对齐、原生右栏复用、主对话与草稿保留、键盘切换、刷新、390px、明暗主题。
- 模型实际请求包含 38 个插件工具的 Schema，全部通过宿主 `assertObjectJsonSchema` 和 Ajv。首轮验收发现长度/数量关键字不受宿主子集支持，已修正为运行时限制并添加回归；完整重新验收通过。
- 原生 `skill` 工具可发现并加载安装包内指南；原生 `remote_browser_runtime` 从空缓存/空托管目录联网安装 Chromium 与 Headless Shell revision 1248。状态工具确认两种模式均使用匹配的托管运行时，安装按钮重复检查复用文件。
- 数组、动作字典、仅含 steps 的包装字典及 JSON 字符串可以执行；定位字典、JSON 字符串定位字典、CSS/XPath 字符串可以执行。等价规范格式的相同请求不重复点击。
- flowId 空值、冲突、缺失、站点绑定、可选 null、清空输入、非法后续步骤、字段路径、无部分派发、原请求 ID 纠正、Schema 生成参数均通过。
- 插件内与独立窗口切换、登录 Cookie 保留、独立窗口中的原生工具执行通过。

额外核验：

- 查询 Windows HTTP 默认关联并核对真实进程的 executablePath，独立窗口打开的是系统默认 Chrome，使用插件独立 profile，并保留登录；没有静默选择 Edge。
- 重启真实 DSH：不自动恢复浏览器/任务；旧对话无需先发消息即可重新打开，登录保留；人工输入可由原生 Agent 读取。
- 正式 v0.5.3 tgz 升级到候选 v0.5.4：网站、流程、偏好文件 SHA256 不变，登录文件保留，原插件内引擎/显式网站选择保留，新独立窗口默认继承 system。

原始证据保存在本地忽略目录 `output/browser054-*`，包括失败重现、门禁、宿主请求 Schema、20 组结果、截图、系统进程核对、重启和升级记录。截图已检查。

## 正式包复验

正式 [v0.5.4 Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.5.4) 的附件恰为 tgz 与 SHA256 文件；无新增 Windows ZIP。下载后的包摘要与本地验收包、Linux CI 产物及 GitHub digest 一致，51 个包内文件逐个与发布源码及安装内容一致，含随包 skill，不含浏览器二进制。

正式 tgz 在独立 DSH_HOME 新装后，20 组真实 DSH 验收再次全部通过、console/page/HTTP 错误为 0；再次从空缓存联网安装运行时，核对 Windows 默认 Chrome 进程与登录保留。正式包升级复验也通过。重启复验确认旧对话、登录及人工/Agent 共享输入正常。

发布提交和 Tag：`6909ec8cc6a56f63d3eed52712ef99ced57fc0f5`。发布工作流 [38696881730](https://github.com/Ssshake1996/myterm/actions/runs/38696881730) 的 Linux、Windows、Release 均通过；主分支 [插件 CI 38696933093](https://github.com/Ssshake1996/myterm/actions/runs/38696933093) 与 [浏览器 E2E 38696933663](https://github.com/Ssshake1996/myterm/actions/runs/38696933663) 均通过。历史 v0.5.3 ZIP 仍保留。

## 发布与边界

发布工作流保留 Linux/Windows 门禁，只上传 tgz 与对应 SHA256 文件。历史 v0.5.3 ZIP 不删除。正式 tgz SHA256：`651845ee0f4bc9976aa924b01ecbe0349601364bdb8e1d56e95e443e2cfff90b`。

未验证用户另一台电脑、真实内网站点/模型、其他 DSH 版本。Windows 系统默认引擎支持已安装 Chrome/Edge；其他默认浏览器或关联读取失败明确报错，不自动替换。CSS/XPath 参数完成结构校验后，具体选择器语法、页面加载和唯一匹配仍由浏览器执行时检查。展示模式切换会重载页面，未提交表单不恢复。SSH 参数空格问题继续暂缓。

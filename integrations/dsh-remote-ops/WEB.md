# Shared web workspace

Remote Ops 0.5.0 provides a browser in the native DSH right Sidebar. Type a URL to begin; saved sites and flows are optional. DSH owns the Agent and conversation. The plugin provides one browser session that both the user and Agent can operate.

## First use

1. Select or create a DSH conversation and open **Remote Ops → 网页**.
2. In **浏览器设置与高级功能**, install the dedicated Chromium or select installed Edge / Chrome. Engine changes apply to newly opened browsers.
3. Choose **插件内** or **独立窗口** under **显示**, enter an HTTP(S) URL and press Enter. A schemeless address gets `https://`. Independent windows require DSH and the user on the same interactive desktop. Embedded mode streams the dedicated browser into the DSH webpage; it does not iframe the target website.
4. Ask the Agent in the main conversation to operate the current page. The Agent can omit `browserId` to use this conversation's selected browser. You can also click, scroll, type, paste text and sign in directly, including while the conversation runs. There is no takeover/handback or input ownership. Use **Ctrl+Esc** to return keyboard focus to the plugin address field; choose **桌面视口 → 原始大小** for a larger scrollable desktop view. The default **跟随面板** viewport follows the available panel size without reloading the page; the website may respond to resize events. Independent windows use their own viewport.
5. Use native DSH conversation cancellation to stop the Agent. There are no takeover, pause or stop buttons in the browser or terminal panels, and no dedicated Agent task-control tools. Cancellation prevents subsequent browser steps after the current action settles. A dispatched click or request may already have taken effect; website server jobs do not roll back. A pending terminal send attempts Ctrl+C on cancellation; already returned commands and remote background processes may continue. Inspect actual results before claiming completion or process exit.

Human actions can change the page while the Agent works. The Agent must read the current page again before dependent actions. Input captured before a navigation, page switch or viewport resize is rejected, rather than replayed on a different page. UI keyboard requests are sent in order; multiple input sources can still change the same field or terminal command line.

Page tabs support arrow keys, Home/End and native focus. Back, forward, reload, new-page and close-current-page actions are available. Tabs show titles when available; the tooltip retains the sanitized URL. Browser tasks keep their intended page ID when the visible tab changes. Collapsed operation records show progress, results and failures without covering the page.

Changing display mode while idle restarts the browser with the same dedicated profile and page URLs. Login cookies are retained; pages reload and unsaved form contents are not restored. Mode changes wait until a running task or pending native dialog finishes. Switching modules or refreshing DSH is different: it only reconnects the view and does not restart the browser.

## Optional saved sites, login and flows

Expand **高级：收藏网站与流程** to save sites, configure automatic login, test locators or build reusable flows. Passwords go to the local Harness credentials service; site JSON contains a generated reference. Close a saved site's browsers before editing its configuration. Add credential origins explicitly for an SSO page or cross-origin frame. CAPTCHA/MFA remain manual in the same browser.

Prefer role plus exact accessible name, label, text or placeholder locators. CSS and XPath are also supported. `frame` is an optional CSS iframe selector. Each action requires exactly one match. `expectPopup` selects a newly opened page. Native confirm/prompt dialogs wait for an explicit Agent response and are never automatically accepted; prompt text entry is not supported.

Actions: `goto`, `click`, `fill`, `press`, `select`, `check`, `uncheck`, `scroll`, `wait`, `read`, `assert`. A run supports 1–40 steps, normally 10 seconds per step (100–30000 ms configurable), and five minutes of active execution. Flows cannot execute arbitrary JavaScript.

```json
[
  { "action": "fill", "target": { "kind": "label", "value": "Command" }, "value": "{{command}}" },
  { "action": "click", "target": { "kind": "role", "value": "button", "name": "Run" }, "expect": { "target": { "kind": "css", "value": "#output" }, "text": "OK:" } },
  { "action": "read", "target": { "kind": "xpath", "value": "//*[@id='output']" } }
]
```

| Tool | Purpose |
| --- | --- |
| `remote_browser_list` | Saved sites/flows and this conversation's browsers |
| `remote_browser_open` | Open a direct URL or saved site; optional display/engine |
| `remote_browser_login` | Run a saved login or check its signed-in indicator |
| `remote_browser_run` | Run declarative steps or a parameterized saved flow |
| `remote_browser_read` | Read progress, bounded page text/element metadata or test a locator |
| `remote_browser_control` | Focus, select a page, close it or answer a native dialog; no task ownership or pause/stop actions |

Run/login return immediately. Poll `remote_browser_read` until the job settles. Use one stable `requestId` for the same intended operation: duplicate requests are deduplicated for ten minutes in the running plugin, with a bounded cache of 100 receipts. Changed content under the same ID is rejected. Receipts do not survive DSH restart; never blindly resend after a restart or lost response.

`completed` means all steps returned. `completion=checked` means the configured visible/hidden/text check passed; `observed` means text was read; `unverified` means an action returned without a business result check. `unknown` means an effect may have happened before an error. No failed step is automatically retried. Choose checks that prove the intended outcome.

## Lifecycle, local data and limits

Browsers/jobs belong to the plugin backend and DSH conversation. Switching terminal/SFTP, collapsing or closing the Sidebar, and refreshing the DSH webpage do not cancel them. Stopping the conversation stops later steps. Unloading/upgrading the plugin or stopping DSH closes browsers and ends jobs; running jobs cannot resume across a process restart. Saved configuration and login data remain. Up to three live browsers per conversation and eight per plugin are supported. The toolbar refuses to create another page once a browser has twelve open pages.

Data lives under `$DSH_HOME/remote-ops/browser`: `sites.json`, `flows.json`, `preferences.json` and dedicated profiles scoped by conversation and site/origin. Configuration is shared for the local DSH user; browser pages/jobs/profiles are conversation scoped. Cookie snapshots retain session cookies after a normal close or display switch. Expired/revoked server sessions still require login. Browser profiles/cookies contain sensitive login data; do not commit/export them. Deleting a site leaves its credential reference and profile for explicit local cleanup.

Password fills require the site's saved reference and an allowed page/frame origin. Literal fills into password inputs are rejected. Input values are excluded from Agent page observations; known referenced passwords are redacted. Agent screenshots mask inputs and known secret text. The live user view is intentionally unmasked for direct interaction and is never included in tool results or stored as video. Only the latest live frame, latest masked screenshot and latest 15 job summaries are retained in memory. Other sensitive page text is not generally detected or removed.

This release supports mouse clicks, wheel scrolling, keyboard input, Chinese text composition and text paste. Dragging, file upload/download automation, native file pickers, clipboard copy from the rendered view, audio/video streaming, recorders, tracing, extensions and cross-machine visible browser control are outside this release. A local test site passing does not establish compatibility with every site's login, CAPTCHA/MFA, access rules or anti-automation behavior.

## 中文提示

在“网页”里输入网址即可打开，无需先配网站或流程。“插件内”提供可点击和输入的实时画面，也可选择“独立窗口”。人和 Agent 使用同一网页与终端，对话期间均可操作，不区分输入权，不需要接管或交还；停止 Agent 统一使用 DSH 原生停止对话入口。

切换终端/SFTP、收起右栏及刷新 DSH 不取消后台网页任务。切换显示方式会重新载入网页并保留 Cookie，未提交内容不会恢复。取消对话会停止后续步骤，不能撤销已发出的业务请求或保证远程进程退出；`unknown` 需检查实际网页，不会自动重试。登录凭据和专用浏览器 profile 只保存在 DSH 本机。

工作区入口为顶部“终端 / 网页 / 文件”，环境与诊断在辅助入口中。默认“跟随面板”视口，也可选择 1024×768“桌面视口”。改变视口不会主动重载；切换“插件内 / 独立窗口”会重载并可能丢失未提交内容。设置和收藏/流程合并在“浏览器设置与高级功能”中。

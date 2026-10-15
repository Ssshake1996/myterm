# Shared web workspace

Remote Ops 0.5.4 provides a browser in the native DSH right Sidebar. Type a URL to begin; saved sites and flows are optional. DSH owns the Agent and conversation. The plugin provides one browser session that both the user and Agent can operate.


## Browser arguments and on-demand runtime (v0.5.4)

Future Releases contain only the plugin `tgz` and its `SHA256SUMS`; no new `windows-x64.zip` is built. Historical v0.5.3 assets remain available. The plugin has no browser binaries; npm dependencies require network access, and the Agent can install matching Chromium through plugin tools when needed.

- Independent windows follow the Windows user's default HTTP(S) browser on the DSH host, supporting installed Chrome / Edge with an isolated plugin profile. Embedded mode still defaults to matching Chromium. Each mode has its own engine preference; the previous embedded preference is retained. Explicit saved-site or tool browser choices take precedence. Unsupported/unavailable defaults report an error instead of silently opening Edge. A remote DSH host's default is separate from the client viewing DSH.
- Prefer an action array for `steps`. Single action objects, a sole `{steps:[...]}` envelope and JSON-encoded versions are accepted. Prefer `{kind,value,name?,frame?}` locator objects for `target`; JSON-encoded locator objects and CSS/XPath strings (`css=#id`, `xpath=//button`, `#id`, `//button`) are accepted. All steps normalize and validate before dispatch. Equivalent requests deduplicate under the same `requestId`; missing targets are not guessed and arbitrary JavaScript is unsupported.
- For missing Chromium, call `remote_browser_runtime` with `action: "status"`, then `action: "install"` if needed. Poll `status` until the required mode is ready before opening a page. The plugin's installed Playwright CLI downloads its matching Chromium and Headless Shell. The settings button uses the same installer. Network access is required; configure `HTTPS_PROXY`, `PLAYWRIGHT_DOWNLOAD_HOST` or `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` before starting DSH if needed. Complete matching runtimes are reused and login profiles/sites/flows retained.
- `BROWSER_STEP_INVALID` identifies the field, accepted format and no-dispatch status. Correct the argument instead of repeating an unchanged invalid call; preflight rejection does not reserve the request ID. Fixes, Schemas, tool metadata and the bundled skill travel with the tgz, without Agent/core changes. Restart DSH and refresh its webpage after upgrading; verify v0.5.4.

## First use

1. Select or create a DSH conversation and open **Remote Ops → 网页**.
2. In **浏览器设置与高级功能**, install the dedicated Chromium or select installed Edge / Chrome. Engine changes apply to newly opened browsers.
3. Choose **插件内** or **独立窗口** under **显示**, enter an HTTP(S) URL and press Enter. A schemeless address gets `https://`. Independent windows require DSH and the user on the same interactive desktop. Embedded mode streams the dedicated browser into the DSH webpage; it does not iframe the target website.
4. Ask the Agent in the main conversation to operate the current page. The Agent can omit `browserId` to use this conversation's selected browser. You can also click, scroll, type, paste text and sign in directly, including while the conversation runs. There is no takeover/handback or input ownership. Use **Ctrl+Esc** to return keyboard focus to the plugin address field; choose **桌面视口 → 原始大小** for a larger scrollable desktop view. The default **跟随面板** viewport follows the available panel size without reloading the page; the website may respond to resize events. Independent windows use their own viewport.
5. Use native DSH conversation cancellation to stop the Agent. There are no takeover, pause or stop buttons in the browser or terminal panels, and no dedicated Agent task-control tools. Cancellation prevents subsequent browser steps after the current action settles. A dispatched click or request may already have taken effect; website server jobs do not roll back. A pending terminal send attempts Ctrl+C on cancellation; already returned commands and remote background processes may continue. Inspect actual results before claiming completion or process exit.

Human actions can change the page while the Agent works. The Agent must read the current page again before dependent actions. Input captured before a navigation, page switch or viewport resize is rejected, rather than replayed on a different page. UI keyboard requests are sent in order; multiple input sources can still change the same field or terminal command line.

Page tabs support arrow keys, Home/End and native focus. Back, forward, reload, new-page and close-current-page actions are available. Tabs show titles when available; the tooltip retains the sanitized URL. Browser tasks keep their intended page ID when the visible tab changes. Collapsed operation records show progress, results and failures without covering the page.

Changing display mode while idle restarts the browser with the same dedicated profile and page URLs. Login cookies are retained; pages reload and unsaved form contents are not restored. Mode changes wait until a running task or pending native dialog finishes. Switching modules or refreshing DSH is different: it only reconnects the view and does not restart the browser.

### Choosing the operation source (v0.5.1)

`remote_browser_run` and the plugin HTTP `run` route use the same argument validation. Inline actions need no saved website or flow:

```json
{
  "requestId": "read-current-page-001",
  "steps": [
    { "action": "read", "target": { "kind": "css", "value": "body" } }
  ]
}
```

Omit `flowId` for inline operations. For compatibility, null/empty/whitespace-only IDs are absent. Prefer a real `steps` array. JSON-encoded arrays, single action objects and a sole `{steps:[...]}` envelope are accepted and fully preflighted. A nonblank ID with nonempty steps is a conflict; a saved-flow call may omit steps or use `[]`. Saved IDs are trimmed before lookup and must come from `remote_browser_list`; the flow must belong to the selected browser's site. A direct-URL browser has its own temporary site ID, even when its URL matches a saved site's URL. Open the saved `siteId` to run its flow; the plugin never silently reassigns site or credential scope.

| Preflight error | Recovery |
| --- | --- |
| `BROWSER_FLOW_ID_INVALID` | Use a string flow ID from the list, or omit it for inline steps. |
| `BROWSER_STEP_INVALID` | Pass 1–40 structured action objects with valid locators and values. |
| `BROWSER_RUN_SOURCE_CONFLICT` | Provide either nonblank flowId or nonempty steps, not both. |
| `BROWSER_RUN_SOURCE_REQUIRED` | Supply an operation: inline steps or an existing saved flow ID. |
| `BROWSER_FLOW_NOT_FOUND` | Refresh the list and choose a real ID, or omit flowId for inline steps. |
| `BROWSER_FLOW_SITE_MISMATCH` | Open the flow's saved site and use its browserId, or use inline steps on the current page. |

These source/validation errors occur before this call dispatches an action; do not repeat unchanged invalid arguments. This differs from an `unknown` job result after an effect, which must still be inspected and never blindly replayed. The fix, updated tool metadata and `remote-ops-browser` skill are inside the plugin package; Agent implementation and DSH core are unchanged.

The plugin exposes its bundled skill globally through the native DSH skill registry (verified on 0.2.0-rc.2). The Agent can discover its summary and load instructions with the existing `skill` tool; `/remote-ops-browser` also invokes it explicitly. No Agent configuration or global skill file copying is needed. User/project skills keep their normal precedence, and unloading the plugin removes this provider. If the host has no skill service, browser operations and parameter validation still work independently.

## Step fields and validation (v0.5.2)

Tool definitions are standard object JSON Schemas, including nested required arrays and supported action/locator enums. `goto` requires `url`. Every other step, including `read`, requires `target`; observing the whole page directly uses `remote_browser_read` without a target. A non-null `expect` requires its own target.

Unused optional fields should be omitted; null means absent. `target.frame` may also be blank to select the main page. An explicit empty role name remains exact. Empty fill `value` clears a field; it is not discarded. `fill`, `press` and `select` need text; only `fill` may use the site's `secretRef` instead of a literal value. Required fields, unsupported actions, malformed selectors and non-null values of the wrong type are still rejected.

`BROWSER_STEP_INVALID` identifies a path such as `steps[1].target.frame` (the second step), expected format, and that nothing was dispatched. All steps are validated before the job starts, so an invalid later step cannot partially execute a run. Error messages do not echo field values. Optional nulls and omissions normalize before hashing requests; equivalent retries keep the existing job. Runtime failures/unknown effects still require inspection rather than replay.

## Optional saved sites, login and flows

Expand **浏览器设置与高级功能 → 收藏网站与流程** to save sites, configure automatic login, test locators or build reusable flows. Passwords go to the local Harness credentials service; site JSON contains a generated reference. Close a saved site's browsers before editing its configuration. Add credential origins explicitly for an SSO page or cross-origin frame. CAPTCHA/MFA remain manual in the same browser.

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

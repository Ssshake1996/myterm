# Shared web workspace

Remote Ops provides a browser in the native DSH right Sidebar. Type a URL to begin; saved sites and flows are optional. DSH manages the Agent and conversation. The user and Agent can operate the same browser session.


## Workspace controls

Use **设置 → 网页** for engines, browser runtime status, viewport and zoom; **返回工作区** returns to the same page and address draft. **网页 → 收藏** manages sites and flows. **操作记录** expands step results below the live page. These views do not pause or cancel browser work. Switching display mode first asks for confirmation; **取消** leaves it untouched, while **切换显示** reloads it and can discard unsent form data. Density and version are in **设置 → 通用**.

## Browser settings and installation

Browsers run on the DSH host. The plugin packages the matching Chromium Headless Shell for its internal browser. On Windows x64 and Linux x64, activation prepares and probes the bundled engine in a per-user cache outside the DSH package path. The first open waits for it and damaged cache files are restored locally. No separate browser installation is needed when the bundle is complete. Windows independent windows use installed Chrome/Edge by default; installing a dedicated full Chromium remains optional. Source installations and platforms without a bundled runtime need accessible download sources. Linux also needs the operating-system libraries required by Chromium.

Browser binaries increase the archive size. Upgrade from a package with the old 64 MiB updater limit through DSH's plugin manager or `dsh plugin add <package.tgz>` for the first migration. The new updater accepts up to 512 MiB compressed / 1 GiB expanded and scans archive metadata incrementally. It retains SHA256 verification and package-identity checks.

- Independent windows follow the Windows user's default HTTP(S) browser on the DSH host, supporting installed Chrome / Edge with an isolated plugin profile. Embedded mode defaults to matching Chromium. Each mode has its own engine preference. Explicit saved-site or tool browser choices take precedence. If the default browser is unavailable or incompatible, choose an available engine in settings. This setting follows the DSH host's browser configuration.
- Prefer an action array for `steps`. Single action objects, a sole `{steps:[...]}` envelope and JSON-encoded versions are accepted. Prefer `{kind,value,name?,frame?}` locator objects for `target`; JSON-encoded locator objects and CSS/XPath strings (`css=#id`, `xpath=//button`, `#id`, `//button`) are accepted. All steps normalize and validate before dispatch. Equivalent requests deduplicate under the same `requestId`.
- Open an embedded URL directly. After an automatic preparation failure, use `remote_browser_runtime` action `status` for diagnostics and action `repair` to retry offline. Action `install` downloads optional full Chromium for independent windows.
- `BROWSER_STEP_INVALID` identifies the field, accepted format and no-dispatch status. Correct the argument before retrying; preflight rejection leaves the request ID available. The bundled `remote-ops-browser` skill describes parameter formats and recovery steps.

## First use

1. Select or create a DSH conversation and open **Remote Ops → 网页**.
2. In **设置 → 网页**, the internal browser reports **随包就绪** with a complete matching package. You can also select installed Edge / Chrome. Engine changes apply to newly opened browsers.
3. Choose **插件内** or **独立窗口** under **显示**, enter an HTTP(S) URL and press Enter. A schemeless address gets `https://`. Independent windows require DSH and the user on the same interactive desktop. Embedded mode streams the dedicated browser into the DSH webpage.
4. Ask the Agent in the main conversation to operate the current page. The Agent can omit `browserId` to use this conversation's selected browser. You can also click, scroll, type, paste text and sign in directly, including while the conversation runs. Use **Ctrl+Esc** to return focus to the address field. **跟随面板** reflows a responsive page when the panel changes size. A document with a fixed minimum width is scaled to fit, and long pages scroll vertically. **桌面视口 → 原始大小** provides a scrollable 1024 × 768 desktop view. Independent windows use their own viewport.
5. Use native DSH conversation cancellation to stop the Agent. Cancellation prevents subsequent browser steps after the current action settles. A dispatched click or request may already have taken effect; website server jobs do not roll back. A pending terminal send attempts Ctrl+C on cancellation; already returned commands and remote background processes may continue. Inspect actual results before claiming completion or process exit.

Human actions can change the page while the Agent works. The Agent must read the current page again before dependent actions. Input captured before a navigation, page switch or viewport resize is rejected, rather than replayed on a different page. UI keyboard requests are sent in order; multiple input sources can still change the same field or terminal command line.

Use the plus button to open a page or the close button on any tab to close that page. Closing the selected tab selects its right neighbor, or its left neighbor at the end of the strip. Arrow keys and Home/End select tabs, and Delete closes the focused tab. The strip scrolls to keep the selected page visible. Tabs show page titles and their tooltips show the sanitized URL. Browser tasks keep their intended page ID when the visible tab changes.

Changing display mode while idle restarts the browser with the same dedicated profile and page URLs. Login cookies are retained; pages reload and unsaved form contents are not restored. Mode changes wait until a running task or pending native dialog finishes. Switching modules or refreshing DSH is different: it only reconnects the view and does not restart the browser.

### Choosing the operation source

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

These source/validation errors occur before this call dispatches an action; correct the arguments before retrying. An `unknown` job result may follow a real effect, so inspect the page before deciding whether to repeat the operation.

The plugin exposes its bundled skill through the native DSH skill registry (verified on 0.2.0-rc.2). The Agent can discover its summary and load instructions with the `skill` tool; `/remote-ops-browser` also invokes it explicitly. User/project skills keep their normal precedence, and unloading the plugin removes this provider.

## Record human and Agent operations

Use **开始录制** on an open webpage. Human interactions in the embedded view or independent window and Agent steps are saved in the same conversation-scoped record. **停止录制** ends capture without stopping page tasks. **录制记录** lists earlier recordings, reads their events and downloads JSON. Capture continues when switching plugin modules or reloading the DSH webpage; closing the browser stops it. A host crash leaves an interrupted record that can still be read.

The Agent tool is `remote_browser_recording`:

| Action | Arguments | Result |
| --- | --- | --- |
| `start` | optional `browserId`, `name` | Recording metadata/ID; repeated start returns the active recording. |
| `stop` | `recordingId` (or selected browser) | Final capture status and unfinished action IDs. |
| `read` | optional `recordingId`, `after`, `limit` | Without ID: list; with ID: events, `nextAfter`, `hasMore`. Limit 1–200. |
| `export` | `recordingId` | JSON file path on the DSH host; the UI also offers a download. |

For replay on another device, use `recording.deviceOrigin` and same-origin `devicePath` values. New captures list each element's locator alternatives with its observed match status. Feedback events include changes to visible status, alert, live or output regions.

Exports use `format: "myterm.web-recording"`, `schemaVersion: 1`. They contain initial pages, normalized Agent actions paired by `actionId`, actual DOM input/click/selection/key/scroll/hover/drag observations, locator candidates, frame ancestry, navigation and action outcomes. DOM events during an action are correlated with `duringActionId`; this does not prove exclusive authorship when a human acts concurrently. A returned click is not a business assertion. Password/sensitive field values, known saved credentials and URL query values are redacted. CSS candidates can be ambiguous; closed shadow roots, browser chrome and native file dialogs are not fully captured.

Recordings persist under `browser/recordings/<conversation hash>/` in the plugin data directory as metadata + append-only JSONL; exports are standalone JSON. Each recording is capped at 10,000 events / 16 MiB; `limited`, `interrupted`, `error`, gaps or unfinished actions must be reported as incomplete. Stop before exporting a complete procedure; exporting while active returns a snapshot. The bundled [remote-ops-web-recordings skill](skills/remote-ops-web-recordings/SKILL.md) explains interpretation, deduplication, device-address parameterization and framework/template-based generation by the Agent. The plugin contains no code generator or test execution framework.

## Step fields and validation

Tool definitions are standard object JSON Schemas, including nested required arrays and supported action/locator enums. `goto` requires `url`. Every other step, including `read`, requires `target`; observing the whole page directly uses `remote_browser_read` without a target. A non-null `expect` requires its own target.

Unused optional fields should be omitted; null means absent. `target.frame` may also be blank to select the main page. An explicit empty role name remains exact. Empty fill `value` clears a field; it is not discarded. `fill`, `press` and `select` need text; only `fill` may use the site's `secretRef` instead of a literal value. Required fields, unsupported actions, malformed selectors and non-null values of the wrong type are still rejected.

`BROWSER_STEP_INVALID` identifies a path such as `steps[1].target.frame` (the second step), expected format, and that nothing was dispatched. All steps are validated before the job starts, so an invalid later step cannot partially execute a run. Error messages do not echo field values. Optional nulls and omissions normalize before hashing requests; equivalent retries keep the existing job. Runtime failures/unknown effects still require inspection rather than replay.

## Optional saved sites, login and flows

Expand **网页 → 收藏** to save sites, configure automatic login, test locators or build reusable flows. Passwords saved with a site go to the local Harness credentials service. The site configuration stores their reference. Close a saved site's browsers before editing its configuration. Add credential origins explicitly for an SSO page or cross-origin frame. CAPTCHA/MFA remain manual in the same browser.

Prefer role plus exact accessible name, label, text or placeholder locators. CSS and XPath are also supported. `frame` is an optional CSS iframe selector. Each action requires exactly one match. `expectPopup` selects a newly opened page. Native dialogs wait for an explicit Agent accept/dismiss response.

Actions: `goto`, `click`, `fill`, `press`, `select`, `check`, `uncheck`, `scroll`, `wait`, `read`, `assert`. A run supports 1–40 declarative steps, normally 10 seconds per step (100–30000 ms configurable), and five minutes of active execution.

```json
[
  { "action": "fill", "target": { "kind": "label", "value": "Command" }, "value": "{{command}}" },
  { "action": "click", "target": { "kind": "role", "value": "button", "name": "Run" }, "expect": { "target": { "kind": "css", "value": "#output" }, "text": "OK:" } },
  { "action": "read", "target": { "kind": "xpath", "value": "//*[@id='output']" } }
]
```

| Tool | Purpose |
| --- | --- |
| `remote_browser_runtime` | Check or install matching Chromium |
| `remote_browser_list` | Saved sites/flows and this conversation's browsers |
| `remote_browser_open` | Open a direct URL or saved site; optional display/engine |
| `remote_browser_login` | Run a saved login or check its signed-in indicator |
| `remote_browser_run` | Run declarative steps or a parameterized saved flow |
| `remote_browser_read` | Read progress, bounded page text/element metadata or test a locator |
| `remote_browser_control` | Focus, select a page, close it or answer a native dialog |

Run/login return immediately. Poll `remote_browser_read` until the job settles. Use one stable `requestId` for the same intended operation: duplicate requests are deduplicated for ten minutes in the running plugin, with a bounded cache of 100 receipts. Changed content under the same ID is rejected. Receipts do not survive DSH restart; never blindly resend after a restart or lost response.

`completed` means all steps returned. `completion=checked` means the configured visible/hidden/text check passed; `observed` means text was read; `unverified` means an action returned without a business result check. `unknown` means an effect may have happened before an error. No failed step is automatically retried. Choose checks that prove the intended outcome.

## Lifecycle, local data and limits

Browsers/jobs belong to the plugin backend and DSH conversation. Switching terminal/SFTP, collapsing or closing the Sidebar, and refreshing the DSH webpage do not cancel them. Stopping the conversation stops later steps. Unloading/upgrading the plugin or stopping DSH closes browsers and ends jobs; running jobs cannot resume across a process restart. Saved configuration and login data remain. Up to three live browsers per conversation and eight per plugin are supported. The toolbar refuses to create another page once a browser has twelve open pages.

Data lives under `$DSH_HOME/remote-ops/browser`: `sites.json`, `flows.json`, `preferences.json` and dedicated profiles scoped by conversation and site/origin. Configuration is shared for the local DSH user; browser pages/jobs/profiles are conversation scoped. Cookie snapshots retain session cookies after a normal close or display switch. Expired/revoked server sessions still require login. Browser profiles/cookies contain sensitive login data; do not commit/export them. Deleting a site leaves its credential reference and profile for explicit local cleanup.

An Agent can sign in on a directly opened URL with a password the user supplies. Pass it to `remote_browser_run` as a fill step's `value` or through `variables.password` with `"value": "{{password}}"`. Substitution happens once, so the variable form preserves passwords containing literal template markers. Reusable flows can store that placeholder and take the password at run time. A saved `secretRef` uses the site's configured page and frame origin checks.

The plugin redacts password fills from its recordings and JSON exports. It also masks known passwords in page observations, job errors and Agent screenshots. DSH manages the original conversation and tool arguments. The live user view is intentionally unmasked for direct interaction and is never included in tool results or stored as video. Only the latest live frame, latest masked screenshot and latest 15 job summaries are retained in memory. Other sensitive page text is not generally detected or removed.

The embedded view supports mouse clicks, wheel scrolling, keyboard input, Chinese text composition and text paste. Validate each site's login, CAPTCHA/MFA, access rules and automation behavior against its actual requirements.

## 中文提示

在“网页”里输入网址即可打开；网站收藏和流程可按需配置。“插件内”提供可点击和输入的实时画面，也可选择“独立窗口”。人和 Agent 使用同一网页与终端，对话期间均可操作；停止 Agent 使用 DSH 原生停止对话入口。

切换终端/SFTP、收起右栏及刷新 DSH 不取消后台网页任务。切换显示方式会重新载入网页并保留 Cookie，未提交内容不会恢复。取消对话会停止后续步骤，不能撤销已发出的业务请求或保证远程进程退出；`unknown` 需检查实际网页，不会自动重试。登录凭据和专用浏览器 profile 只保存在 DSH 本机。

默认“跟随面板”会随分栏自动调整网页，对固定宽度的设备页面按宽度等比显示。需要按原尺寸操作时，可在“设置 → 网页”选择“桌面视口 → 原始大小”。标签栏末尾的 ＋ 新建网页，每个标签上的 × 关闭对应页面。拖动分栏可保留当前表单，切换“插件内 / 独立窗口”会重新加载网页。

要让 Agent 把操作写成自动化用例，在 A 设备开始录制，完成后停止并导出 JSON。记录包含设备地址、同源页面路径、iframe、目标元素的候选定位和匹配情况，以及网页状态区域显示的反馈。把导出文件、B 设备地址和目标框架交给 Agent，即可按相同界面编写跨设备用例。

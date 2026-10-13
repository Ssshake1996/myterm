# Visible web workspace

Remote Ops 0.3.0 adds a **Web / 网页** module inside the existing native right Sidebar. DSH and the user must run on the same interactive desktop. Playwright opens a separate visible browser; the plugin shows controls, progress, results and a masked screenshot. There is no embedded video stream or second Agent loop.

## First use

1. Select or create a DSH conversation, open **Remote Ops → 网页**, and choose **新增网站**.
2. Enter a name and full HTTP(S) address. Use the dedicated Chromium (install it with **浏览器准备与网站管理 → 安装 / 检查 Chromium**) or an installed Edge / Chrome. Browser downloads need network access; Linux also needs Chromium's system libraries and a graphical desktop. DSH running as a background service without desktop access cannot show a browser to you.
3. Open the browser. For manual login, select **人工接管**, sign in in that window, and select **交还控制**. CAPTCHA and MFA remain manual. Automation stays paused after control is returned; inspect the page before continuing.
4. Optional automatic login: configure the username, password, submit and signed-in indicator locators in the site editor. Close that site's browsers before editing its configuration. Passwords go to the local Harness credentials service; the site's JSON stores only a generated reference. Additional credential origins must be explicitly listed for an SSO page or cross-origin frame.
5. Build steps, use **测试定位** to highlight a unique match, add an expected result, and run or prepare single-step mode. Save a named flow to reuse it from the UI or Agent. Text such as `{{command}}` becomes a parameter field.

Prefer role + exact accessible name, label, text or placeholder locators; CSS and XPath are supported. `frame` is an optional CSS iframe selector. Each action requires exactly one target. A click marked **点击后切换到新弹出网页** selects its popup; other tabs can be selected from **当前网页** while paused. Native confirm/prompt dialogs wait for explicit accept/dismiss; they are never automatically accepted. Prompt text entry is not supported in this release.

## Flow format and Agent tools

Actions: `goto`, `click`, `fill`, `press`, `select`, `check`, `uncheck`, `scroll`, `wait`, `read`, `assert`. At most 40 steps, normally 10 seconds per step (100–30000 ms configurable) and five minutes of active execution per run. Flows cannot execute arbitrary JavaScript. File upload/download, element recording/picking, tracing, embedded streaming, cross-machine browser control and browser extensions are outside this release.

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
| `remote_browser_open` | Open or focus a saved site's visible browser |
| `remote_browser_login` | Start the configured login, or check its signed-in indicator |
| `remote_browser_run` | Start declarative steps or a saved, parameterized flow |
| `remote_browser_read` | Poll progress/results and bounded page text/element metadata; optionally test a locator |
| `remote_browser_control` | Focus, pause/resume/step/stop, takeover/release, select a page, close or respond to a native dialog |

Run/login return immediately. Poll `remote_browser_read` until the task settles. Use a stable `requestId` for the same intended operation: duplicate requests are deduplicated for ten minutes within the running plugin, with a bounded cache of 100 receipts. Changed content under the same ID is rejected. Receipts do not survive a DSH restart; never blindly resend after a restart or lost response.

`completed` means all steps returned. `completion=checked` means the configured visible/hidden/text check passed; `observed` means text was read; `unverified` means an action returned without a business result check. `unknown` means an effect may have happened before an error: inspect the page before deciding what to do. No failed step is automatically retried. Checks can be too weak, so choose an indicator that proves the intended business outcome.

Pause, stop and takeover wait for the current Playwright action/check to settle. They cannot retract a click, command or request already sent. Stopping prevents later steps; it does not roll back changes or cancel the website's server job. Close the browser to terminate the browser connection. Manual control is a coordination protocol; the plugin cannot prevent someone interacting directly with the visible window during automation.

## Lifecycle and local data

Browser jobs belong to the plugin backend and DSH conversation. Switching terminal/SFTP, collapsing the Sidebar, closing the Remote Ops tab or refreshing the DSH webpage does not cancel them. Stop or close explicitly. Unloading/upgrading the plugin or stopping DSH closes browsers and ends jobs; running jobs cannot resume across a process restart. Saved sites, flows and login data remain. Up to three live browsers per conversation and eight per plugin are supported.

Local data is under `$DSH_HOME/remote-ops/browser`: `sites.json`, `flows.json`, and dedicated profiles scoped by conversation and site. Websites and flows are shared configuration for the local DSH user; browser pages/jobs and profiles are conversation scoped. Cookie snapshots retain session cookies when a browser is closed normally. Expired/revoked server sessions still require login. Browser profiles/cookie snapshots contain sensitive login data: do not commit or export this directory. Deleting a site removes its definition/flows, but deliberately leaves its credential reference and profiles; remove those locally when a full logout/data purge is required.

Passwords are filled only from the site's saved reference and only into its allowed page and frame origins. Literal fills into password inputs are rejected. Known referenced password values are redacted from text/results/errors; input values are excluded from page observations. Screenshots mask input fields and known password text. This is not general secret detection: other sensitive page text may still be visible. Only the latest screenshot and the latest 15 run summaries are retained in memory; this release does not record video, traces or per-step screenshot history.

## 中文使用提示

在同一台电脑的 DSH 对话中打开 **Remote Ops → 网页**，新增网站后打开独立浏览器。可以先人工接管完成登录，再交还控制；也可以保存本机凭据和四个登录定位（用户名、密码、登录按钮、成功标识）进行自动登录。验证码和 MFA 需人工完成。

支持 XPath、CSS、role/name、label、text、placeholder 和 iframe；建议先测试唯一定位，再添加结果检查。保存流程支持 `{{参数}}`。任务由后端管理，切换模块、收起或关闭右栏及刷新 DSH 网页均不会取消；插件卸载或 DSH 重启会结束任务。暂停、停止与接管等待当前动作结束，不能撤销已经发出的操作。`unknown` 状态需检查网页，禁止凭回显或超时判断业务成功，也不会自动重试。

密码保存在本机 Harness 凭据服务，配置仅保留引用；浏览器专用 profile 与 Cookie 文件也属于敏感登录数据。其他对话不能访问当前对话的浏览器任务。首次 Chromium 下载、实际网站的登录兼容性、验证码及业务权限依赖本机与目标网站；本地验收站点通过不等于所有网站均已验证。

# @dsh/remote-ops

DeepSeek Harness plugin for SSH, Windows desktop, web and RESTful API operations. Users and Agents share visible terminals, application windows, webpages and request records.

## Collapsible environment groups (v0.15.4)

Click a group name in the environment drawer to collapse or expand it. Groups start expanded. Terminal and API environments remember their groups independently. Searching reveals matches and clearing the search restores your layout. Bulk selection includes only visible environments in expanded groups.

## Environment drawer and compact toolbar (v0.15.3)

Environments open in a left drawer inside the plugin: overlay by default, optionally pinned on wide panels, and full width on narrow panels. Escape restores focus; drafts, terminal sessions, webpages and recordings remain available. Compact toolbars and row More menus free workspace space. Verified locally with DSH Desktop 0.2.1-rc.5.

## Web recordings and bundled browser (v0.15.2)

Start, stop, read and export human/Agent webpage operations from the Web toolbar or `remote_browser_recording`. The bundled `remote-ops-web-recordings` skill teaches the Agent to interpret records, parameterize device addresses and generate code in the user's chosen framework or template.

Windows x64 and Linux x64 packages include the embedded Chromium. The plugin prepares it offline on load and the first page open waits for it. Linux requires Chromium system libraries. Sites using the matching intranet bridge can upgrade v0.14.0 and v0.14.1 with one click in the plugin. The ZIP includes deployment instructions.

## Serial terminals (v0.14.1)

In **Environments → Terminal environments → Add**, select **SERIAL** beside SSH and TELNET. Select a port or enter the device path available to the plugin host, such as `COM3`, `/dev/ttyUSB0`, or `/dev/cu.usbserial-001`. Set the baud rate, data bits, stop bits, parity, flow control, encoding and line ending to match the device. Defaults are 9600 baud, 8N1, no flow control and CR. Save and enter the environment to open its terminal tab.

The user and Agent share input, device output and log exports. Agents can list ports with `remote_serial_ports`, save `transport: "serial"` with `serial.path` through `remote_environment_create`, then use the existing terminal tools. Only one connection can own a port at a time. Closing the tab releases it. The connection test opens and closes the port; inspect device output to verify commands.

## Save environment credentials from chat (v0.13.2)

When you explicitly provide an account/password for an environment, the Agent can create or update it directly. SSH/Telnet use `username` and `password` in `remote_environment_create/update`; API uses `auth.username` and a top-level `password` in `remote_api_environment_save`. GUI entry remains optional.

Passwords go to DSH credentials; environment files store references and tool results omit plaintext. Replacing a password affects only that environment. Omit/null preserves it; an empty string is rejected. Choose either password or passwordRef. Existing terminals stay connected; API environments require login again after edits. DSH manages its own conversation and tool-call history.

## Telnet terminals (v0.13.1)

Choose **Environments → Terminal environments → Add**, select Telnet, and save the host, port (default 23) and login mode. Supports username/password, password-only, no-login and manual terminal login. Automatic credentials are submitted once; a failed login leaves the output available for inspection.

Users and Agents share the visible terminal, tabs, status indicators and log exports. Close all now includes this conversation's SSH, TELNET and SERIAL tabs while keeping local CMD. Connection, login readiness and command results are separate. Configure encoding, line endings and prompt patterns for device CLIs. Telnet is unencrypted; file transfer uses SSH/SFTP.

Existing `remote_environment_*` and `remote_terminal_*` tools and bundled skills cover the flow without Agent changes. See the [Telnet guide](TELNET.md).

## Windows desktop operations

The **桌面** workspace shows real Windows application windows. Connect the DSH Windows host or a saved Windows SSH environment, launch software, inspect UIA controls, fill fields, click buttons and verify outcomes. Users can operate the same window; native DSH cancellation stops later steps. Export this conversation's desktop records and last captured windows as a ZIP.

The tgz includes the pinned worker and dependencies plus the native `remote-ops-desktop` skill. Use a logged-on, unlocked Windows 11 or Windows Server Desktop Experience session; the SSH account must match that desktop user. Hot reload waits for active desktop work and retains connections and logs. See the [Windows desktop guide](DESKTOP.md).

Start with [remote Windows setup](DESKTOP.md#远程电脑的一次性配置), then copy the [complete Notepad task](DESKTOP.md#完整示例打开记事本输入并保存) into DSH (guide in Chinese). It opens a new document, enters text and saves through the application UI, then reads the saved file independently over SSH to verify its contents.

## Hot reload after updates

v0.12.3 also supports hosts that reload plugins during package installation. When needed, it first waits for active work and preserves the running state before installing; final activation still waits for idle. Update submission returns immediately while the operation continues in the background. Brief connection gaps recover automatically; persistent failures show the request address and details. **刷新更新状态** reads progress without repeating installation. An installation that has not returned after 10 minutes explicitly reports an unconfirmed result.

Starting with v0.11.0, **设置 → 更新 → 检查并更新** downloads, verifies and installs a newer release, then automatically applies it when work is idle. DSH keeps running. The update view explains waits for conversation activity, terminal waits and independent commands, transfers, browser jobs/runtime installation, and API requests. Browser uploads defer reload until the whole batch finishes or is cancelled, including the gaps between file requests.

The handoff preserves the current conversation and draft, saved settings, live terminal/browser connections, terminal logs, and API authentication and records. No command or request is replayed. Output silence is not treated as proof that a manual terminal command finished: its connection is retained. New connections use the new implementation; existing transports retain the implementation they were created with.

A failed startup restores the previous runtime and exposes **重试应用已安装版本** (retry activation). Running and installed versions remain distinct. Missing host reload APIs or an incompatible runtime state format produce an explicit restart requirement.

**For the first migration from v0.12.2 or earlier, finish active work and install this tgz through DSH plugin management or the CLI.** After CLI installation, if the running version is still old and the page responds, use **重试应用已安装版本** in the update settings to activate the installed package without reinstalling it. Hosts without hot-reload support need a restart. If the old updater is already stuck, check the host installation log and installed version, then restart DSH once after installation completes; do not submit another install. Subsequent compatible updates from the fixed runtime can hot reload. A full restart requires reconnecting terminals and webpages but preserves saved configuration and conversations. Refreshing the browser alone does not update the backend. See the [v0.12.3 acceptance record](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.12.3-acceptance.md).

## Remote tab status and close all

The terminal strip exposes **全部关闭** (close all). It closes the current conversation's SSH tabs and their connections captured when clicked, preserving local CMD, saved environments and other conversations. Live connections or known running commands receive one combined confirmation with an active-operation count; disconnected tabs without running commands clear immediately. Failed closures remain visible with a reason. Connections opened during confirmation are excluded from that selection.

| Indicator | Meaning |
| --- | --- |
| Amber ring | Waiting for output, executing an independent command or closing; hover for the specific state and whether the Agent initiated it |
| Green dot | Connected; not proof that a command finished or a business operation succeeded |
| Hollow gray dot | Disconnected without a known running command; received output is retained for inspection or export |

Shapes, text and accessible descriptions accompany the colors; blue still marks the selected tab. Amber is informational and human input remains available. Ordinary keystrokes and new output are not treated as reliably timed command executions.

Closing cancels associated waits and independent commands and requests SSH channel shutdown. Remote process termination remains unconfirmed; commands are not replayed. Closing tabs does not erase retained logs, which remain available through log tools or **更多 → 一键打包本会话全部日志** within the retention limits.

## Windows OpenSSH

Windows desktop and Server use the existing SSH environment, terminal, file and log workspaces. Choose the target platform and server-default, CMD, Windows PowerShell 5.1 or an installed PowerShell 7 in **环境 → 终端环境 → SSH**. **测试** reports authentication, detected system, PTY, SFTP and the host fingerprint separately.

`remote_environment_create/update/test` manages and diagnoses targets. `remote_command_execute` accepts a Windows shell, literal working directory and named PowerShell parameters, and returns exit status and separate error output. Windows independent commands authenticate a separate SSH connection while preserving the visible terminal. SFTP handles drive paths, Unicode and spaces; existing file and multi-terminal log tools remain available.

The package includes the native DSH `remote-ops-windows` skill. See the [Windows guide](WINDOWS.md) and [verification matrix](https://github.com/Ssshake1996/myterm/blob/main/docs/testing/dsh-remote-ops-v0.10.2-acceptance.md). No Agent modification is required.

## Workspace tabs

Terminal, Web, Files and API now form a compact left-aligned group. The blue selection line spans the complete tab button. Narrow panels use smaller padding while retaining labels, background activity badges and arrow / Home / End navigation. Switching preserves workspace contents.

## Terminal layout and request diagnostics

- Session tabs, close all, search and the current TXT download share one row, with approximately 32px desktop tabs. All-log ZIP export lives under **更多**; the bottom status bar shows the path, quick commands remain below, and **设置 → 终端** controls the active SSH size.
- Error headings distinguish state refresh, terminal output refresh and plugin update failures. Expand **错误详情** for the request method, redacted URL, HTTP status, stage, timestamp and bounded response preview. Network failures explicitly say that no HTTP response was received.
- Update failures identify the version manifest, SHA256 file or archive, including the actual failed URL. Upstream HTTP status and the plugin endpoint status are labeled separately.
- The same background refresh failure is automatically announced once per DSH/plugin runtime. Dismissing it, switching workspaces or refreshing the page does not repeatedly reopen it. Background retries continue; explicit **刷新状态** still reports its result. Recovery clears the corresponding state error; a new backend runtime enables notifications again.
- Diagnostics redact URL query values and common password, Token, Cookie and Authorization fields. They do not collect request bodies or headers.

For a 404, first identify whether the failed URL is `/api/dsh-remote-ops/state` or an update-source file, then check plugin loading, service routing or the release directory accordingly. Version checks remain manual.

## Workspace layout

- All workspaces share one **设置** entry with general, terminal, browser and update categories. **环境** manages SSH and API environments together, retaining their separate forms and credentials.
- Local CMD and SSH use one consistent terminal tab strip, with a filled background, border and bold text for the active tab. Arrow keys switch terminals. Environments open in a drawer on the left of the plugin workspace, with a persistent close button. Escape closes it and restores focus to the environment entry, retaining terminal and request drafts. The terminal row contains close all, search, current TXT download and **更多** (more). Quick commands start as a compact strip; expand it or open **命令库** to manage saved commands.
- Workspace tabs show unread terminal output, file transfers and browser execution. Viewing the corresponding terminal clears its unread indicator. Transfers show a percentage only when the total is known reliably.
- API results have **响应 / 记录** tabs. Expand JSON nodes and click a field name to copy its JSON Pointer, with selectable text when clipboard access fails. HTTP status uses both color and text; 2xx also says **请检查业务结果**. Large trees render in batches and retain a raw view.
- Workspace/settings switches preserve terminal, browser and API state. Background work continues while hidden browser views suspend frame requests.

## Manual intranet HTTP/HTTPS updates

Open Remote Ops → **设置 → 更新**, save a source, then choose **仅检查版本** (check only) or **检查并更新** (check and install). Choose the default GitHub Release source or an intranet HTTP/HTTPS URL. Clicking a button starts the check; a newer stable version can then be installed. Running and installed versions are shown separately. Compatible updates automatically activate when ongoing work finishes; the view reports the waiting reason and the resulting running version.

Keep `latest.json`, `dsh-remote-ops-v0.15.7.tgz` and `SHA256SUMS-dsh-remote-ops-v0.15.7.txt` in the feed directory. Generate the manifest from the unchanged official release pair:

```sh
node integrations/dsh-remote-ops/scripts/create-update-manifest.mjs ./release/dsh-remote-ops-v0.15.7.tgz
```

The installed package also includes `scripts/create-update-manifest.mjs`. An optional second argument chooses an existing parent directory's `latest.json`, allowing version subdirectories. The script verifies checksum and package identity, refuses a lower version, and writes the manifest atomically. Upload the tgz/checksum first and publish the manifest last. Serve the directory over HTTP/HTTPS. GitHub Release provides the tgz and SHA256 checksum file.

- HTTP(S): use a directly readable directory URL or `latest.json` URL containing the scheme, host and path. All files and redirects must remain on that origin; the server must allow the DSH host to download them directly. Trust internal HTTPS certificates in the DSH Node process.
- Dependencies use the DSH registry, proxy and build-approval configuration. Provide an accessible internal npm registry when needed. The embedded browser ships with the plugin. Full Chromium for independent windows is optional.

Verified packages are cached on the DSH host and installed by the current profile's native DSH plugin manager. Source settings live in `$DSH_HOME/remote-ops/update-settings.json` and are shared within that DSH home; installation affects the current profile. Installation errors provide a reason and log location. Failed hot reload restores the previous runtime and allows an explicit activation retry. Follow the activation or restart steps above for the first migration; a full restart does not restore process-local connections or records. The bundled `remote-ops-updates` skill covers configuration, feed generation and diagnostics.

## Saved RESTful environments and execution workspace

- The **API** workspace saves base URLs, groups, common headers, timeout, private CA and login configuration. API targets work without SSH; an optional SSH environment ID links the same device without sharing credentials.
- A single POST login sends username/password as JSON or form and extracts a Token through JSON Pointer or a response header, or stores scoped Cookies. Cookie-to-CSRF-header mapping is supported. Passwords use DSH credentials; configuration stores references. Login sessions are isolated by conversation and remain in memory only.
- UI and Agent requests share visible login/request records, HTTP status, timing, redacted responses, errors and unknown outcomes. Export the current conversation's records as JSON. HTTP 2xx still requires checking the business response.
- The bundled `remote-ops-api` skill guides Agent operations: select a target with `remote_api_environment_list`, manage it with `remote_api_environment_save/delete`, then use exact returned IDs with `remote_api_login`, `remote_api_request` and `remote_api_records`.
- Requests originate on the DSH host. Both `/items` and `items` preserve the base URL's path prefix. No automatic redirects, reauthentication or replay. After a timeout/cancellation with an unknown outcome, query device state before any retry.
- Configuration persists in `$DSH_HOME/remote-ops/api/environments.json`; login state, records and duplicate-ID protection cover only this process's last 100 requests per conversation. Response preview: 128 KiB; request body: 1 MiB. Edits invalidate login; running requests keep their captured target. Switching tabs does not cancel requests.
- Credentials and known authentication values are redacted; business payloads may still contain sensitive data.

## Local CMD commands and directory colors

The terminal uses a [Catppuccin](https://catppuccin.com/palette/)-inspired Latte / Mocha palette following the DSH light/dark theme: purple commands, teal directories and blue files. Light accents are darkened for readable text contrast. Error, warning and success prefixes also receive emphasis; verify outcomes from the actual output. Surrounding plugin controls use host styling.

Commands echoed after a standard prompt now use the same accent, weight and subtle background whether typed manually, sent as a complete Agent command or entered through raw keys. Recognition runs after terminal cursor redraws, so visible edits/backspaces remain readable. No extra command is executed and hidden input is never added to the display.

Standard `dir` rows show directory names in teal and file names in blue, leaving timestamps, sizes and totals unchanged. Existing ANSI colors are retained. Common CMD, PowerShell and `user@host` Shell prompts are recognized; custom prompts and formats without type information, such as `dir /b`, are not guessed. Full-screen applications do not receive these semantic colors. Terminal display settings can disable them; copied, searched and exported text stays unchanged.

## Reveal environment passwords on demand

The SSH password field in the environment editor has an eye button. It stays masked by default and resolves the currently effective saved credential only on request. Hiding the password or closing the editor/drawer clears the revealed value. Newly typed passwords can also be shown for checking.

Viewing alone never changes the credential: saving other fields preserves it; typing a replacement updates it. Missing configuration, missing credentials and unavailable providers have clear retry/re-entry messages. Revealed values are not written to browser storage, environment listings, diagnostic records or Agent tool results. The bundled environment-management skill describes the user-facing path.

## Terminal copy and paste

Local CMD, SSH, Telnet and Serial terminals share copy/paste behavior. Select output and press `Ctrl+C`, or right-click and choose **复制选中内容**. With no selection, `Ctrl+C` remains the terminal interrupt signal. `Ctrl+V` and **粘贴到终端** send clipboard text to the active session; single-line text is sent immediately, while multiline text opens a confirmation dialog before submission.

The context menu also provides **全选输出**. Copied text is plain text without terminal colors or cursor decoration. If browser clipboard permission is unavailable, the UI explains the reason and you can select text manually or type it. Copy/paste changes only the visible terminal; it does not change Agent tools or add hidden input to retained logs.

## Terminal logs

- The download button beside terminal tabs exports the current terminal as UTF-8 TXT. **更多 → 一键打包本会话全部日志** exports all available conversation logs as ZIP, including retained closed SSH records and the shared local terminal. Each ZIP contains separate transcripts and a `manifest.json` with source, time and coverage metadata.
- `remote_terminal_logs`, `remote_terminal_log_read` and `remote_terminal_log_export` provide discovery, raw-cursor pagination and packaging. The export tool returns SHA256 and an absolute download link for the observed trusted DSH browser origin (or null when unavailable; use the toolbar); the Agent need not copy screen text, read every page or run archive commands.
- The bundled `remote-ops-terminal-logs` skill is automatically discoverable through DSH, with `/remote-ops-terminal-logs` also available. The tgz carries both tools and instructions.
- Retention is process memory: 4 MiB per terminal, trimmed to the latest 3 MiB on overflow; closed records share a 16 MiB / 32-record limit. APIs disclose truncation and evictions. History does not survive restart. Hidden/raw input is not logged separately, but secrets printed by programs can still be present.
- A package accepts at most 32 logs / 32 MiB raw output. Download cache is limited to 10 packages / 32 MiB; links expire after one hour, earlier eviction or host restart. Exports freeze current buffers; later output needs a new export. Progress frames are retained as lines, not a replay of a full-screen application. Independent commands and browser activity are separate records.

## Agent environment management

`remote_environment_list/create/update/delete` manages SSH environment definitions. The bundled `remote-ops-environments` skill covers targets, updates, groups, credentials and existing connections. It registers through DSH's native skill provider; user/project skills retain their normal precedence.

## Interface and interaction

- Terminal, web, files, environments, saved commands and diagnostics share consistent typography, spacing, controls and host-aware light/dark surfaces. Workspace tabs stay at the top; version, diagnostics and comfortable/compact density live under **设置 → 通用**. Updates live under **设置 → 更新**. Density persists in this browser.
- Local CMD and SSH share one tab row with search and export fixed on the right. When tabs overflow, left and right buttons scroll to earlier or later tabs without closing connections; each button is disabled at its boundary. Arrow keys and Home/End select and reveal a terminal. Background output and status refreshes preserve manual scrolling.
- The web workspace prioritizes the address and live page. **设置 → 网页** contains engines, browser runtime status, viewport and zoom. **收藏** manages sites and flows; **操作记录** expands below the live page. Returning to the workspace retains the URL draft and current page.
- Switching an open page between embedded and independent display requires confirmation. Cancel dispatches nothing; confirming reloads the page and may lose unsent form content. Switching cannot be submitted repeatedly while pending.
- File batch actions appear after selection. Upload controls match other buttons, and browser uploads show byte progress. Module switches retain selection, drafts and background jobs; completed transfers still use coalesced directory refreshes.

The left action opens the native DSH right sidebar. Human and Agent input is shared; use native conversation cancellation to stop the Agent.

## Embedded browser and independent windows

On Windows x64 and Linux x64 the plugin verifies its bundled Headless Shell in a per-user cache when it loads. Opening an embedded URL waits for local preparation and restores damaged cache files from the plugin. Linux requires Chromium's system libraries. Full Chromium for independent windows is optional.

- Independent windows follow the Windows user's default HTTP(S) browser on the DSH host, supporting installed Chrome / Edge with an isolated plugin profile. Embedded mode still defaults to matching Chromium. Each mode has its own engine preference. Explicit saved-site or tool browser choices take precedence. Unsupported/unavailable defaults report an error instead of silently opening Edge. A remote DSH host's default is separate from the client viewing DSH.
- Prefer an action array for `steps`. Single action objects, a sole `{steps:[...]}` envelope and JSON-encoded versions are accepted. Prefer `{kind,value,name?,frame?}` locator objects for `target`; JSON-encoded locator objects and CSS/XPath strings (`css=#id`, `xpath=//button`, `#id`, `//button`) are accepted. All steps normalize and validate before dispatch. Equivalent requests deduplicate under the same `requestId`.
- Open embedded URLs directly using `remote_browser_open`. After a preparation failure, use `remote_browser_runtime` action `repair` to retry offline. Action `install` downloads full Chromium for a requested dedicated independent window.
- `BROWSER_STEP_INVALID` identifies the field, accepted format and no-dispatch status. Correct the argument instead of repeating an unchanged invalid call; preflight rejection does not reserve the request ID. The bundled `remote-ops-browser` skill describes argument formats and recovery steps. Restart DSH and refresh its webpage after upgrading; verify the current version in **设置 → 通用**.

## Workspaces and interaction

- Environments use a 360px overlay drawer inside the plugin. It fills panels below 480px; panels at least 960px wide can pin it at 320px. Opening and closing the overlay preserves terminal, browser and API instances, the webpage viewport and active recordings. Search, group selection and the list share the drawer. Rows expose Connect/Use and More; editing, testing, deletion and independent SSH connections live in More. Sticky Save/Cancel actions remain available; ordinary drafts persist, while revealed passwords clear on close. Batch management confirms selected names and addresses before deletion, retains failed selections with reasons, and leaves configuration unchanged on cancellation. SSH group menus rename or delete empty groups; API groups are set in the form.
- **终端 / 网页 / 文件 / API** workspace tabs support arrows and Home/End. Environment management opens inside the panel; **设置 → 通用** contains diagnostics and refresh, while **设置 → 更新** handles updates. The native DSH right Sidebar and the main conversation are preserved.
- The module, selected terminal and environment filter recover per conversation after closing/reopening or refreshing. File path/sort/scroll/bookmarks keep their existing persistence. File filters, path drafts and reconciled selections survive module/panel switches within one webpage; a full reload fetches fresh entries and does not restore old selections.
- **设置 → 终端** contains font size, wrapping, highlighting and the active SSH connection size. Search and current transcript export are directly beside the session tabs; **更多** contains independent commands and all-log ZIP export. The path and technical status sit in the bottom status bar. ASCII/SGR logs use a fast parser; cursor control, Unicode and full-screen programs retain the VT model.
- Embedded pages default to a viewport following the panel, with an optional 1024×768 desktop viewport. Resizing does not deliberately navigate/reload; the website's responsive behavior can still change content. Independent windows use their own size. Page titles and close-current-tab are available; display switching warns that pages reload and unsaved inputs can be lost.
- Files add filtering, select-all, Shift range selection and Enter for directories. Narrow panels switch between source A and target B, copy labels identify the destination, and finished transfer history is collapsed. Browser upload/download refers to the browser device, distinct from the DSH host.
- UI independent commands run in the backend and survive closing the result view, switching modules and refreshing DSH Web. Reopening reads the current target's latest job/result. Completed results are memory-only, capped at 32 records and ten minutes; command drafts survive only within the current webpage. DSH restart does not restore/replay commands. A timeout/unknown remote exit never proves process termination.
- Panel-local dialogs replace browser prompts/confirmations, contain Tab and close with Escape/restore focus. The main conversation remains usable. Environment validation and directory retry appear beside the operation; diagnostics show readable event summaries with expandable JSON.

Human and Agent input is shared throughout the conversation.

## Shared web operations

Type a URL in **Web / 网页** and press Enter. No saved site is required. Choose an embedded interactive live view or an independent browser window; the Agent uses the same selected browser through the DSH conversation. Human input remains available during automation.

Use native DSH conversation cancellation to stop the Agent. Later browser steps stop; an already submitted action cannot be undone. Workspace switches, Sidebar closure and DSH page reloads keep backend browser jobs alive.

XPath/CSS/role/label/text/placeholder, iframes, popups, optional saved login/flows, result checks and collapsed operation records are supported. The internal Chromium Headless Shell is bundled with the plugin; activation prepares it offline and verifies it can launch. No separate browser installation is needed with a complete bundle. Independent windows use installed Edge / Chrome or optional full Chromium. Independent windows require an interactive desktop shared with DSH. Changing display reloads the pages and preserves login cookies; unsaved forms are not restored. See [Web guide](WEB.md).

Use **开始录制 / 停止录制** to record human and Agent webpage operations; **录制记录** reads saved records and exports framework-neutral JSON. The Agent has the same start/stop/read/export capability through `remote_browser_recording`. The bundled [remote-ops-web-recordings skill](skills/remote-ops-web-recordings/SKILL.md) explains recorded password values, incomplete outcomes, device-address parameterization and how the Agent generates code in the user's framework or template. Code generation and test execution are outside the plugin.

## Capabilities

- Environment groups persisted as `remote-ops/environments/<group>/environments.<group>.json`.
- The workspace uses terminal/web/API/file tabs, an in-panel environment view, and a quick-command dock below the terminal.
- Environments and quick commands support manual create, edit, delete, and group management; non-empty groups cannot be deleted.
- Owner-scoped SSH sessions backed by the Harness `ctx.terminals` service.
- A local CMD terminal starts with the plugin at `$DSH_HOME/remote-ops`, before an Agent is initialized. It accepts ordinary local commands and interactive `ssh`; saved-environment SSH sessions fall back to this terminal after disconnecting.
- Complete command submission, direct terminal keyboard input, signals, and retained output; Tab completion, arrows, backspace, Enter, and Ctrl+C are forwarded as terminal keys.
- SSH sessions request a UTF-8 locale and the UI renders common ANSI colors and VT controls; the backend accepts UTF-8, GB18030, Big5, and related terminal encodings.
- A lightweight VT screen model applies ConPTY clear, cursor, line-rewrite, and scroll operations, avoiding blank screen snapshots while keeping the final line reachable through a stable scrollbar.
- Cursor-based output deltas use long polling and serialized batched keyboard writes, keeping idle terminals to one request waiting for output.
- Sequential multi-target execution for observe-then-continue workflows.
- SFTP list, read, write, mkdir, delete, and rename operations.
- Browser upload batches belong to the plugin and continue across terminal, SFTP, and Remote Ops panel switches within the same browser page. The header upload button restores progress and cancellation controls. Each batch keeps its original Harness owner, destination, and conflict policy; changing sessions cannot move or cancel another owner's batch. Overwrite previews are confirmed before the batch starts; leaving during confirmation does not start an upload.
- Explicit cancellation aborts the current browser request and stops the remaining batch. Cancellation/failure feedback survives panel remounts. Cancellation is not rollback: the server may already have received and completed the current file; completed files remain. Reloading or closing the browser page warns about active uploads; proceeding, unloading the plugin, or stopping DSH may interrupt them. After a page reload, inspect completed files before starting a replacement upload.
- The first transfer poll establishes a history baseline. New completions refresh each matching pane once per poll; a busy pane queues only one follow-up request. Refresh keeps current entries, scroll position, and selections that still exist; navigating to a different directory clears old selection.
- Narrow workspaces switch between source A and target B. Finished history is collapsed and file lists retain usable height.
- Quick command storage and execution.
- Agent-visible diagnostics and a native DSH right-sidebar tab.
- The `Remote Ops` action at the bottom of the DSH Web left sidebar opens the native right Sidebar while preserving the conversation and draft. Repeated clicks reuse the existing tab; collapsing it returns to the conversation. Expanded left-sidebar entries align the icon and label to the left with native host entries; collapsed entries keep a centered icon and Tooltip.
- **设置 → 更新** configures GitHub or HTTP/HTTPS sources and manually checks/installs updates. Running and installed versions are shown separately; compatible updates activate automatically when idle.
- The quick-command dock can be resized by dragging its top boundary (double-click
  to restore the default height). The environment form hides the internal Harness
  credential reference; SSH passwords are stored through the Harness credentials service.
- Connection errors remain visible until dismissed. Passwords are stored through Harness credentials;
  environment files contain references, not plaintext passwords. The host manages conversation and tool-call history.

## Installation

Install the release tarball with the official DSH plugin manager. The
`dsh.bundle.patch` declaration activates the bundle automatically; do not copy
the patch into the profile by hand.

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.15.7.tgz
dsh web
```

CLI installation must use the same user, DSH_HOME and profile as the running host. After CLI installation, use the activation-only button if the running version remains old. If the old updater is stuck or hot reload is unsupported, restart once after installation completes. Prefer the plugin update dialog for subsequent upgrades, and verify that both running and installed versions show the target version. A full DSH restart does not restore in-memory tasks or connections.

For a package obtained from a registry, the package name is:

```sh
dsh plugin --profile web add @dsh/remote-ops
```

The GitHub release asset is the canonical artifact for this repository. A
local checkout can also be packed with `npm pack` and installed with the same
command.

The plugin uses DSH Agent, terminal, tools, system-prompt, credentials and connection services. SSH PTYs are process-local by design; saved environment definitions
survive restarts and reconnect on demand.

After DSH Web starts, click `Remote Ops` at the bottom of the left sidebar.
The native right Sidebar preserves the main conversation and draft.
Tested on DSH `0.2.0-rc.2`; other versions remain untested. Check the installation
profile, host/plugin versions and old processes if the entry is missing.
On narrow screens the host may present the right Sidebar full screen; collapsing
it returns to the original conversation.

## Interactive Workspace

- Enter reuses an existing connection or offers a chooser; the separate plus action opens a new connection (maximum three per environment and owner). Inspect owner/activity and release individual connections. Hosts exposing `sessionController.resolveAgent` can resume a saved session without a model prompt; an unsaved draft is not an SSH owner.
- Human and Agent share terminal input, including while a conversation runs. Native DSH cancellation attempts Ctrl+C when a terminal send is still waiting; already returned commands and remote background processes may continue. Cancellation is not evidence of process exit. Direct keyboard Ctrl+C and SSH connection release remain available.
- Quick buttons below terminal output dispatch the complete saved command plus Enter to the currently visible terminal without a model round trip. Management supports multiline editing, groups, search, ordering, pin/unpin and optional confirmation. Unpinning retains the library entry; deletion requires confirmation. Multiline paste still requires confirmation.
- The dock opens by default and remembers its height and collapsed state. Drag its top border with a mouse or touch, use arrow keys, or double-click to restore 190px. Height adapts to available plugin space and preserves a minimum terminal viewport. The command list scrolls internally. The outer Sidebar width remains owned by Harness.
- Dispatch captures the owner, exact terminal, stream and command revision. It neither reconnects nor switches targets. A bounded in-memory receipt cache deduplicates the same request for ten minutes (1024 entries maximum); the UI never automatically retries an uncertain write. Written means accepted by the terminal, not completed. Unsubmitted input from this browser blocks dispatch, but arbitrary interactive-program state and edits from other browsers cannot be inferred. Human and Agent input remains shared.
- Both file panes independently select the DSH host or an SSH environment. Browser upload/download refers to the browser device. Files and directories can be selected together; SSH-to-SSH copies stream through the DSH host. Uploads and downloads stream files with backpressure.
- Transfers report bytes/files, cancellation and error/skip/overwrite conflict policies. Tool overwrite requires `overwrite: true`. Two jobs run concurrently, at most 20 are pending/running and 50 recent records are kept. Jobs are not resumed across restarts. Cancellation removes incomplete staging files, not already completed files/directories. Symlinks/devices are not followed; traversal is limited to depth 32 and 10,000 entries. Remote overwrite requires the atomic rename extension.
- Errors retain phase, code and original causes. Diagnostic export previews a metadata whitelist without credentials, command text, host addresses or terminal content.

## Data Storage

The plugin stores its own data under `$DSH_HOME/remote-ops`:

- `environments/<group>/environments.<group>.json` for environment definitions.
- `quick-commands/<group>/commands.<group>.json` for reusable commands.
- `browser/` for sites, flows, display preferences and dedicated profiles.
- `api/environments.json` for API environments and credential references.
- `update-settings.json` for update source configuration.

Use a Harness credential reference such as `passwordRef` for passwords. The
Sidebar form also accepts an SSH password and stores it through
`credentials.set`; the environment JSON keeps only the reference. A private
key may be referenced by local path.

## Agent tools

The plugin exposes `remote_environment_list`, `remote_environment_create`,
`remote_environment_update`, `remote_environment_delete`, group management, terminal
open/send/read/signal/close, multi-target batch execution, quick-command list
and run, SFTP operations, and diagnostics. The system-prompt contribution tells
the model to send a complete command when it is known and to use incremental
terminal feedback only when the current CLI state is genuinely uncertain.

### Saved SSH environment management

Use `/remote-ops-environments` or let the Agent discover the bundled skill. List environments first and use the returned internal `id` for updates/deletion. Creation requires `host` and `username`, generates the ID, and defaults the name to the host. Groups support `remote_environment_group_create`, `_rename` and `_delete`; only empty groups can be deleted.

An update changes only supplied non-null fields. For example, call `remote_environment_update` with:

```json
{"environment":"actual-id-from-list","name":"storage-primary","group":"production"}
```

Supported fields: `name`, `host`, `username`, `group`, `port`, `privateKeyPath`, `passwordRef`, `encoding`, `cliProfile`, `terminal`. The ID stays fixed. Omission/null retains the old field; an entirely empty update rejects. Non-empty text is required for name/host/username/group. Port must be an integer 1–65535. Name conflicts, unknown fields, invalid nested options and the credential display marker `configured` reject before writing. Exact IDs take precedence over matching display names.

`cliProfile` and `terminal` replace their entire respective sections when supplied; `{}` resets a section to defaults. Empty `passwordRef`/`privateKeyPath` strings clear that setting without deleting the stored credential or key file. These tools accept a user-supplied password or an existing credential reference. The plugin stores new passwords through DSH credentials; GUI entry is optional. Omit the masked `passwordRef: "configured"` returned by listing when retaining authentication.

Saved changes apply to new SSH connections. Existing connections retain their captured name, address, authentication and CLI/terminal defaults; the tool does not disconnect or reconnect them. `saved: true` confirms persistence, not connectivity. Environment deletion removes the saved definition and closes connections owned by the calling conversation, leaving other conversations' already-open connections intact. A group move creates an absent target group and leaves the old group present.

Use `session: "local-cmd"` for the plugin's shared visible local terminal,
not the Harness built-in bash/pwsh tool. For SSH, reuse an explicit session
from the environment list. Sending by environment reuses a unique connection;
multiple connections require an explicit session id.

`remote_terminal_send` waits for fresh output and returns `output`,
`submittedText`, `submit`, `streamId`, `startOffset`, `nextOffset`, `endOffset`,
`hasMore`, `reset`, and `truncated`. The default output page is 16,384 UTF-16
code units, with surrogate pairs kept intact. Old viewport history is omitted
unless `includeViewport: true` is requested. To continue without typing:

```json
{"session":"local-cmd","cursor":546,"streamId":"<streamId from send/read>","waitMs":20000}
```

Pass that object to `remote_terminal_read`, replacing the cursor with the
previous `nextOffset`. Drain `hasMore` before waiting. Omit the cursor for
recent history; explicit `offset`/`count` selects backward line history.
`reset`/`truncated` signals replaced or expired history. Tool output is the
raw terminal stream, including control sequences; the UI renders that stream
through its VT model. A running shell, silence (`inferred_idle`), and timeout
do not prove command completion or success: `completion` remains `unknown`.
Observe actual results before dependent commands. Cancellation interrupts the
foreground process; a wait timeout alone does not kill it.

### CLI assist for device REPLs

`remote_terminal_send` (and `remote_terminal_batch` / `remote_quick_command_run`)
accept options that remove model round trips on vendor CLIs. They apply only to
Agent sends, never to manual UI input, and every applied step is returned in
`autoActions` and written to the diagnostics events.

Read device confirmation prompts and verify the intended operation before replying with `remote_terminal_send`. For a known sequence the user has approved, declare matching prompts and reply text in `remote_terminal_script` `answers`.

| Option | Default | Behavior |
| --- | --- | --- |
| `autoQuitMore` | `false` | When the output ends with a `--More--` pager line, send `q` (no Enter), wait 300 ms and return the remaining output; at most 3 times per call. |
| `autoSigint` | `true` | When the last 2 KB of this send's output contains a parameter-error hint (`^` arrow line followed by `[param=?]` suggestions, `/\n\s+\^\s*\n\s*\[.*\=.*\]/m`), send SIGINT, wait 500 ms and append `[auto-sigint: command line cleared]` to the returned `output`. The marker is not written to the terminal stream. Set `false` to disable. |

### Environment profiles, output options, scripts and terminal size

- **Environment profile.** An environment may carry `cliProfile`
  (`autoQuitMore`, `autoSigint`, `stripAnsi`, `headTailChars`) and a default PTY
  `terminal: { rows, cols }`. They are edited in the environment form or passed
  to `remote_environment_create`.
  Call arguments always override the profile; values equal to the defaults are
  not stored, saving an empty value clears the profile, and omitting the field
  keeps it. `remote_environment_list` shows the profile to the model.
- **`stripAnsi`** (send/read/batch/quick-run/script) removes ANSI/VT control
  sequences from the returned text. Offsets and cursors keep counting the raw
  stream; a page never ends inside an escape sequence.
- **`headTailChars`** (200-100000, `0` = off) returns only the first and last N
  characters of a long page with a marker. The result carries `summarized: true`
  and `omitted` (`chars`, `lines`, raw `startOffset`/`endOffset`); read the
  omitted range with `remote_terminal_read` using `cursor=omitted.startOffset`.
  A summarized send is recorded as a truncated tool receipt.
- **`remote_terminal_script`** runs up to 20 ordered steps on one exact session
  in one call. A step has `text`, optional `submit`, `quietMs`, `timeoutSeconds`,
  `answers` (`[{ pattern, text, submit?, times? }]`, tried in order, at most
  `times` each), `expect` (regex that must match the end of the step's output)
  and `failOn` (regex searched in the whole output, even where a summary hides
  it). Everything is validated before the first character is typed. The script
  stops at the first error, timeout, failed check or session exit and returns
  every executed step in `steps` plus `stopped`; remaining steps are not run.
  `completion` stays `unknown`.
- **`remote_terminal_resize`** changes the PTY of an SSH connection
  (`rows` 10-200, `cols` 40-500); **设置 → 终端** has a size selector for the active SSH connection and
  frames report the PTY size so the VT model wraps at the real width. The shared
  local terminal is fixed at 40x160 (the host has no resize API) and connections
  held by the host after a plugin reload cannot be resized.
- **Dropped connections.** A connection remembers why it closed (transport
  error, remote exit code). Unexpected drops are listed in
  `remote_environment_list` as `disconnects` and in diagnostics; sending to a
  dead connection explains that nothing was replayed and how to reopen it, and a
  send that ended because the connection dropped carries `reconnect`.
- **Hardening.** `remote_terminal_send` and `remote_terminal_read` only forward
  their declared arguments, so an undeclared `actor` cannot change Agent
  receipt attribution. Input itself is shared.

The terminal status bar distinguishes transport, Agent binding, and the last
tool response range/time. A tool receipt is not proof that a model understood
the output. Enlarged icon controls have tooltips. The quick-command dock
remembers its expanded state; reading history is preserved across SFTP switches, and new
output offers a jump to the latest line without taking over the scroll position.

The client dependency on `sidebarRight` and `sidebarRightTabs` is optional at
activation time. The Sidebar UI attaches automatically when those services become available.

## Independent Commands and Workspace State

Use `remote_command_execute(session, command)` for self-contained commands.
It returns separate bounded UTF-8 stdout/stderr, a real exit code when supplied
by the process, duration and truncation flags. It never types into the PTY.
Local execution starts a new shell in the plugin directory; SSH opens an exec
channel on an existing connection with the server-default directory. Neither
inherits the interactive terminal's temporary variables or current directory.
There is no stdin. Timeout/cancellation does not prove a remote process stopped.
Limits: 30 seconds by default, 300 seconds maximum, 64 KiB per output stream by
default, 256 KiB maximum, one active command per target and eight total.

Connections use their environment name; exact session IDs still select and close
individual connections. Disconnected tabs retain their output until dismissed;
reconnection is explicit and never replays commands. Manual input is shared
across browser windows. Human/Agent input
shares the same input stream; simultaneous input can interleave. Recreated
terminal streams require input acknowledgement.

SFTP remembers endpoint, path, sort, scroll and bookmarks per Harness session
in browser storage. Transfer results include per-item state; retries skip
completed items. Overwrite previews show both sizes and timestamps. Tasks and
receipts are runtime-only, not cross-restart persistence.

The lightweight terminal supports alternate screens, scroll regions and charset
selection escapes. Full-screen grids do not soft-wrap. The current Harness
local PTY uses a fixed 160x40 grid. Actual OS IME behavior requires device testing.

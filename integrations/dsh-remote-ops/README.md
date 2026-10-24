# @dsh/remote-ops

Standalone DeepSeek Harness plugin for SSH, web and RESTful API operations. It does not
depend on or start the myterm desktop application.

## Manual intranet HTTP/HTTPS updates (v0.8.2)

Open Remote Ops → **更多设置 → 检查更新**, save a source, then choose **仅检查版本** (check only) or **检查并更新** (check and install). GitHub Release remains the default source; custom intranet updates accept HTTP/HTTPS URLs only. Opening the panel/dialog performs no external check. There is no scheduled updater or automatic restart. Running and installed versions are shown separately; fully restart DSH and refresh the browser to activate the new version. A pending-restart version is not installed again.

Keep `latest.json`, `dsh-remote-ops-v0.8.2.tgz` and `SHA256SUMS-dsh-remote-ops-v0.8.2.txt` in the feed directory. Generate the manifest from the unchanged official release pair:

```sh
node integrations/dsh-remote-ops/scripts/create-update-manifest.mjs ./release/dsh-remote-ops-v0.8.2.tgz
```

The installed package also includes `scripts/create-update-manifest.mjs`. An optional second argument chooses an existing parent directory's `latest.json`, allowing version subdirectories. The script verifies checksum and package identity, refuses a lower version, and writes the manifest atomically. Upload the tgz/checksum first and publish the manifest last. Serve the directory over HTTP/HTTPS. GitHub Release still contains only tgz and SHA256.

- HTTP(S): directory URL or latest.json URL; all files/redirects must remain on that origin. Credential/query-token URLs and custom auth headers are not supported. Trust internal HTTPS certificates in the DSH Node process.
- Dependencies use the existing DSH registry/proxy/build-approval configuration. Provide an accessible internal npm registry when needed. Chromium remains an on-demand separate installation.

Verified packages are cached on the DSH host and installed by the current profile's native DSH plugin manager. Invalid checksums never install; older versions never downgrade automatically. Source settings live in $DSH_HOME/remote-ops/update-settings.json and are shared within that DSH home; installation affects only the current profile. Installation errors expose a reason/log location. Restoring profile manifests/lockfiles is not a full cache rollback. Installation does not close active connections; tasks do not survive a DSH restart. Existing older installations need one manual bootstrap upgrade. The bundled remote-ops-updates skill describes configuration, feed generation and diagnostics without Agent changes.

## Saved RESTful environments and execution workspace (v0.8.0)

- The new **API** workspace saves base URLs, groups, common headers, timeout, private CA and login configuration. API targets work without SSH; an optional SSH environment ID links the same device without sharing credentials.
- A single POST login sends username/password as JSON or form and extracts a Token through JSON Pointer or a response header, or stores scoped Cookies. Cookie-to-CSRF-header mapping is supported. Passwords use DSH credentials; configuration stores references. Login sessions are isolated by conversation and remain in memory only.
- UI and Agent requests share visible login/request records, HTTP status, timing, redacted responses, errors and unknown outcomes. Export the current conversation's records as JSON. HTTP 2xx still requires checking the business response.
- Bundled 'remote-ops-api' plus 'remote_api_environment_list/save/delete', 'remote_api_login', 'remote_api_request' and 'remote_api_records' are discovered on plugin installation. No Agent changes. List first, use exact returned IDs, log in, execute, then inspect receipts.
- Requests originate on the DSH host. Both '/items' and 'items' preserve the base URL's path prefix. No automatic redirects, reauthentication or replay. After a timeout/cancellation with an unknown outcome, query device state before any retry.
- Configuration persists in '$DSH_HOME/remote-ops/api/environments.json'; login state, records and duplicate-ID protection cover only this process's last 100 requests per conversation. Response preview: 128 KiB; request body: 1 MiB. Edits invalidate login; running requests keep their captured target. Switching tabs does not cancel requests.
- This first version excludes multi-step SSO, CAPTCHA/MFA, automatic token refresh, binary downloads and file upload. Credentials and known authentication values are redacted; business payloads may still contain sensitive data. Release assets remain tgz and SHA256 only.

## Local CMD commands and directory colors (v0.7.2)

The terminal uses a [Catppuccin](https://catppuccin.com/palette/)-inspired Latte / Mocha palette following the DSH light/dark theme: purple commands, teal directories and blue files. Light accents are darkened for readable text contrast. Surrounding plugin controls retain the host styling.

Commands echoed after a standard prompt now use the same accent, weight and subtle background whether typed manually, sent as a complete Agent command or entered through raw keys. Recognition runs after terminal cursor redraws, so visible edits/backspaces remain readable. No extra command is executed and hidden input is never added to the display.

Standard `dir` rows show directory names in teal and file names in blue, leaving timestamps, sizes and totals unchanged. Existing ANSI colors are retained. Common CMD, PowerShell and `user@host` Shell prompts are recognized; custom prompts and formats without type information, such as `dir /b`, are not guessed. Full-screen applications do not receive these semantic colors. Terminal display settings can disable them; copied, searched and exported text stays unchanged. No Agent or command changes are required.

## Reveal environment passwords on demand (v0.7.1)

The SSH password field in the environment editor now has an eye button. It stays masked by default and resolves the currently effective saved credential only on request. Hiding the password or closing the editor/drawer clears the revealed value. Newly typed passwords can also be shown for checking.

Viewing alone never changes the credential: saving other fields preserves it; typing a replacement updates it. Missing configuration, missing credentials and unavailable providers have clear retry/re-entry messages. Revealed values are not written to browser storage, environment listings, diagnostic records or Agent tool results. No Agent password-reading tool or Agent modification is introduced. The bundled environment-management skill describes the user-facing path.

## Terminal highlighting and log APIs (v0.7.0)

- Echoed single-line Agent submissions use an accent color; ordinary output retains common ANSI colors. Error, warning and success prefixes receive restrained emphasis. Disable semantic highlighting in terminal display settings. Styling never changes terminal bytes; hidden input is never added; v0.7.2 additionally highlights manual/raw input echoed after common prompts. Prefix colors are not verified exit-status evidence, and full-screen programs receive no semantic highlighting.
- The terminal log menu exports the current terminal as UTF-8 TXT, or all available conversation logs as ZIP, including retained closed SSH records and the shared local terminal. Each ZIP contains separate transcripts and a `manifest.json` with source, time and coverage metadata.
- `remote_terminal_logs`, `remote_terminal_log_read` and `remote_terminal_log_export` provide discovery, raw-cursor pagination and packaging. The export tool returns SHA256 and an absolute download link for the observed trusted DSH browser origin (or null when unavailable; use the toolbar); the Agent need not copy screen text, read every page or run archive commands.
- The bundled `remote-ops-terminal-logs` skill is automatically discoverable through DSH, with `/remote-ops-terminal-logs` also available. The tgz carries both tools and instructions; no Agent/core or user skill-file changes.
- Retention is process memory: 4 MiB per terminal, trimmed to the latest 3 MiB on overflow; closed records share a 16 MiB / 32-record limit. APIs disclose truncation and evictions. History does not survive restart. Hidden/raw input is not logged separately, but secrets printed by programs can still be present.
- A package accepts at most 32 logs / 32 MiB raw output. Download cache is limited to 10 packages / 32 MiB; links expire after one hour, earlier eviction or host restart. Exports freeze current buffers; later output needs a new export. Progress frames are retained as lines, not a replay of a full-screen application. Independent commands and browser activity are separate records.

## Agent environment management (v0.6.1)

`remote_environment_update` completes the Agent environment CRUD tools. The new bundled `remote-ops-environments` skill covers selecting targets, updates, groups, credentials and existing connections. Both it and `remote-ops-browser` register automatically through DSH's native skill provider; user/project skills retain precedence and uninstall removes the provider. No Agent/core changes or user skill-file writes are required. Releases contain only tgz and SHA256.

## Interface and interaction refresh (v0.6.0)

- Terminal, web, files, environments, saved commands and diagnostics share consistent typography, spacing, controls and host-aware light/dark surfaces. Workspace tabs stay at the top; version, updates, diagnostics and comfortable/compact density live under **更多设置**. Density persists in this browser.
- Terminal identity and tools share one context row; a separate session strip appears only for multiple terminals. Input, search, independent commands and quick commands remain available.
- The web workspace prioritizes the address and live page. **网页设置** contains engines, Chromium installation, saved sites and flows; **操作记录** opens on demand. **画面设置** in the footer controls the viewport. Closing settings retains the URL draft and current page.
- Switching an open page between embedded and independent display requires confirmation. Cancel dispatches nothing; confirming reloads the page and may lose unsent form content. Switching cannot be submitted repeatedly while pending.
- File batch actions appear after selection. Upload controls match other buttons, and browser uploads show byte progress. Module switches retain selection, drafts and background jobs; completed transfers still use coalesced directory refreshes.

The left action still opens the native DSH right sidebar. Human and Agent input remain shared; use native conversation cancellation. Releases contain only tgz and SHA256, with Chromium installed on demand over the network. Agent/core are unchanged.

## Browser arguments and on-demand runtime (v0.5.4)

Future Releases contain only the plugin `tgz` and its `SHA256SUMS`; no new `windows-x64.zip` is built. Historical v0.5.3 assets remain available. The plugin has no browser binaries; npm dependencies require network access, and the Agent can install matching Chromium through plugin tools when needed.

- Independent windows follow the Windows user's default HTTP(S) browser on the DSH host, supporting installed Chrome / Edge with an isolated plugin profile. Embedded mode still defaults to matching Chromium. Each mode has its own engine preference; the previous embedded preference is retained. Explicit saved-site or tool browser choices take precedence. Unsupported/unavailable defaults report an error instead of silently opening Edge. A remote DSH host's default is separate from the client viewing DSH.
- Prefer an action array for `steps`. Single action objects, a sole `{steps:[...]}` envelope and JSON-encoded versions are accepted. Prefer `{kind,value,name?,frame?}` locator objects for `target`; JSON-encoded locator objects and CSS/XPath strings (`css=#id`, `xpath=//button`, `#id`, `//button`) are accepted. All steps normalize and validate before dispatch. Equivalent requests deduplicate under the same `requestId`; missing targets are not guessed and arbitrary JavaScript is unsupported.
- For missing Chromium, call `remote_browser_runtime` with `action: "status"`, then `action: "install"` if needed. Poll `status` until the required mode is ready before opening a page. The plugin's installed Playwright CLI downloads its matching Chromium and Headless Shell. The settings button uses the same installer. Network access is required; configure `HTTPS_PROXY`, `PLAYWRIGHT_DOWNLOAD_HOST` or `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` before starting DSH if needed. Complete matching runtimes are reused and login profiles/sites/flows retained.
- `BROWSER_STEP_INVALID` identifies the field, accepted format and no-dispatch status. Correct the argument instead of repeating an unchanged invalid call; preflight rejection does not reserve the request ID. Fixes, Schemas, tool metadata and the bundled skill travel with the tgz, without Agent/core changes. Restart DSH and refresh its webpage after upgrading; verify the current version in **更多设置**.

## Parameter Schemas and optional nulls (v0.5.2)

This release fixes plugin tool definitions that were not standard JSON Schema and optional browser-step nulls that caused `BROWSER_STEP_INVALID`. Tool schemas, validation and the bundled `remote-ops-browser` skill ship together in the tgz; no Agent or DSH core changes are needed.

- Every plugin tool exposes a standard parameter Schema. Browser actions/locator kinds are enumerated, with required fields per action: `goto` needs `url`; every other step needs a structured `target`, including `read`. Use `remote_browser_read` directly to observe the whole page.
- Optional browser nulls mean absent; a blank `target.frame` uses the main page. Empty fill text is preserved. `fill`, `press` and `select` still require a real value; passwords continue to use the saved site's reference.
- Validation reports field paths such as `steps[1].target.frame` before any action in the run is dispatched. Null and omitted options normalize to the same operation for deduplication; no automatic retry or guessed locator is added.
- The gate checks complete Schemas; real DSH acceptance checks actual model-request tool definitions and webpage results. Stop the old DSH process, restart and refresh to confirm `v0.5.3`. The bundled skill registers automatically.

## Browser operation argument fix (v0.5.1)

This release fixes empty `flowId` overriding valid inline `steps` and producing repeated `BROWSER_FLOW_NOT_FOUND` errors. Validation, tool descriptions and the `remote-ops-browser` skill ship in the plugin tgz; **no Agent or DSH core changes or separate skill copying are required**.

- For ordinary webpage actions, pass a `steps` array and omit `flowId`. Null, empty and whitespace-only flow IDs are treated as absent.
- Saved flows use an existing `flow.id` from the list with `flow.siteId` matching the browser's `siteId`. A nonblank flow ID together with nonempty steps is rejected. Saved-flow calls may omit steps or pass an empty array.
- Source conflicts, missing operation sources, malformed steps, missing flows and site mismatches have distinct errors and recovery guidance. These preflight rejections dispatch no action, do not retry or switch browsers, and preserve credential-origin restrictions.
- The plugin registers `remote-ops-browser` globally through DSH's native skill service, for automatic discovery/loading or explicit `/remote-ops-browser` invocation. Unloading removes the registration; no user skill files are written or overwritten. Verified on DSH 0.2.0-rc.2.
- Fully stop the old DSH process after installation, restart it and refresh DSH Web to reload the plugin, skill and tool descriptions. An intranet computer only needs the same tgz, with no Agent configuration migration.

## Workspaces and interaction (v0.5.0)

- **终端 / 网页 / 文件** workspace tabs support arrows and Home/End. Environment management opens inside the panel; **更多设置** contains diagnostics, refresh and updates. The native DSH right Sidebar and the main conversation are preserved.
- The module, selected terminal and environment filter recover per conversation after closing/reopening or refreshing. File path/sort/scroll/bookmarks keep their existing persistence. File filters, path drafts and reconciled selections survive module/panel switches within one webpage; a full reload fetches fresh entries and does not restore old selections.
- **终端显示设置** contains font size, wrapping and PTY size; **状态详情** contains Agent binding and tool receipts. ASCII/SGR logs use a fast parser; cursor control, Unicode and full-screen programs retain the VT model.
- Embedded pages default to a viewport following the panel, with an optional 1024×768 desktop viewport. Resizing does not deliberately navigate/reload; the website's responsive behavior can still change content. Independent windows use their own size. Page titles and close-current-tab are available; display switching warns that pages reload and unsaved inputs can be lost.
- Files add filtering, select-all, Shift range selection and Enter for directories. Narrow panels switch between source A and target B, copy labels identify the destination, and finished transfer history is collapsed. Browser upload/download refers to the browser device, distinct from the DSH host.
- UI independent commands run in the backend and survive closing the result view, switching modules and refreshing DSH Web. Reopening reads the current target's latest job/result. Completed results are memory-only, capped at 32 records and ten minutes; command drafts survive only within the current webpage. DSH restart does not restore/replay commands. A timeout/unknown remote exit never proves process termination.
- Panel-local dialogs replace browser prompts/confirmations, contain Tab and close with Escape/restore focus. The main conversation remains usable. Environment validation and directory retry appear beside the operation; diagnostics show readable event summaries with expandable JSON.

Human and Agent input stays shared. No takeover/pause/stop buttons or corresponding tools were added. The separately deferred SSH argument-space issue is outside this release.

## Shared web operations (v0.5.0)

Type a URL in **Web / 网页** and press Enter. No saved site is required. Choose an embedded interactive live view or an independent browser window; the Agent uses the same selected browser through the DSH conversation. Human input remains available during automation, with no takeover or handback.

The browser and terminal panels have no takeover, pause or stop buttons, and no dedicated Agent tools for these controls. Use native DSH conversation cancellation to stop the Agent. Later browser steps stop; an already submitted action cannot be undone. Workspace switches, Sidebar closure and DSH page reloads keep backend browser jobs alive.

XPath/CSS/role/label/text/placeholder, iframes, popups, optional saved login/flows, result checks and collapsed operation records are supported. Install Chromium in browser settings or choose installed Edge / Chrome. Independent windows require an interactive desktop shared with DSH. Changing display reloads the pages and preserves login cookies; unsaved forms are not restored. See [Web usage and boundaries](WEB.md).

## Capabilities

- Environment groups persisted as `remote-ops/environments/<group>/environments.<group>.json`.
- The workspace uses terminal/web/file tabs, an in-panel environment view, and a quick-command dock below the terminal.
- Environments and quick commands support manual create, edit, delete, and group management; non-empty groups cannot be deleted.
- Owner-scoped SSH sessions backed by the Harness `ctx.terminals` service.
- A local CMD terminal starts with the plugin at `$DSH_HOME/remote-ops`, before an Agent is initialized. It accepts ordinary local commands and interactive `ssh`; saved-environment SSH sessions fall back to this terminal after disconnecting.
- Complete command submission, direct terminal keyboard input, signals, and retained output; Tab completion, arrows, backspace, Enter, and Ctrl+C are forwarded as terminal keys.
- SSH sessions request a UTF-8 locale and the UI renders common ANSI colors and VT controls; the backend accepts UTF-8, GB18030, Big5, and related terminal encodings.
- A lightweight VT screen model applies ConPTY clear, cursor, line-rewrite, and scroll operations, avoiding blank screen snapshots while keeping the final line reachable through a stable scrollbar.
- Cursor-based output deltas use long polling and serialized batched keyboard writes, so idle terminals no longer transfer complete snapshots or generate frequent empty requests.
- Sequential multi-target execution for observe-then-continue workflows.
- SFTP list, read, write, mkdir, delete, and rename operations.
- Browser upload batches belong to the plugin and continue across terminal, SFTP, and Remote Ops panel switches within the same browser page. The header upload button restores progress and cancellation controls. Each batch keeps its original Harness owner, destination, and conflict policy; changing sessions cannot move or cancel another owner's batch. Overwrite previews are confirmed before the batch starts; leaving during confirmation does not start an upload.
- Explicit cancellation aborts the current browser request and stops the remaining batch. Cancellation/failure feedback survives panel remounts. Cancellation is not rollback: the server may already have received and completed the current file; completed files remain. Reloading or closing the browser page warns about active uploads; proceeding, unloading the plugin, or stopping DSH may interrupt them. Uploads do not survive page reloads and do not support byte-level resume.
- The first transfer poll establishes a history baseline. New completions refresh each matching pane once per poll; a busy pane queues only one follow-up request. Refresh keeps current entries, scroll position, and selections that still exist; navigating to a different directory clears old selection.
- Narrow workspaces switch between source A and target B. Finished history is collapsed and file lists retain usable height.
- Quick command storage and execution.
- Agent-visible diagnostics and a native DSH right-sidebar tab.
- The `Remote Ops` action at the bottom of the DSH Web left sidebar opens the native right Sidebar while preserving the conversation and draft. Repeated clicks reuse the existing tab; collapsing it returns to the conversation. Expanded left-sidebar entries align the icon and label to the left with native host entries; collapsed entries keep a centered icon and Tooltip.
- **更多设置 → 检查更新** configures GitHub or HTTP/HTTPS sources and manually checks/installs updates. Running and installed versions are shown separately; restart DSH after installation.
- The quick-command dock can be resized by dragging its top boundary (double-click
  to restore the default height). The environment form hides the internal Harness
  credential reference; SSH passwords are stored through the Harness credentials service.
- Connection errors remain visible until dismissed; credential references through Harness credentials and plaintext passwords are
  never persisted.

## Installation

Install the release tarball with the official DSH plugin manager. The
`dsh.bundle.patch` declaration activates the bundle automatically; do not copy
the patch into the profile by hand.

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.8.2.tgz
dsh web
```

For an upgrade, install as the same user and with the same `DSH_HOME` used by
DSH, and use its actual profile rather than assuming `web`. Fully stop the old
DSH process after installation, restart it, refresh the browser, and confirm
`v0.8.2` in Remote Ops **更多设置**. Saved environments and quick commands
remain; terminal connections must be reopened.

For a package obtained from a registry, the package name is:

```sh
dsh plugin --profile web add @dsh/remote-ops
```

The GitHub release asset is the canonical artifact for this repository. A
local checkout can also be packed with `npm pack` and installed with the same
command.

The plugin is a pure DeepSeek Harness plugin and this repository no longer
contains the myterm desktop application. It works in DSH hosts that provide the
documented Agent, terminal, tools, system-prompt, credentials, and connection
services. SSH PTYs are process-local by design; saved environment definitions
survive restarts and reconnect on demand.

The client supports the `Regular` icon exports in DSH 0.2.0-rc.2 and falls back
to the size-based exports used by older hosts. Version 0.2.23 fixes the blank
Remote Ops panel caused by the icon export change.

After DSH Web starts, click `Remote Ops` at the bottom of the left sidebar.
The official `sidebar.footer.action` seat calls `sidebarRight.openTab`; it no
longer registers a `sidebar.panellist` / `main` replacement. The published tab
identity and session ownership remain compatible. The launcher retries within
a bound and reports unavailable services without creating a fallback conversation.
Tested on DSH `0.2.0-rc.2`; other versions remain untested. Check the installation
profile, host/plugin versions and old processes if the entry is missing.
On narrow screens the host may present the right Sidebar full screen; collapsing
it returns to the original conversation.

## Interactive Workspace

- Enter reuses an existing connection or offers a chooser; the separate plus action opens a new connection (maximum three per environment and owner). Inspect owner/activity and release individual connections. Hosts exposing `sessionController.resolveAgent` can resume a saved session without a model prompt; an unsaved draft is not an SSH owner.
- Human and Agent share terminal input, including while a conversation runs. No takeover or handback is required. Native DSH cancellation attempts Ctrl+C when a terminal send is still waiting; already returned commands and remote background processes may continue. Cancellation is not evidence of process exit. Direct keyboard Ctrl+C and SSH connection release remain available.
- Quick buttons below terminal output dispatch the complete saved command plus Enter to the currently visible terminal without a model round trip. Management supports multiline editing, groups, search, ordering, pin/unpin and optional confirmation. Unpinning retains the library entry; deletion requires confirmation. Multiline paste still requires confirmation.
- The dock opens by default and remembers its height and collapsed state. Drag its top border with a mouse or touch, use arrow keys, or double-click to restore 190px. Height is bounded by actual plugin space, not two rows or 360px, and preserves a minimum terminal viewport. The command list scrolls internally. The outer Sidebar width remains owned by Harness.
- Dispatch captures the owner, exact terminal, stream and command revision. It neither reconnects nor switches targets. A bounded in-memory receipt cache deduplicates the same request for ten minutes (1024 entries maximum); the UI never automatically retries an uncertain write. Written means accepted by the terminal, not completed. Unsubmitted input from this browser blocks dispatch, but arbitrary interactive-program state and edits from other browsers cannot be inferred. Active Agent input is rejected, not automatically taken over.
- Both file panes independently select the DSH host or an SSH environment. Browser upload/download refers to the browser device. Files and directories can be selected together; SSH-to-SSH copies stream through the DSH host. Upload/download no longer buffer entire files or impose a 2 MiB limit.
- Transfers report bytes/files, cancellation and error/skip/overwrite conflict policies. Tool overwrite requires `overwrite: true`. Two jobs run concurrently, at most 20 are pending/running and 50 recent records are kept. Jobs are not resumed across restarts. Cancellation removes incomplete staging files, not already completed files/directories. Symlinks/devices are not followed; traversal is limited to depth 32 and 10,000 entries. Remote overwrite requires the atomic rename extension.
- Errors retain phase, code and original causes. Diagnostic export previews a metadata whitelist without credentials, command text, host addresses or terminal content.

## Data Storage

The plugin stores its own data under `$DSH_HOME/remote-ops`:

- `environments/<group>/environments.<group>.json` for environment definitions.
- `quick-commands/<group>/commands.<group>.json` for reusable commands.

Use a Harness credential reference such as `passwordRef` for passwords. The
Sidebar form also accepts an SSH password and stores it through
`credentials.set`; the environment JSON keeps only the reference. A private
key may be referenced by local path.

## Agent tools

The plugin exposes `remote_environment_list`, `remote_environment_create`,
`remote_environment_update` (added in v0.6.1), `remote_environment_delete`, group management, terminal
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

`cliProfile` and `terminal` replace their entire respective sections when supplied; `{}` resets a section to defaults. Empty `passwordRef`/`privateKeyPath` strings clear that setting without deleting the stored credential or key file. These tools accept credential references, not literal passwords; new passwords can be entered in the environment form. Omit the masked `passwordRef: "configured"` returned by listing when retaining authentication.

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

The plugin never answers a `(y/n)` confirmation by itself. v0.2.24 and v0.2.25
shipped `autoConfirm`/`confirmPattern` for that; they were removed because
silently typing `y` can approve destructive operations. A caller that still
passes them gets a `notices` entry, and `cliProfile.autoConfirm` /
`cliProfile.confirmPattern` are rejected when saving an environment (values left
in older environment files are dropped on load). Read the prompt in the output
and answer it with `remote_terminal_send`; for a known sequence the user has
approved, `remote_terminal_script` `answers` type exactly the text the call
declares, nothing more.

| Option | Default | Behavior |
| --- | --- | --- |
| `autoQuitMore` | `false` | When the output ends with a `--More--` pager line, send `q` (no Enter), wait 300 ms and return the remaining output; at most 3 times per call. |
| `autoSigint` | `true` | When the last 2 KB of this send's output contains a parameter-error hint (`^` arrow line followed by `[param=?]` suggestions, `/\n\s+\^\s*\n\s*\[.*\=.*\]/m`), send SIGINT, wait 500 ms and append `[auto-sigint: command line cleared]` to the returned `output`. The marker is not written to the terminal stream. Set `false` to disable. |

### Environment profiles, output options, scripts and terminal size (v0.2.25)

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
  (`rows` 10-200, `cols` 40-500); the UI has a size selector for SSH tabs and
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
activation time. On older or non-Web DSH profiles the plugin no longer blocks
boot; the Sidebar UI attaches automatically when those services become
available.

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
across browser windows, without per-window locks or takeover. Human/Agent input
shares the same input stream; simultaneous input can interleave. Recreated
terminal streams require input acknowledgement.

SFTP remembers endpoint, path, sort, scroll and bookmarks per Harness session
in browser storage. Transfer results include per-item state; retries skip
completed items. Overwrite previews show both sizes and timestamps. Tasks and
receipts are runtime-only, not cross-restart persistence.

The lightweight terminal supports alternate screens, scroll regions and charset
selection escapes. Full-screen grids do not soft-wrap. The current Harness
local PTY has no runtime resize API: this remains a fixed 160x40 terminal, not
a complete xterm replacement. Actual OS IME behavior requires device testing.

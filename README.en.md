# DSH Remote Ops

`@dsh/remote-ops` is a DeepSeek Harness plugin for SSH-based remote
operations. The repository has been cut over to the plugin boundary: it no
longer contains the myterm desktop application, a Tauri host, or a second
Agent kernel.

## Windows 11 x64 integrated bundle (v0.5.3)

Cold-session browser opens after DSH restart now resume the existing owner through the optional host sessionController service, without sending a model prompt or changing Agent code.

Releases include the regular tgz and `dsh-remote-ops-v0.5.3-windows-x64.zip`. The ZIP carries Chromium 156.0.8078.4 (revision 1248), Headless Shell, FFmpeg and Winldd matching Playwright 1.64.0. Plugin npm dependencies still install online through DSH; this is not a completely offline installer. A working DSH, Node.js 22+, pnpm and access to the configured npm registry are required.

Extract the ZIP and run from its directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profile web
# Match the DSH_HOME of the running DSH when using a custom directory:
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profile web -DshHome 'D:\DSH data'
```

The installer verifies every payload file with SHA256, installs the local plugin tgz through DSH, places the browser runtime, and launches both display modes for interaction checks. A test window opens briefly. Matching runtime files are reused; previous versions remain available for rollback. Browser files live in `$DSH_HOME/remote-ops/browser/runtimes/playwright-<version>-win32-x64`, separate from login profiles, sites, flows and preferences. The tgz is retained in `remote-ops/packages`, so the extracted download can be moved after installation.

Browser settings report embedded and window readiness separately, with installation progress and failure details. `BROWSER_RUNTIME_MISSING` is recoverable by rerunning the matching bundle installer or clicking **安装 / 检查 Chromium** with network access. Standard Playwright `HTTPS_PROXY`, `PLAYWRIGHT_DOWNLOAD_HOST` and `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` variables can be set before starting DSH. Agent code is unchanged; the bundled skill supplies recovery guidance. Restart DSH, refresh the page and confirm v0.5.3; see the release notes for tested environments and limitations.

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

XPath/CSS/role/label/text/placeholder, iframes, popups, optional saved login/flows, result checks and collapsed operation records are supported. Install Chromium in browser settings or choose installed Edge / Chrome. Independent windows require an interactive desktop shared with DSH. Changing display reloads the pages and preserves login cookies; unsaved forms are not restored. See [Web usage and boundaries](integrations/dsh-remote-ops/WEB.md).

## Capabilities

- The `Remote Ops` action at the bottom of the DSH Web left sidebar opens the native right Sidebar, preserving the conversation and its draft. Repeated clicks reuse the existing tab. Expanded left-sidebar entries align the icon and label to the left with native host entries; collapsed entries keep a centered icon and Tooltip.
- Three workspace tabs, an in-panel environment view and consolidated utility settings.
- Create, edit, delete, group, and persist SSH environments.
- Multiple SSH terminal tabs with the terminal as the primary workspace.
- A lightweight VT screen model handles ConPTY clears, cursor movement, and carriage-return updates; terminal output is transferred incrementally and remains scrollable to the final line.
- A local CMD terminal starts at `$DSH_HOME/remote-ops` when no SSH session is active; it accepts `ssh` and returns after an SSH child exits.
- Agent tools and the UI read the same terminal stream. Sends return bounded deltas with a stream identity and cursor; echo or silence is not a reason to resend, and silence does not prove completion.
- Terminal status distinguishes output transport, Agent binding, and waiting. History position survives SFTP switches, with a new-output jump and bottom following across resizes.
- Quick-command groups docked below the terminal.
- Complete multiline command submission without short-request splitting.
- SFTP directory listing, file read/write, mkdir, delete, and rename.
- Browser upload batches continue across terminal, SFTP, and plugin panel switches within the same browser page; return to inspect progress or cancel. Closing/reloading the page, unloading the plugin, or stopping DSH may interrupt uploads; byte-level resume is not supported.
- Directory refreshes skip historical completions, merge new completions, and serialize requests per pane while retaining entries, scroll position, and selections that still exist.
- Narrow file workspaces switch between source/target and collapse finished history to retain usable file-list height.
- Sequential Multi-SSH tools, Agent diagnostics, and Harness credential references.
- The Sidebar shows the installed plugin version, checks GitHub Releases, and can install an update with one click; restart DSH after the upgrade.

## Installation

Download the package from [GitHub Releases](https://github.com/Ssshake1996/myterm/releases), then run:

```powershell
dsh plugin --profile web add .\dsh-remote-ops-v0.5.3.tgz
dsh web
```

For an upgrade, run the installation as the same user and with the same `DSH_HOME` used by DSH. Replace `--profile web` if DSH uses another profile. After installation, fully stop the old DSH process, restart it, refresh the browser, and confirm `v0.5.3` in the Remote Ops header. Saved environments, quick commands, websites and flows remain; terminals and browsers must be reopened and running jobs cannot resume across a DSH restart.

Click `Remote Ops` at the bottom of the left sidebar to open the native right Sidebar while preserving the main conversation. It uses the official `sidebar.footer.action` seat and `sidebarRight.openTab`; it no longer registers a `sidebar.panellist` / `main` replacement. Tested on DSH `0.2.0-rc.2`; other host versions remain untested. If the entry is missing, check the installation profile, host/plugin versions and whether the old process exited. On narrow screens DSH may present its right Sidebar full screen; collapsing it returns to the original conversation.

Local checks:

```powershell
npm --prefix integrations/dsh-remote-ops ci
npm --prefix integrations/dsh-remote-ops test
npm --prefix integrations/dsh-remote-ops run check
```

## Layout

```text
integrations/dsh-remote-ops/
├─ lib/index.js       # Plugin entry and exports
├─ lib/state/         # Environment, connection, terminal, file and update state
├─ lib/tools.js, routes.js # Agent tools and HTTP routes
├─ lib/client.js      # DSH Web left action and native right Sidebar
├─ cordis.patch.yml   # Official DSH bundle patch
└─ test/               # Unit, client behavior, contract, and smoke regression tests
```

Runtime data is isolated under `$DSH_HOME/remote-ops`:

```text
remote-ops/
├─ environments/<group>/environments.<group>.json
└─ quick-commands/<group>/commands.<group>.json
```

SSH passwords and private keys are never written to JSON. The Sidebar
password field stores the password through Harness credentials and keeps only
the reference in the environment file.

## Release

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/release-dsh-remote-ops.ps1 -Version 0.5.3
```

The cross-platform implementation is `scripts/release-dsh-remote-ops.mjs`;
the PowerShell command delegates to it.

```sh
node scripts/release-dsh-remote-ops.mjs 0.5.3
node scripts/release-dsh-remote-ops.mjs 0.5.3 --dry-run
```

Before changing git, the script verifies the package, lockfile, runtime and
client versions, release-note heading, install examples in all four READMEs,
and release examples in the root READMEs. It runs the complete regression gate
(syntax, unit, client behavior, contract, and smoke tests), then packs, commits
the plugin and both root READMEs, tags, and pushes the selected branch. The tag
workflow publishes the GitHub Release; the script waits for its assets and
compares the reported package digest with the local package. Use `--dry-run`
to validate and pack without changing git, or `--no-push` to leave the commit
and tag local. See `docs/testing/dsh-remote-ops-test-plan.md` for the test
matrix and 3080 page acceptance requirements.

For handoff and a ready-to-copy prompt for a new development conversation, see
`docs/development-handoff.md` and `docs/prompts/new-development-session.md`.

## Boundary

- DeepSeek Harness owns the Agent Loop, Sessions, Goals, Skills, MCP,
  permissions, and local tools.
- This plugin provides SSH, interactive terminals, SFTP, quick commands,
  Multi-SSH coordination, visible web operations, and remote diagnostics.
- The repository no longer builds or starts the myterm desktop application.

See the [Chinese plugin guide](integrations/dsh-remote-ops/README.zh-CN.md),
[English plugin guide](integrations/dsh-remote-ops/README.md), and [development
experience record](docs/development-experience.md).

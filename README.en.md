# DSH Remote Ops

`@dsh/remote-ops` is a DeepSeek Harness plugin for SSH-based remote
operations. The repository has been cut over to the plugin boundary: it no
longer contains the myterm desktop application, a Tauri host, or a second
Agent kernel.

## Agent environment management (v0.6.1)

- Adds `remote_environment_update` for an existing environment ID or name. It changes only supplied non-null fields, preserving identity, credentials and omitted configuration. Invalid fields and duplicate names reject before writing.
- Bundles `remote-ops-environments` alongside the browser skill through DSH's native skill provider, with automatic discovery and `/remote-ops-environments` invocation. Install the same tgz; no Agent changes or manual skill copying.
- Existing SSH connections keep their original settings and stay open. New connections use the updated definition. The list's `passwordRef: "configured"` is a display marker; omit it to preserve credentials. Store new passwords through the environment form.
- Agent and frontend share persisted environments. Releases remain tgz plus SHA256 only. See the [plugin README](integrations/dsh-remote-ops/README.md) for the API and installation contract.

## Interface and interaction refresh (v0.6.0)

- Terminal, web, files, environments, saved commands and diagnostics share consistent typography, spacing, controls and host-aware light/dark surfaces. Workspace tabs stay at the top; version, updates, diagnostics and comfortable/compact density live under **更多设置**. Density persists in this browser.
- Terminal identity and tools share one context row; a separate session strip appears only for multiple terminals. Input, search, independent commands and quick commands remain available.
- The web workspace prioritizes the address and live page. **网页设置** contains engines, Chromium installation, saved sites and flows; **操作记录** opens on demand. **画面设置** in the footer controls the viewport. Closing settings retains the URL draft and current page.
- Switching an open page between embedded and independent display requires confirmation. Cancel dispatches nothing; confirming reloads the page and may lose unsent form content. Switching cannot be submitted repeatedly while pending.
- File batch actions appear after selection. Upload controls match other buttons, and browser uploads show byte progress. Module switches retain selection, drafts and background jobs; completed transfers still use coalesced directory refreshes.

The left action still opens the native DSH right sidebar. Human and Agent input remain shared; use native conversation cancellation. Releases contain only tgz and SHA256, with Chromium installed on demand over the network. Agent/core are unchanged.

Validation passed 321 tests plus smoke and 13 browser scenarios. Both candidate and official packages passed 12 real DSH acceptance groups, including v0.5.4 upgrade data, SHA256 and light/dark contrast checks. See [v0.6.0 acceptance](docs/testing/dsh-remote-ops-v0.6.0-acceptance.md) for evidence and limits.

## Browser arguments and on-demand runtime (v0.5.4)

Future Releases contain only the plugin `tgz` and its `SHA256SUMS`; no new `windows-x64.zip` is built. Historical v0.5.3 assets remain available. The plugin has no browser binaries; npm dependencies require network access, and the Agent can install matching Chromium through plugin tools when needed.

- Independent windows follow the Windows user's default HTTP(S) browser on the DSH host, supporting installed Chrome / Edge with an isolated plugin profile. Embedded mode still defaults to matching Chromium. Each mode has its own engine preference; the previous embedded preference is retained. Explicit saved-site or tool browser choices take precedence. Unsupported/unavailable defaults report an error instead of silently opening Edge. A remote DSH host's default is separate from the client viewing DSH.
- Prefer an action array for `steps`. Single action objects, a sole `{steps:[...]}` envelope and JSON-encoded versions are accepted. Prefer `{kind,value,name?,frame?}` locator objects for `target`; JSON-encoded locator objects and CSS/XPath strings (`css=#id`, `xpath=//button`, `#id`, `//button`) are accepted. All steps normalize and validate before dispatch. Equivalent requests deduplicate under the same `requestId`; missing targets are not guessed and arbitrary JavaScript is unsupported.
- For missing Chromium, call `remote_browser_runtime` with `action: "status"`, then `action: "install"` if needed. Poll `status` until the required mode is ready before opening a page. The plugin's installed Playwright CLI downloads its matching Chromium and Headless Shell. The settings button uses the same installer. Network access is required; configure `HTTPS_PROXY`, `PLAYWRIGHT_DOWNLOAD_HOST` or `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` before starting DSH if needed. Complete matching runtimes are reused and login profiles/sites/flows retained.
- `BROWSER_STEP_INVALID` identifies the field, accepted format and no-dispatch status. Correct the argument instead of repeating an unchanged invalid call; preflight rejection does not reserve the request ID. Fixes, Schemas, tool metadata and the bundled skill travel with the tgz, without Agent/core changes. Restart DSH and refresh its webpage after upgrading; verify the current version in **更多设置**.

Validation: 321 tests plus smoke, 12 browser E2E scenarios and 20 real DSH acceptance groups passed, with additional system-default process, restart/shared-input and v0.5.3 upgrade checks. See [v0.5.4 acceptance](docs/testing/dsh-remote-ops-v0.5.4-acceptance.md). The other user device and real intranet sites remain unverified.

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
dsh plugin --profile web add .\dsh-remote-ops-v0.6.1.tgz
dsh web
```

For an upgrade, run the installation as the same user and with the same `DSH_HOME` used by DSH. Replace `--profile web` if DSH uses another profile. After installation, fully stop the old DSH process, restart it, refresh the browser, and confirm `v0.6.1` in Remote Ops **更多设置**. Saved environments, quick commands, websites and flows remain; terminals and browsers must be reopened and running jobs cannot resume across a DSH restart.

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
  -File scripts/release-dsh-remote-ops.ps1 -Version 0.6.1
```

The cross-platform implementation is `scripts/release-dsh-remote-ops.mjs`;
the PowerShell command delegates to it.

```sh
node scripts/release-dsh-remote-ops.mjs 0.6.1
node scripts/release-dsh-remote-ops.mjs 0.6.1 --dry-run
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

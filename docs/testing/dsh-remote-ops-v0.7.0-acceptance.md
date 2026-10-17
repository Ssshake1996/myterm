# Remote Ops v0.7.0 acceptance

Date: 2026-10-17. Baseline: official v0.6.1, repository `85198b9`. Scope: terminal command/output styling, retained-log APIs, TXT/ZIP downloads and the bundled log skill. No Agent/core or SSH authentication changes. Release assets remain tgz and SHA256 only.

## Regression

`npm run check --prefix integrations/dsh-remote-ops` passed **342 tests** (227 backend, 104 client, 11 contract) plus smoke. Twelve log-specific tests cover echo matching across ANSI/chunk boundaries, hidden/manual input, unchanged wire bytes, Unicode/cursor/alternate-screen geometry, conservative prefix highlighting, log ownership, closed records, pagination and gaps, frozen ZIP snapshots, bounded retention, invalid selections, expiration, skill/tool/HTTP registration, trusted absolute download URLs and transcript cleanup.

The full browser suite passed **14/14 scenarios** using production client/backend code, a simulated host and loopback devices. The new scenario exercises command/output colors, disabling highlights without changing text, log reads, actual TXT and ZIP downloads and 390px layout. Existing browser, SFTP navigation/upload, shared input, cancellation, long output, workspace and environment regressions passed. Local report: `output/playwright/terminal070-all-final/report.html`.

The DSH UI contract checker passed 14 checks, with the expected warning that this DSH package has no Codex-plugin manifest. The new bundled skill passed `quick_validate.py`. Syntax, version and whitespace checks passed.

## Candidate in real DSH

Installed official v0.6.1 and then the candidate tgz through `dsh plugin --profile web add` in an isolated profile. Ran DSH **0.2.0-rc.2**, Node **24.11.1** and Chrome **155.0.8059.80** on Windows. A deterministic local model provider drives the native Agent/tool loop; two actual ssh2 loopback servers supply controlled terminal output. No production model, credentials, Agent implementation or user DSH profile was changed.

The native acceptance passed:

1. `remote-ops-terminal-logs` appears in the native slash menu, is present in the Agent's skill catalog, and loads through DSH's native `skill` tool.
2. Fifteen native tool calls load the skill, create/open two SSH environments, execute one command on each and one local command, list/read/paginate logs, export all three terminals, close one SSH terminal, list its retained record and export the two selected SSH logs. The native export schema exposes `logIds` as an array.
3. The actual SSH echo of `show capacity` receives the command accent. ANSI output, warning and error prefixes remain visible. Manual `show manual` input still works and is not labeled as an Agent submission. Light and dark themes were inspected.
4. The Agent's final conversation link downloads the real two-terminal ZIP. SHA256 matches the tool result; separate Python `zipfile` extraction and CRC checks pass. Both command echoes are present, controls are stripped and the manifest identifies the closed terminal without claiming truncation.
5. The native toolbar downloads current-terminal TXT and an all-terminal ZIP containing three transcripts. Exporting does not dispatch terminal commands.
6. The left entry opens/reuses the native right tab while preserving the main conversation and unsent draft. Reload retains running-terminal output and the highlight preference. The export menu stays within a 390px viewport. No browser console errors were recorded.

Local evidence is under `output/playwright/terminal070-candidate2-*`: native tool results, SSH events, downloads, assertion results and light/dark/narrow screenshots. Test host authentication and ignored runtime files must not be published.

### Failure found and corrected before release

The first native run completed all 15 tool calls and returned a valid HTTP ZIP, but its relative download address rendered as plain text in DSH Markdown. The plugin now observes the authenticated browser origin through the public `connection/request` event, revalidates it through Connection's public trust fence, and returns an absolute link without login tokens. When no supported origin is available, `downloadUrl` is null and the same-host toolbar download still works. Regression coverage rejects unsafe/untrusted origins. The full native run was repeated successfully from a fresh isolated profile after this correction.

## Release verification

The release workflow must pass Linux and Windows checks, publish exactly the tgz and SHA256 files, and preserve the tested candidate digest. The downloaded official package is then installed in an isolated real DSH profile for native tool/download verification. Final publication evidence will be appended after those steps complete.

## Limits

These tests verify real DSH registration, schema handling, skill loading, SSH/local output and downloads against controlled endpoints. They do not test the user's other computer, real storage appliances, intranet connectivity or a production model's planning choices.

Logs use bounded process memory, not durable audit storage: 4 MiB per terminal (trimmed to 3 MiB), 16 MiB / 32 retained closed records. Downloads accept at most 32 records / 32 MiB, and cache at most 10 packages / 32 MiB for up to one hour. A DSH restart removes logs and downloads. The API reports retained ranges, gaps and evictions. Program-printed secrets may occur in output; hidden raw input is not added. Echo coloring is conservative for single-line submissions; raw input, unmatched rewrites and full-screen applications do not receive semantic command marking. Transcripts are neither VT recordings nor proof of command completion.

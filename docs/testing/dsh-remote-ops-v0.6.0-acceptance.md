# Remote Ops v0.6.0 acceptance

Date: 2026-10-15. Baseline: v0.5.4 / `11054fa`. Scope: the approved two-phase visual and interaction refresh across terminal, browser, files, environments, saved commands and diagnostics. Agent/core unchanged. Only tgz and SHA256 release assets.

## Automated regression

The baseline passed 321 tests plus smoke. The new `visual-refresh` browser scenario was added first and failed on the baseline's redundant header version. Phase 1 passed header/density assertions and exposed the missing secondary browser view; Phase 2 passed the complete scenario.

Final `npm run check` passed 321 tests (206 backend, 104 client, 11 contract) plus smoke. The full 13-scenario browser suite passed after the final style changes. It verifies single-terminal layout, persistent density, preserved address drafts, zero display requests on cancellation and usable 390px content. A further regression reproduced selected file rows losing their highlight on hover, then passed after preserving distinct selected/hover colors. Existing browser scenarios now use the visible settings entry and confirm display changes; shared input, cancellation, transfer and refresh checks remain active.

Browser E2E uses the real plugin backend/client and Chrome with a simulated DSH host, local SSH fixture and deterministic website. These tests are separate from the real-host checks below.

## Candidate package on real DSH

Installed `output/dsh-remote-ops-0.6.0.tgz` using the official `dsh plugin --profile web add` CLI into isolated `output/visual060-candidate-home`. Host: installed DSH 0.2.0-rc.2, Windows x64, real local CMD and Chrome. A local deterministic model provider and test website run on port 3092; DSH runs on 3091. No production model, credentials or Agent implementation changes.

All 12 acceptance groups passed, with no recorded console/page/HTTP errors:

1. Native left launcher is left-aligned (10px icon inset), reuses one right tab and preserves the conversation/editor/draft. Collapsed keyboard activation and workspace tab keys work.
2. Version appears under settings; single terminal has no duplicate strip; compact density survives reload and can be restored.
3. Local terminal input works; dialogs restore focus; independent commands finish and recover output after module switch/reload with exit code 0.
4. Environment, saved-command and diagnostic forms work, including cancellation and preview.
5. Real host directories support filtering, Shift selection, retained selection and Enter navigation; selection actions appear.
6. URL opens the embedded page with panel-sized viewport and visible human input.
7. Browser settings preserve the URL draft. Cancelling display confirmation sends zero display requests and retains the active page.
8. Native Agent discovers and loads the updated bundled skill, then performs XPath input on the shared live page with an explicit result check.
9. Native DSH conversation cancel stops a browser wait and prevents the next step; human input remains possible. Observed cancel acknowledgement: 186ms (single local sample, final candidate).
10. Native conversation cancel stops terminal waiting without locking manual input. Observed acknowledgement: 63ms (single local sample, final candidate).
11. Confirmed independent-window / embedded transitions retain the conversation DOM/draft and active workspace across reload.
12. Actual host light/dark surfaces change; 390px terminal/file/web modules avoid horizontal overflow. The live viewport and image revision settle at the new panel width. Reduced-motion mode is exercised.

Screenshots were inspected for terminal, browser, files/selection, environments, commands, diagnostics, settings, confirmation, light/dark and narrow views. External site appearance remains site-controlled. Evidence is local under `output/visual060-candidate-*`; authentication files are ignored and must not be published.

A contrast audit of real rendered host colors caught selected/primary text at 4.33:1 in light mode and selected text at 4.21:1 in dark mode. Text now uses the host's theme-aware link token with a foreground blend, separate from the primary button fill. Measured final ratios: selected text 4.93:1 light / 8.55:1 dark; primary button text 5.41:1 in both. These are targeted controls, not a claim of a complete accessibility audit. Bundled skill validation passed.

## Release and official package

- Implementation/tag commit: `d57a3a7089fda54b8d7be9617169abbdd65254d6`; tag: `dsh-remote-ops-v0.6.0`.
- [Release](https://github.com/Ssshake1996/myterm/releases/tag/dsh-remote-ops-v0.6.0) is published with exactly two uploaded assets: `dsh-remote-ops-v0.6.0.tgz` (161,008 bytes) and `SHA256SUMS-dsh-remote-ops-v0.6.0.txt` (92 bytes). No Windows ZIP.
- Downloaded official tgz, published checksum, GitHub asset digest and the locally tested candidate all match SHA256 `0fb739b67ccf7385e71654bdb00c302cc10db18d17a42abae60a19bacbf0f205`.
- [Release workflow](https://github.com/Ssshake1996/myterm/actions/runs/38713277370) passed its Linux package/check, Windows check and publication jobs. [Main CI](https://github.com/Ssshake1996/myterm/actions/runs/38713272719) and [browser CI](https://github.com/Ssshake1996/myterm/actions/runs/38713272542) passed; the latter explicitly reported 13/13 scenarios.
- The official v0.5.4 asset was downloaded, checksum-verified and installed using DSH's plugin CLI into `output/visual060-upgrade-home`. Its installed APIs created an environment, quick command, site, flow, browser preferences and profile-state fixture. After installing the downloaded v0.6.0 asset into the same profile, all six persisted file hashes were unchanged. Explicit site engine, embedded preference, system-default window choice and command confirmation setting were retained.
- Started real DSH with that upgraded profile and repeated all 12 native acceptance groups: **PASS**, no unexpected console/page/HTTP errors. The updated bundled skill was discovered and loaded by the native Agent; XPath input was executed and checked. Actual light/dark contrast ratios matched the candidate. Evidence: `output/visual060-official-acceptance.json`, `output/visual060-official-test.log`, `output/visual060-official-contrast.json`, `output/visual060-upgrade-proof.json` and screenshots.

The first upgraded-profile run completed its behavioral assertions but failed the strict HTTP gate: the intentionally unreachable saved SSH fixture was automatically selected as target B and produced two `files` request failures. A separate probe identified `SFTP_CONNECT_FAILED` for `upgrade-env`. The original failure report/log are retained as `output/visual060-official-first-run.*`. The final host-file acceptance explicitly presets both file locations to the DSH host before mounting the file workspace; the saved SSH environment remains present. No response was mocked, suppressed or reclassified in the passing run, and no product change was needed for this fixture correction. This does not constitute real remote SFTP acceptance.

## Limits

The other user computer, actual remote SSH/SFTP devices and business intranet websites were not available. Local fixtures test interaction correctness but cannot prove those environments. Large/slow-network uploads still depend on browser and network availability; closing/reloading the entire DSH webpage can interrupt browser uploads. No byte-level upload resume is claimed. Running terminals/jobs do not survive a DSH process restart.

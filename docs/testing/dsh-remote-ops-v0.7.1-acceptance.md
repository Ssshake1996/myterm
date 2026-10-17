# Remote Ops v0.7.1 acceptance

Date: 2026-10-17. Baseline: official v0.7.0, repository `14fbbfb`. Scope: user-requested option A, showing saved environment passwords in the plugin editor. No Agent/core changes or Agent plaintext-password tool. Release assets remain tgz and SHA256 only.

## Regression

`npm run check --prefix integrations/dsh-remote-ops` passed **345 tests** (230 backend, 104 client, 11 contract) plus smoke. The new route tests cover exact saved-environment selection, lazy and fresh credential resolution, no-store responses, no writes on viewing, masked catalog/tool results, invalid inputs, missing credentials and sanitized provider errors. Log: `output/password071-check.log`.

The full browser suite passed **15/15 scenarios** against the production plugin and client with a simulated host. The new scenario verifies six groups of behavior: masked opening and show/hide; viewing followed by a metadata-only save; closing and reopening; delayed responses after closing or editing; replacement password drafts and fresh resolution after save; retry, keyboard operation and a 390px viewport. Existing terminal, browser, SFTP/upload and workspace scenarios passed. Final report: `output/playwright/password071-all-final/report.html`; targeted report: `output/playwright/password071-targeted2/report.html`.

The DSH UI checker passed 14 checks with the expected non-Codex-manifest warning. The updated bundled environment skill passed `quick_validate.py` in Python UTF-8 mode. JavaScript syntax, version consistency and whitespace checks passed.

### Failures corrected before release

- The first targeted browser run found an editor initialization error from using a later-initialized panel key. The field now derives its identifier directly from the current session. The six-step scenario passed after the correction.
- The first full run found two existing test selectors that also matched the new eye button's accessible name. Those input selectors now require the exact label. A separate scenario was assigned Chrome's blocked port 6665 by the test host and failed before loading the plugin. The final complete run passed all 15 scenarios. Earlier evidence remains in `password071-targeted` and `password071-all`; it has not been overwritten.

## Candidate in real DSH

Installed official v0.7.0, saved a fixture environment/password through its UI, then installed the candidate tgz into the same isolated DSH profile. Runtime: DSH **0.2.0-rc.2**, Node **24.11.1**, Chrome **155.0.8059.80**, Windows. A deterministic local model provider drives the real native Agent/tool loop; an actual ssh2 server requires the currently expected fixture password. No production credentials, Agent implementation or user DSH profile were changed.

The candidate passed all six native acceptance steps:

1. The saved v0.7.0 password survives upgrade. Opening the editor keeps the field masked and makes no password-resolution request; the eye button resolves and displays it, and hiding clears it.
2. Viewing the password and then saving an environment name change leaves the native credential file's SHA256 unchanged. Closing/reopening the environment drawer clears the revealed value.
3. The native Agent loads the updated `remote-ops-environments` skill, lists the masked environment, opens an SSH terminal, executes a command and closes it. The SSH server accepts the original credential.
4. An explicitly edited password saves through DSH's public credentials service. A local draft can be shown without reading a saved credential. Reload returns to a masked field and a subsequent reveal returns the replacement.
5. A second native Agent flow reconnects successfully with the replacement password. These two flows total **10 native tool calls**; neither tool results nor the tool catalog expose a plaintext-password reader.
6. An unauthenticated reveal request receives HTTP 401 from the real host. Missing credentials show the expected actionable error. Keyboard show/hide works at 390px, the drawer has no horizontal overflow, and revealed values are absent from localStorage.

No browser console errors were recorded. Desktop, narrow-screen and missing-credential screenshots were visually inspected. Evidence: `output/playwright/password071-baseline-acceptance.json`, `password071-candidate-acceptance.json`, `password071-candidate-proof.json` and the candidate screenshots. Test authentication and ignored runtime files must not be published.

Candidate package: `output/playwright/dsh-remote-ops-0.7.1.tgz`, SHA256 `a40c0504ea6047a14d37b90be7ddf20532efc6c72812c464bd1d73757952ae56`.

## Release verification

Official asset verification and installation results will be appended after publication. Candidate acceptance alone does not establish official-package acceptance.

## Limits

These tests verify real DSH registration, authentication, public credential storage/resolution, native skill loading and SSH authentication with controlled credentials. They do not verify the user's other computer or real storage appliances. A missing or unavailable credential cannot be recovered by this UI; it reports the condition and allows the user to enter a replacement.

Showing a saved value does not make it an edit. Hiding or closing clears the retrieved value from the mounted field; the new-password draft follows the existing form's edit/cancel behavior. A browser or operating-system memory-erasure guarantee is not claimed. The dedicated authenticated UI route accepts only an exact saved environment ID, returns `Cache-Control: no-store`, and does not add plaintext to catalog, tool, diagnostic or log results.

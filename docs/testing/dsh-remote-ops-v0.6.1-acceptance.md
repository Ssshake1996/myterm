# Remote Ops v0.6.1 acceptance

Date: 2026-10-17. Baseline: official v0.6.0 / repository `93d1446`. Scope: the missing environment-update tool, native bundled environment-management skill and documentation. Agent/core unchanged. Release assets remain tgz and SHA256 only.

## Regression

Baseline `npm run check`: 321 tests plus smoke. Six environment-management regressions were added first and failed against the missing API/skill. The final gate passed **330 tests** (215 backend, 104 client, 11 contract) plus smoke.

Nine new tests cover partial updates and persistence, ID/name disambiguation, rename/group moves, credential preservation/clearing, null omission, section replacement/reset, invalid arguments leaving memory/disk untouched, existing-session semantics, complete tool CRUD/group operations, tool-schema/skill-example agreement, old-host nested-schema fallback and independent resolution of both bundled skills. Existing browser and lifecycle tests remain in the gate.

The DSH UI contract checker passed 14 checks with its expected non-Codex-manifest warning. The new skill passed `quick_validate.py` in UTF-8 mode. Version consistency and whitespace checks passed.

## Candidate on real DSH

Installed the checksum-verified official v0.6.0 tgz through `dsh plugin --profile web add` into isolated `output/environment061-home`, saved a baseline SSH definition through that version's implementation, then installed the candidate v0.6.1 tgz through the same CLI. The saved baseline file hash was unchanged after upgrade and acceptance: `5fa78b575a8d6ec50cfd9d37290b55b19ca54a6c01f2b23297a9a47c3cdc3ede`.

Host: installed DSH **0.2.0-rc.2**, Windows x64. The native DSH conversation uses a deterministic local model provider. Two actual loopback SSH servers provide distinct endpoints A/B. No production model, credentials or Agent implementation was modified.

The installed package passed these native tool/UI checks:

1. Both `remote-ops-browser` and `remote-ops-environments` appear in DSH's native slash menu. The native Agent discovers and loads the environment skill using the host's `skill` tool.
2. Native tools create a group/environment, open SSH to endpoint A and execute a command. The environment immediately appears in the plugin's shared list.
3. `remote_environment_update` renames, moves groups, changes the port to endpoint B, accepts omitted/null values and sets CLI/terminal defaults while preserving the ID. The UI's edit form shows the new name, group, port, auto-paging option and 55 rows.
4. The pre-existing connection continues to execute against A; a newly opened connection executes against B. Both remain visible in the environment list. A browser reload preserves the saved values and running connections.
5. Invalid port and the masked `configured` credential marker produce `REMOTE_ENV_INVALID`; the saved definition is unchanged.
6. Native deletion removes only the disposable test environment/groups and closes both calling-conversation SSH connections. The prior-version baseline definition remains byte-for-byte unchanged.
7. The left launcher opens/reuses the native right tab and retains an unsent conversation draft. Environment management remains usable at 390px width. The browser console reports no errors. Screenshots were visually inspected.

Evidence is local under `output/environment061-candidate-*`, including native provider results, SSH events and assertion output. These files and test host authentication data are ignored and must not be published.

## Release and official package

Pending publication and installation of the downloaded official asset. This section will be completed with the release commit, assets, checksums, CI and installed-package result.

## Limits

Native acceptance verifies real DSH registration, schema handling, skill loading, persistence, UI synchronization and loopback SSH behavior. It does not evaluate a production model's planning quality or the user's other computer, real storage devices or intranet connectivity. Password entry and credential creation remain in the existing frontend/Harness credential service; this change only manages saved credential references. Running SSH/browser sessions do not survive a DSH process restart.

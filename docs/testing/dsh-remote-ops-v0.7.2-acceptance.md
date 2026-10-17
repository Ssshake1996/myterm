# Remote Ops v0.7.2 acceptance

Date: 2026-10-17. Baseline: official v0.7.1 / repository `b3ee780`. Scope: visible command highlighting for manual/raw input, Windows `dir` name classification and terminal palette. No Agent/core changes. Release assets remain tgz and SHA256 only.

## Baseline and implementation

Real DSH with v0.7.1 confirmed that manually typed `dir` and its directory/file names were unstyled. Native `remote_terminal_send` command highlighting worked in this local baseline; the report of every Agent input being unstyled was not reproduced for that particular API. The missing path was manual/raw input, including `remote_terminal_input`.

The client now classifies already-visible text after VT cursor edits. Common CMD, PowerShell and `user@host` prompts identify echoed commands. Standard Windows `dir` rows identify names from their type/size column. No extra command is executed, hidden input is not reconstructed, and the backend, wire bytes and exported text are unchanged. Existing ANSI runs are retained. Full-screen applications and disabled semantic highlighting bypass classification.

The terminal uses a [Catppuccin Latte / Mocha](https://catppuccin.com/palette/) adaptation: purple commands, teal directories and blue files. The inherited host color scheme selects the palette. Some light accents are darker than the original palette to meet text contrast. Attribution and MIT license are shipped in `THIRD_PARTY_NOTICES.md`.

## Regression

- `npm run check --prefix integrations/dsh-remote-ops`: **348 tests passed** (233 backend, 104 client, 11 contract), plus smoke. Three new tests cover visible prompt recognition after ConPTY edits, directory rows/links/Unicode/numeric names, and preserved ANSI/Agent runs with disabled/full-screen bypass. Log: `output/color072-palette-check.log`.
- Full browser suite: **15/15 scenarios passed**. The terminal-log scenario covers manual backspace editing, Agent raw input, different directory/file colors, both host color schemes, at least 4.5:1 semantic text contrast, unchanged visible text when toggling, and real TXT/ZIP downloads. Report: `output/playwright/color072-palette-all/report.html` (41,809 ms). This uses the production client/backend with a simulated host; native evidence is separate below.
- Targeted browser report: `output/playwright/color072-palette-targeted/report.html`. The first launch used an unsupported runner argument and did not execute tests; its log remains `output/color072-palette-targeted.log`.
- DSH UI checker: 14 passed, one expected non-Codex-manifest warning, zero errors. The bundled terminal-log skill passed `quick_validate.py`; version consistency, JavaScript syntax and whitespace checks passed.
- Earlier targeted unit evidence caught whitespace-only PowerShell prompts being classified as commands. The guard now ignores blank suffixes; the final tests above pass. Failure evidence remains `output/color072-targeted.log`.

## Candidate in real DSH

Runtime: Windows, DSH **0.2.0-rc.2**, Node **24.11.1**, Chrome **155.0.8059.80**. The package is installed into an isolated test profile, with an actual Windows CMD and a deterministic local model provider driving the real native Agent/tool loop. No production environment or user profile was changed.

All **six native acceptance steps passed**, with **four native calls** (load the bundled log skill, two complete terminal sends, one raw terminal input):

1. Type `dix`, backspace and enter `r`: the visible `dir` is highlighted before Enter, with the corrected command preserved afterward.
2. The native Agent loads the updated bundled skill and sends both complete commands and raw input; both visible command paths are styled.
3. Native light/dark themes show distinct, readable command/directory/file colors. Measured contrast ratios are below.
4. Selecting/copying the terminal yields identical text. Turning highlighting off, reloading, and turning it on preserves the terminal contents and the preference.
5. The real TXT download includes the commands and directory entries without color markup or ANSI escapes.
6. A 390px viewport retains names and colored commands without horizontal panel overflow. No browser errors were recorded. Light, dark and narrow screenshots were inspected.

| Semantic text | Light | Dark |
| --- | ---: | ---: |
| Command, including tinted background | 4.78:1 | 6.92:1 |
| Directory name | 4.75:1 | 11.01:1 |
| File name | 5.22:1 | 7.79:1 |

Final candidate evidence: `output/playwright/color072-candidate3-acceptance.json`, `color072-candidate3-proof.json`, `color072-candidate3-light.png`, `color072-candidate3-dark.png`, `color072-candidate3-narrow.png` and `color072-candidate3-terminal.txt`.

An intermediate native run found that reinstalling a changed tgz under the same version and same file path left pnpm's previous candidate in place. That run failed the palette assertion; evidence remains `color072-candidate2-acceptance.json`. Installing from a distinct candidate path corrected the test setup. The installed `client.js` SHA256 was then checked against the source before starting DSH. No result from the cached package is presented as validation of the new palette.

## Limits and publication

Custom prompts, `dir /b`, localized/nonstandard rows without recognized type/size fields and arbitrary appliance output may remain unclassified. Colors are visual hints, not proof of filesystem identity or command success. Explicit program ANSI colors are outside the semantic contrast guarantee. No claim is made for the user's other computer or real storage appliances.

The v0.7.1 Linux browser CI had an unresolved large-directory switching p95 failure against its unchanged 250ms threshold; its evidence is in the v0.7.1 acceptance report. The current local full suite passed, but does not establish a Linux CI performance pass. Official asset hashes, CI results and installed-release verification are recorded below after publication.

# dsh-remote-ops v0.7.0

## Terminal readability

- Agent submissions receive an accent only where a matching single-line command is actually echoed. Hidden inputs and raw keystrokes are not printed or separately logged.
- Common ANSI colors, bold, italic and underline are rendered. Error/warning/success prefixes receive restrained highlighting, configurable in terminal display settings. These colors do not prove execution success. Full-screen programs keep their terminal layout without semantic highlights.

## Log interfaces and downloads

- Adds `remote_terminal_logs`, `remote_terminal_log_read` and `remote_terminal_log_export`. The Agent can discover records, read pages and request a ready-made TXT/ZIP download with SHA256 through the plugin.
- The terminal toolbar uses the same service: export the current terminal as UTF-8 TXT, or package this conversation's available logs into one ZIP with individual transcripts and `manifest.json`.
- Adds the automatically registered `remote-ops-terminal-logs` bundled skill. No Agent/core modifications or manual skill installation are required.
- SSH records are scoped to the calling conversation; the local terminal remains shared. Recently closed records are available within bounded retention. Downloads enforce the same owner and are immutable snapshots.

## Retention and compatibility

Logs are retained process memory, not a persistent audit archive. A terminal holds up to 4 MiB and trims to 3 MiB on overflow. Closed records share 16 MiB / 32 entries. Export accepts up to 32 records / 32 MiB raw data; download cache holds up to 10 packages / 32 MiB. Links last at most one hour and can expire earlier on cache eviction or restart. Metadata discloses missing history. Program-printed secrets can still appear in output; hidden input is not added separately.

The transcript removes controls and separates progress updates with newlines; it is not a VT recording or proof of command completion. Independent-command results and browser activity are outside this terminal-log API. Adopted host terminals expose only the recent history available from DSH.

Target host: DSH 0.2.0-rc.2, with native skills and fetch/tools services. Upgrade in the same DSH profile, fully restart DSH and refresh the webpage. Saved environments, quick commands and browser definitions are retained; running terminals and their in-memory logs do not survive restart.

Release assets remain **tgz and SHA256 only**. The downloadable terminal-log ZIP is a user-generated artifact, not an additional Release asset. Chromium remains an optional on-demand installation.

Validation evidence is recorded in `docs/testing/dsh-remote-ops-v0.7.0-acceptance.md`.

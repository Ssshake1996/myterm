---
name: remote-ops-terminal-logs
description: Read, collect or export Remote Ops SSH and local terminal logs, including packaging multiple terminal records into one downloadable archive through the plugin tools.
---

# Remote Ops terminal logs

Use the plugin's log tools when the user asks for execution records, a terminal transcript or a multi-device log package. The tools do not send terminal input. No Agent configuration changes or external archive utility are needed.

## Discover and read

Call `remote_terminal_logs {}` to obtain the actual `logId` values, terminal names, host/port, session IDs, status and raw stream ranges. SSH logs belong to the calling conversation; the local terminal is shared. Recently closed terminals may remain available.

To inspect a log, call `remote_terminal_log_read` with its `logId`. Omit `cursor` to start at the earliest retained output. Continue with the returned `nextOffset` as `cursor` and the returned `streamId` until `hasMore` is false. These offsets refer to the raw stream, not the cleaned text length. `gap`, `truncated` and `evictedLogs` mean some history is unavailable; do not rerun device commands to recreate it.

## Export using the interface

For selected terminals, use exact IDs from the list:

```json
{"logIds":["<logId from list>","<another logId from list>"],"format":"zip"}
```

For the user's request to export all logs in the current conversation:

```json
{"all":true,"format":"zip"}
```

Pass either `logIds` or `all:true`, not both. A single terminal can use `format:"txt"`. Call `remote_terminal_log_export` directly; there is no need to read every page before packaging, copy UI text, write ZIP scripts or issue terminal commands. Arrays must be JSON arrays, not strings containing JSON.

Return the real absolute `downloadUrl` as a Markdown download link, with the filename and any missing-history limits. It uses the authenticated DSH browser's observed origin. If `downloadUrl` is null (no supported browser origin was observed), direct the user to the terminal toolbar's export menu; `downloadPath` is for same-host API clients, not a clickable chat link. Never invent a host or file path. The link requires the authenticated DSH web session and expires after one hour, earlier export-cache eviction or a host restart. A ZIP contains one UTF-8 TXT file per terminal and `manifest.json` with source IDs, times, raw offsets and truncation flags. `sha256` verifies the package.

## Interpret the record accurately

- Logs contain terminal output received by the plugin. Raw keyboard/password input is not added; input echoed by the device is already part of that output. Commands/secrets printed by a program can still appear in the transcript. Review before sharing outside the user's intended destination.
- The retention is in process memory: at most 4 MiB per terminal, trimmed to 3 MiB on overflow. Closed logs share a 16 MiB / 32-record limit. A restart removes the history. The API reports the actual retained range; never call a truncated export a complete audit trail.
- Each package accepts at most 32 logs / 32 MiB of raw output. If the requested selection is larger, split the listed IDs into smaller packages. An export freezes the current buffers; later output requires a new export.
- ANSI/control sequences are cleaned. Progress carriage returns become lines; the transcript is not a replay of `vim`, `top` or other full-screen applications. Timestamps describe capture/export ranges, not proven per-command start/end times.
- This covers visible SSH/local terminals. Independent `remote_command_execute` results and browser activity are separate surfaces. A live shell, silence, or text that says "success" does not prove a command's exit status; log completion remains unknown.

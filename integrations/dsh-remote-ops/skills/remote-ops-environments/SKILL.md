---
name: remote-ops-environments
description: Manage saved SSH and Telnet connection environments and groups in the DSH Remote Ops plugin, including listing, creating, updating, renaming, moving and deleting configurations. Use for SSH/Telnet 环境管理, not OS environment variables or configuring resources on a remote device.
---

# Remote Ops environments

For RESTful/API environments use **remote-ops-api** and `remote_api_environment_list/save/delete`. API environments require baseUrl, not SSH host/username fields. Their IDs are distinct; sshEnvironmentId links the API configuration to an existing SSH environment without sharing credentials. Use `remote_api_login/request/records` for visible API execution rather than terminal tools.

Use the installed `remote_environment_*` tools for the user's requested configuration changes. If the user explicitly supplies a username/password in the conversation for an environment, pass them directly to create/update; do not redirect them to the GUI. The plugin saves the password through DSH credentials and stores only its reference in the environment. GUI entry remains an option. Saved environments are shared within this DSH home. Remote terminal connections belong to conversations.

## Visible workspace

The top **终端 / 网页 / 文件 / API** tabs form a compact group on the left; the blue line spans the selected tab. Background badges remain visible. Use the tab labels or ArrowLeft / ArrowRight / Home / End; do not identify workspaces by screen coordinates or badge text. Environment management is the separate **环境** entry.

Open **环境 → SSH / Telnet** for saved terminal connections or **环境 → API** for API configurations. The **返回工作区** button at the top left returns to the previous terminal, webpage or API draft without releasing connections. Local CMD, SSH and Telnet sessions share one terminal tab strip; the selected tab is the visible terminal, while tools must still use the exact session ID returned by the plugin.

The environment page has group navigation (a dropdown in narrow panels), search, and an environment list. SSH/Telnet rows expose **进入 / 编辑 / 测试**. Row **更多环境操作** contains **新建独立连接** and **删除环境**. The selected group's **分组操作** menu renames it or deletes an empty group. **批量管理** reveals checkboxes; **删除所选** confirms exact names and addresses, and partial failures retain the failed selection with its reason. UI deletion closes the deleted environment's existing remote terminal connections; **返回工作区** only leaves the management page. Keep this distinction when explaining the UI to a user.

## Select an existing environment

Call `remote_environment_list`. Match the requested environment and reuse its returned internal `id` for updates/deletion, especially after renaming or moving groups. Names are accepted too; an exact ID takes precedence over a name. Clarify genuinely ambiguous targets. The list also contains connection/session information; a saved entry is not evidence of a successful SSH connection.

`passwordRef: "configured"` in a list/result is a display marker, not a usable credential reference. Omit this field when retaining the current credential.

## Create and update

`remote_environment_create` needs `host`; SSH also requires `username`. It generates the internal ID; `name` defaults to the host and `group` defaults to `default`. Optional settings include `port`, `password` or `passwordRef`, `privateKeyPath`, `cliProfile`, `terminal`, `platform`, `shell`, `encoding`, `readyTimeoutMs` and `hostKeySha256`. Transport defaults to SSH. Telnet uses `transport: "telnet"`; username is only required for username-password login. This saves a definition without connecting.

Example tool invocation (replace example values with the user's target):

```json
{
  "tool": "remote_environment_create",
  "arguments": {
    "name": "storage-lab",
    "host": "storage.example",
    "username": "operator",
    "password": "user-supplied-password",
    "group": "lab",
    "port": 22
  }
}
```

For an existing entry use `remote_environment_update`, with `environment` plus only the fields the user requested. Do not delete and recreate it or call the create tool with an undeclared `id`.

```json
{
  "tool": "remote_environment_update",
  "arguments": {
    "environment": "env-id-returned-by-list",
    "name": "storage-primary",
    "group": "production"
  }
}
```

- Omitted or null optional fields preserve their saved values. An update with no non-null changes is rejected.
- The internal ID is preserved. `name`, `host` and `group` must be non-empty strings. `username` is required for SSH and Telnet username-password login; other Telnet modes allow it to be empty. Name collisions are rejected. Moving to an absent group creates that group; the old group remains, possibly empty.
- `port` is an integer from 1 to 65535; use 22 to restore the normal SSH port. `encoding` accepts `utf-8`, `gb18030`, `big5`, `windows-1252` or `iso-8859-1`.
- A provided `cliProfile` or `terminal` object replaces that entire section; `{}` resets that section to defaults. Preserve any other section fields the user wants to keep. `cliProfile` supports `autoQuitMore`, `autoSigint`, `stripAnsi`, `headTailChars`; `terminal` supports `rows` (10–200) and `cols` (40–500).
- `password` accepts the exact password explicitly supplied by the user (1–8192 characters); preserve spaces and special characters. Create and update both support it for SSH and Telnet. Omit it or use null to retain the current password; an empty string is rejected. Do not invent a password or send the example placeholder. If using an existing `passwordRef`, omit `password`; supplying both is rejected.
- A new password creates a separate DSH credential reference for this environment, preserving other environments that shared the old reference. Tool results and plugin environment files contain no password. Existing terminal connections remain open; new connections use the new credential. DSH's conversation/tool-call history is managed by the host; do not claim that a chat-supplied password has been removed from that history.
- If the user wants to see a saved password, direct them to **环境 → SSH / Telnet → the environment's 编辑 → the eye button beside the password field**. It resolves the current credential only on that click; hiding it or closing the editor/drawer clears the revealed value. Viewing and saving other fields preserves the password. If the credential is missing, the user can re-enter it there. Keep password viewing in this user-facing flow; environment tools expose the configured marker. Do not read credential files or call the UI reveal route from an Agent tool.
- An empty string for `passwordRef` or `privateKeyPath` clears that setting only; it does not delete the credential/key itself. Omission keeps it. Do not clear a credential when merely renaming or moving an environment.

After a successful change, read the list to verify the saved values and report what changed. Do not claim connectivity based on `saved: true`.

For Windows desktop or Server, select `platform: "windows"`; `shell` is `server-default`, `cmd`, `windows-powershell` or `pwsh`. Keep `server-default` for Linux/Unix and device CLIs; `platform: "posix"` rejects explicit Windows shells. Explicit Windows shells use UTF-8 for the new process. Server-default uses the saved encoding for input and output. `readyTimeoutMs` is an integer 1000–120000 and only controls connection setup.

Call `remote_environment_test` to inspect actual OS facts, PTY/SFTP capabilities and stage failures. **环境 → SSH / Telnet → 测试** exposes the same diagnostics. First-use SSH keys are remembered; changed keys are rejected by terminal and file channels. A verified `hostKeySha256` pins the target identity. Never reset a changed fingerprint merely to silence the error. See the bundled `remote-ops-windows` skill for Windows scripts, paths and verification.

## Existing connections

Updates do not close, retarget or reconnect existing SSH/Telnet sessions. Each live session keeps the settings captured when it opened, including its old name, connection settings and CLI/terminal defaults. Saved changes apply to newly opened connections. Report this distinction when updating a connected environment. Open or close connections only when needed for the user's request; reuse exact returned session IDs for terminal operations.


The terminal strip offers **全部关闭** for the current conversation's SSH and Telnet tabs and connections. Local CMD, saved environments and other conversations remain. Live connections or known running commands receive one combined confirmation; failed closures remain visible. Connections opened after the selection are excluded. This is a UI action, not environment deletion. If the user asks the Agent to close terminals, use `remote_environment_list` and exact returned remote session IDs with `remote_terminal_close`; exclude `local-cmd`. Do not delete environments to clear tabs.

Amber means a known wait/independent command/close is active; green means connected, not command completion; gray means disconnected without a known running command. A disconnected PTY with an active independent command stays amber and still requires close confirmation. Hover/accessible descriptions give the specific state. Status does not grant exclusive ownership: humans can still type. Closing cancels associated waits and independent commands, but remote process termination remains unconfirmed. Inspect state before repeating a mutating command.

## Groups and deletion

- `remote_environment_group_create`: `{ "group": "lab" }`.
- `remote_environment_group_rename`: `{ "group": "lab", "name": "production" }`.
- `remote_environment_group_delete`: `{ "group": "lab" }`, only after the group is empty.
- `remote_environment_delete`: `{ "environment": "actual-environment-id" }`. It removes the saved definition and closes that environment's connections owned by the calling conversation. Other conversations' already-open connections are not closed. It does not remove the remote device, its files, or the credential itself.

Carry out changes within the user's authorization. If a target is ambiguous or the user asked only to inspect it, resolve that before modifying it. Do not add repeated confirmations for an already authorized change. A non-empty-group error is not permission to delete its environments. Read current state and correct the cause of an error instead of retrying the same invalid request.

## Telnet connections

Set `transport: "telnet"`, port 23 unless the user specifies another, and `telnet.loginMode` to `manual` (default), `username-password`, `password`, or `none`. The `telnet` object also accepts `lineEnding: "crlf" | "cr" | "lf"`, `usernamePrompt`, `passwordPrompt`, and `shellPrompt` regex strings (1-256 characters, must not match empty text). Omitted settings use built-in prompts. UTF-8 is default; use the saved encoding for older devices, e.g. gb18030. SSH keys and Windows shell selection apply to SSH only.

Example create parameters for a password-only device with an existing credential reference:

```json
{
  "tool": "remote_environment_create",
  "arguments": {
    "host": "device.example",
    "name": "Lab Telnet",
    "transport": "telnet",
    "port": 23,
    "passwordRef": "LAB_TELNET_PASSWORD",
    "telnet": { "loginMode": "password", "shellPrompt": "(?:^|[\\r\\n])SW>\\s*$" }
  }
}
```

Open once with `remote_terminal_open`, retain its exact `sessionId`, then inspect `login.state` through `remote_terminal_read`. Read while automatic login is pending. `manual` needs raw `remote_terminal_input` for login; `failed` includes a diagnostic code/message. The automatic login sends each credential once and does not retry failures. Do not send a command before `ready`, invent login success from a running TCP connection, or repeatedly reopen while waiting. A manual `remote_environment_test` confirms TCP only and reports the login stage as unconfirmed.

Use `remote_terminal_send/read/script` for visible device commands and `remote_terminal_input` for keys. Telnet has no independent exec channel, SFTP, SSH host fingerprint or reliable process exit code. Inspect actual device results; a matched shell prompt and `inferred_idle` are not success evidence. The connection is unencrypted. Automatic password echoes are redacted before readable output/logs; arbitrary device output/manual input may still contain sensitive data.

Use `remote_terminal_logs` and `remote_terminal_log_export` to export Telnet logs, including `all:true, format:"zip"` for the current conversation. Never rerun commands to recreate logs. Closing all remote tabs keeps local CMD and saved environments. A compatible hot reload retains live terminal objects; a full DSH restart requires reconnecting.

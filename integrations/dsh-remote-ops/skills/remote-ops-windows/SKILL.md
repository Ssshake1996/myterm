---
name: remote-ops-windows
description: Operate Windows desktop and Server targets through Remote Ops OpenSSH environments, visible CMD or PowerShell terminals, independent scripts, SFTP and retained terminal logs. Use the plugin's existing tools and returned IDs.
---

# Windows OpenSSH operations

Use this skill for a Windows target reachable through OpenSSH. The SSH service and account must already work. This plugin does not need PowerShell's SSH remoting subsystem; it uses ordinary PTY, exec and SFTP channels. Windows desktop and Server use the same environment form and tools.

## Identify and test the target

1. Call `remote_environment_list`. Reuse the exact saved environment ID and suitable existing session IDs. The local `local-cmd` belongs to the DSH host, not the remote Windows machine.
2. Create or update the requested environment with `platform: "windows"`, `transport: "ssh"` and `shell: "cmd"`, `"windows-powershell"`, `"pwsh"` or `"server-default"`. Default shell preserves the server configuration. PowerShell 7 must exist on the target. Updates affect new connections; existing sessions keep their original settings.
3. Use `remote_environment_test` with the environment ID. Inspect `stages`, `detected`, `capabilities` and `identity`. OS `productType` 1 means workstation, 2 domain controller and 3 Server; never infer the target system from the DSH host. PTY/exec/SFTP results only describe the tested channels, not file write permissions or every Windows release.
4. An independently verified `hostKeySha256` pins the OpenSSH fingerprint. Without a pin, first use is recorded locally and later changes are rejected. `trust: "first-use"` is not independent verification; report the fingerprint for checking. On `SSH_HOST_KEY_CHANGED`, do not clear or replace it just to make the connection work. Confirm the expected identity with the user/administrator before changing the saved pin.

Keep credentials in DSH credentials or an existing private key file on the DSH host. `passwordRef: "configured"` is a display marker; omit it when keeping an existing credential. Do not request passwords in the conversation. The user can enter or view them in **环境 → SSH → 编辑**.

## Visible terminal

Open with `remote_terminal_open` and use its exact `sessionId` in `remote_terminal_send/read/input`. Send complete command text, preserving spaces. CMD and PowerShell syntax differ. Human and Agent use the same terminal; no takeover is required. Raw `input` is for keys and interactive prompts.

Explicit Windows shells start in UTF-8 for that process. A server-default shell uses the environment's `encoding` for both input and output. Do not run global code-page, profile or SSH `DefaultShell` registry changes to fix one plugin session.

Silence, an echo or `inferred_idle` is not completion: terminal calls report `completion: "unknown"`. Read subsequent output with the returned cursor/stream ID, and inspect actual results before dependent operations.


The terminal strip's **全部关闭** closes only the selected SSH connections in the current conversation and retains local CMD, saved environments and other conversations. Amber indicates a known wait or independent command; green indicates a connection, not completion; gray indicates disconnection. Human input remains available while the Agent operates. Closing a Windows tab also cancels its independent exec connection; `terminationConfirmed: false` still requires checking the remote state before repeating an operation.

## Independent commands and scripts

Use `remote_command_execute` on an existing Windows SSH session when a real exit code and separate stdout/stderr are useful. It authenticates a separate SSH connection using the open session's original environment and the same host-key policy, avoiding reuse of the interactive Windows PTY connection. It does not inherit the interactive directory or temporary variables. Specify `workingDirectory` when needed. The plugin passes PowerShell parameter values as data, not interpolated shell code.

Example (replace the session ID and path with values from the actual environment):

```json
{
  "session": "session-id-returned-by-open",
  "shell": "windows-powershell",
  "command": "param($path) Get-ChildItem -LiteralPath $path | Select-Object Name,Length | ConvertTo-Json -Compress",
  "parameters": { "path": "C:\\Ops Data\\日志" },
  "workingDirectory": "C:\\Ops Data",
  "timeoutSeconds": 30
}
```

`parameters` is an object of named scalar values or arrays of scalars. It is not a JSON string. CMD takes a complete batch script in `command`, without a parameters object; batch percent/caret rules apply. Use PowerShell with named parameters when passing arbitrary paths or text. CMD execution uses a temporary `.cmd` file removed on normal completion. Cancellation/disconnection can leave it behind.

Check `status`, `completion`, `exitCode`, both streams and the requested business result. PowerShell errors become failure; a native program's nonzero exit is preserved. A successful transport alone does not prove the operation's business outcome. Stopping the DSH conversation cancels the wait and requests channel shutdown, but `terminationConfirmed: false` does not prove the remote process stopped. After timeout/disconnection, inspect state rather than replaying a mutating command.

## Files and logs

- Use existing `remote_sftp_list/read/write/mkdir/rename/upload/download/delete`. Windows paths may be `C:/Ops Data`, `C:\\Ops Data` or the server's canonical `/C:/Ops Data`; use the returned canonical path when possible. An absolute drive root is `C:/`, not drive-relative `C:folder`. Directory creation reports permission/type errors instead of claiming success.
- Upload/download preserve binary bytes. Replacement requires `overwrite: true`; only request it within the user's authorized scope. Check the destination and, for release files, compare SHA256 using an independent command on the target.
- A first SFTP process initialization failure may be retried once before any file request; commands and file mutations are not replayed. A persistent failure remains an error.
- Use `remote_terminal_logs` → exact returned `logId`s → `remote_terminal_log_export` with `format: "zip"` to package multiple terminal logs. Return the real download URL and SHA256 when provided. Logs retain bounded terminal output in process memory; independent command results are returned separately and are not a PTY transcript. Disclose truncation and missing history.

These tools implement the OpenSSH phase. Consult the actual release verification matrix before claiming a Windows version, authentication method or Shell combination has been tested. WinRM and desktop mouse/keyboard control remain separate planned capabilities.

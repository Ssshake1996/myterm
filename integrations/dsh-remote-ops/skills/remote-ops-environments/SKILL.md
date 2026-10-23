---
name: remote-ops-environments
description: Manage saved SSH connection environments and groups in the DSH Remote Ops plugin, including listing, creating, updating, renaming, moving and deleting configurations. Use for SSH 环境管理, not OS environment variables or configuring resources on a remote device.
---

# Remote Ops environments

For RESTful/API environments use **remote-ops-api** and `remote_api_environment_list/save/delete`. API environments require baseUrl, not SSH host/username fields. Their IDs are distinct; sshEnvironmentId links the API configuration to an existing SSH environment without sharing credentials. Use `remote_api_login/request/records` for visible API execution rather than terminal tools.

Use the installed `remote_environment_*` tools for the user's requested configuration changes. The tools and this skill travel with the plugin; do not edit Agent settings, plugin JSON files or the credentials store directly. Saved environments are shared within this DSH home. SSH connections belong to conversations.

## Select an existing environment

Call `remote_environment_list`. Match the requested environment and reuse its returned internal `id` for updates/deletion, especially after renaming or moving groups. Names are accepted too; an exact ID takes precedence over a name. Clarify genuinely ambiguous targets. The list also contains connection/session information; a saved entry is not evidence of a successful SSH connection.

`passwordRef: "configured"` in a list/result is a display marker, not a usable credential reference. Omit this field when retaining the current credential.

## Create and update

`remote_environment_create` needs `host` and `username`. It generates the internal ID; `name` defaults to the host and `group` defaults to `default`. Optional settings include `port`, `passwordRef`, `privateKeyPath`, `cliProfile` and `terminal`. This saves a definition without connecting.

Example tool invocation (replace example values with the user's target):

```json
{
  "tool": "remote_environment_create",
  "arguments": {
    "name": "storage-lab",
    "host": "storage.example",
    "username": "operator",
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
- The internal ID is preserved. `name`, `host`, `username` and `group` must be non-empty strings. Name collisions are rejected. Moving to an absent group creates that group; the old group remains, possibly empty.
- `port` is an integer from 1 to 65535; use 22 to restore the normal SSH port. `encoding` accepts `utf-8`, `gb18030`, `big5`, `windows-1252` or `iso-8859-1`.
- A provided `cliProfile` or `terminal` object replaces that entire section; `{}` resets that section to defaults. Preserve any other section fields the user wants to keep. `cliProfile` supports `autoQuitMore`, `autoSigint`, `stripAnsi`, `headTailChars`; `terminal` supports `rows` (10–200) and `cols` (40–500).
- Use an existing Harness `passwordRef` or a private key path on the DSH host. These tools do not accept or store a literal SSH password. If a new password must be stored, the user can enter it in the plugin environment form, which uses the Harness credentials service. Do not ask them to paste it into the conversation.
- If the user wants to see a saved password, direct them to **环境 → the environment's 编辑 → the eye button beside SSH 密码**. It resolves the current credential only on that click; hiding it or closing the editor/drawer clears the revealed value. Viewing and saving other fields does not rewrite the password. If the credential is missing, the user can re-enter it there. Environment tools return only the configured marker and do not provide a plaintext-password reader; do not work around that by reading credential files or calling the UI reveal route from an Agent tool.
- An empty string for `passwordRef` or `privateKeyPath` clears that setting only; it does not delete the credential/key itself. Omission keeps it. Do not clear a credential when merely renaming or moving an environment.

After a successful change, read the list to verify the saved values and report what changed. Do not claim connectivity based on `saved: true`.

## Existing connections

Updates do not close, retarget or reconnect existing SSH sessions. Each live session keeps the settings captured when it opened, including its old name, connection settings and CLI/terminal defaults. Saved changes apply to newly opened connections. Report this distinction when updating a connected environment. Open or close connections only when needed for the user's request; reuse exact returned session IDs for terminal operations.

## Groups and deletion

- `remote_environment_group_create`: `{ "group": "lab" }`.
- `remote_environment_group_rename`: `{ "group": "lab", "name": "production" }`.
- `remote_environment_group_delete`: `{ "group": "lab" }`, only after the group is empty.
- `remote_environment_delete`: `{ "environment": "actual-environment-id" }`. It removes the saved definition and closes that environment's connections owned by the calling conversation. Other conversations' already-open connections are not closed. It does not remove the remote device, its files, or the credential itself.

Carry out changes within the user's authorization. If a target is ambiguous or the user asked only to inspect it, resolve that before modifying it. Do not add repeated confirmations for an already authorized change. A non-empty-group error is not permission to delete its environments. Read current state and correct the cause of an error instead of retrying the same invalid request.

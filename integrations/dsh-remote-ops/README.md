# @dsh/remote-ops

Standalone DeepSeek Harness plugin for remote Linux operations. It does not
depend on or start the myterm desktop application.

## Capabilities

- Environment groups persisted as `remote-ops/environments/<group>/environments.<group>.json`.
- The right Sidebar uses a narrow navigation rail, a hideable environment drawer, a persistent SSH terminal, and a quick-command dock below the terminal.
- Environments and quick commands support manual create, edit, delete, and group management; non-empty groups cannot be deleted.
- Owner-scoped SSH sessions backed by the Harness `ctx.terminals` service.
- A local CMD terminal starts with the plugin at `$DSH_HOME/remote-ops`, before an Agent is initialized. It accepts ordinary local commands and interactive `ssh`; saved-environment SSH sessions fall back to this terminal after disconnecting.
- Complete command submission, direct terminal keyboard input, signals, and retained output; Tab completion, arrows, backspace, Enter, and Ctrl+C are forwarded as terminal keys.
- SSH sessions request a UTF-8 locale and the UI removes ANSI control sequences; the backend accepts UTF-8, GB18030, Big5, and related terminal encodings.
- A lightweight VT screen model applies ConPTY clear, cursor, line-rewrite, and scroll operations, avoiding blank screen snapshots while keeping the final line reachable through a stable scrollbar.
- Cursor-based output deltas use long polling and serialized batched keyboard writes, so idle terminals no longer transfer complete snapshots or generate frequent empty requests.
- Sequential multi-target execution for observe-then-continue workflows.
- SFTP list, read, write, mkdir, delete, and rename operations.
- Quick command storage and execution.
- Agent-visible diagnostics and a native DSH right-sidebar tab.
- A visible `Remote Ops` launch button in the DSH Web sidebar footer; it opens
  the right Sidebar without waiting for an Agent tool call.
- The Sidebar header shows the installed plugin version, checks the latest
  GitHub Release, and can install an update with one click; refresh and update
  actions expose loading/success/failure feedback. Restart DSH after the package
  manager finishes.
- The quick-command dock can be resized by dragging its top boundary (double-click
  to restore the default height). The environment form hides the internal Harness
  credential reference; SSH passwords are stored through the Harness credentials service.
- Connection errors remain visible until dismissed; credential references through Harness credentials and plaintext passwords are
  never persisted.

## Installation

Install the release tarball with the official DSH plugin manager. The
`dsh.bundle.patch` declaration activates the bundle automatically; do not copy
the patch into the profile by hand.

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.2.25.tgz
dsh web
```

For a package obtained from a registry, the package name is:

```sh
dsh plugin --profile web add @dsh/remote-ops
```

The GitHub release asset is the canonical artifact for this repository. A
local checkout can also be packed with `npm pack` and installed with the same
command.

The plugin is a pure DeepSeek Harness plugin and this repository no longer
contains the myterm desktop application. It works in DSH hosts that provide the
documented Agent, terminal, tools, system-prompt, credentials, and connection
services. SSH PTYs are process-local by design; saved environment definitions
survive restarts and reconnect on demand.

The client supports the `Regular` icon exports in DSH 0.2.0-rc.2 and falls back
to the size-based exports used by older hosts. Version 0.2.23 fixes the blank
Remote Ops panel caused by the icon export change.

After DSH Web starts, click `Remote Ops` in the sidebar footer to open the
right Sidebar while keeping the current conversation visible. The button never
starts a fallback conversation; if the Sidebar service is not ready, the plugin
retries and reports the exact failure. SSH and SFTP actions remain owned by the
selected Harness session.

## Interactive Workspace

- Enter reuses an existing connection or offers a chooser; the separate plus action opens a new connection (maximum three per environment and owner). Inspect owner/activity and release individual connections. Hosts exposing `sessionController.resolveAgent` can resume a saved session without a model prompt; an unsaved draft is not an SSH owner.
- Manual input holds the terminal until explicitly returned to the Agent. Takeover, stop-wait, Ctrl+C and connection release are separate operations. The Agent receives `TERMINAL_MANUAL_CONTROL` instead of interleaved input. Adopted backends that cannot stop a wait without interruption report that limitation.
- Quick buttons below terminal output dispatch the complete saved command plus Enter to the currently visible terminal without a model round trip. Management supports multiline editing, groups, search, ordering, pin/unpin and optional confirmation. Unpinning retains the library entry; deletion requires confirmation. Multiline paste still requires confirmation.
- The dock opens by default and remembers its height and collapsed state. Drag its top border with a mouse or touch, use arrow keys, or double-click to restore 190px. Height is bounded by actual plugin space, not two rows or 360px, and preserves a minimum terminal viewport. The command list scrolls internally. The outer Sidebar width remains owned by Harness.
- Dispatch captures the owner, exact terminal, stream and command revision. It neither reconnects nor switches targets. A bounded in-memory receipt cache deduplicates the same request for ten minutes (1024 entries maximum); the UI never automatically retries an uncertain write. Written means accepted by the terminal, not completed. Unsubmitted input from this browser blocks dispatch, but arbitrary interactive-program state and edits from other browsers cannot be inferred. Active Agent input is rejected, not automatically taken over.
- Both file panes independently select the DSH host or an SSH environment. Browser upload/download refers to the browser device. Files and directories can be selected together; SSH-to-SSH copies stream through the DSH host. Upload/download no longer buffer entire files or impose a 2 MiB limit.
- Transfers report bytes/files, cancellation and error/skip/overwrite conflict policies. Tool overwrite requires `overwrite: true`. Two jobs run concurrently, at most 20 are pending/running and 50 recent records are kept. Jobs are not resumed across restarts. Cancellation removes incomplete staging files, not already completed files/directories. Symlinks/devices are not followed; traversal is limited to depth 32 and 10,000 entries. Remote overwrite requires the atomic rename extension.
- Errors retain phase, code and original causes. Diagnostic export previews a metadata whitelist without credentials, command text, host addresses or terminal content.

## Data Storage

The plugin stores its own data under `$DSH_HOME/remote-ops`:

- `environments/<group>/environments.<group>.json` for environment definitions.
- `quick-commands/<group>/commands.<group>.json` for reusable commands.

Use a Harness credential reference such as `passwordRef` for passwords. The
Sidebar form also accepts an SSH password and stores it through
`credentials.set`; the environment JSON keeps only the reference. A private
key may be referenced by local path.

## Agent tools

Version 0.2.25 exposes environment list/create/update/delete, group management,
terminal
open/send/read/signal/close, multi-target batch execution, quick-command list
and run, SFTP operations, and diagnostics. The system-prompt contribution tells
the model to send a complete command when it is known and to use incremental
terminal feedback only when the current CLI state is genuinely uncertain.

Use `session: "local-cmd"` for the plugin's shared visible local terminal,
not the Harness built-in bash/pwsh tool. For SSH, reuse an explicit session
from the environment list. Sending by environment reuses a unique connection;
multiple connections require an explicit session id.

`remote_terminal_send` waits for fresh output and returns `output`,
`submittedText`, `submit`, `streamId`, `startOffset`, `nextOffset`, `endOffset`,
`hasMore`, `reset`, and `truncated`. The default output page is 16,384 UTF-16
code units, with surrogate pairs kept intact. Old viewport history is omitted
unless `includeViewport: true` is requested. To continue without typing:

```json
{"session":"local-cmd","cursor":546,"streamId":"<streamId from send/read>","waitMs":20000}
```

Pass that object to `remote_terminal_read`, replacing the cursor with the
previous `nextOffset`. Drain `hasMore` before waiting. Omit the cursor for
recent history; explicit `offset`/`count` selects backward line history.
`reset`/`truncated` signals replaced or expired history. Tool output is the
raw terminal stream, including control sequences; the UI renders that stream
through its VT model. A running shell, silence (`inferred_idle`), and timeout
do not prove command completion or success: `completion` remains `unknown`.
Observe actual results before dependent commands. Cancellation interrupts the
foreground process; a wait timeout alone does not kill it.

### CLI assist for device REPLs

`remote_terminal_send` (and `remote_terminal_batch` / `remote_quick_command_run`)
accept options that remove model round trips on vendor CLIs. They apply only to
Agent sends, never to manual UI input, and every applied step is returned in
`autoActions` and written to the diagnostics events.

The plugin never answers a `(y/n)` confirmation by itself. v0.2.24 and v0.2.25
shipped `autoConfirm`/`confirmPattern` for that; they were removed because
silently typing `y` can approve destructive operations. A caller that still
passes them gets a `notices` entry, and `cliProfile.autoConfirm` /
`cliProfile.confirmPattern` are rejected when saving an environment (values left
in older environment files are dropped on load). Read the prompt in the output
and answer it with `remote_terminal_send`; for a known sequence the user has
approved, `remote_terminal_script` `answers` type exactly the text the call
declares, nothing more.

| Option | Default | Behavior |
| --- | --- | --- |
| `autoQuitMore` | `false` | When the output ends with a `--More--` pager line, send `q` (no Enter), wait 300 ms and return the remaining output; at most 3 times per call. |
| `autoSigint` | `true` | When the last 2 KB of this send's output contains a parameter-error hint (`^` arrow line followed by `[param=?]` suggestions, `/\n\s+\^\s*\n\s*\[.*\=.*\]/m`), send SIGINT, wait 500 ms and append `[auto-sigint: command line cleared]` to the returned `output`. The marker is not written to the terminal stream. Set `false` to disable. |

### Environment profiles, output options, scripts and terminal size (v0.2.25)

- **Environment profile.** An environment may carry `cliProfile`
  (`autoQuitMore`, `autoSigint`, `stripAnsi`, `headTailChars`) and a default PTY
  `terminal: { rows, cols }`. They are edited in the environment form or passed
  to `remote_environment_create`.
  Call arguments always override the profile; values equal to the defaults are
  not stored, saving an empty value clears the profile, and omitting the field
  keeps it. `remote_environment_list` shows the profile to the model.
- **`stripAnsi`** (send/read/batch/quick-run/script) removes ANSI/VT control
  sequences from the returned text. Offsets and cursors keep counting the raw
  stream; a page never ends inside an escape sequence.
- **`headTailChars`** (200-100000, `0` = off) returns only the first and last N
  characters of a long page with a marker. The result carries `summarized: true`
  and `omitted` (`chars`, `lines`, raw `startOffset`/`endOffset`); read the
  omitted range with `remote_terminal_read` using `cursor=omitted.startOffset`.
  A summarized send is recorded as a truncated tool receipt.
- **`remote_terminal_script`** runs up to 20 ordered steps on one exact session
  in one call. A step has `text`, optional `submit`, `quietMs`, `timeoutSeconds`,
  `answers` (`[{ pattern, text, submit?, times? }]`, tried in order, at most
  `times` each), `expect` (regex that must match the end of the step's output)
  and `failOn` (regex searched in the whole output, even where a summary hides
  it). Everything is validated before the first character is typed. The script
  stops at the first error, timeout, failed check or session exit and returns
  every executed step in `steps` plus `stopped`; remaining steps are not run.
  `completion` stays `unknown`.
- **`remote_terminal_resize`** changes the PTY of an SSH connection
  (`rows` 10-200, `cols` 40-500); the UI has a size selector for SSH tabs and
  frames report the PTY size so the VT model wraps at the real width. The shared
  local terminal is fixed at 40x160 (the host has no resize API) and connections
  held by the host after a plugin reload cannot be resized.
- **Dropped connections.** A connection remembers why it closed (transport
  error, remote exit code). Unexpected drops are listed in
  `remote_environment_list` as `disconnects` and in diagnostics; sending to a
  dead connection explains that nothing was replayed and how to reopen it, and a
  send that ended because the connection dropped carries `reconnect`.
- **Hardening.** `remote_terminal_send` and `remote_terminal_read` only forward
  their declared arguments, so an undeclared `actor` can no longer bypass the
  manual-input guard.

The terminal status bar distinguishes transport, Agent binding, and the last
tool response range/time. A tool receipt is not proof that a model understood
the output. Enlarged icon controls have tooltips. The quick-command dock
remembers its expanded state; reading history is preserved across SFTP switches, and new
output offers a jump to the latest line without taking over the scroll position.

The client dependency on `sidebarRight` and `sidebarRightTabs` is optional at
activation time. On older or non-Web DSH profiles the plugin no longer blocks
boot; the Sidebar UI attaches automatically when those services become
available.

## Independent Commands and Workspace State

Use `remote_command_execute(session, command)` for self-contained commands.
It returns separate bounded UTF-8 stdout/stderr, a real exit code when supplied
by the process, duration and truncation flags. It never types into the PTY.
Local execution starts a new shell in the plugin directory; SSH opens an exec
channel on an existing connection with the server-default directory. Neither
inherits the interactive terminal's temporary variables or current directory.
There is no stdin. Timeout/cancellation does not prove a remote process stopped.
Limits: 30 seconds by default, 300 seconds maximum, 64 KiB per output stream by
default, 256 KiB maximum, one active command per target and eight total.

Connections use their environment name; exact session IDs still select and close
individual connections. Disconnected tabs retain their output until dismissed;
reconnection is explicit and never replays commands. Manual input is shared
across browser windows, without per-window locks or takeover. Human/Agent input
coordination remains; simultaneous manual input can interleave. Recreated
terminal streams require input acknowledgement.

SFTP remembers endpoint, path, sort, scroll and bookmarks per Harness session
in browser storage. Transfer results include per-item state; retries skip
completed items. Overwrite previews show both sizes and timestamps. Tasks and
receipts are runtime-only, not cross-restart persistence.

The lightweight terminal supports alternate screens, scroll regions and charset
selection escapes. Full-screen grids do not soft-wrap. The current Harness
local PTY has no runtime resize API: this remains a fixed 160x40 terminal, not
a complete xterm replacement. Actual OS IME behavior requires device testing.

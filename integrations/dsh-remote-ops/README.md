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
dsh plugin --profile web add ./dsh-remote-ops-v0.2.13.tgz
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

After DSH Web starts, click `Remote Ops` in the sidebar footer to open the
right Sidebar while keeping the current conversation visible. The button never
starts a fallback conversation; if the Sidebar service is not ready, the plugin
retries and reports the exact failure. SSH and SFTP actions remain owned by the
selected Harness session.

## Data

The plugin stores its own data under `$DSH_HOME/remote-ops`:

- `environments/<group>/environments.<group>.json` for environment definitions.
- `quick-commands/<group>/commands.<group>.json` for reusable commands.

Use a Harness credential reference such as `passwordRef` for passwords. The
Sidebar form also accepts an SSH password and stores it through
`credentials.set`; the environment JSON keeps only the reference. A private
key may be referenced by local path.

## Agent tools

Version 0.2.13 exposes environment list/create/update/delete, group management,
terminal
open/send/read/signal/close, multi-target batch execution, quick-command list
and run, SFTP operations, and diagnostics. The system-prompt contribution tells
the model to send a complete command when it is known and to use incremental
terminal feedback only when the current CLI state is genuinely uncertain.

The client dependency on `sidebarRight` and `sidebarRightTabs` is optional at
activation time. On older or non-Web DSH profiles the plugin no longer blocks
boot; the Sidebar UI attaches automatically when those services become
available.

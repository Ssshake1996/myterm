# @dsh/remote-ops

Standalone DeepSeek Harness plugin for remote Linux operations. It does not
depend on or start the myterm desktop application.

## Capabilities

- Environment groups persisted as `remote-ops/environments/<group>/environments.<group>.json`.
- The right Sidebar uses a narrow navigation rail, a hideable environment drawer, a persistent SSH terminal, and a quick-command dock below the terminal.
- Environments and quick commands support manual create, edit, delete, and group management; non-empty groups cannot be deleted.
- Owner-scoped SSH sessions backed by the Harness `ctx.terminals` service.
- Complete command submission, interactive input, signals, and retained output.
- Sequential multi-target execution for observe-then-continue workflows.
- SFTP list, read, write, mkdir, delete, and rename operations.
- Quick command storage and execution.
- Agent-visible diagnostics and a native DSH right-sidebar tab.
- A visible `Remote Ops` launch button in the DSH Web sidebar footer; it opens
  the right Sidebar without waiting for an Agent tool call.
- The Sidebar header shows the installed plugin version, checks the latest
  GitHub Release, and can install an update with one click; restart DSH after
  the package manager finishes.
- Credential references through Harness credentials; plaintext passwords are
  never persisted.

## Installation

Install the release tarball with the official DSH plugin manager. The
`dsh.bundle.patch` declaration activates the bundle automatically; do not copy
the patch into the profile by hand.

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.2.2.tgz
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
right Sidebar while keeping the current conversation visible. If no DSH
conversation is selected, the button starts a new DSH conversation; SSH and
SFTP actions remain owned by the selected Harness session.

## Data

The plugin stores its own data under `$DSH_HOME/remote-ops`:

- `environments/<group>/environments.<group>.json` for environment definitions.
- `quick-commands/<group>/commands.<group>.json` for reusable commands.

Use a Harness credential reference such as `passwordRef` for passwords. A
private key may be referenced by local path.

## Agent tools

Version 0.2.2 exposes environment list/create/update/delete, group management,
terminal
open/send/read/signal/close, multi-target batch execution, quick-command list
and run, SFTP operations, and diagnostics. The system-prompt contribution tells
the model to send a complete command when it is known and to use incremental
terminal feedback only when the current CLI state is genuinely uncertain.

The client dependency on `sidebarRight` and `sidebarRightTabs` is optional at
activation time. On older or non-Web DSH profiles the plugin no longer blocks
boot; the Sidebar UI attaches automatically when those services become
available.

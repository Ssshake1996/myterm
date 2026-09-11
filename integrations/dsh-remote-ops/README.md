# @dsh/remote-ops

Standalone DeepSeek Harness plugin for remote Linux operations. It does not
depend on or start the myterm desktop application.

## Capabilities

- Environment groups persisted as `remote-ops/<group>-environments.json`.
- Owner-scoped SSH sessions backed by the Harness `ctx.terminals` service.
- Complete command submission, interactive input, signals, and retained output.
- Sequential multi-target execution for observe-then-continue workflows.
- SFTP list, read, write, mkdir, delete, and rename operations.
- Quick command storage and execution.
- Agent-visible diagnostics and a native DSH right-sidebar tab.
- A visible `Remote Ops` launch button in the DSH Web sidebar; it opens the
  plugin workspace without waiting for an Agent tool call.
- Credential references through Harness credentials; plaintext passwords are
  never persisted.

## Installation

Install the release tarball with the official DSH plugin manager. The
`dsh.bundle.patch` declaration activates the bundle automatically; do not copy
the patch into the profile by hand.

```sh
dsh plugin --profile web add ./dsh-remote-ops-v0.1.1.tgz
dsh web
```

For a package obtained from a registry, the package name is:

```sh
dsh plugin --profile web add @dsh/remote-ops
```

The GitHub release asset is the canonical artifact for this repository. A
local checkout can also be packed with `npm pack` and installed with the same
command.

The plugin is independent from myterm and works in DSH hosts that provide the
documented Agent, terminal, tools, system-prompt, credentials, and connection
services. SSH PTYs are process-local by design; saved environment definitions
survive restarts and reconnect on demand.

After DSH Web starts, click `Remote Ops` in the left sidebar to launch the
plugin workspace. If no DSH conversation is selected, the workspace can show
saved environments and offers `New DSH conversation`; SSH and SFTP actions are
enabled after a conversation is selected so terminal ownership remains under
Harness.

## Data

The plugin stores its own data under `$DSH_HOME/remote-ops`:

- `<group>-environments.json` for environment definitions.
- `quick-commands.json` for reusable commands.

Use a Harness credential reference such as `passwordRef` for passwords. A
private key may be referenced by local path.

## Agent tools

The first release exposes environment list/create/delete, terminal
open/send/read/signal/close, multi-target batch execution, quick-command list
and run, SFTP operations, and diagnostics. The system-prompt contribution tells
the model to send a complete command when it is known and to use incremental
terminal feedback only when the current CLI state is genuinely uncertain.

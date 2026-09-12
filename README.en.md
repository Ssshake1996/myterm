# DSH Remote Ops

`@dsh/remote-ops` is a DeepSeek Harness plugin for SSH-based remote
operations. The repository has been cut over to the plugin boundary: it no
longer contains the myterm desktop application, a Tauri host, or a second
Agent kernel.

## Capabilities

- DSH Web right Sidebar plugin that keeps the main conversation visible.
- Narrow navigation rail and a hideable environment drawer.
- Create, edit, delete, group, and persist SSH environments.
- Multiple SSH terminal tabs with the terminal as the primary workspace.
- Quick-command groups docked below the terminal.
- Complete multiline command submission without short-request splitting.
- SFTP directory listing, file read/write, mkdir, delete, and rename.
- Sequential Multi-SSH tools, Agent diagnostics, and Harness credential references.
- The Sidebar shows the installed plugin version, checks GitHub Releases, and can install an update with one click; restart DSH after the upgrade.

## Installation

Download the package from [GitHub Releases](https://github.com/Ssshake1996/myterm/releases), then run:

```powershell
dsh plugin --profile web add .\dsh-remote-ops-v0.2.2.tgz
dsh web
```

Local checks:

```powershell
npm --prefix integrations/dsh-remote-ops install
npm --prefix integrations/dsh-remote-ops run check
```

## Layout

```text
integrations/dsh-remote-ops/
├─ lib/index.js       # Harness host, SSH, SFTP, tools, persistence
├─ lib/client.js      # DSH Web Sidebar UI
├─ cordis.patch.yml   # Official DSH bundle patch
└─ test/smoke.mjs     # Plugin smoke test
```

Runtime data is isolated under `$DSH_HOME/remote-ops`:

```text
remote-ops/
├─ environments/<group>/environments.<group>.json
└─ quick-commands/<group>/commands.<group>.json
```

Passwords and private keys are referenced through Harness credentials and are
never written to JSON.

## Release

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/release-dsh-remote-ops.ps1 -Version 0.2.2
```

The release script checks, packs, commits, tags, pushes the main branch, and
publishes the GitHub Release.

## Boundary

- DeepSeek Harness owns the Agent Loop, Sessions, Goals, Skills, MCP,
  permissions, and local tools.
- This plugin provides SSH, interactive terminals, SFTP, quick commands,
  Multi-SSH coordination, and remote diagnostics.
- The repository no longer builds or starts the myterm desktop application.

See the [Chinese plugin guide](integrations/dsh-remote-ops/README.zh-CN.md),
[English plugin guide](integrations/dsh-remote-ops/README.md), and [development
experience record](docs/development-experience.md).

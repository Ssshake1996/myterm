# myterm

English | [简体中文](README.md)

myterm is a lightweight desktop terminal for development, operations, and server administration. Built with Tauri 2, Rust, React, and xterm.js, it combines SSH, local shells, saved servers, SFTP, quick commands, and a tool-using AI Agent in one compact workbench.

Current version: `0.6.4`

## Core Features

### Servers and Sessions

- Create, edit, and delete SSH and local-terminal profiles.
- Save names, groups, environments, hosts, ports, usernames, authentication modes, and terminal types.
- Passwords, private-key passphrases, and AI API keys stay in the operating-system credential vault; configuration stores references only.
- Click a saved server to connect. Persisted credentials support automatic login after restarting the app.
- Search sessions, organize them as a tree, reorder tabs by drag, and inspect connection state.

### Terminal Workbench

- A full xterm.js terminal with UTF-8, color, WebGL rendering, and automatic fitting.
- Multiple session tabs. Closing a tab disconnects every session it owns.
- Right-side splitting, adjustable ratios, and an explicit close action for either pane. Closed panes never remain as hidden connections.
- Switch the active SSH workspace between terminal and SFTP views.
- Local shells and SSH sessions share the same tab and split workflow.

### Quick Command Library

- Organize common, deployment, and troubleshooting commands into command sets that scale to dozens of entries.
- Compact rows show only operator-authored names; long command bodies stay out of the main surface.
- Search, create, edit, delete, reorder, and browse commands in a scrolling multi-column layout.
- A single command may contain multiple lines. Each line is sent with terminal-return semantics.
- Resize or clearly collapse the command dock while keeping titles vertically centered.

### SFTP File Management

- Reuse the active SSH connection and start from the local user directory and remote login directory instead of assuming deployment paths.
- Load local and remote panes independently so one failed directory does not hide the other; errors identify the pane and underlying reason.
- Upload, download, create, rename, and recursively delete entries.
- Inspect size, modification time, and permissions, with a cancellable transfer queue.
- Agent file writes use a same-directory temporary file, synchronization, permission preservation, hash locking, and readback verification.

### Linux Operations Agent

The Agent follows a Claude Code-style loop:

```text
task input -> model decision -> tool call -> result -> continue -> final answer
```

- Persistent tasks, ordered events, approvals, tool audit records, background jobs, cancellation, and crash recovery.
- A tool-centric timeline shows model decisions, tool names, parameter summaries, stdout, stderr, results, and status.
- Task input supports `Shift+Enter` newlines and IME protection; a top handle expands the composer up to half the Agent panel height.
- Built-in tools cover session metadata, terminal context, terminal input, structured SSH execution, host facts, directories, and files; explicit multi-SSH targets are planned next.
- Structured execution records stdout/stderr separately with exit code, signal, timeout, cancellation, and disconnect outcomes.
- Long operations can become background jobs with status, paged output, and cancellation tools.
- Diagnostic runbooks, context compaction, loop detection, and pre-persistence secret redaction are built in.

### Permissions and Safety

| Mode | Behavior |
|---|---|
| Read only | Automatically runs only operations classified as reads |
| Confirm | Requires per-operation approval for side effects; the default |
| Task grant | Allows low/medium-risk operations within a task on non-production, non-root sessions |

Hard-deny commands, production/root escalation, output limits, audit records, and redaction cannot be bypassed by prompts, Skills, Hooks, or MCP. Bash is parsed with tree-sitter; incomplete or unclassified syntax is never auto-executed.

### Skills, MCP, and Hooks

- Discover local `SKILL.md` files, record metadata and content hashes, and load enabled Skills on demand.
- Configure and test common stdio MCP servers, list their tools, and let the Agent call them through the same policy gate.
- Large MCP catalogs use search plus explicit invocation to protect model context.
- Bounded deterministic lifecycle Hooks are supported and cannot lower core permissions.

### Remote CLI, REST, and Multi-SSH Plan

- CLI means running large numbers of `systemctl`, `journalctl`, `docker`, `kubectl`, and business commands over SSH with structured results. It does not mean that myterm needs a public CLI product surface.
- REST means calling business or infrastructure HTTP APIs from an explicit remote SSH origin with the correct network perspective, credential redaction, and audit. It does not mean exposing the myterm Agent as a REST service.
- Multi-SSH binds several saved servers to one Task, requires an explicit target on every tool call, and supports operating on A, observing from B, and continuing only after a condition passes.
- OS installation is planned as a local-Skill-triggered installation Task. The Skill builds and validates the plan; approved provisioning tools perform disk, boot, and power operations through a hypervisor, cloud API, MAAS, or Redfish/BMC.

See the [Multi-SSH and Skill-driven OS Installation Plan](docs/multi-ssh-os-installation-plan.md) for boundaries, tradeoffs, and staged delivery. Version `0.6.3` removes the early local Agent CLI and loopback REST surfaces. myterm remains a desktop application; CLI/REST refers only to commands and HTTP requests executed by the Agent in remote SSH environments.

### Appearance and Help

- Persistent light, eye-care, and dark themes also update the terminal canvas.
- A compact 34px session strip and full-height sidebar work across desktop and narrow windows.
- A help icon at the far right of the title strip opens the packaged offline user guide.

## Architecture

```text
React UI
  -> typed IPC adapter
    -> Tauri commands
      -> Agent application service
        -> policy + audit + SQLite task store
        -> SSH targets / PTY / SFTP / Skill / MCP / Hooks
        -> planned provisioning adapters
```

- `src/`: React UI, state, and typed IPC boundary.
- `src-tauri/`: Rust services, Agent core, and the Tauri desktop entry point.
- `myterm-spec/`: product, architecture, milestone, and acceptance specifications.
- `myterm-prototype/`: early static interaction prototype.
- `docs/`: user guide, Agent specifications, development plan, and experience record.

## Development

Prerequisites are Node.js/npm, Rust stable MSVC, Visual Studio 2022 C++ Build Tools, and WebView2. Windows native dependencies also require NASM, or `AWS_LC_SYS_PREBUILT_NASM=1` for non-FIPS builds.

```powershell
npm install
npm run typecheck
npm run lint
npm test
npm run dev
```

The browser development build uses an in-memory adapter at the IPC boundary. Desktop development uses the real Rust services and operating-system credential vault:

```powershell
npm run tauri dev
```

## Integration Verification

Live checks read already saved server and AI credentials from the operating-system vault. Examples and logs never embed secrets:

```powershell
cd src-tauri
cargo run --example live_check -- verify-profile
cargo run --example live_check -- verify-exec
cargo run --example live_check -- verify-files
cargo run --example live_check -- verify-agent
cargo run --example live_check -- verify-mcp
```

## Build and Install

```powershell
npm run build:release
npm run check:dist
```

The release pipeline produces a Windows NSIS installer and a portable ZIP under `dist-release/`. A new installer removes the verified old install directory while retaining configuration and vault credentials. Portable mode is enabled with `--portable` or a `portable.flag` beside the executable.

## Documentation

- [Chinese User Guide](docs/user-guide.zh-CN.md)
- [Linux Agent Improvement Study](docs/linux-agent-improvement-study.md)
- [Linux Agent Development Plan](docs/linux-agent-development-plan.md)
- [Linux Agent Specification](docs/linux-agent-specification.md)
- [Multi-SSH and Skill-driven OS Installation Plan](docs/multi-ssh-os-installation-plan.md)
- [Development Experience Record](docs/development-experience.md)

## Current Boundaries

Version `0.6.4` does not yet implement multi-SSH Tasks, structured remote HTTP, or Skill-driven OS installation; these follow the staged plan. The first release still excludes complex multi-Agent orchestration, long-term memory, a cloud Skill marketplace, and remote MCP transports. Aggregate WebView2 process memory remains above the project's 80 MiB target; the native Agent core stays lean while browser-runtime optimization remains open work.

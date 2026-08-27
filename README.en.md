# myterm

English | [简体中文](README.md)

myterm is a lightweight desktop terminal for development, operations, and server administration. Built with Tauri 2, Rust, React, and xterm.js, it combines SSH, local shells, saved servers, SFTP, quick commands, and a tool-using AI Agent in one compact workbench.

Current version: `0.9.11`

## Core Features

### Servers and Sessions

- Create, edit, and delete SSH and local-terminal profiles.
- Save names, groups, environments, hosts, ports, usernames, authentication modes, and terminal types.
- Passwords, private-key passphrases, and AI API keys stay in the operating-system credential vault; configuration stores references only.
- Click a saved server to connect. Persisted credentials support automatic login after restarting the app.
- Search sessions, organize them as a tree, reorder tabs by drag, and inspect connection state.

### Terminal Workbench

- A full xterm.js terminal with UTF-8, color, WebGL rendering, and automatic fitting.
- Visible vertical scrollbars in SSH and local terminals make long logs and command output easier to navigate.
- Multiple session tabs. Closing a tab disconnects every session it owns.
- Right-side splitting, adjustable ratios, and an explicit close action for either pane. Closed panes never remain as hidden connections.
- SSH failures preserve the original stage, code, and detail. Operators can select the text directly or copy the complete error with one action.
- Switch the active SSH workspace between terminal and SFTP views.
- Local shells and SSH sessions share the same tab and split workflow.

### Quick Command Library

- Organize common, deployment, and troubleshooting commands into command sets that scale to dozens of entries.
- Compact rows show only operator-authored names; long command bodies stay out of the main surface.
- Search, create, edit, delete, reorder, and browse commands in a scrolling multi-column layout.
- Import UTF-16 `.qbl` command sets exported by Xshell 8 and older releases, with a preview of formats, groups, duplicates, conflicts, and unsupported entries.
- Export the current set or all commands as versioned myterm JSON, then safely keep both conflicting names or explicitly overwrite them on import.
- A single command may contain multiple lines. Each line is sent with terminal-return semantics.
- Resize or clearly collapse the command dock while keeping titles vertically centered.

### SFTP File Management

- Reuse the active SSH connection and start from the local user directory and remote login directory instead of assuming deployment paths.
- Load local and remote panes independently so one failed directory does not hide the other; errors identify the pane and underlying reason.
- Use standard single selection, `Ctrl` toggling, and `Shift` range selection with a visible selected-item count.
- Batch upload, download, and recursively delete files or directories; rename remains single-item and partial delete failures are reported.
- Inspect size, modification time, and permissions, with a cancellable transfer queue.
- Agent file writes use a same-directory temporary file, synchronization, permission preservation, hash locking, and readback verification.

### Linux Operations Agent

The Agent follows a Claude Code-style loop:

```text
task input -> model decision -> tool call -> result -> continue -> final answer
```

- Persistent Conversations and Turns. Only New Conversation changes the context boundary; follow-up requirements, user corrections, tool facts, and exact commands survive across turns.
- Persistent tasks, ordered events, approvals, tool audit records, background jobs, cancellation, and crash recovery.
- A tool-centric timeline shows model decisions, tool names, parameter summaries, stdout, stderr, results, and status.
- Task input supports `Shift+Enter` newlines and IME protection; a top handle expands the composer up to half the Agent panel height.
- New Conversation creates a real durable conversation. Conversation history groups and restores every turn instead of only clearing the current UI trace.
- The composer stays editable while a turn runs. Add Requirement persists and injects steering at the next model-decision boundary, while Stop remains a separate action.
- Built-in tools cover session metadata, terminal context, terminal input, structured SSH execution, host facts, directories, and files; inactive saved servers can be discovered and connected automatically, while the built-in Multi-SSH Coordinator provides serial coordination across explicit targets. The focused SSH pane is passive candidate metadata: general questions, MCP, Skills, and history do not read it automatically. The model must set `use_active_session=true` only when the user refers to the current terminal, or resolve a named server and pass an explicit `session_id`.
- Structured execution records stdout/stderr separately with exit code, signal, timeout, cancellation, and disconnect outcomes.
- Long operations can become background jobs with status, paged output, and cancellation tools.
- Diagnostic runbooks, context compaction, loop detection, and pre-persistence secret redaction are built in.
- Terminal context is an unbounded-by-line transcript reader: the Agent follows `offset`, `nextOffset`, and `eof` ranges until a complete `cat`, log, or command output has been read. Long remote stdout/stderr stays in artifacts and remains page-readable.
- For interactive product CLIs, `cli_execute` locks terminal input, inspects the real xterm cursor line, sends only the missing suffix of the complete intended command, and waits for a prompt, interaction, quiet fallback, or timeout boundary in one host transaction. `cli_execute_batch` groups 1-8 independent known commands into one tool call, avoiding duplicated input and many tiny model requests.
- The timeline records model-request, tool-call, and token counts for each turn. Independent read-only calls can execute concurrently within one model round, while dependent or effectful operations remain serial.
- AI profiles persist as versioned JSON. A profile can define primary, analysis, and fallback models; when enabled, failed model requests fail over in role order and the Agent timeline records the selected model.
- A Provider Context Adapter supports both Responses and Chat Completions. Auto mode prefers `previous_response_id` plus native provider compaction, then persistently falls back to local checkpoint + tail when a gateway is confirmed unsupported.
- Per-model context-window and compaction thresholds are configurable. Local versioned JSON checkpoints preserve goals, constraints, user corrections, literal CLI commands, tool facts, Evidence references, and unresolved work.

### Permissions and Safety

| Mode | Behavior |
|---|---|
| Read only | Automatically runs only operations classified as reads |
| User confirmation | Requires per-operation approval for side effects; the default |
| Full access | Runs everything except hard-denied rules without prompts |

Hard-deny commands, production/root escalation, output limits, audit records, and redaction cannot be bypassed by prompts, Skills, Hooks, or MCP. Bash is parsed with tree-sitter; incomplete or unclassified syntax is never auto-executed.

### Skills, MCP, and Hooks

- Discover local `SKILL.md` files, record metadata and content hashes, and load enabled Skills on demand.
- Configure and test stdio and streamable-http MCP servers. Successful tests expose capability ids, complete names, titles, descriptions, transports, input/output schemas, and annotations with a copy action.
- MCP tools enter a task-scoped Capability Registry. Small catalogs are exposed directly; larger catalogs are selected by task relevance while `capability_search` remains available. Inputs and structured outputs are validated against server-provided schemas.
- MCP results are normalized into `structuredContent`, `textContent`, error state, and a task-scoped raw Evidence artifact. The Agent synthesizes product CLI commands from complete evidence and passes `evidence_refs` to `cli_execute`; long results remain page-readable and wrapper text or truncated previews are never treated as the final fact.
- The read-only `mcp_status` tool reports every configured server's enabled state, transport, connection/tool-discovery stage, tool count, stable error code, and original provider detail without requiring an SSH session.
- Bounded deterministic lifecycle Hooks are supported and cannot lower core permissions.

### Plugin Agent Kernel

- The Agent loop remains a small runtime for lifecycle, model decisions, effect-aware scheduling, result feedback, and loop protection. Built-ins and MCP tools are normalized into capability descriptors instead of expanding a fixed dispatch catalog.
- The desktop profile currently mounts built-in SSH/session tools, local Skills, stdio/streamable-http MCP, lifecycle Hooks, and the OpenAI-compatible model adapter.
- Each plugin exposes a manifest, version, dependency hints, and tool descriptors. Tool calls carry the plugin id into the event timeline and audit record.
- The Agent settings panel lists mounted plugins and lets the user narrow the enabled set. An empty enabled list means the default desktop profile.
- `src-tauri/src/agent/protocol.rs` defines a versioned line-delimited JSON contract for future out-of-process plugins. This release does not install or execute unknown third-party plugin code automatically.

### Remote CLI, REST, and Multi-SSH

- CLI means running large numbers of `systemctl`, `journalctl`, `docker`, `kubectl`, and business commands over SSH with structured results. It does not mean that myterm needs a public CLI product surface.
- REST means calling business or infrastructure HTTP APIs from an explicit remote SSH origin with the correct network perspective, credential redaction, and audit. It does not mean exposing the myterm Agent as a REST service.
- The Multi-SSH Coordinator lets one Task use multiple saved servers. The Agent first decides from the dialogue whether SSH is needed, then discovers and connects targets as necessary and explicitly selects each tool target. `use_active_session=true` is valid only for an explicit current-terminal reference; otherwise a concrete `session_id` is required and missing targets fail closed. Serial A-operation, B-observation, and condition-gated continuation remain supported.
- OS installation is planned as a local-Skill-triggered installation Task. The Skill builds and validates the plan; approved provisioning tools perform disk, boot, and power operations through a hypervisor, cloud API, MAAS, or Redfish/BMC.

See the [Multi-SSH and Skill-driven OS Installation Plan](docs/multi-ssh-os-installation-plan.md) for boundaries, tradeoffs, and staged delivery. Version `0.6.3` removes the early local Agent CLI and loopback REST surfaces. myterm remains a desktop application; CLI/REST refers only to commands and HTTP requests executed by the Agent in remote SSH environments.

### Appearance and Help

- Persistent light, eye-care, and dark themes also update the terminal canvas.
- The terminal offers three command-color templates—Graphite Gold (stable contrast), Forest Amber (low blue light), and Midnight Contrast (strong separation). Typed commands use the accent color while command output keeps the body color.
- Seven persistent UI scale levels from 90% through 200% uniformly enlarge sidebars, headings, panels, dialogs, and xterm content. SSH and local terminals also expose a `12-22px` base font size; the effective terminal size is the base size multiplied by the UI scale, applied immediately without reconnecting.
- AI profiles support `Bearer Token` (`Authorization: Bearer sk-...`) and raw `API Key` (`Authorization: sk-...`) header modes.
- AI and Agent HTTPS traffic uses Rustls with native operating-system roots, including enterprise, intranet, and security-proxy CAs installed in the system trust store.
- Failed connection tests and Agent runs first show the failing stage and stable error code; opening details reveals the raw HTTP status, endpoint, response body, transport error, stderr, exit code, timeout, and call stack. Only secrets are redacted and diagnostics are bounded; provider responses are not replaced with guesses.
- A compact 34px session strip and full-height sidebar work across desktop and narrow windows.
- A help icon at the far right of the title strip opens the packaged offline user guide.
- The AI settings editor converts the frontend form into the backend JSON schema; only `api_key_ref` is persisted while API keys remain in the OS credential vault.

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
- [Standard Build and Release Process](docs/build-and-release.md)
- [Agent Plugin Architecture](docs/agent-plugin-architecture.md)
- [Agent Optimization Roadmap](docs/agent-optimization-roadmap.md)
- [Codex Conversation Context Implementation](docs/agent-codex-context-plan.md)
- [Codex × Harness Architecture Audit](docs/architecture/codex-harness-audit.md)
- [dsh-codex-agent Implementation](docs/architecture/dsh-codex-agent-implementation.md)
- [Codex Network Egress Audit](docs/architecture/codex-network-audit.md)

## Current Boundaries

Version `0.9.11` refactors the Agent around durable Conversations/Turns and a Provider Context Adapter, adding cross-turn corrections, in-flight steering, incremental Responses continuation, and local Chat checkpoint fallback. It also adds visible terminal scrollbars and makes product-CLI completion derive an exact missing suffix from the full intended command and the live cursor line, preserving parameter whitespace.

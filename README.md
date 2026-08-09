# myterm

myterm is a lightweight desktop SSH terminal built with Tauri 2, Rust, React, and xterm.js. It combines persistent SSH sessions, closeable split panes, local terminals, SFTP transfers, compact multiline quick commands, three persistent themes, and an OpenAI-compatible operations Agent in one focused console.

The Agent follows a persistent, bounded model/tool loop. It supports structured SSH execution, background jobs, host facts, bounded file tools and diagnostic runbooks, task history, local `SKILL.md` loading, lifecycle hooks, and task-scoped stdio MCP connections. Read-only, confirmation, and conservative task-grant modes all pass through one policy and audit pipeline.

## Project Layout

- `src/`: React UI and the typed IPC boundary.
- `src-tauri/`: Rust services and Tauri desktop entry point.
- `myterm-spec/`: Product, architecture, milestone, and acceptance specifications.
- `myterm-prototype/`: The original static interaction prototype.
- `docs/development-experience.md`: Implementation decisions, failures, verification results, and reusable workflow notes.
- `docs/linux-agent-improvement-study.md`: Comparison research and the prioritized Linux operations Agent roadmap.
- `docs/linux-agent-development-plan.md`: Gated release milestones from the execution core through CLI and REST.
- `docs/linux-agent-specification.md`: Normative Linux Agent requirements, domain contracts, tools, permissions, events, CLI, and REST API.

## Development

```powershell
npm install
npm run typecheck
npm run lint
npm test
npm run dev
```

Desktop development additionally requires the Rust stable toolchain, Microsoft C++ Build Tools, and WebView2:

```powershell
npm run tauri dev
```

The browser build uses an in-memory demo adapter at the IPC boundary. The packaged Tauri application uses the Rust services and OS credential vault.

Live verification reads the already saved server and AI credentials from the operating-system vault; the example never embeds or prints them:

```powershell
cd src-tauri
cargo run --example live_check -- verify-profile
cargo run --example live_check -- verify-exec
cargo run --example live_check -- verify-files
cargo run --example live_check -- verify-agent
cargo run --example live_check -- verify-mcp
```

## CLI and REST

The desktop executable also exposes the same Agent core to terminals and local automation:

```powershell
myterm agent run --server yuxiaservers --task "Inspect disk pressure" --permission read-only
myterm agent run --server yuxiaservers --task - --output jsonl
myterm task list --output json
myterm task events TASK_ID --follow
myterm task cancel TASK_ID
```

The REST API is disabled until explicitly started and listens on loopback by default. Create a bearer token once, then start the server:

```powershell
myterm api token create
myterm api serve --bind 127.0.0.1:9867
```

OpenAPI is available at `/v1/openapi.json`. Non-loopback binding is rejected in this release because TLS and remote RBAC are intentionally outside the first local API boundary.

## Security

Passwords, private-key passphrases, and AI API keys must only be stored through the operating-system credential manager. Never place credentials in configuration files, logs, tests, screenshots, or issue reports.

Confirmation mode is the default. Read-only mode permits only classified reads; task grant can auto-run low/medium-risk operations on non-production, non-root sessions. Hard-deny rules, root/production escalation, output limits, secret redaction, and auditing cannot be bypassed by prompts, Skills, Hooks, or MCP tools.

## Release

```powershell
npm run build:release
npm run check:dist
```

The release pipeline produces the Windows NSIS installer. Portable mode is activated with `--portable` or a `portable.flag` file beside the executable.

The portable archive is written to `dist-release/`. The updater block in `src-tauri/tauri.conf.json` is intentionally inactive until its placeholder endpoint and public key are replaced and the official updater plugin is enabled.

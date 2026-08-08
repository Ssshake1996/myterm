# myterm

myterm is a lightweight desktop SSH terminal built with Tauri 2, Rust, React, and xterm.js. It combines persistent SSH sessions, closeable split panes, local terminals, SFTP transfers, compact multiline quick commands, three persistent themes, and an OpenAI-compatible operations Agent in one focused console.

The Agent follows a bounded model/tool loop, can read or write the active terminal, inspect session information, list local or remote directories, load local `SKILL.md` files, and call configured stdio MCP servers. Operators can require approval for every tool call or explicitly enable full access.

## Project Layout

- `src/`: React UI and the typed IPC boundary.
- `src-tauri/`: Rust services and Tauri desktop entry point.
- `myterm-spec/`: Product, architecture, milestone, and acceptance specifications.
- `myterm-prototype/`: The original static interaction prototype.
- `docs/development-experience.md`: Implementation decisions, failures, verification results, and reusable workflow notes.

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

For optional live verification, pass credentials only through process environment variables; the example never embeds or prints them:

```powershell
cd src-tauri
cargo run --example live_check -- verify-profile
cargo run --example live_check -- verify-agent
cargo run --example live_check -- verify-mcp
```

## Security

Passwords, private-key passphrases, and AI API keys must only be stored through the operating-system credential manager. Never place credentials in configuration files, logs, tests, screenshots, or issue reports.

Full Agent access is an explicit operator choice. Confirmation mode is the default and pauses before every built-in or MCP tool call.

## Release

```powershell
npm run build:release
npm run check:dist
```

The release pipeline produces the Windows NSIS installer. Portable mode is activated with `--portable` or a `portable.flag` file beside the executable.

The portable archive is written to `dist-release/`. The updater block in `src-tauri/tauri.conf.json` is intentionally inactive until its placeholder endpoint and public key are replaced and the official updater plugin is enabled.

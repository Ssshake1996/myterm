# myterm Development Experience Record

This document captures the decisions, failure modes, verification evidence, and reusable workflow developed while turning `myterm-spec/` into the first working release. It is written as source material for a future Codex Skill.

## 1. Objective and Boundaries

The first release implements milestones M0 through M7 from `myterm-spec/03-build-plan.md`:

- Tauri 2 and React scaffold with a strict Rust/TypeScript IPC contract.
- SSH and local terminal sessions rendered through xterm.js.
- Session profiles, OS-backed credentials, tabs, split panes, and quick commands.
- SFTP browsing and transfers on the active SSH session.
- OpenAI-compatible streaming chat with terminal context.
- Windows packaging and portable mode.

The P2 plugin host and SDK are explicitly excluded. Keeping that boundary prevents a speculative extension system from delaying the terminal and AI workflows that define the product.

Version 0.1.2 replaces the single-turn assistant surface with a bounded Agent loop and completes saved-server lifecycle behavior:

- Model decision, tool call, result, and continuation repeat until a final answer or the configured step limit.
- Built-in tools cover terminal context, terminal input, active-session metadata, and local or remote directory listing.
- Confirmation mode is the default; full access is an explicit persisted choice.
- Local `SKILL.md` discovery and selected-skill prompt injection are bounded by directory, depth, count, and byte limits.
- stdio MCP servers can be configured, tested, enumerated, and called through the same permission gate.
- Server add, edit, delete, credential cleanup, reload, and click-to-connect use one profile domain service.

The 0.1.2 boundary explicitly excludes multi-Agent execution, long-term memory, complex task orchestration, cloud Skill distribution, and non-stdio MCP transports.

## 2. Reusable Delivery Workflow

1. Read the product specification, architecture, build plan, common constraints, and the current milestone prompt before editing code.
2. Convert each requirement into a testable behavior and identify its owner: UI component, IPC boundary, Rust service, or packaging pipeline.
3. Land shared types and IPC signatures first. Do not let UI code invoke Tauri directly.
4. Build the smallest vertical path through UI, IPC, service, and persistence before adding secondary states.
5. Keep browser-only demo behavior inside the IPC adapter so UI workflows remain testable without weakening the desktop architecture.
6. Run typecheck, lint, unit tests, Rust checks, and a production build after every meaningful slice.
7. Run browser screenshots at desktop and narrow viewports. Inspect overflow, blank terminal canvases, modal clipping, and inaccessible controls.
8. Record failures and their actual fixes below before committing.

## 3. Architectural Decisions

### Contract-first IPC

All frontend calls live in `src/ipc.ts`. Components import typed functions rather than calling Tauri's `invoke` directly. This makes the process boundary searchable, mockable, and reviewable for credential leaks.

### Browser demo adapter

The desktop application depends on Rust, WebView2, SSH targets, and optional AI endpoints. A browser demo adapter implements the same frontend contract for visual verification and interaction tests. It is selected only when Tauri is unavailable and does not move production network or credential logic into JavaScript.

### Shared session layout state

Tabs, panes, active focus, session IDs, and connection state live in one Zustand store. Terminal, SFTP, quick commands, and AI all consume the active pane from that store, which prevents commands from being sent to stale or visually inactive sessions.

### Transactional saved-server lifecycle

Profile validation and credential lifecycle belong to `session/profile.rs`, not to React or the IPC command body. A save normalizes identity and connection fields, chooses canonical credential references, writes the credential before the JSON profile, and restores the previous credential if the atomic config write fails. Authentication changes and profile deletion remove obsolete credentials. A blank password during edit means “retain the existing secret,” never “replace it with empty text.”

The UI has one explicit connection gesture: a single click opens the profile. Save and Save & Connect are separate modal actions, and deletion always requires confirmation. This prevents the earlier single-click plus double-click handler combination from opening duplicate tabs.

### Bounded Agent service

The Agent is a separate Rust service rather than an expanded chat component. It uses OpenAI-compatible Chat Completions function calling, keeps the complete assistant `tool_calls` message in conversation history, appends each tool result by call ID, and asks the model again. Only one run is active at a time, each run is capped at 1-12 model steps, tool output is truncated to 12,000 characters, and cancellation interrupts model waits and pending approvals.

The frontend renders an execution trace rather than chat bubbles: task, model status, tool name, arguments, approval state, result/error, and final answer. This makes autonomous behavior inspectable and keeps permission decisions adjacent to the action they authorize.

### Skill and MCP extension boundaries

Skill discovery recursively scans configured roots to depth three, ignores symlinks, accepts only `SKILL.md`, canonicalizes IDs, and loads only selected files that were discovered under those roots. Individual and aggregate byte limits prevent unbounded prompt growth. Skill text is explicitly subordinate to application tool and permission rules.

MCP v1 uses the official Rust SDK client with `TokioChildProcess`. Servers are configured as a command plus an argument array, so quoting is not reparsed by an ad hoc shell parser. Configuration tests operate on the unsaved draft; cancelling the modal therefore has no hidden persistence side effect. Enabled servers are connected when a run prepares its tool catalog, model-facing tool names are namespaced and sanitized, and actual calls pass through the same approval loop as built-in tools.

### Operational visual direction

The interface uses a restrained charcoal work surface with green state, gold action, red failure, and cyan informational accents. Typography uses compact Windows-native technical faces. The design favors scanning and repeated operations over marketing-style cards or decorative surfaces.

### Product identity asset

The first release includes an original `myterm` application icon generated for this project. Its mark combines terminal panes into a compact M-shaped symbol, with muted green structure and a gold command cursor on charcoal. The full source image is retained at `src-tauri/icons/app-icon-source.png`; Tauri-generated Windows, macOS, iOS, Android, and web favicon variants live beside it. The same mark appears inside the app header so the packaged executable and running product share one identity.

### Scalable quick-command dock

The initial 43 px horizontal command bar worked for a handful of actions but did not scale to operational libraries with dozens of commands. The replacement follows the organization principles documented by the [Xshell Quick Command Manager](https://www.netsarang.com/en/xshell/) and [MobaXterm sidebar](https://mobaxterm.mobatek.net/documentation.html) without copying either product: a resizable bottom dock keeps the terminal primary, command sets form a compact vertical navigator, and the selected set uses a searchable multi-column list with visible command previews and execution modes.

Desktop height defaults to 224 px and can be adjusted from 168 to 420 px with pointer or keyboard input. At narrow widths the expanded dock becomes a bounded bottom overlay so it does not permanently compress the terminal. The collapsed state remains a 34 px status strip with command counts and a labeled, high-contrast expand control instead of an ambiguous 14 px glyph.

### Windows installation and upgrade lifecycle

Version 0.1.2 is installed per user at `%LOCALAPPDATA%/myterm`, with desktop and Start Menu shortcuts targeting the installed executable. The bundle identifier and product name remain stable across versions so Windows keeps one uninstall registration.

Tauri's normal interactive NSIS path offers to uninstall an older version, but a silent installer only overwrites known files. myterm therefore uses the officially supported [NSIS pre-install hook](https://v2.tauri.app/distribute/windows-installer/#extending-the-installer). The hook accepts an install directory only when the existing myterm product registry path matches it exactly, runs the old uninstaller with `/S /UPDATE`, checks its exit code, removes residual files from that known application directory, and recreates the directory before copying the new release. `/UPDATE` preserves shortcuts and prevents app-data deletion. Downgrades are disabled in all newly generated installers.

## 4. Security Invariants

- Passwords, private-key passphrases, and AI keys are accepted by forms but never read back into them.
- Secrets cross the frontend boundary only in `vaultSet` or the optional `apiKey` argument of `aiProfileSave`.
- Config records contain vault references, never secret values.
- AI code-block fill writes the command exactly as text and never appends carriage return.
- Terminal output remains binary from the native channel to `Terminal.write`.
- AI logs contain only profile ID, model, duration, and coarse usage metadata.
- On Windows, secrets use native Credential Manager generic credentials with local-machine persistence; every write is verified by an immediate readback.
- Plain HTTP AI endpoints expose credentials and prompts in transit. They are supported for compatibility only when the operator accepts that risk; HTTPS should be the default.
- Upgrade cleanup is recursive only after the registered myterm product path exactly matches `$INSTDIR`. User configuration and credentials live outside that directory.
- Agent confirmation mode is the default. Full access is visible, persisted, and disabled from changes while a run is active.
- Model output cannot call arbitrary process functions; only four registered built-ins and tools enumerated from enabled MCP servers are accepted.
- Local Skill files are canonicalized from configured roots, symlinks are ignored, and file/count/total-size limits are enforced before prompt injection.
- MCP commands are user-authored local configuration. Arguments are stored structurally and the application does not invoke them through a shell.
- Live integration checks read secrets only from the OS credential store or a transient process environment variable and never print secret values.

## 5. Environment and Repository Migration

The specification was initially retrieved with a sparse checkout of `storage-test-platform`. The final project repository was later designated as `Ssshake1996/myterm` with `F:\myterm` as its root.

Windows denied a direct move of the active root `.git` directory. The recoverable migration was:

1. Copy the original Git metadata to `F:\myterm-storage-test-platform-backup`.
2. Remove unrelated root-level Python test files from the product working tree while retaining them in the backup.
3. Disable sparse-checkout behavior and point `origin` at the final repository.
4. Audit the target before publication. A stale local `origin/main` still referenced the specification-source commit, but `git ls-remote origin` returned no refs and `git fetch origin main` confirmed the target had no `main` branch.
5. Keep `myterm-spec/` and `myterm-prototype/` as first-class project directories.
6. Preserve the local specification-source commit as the historical base and create the empty target's `main` with a normal push. No force push or history rewrite is required.

This pattern is reusable when a specification is sourced from one repository but implementation is published elsewhere: always inspect the actual target ref before choosing between lineage preservation and an orphan branch.

## 6. Failure Log

| Stage | Symptom | Root Cause | Resolution | Verification |
|---|---|---|---|---|
| Environment | `rustc` and `cargo` were missing | Rust was not installed on the Windows host | Install Rustup stable MSVC plus Visual Studio 2022 C++ Build Tools | `cargo check`, Clippy, and tests pass |
| Rust TLS build | `aws-lc-sys` could not find an assembler | The SSH/TLS dependency needs NASM on Windows | Install NASM and add its directory to the build environment | Full debug and release compilation pass |
| Tauri configuration | Bundle validation rejected `installerLanguages` | Tauri 2 NSIS uses `languages` | Rename the field and keep Chinese/English selector enabled | Tauri configuration loads during compilation |
| Repository migration | Moving `F:\myterm\.git` returned access denied | The active workspace held root Git metadata open | Keep a recoverable metadata backup, repoint the remote, and audit refs | Empty target and stale local tracking ref distinguished before push |
| Frontend baseline | Initial typecheck found union and disposable mismatches | Generic file rows widened entry types; xterm key handler returns `void` | Narrow entry types and remove the invalid disposal call | TypeScript passes |
| Lint baseline | Biome reported formatting and accessibility failures | First implementation had not yet been formatted and interactive containers lacked keyboard semantics | Apply formatter, use semantic controls, and add focus behavior | Biome passes |
| Windows local terminal test | PowerShell echo test hung while closing the pseudo console | On affected Windows builds `ClosePseudoConsole` can block until the output pipe is drained; PowerShell also queried cursor position | Drain output before dropping the PTY master, terminate the process tree without a visible window, and answer the DSR query in the test sink | Local shell test completes in under one second |
| Desktop icon build | Tauri packaging had no complete icon set | The scaffold had no product identity asset | Generate the original myterm mark and derive the complete Tauri icon set | Windows ICO and all generated bitmap variants exist |
| Browser visual QA | Terminal stayed blank and console showed a Tauri `Channel` constructor error | Components constructed native Channel objects before the browser demo adapter could branch | Add `createChannel`, returning a native channel only in Tauri and a structural channel in browser mode | Terminal output renders; browser console has zero errors |
| Narrow viewport QA | Sidebar and AI panel left only a sliver of terminal visible | Both desktop overlays initialized open below 900 px | Initialize narrow mode collapsed, make overlays mutually exclusive, and use a two-row quick-command bar | 390x844 terminal, AI, and session views are usable |
| SSH trust persistence | Known-host replacement deleted the old file before rename | Windows rename cannot overwrite an existing destination | Reuse the configuration service's `ReplaceFileW` atomic replacement | Overwrite/readback unit test passes |
| Release command | Tauri CLI could not find `cargo` although direct Cargo commands worked | Cargo's bin directory was absent from the child process `PATH` | Add both Cargo and NASM directories to the Visual Studio Developer PowerShell environment | Release compilation starts normally |
| NSIS bootstrap | First installer attempt timed out downloading `nsis_tauri_utils.dll` | A transient GitHub download exceeded Tauri's global timeout | Download the exact official asset with retries, verify Tauri's pinned SHA-1, and place it in the documented NSIS cache path | Subsequent NSIS packaging succeeds |
| Empty memory | The full myterm/WebView2 process group exceeded the 80 MB target | WebView2's multiprocess baseline dominates the native shell | Lazy-load xterm and SFTP; record both main-process and aggregate private working set instead of hiding the gap | 45-second aggregate is 93.01 MB; target remains open |
| GitHub push | Empty target rejected packs with missing parent objects | The specification checkout was both partial and shallow; changing `origin` left promised objects and merge parents unavailable | Re-add the source repository read-only, fetch without a blob filter, then `--unshallow` and run `git fsck` | Normal push creates target `main`; no force push used |
| Windows credential vault | The keyring API reported a successful write, but immediate readback returned no entry | The upstream Windows backend uses enterprise persistence, which silently failed on this host | Use native `CredWriteW`, `CredReadW`, and `CredDeleteW` with local-machine persistence, zero the temporary byte buffer, and verify every write | Ignored real-vault round-trip test passes; AI credential remains available after the test process exits |
| AI base URL compatibility | Model discovery worked, but streaming chat returned 0 characters and a false success | A host-only base URL sent `POST /chat/completions` to the gateway's HTML application; its OpenAI API is under `/v1` | Parse the configured URL and insert `/v1` only when it has no path; preserve explicit `/v1` and custom path prefixes | App service reports 7 models and receives the 12-character `MYTERM_AI_OK` stream marker |
| Quick-command scale | Deployment and troubleshooting commands were confined to a one-line horizontal scroller; the 14 px collapsed marker was easy to miss | The original component modeled commands as toolbar buttons instead of a managed operational library | Replace it with a resizable dock, vertical command-set navigation, group search, multi-column scrolling rows, visible edit controls, and labeled Lucide collapse states | 32-command component test passes; 36-command Playwright QA passes at desktop and narrow viewports |
| Silent NSIS upgrade | A silent `0.1.0` to `0.1.1` install updated the version but left an old-install-only marker in place | Tauri's interactive maintenance page can drive uninstallation, while silent mode copies over the existing directory | Add a guarded `NSIS_HOOK_PREINSTALL` that invokes the old uninstaller in update mode and cleans the verified install directory before copying | Repeated `0.1.0` to `0.1.1` silent upgrade removes the marker, leaves one uninstall entry, and preserves configuration and credentials |
| Saved-session duplication | A profile row had both click and double-click connection handlers | The second click of a double-click also triggered the single-click path | Make single click the only connection gesture and give edit/delete dedicated visible controls | Component test asserts exactly one connect call per click |
| Credential edit semantics | Editing an SSH profile with a blank password could not distinguish retain from erase | Credential saving was split between the modal and separate vault IPC calls | Move profile and credential changes into one Rust domain operation with rollback and obsolete-reference cleanup | Add/edit/reload/delete tests pass with both memory and Windows vaults |
| MCP SDK build | Current `rmcp` would not compile under the previous package MSRV | `rmcp 3.1.2` requires Rust 1.88 | Raise the package MSRV to 1.88 and compile all targets in the documented Visual Studio/NASM environment | `cargo clippy --all-targets -- -D warnings` passes |
| Configuration cancel semantics | Testing a new MCP server originally required saving the whole settings object first | Backend test commands accepted only persisted IDs | Let Skill discovery accept draft directories and MCP testing accept a draft server object | Component tests prove unsaved drafts can be scanned/tested |
| Agent observability | Streaming text could not show whether the model was deciding, waiting, or executing | The old panel modeled only user and assistant messages | Introduce typed Agent events and a tool-centric execution timeline | Desktop and 760 px visual QA show approval, result, completion, and no horizontal overflow |
| Native build shell | Direct Cargo runs rebuilt `aws-lc-sys` without NASM and MSVC environment variables | Codex shell sessions do not inherit the Visual Studio developer environment | Load `Microsoft.VisualStudio.DevShell`, select x64, and prepend Cargo/NASM paths for native checks and release builds | Rust tests, Clippy, example linking, and release build complete |
| Session state race | A fully authenticated terminal kept showing `connecting` | Native `connected` events were emitted before the frontend received and bound the new session ID | Return the complete `SessionInfo` from `session_connect`, atomically bind its final state to the pane, and track pre-ID failures by pane ID | Unit tests cover connected binding and pre-ID failure; installed SSH UI shows `connected` after authentication |

## 7. Verification Ledger

Update this table with the exact outcome rather than an optimistic status.

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | Pass |
| Frontend lint | `npm run lint` | Pass, 33 files |
| Frontend tests | `npm test` | Pass, 20 tests across 10 files |
| Frontend production build | `npm run build` | Pass; dependency chunks remain below 500 kB; main entry 74.96 kB |
| Rust format | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | Pass |
| Rust check | `cargo check --manifest-path src-tauri/Cargo.toml` | Pass |
| Rust lint | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Pass; `russh 0.54.5` emits a dependency future-incompatibility notice |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` | Pass, 22 tests run: 21 passed and 1 interactive keyring test ignored |
| Windows credential round trip | `cargo test --manifest-path src-tauri/Cargo.toml keyring_round_trip -- --ignored --nocapture` | Pass; native vault write, read, and cleanup all succeed |
| AI live integration | Production `AiService::test_connection` and streaming `AiService::chat` with the configured profile | Pass; 7 models found, chat completed with `stop`, 12 characters received, expected marker present |
| Saved-server CRUD | `live_check save-profile` and `live_check verify-crud` with the Windows credential vault | Pass; create, edit without re-entering secret, reload, delete, and credential cleanup verified |
| Saved-server auto-login | `live_check verify-profile` after a fresh config reload | Pass; native SSH backend loaded the saved credential and authenticated as `root` |
| Agent live integration | `live_check verify-agent` with the configured OpenAI-compatible profile and saved SSH session | Pass; model called `session_info`, `terminal_context`, `terminal_send`, and remote `list_directory`, then returned `stop` |
| MCP live integration | `live_check verify-mcp` with the official stdio Everything server | Pass; initialization handshake completed and 13 tools were enumerated |
| AI secret audit | Inspect `%APPDATA%/myterm/config.json` and Windows Credential Manager | Pass; JSON contains only `api_key_ref`, no key prefix; referenced credential target is present |
| Desktop visual QA | In-app Chromium at 1280x800 | Pass; nonblank xterm canvas, Agent settings, approval trace, result, and completion states inspected |
| Narrow viewport QA | In-app Chromium at 760x800 | Pass; Agent becomes a 360 px overlay, document has no horizontal overflow, and controls remain visible |
| Windows release build | `npm run build:release` | Pass for 0.1.2; native EXE, NSIS installer, and portable ZIP produced |
| Distribution audit | `npm run check:dist` | Pass; 0.1.2 installer 6.54 MB, portable ZIP 6.98 MB, required files present |
| Native startup smoke | Start the installed 0.1.2 EXE and capture its rendered main window | Pass; app opens with the saved server, Agent panel, and 0.1.2 version marker visible |
| Installed application | Install the NSIS package silently, then inspect registry and shortcuts | Pass; installed at `%LOCALAPPDATA%/myterm`, version 0.1.2, desktop and Start Menu targets resolve to the installed EXE |
| Installed saved-server click | Click `yuxiaservers` once in the installed 0.1.2 application | Pass; the persisted profile and Windows-vault credential opened an SSH session at `root@yuxiaservers:~#` without another password prompt |
| Upgrade replacement | Install 0.1.2 over 0.1.1 after placing an old-install-only marker | Pass; marker removed, one uninstall entry remains, installed EXE reports 0.1.2 |
| Upgrade data retention | Compare `%APPDATA%/myterm/config.json` SHA-256 and credential targets before/after upgrade | Pass; configuration hash is unchanged and the saved server and AI credentials remain present |
| Empty memory | 45-second private working-set sample | Main process 6.69 MB; full 7-process WebView2 group 93.01 MB, so aggregate `< 80 MB` target is not met |
| GitHub publication | Push `main` to `Ssshake1996/myterm` | Pass; target `main` created with normal push |

The browser screenshots and console logs are generated under ignored `output/playwright/` paths. They are verification artifacts rather than shipped product files.

External acceptance not performed on this workstation must remain explicit:

- SSH and SFTP integration against the specification's Docker OpenSSH matrix, because Docker is unavailable here.
- Final U1-U10 installation and memory measurement on a clean Windows virtual machine.

## 8. Future Skill Shape

A future skill derived from this record should accept:

- A product specification directory.
- A reference prototype or screenshots.
- The target repository and workspace root.
- Explicit MVP and excluded-feature boundaries.
- Required framework, dependency, security, and performance constraints.

The skill workflow should produce:

- A contract audit and milestone plan.
- A repository scaffold that keeps specifications and prototypes versioned.
- Vertical feature implementations with unit and integration tests.
- A security review focused on secrets, logs, and process boundaries.
- Browser and desktop visual verification artifacts.
- A continuously updated failure/decision ledger.
- A clean commit and publication report.

This is source material only. The actual `SKILL.md` should be created later with the dedicated skill-creation workflow after the MVP process stabilizes.

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

### Operational visual direction

The interface uses a restrained charcoal work surface with green state, gold action, red failure, and cyan informational accents. Typography uses compact Windows-native technical faces. The design favors scanning and repeated operations over marketing-style cards or decorative surfaces.

### Product identity asset

The first release includes an original `myterm` application icon generated for this project. Its mark combines terminal panes into a compact M-shaped symbol, with muted green structure and a gold command cursor on charcoal. The full source image is retained at `src-tauri/icons/app-icon-source.png`; Tauri-generated Windows, macOS, iOS, Android, and web favicon variants live beside it. The same mark appears inside the app header so the packaged executable and running product share one identity.

## 4. Security Invariants

- Passwords, private-key passphrases, and AI keys are accepted by forms but never read back into them.
- Secrets cross the frontend boundary only in `vaultSet` or the optional `apiKey` argument of `aiProfileSave`.
- Config records contain vault references, never secret values.
- AI code-block fill writes the command exactly as text and never appends carriage return.
- Terminal output remains binary from the native channel to `Terminal.write`.
- AI logs contain only profile ID, model, duration, and coarse usage metadata.

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

## 7. Verification Ledger

Update this table with the exact outcome rather than an optimistic status.

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | Pass |
| Frontend lint | `npm run lint` | Pass, 30 files |
| Frontend tests | `npm test` | Pass, 10 tests across 8 files |
| Frontend production build | `npm run build` | Pass; dependency chunks remain below 500 kB |
| Rust format | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | Pass |
| Rust check | `cargo check --manifest-path src-tauri/Cargo.toml` | Pass |
| Rust lint | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Pass; `russh 0.54.5` emits a dependency future-incompatibility notice |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` | Pass, 17 tests run: 16 passed and 1 interactive keyring test ignored |
| Desktop visual QA | Playwright, Chromium at 1440x900 | Pass; nonblank xterm canvas and zero application console errors |
| Narrow viewport QA | Playwright, Chromium at 390x844 | Pass; terminal and mutually exclusive AI/session overlays inspected |
| Windows release build | `npm run build:release` | Pass; native EXE, NSIS installer, and portable ZIP produced |
| Distribution audit | `npm run check:dist` | Pass; installer 5.87 MB, portable ZIP 5.99 MB, required files present |
| Native startup smoke | Start release EXE with `--portable`, then close main window | Pass; process tree exits without leftovers |
| Empty memory | 45-second private working-set sample | Main process 6.69 MB; full 7-process WebView2 group 93.01 MB, so aggregate `< 80 MB` target is not met |
| GitHub publication | Push `main` to `Ssshake1996/myterm` | Pending release verification |

The browser screenshots and console logs are generated under ignored `output/playwright/` paths. They are verification artifacts rather than shipped product files.

External acceptance not performed on this workstation must remain explicit:

- SSH and SFTP integration against the specification's Docker OpenSSH matrix, because Docker is unavailable here.
- Live OpenAI-compatible model validation, because no user API credential or endpoint was introduced into the build environment.
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

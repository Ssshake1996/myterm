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

Version 0.1.3 tightens the daily terminal workflow without expanding the Agent boundary:

- White, eye-care, and dark themes share semantic color tokens, persist in the existing atomic configuration, and update the xterm canvas without reconnecting.
- Quick-command rows show only the operator-authored name, execution mode, and edit action; command bodies remain searchable but appear only in the editor.
- Multiline commands preserve stored whitespace, normalize file-style line endings, and translate each internal line break to a terminal return when sent.
- Each side of a split terminal has an explicit close action. Closing a pane disconnects its session, restores the remaining pane, and reclaims a connection that finishes after its pane was removed.

Version 0.1.4 is a focused visual correction: after command bodies were removed from quick-command rows, the remaining single-line title is centered on both axes without changing row density, truncation, or the execution and edit controls.

Version 0.6.0 delivers the first persistent Linux operations Agent line from A0 through D1:

- SQLite-backed tasks, ordered events, approvals, tool audit records, background Jobs, crash recovery, cancellation, history, and bounded artifacts.
- Structured SSH exec with separate stdout/stderr, exit/signal/timeout/cancel/disconnect results, 50 MiB artifact caps, and 64 KiB head/tail previews.
- Tree-sitter Bash policy analysis with read-only, confirm, and conservative task-grant modes; hard-deny rules cannot be lowered by Hooks, Skills, prompts, or MCP.
- Host facts, bounded UTF-8 file stat/read/search/atomic write/patch, deterministic diagnostic runbooks, and readback/hash verification.
- One executable for Desktop, CLI JSONL/task control, and an opt-in loopback REST API with bearer hash storage, rate limiting, idempotency, SSE resume, and OpenAPI.
- Task-scoped stdio MCP connections, on-demand MCP catalog search above 48 tools, Skill v2 metadata/on-demand loading, bounded lifecycle Hooks, deterministic context compaction, and pre-persistence event redaction.

The first version deliberately excludes multi-Agent execution, long-term memory, cloud Skill distribution, non-stdio MCP transports, and remote REST exposure. Non-loopback REST is rejected until TLS, RBAC, and profile allowlists are implemented together.

Version 0.6.1 is a compact-shell correction driven by annotated installed-app feedback:

- The redundant `myterm / OPERATIONS CONSOLE` block is removed instead of merely hidden.
- Activity navigation and the session sidebar now own the full content height, while tabs belong to a dedicated workbench column above terminal and Agent content.
- The session strip is reduced from 44 px to 34 px, with stable close and add targets and tighter tab width/spacing.
- Desktop, 900 px, and 390 px browser geometry checks confirm a 34 px strip, top-aligned sidebar, and no horizontal overflow.

Version 0.6.2 completes the public and in-product documentation surface:

- `README.md` becomes the detailed Simplified Chinese entry point and `README.en.md` provides an equivalent English feature, architecture, development, security, and release reference.
- `docs/user-guide.zh-CN.md` is the canonical user manual for both the repository and packaged application.
- A 34 px `CircleHelp` action at the far-right edge of the session strip opens the offline manual without hiding at narrow breakpoints.
- The existing safe React text renderer gains a controlled document variant for headings, flat lists, paragraphs, inline emphasis/code, and fenced code blocks; no HTML injection or large Markdown runtime is added.
- The document dialog provides a 20-section desktop table of contents and a single-column mobile reader while preserving zero horizontal overflow.

Version 0.6.3 narrows the product boundary and improves long-form Agent task entry:

- The early local Agent CLI and loopback REST surfaces are removed with their dedicated dependencies, token field, idempotency table, and smoke script. CLI/REST now consistently means remote commands and HTTP operations from an explicit SSH origin.
- Existing server profiles, OS-backed credentials, AI profiles, Agent settings, and Task history remain intact during schema migration.
- `Enter` submits, `Shift+Enter` inserts a newline, and IME composition cannot trigger an accidental submission.
- A keyboard-accessible top handle expands the whole Agent composer upward, caps it at half the actual panel height, and reclamps it when the window shrinks.
- The multi-SSH and Skill-driven OS installation plan separates workflow guidance from provisioning authority and recommends an isolated Ubuntu VM/Autoinstall adapter as the first executable slice.

Version 0.6.4 fixes the installed SFTP browser at its initialization boundary:

- Prototype-only `C:\\deploy` and `/opt/app` defaults are replaced by the Windows user directory and the SFTP server's canonical login directory.
- Local and remote panes load independently, keep independent spinners, and report structured IPC error messages with the failing side identified.
- Refresh explicitly reruns the current-pane request; session switches resolve a new remote root before listing and invalidate older in-flight results.

Version 0.6.5 makes the SFTP browser useful for operational file sets without expanding the native API:

- Local and remote panes use ordered selections with independent anchors: plain click replaces, `Ctrl` toggles, `Shift` selects the inclusive visible range, and `Ctrl+Shift` adds a range.
- Batch uploads and downloads reuse the existing two-slot transfer queue for both files and directory trees; the UI registers each task and exposes terminal failure details.
- Remote batch delete executes sequentially after one confirmation, preserves successful deletions when another item fails, and reports the success/failure split; rename remains single-item only.

Version 0.6.6 adds a bounded quick-command interchange boundary without adding a dialog, filesystem, CSV, or encoding dependency:

- Native export uses a versioned `myterm.quick-commands` JSON envelope and excludes runtime IDs so files merge cleanly across machines.
- Xshell import is based on the actual UTF-16LE `.qbl` contract: Xshell 8.2 `Button_%d_Name/Type/Action` fields plus the legacy `Type_/Label_/Text_/CR_` layout.
- Only Send String actions are mapped. Menu, script, application, and text-file actions remain visible as skipped entries instead of being guessed into unsafe shell commands.
- Preview and apply both parse and validate the source. Exact duplicates are skipped, conflicts default to a deterministic imported label, explicit overwrite preserves the existing ID/order, and the final command vector is written with one atomic configuration replacement.
- Browser file input and Blob download keep the desktop runtime dependency set unchanged; exchange dialogs are isolated from the command-dock component after the first implementation made that component too large.

Version 0.6.7 adds high-DPI readability and explicit AI authentication semantics without widening the native dependency set:

- UI scale is a four-value persisted setting implemented as one root CSS zoom token, so the existing compact density remains coherent instead of receiving scattered selector overrides. The terminal font size is a separate persisted `12-22px` value applied to xterm options and refitted without reconnecting the session.
- `AiProfile.auth_mode` defaults through serde to `bearer`, preserving existing configurations. Rust owns one `with_auth` request boundary shared by model discovery, streaming chat, and the Agent tool loop; `Bearer` produces `Authorization: Bearer <key>`, while `ApiKey` produces `Authorization: <key>`.
- The tradeoff is an explicit per-profile selector and one additional persisted field. This is safer than guessing from gateway URLs, but requires users of raw-key gateways to choose the mode once. It also avoids a global setting that could silently break one of several configured providers.

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

### Quick-command interchange boundary

External formats terminate at `quick_commands.rs`. The React dock sends raw bounded bytes for preview and apply, while Rust owns BOM-aware decoding, source detection, normalization, conflict classification, ID generation, ordering, and persistence. This keeps Xshell compatibility out of components and prevents a preview/apply mismatch from bypassing current configuration state.

Using the WebView file picker and download primitive keeps the installer small and avoids a second native file-dialog/filesystem stack. The tradeoff is that export follows the WebView's download destination instead of choosing an arbitrary native path inside myterm. For command-set files this is acceptable; a future workspace-wide backup feature would justify a first-party Tauri dialog/filesystem plugin because it has broader path and overwrite requirements.

### Shared session layout state

Tabs, panes, active focus, session IDs, and connection state live in one Zustand store. Terminal, SFTP, quick commands, and AI all consume the active pane from that store, which prevents commands from being sent to stale or visually inactive sessions.

A split pane has only two lifecycle states: present or closed. There is no hidden pane state. The close action first disconnects a bound session and then removes the pane. If an asynchronous connection completes after the pane disappeared, `TerminalView` detects the missing pane and disconnects the newly returned session instead of binding an orphan.

### Compact workbench ownership

The original shell made the top bar a global grid row. That coupled the left activity/sidebar region to a 44 px header even after its branding became redundant. Deleting only the brand child would have left the sidebar displaced and shifted the tab strip into an unowned blank area.

The 0.6.1 correction changes ownership rather than layering offsets: the activity bar and session sidebar fill the application body, and a `workbench` column owns its compact tab strip plus a flexible `workbench-body`. This preserves one containing block for terminal and Agent overlays, removes obsolete responsive brand rules, and makes the 34 px density invariant measurable at every viewport.

### Packaged documentation from one source

User documentation must not be copied into a React component and maintained separately from repository docs. The help surface imports `docs/user-guide.zh-CN.md` as a Vite raw asset, so Release builds package the exact reviewed source file. A small controlled Markdown subset is sufficient for this owned document and keeps hostile markup rendered as text. Agent messages retain their terminal-fill action, while document code blocks expose copy only, preventing a help example from becoming an execution control.

The help action lives outside optional title metadata. This makes it the actual rightmost control at every width: desktop may show `DEMO/VAULT` before it, while narrower layouts hide metadata but never hide help.

### Transactional saved-server lifecycle

Profile validation and credential lifecycle belong to `session/profile.rs`, not to React or the IPC command body. A save normalizes identity and connection fields, chooses canonical credential references, writes the credential before the JSON profile, and restores the previous credential if the atomic config write fails. Authentication changes and profile deletion remove obsolete credentials. A blank password during edit means “retain the existing secret,” never “replace it with empty text.”

The UI has one explicit connection gesture: a single click opens the profile. Save and Save & Connect are separate modal actions, and deletion always requires confirmation. This prevents the earlier single-click plus double-click handler combination from opening duplicate tabs.

### Bounded Agent service

The Agent is a separate Rust service rather than an expanded chat component. It uses OpenAI-compatible Chat Completions function calling, keeps the complete assistant `tool_calls` message in conversation history, appends each tool result by call ID, and asks the model again. Only one run is active at a time, each run is capped at 1-12 model steps, tool output is truncated to 12,000 characters, and cancellation interrupts model waits and pending approvals.

The frontend renders an execution trace rather than chat bubbles: task, model status, tool name, arguments, approval state, result/error, and final answer. This makes autonomous behavior inspectable and keeps permission decisions adjacent to the action they authorize.

### Skill and MCP extension boundaries

Skill discovery recursively scans configured roots to depth three, ignores symlinks, accepts only `SKILL.md`, canonicalizes IDs, and loads only selected files that were discovered under those roots. Individual and aggregate byte limits prevent unbounded prompt growth. Skill text is explicitly subordinate to application tool and permission rules.

MCP v1 uses the official Rust SDK client with `TokioChildProcess`. Servers are configured as a command plus an argument array, so quoting is not reparsed by an ad hoc shell parser. Configuration tests operate on the unsaved draft; cancelling the modal therefore has no hidden persistence side effect. Enabled servers are connected when a run prepares its tool catalog, model-facing tool names are namespaced and sanitized, and actual calls pass through the same approval loop as built-in tools.

### Efficiency is a product contract

Lightweight behavior is measured at both the native kernel and full desktop process-group boundaries. The installed 0.1.4 baseline is 6.69 MB private working set for the native process but 93.01 MB for the complete seven-process WebView2 group; the original aggregate `< 80 MB` target is therefore still open and must not be reported as met by quoting only the smaller native number.

The post-MVP Agent plan makes resource budgets release gates. Agent storage, MCP, REST, and host refresh work start on demand; CLI does not install a default resident service; command output uses bounded memory and streamed artifacts; Desktop, CLI, and REST reuse the same Tokio, SSH, HTTP, model, and storage implementations. Every milestone records package size, native and aggregate memory, idle CPU, startup, event latency, and long-output behavior before it can ship.

### Operational visual direction

The interface offers dark charcoal, neutral white, and low-glare green eye-care surfaces while retaining green state, gold action, red failure, and cyan informational accents. All application surfaces use semantic color tokens instead of component-level dark overrides. xterm keeps a separate ANSI palette per theme and changes it through the terminal options object, so a theme switch does not recreate or reconnect a session. Typography uses compact Windows-native technical faces. The design favors scanning and repeated operations over marketing-style cards or decorative surfaces.

### Product identity asset

The first release includes an original `myterm` application icon generated for this project. Its mark combines terminal panes into a compact M-shaped symbol, with muted green structure and a gold command cursor on charcoal. The full source image is retained at `src-tauri/icons/app-icon-source.png`; Tauri-generated Windows, macOS, iOS, Android, and web favicon variants live beside it. The same mark appears inside the app header so the packaged executable and running product share one identity.

### Scalable quick-command dock

The initial 43 px horizontal command bar worked for a handful of actions but did not scale to operational libraries with dozens of commands. The replacement follows the organization principles documented by the [Xshell Quick Command Manager](https://www.netsarang.com/en/xshell/) and [MobaXterm sidebar](https://mobaxterm.mobatek.net/documentation.html) without copying either product: a resizable bottom dock keeps the terminal primary, command sets form a compact vertical navigator, and the selected set uses a searchable multi-column list with name-only 30 px command rows, execution-mode icons, and edit actions.

Desktop height defaults to 224 px and can be adjusted from 168 to 420 px with pointer or keyboard input. At narrow widths the expanded dock becomes a bounded bottom overlay so it does not permanently compress the terminal. The collapsed state remains a 34 px status strip with command counts and a labeled, high-contrast expand control instead of an ambiguous 14 px glyph.

Quick-command storage uses normalized LF line endings because it is configuration data. Sending is a separate concern: LF and CRLF are converted to terminal CR characters, and `send_newline` controls whether the final line receives a trailing CR. This supports both “execute every line” and “execute prior lines but leave the final line editable” without parsing shell syntax.

### Windows installation and upgrade lifecycle

Version 0.1.4 is installed per user at `%LOCALAPPDATA%/myterm`, with desktop and Start Menu shortcuts targeting the installed executable. The bundle identifier and product name remain stable across versions so Windows keeps one uninstall registration.

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
| Compact header correction | Removing the brand node alone would still leave the sidebar below a global header row | Header ownership was encoded in the page grid rather than the workbench | Move tabs into a right-side workbench column, let left navigation fill the body, and delete obsolete brand CSS | Sidebar starts at y=0, tab strip measures 34 px, and no viewport overflows |
| Documentation source drift | A separately authored in-app manual would diverge from repository documentation | UI copy and Markdown would have independent owners | Import the reviewed Markdown file as a build-time raw asset and render a controlled subset | Repository and packaged help always use the same bytes; no network or new parser dependency required |
| SSH trust persistence | Known-host replacement deleted the old file before rename | Windows rename cannot overwrite an existing destination | Reuse the configuration service's `ReplaceFileW` atomic replacement | Overwrite/readback unit test passes |
| Release command | Tauri CLI could not find `cargo` although direct Cargo commands worked | Cargo's bin directory was absent from the child process `PATH` | Add both Cargo and NASM directories to the Visual Studio Developer PowerShell environment | Release compilation starts normally |
| NSIS bootstrap | First installer attempt timed out downloading `nsis_tauri_utils.dll` | A transient GitHub download exceeded Tauri's global timeout | Download the exact official asset with retries, verify Tauri's pinned SHA-1, and place it in the documented NSIS cache path | Subsequent NSIS packaging succeeds |
| Empty memory | The full myterm/WebView2 process group exceeded the 80 MB target | WebView2's multiprocess baseline dominates the native shell | Lazy-load xterm and SFTP; record both main-process and aggregate private working set instead of hiding the gap | 45-second aggregate is 93.01 MB; target remains open |
| GitHub push | Empty target rejected packs with missing parent objects | The specification checkout was both partial and shallow; changing `origin` left promised objects and merge parents unavailable | Re-add the source repository read-only, fetch without a blob filter, then `--unshallow` and run `git fsck` | Normal push creates target `main`; no force push used |
| Windows credential vault | The keyring API reported a successful write, but immediate readback returned no entry | The upstream Windows backend uses enterprise persistence, which silently failed on this host | Use native `CredWriteW`, `CredReadW`, and `CredDeleteW` with local-machine persistence, zero the temporary byte buffer, and verify every write | Ignored real-vault round-trip test passes; AI credential remains available after the test process exits |
| AI base URL compatibility | Model discovery worked, but streaming chat returned 0 characters and a false success | A host-only base URL sent `POST /chat/completions` to the gateway's HTML application; its OpenAI API is under `/v1` | Parse the configured URL and insert `/v1` only when it has no path; preserve explicit `/v1` and custom path prefixes | App service reports 7 models and receives the 12-character `MYTERM_AI_OK` stream marker |
| Quick-command scale | Deployment and troubleshooting commands were confined to a one-line horizontal scroller; the 14 px collapsed marker was easy to miss | The original component modeled commands as toolbar buttons instead of a managed operational library | Replace it with a resizable dock, vertical command-set navigation, group search, multi-column scrolling rows, visible edit controls, and labeled Lucide collapse states | 32-command component test passes; 36-command Playwright QA passes at desktop and narrow viewports |
| Xshell interchange contract | Official documentation confirms Quick Commands import/export but does not publish the `.qbl` field schema | Treating the file as generic INI or guessing action types could silently turn non-command actions into terminal input | Inspect a real Xshell 8.2 UTF-16LE export and the installed parser's field constants, then constrain mapping to `Button_*` Send String entries and the verified legacy layout | Rust fixtures decode UTF-16, map multiline text, skip an unsupported action, and browser QA reports the same 4/3/1 preview totals |
| Silent NSIS upgrade | A silent `0.1.0` to `0.1.1` install updated the version but left an old-install-only marker in place | Tauri's interactive maintenance page can drive uninstallation, while silent mode copies over the existing directory | Add a guarded `NSIS_HOOK_PREINSTALL` that invokes the old uninstaller in update mode and cleans the verified install directory before copying | Repeated `0.1.0` to `0.1.1` silent upgrade removes the marker, leaves one uninstall entry, and preserves configuration and credentials |
| Saved-session duplication | A profile row had both click and double-click connection handlers | The second click of a double-click also triggered the single-click path | Make single click the only connection gesture and give edit/delete dedicated visible controls | Component test asserts exactly one connect call per click |
| Credential edit semantics | Editing an SSH profile with a blank password could not distinguish retain from erase | Credential saving was split between the modal and separate vault IPC calls | Move profile and credential changes into one Rust domain operation with rollback and obsolete-reference cleanup | Add/edit/reload/delete tests pass with both memory and Windows vaults |
| MCP SDK build | Current `rmcp` would not compile under the previous package MSRV | `rmcp 3.1.2` requires Rust 1.88 | Raise the package MSRV to 1.88 and compile all targets in the documented Visual Studio/NASM environment | `cargo clippy --all-targets -- -D warnings` passes |
| Configuration cancel semantics | Testing a new MCP server originally required saving the whole settings object first | Backend test commands accepted only persisted IDs | Let Skill discovery accept draft directories and MCP testing accept a draft server object | Component tests prove unsaved drafts can be scanned/tested |
| Agent observability | Streaming text could not show whether the model was deciding, waiting, or executing | The old panel modeled only user and assistant messages | Introduce typed Agent events and a tool-centric execution timeline | Desktop and 760 px visual QA show approval, result, completion, and no horizontal overflow |
| Native build shell | Direct Cargo runs rebuilt `aws-lc-sys` without NASM and MSVC environment variables | Codex shell sessions do not inherit the Visual Studio developer environment | Load `Microsoft.VisualStudio.DevShell`, select x64, and prepend Cargo/NASM paths for native checks and release builds | Rust tests, Clippy, example linking, and release build complete |
| Session state race | A fully authenticated terminal kept showing `connecting` | Native `connected` events were emitted before the frontend received and bound the new session ID | Return the complete `SessionInfo` from `session_connect`, atomically bind its final state to the pane, and track pre-ID failures by pane ID | Unit tests cover connected binding and pre-ID failure; installed SSH UI shows `connected` after authentication |
| Theme surface drift | A token-only theme switch would have left dozens of component-local dark backgrounds unchanged | The first visual pass encoded charcoal shades directly in individual selectors | Replace component-local surface colors with semantic tokens and define complete white, eye-care, and dark palettes; update xterm through its runtime theme option | All three themes render without dark surface leftovers; eye-care selection survives reload without reconnecting |
| High-DPI zoom geometry | The first 130% implementation divided root width/height while CSS `zoom` already adjusted the layout, leaving a blank viewport band; fixed-position dialogs then exceeded the physical viewport | Browser zoom changes both coordinate space and fixed-position sizing, while xterm glyphs would also inherit the scale unless corrected | Keep root dimensions at 100%, define one zoom/inverse pair per scale, size modal masks to the inverse logical viewport, and divide xterm's internal font option by UI zoom | At 900 x 650 and 130%, page scroll width remains 900 px, the large dialog is fully bounded at y=52..598, and terminal 20px remains visually independent |
| Multiline demo echo | Browser QA displayed two multiline commands over each other | The demo adapter wrote terminal CR input directly to the xterm output channel, where CR moves the cursor without adding a display line | Keep native input as CR but translate standalone CR to CRLF only in the browser demo echo | Browser QA displays each submitted command on its own line; the native send contract remains unchanged |
| Split-pane cleanup | Split terminals had no per-pane close action, and a connection completing after UI removal could become orphaned | Layout state supported split creation and resize but not pane lifecycle; connection completion assumed the pane still existed | Add close controls to both captions, disconnect before removal, and reclaim a session when its pane no longer exists at connect completion | Store, workspace, and pending-connect tests pass; browser QA closes the right pane and restores one terminal |
| Quick-command title alignment | Name-only command rows left the title visually high inside its button | The flex container centered its main axis but kept the default cross-axis alignment from the former two-line layout | Center the existing title on the flex cross axis without changing markup or row dimensions | Browser geometry reports a 0 px center offset for short and long names; installed 0.1.4 preserves the compact layout |
| SSH exec termination order | Structured exec intermittently lost the exit code on the live OpenSSH server | OpenSSH sent channel `EOF` before `ExitStatus`; treating EOF as final stopped the reader too early | Keep draining protocol messages after EOF and finish on channel close/termination | Live command returns exit 7 with distinct stdout/stderr; timeout and 10 MiB streaming checks pass |
| SFTP atomic overwrite | Updating an existing remote file returned SFTP `Failure` | OpenSSH SFTP v3 `RENAME` does not guarantee replacement of an existing target | Keep same-directory temp write, fsync and permissions, then use quoted `mv -f --` over the same SSH connection for an atomic existing-file replacement | Live hash-locked update, readback, search and cleanup pass on `192.168.3.94` |
| SFTP first-open blank panes | Opening the installed file view reported only “目录读取失败” and displayed no remote entries | The prototype paths `C:\\deploy` and `/opt/app` were shipped as runtime defaults, and `Promise.all` discarded the successful pane when either path failed | Resolve real local/remote starting directories through typed IPC, load panes independently, preserve structured error messages, and invalidate stale requests | Component regression keeps remote entries visible during a local failure; live SFTP resolves `/root`, lists 12 entries, and completes file operations |
| SFTP multi-selection side effects | A scalar selected-entry state could not express Ctrl toggles, Shift ranges, or useful batch actions | Selection identity, range order, and action ownership were coupled to one row | Keep ordered entry arrays and per-pane anchors in the existing component; enqueue transfers through existing IPC and execute destructive deletes sequentially with partial-failure accounting | Six SFTP component tests pass; browser QA selects all four rows with Shift and removes one with Ctrl; live server verification completes two queued uploads and two downloads with exact readback |
| CLI help exit code (historical, removed in 0.6.3) | `agent run --help` printed correct help but returned usage code 2 | All Clap parse outcomes were mapped to usage errors | Map `DisplayHelp` and `DisplayVersion` to 0 while retaining 2 for invalid syntax | Process-level help and JSONL Agent checks return 0 |
| REST smoke cleanup (historical, removed in 0.6.3) | The first smoke run passed but PowerShell treated token-revoke stderr as a script failure | `$ErrorActionPreference=Stop` converts native stderr to `NativeCommandError` | Temporarily relax only the cleanup call while still revoking the token and preserving the preceding assertions | Repeat smoke run exits 0 after auth, idempotency, SSE and OpenAPI checks |

## 7. Verification Ledger

Update this table with the exact outcome rather than an optimistic status.

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | Pass |
| Frontend lint | `npm run lint` | Pass, 38 files |
| Frontend tests | `npm test` | Pass, 38 tests across 13 files |
| Frontend production build | `npm run build` | Pass; dependency chunks remain below 500 kB; release main entry 117.75 kB and lazy SFTP entry 11.26 kB |
| Rust format | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | Pass |
| Rust check | `cargo check --manifest-path src-tauri/Cargo.toml` | Pass |
| Rust lint | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Pass; `russh 0.54.5` emits a dependency future-incompatibility notice |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Pass, 40 passed and 1 interactive keyring test ignored |
| Windows credential round trip | `cargo test --manifest-path src-tauri/Cargo.toml keyring_round_trip -- --ignored --nocapture` | Pass; native vault write, read, and cleanup all succeed |
| AI live integration | Production `AiService::test_connection` and streaming `AiService::chat` with the configured profile | Pass; 7 models found, chat completed with `stop`, 12 characters received, expected marker present |
| Saved-server CRUD | `live_check verify-crud` with the Windows credential vault | Pass; create, edit without re-entering secret, reload, delete, and credential cleanup verified |
| Saved-server auto-login | `live_check verify-profile` after a fresh config reload | Pass; native SSH backend loaded the saved credential and authenticated as `root` |
| Structured exec live integration | `live_check verify-exec` against the saved SSH session | Pass; exit 7, distinct stdout/stderr, 150 ms timeout, and exact 10 MiB streaming byte count verified |
| File-tool live integration | `live_check verify-files` against the saved SSH session | Pass; `/root` resolves with 12 entries, atomic file operations pass, two queued uploads and two downloads complete with exact content readback, and remote/local cleanup succeeds |
| Agent live integration | `live_check verify-agent` with the configured OpenAI-compatible profile and saved SSH session | Pass; model called `session_info`, `terminal_context`, `remote_exec`, `host_facts`, and remote `list_directory`, then returned `stop` |
| MCP live integration | `live_check verify-mcp` with the official stdio Everything server | Pass; initialization handshake completed and 13 tools were enumerated |
| CLI process contract (historical, removed in 0.6.3) | Release-equivalent binary `agent run --output jsonl` plus help exit check | Pass in 0.6.0; surface removed in 0.6.3 |
| REST process contract (historical, removed in 0.6.3) | `scripts/rest-smoke.ps1` | Pass in 0.6.0; surface and script removed in 0.6.3 |
| AI secret audit | Inspect `%APPDATA%/myterm/config.json` and Windows Credential Manager | Pass; JSON contains only `api_key_ref`, no key prefix; referenced credential target is present |
| Desktop visual QA | Playwright Chromium at 1280x800 | Pass; nonblank xterm canvas, Agent approval trace, result, completion, split-close and labeled quick-command collapse states inspected; zero console errors |
| Narrow viewport QA | Playwright Chromium at 900x650 and 390x844 | Pass; document/body scroll widths equal viewport widths, Agent becomes a 344 px overlay on mobile, and controls do not overlap |
| Compact shell QA | Playwright Chromium at 1440x900, 900x650, and 390x844 | Pass; brand block absent, session strip is exactly 34 px, desktop sidebar starts at y=0, mobile sidebar overlay remains usable, and scroll width equals viewport width |
| Offline help QA | Playwright Chromium at 1440x900 and 390x844 | Pass; help is the 34 px rightmost title action, desktop dialog is 920x760 with 20-section navigation, TOC scrolling lands at the heading margin, mobile document has no horizontal overflow, and console has zero errors/warnings |
| Documentation component tests | `HelpManual.test.tsx` plus existing hostile-markup Agent test | Pass; packaged manual headings/remote CLI content render, close works, hostile HTML remains text, and Agent terminal fill behavior is unchanged |
| Theme persistence | Switch white, eye-care, and dark themes | Pass; application, terminal, modal, Agent and quick-command surfaces change together |
| Multiline quick command | Create, save, execute, and delete a two-line command in browser QA | Pass; command body is hidden from the compact library and both lines are sent as separate terminal returns |
| Split close | Create a right split and close the right caption action | Pass; target session is disconnected, one terminal remains, and the split action becomes available again |
| Quick-command title alignment | Measure the first three `.quick-command-main` and label rectangles in browser QA | Pass; `align-items` resolves to `center` and every label center offset is exactly 0 px |
| Quick-command interchange tests | `QuickBar.test.tsx` plus `quick_commands.rs` unit tests | Pass; preview, default keep-both merge, export scope, UTF-16LE Xshell mapping, deterministic conflict handling, and versioned native export are covered |
| Quick-command interchange QA | Import a real-shape Xshell 8.2 `.qbl`, export all commands, and inspect desktop plus 900 x 650 layouts | Pass; preview reports 4 total, 3 importable, and 1 unsupported; downloaded JSON is schema v1 with 6 portable entries and no runtime IDs; narrow scroll width equals 900 px |
| Font settings | `TerminalView.test.tsx`, config unit test, and browser QA | Pass; four UI scale levels and terminal `12-22px` persistence are covered, terminal options update without reconnect, and 900 x 650 has no horizontal overflow |
| AI auth headers | `ai::service` unit test, `AiSettings.test.tsx`, and `live_check verify-agent` | Pass; Bearer and raw API Key headers are exact, legacy profiles default to Bearer, the settings UI persists the explicit mode, and the saved legacy profile completes the live Bearer Agent loop |
| Windows release build | `npm run build:release` | Pass for 0.6.0; optimized native EXE, NSIS installer, and portable ZIP produced |
| Distribution audit | `npm run check:dist` | Pass; 0.6.0 installer 8.00 MB, portable ZIP 8.98 MB, and required portable files are present |
| Native startup smoke | Start installed 0.6.0 with `--profile yuxiaservers` | Pass; process opens and remains responsive; separate fresh-config live check authenticates as `root` with the saved vault credential |
| Installed minimum-window QA | Resize the installed 0.1.3 window to 900 x 650 and capture the rendered UI | Pass; side panels become on-demand overlays, terminal and quick-command controls remain readable, and no surfaces overlap |
| Installed application | Silently install 0.6.0, then inspect file metadata, registry, and shortcuts | Pass; installed at `%LOCALAPPDATA%/myterm`, file and registry versions are 0.6.0, one uninstall entry remains, and desktop `myterm.lnk` exists |
| Installed saved-server auto-login | Open installed 0.6.0 with `--profile yuxiaservers` | Pass; persisted profile starts without another password prompt and the vault-backed SSH live check authenticates as `root` |
| Upgrade replacement | Install 0.6.0 over 0.1.4 | Pass; installer exits 0, one uninstall entry remains, and installed EXE/registry report 0.6.0 |
| Upgrade data retention | Compare `%APPDATA%/myterm/config.json` SHA-256 before/after upgrade | Pass; configuration hash is unchanged |
| Headless efficiency (historical, removed in 0.6.3) | Release `agent serve --idle-timeout 8` private working set and CPU sample | Pass in 0.6.0; no headless product entry remains |
| Empty memory | 45-second `Working Set - Private` sample | Main process 7.08 MiB passes `<=12 MiB`; full 7-process WebView2 group is 111.24 MiB, so aggregate `<80 MiB` target remains unmet |
| Compact-shell release build | `npm run build:release` and `npm run check:dist` | Pass for 0.6.1; installer remains 8.00 MB and portable ZIP remains 8.98 MB |
| Compact-shell upgrade install | Silently install 0.6.1 over 0.6.0, then inspect file metadata, registry, shortcut, and config SHA-256 | Pass; installed file and registry report 0.6.1, one uninstall entry remains, desktop shortcut exists, and configuration hash is unchanged |
| Installed native screenshot | Bundled `computer-use` capture against the running 0.6.1 window | Not used as evidence; the installed plugin exposed a runtime API that did not match its documentation, so browser geometry plus installed binary/registry checks remain the reproducible evidence |
| Documentation release build | `npm run build:release` and `npm run check:dist` | Pass for 0.6.2; installer is 8.01 MB and portable ZIP is 8.99 MB, a roughly 0.01 MB distribution increase for packaged offline help |
| Documentation upgrade install | Silently install 0.6.2 over 0.6.1, then inspect file metadata, registry, shortcut, and config SHA-256 | Pass; installed file and registry report 0.6.2, one uninstall entry remains, desktop shortcut exists, configuration hash is unchanged, and saved-profile startup remains responsive |
| Agent composer interaction | Browser QA at 1280x720 and 900x650 | Pass; pointer drag changes 111 px to 211 px, `End` caps at exactly 50% of the panel, `Home` restores 111 px, Shift+Enter preserves two lines, narrow viewport has zero horizontal overflow, and ARIA min/current/max stay synchronized |
| Desktop-only surface audit | Source/dependency scan plus installed `myterm.exe agent` and port 4765 probe | Pass; CLI/REST sources and dependencies are absent, the legacy argument stays in the desktop process, and no REST listener exists |
| 0.6.3 schema migration | Open installed app over the 0.6.2 config and Agent DB | Pass; only `rest_token_hash` is removed, schema is 4, `api_idempotency_keys` is absent, and all 3 Task records remain |
| Boundary-contraction release | `npm run build:release` and `npm run check:dist` | Pass for 0.6.3; installer is 7.60 MB and portable ZIP is 8.35 MB, smaller by about 0.41 MB and 0.64 MB from 0.6.2 |
| 0.6.3 upgrade install | Silently install over 0.6.2, then inspect file metadata, registry, shortcut, config, SSH, and Agent | Pass; one 0.6.3 uninstall entry and desktop shortcut remain, saved `yuxiaservers` authenticates as `root`, and the configured model completes the five-tool Agent loop with `stop` |
| SFTP initialization release | `npm run build:release` and `npm run check:dist` | Pass for 0.6.4; installer is 7.60 MB, portable ZIP is 8.36 MB, and the SFTP view remains a 9.00 kB lazy chunk |
| 0.6.4 upgrade install | Silently install over 0.6.3, then inspect file metadata, registry, shortcut, configuration hash, SSH, and SFTP | Pass; one 0.6.4 uninstall entry and desktop shortcut remain, configuration SHA-256 is unchanged, the installed window responds, and saved-profile SFTP resolves `/root` with 12 entries |
| SFTP multi-selection release | `npm run build:release` and `npm run check:dist` | Pass for 0.6.5; installer is 7.61 MB, portable ZIP is 8.36 MB, and the lazy SFTP entry is 11.26 kB without a new runtime dependency |
| 0.6.5 upgrade install | Silently install over 0.6.4, then inspect file metadata, registry, shortcut, configuration hash, SSH, and queued transfers | Pass; one 0.6.5 uninstall entry and desktop shortcut remain, configuration SHA-256 is unchanged, the installed window responds, saved SSH authenticates, and two uploads plus two downloads complete with exact readback |
| Quick-command interchange release | `npm run build:release` and `npm run check:dist` | Pass for 0.6.6; installer is 7.64 MB, portable ZIP is 8.40 MB, required portable files are present, and no runtime dependency was added |
| 0.6.6 upgrade install | Silently install over 0.6.5, then inspect file metadata, registry, shortcut, configuration hash, process response, and SSH | Pass; installer exits 0, one 0.6.6 uninstall entry and desktop shortcut remain, configuration SHA-256 and saved-profile count are unchanged, the installed process responds, and vault-backed SSH authenticates as `root` |
| 0.6.7 release build | `npm run build:release` and `npm run check:dist` | Pass; installer is 7.63 MB, portable ZIP is 8.41 MB, required portable files are present, and no runtime dependency was added |
| 0.6.7 upgrade install | Silently install over 0.6.6, then inspect file metadata, registry, shortcut, configuration hash, saved data, process response, and Agent | Pass; installer exits 0, one 0.6.7 uninstall entry and desktop shortcut remain, configuration SHA-256 plus server/AI/quick-command counts are unchanged, the installed process responds, and the saved legacy AI profile completes the five-tool Bearer Agent loop with `stop` |
| GitHub publication | Push `main` to `Ssshake1996/myterm` | Pass; target `main` created with normal push |

The browser screenshots and console logs are generated under ignored `output/playwright/` paths. They are verification artifacts rather than shipped product files.

External acceptance not performed on this workstation must remain explicit:

- SSH and SFTP integration against the specification's Docker OpenSSH matrix, because Docker is unavailable here.
- Final U1-U10 installation and memory measurement on a clean Windows virtual machine.

## 8. Future Skill Shape

The Linux operations Agent comparison and prioritized safety roadmap are recorded in [`linux-agent-improvement-study.md`](linux-agent-improvement-study.md). Its conclusions are converted into the gated milestones in [`linux-agent-development-plan.md`](linux-agent-development-plan.md) and the normative requirements and domain contracts in [`linux-agent-specification.md`](linux-agent-specification.md). Together they distinguish local coding-agent mechanisms from controls required on a remote SSH host, especially as `root`, and keep the product on one desktop task/event contract while treating remote CLI/REST as Agent tools.

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

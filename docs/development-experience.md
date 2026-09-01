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
- stdio and streamable-http MCP servers can be configured, tested, enumerated, and called through the same permission gate and Transport abstraction.
- Server add, edit, delete, credential cleanup, reload, and click-to-connect use one profile domain service.

The 0.1.2 boundary explicitly excludes multi-Agent execution, long-term memory, complex task orchestration, and cloud Skill distribution. MCP now supports both stdio and streamable-http through one Transport abstraction.

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
- Task-scoped stdio/streamable-http MCP connections, on-demand MCP catalog search above 48 tools, Skill v2 metadata/on-demand loading, bounded lifecycle Hooks, deterministic context compaction, and pre-persistence event redaction.

The first version deliberately excludes multi-Agent execution, long-term memory, cloud Skill distribution, and remote REST exposure. Non-loopback REST is rejected until TLS, RBAC, and profile allowlists are implemented together.

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

Version 0.6.8 makes AI connection failures diagnosable without exposing credentials:

- Rust validates that a saved API Key exists before sending the model-list request and returns a structured diagnostic with `stage`, stable `code`, `summary`, raw `detail`, and a bounded call stack. The UI shows the stage/code summary first and expands detail on demand.
- The model-list response must contain an OpenAI-compatible `data` array; otherwise the UI reports the exact JSON parser or schema failure and includes the bounded, redacted response body.
- Tauri's serialized `{ code, message }` errors are normalized in the typed frontend IPC adapter, so the settings dialog no longer collapses native failures to a generic “连接失败”.

Version 0.7.0 moves the Agent extension boundary into an in-process plugin kernel:

- `AgentRuntime` owns the run-scoped registry. The model loop no longer selects concrete Rust methods; it consumes schemas supplied by mounted plugins and routes every call through one policy, approval, cancellation, redaction, and audit path.
- Built-in operations, local Skills, stdio/streamable-http MCP, lifecycle Hooks, and the OpenAI-compatible model adapter each expose a manifest. Tool events now carry `pluginId`, which makes UI traces and persisted audit records explain where a capability came from.
- Agent settings persist `profile`, `bundles`, and `enabled_plugins`. An empty plugin list is intentionally the default desktop profile so older settings remain compatible; a non-empty list narrows the mounted registry.
- `agent/protocol.rs` defines a bounded version-1 JSONL contract for future out-of-process plugins. It is a message contract only in this release: no unknown executable is downloaded, installed, or launched automatically.
- Tradeoff: the registry gives low latency and one security boundary, while third-party process isolation is deferred until trust, signing, command-path, environment, timeout, crash-recovery, and resource-limit contracts are specified.

Version 0.7.1 makes Agent diagnostics lossless across the Rust, IPC, event, and UI boundaries:

- `AppError` now exposes a stable `code` and an unwrapped `detail`. Serialized IPC errors retain the actual provider, transport, JSON, tool, MCP, and storage text instead of adding a category prefix that hides the useful part.
- AI HTTP failures keep the status, endpoint, and response body; transport failures keep the reqwest detail; invalid model/tool responses keep the parser or JSON-path failure. A shared redaction pass masks configured secrets and `sk-...` tokens while preserving line breaks, with a 16,000-character bound and explicit truncation marker.
- Agent events use schema version 2 and carry `errorCode`; failed completion, tool results, MCP events, approval rejection, and policy denial reach the execution timeline with their exact detail. Settings and Agent catches use the serialized IPC error object rather than `instanceof Error` fallbacks.
- Tradeoff: the UI shows more raw text and may require scrolling, but this is preferable for operations work; semantic explanations belong in a later evidence/recovery layer and must never replace the original failure.

Version 0.8.0 removes the fixed terminal-context line contract and introduces JSON-first multi-model routing:

- `terminal_context` returns a bounded byte range plus `offset`, `nextOffset`, `totalBytes`, `totalLines`, and `eof`. Large `cat`/log output is therefore read on demand rather than silently losing lines; remote execution artifacts remain paged through `job_output`.
- `AiProfile.models[]` stores primary, analysis, and fallback candidates. The backend sorts candidates by role and retries only the model HTTP request on transport/HTTP/JSON failure; terminal writes, file writes, and other side effects are never replayed by this routing layer.
- `AppConfig` schema version 2 migrates legacy `model` fields into `models.primary`, writes atomically, and keeps secrets out of JSON. The frontend settings form is a view over this JSON contract rather than a second persistence format.
- Tradeoff: sequential failover adds latency only when the preferred model is unhealthy and does not provide ensemble voting. That keeps the native core small and makes error behavior deterministic enough for operations audit.

Version 0.8.1 closes the observability gap in the AI settings surface:

- The `/models` connection test now returns the count, endpoint, structured model objects, and a bounded redacted copy of the raw response. The UI keeps the success summary compact and expands model identities and raw JSON on demand.
- JSON configuration preview is split into a live draft generated from the current form and the backend-saved JSON returned through typed IPC. A separate local-open action delegates the canonical config path to the operating system without exposing credentials.
- The demo adapter and frontend tests cover both success-detail expansion and the refresh/open workflow, so browser verification does not depend on a running gateway.

Version 0.8.2 records the layout refactor for the same surface:

- The AI settings modal now uses a bounded dialog with fixed header/footer and a dedicated scroll container for the form. This prevents the modal body from competing with the footer for height.
- The connection-test result uses a two-column layout with a non-shrinking action button; model details and raw response remain inside an independently scrollable panel.
- JSON previews default to a single readable column at narrow widths and switch to two columns only when the dialog has enough space. Long JSON wraps and scrolls inside its own pane instead of creating a page-level horizontal scrollbar.

Version 0.8.3 records a layout-flow correction for the main workspace:

- The no-session placeholder now participates in the main-stage flex layout instead of using absolute positioning outside the flow.
- This keeps the quick-command dock at the bottom consistently, whether there are no sessions, one session, or multiple connected sessions.
- The change is CSS-only at the layout boundary, preserving terminal, SFTP, and quick-command behavior while fixing the state-dependent jump.

Version 0.8.4 records the TLS trust-store correction for outbound AI traffic:

- The direct `reqwest` dependency now enables `rustls-tls-native-roots` instead of the `rustls-tls` alias, which resolves to Mozilla `webpki-roots` in reqwest 0.12.
- Both the AI settings/test client and the Agent execution client explicitly enable native built-in certificates, so the build fails if the required reqwest feature is removed accidentally.
- The application keeps Rustls as its TLS implementation while loading roots from the operating-system certificate store. This supports enterprise and intranet CAs without disabling certificate verification or adding private CA material to application configuration.

Version 0.9.0 records the first in-process Codex Core integration for DeepSeek Harness:

- A single Harness `AgentFactory` owns the TypeScript lifecycle boundary while the native Core exclusively owns Agent Loop, Thread/Turn, compaction, tool ordering, Subagents, and Agent Graph state.
- Chat Completions, explicit Streamable HTTP MCP, and fixed-endpoint Web Search are the only classified network exits. The repeatable source/dependency/artifact scan fails on unknown clients or prohibited remote capabilities.
- Compaction performs an initial attempt plus at most three retries with 100/250/500 ms backoff. No summary boundary is committed before strict validation succeeds, and four failures terminate the Turn without truncating history.
- Root and Subagent state is durable in one SQLite store. Tests cover concurrency, timeouts, cancellation, graph recovery, structured failure propagation, and background-task drainage during plugin unload.
- The native plugin remains a separately distributed Harness package in this release. The desktop application's existing Agent runtime is not silently replaced, preventing two loops from owning one session.

Version 0.9.1 completes the desktop replacement boundary:

- `src-tauri/src/agent/dsh.rs` adapts the embedded `dsh-codex-core` runtime to the existing SSH/SFTP host tools. The desktop service no longer calls the legacy model loop; Core owns Thread/Turn state, tool ordering, compaction, Subagents, and cancellation.
- Agent settings no longer persist `profile`, `bundles`, `enabled_plugins`, or a user-facing `max_steps`. Startup migration rewrites legacy JSON without those fields, while the internal Core safety bound remains fixed at 64 steps.
- The Agent panel identifies the runtime as `Codex Harness Agent · dsh-codex-agent` and projects Core status, tool calls, compaction retries, Subagent status, exact error codes, and final output. This keeps the UI operational without exposing obsolete loop controls.
- Tradeoff: the first desktop release supports one configured primary model per dsh Core turn; existing multi-model profile routing remains available to the AI connection/test path, and a provider-pool transport can be added later without reintroducing a second Agent loop.

The 0.9.4 Agent prompt boundary keeps the system contract separate from user configuration:

- `DEFAULT_AGENT_SYSTEM_PROMPT` is versioned independently from the normal chat prompt and is always present for dsh-codex-agent runs.
- An AI profile's `system_prompt` is appended as lower-priority additional guidance instead of replacing evidence, permission, session-target, Skill, MCP, and error-fidelity rules.
- Enabled MCP tools are listed at task startup and their names, descriptions, and JSON Schemas are passed through the model-facing tool catalog. The prompt teaches the Agent to trust only that runtime catalog, search large catalogs through `mcp_tool_search`, and never invent unavailable MCP capabilities.
- Tests lock both a populated and an empty MCP catalog so a future refactor cannot silently remove the discovery contract.

The prioritized optimization options and their pros/cons are recorded in [`docs/agent-optimization-roadmap.md`](agent-optimization-roadmap.md). The immediate next boundary is typed tool outcomes, followed by a provider trait and MCP stderr/timeout supervision; multi-SSH and provisioning remain separate milestones.

The SSH diagnostics and non-active-session boundary was tightened after validating the desktop failure path:

- Tauri IPC errors now carry an optional structured session diagnostic (`stage`, `code`, `summary`, `detail`). The terminal UI uses that payload instead of treating serialized `{ code, message }` errors as generic JavaScript failures.
- `dsh-codex-agent` exposes `session_catalog` for saved profiles, live state, and the latest in-process connection failure. Session-bound tools accept an explicit `session_id`, so a model can inspect or operate on a non-active live SSH session after selecting it from the catalog.
- The catalog intentionally omits vault references and credentials. A profile with no live session is metadata only; the Agent must not infer reachability from it. Last-failure evidence is process-scoped in this milestone and is cleared after a successful reconnect.

The 0.9.8 interactive-terminal boundary deliberately uses the visible xterm instance as evidence instead of implementing a second terminal emulator in Rust:

- The frontend periodically sends a bounded screen snapshot containing visible rows, the cursor line, text before the cursor, the cursor column, and an update timestamp. The session manager stores only the latest snapshot.
- `terminal_send` treats `command` as the intended complete editable line. It removes the recognized prompt prefix, verifies that the visible input is an exact prefix of the desired line, and sends only the remainder. An incompatible line returns an exact error before any write.
- `raw` remains explicit for confirmation prompts, pager control, and REPL input. Agent-created background SSH sessions have no competing human xterm input, so the no-screen path sends the complete command.
- Complete-line input now removes actual C0/DEL bytes, ANSI sequences, and common escaped control notation before prefix matching; raw input is unchanged. A guarded `terminal_edit` tool uses the exact synchronized cursor line (and editable suffix for replacement) to make backspace/delete/clear/replace corrections without blindly overwriting a changed terminal.
- The terminal view keeps a stable vertical scrollbar, follows the bottom only while the operator is already at the bottom, and exposes a right-click automatic-wrap toggle. Disabling wrap enables the horizontal overflow track while preserving the xterm scrollback.
- Advantage: device and product CLIs use the same displayed state the operator sees, with minimal memory and no parser drift. Tradeoff: this evidence exists only while a frontend xterm is attached; it is not a persistent terminal replay model.
- The same release makes operational evidence easier to retrieve: SSH errors are selectable/copyable, MCP tests expose complete tool schemas, and the Agent provides a visible new-conversation control plus a visually separate history surface.

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

MCP v1 uses the official Rust SDK client behind one Transport abstraction. `stdio` uses a controlled child process, while `streamable-http` uses the SDK's HTTP client with URL validation and custom headers. Configuration tests operate on the unsaved draft; cancelling the modal therefore has no hidden persistence side effect. Enabled servers are connected when a run prepares its tool catalog, model-facing tool names are namespaced and sanitized, and actual calls pass through the same approval loop as built-in tools.

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
| Frontend tests | `npm test` | Pass, 39 tests across 13 files |
| Frontend production build | `npm run build` | Pass; dependency chunks remain below 500 kB; release main entry 117.75 kB and lazy SFTP entry 11.26 kB |
| Rust format | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | Pass |
| Rust check | `cargo check --manifest-path src-tauri/Cargo.toml` | Pass |
| Rust lint | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Pass; `russh 0.54.5` emits a dependency future-incompatibility notice |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 40 passed and 1 interactive keyring test ignored; `session::local::tests::shell_echo_reaches_output_sink` remains host-blocked by Windows `ERROR: Access denied` during process cleanup |
| Windows credential round trip | `cargo test --manifest-path src-tauri/Cargo.toml keyring_round_trip -- --ignored --nocapture` | Pass; native vault write, read, and cleanup all succeed |
| AI live integration | Production `AiService::test_connection` and streaming `AiService::chat` with the configured profile | Pass; 7 models found, chat completed with `stop`, 12 characters received, expected marker present |
| Saved-server CRUD | `live_check verify-crud` with the Windows credential vault | Pass; create, edit without re-entering secret, reload, delete, and credential cleanup verified |
| Saved-server auto-login | `live_check verify-profile` after a fresh config reload | Pass; native SSH backend loaded the saved credential and authenticated as `root` |
| Structured exec live integration | `live_check verify-exec` against the saved SSH session | Pass; exit 7, distinct stdout/stderr, 150 ms timeout, and exact 10 MiB streaming byte count verified |
| File-tool live integration | `live_check verify-files` against the saved SSH session | Pass; `/root` resolves with 12 entries, atomic file operations pass, two queued uploads and two downloads complete with exact content readback, and remote/local cleanup succeeds |
| Agent live integration | `live_check verify-agent` with the configured OpenAI-compatible profile and saved SSH session | Previously passed on 0.6.7; the 0.6.8 rerun was blocked by the workstation socket policy (`os error 10013`) before the session could start |
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
| AI connection failure diagnostics | `ai::service` diagnostic tests, `AiSettings.test.tsx`, and live HTTP probe | Pass; the 401 response reports `models_request` + `http_401`, the endpoint/body and captured stack appear after clicking details, the API key is redacted, and serialized IPC errors render in the dialog |
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
| 0.6.8 release and upgrade | `npm run build:release`, `npm run check:dist`, then silently install over 0.6.7 | Pass; installer is 7.66 MB, portable ZIP is 8.46 MB, required portable files are present, 0.6.8 replaced the legacy executable, an uninstall entry and `uninstall.exe` are present, configuration data was retained, and the desktop shortcut was repaired to the active install path |
| 0.7.0 plugin kernel | Rust plugin/runtime/protocol tests, frontend Agent settings tests, typecheck, lint, and release build | Pass; the default desktop profile mounts built-in tools, Skills, MCP, Hooks, and model metadata; explicit plugin selection is scoped; plugin ids reach Agent events; JSONL protocol validation rejects malformed and unsupported messages |
| 0.7.1 raw Agent diagnostics | Rust AI/AppError tests, frontend settings/Agent trace tests, typecheck, lint | Pass; HTTP status/endpoint/body, multiline redacted detail, MCP process errors, error codes, and complete-event failures remain visible without generic replacement; 45 Rust library tests and 41 frontend tests pass |
| 0.7.0 release and upgrade | `npm run build:release`, `npm run check:dist`, then silently install over 0.6.8 | Pass; installer is 7.68 MB, portable ZIP is 8.46 MB, installed EXE/registry report 0.7.0, one uninstall entry and `uninstall.exe` remain, configuration SHA-256 is unchanged, the desktop shortcut targets the new executable, and the installed process responds |
| 0.9.8 terminal/Agent usability release | 54 frontend tests, Biome, Vite production build, `cargo fmt --check`, single-thread `cargo check`, distribution audit, and 35-second runtime sampling | Pass; xterm snapshots drive suffix-only CLI completion, conflicts write nothing, SSH errors copy exactly, MCP schemas expand, new conversations preserve history, 200% UI zoom is persisted, and the release gate reports no sustained memory or handle growth |
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
## 15. Agent 短请求与 MCP 命令证据重构（0.9.9）

### 问题确认

实际代码中存在两个通用问题，而不是单个产品 CLI 的特例：第一，Agent 的完整 CLI 操作被拆成 `terminal_context -> terminal_send -> 再读上下文`，模型容易一次只调用一个小工具；第二，MCP 目录只保留部分描述，固定以 48 个工具为分界，并把 `isError=true` 的返回当作普通字符串，模型缺少稳定的“查询依据 -> 命令 -> 执行结果”链路。

### 方案比较

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只修改 Prompt，要求模型少请求 | 改动最小 | 无法强制命令边界、Schema 校验和证据引用；换模型后容易回归 | 不采用为主方案 |
| 给现有分支增加更多批量工具 | 短期可减少调用 | 每种协议继续增加专用分支，改 A 容易影响 B | 只保留通用 CLI/MCP batch 作为执行原语 |
| Capability Registry + Evidence Ledger + 原子 CLI Executor | 工具发现、调用、证据和命令执行边界统一；可测试、可观测、便于扩展 Provider | 首版需要迁移工具 descriptor、策略和 UI；未知 CLI 提示符仍需兜底 | 采用 |

### 实现决定

1. Capability descriptor 保留 Provider、Transport、Input/Output Schema、annotations 和稳定 ID。小目录直接暴露，大目录按任务相关度和 Schema 字节预算选择，同时提供搜索入口。
2. MCP 调用前后做 Schema 校验；完整原始结果落盘为 Evidence artifact。模型只拿有界预览，长结果分页读取。
3. `cli_execute` 在一个输入锁事务内读取屏幕并写入缺失后缀，之后等待明确边界；`cli_execute_batch` 只接受互不依赖的完整命令。
4. Codex Core 只并发宿主明确标记的只读工具。第三方 annotation 用于展示和未来适配，不直接降低权限或证明并发安全。
5. 聚合模型请求、工具调用和 Token 指标，通过 Agent 时间线暴露，后续优化以数据为准。

### 失败与修复

- 初次重构把 Evidence 持久化方法放到了 `tool_definitions` 自由函数内部，Rust 编译器准确指出 `self` 不合法；移动回 `AgentService` 实现并补充编译检查。
- Windows 全量 `cargo test` 发现 `live_check` 示例仍以值类型调用只对 `Arc<AgentService>` 提供的方法；示例改为与生产路径一致的 `Arc` 所有权。
- MCP Header 测试使用字符串直接查询 `HashMap<HeaderName, _>`，哈希借用不保证大小写归一；改用规范化 `HeaderName` 查询，不改变运行时代码。
- CLI 静默判定最初可能在完全没有活动时提前成功；加入 `saw_activity` 前置条件，把默认静默窗口提高到 1200 ms，并保留 `completionReason` 和超时结果。

### 可复用经验

- 减少模型请求不能只靠 Prompt，应该把“必须原子完成的一组宿主动作”定义成一个工具边界，把“可独立并行的读取”定义成调度元数据。
- 外部知识查询必须返回稳定来源和原始证据；摘要适合模型阅读，不适合作为唯一事实存档。
- 批处理只能合并独立工作。后一步参数依赖前一步结果时，强行 batch 会把延迟优化变成正确性缺陷。
- 插件 annotations 是提示，不是信任根。权限、并发和重试仍由宿主的本地策略决定。

## 16. 全局字号与动态 SSH 目标（0.9.10）

### 问题确认

这次反馈对应的是两类真实且通用的实现问题。第一，根容器已经使用 CSS `zoom` 放大界面，但 xterm 的字号又除以同一倍率，终端因此主动抵消了 150%/175%/200% 设置；部分标题仍散落使用过小的局部字号。第二，Agent 面板用手动开关决定是否把活动会话传给 Task，后端又把它当隐式 fallback。这把“界面当前焦点”错误等同于“用户本次意图”，导致 MCP、Skill 或一般问题也可能绑定 SSH，且不适合命名目标与多 SSH。

同时确认了两个关联问题：MCP 连接/发现失败只存在宿主启动路径中，模型缺少可调用的状态工具；MCP SDK 返回的内容块虽然落了原始 Evidence，但模型预览没有稳定的 `textContent` 字段，容易只看到包装层。已保存会话编辑的同步数据加载本身并不慢，卡顿主要来自浏览器/系统密码管理器对主机、用户名和密码字段的自动填充探测，因此关闭这些字段的 autocomplete，不引入异步复制或额外缓存。

### 方案比较

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 保留“绑定活动会话”开关并优化提示 | 改动最小，用户能手工控制 | 仍把 Agent 路由职责推给用户；通用任务默认行为不稳定；多 SSH 无法自然扩展 | 不采用 |
| 前端按关键词判断是否绑定 SSH | 反馈快、实现简单 | 语言和产品命令不可穷举，容易改 A 坏 B；真实 Agent 意图被第二套路由器覆盖 | 仅浏览器演示适配器模拟，不进入生产路径 |
| 活动会话作为候选 + 模型显式选择 + 执行器闭合失败 | 通用、可审计、多 SSH 一致；UI 焦点不会导致误操作 | 模型漏传参数时会产生一次明确错误；含糊目标需要询问 | 采用 |
| 终端基础字号独立于界面倍率 | 可精细控制终端密度 | 用户设 150% 时终端仍小，正是本次缺陷 | 改为基础字号乘全局倍率 |

### 实现决定

1. `effectiveTerminalFontSize = terminalBaseSize × fontScaleFactor`；根容器继续负责界面倍率，xterm 选项显式同步最终字号，更新后重新 fit 但不重连。标题字号收敛为 section/title/heading token，随同一根倍率变化。
2. Agent UI 删除手动绑定开关，只展示不可操作的“活动 SSH 候选”。IPC 保留兼容字段名，但后端把值解释为 candidate，不写入 Task 的绑定会话。
3. 所有会话工具 Schema 增加 `use_active_session`，默认 `false`。执行器优先使用明确 `session_id`；只有该布尔值为真才解析 candidate；两者都没有则返回包含选择方法的原始目标缺失错误。
4. 系统 Prompt 规定：普通/MCP/Skill/历史任务不读 SSH；当前终端表述可选择 candidate；命名目标先查目录并连接；多 SSH 每一步都显式指定目标。生产路径不使用关键词分类器。
5. 新增只读 `mcp_status`，记录 disabled/ready/connection_failed/tool_discovery_failed、Transport、工具数、错误码和原始详情。MCP 调用预览同时提供 `structuredContent`、所有文本块合并的 `textContent`、`isError`、截断/继续读取状态和 Evidence id。

### 验证与可复用经验

- 组件测试证明界面从 100% 切到 150% 后，13px 终端基础字号变为 19.5px，且 SSH 不重连；浏览器 1280×720 检查确认标题、设置项和 Agent 候选行无页面级横向或纵向溢出。
- Agent 测试锁定显式目标 Schema 和执行器行为：明确 `session_id` 优先、`use_active_session=true` 才能使用 candidate、空参数绝不 fallback。演示 QA 分别覆盖一般问题零工具、MCP 问题只调用 `mcp_status`、当前终端问题调用 `session_info(use_active_session=true)`。
- UI 焦点是环境事实，不是用户意图。候选上下文可以提供给模型，但不能在执行层静默生效。
- 全局无障碍倍率必须覆盖最难阅读的内容区域；“为避免双重缩放而抵消终端字号”会破坏用户对全局倍率的直觉，基础字号应作为相对密度而不是逃逸口。
- 外部工具的健康信息和调用结果必须同时对模型可见。只在设置页给人看错误，或只保存原始 artifact 而不给稳定摘要结构，都会让 Agent 无法自行诊断。

## 17. 稳定对话与 Provider Context（0.9.11）

### 问题确认

旧实现虽然在 `dsh-codex-core` 内有 thread/message/compaction 存储，但 myterm 每次用户发送都用新 `run_id` 创建 core thread，所以“参数之间是有空格的”这类纠正不会自动进入下一轮。前端“新对话”只清空时间线，也没有真正的上下文边界。这是数据模型和 runtime 生命周期的系统性缺陷，不是一条 Prompt 能修复的问题。

同时，所有 Chat Completions 决策在本地压缩前都会重发有效历史；若只改成固定续接 Responses，又会排除大量仅支持 Chat Completions 的内网网关。因此必须把本地对话事实与 provider 续接游标分层。

### 方案比较

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只复用本地 thread | 改动小，Chat 网关全兼容 | 长对话仍重发历史，后续接 Responses 需再重构 | 不采用 |
| 只使用 Responses | 增量续接和原生压缩简洁 | 内网 Chat-only 网关无法使用，远端状态不能代替本地审计 | 不作唯一路径 |
| 稳定 Conversation/Turn + Provider Context Adapter | 本地事实可审计，Responses 增量高效，Chat 可回退 | 数据迁移、provider 能力探测和跨模型状态更复杂 | 采用 |
| 嵌入完整 Codex App Server | 协议语义完整 | 引入更重进程和重复 SSH/权限/审计边界 | 不符合轻量目标 |

### 实现决定

1. Agent DB schema v5 增加 `agent_conversations`、`conversation_id` 和 `turn_index`；迁移时不合并旧任务，避免把无关历史错误串联。
2. Core thread 稳定使用 `conversation_id`，runtime 可每 Turn 重建，但 SQLite 中的消息、压缩和 provider checkpoint 继续恢复；不引入常驻 sidecar。
3. Steering 队列上限 32 条。追加事件先持久化，core 在请求模型前和即将返回最终答案前都检查队列，防止“用户刚追加，Turn 却已结束”。
4. Auto 模式优先 Responses；明确不支持才保存 `unsupported`，瞬时错误只在本轮回退 Chat。Provider id 由 profile/model 组成，避免把一个模型的 cursor 交给另一模型。
5. Responses 保存 `previous_response_id` 和已覆盖的本地消息序号，仅发 tail；Chat 使用严格 JSON checkpoint。本地压缩还会从工具调用原文反向补入 CLI 命令，不信任模型摘要能完美保真空格。
6. 切换 AI profile 会退出当前 Conversation，后端也校验 Conversation 归属；这比在同一对话中无声替换 provider 更容易审计。

### 验证与可复用经验

- Core 测试覆盖重启后的跨 Turn 纠正、Responses 只发增量、provider checkpoint 恢复、steering 在结束前被消费、严格 checkpoint 与 CLI 空格保真。
- Agent Store 测试从旧表结构直接打开，确认旧 task 不丢失；前端测试覆盖真正的新对话、历史恢复、运行中追加和 provider 配置持久化。
- 经验：“上下文”不是一个大字符串，而是三类不同寿命的状态——本地审计事实、模型可读 checkpoint 和 provider 不透明游标。把它们混成一层，不是丢历史，就是重复发送或无法跨 provider 恢复。

## 18. 环境文件、AI 探测与显式终端滚动（0.9.14）

### 问题确认

本轮三个反馈都对应通用缺陷。AI 下拉框展示的是持久化 Provider 配置，旧项没有生命周期管理；原“测试连接”只请求 `/models`，无法证明配置中的具体模型能够完成推理；终端关闭自动换行后虽然 DOM 具备水平 overflow，但 Windows WebView 的覆盖式原生滚动条可能不绘制稳定滑块。服务器环境继续嵌在 `config.json` 还会让高频会话 CRUD 与全局设置共享同一个写入热点，也不利于按环境分组备份和审查。

### 方案比较

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 在 Agent 下拉框旁直接删除 | 操作路径短 | 容易误删当前 Provider；下拉框同时承担选择和管理，边界混乱 | 不采用，统一放在 AI 服务设置中管理 |
| 继续用一个“测试连接”先列模型再发消息 | 表面按钮更少 | 两个端点的失败阶段混在一起；无法单独查看模型清单或指定测试模型 | 拆成“获取模型”和“测试模型” |
| 继续调整原生 scrollbar CSS | 代码少 | Windows WebView/系统覆盖滚动条行为不可控，真实页面仍可能看不到或拖不住 | 使用应用自有的显式 range 滚动控件 |
| 环境继续保存在 `config.json` | 迁移成本最低 | 文件持续膨胀；环境不能独立管理；任一会话变更重写全局配置 | 按分组拆到 `environments/` |
| 永久保留所有旧 schema 迁移 | 任意旧版本可直接升级 | 开发阶段长期积累死代码和测试矩阵，增加内核分支 | v0.9.14 只保留一版迁移，v0.10.0 删除 |

### 实现决定

1. `AppConfig.profiles` 只参与 v0.9.14 反序列化，不再序列化；运行时服务器列表由独立锁和 `environments/<分组名>.environments.json` 提供。分组文件写入先生成临时 JSON，再原子替换。
2. 前后端使用相同的 Windows 文件名约束。新输入严格拒绝非法字符、控制字符、首尾空白、结尾句点和保留设备名；旧数据迁移时自动替换并返回原名到新名的报告。大小写冲突在写盘前拒绝，避免 Windows 文件覆盖。
3. 环境 CRUD 采用 copy-on-write：先复制列表、写盘成功后再替换内存值。这样不仅校验失败不会污染内存，I/O 失败也保持运行时与磁盘一致。
4. AI `/models` 探测保留完整模型对象和原始返回；真实模型测试单独调用 `/chat/completions`，记录模型、正文、耗时和阶段化诊断。旧 `ai_test_connection` 暂留作内部兼容入口，前端不再使用。
5. AI 配置删除只允许非活动项，凭据引用同时从系统凭据库清理，对话历史按 Conversation 所属事实保留。
6. 终端无换行模式使用宽 xterm host 承载固定大列数，外层 shell 保持真实 `scrollLeft`；底部显式 range 读取 `scrollWidth/clientWidth` 计算范围和滑块宽度，通过 `input` 事件与 shell 双向同步。

### 验证与后续清理

- 前端 62 项测试通过；Rust 共运行 80 项库测试，其中 79 项通过、1 项交互式系统凭据测试按环境忽略。新增定向测试覆盖配置删除、真实模型响应、环境迁移和显式滚动控件。
- 2026-08-28 的本地浏览器验证中，横向滚动控件范围为 3493，设置到 1200 后 shell `scrollLeft` 为约 1199.94；AI 两个验证动作、旧配置删除入口和非法分组禁用保存均可见，控制台无错误。
- 发布脚本继续负责 Release 构建、分发审计和 35 秒内存/句柄采样，最终数字写入 v0.9.14 发布结果。
- **v0.10.0 已完成清理**：删除 `AppConfig.profiles` 兼容字段、`migrate_legacy_profiles`、迁移报告 IPC/前端提示及其专用测试；环境文件加载、严格校验和原子写入继续保留。

可复用经验：磁盘布局迁移应把“旧数据宽容归一化”和“新数据严格拒绝”分开；连通性与能力验证必须按端点和阶段拆开；平台原生 UI 行为若无法在目标运行时稳定验证，应由应用提供可观察、可访问且可测试的显式控件。

## 19. 查询结果胶囊与增量 Checkpoint（0.10.0）

### 问题确认

Chat Completions 没有 provider 侧不透明上下文时，最昂贵的内容通常不是用户对话，而是 `cat`、日志、目录、主机事实和 MCP 查询结果。把完整结果一直放在消息数组中，会在每次模型决策中重复传输；简单截断又会丢失用户真正需要的某一行。压缩时若再次把全部历史交给同一个模型，还会形成“为减少上下文而先发送一次更大上下文”的悖论。

### 方案比较

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 固定头尾截断 | 实现最简单，立即降低请求体 | 目标值可能位于中间，无法证明未展示内容，错误地诱发工具重跑 | 不采用 |
| 每个结果调用专用压缩模型 | 语义表达能力强 | 用户当前没有专用模型；增加网络请求、费用和新的失败点 | 暂不采用 |
| 原文落盘 + 确定性 Capsule + 按需读取 | 原文无损、成本稳定、无新增模型、可精确追溯 | 领域事实提取需迭代；必要时增加一次本地读取 | 采用 |

### 实现决定

1. SQLite 新增 `tool_results` 索引，原始结果写入独立 artifact，记录 `result_id`、调用、工具、消息序号、字节数和 SHA-256；投影到消息中的 Capsule 与原文分离。
2. 8 KiB 以内结果保持原生工具消息。更大 JSON/文本由本地 Reducer 生成版本化 Capsule，优先提取与用户意图相关的精确值、错误级别计数和原文摘录；Reducer 不负责发明结论。
3. `result_read` 是 Core 内置只读工具。`query` 返回匹配原文行及总数，`offset/limit` 返回 UTF-8 安全分页；它只读取已有 artifact，不能重放原工具。
4. Checkpoint v2 的压缩输入仅包含上一 checkpoint、新增 sequenced tail、可用事实与结果目录。模型只选择 `userCorrectionRefs`、`factRefs` 和 `resultRefs`，宿主再从持久化来源注入原文，拒绝未知引用。
5. 与后续目标无关的已完成查询允许不选择任何 fact/result 引用；仍需复查但无法浓缩成单一值的原始证据使用 `resultRefs` 保留。
6. Token 估算计入系统 Prompt、完整工具 Schema、消息、checkpoint、协议开销和输出预留。压缩校验失败时，下一次重试会收到上一错误；初次加三次重试仍失败才终止 Turn，历史不提交为已压缩。
7. v0.10.0 同时删除 v0.9.14 承诺只保留一版的环境迁移分支，避免开发阶段把一次性兼容代码长期带入内核。
8. 发布前冷缓存验证暴露了两个与代码无关但会破坏可复现构建的环境问题：长期增量 `target/debug` 曾膨胀到约 99 GiB，使用 `cargo clean --profile dev` 精确清理；`aws-lc-sys` 在无 NASM 的 Windows 环境无法从零编译，仓库 `.cargo/config.toml` 因此显式选择 crate 自带的 Windows x64 预编译汇编对象，保留汇编优化且不依赖全局安装。

### 验证与可复用经验

- Core 测试覆盖大 JSON 命中中间值、日志错误摘录、小结果原样保留、原文 artifact 与消息投影分离、`result_read` 搜索、连续两次增量压缩、空引用丢弃查询噪声和未知结果引用拒绝。
- 事实保真不能只依赖 Prompt。模型适合判断“哪些事实仍重要”，宿主必须负责“引用是否合法”和“原文究竟是什么”。
- 压缩是一种投影，不是删除。模型上下文可以缩小，但本地审计原文、哈希和读取路径必须保持可恢复。

## 20. 有效模型契约与完全自适应 Provider Context（0.10.1）

### 问题确认

模型配置删除问题不是单纯的前端文案错误。后端 `effective_models()` 会接受任意启用且非空的模型，并按角色排序；Agent 下拉框却只查找 `primary`。删除主模型而保留分析或备用模型时，后端仍能运行，前端却显示“未配置模型”，形成两个互相矛盾的事实来源。

Provider 回退也确实已经写入 SQLite，但运行时把“是否复用”判断为“旧 checkpoint 是否有 cursor”。Chat Completions 的本地 checkpoint 没有 provider cursor，因此每个模型步骤都会被判为未复用并重复投影“已持久回退”。持久化本身没有失效，失效的是状态变化判断。

### 方案比较

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 保留协议下拉框并修正文案 | 改动最少；高级用户可强制模式 | 用户需要理解 Provider 协议；配置分支长期存在；错误选择会让可用网关失效 | 不采用 |
| 默认自适应，保留隐藏高级覆盖 | 表面简洁；仍可人工干预 | 隐藏配置仍形成第二条运行路径和测试矩阵，维护 AI 需要判断人为覆盖 | 不采用 |
| 完全自适应 + 配置指纹能力缓存 | 用户零选择；运行路径唯一；配置变化自动重新探测 | 需要严格区分永久不支持与瞬时故障，并保留可诊断证据 | 采用 |
| 每轮都探测 Responses | 不会使用过期结论 | Chat-only 内网网关每轮多一次失败请求，延迟、日志和流量都更差 | 不采用 |

### 实现决定

1. 前端增加单一 `effectiveAiModels` 规则，Agent 下拉框、已保存配置和模型测试均从启用且非空的模型中按角色优先级选择；保存和删除时若不存在主模型，则提升第一个有效模型。
2. 后端 `normalize_ai_profile` 执行相同的主模型归一化，确保 UI、直接 JSON 编辑和运行时都得到规范配置，而不是依赖前端一定正确。
3. 删除 `AiContextMode`、前端协议选择和持久 JSON 字段。schema v4 只承担一次清理；运行时始终采用 Responses 优先、明确不支持后跨对话持久回退、瞬时故障仅本轮回退的唯一策略。
4. Provider 能力键使用 profile/model 项 ID 加 Base URL、模型和认证方式的 SHA-256 短指纹。指纹变化就是新能力域；原始 Endpoint、模型和密钥不进入 key。
5. checkpoint 每次仍更新 cursor 与 `through_seq`，保证续接准确；`unsupported` 按 Provider 指纹从已有对话聚合，只有全局能力或当前 `mode` 真正变化时才发送用户可见事件。状态更新与状态通知不能混为一谈。
6. Core 为每次 checkpoint 写结构化 audit；宿主对探测、缓存命中和回退写稳定字段 JSON 日志。安装版记录 INFO，`--debug` 记录 DEBUG，日志按天滚动并保留 14 天。
7. 发布脚本在 `-RunRustTests` 下分别执行 Core 和宿主测试。Rust 依赖 crate 的测试不会因为宿主执行 `cargo test` 而自动运行，必须显式纳入发布门禁。

### 验证与可复用经验

- 回归测试覆盖“无 primary 但有启用模型”的界面展示、保存归一化和 Core 相同 Provider 状态只投影一次。
- 配置指纹测试确认尾部斜杠归一化不误触发新探测，而 Base URL、模型或认证方式变化都会失效旧缓存。
- schema 测试从包含 `context_mode` 的 v3 JSON 打开，确认写回 v4 且删除旧字段；日志保留测试只删除过期 `myterm.log*`，不触碰同目录其他文件。
- 可复用经验：持久状态应以“能力域”而非界面选项建模；频繁 checkpoint 写入属于数据更新，用户事件只应表达状态转移。UI 与内核若各自定义“有效配置”，迟早会出现“能运行但显示不可用”的分裂事实。

## 21. 普通任务自动 Goal 与可持续 Agent 控制面（0.11.0）

### 问题确认

`maximum step count 64 was reached` 不是用户任务真的失败，而是精简 Codex Core 把单个 Turn 的安全边界误暴露成了整个任务上限。只提高常量会延迟问题：外部等待、应用重启、运行中追加要求、后台 Job 完成和多 SSH 协同仍没有统一的恢复单位。另一方面，直接接回完整 codex app-server 会把登录、云任务、Telemetry、插件市场等未使用能力带入轻量桌面产品。

### 方案比较

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 把 64 改成更大的固定数 | 修改最小 | 仍会在更晚的位置失败；无法解决等待、恢复和可观测性；大数还会掩盖循环 | 不采用 |
| 精简 Core 上增加 Goal 控制面 | 保留已审计依赖图；普通输入自动支持续跑；可独立管理等待和恢复 | 需要明确 Goal/Conversation/Turn 的所有权和状态迁移 | 采用 |
| 恢复完整 codex app-server | 上游长任务能力最全 | 包体、依赖、网络出口和状态所有者显著膨胀；与裁剪目标冲突 | 排除 |

### 实现决定

1. 每个普通输入自动创建或复用 Goal，用户无需输入 `/goal`。Conversation 是可见上下文边界，Turn 是 Core 的可让出执行段，Goal 才是完成/失败的单位。
2. Core 达到 64 Step 时返回 `continuation_required`；宿主把当前 Turn 记为成功让出并自动续跑，不再生成 `StepLimit` 错误。默认 Goal 不设置隐藏 Token 总预算。
3. 澄清不是失败。系统 Prompt 要求先安全只读发现；仍存在会改变执行路径的目标、范围、结果或风险歧义时，持久化 `waiting_approval` 和准确问题，允许多轮确认后继续同一 Goal。
4. 后台 Job 使用事件驱动通知唤醒 Goal。回调先注册 `Notify` 再检查活动状态，避免“任务刚结束、通知刚错过”的竞态；删除固定轮询和任意等待超时。
5. Job、Evidence 和激活 Skill 都改为 Goal 级，可以跨 Turn 恢复。原始工具/MCP 结果与模型投影分离，后续 Turn 通过引用读取，不重新执行副作用工具。
6. MCP 重构为统一 CapabilityProvider，stdio 与 streamable-http 共用 Tools/Resources/Prompts、连接池、Schema 校验、进度和 Evidence。发现类操作可重连一次，工具调用失败不自动重放。
7. 模型路由允许单个模型引用另一份 Provider 配置；瞬时请求有限重试，流式输出后不重放，连续失败熔断。上下文协议、窗口和压缩阈值完全自适应，不让用户维护第二套运行策略。
8. 同一 SSH Session 的状态变更用独立锁串行，不同 Session 可并发；`session_wait_until` 用一个有界只读工具调用表达跨主机等待，减少短小模型轮次。
9. 删除 Conversation 前检查活动 Turn/Job，并递归清理 Root/Subagent Thread 树、审计索引和原始 artifact，避免“UI 历史删了但磁盘证据永久留下”。
10. Release 门禁先重建当前 N-API 二进制再运行 Harness 测试。源码测试通过但加载旧 `.node` 的问题说明：原生边界测试必须把产物新鲜度当成测试前置条件。

### 验证与可复用经验

- Core 测试覆盖 Step 让出、连续 checkpoint、三次压缩重试、Subagent、Result Capsule 和持久线程树删除。
- 宿主测试覆盖 Goal 状态机、重启恢复、Job/Evidence/Skill 持久化、Provider 路由、MCP Transport/Schema/诊断、CLI 空格与多 SSH 目标选择。
- 前端测试覆盖新对话、运行中 steer/queue、Shift+Enter、Goal 状态、模型 Provider、全自适应设置和真实错误详情。
- 可复用经验一：长任务能力的核心不是“允许更多 Step”，而是把进展、等待和恢复放到比单次模型循环更稳定的状态层。
- 可复用经验二：内部安全边界应产生可恢复的 yield，而不是直接升级成用户可见失败；循环保护应判断无进展，而不是只数步数。
- 可复用经验三：外部工具调用不能自动重放副作用，但连接状态可以在失败后失效并在下一次显式调用重建；可靠性与幂等性必须分开设计。
- 可复用经验四：用户不阅读代码时，稳定字段日志、精确错误、checkpoint 和 artifact 引用就是维护接口，不能把它们当调试期临时输出。

## 22. 官方 DeepSeek Harness ACP 迁移（2026-09-01）

### 问题确认

旧 `dsh-codex-agent` 并不是真正使用官方 Harness 内核，而是在本地维护一份裁剪 Codex Core、N-API 边界、Provider transport、压缩、Goal 续跑和上下文投影。它解决过 CLI 空格、长结果和 64 Step 等实际问题，但每次上游 Agent、模型协议、压缩或 Skill/MCP 演进都需要在 myterm 内重复实现，维护成本已经超过轻量产品应承担的范围。

用户强调工具不能随迁移被删除。审计确认 myterm 的核心价值不只是对话：保存服务器、SSH、交互式 CLI、SFTP、多 SSH、权限和精确错误都必须保留；同时官方 Harness 自带的本地 Shell/文件/Goal/Skill 工具也不应裁掉。

### 方案比较

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 继续扩展裁剪 Codex Core | 包体较小；行为完全可控 | 永久维护分叉；Provider、Goal、Skill、压缩和工具生态都要自行追赶 | 不采用 |
| 整个 Harness 直接接管 SSH/MCP | 接入代码少 | 会绕过 myterm 会话、CLI 事务、权限、错误和多 SSH 契约，终端能力反而下降 | 不采用 |
| 官方 Harness ACP + 分层工具 | 官方内核可快速升级；本地工具和 myterm 远程工具都保留；边界可测试 | 需要 sidecar/ACP/Host MCP；携带 Node 后资源体积增加；上游仍为 Developer Preview | 采用 |

### 实现决定

1. 固定官方 `@deepseek-ai/dsh-*` `0.1.2-alpha.3` 与 ACP SDK `1.4.0`，使用专用 `cordis.yml` 只启用 Agent Loop、Session、Goal、compaction、本地 Shell/文件、Skill、MCP 和 ACP，不启用 web、TUI、headless CLI 或 telemetry。
2. Rust 使用容错 ACP v1 NDJSON 客户端启动/监管 sidecar，映射 initialize、session new/resume、prompt、permission、cancel、tool update 和最终原因；Conversation 保存 ACP session id，可跨应用重启恢复。
3. 每次运行在 `127.0.0.1:0` 启动随机路径、随机 Bearer 的 Streamable HTTP Host MCP。它把 SSH、CLI、SFTP、会话、Job 和外部 Capability 暴露给 Harness，任务结束立即关闭。
4. 外部 MCP 继续由 myterm CapabilityProvider 预连接。这样某个服务器连接/发现失败不会回滚整个 Harness Session，Agent 仍可用 `mcp_status` 读取稳定错误码和原始详情。Resources/Prompts 因 ACP 当前只消费 Tools，被包装成 Host MCP 工具。
5. 系统 Prompt 由 Rust 合并内置契约和用户附加指令，通过 `MYTERM_HARNESS_SYSTEM_PROMPT` 进入官方 `dsh-system-prompt` 的 `persona`。单元测试验证本地/远程工具边界和用户指令都存在，避免“界面保存但运行时未使用”。
6. ACP v1 没有真正 mid-turn steering。界面不再声称可打断当前模型响应：“响应后继续”在本次响应结束后立即发送下一次 ACP prompt，“排队执行”进入持久 Goal 队列。
7. 发布构建使用 `prepare-harness-runtime.ps1`。脚本按 package-lock SHA-256 决定是否 `npm ci`，检查官方版本/profile，再把 launcher、profile、生产依赖和 Node 20+ 复制到 Tauri resources。安装版不依赖用户机器预装 Node。
8. 删除旧 `integrations/dsh-codex-agent`、Rust `agent/dsh.rs`、Cargo path 依赖和 N-API 发布门禁，不保留开发阶段兼容分支。

### 验证与可复用经验

- ACP smoke 已验证 HTTP MCP capability、session new/resume 表面和 sidecar 正常退出；Rust 90 项通过、前端 65 项通过。
- 打包资源未压缩约 236 MiB，其中 Node 约 86 MiB、官方生产依赖约 150 MiB。这个代价必须在每次升级记录，后续只做可验证的依赖裁剪，不修改官方包内部实现。
- 运行时按需启动：空闲时没有 Harness 进程和 Host MCP listener。体积增加不等于必须接受常驻内存增加；进程生命周期与磁盘体积应分别验收。
- 本地工具和远程工具必须在系统 Prompt、工具名、权限和日志中显式区分。“Shell 能执行命令”并不等于“Shell 在 SSH 服务器执行命令”。
- 2026-09-01 使用已保存 Provider 做了三层实测：非流式 Chat Completions 成功；普通 SSE 返回 `[DONE]` 与 `finish_reason=stop`；强制工具调用 SSE 返回 `[DONE]` 与 `finish_reason=tool_calls`。随后完整 ACP Turn 成功调用 Harness 本地 `pwsh`。一次“Upstream service temporarily unavailable”不能在缺少持续复现和原始协议证据时概括为上游不可用。
- Host MCP 的 `list_directory` 只暴露 `remote` scope，并在执行层再次拒绝 `local`；Harness 集成测试明确要求本地 Shell 工具且禁止 `mcp__myterm-host-tools__*`。工具边界不能只靠 Prompt，Schema 和执行入口都要实施相同约束。
- `AgentService::shutdown` 在取消活动 Turn/Job、关闭 MCP 后等待资源让出，并显式关闭惰性 SQLite 连接。否则 Windows 集成测试可能已经成功，却因 `agent.db` 仍被当前进程占用而在清理临时目录时误报失败。
- 上游更新友好不等于直接使用浮动版本。官方包必须整组固定、生成 lockfile、跑 ACP smoke 和 Host MCP 集成回归后再升级；否则快速更新会变成不可复现更新。
- 替换内核时应先让新边界通过握手和测试，再删除旧源码。删除旧构建缓存属于可再生成清理，源码删除保持 Git 可恢复。

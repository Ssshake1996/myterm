# dsh-codex-agent

`dsh-codex-agent` is an in-process DeepSeek Harness Agent Factory backed by a
trimmed Rust Codex Core. It uses a native N-API module; it does not start a
Codex process, app-server, sidecar, or local MCP server.

## State ownership

Codex Core is the only owner of the Agent Loop, Thread/Turn state, model
history, automatic compaction, tool-call ordering, Root/Subagent scheduling,
Agent Graph, and the SQLite Thread Store. Harness owns plugin lifecycle, UI and
HTTP entry points, event projection, approvals, sandboxed tool providers, and
explicit external tool connections. Harness Session events are projections and
are never used to rebuild a model request.

## Build and test

Requirements: Node.js 22+, Rust 1.88+, and the platform C/C++ linker used by
Rust. From this directory run:

```powershell
npm install
npm run build
npm test
```

The native binary is generated under `native-dist/` and TypeScript output under
`lib/`. `npm test` runs the Rust suite, rebuilds the current Release N-API
binary and TypeScript output, type-checks and lints the package, and only then
runs the N-API integration test. This prevents an old `native-dist` artifact
from validating newer source accidentally. A release must package the native
binary for each target platform.

The Core configuration accepts `turnStepBudget`; the legacy `maxSteps` name is
kept as a deserialization alias. This is a per-Turn yield boundary. The myterm
desktop Goal control plane automatically continues long work and does not
expose either field as a user task limit.

## Harness profile

Install this package as the last bundle after `dsh-base` and the chosen surface
bundle. Its `cordis.patch.yml` disables the Harness Agent Loop, compaction,
subagent graph, telemetry, credential store, default model adapters, default
DeepSeek Web Search, and Code Mode before registering the Codex factory.

Required environment variables:

```text
INTRANET_LLM_BASE_URL=http://llm.internal/v1
INTRANET_LLM_MODEL=your-chat-completions-model
INTRANET_LLM_API_KEY=host-injected-secret
DSH_CODEX_STATE_DIR=C:\ProgramData\myterm\codex-state
```

Only the environment-variable name is configuration. The key value is passed
separately to the native constructor and is not placed in plugin JSON, Harness
Session, Thread Store, Agent Graph, or audit records.

## Optional explicit Web Search

Web Search is absent unless `webSearch` is configured. The provider sends a
fixed `POST` request with JSON `{ "query": "..." }` to exactly one configured
HTTP(S) endpoint. Header values may only come from environment variables.

```yaml
webSearch:
  url: https://search.internal/v1/search
  headersFromEnv:
    authorization: INTRANET_SEARCH_AUTHORIZATION
  timeoutMs: 30000
  maxResponseBytes: 1000000
```

## Optional external MCP

Only Streamable HTTP MCP is supported. Every server URL and every tool must be
listed explicitly; wildcard tool admission, stdio, local server startup,
registry discovery, and automatic reconnection are rejected.

```yaml
externalMcp:
  - serverName: ops
    url: https://mcp.internal/mcp
    allowedTools: [status, deploy]
    headersFromEnv:
      authorization: INTRANET_MCP_AUTHORIZATION
```

## Compaction failure contract

Compaction uses the same intranet Chat Completions transport and sends no tool
definitions. The first failed attempt is followed by at most three retries
(four total attempts), with 100/250/500 ms backoff. No summary or boundary is
written before a valid response is committed atomically. If all four attempts
fail, Core emits `CompactionFailed`, terminates the current Turn, makes no normal
model request, retains the complete original history, and performs no fallback
truncation.

## Architecture trade-off

N-API keeps Core and Harness in one process and gives one lifecycle owner, at
the cost of platform-specific native packages and a strict serialization
boundary. A Rust sidecar is easier to isolate operationally but would split
lifecycle and state and is intentionally unsupported.

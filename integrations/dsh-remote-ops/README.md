# @dsh/remote-ops

Standalone DeepSeek Harness plugin for remote Linux operations. It does not depend on the myterm desktop application.

## Capabilities

- Saved environment groups in `remote-ops/<group>-environments.json`.
- Owner-scoped SSH sessions backed by `ctx.terminals`.
- Complete command submission plus low-level interactive input and signals.
- Sequential multi-target batches for coordination workflows.
- SFTP list/read/write/mkdir/delete/rename operations.
- Quick command storage and execution.
- Agent-visible diagnostic events and a DSH right sidebar.
- Passwords are referenced through Harness credentials (`passwordRef`); plaintext passwords are never persisted.

## Installation

Install the package into a DSH profile and add the rows from `cordis.patch.yml` to the profile patch. The package is intentionally independent from myterm and can be used by DSH Web or another DSH host.

Sessions are process-local, matching the Harness terminal contract. Saved environment definitions survive restart; an SSH PTY is reopened on demand.

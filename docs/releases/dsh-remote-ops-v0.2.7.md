# dsh-remote-ops v0.2.7

## Changes

- Keep connection and action errors visible until the user dismisses them instead of clearing them during background refresh.
- Allow SSH connection commands to be entered directly in the terminal when no session is active. Saved environments are reused first; direct sessions support user@host, -p, and -i.
- Add an ephemeral backend session path for direct SSH commands without persisting an environment definition.

## Validation

- npm run check passes.
- Local DSH Web validation covers the no-session SSH command input path, saved-environment reuse, direct-session action routing, and persistent error UI.

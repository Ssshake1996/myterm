# dsh-remote-ops v0.2.6

## Changes

- Hide the internal Harness credential-reference field from the environment form; SSH passwords remain stored through the Harness credentials service and existing references are preserved on edit.
- Add a draggable quick-command dock divider with bounded height and double-click reset, keeping the terminal as the primary workspace.
- Add visible success, failure, and in-progress feedback for refresh and update checks.
- Polish the DSH Web sidebar launch button with a compact SSH-oriented visual treatment while preserving the existing theme.

## Validation

- npm run check passes.
- The package is installed into the local DSH Web profile and verified through http://127.0.0.1:3080.
- Browser validation covers the hidden credential-reference field, quick-command resize handle, refresh/update feedback, and launch-button rendering.

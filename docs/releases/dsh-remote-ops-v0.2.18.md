# dsh-remote-ops v0.2.18

## Unified plugin navigation

- Integrates with the optional `pluginNavigation` client service without a mandatory dependency.
- The standalone footer launcher is hidden while shared navigation is available and restored when it unloads.
- Publishes a consistent icon and ordering through the official DSH sidebar guide metadata.
- Prevents automatic terminal focus from scrolling the outer DSH layout and clipping the plugin list.
- No changes to terminal, SSH, SFTP, permissions, credentials or Agent tools.

Install the release tgz through `dsh plugin --profile web add`, then restart DSH when idle. Unified navigation is a separate optional UI plugin; standalone installs retain their existing launcher.

Validated with the original unit/client/contract/smoke suites and a real official DSH browser workflow using local model fixtures, not a paid model.

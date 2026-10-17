# dsh-remote-ops v0.7.2

The default local CMD now highlights commands typed by the user and Agent raw input after recognized prompts, in addition to complete Agent sends. Standard `dir` output distinguishes directory names in teal from file names in blue. Commands use purple, clearer weight and a subtle background.

The terminal palette is adapted from [Catppuccin Latte / Mocha](https://catppuccin.com/palette/) and follows the DSH light/dark theme. Light-theme accents are darkened for readability; semantic text, including commands on their tinted background, is checked at a minimum 4.5:1 contrast. Surrounding controls keep host styles. Attribution and the palette license are included in the tgz.

Recognition uses the visible text after VT cursor edits, preserving backspaces, spaces and the actual terminal output. It adds no hidden input, executes no extra commands, and does not change copied text, logs or wire bytes. Existing ANSI colors remain. Common CMD, PowerShell and `user@host` prompts are supported; unknown prompts and bare/type-less directory listings are left unclassified. Full-screen applications remain outside semantic highlighting, which can be disabled in terminal display settings.

README and the bundled terminal-log skill describe the behavior. No Agent/core changes. Target host: DSH 0.2.0-rc.2. Install into the same DSH profile, fully restart DSH and refresh the browser. Export needed in-memory terminal logs before restarting.

Release assets remain **tgz and SHA256 only**. Validation evidence: `docs/testing/dsh-remote-ops-v0.7.2-acceptance.md`.

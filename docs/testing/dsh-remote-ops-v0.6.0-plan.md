# Remote Ops v0.6.0 implementation and acceptance plan

Confirmed scope: refresh every plugin module using the approved workspace-tab / native-right-sidebar proposal. Skills are references; product behavior, host compatibility and observed usability determine the design. Baseline: v0.5.4 / 11054fa. No Agent/core changes. Publish only tgz and SHA256.

## Phase 1 — visual foundation

- Shared host-aware surfaces, typography, control sizes, focus, spacing and restrained selected states.
- Compact global header; version/update/diagnostics and persistent comfortable/compact density in settings.
- Terminal, browser, files, environments, saved commands, dialogs and diagnostics follow the same visual hierarchy.

## Phase 2 — workspace interactions

- Terminal context and primary tools share a row; only multiple sessions need a separate session strip. Preserve search, input, scrolling and command results.
- Browser context/pages and navigation dominate. Settings/history are secondary views; display switching warns before dispatch and cancellation leaves the page intact. Human and Agent input remain shared.
- File selection reveals batch actions. Upload controls remain accessible, transfer progress stays visible and module switches do not cancel uploads or repeatedly refresh directories.
- Preserve drafts, active tabs, connection state, keyboard navigation, accessibility and native DSH conversation/draft.

## Evidence gates

1. Existing plugin check baseline, then new failing observable regression before implementation.
2. Full plugin check and browser scenarios: visual layout, 390px, themes, density persistence, display cancel/apply, draft preservation, background operations.
3. Candidate tgz installed into an isolated real DSH 0.2.0-rc.2 profile. Verify real native sidebar, all modules, local terminal, browser tool execution and bundled skill discovery. Clearly separate deterministic local SSH/site/provider fixtures from another computer or intranet.
4. README (root and plugin, both languages), WEB guide, bundled skill, release notes and acceptance report agree with final behavior.
5. Version-consistent release, Linux/Windows gates, exact two assets, official downloaded package hash/content and real-host upgrade/restart acceptance.

Do not report a gate as passed until its evidence exists. SSH command-spacing investigation remains deferred.

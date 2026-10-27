---
name: remote-ops-updates
description: Configure HTTP/HTTPS or GitHub Remote Ops updates, prepare latest.json feeds, and diagnose deferred hot reload or activation failures without changing Agent settings.
---

# Remote Ops plugin updates

Use the plugin's update dialog to configure the source and check for a newer version. Network checks start only from an explicit check/update action. Starting with v0.11.0, compatible updates automatically hot reload after active work finishes.

## User workflow

Open **Remote Ops → 设置 → 更新**. Select a source, save it, then click **仅检查版本** or **检查并更新**. The latter checks the source and installs a newer stable version in the current DSH profile. An identical or older version is not installed. If a version is already installed, **重试应用已安装版本** retries activation without downloading or installing it again.

## Activation and task continuity

- Wait for **新版已生效** and matching running/installed versions before claiming success. `phase: waiting` is pending work, not an update failure; inspect `hotReload.blockers`. Conversation tasks across the host, terminal waits/independent commands, transfers, browser jobs/runtime installation and API requests defer activation. Do not cancel them or restart DSH to force an update.
- Browser uploads keep the barrier for the entire batch, including gaps between files. A closed or disconnected browser's batch reservation expires after five minutes without a heartbeat; any ongoing transfer still blocks independently. Do not reinstall or replay uploaded files while waiting.
- Hot reload keeps conversation identity/drafts, saved configurations, live terminal/browser handles, terminal logs and API authentication/receipts. Do not reopen sessions or replay commands/requests merely because `runtimeId` changed. Continue from existing IDs and inspect results. Existing connection transports keep their original implementation; newly opened connections use the new version.
- A failed activation restores the old running instance. `phase: reload-failed` requires inspection and an explicit retry after addressing the cause. Installed and running versions can differ; rollback of the runtime does not downgrade the installed package. Do not retry in a loop.
- The first upgrade from v0.10.x or earlier requires one DSH restart to load hot-reload support. After CLI/host-manager installation on an already capable runtime, use the plugin's activation button. Hosts without the public reload interfaces, and packages with incompatible state formats, explicitly report `restartRequired`. A full restart loses process-local connections and records: finish work and export needed logs first. Refreshing only the browser cannot update the backend.
- This capability is inside the plugin. Do not modify Agent/core files or global Agent settings to enable it.

- **HTTP / HTTPS 地址**: enter a directly readable directory URL or its `latest.json` URL, using the scheme, host and path. The server must allow direct downloads from the DSH host. The manifest, tgz, checksum and redirect hops must stay on the configured origin. Internal HTTPS certificates must be trusted by the DSH Node process; preserve TLS validation.
- **GitHub Release** is the default source. For an internal mirror, serve the release directory through HTTP/HTTPS and save that address in the dialog.

Dependencies use DSH's package-manager registry, proxy and build-approval configuration. Configure a reachable internal npm registry when public registries are inaccessible. Use **remote-ops-browser** when the task needs matching Chromium installed on demand.

## Prepare a release feed

Use the unchanged official `dsh-remote-ops-vX.Y.Z.tgz` and its matching `SHA256SUMS-dsh-remote-ops-vX.Y.Z.txt`. The generator is [../../scripts/create-update-manifest.mjs](../../scripts/create-update-manifest.mjs), relative to this skill. Node.js is required; it performs no network operations.

```text
node <plugin-root>/scripts/create-update-manifest.mjs <release-directory>/dsh-remote-ops-vX.Y.Z.tgz
```

The default output is `latest.json` beside the tgz. To keep versions in subdirectories, pass a second argument pointing to `latest.json` in a parent directory. That output directory must already exist. The script validates SHA256, package name, version and bundle metadata before writing the manifest atomically; it refuses a lower version than an existing manifest. Relative asset URLs allow the directory to be served at any HTTP/HTTPS address.

Upload the tgz and checksum first, then publish `latest.json` last. Keep published version contents immutable and retain the previous release for manual recovery. GitHub Release provides the tgz and SHA256 pair; generate `latest.json` when deploying the internal mirror.

## Verify and diagnose

- Expand **错误详情** first. Record the operation title, request method and redacted URL, HTTP status, stage, timestamp and response preview. For update downloads, **读取版本清单**, **下载 SHA256 校验文件** and **下载安装包** identify which published file failed. The upstream status is separate from the plugin endpoint status (for example upstream 404 and plugin HTTP 400). Inspect that exact path on the DSH host before changing the source.
- **状态刷新失败** for `/api/dsh-remote-ops/state` is a plugin-state request failure, not proof that the update source failed. Check the active DSH profile, loaded plugin and route/proxy path; compare running and installed versions. Do not diagnose every 404 as a missing `latest.json` or automatically reinstall.
- The same background refresh failure is automatically shown once per DSH/plugin runtime. Dismissal, workspace switching and page refresh preserve suppression; retries continue. A manual **设置 → 通用 → 刷新状态** still reports its current result. Recovery clears the state error; a newly identified backend runtime resets notification suppression. If state never loads, suppression falls back to the current browser tab until the backend runtime can be identified.
- Diagnostic URLs hide query values; previews redact common credential fields and are length-limited. Request bodies and headers are not collected. Check business content before sharing an error report. Use the actual failed address and response rather than guessing from the red box alone.
- Report **current running version** separately from **installed version**. Installation success requires a matching on-disk package version; activation success additionally requires the matching running version. Hot reload refreshes backend code, browser resources and bundled skill registration together.
- `UPDATE_METADATA_INVALID`: the entry must return a valid `latest.json`, not HTML, a directory listing or a prerelease. Regenerate the manifest.
- `UPDATE_CHECKSUM_MISMATCH` / `UPDATE_PACKAGE_INVALID`: installation has not been dispatched. Re-copy the matching official tgz and checksum; do not bypass verification.
- `UPDATE_DOWNLOAD_FAILED` / `UPDATE_CHECK_TIMEOUT`: verify that the DSH host can reach the HTTP/HTTPS address and trusts its certificate. Check the server status and file permissions. A browser's ability to reach the URL does not establish that the DSH process can reach it.
- `UPDATE_INSTALL_FAILED`: read the DSH plugin-manager diagnostic path. Registry failures and pending dependency script approvals require fixing the existing DSH configuration. The updater does not grant build approvals or bypass compatibility checks. Retry only after the reported cause is addressed.
- DSH's failed-install recovery restores profile manifest/lock files; downloaded cache/module files may remain. Do not claim a complete filesystem rollback or restart success from an install result alone. If the new plugin cannot load, use the retained old tgz through the DSH plugin manager/CLI after stopping DSH.

Existing older installations need one manual upgrade to a version supporting these sources. Do not tell a user on an older release to look for the new configuration fields.

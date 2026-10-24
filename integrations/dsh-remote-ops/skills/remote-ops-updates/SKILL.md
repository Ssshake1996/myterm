---
name: remote-ops-updates
description: Configure and troubleshoot manual DSH Remote Ops plugin updates from an HTTP/HTTPS intranet address, and prepare a latest.json release feed for an internal mirror.
---

# Remote Ops plugin updates

Use the plugin's update dialog to configure the source and check for a newer version. Checks start when the user clicks a check button; the installed version takes effect after the user restarts DSH.

## User workflow

Open **Remote Ops → 设置 → 更新**. Select a source, save it, then click **仅检查版本** or **检查并更新**. The latter checks the source and installs a newer stable version in the current DSH profile. An identical or older version is not installed. A version already installed but awaiting restart is not installed again.

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

- Report **current running version** separately from **installed version**. Installation success requires a matching on-disk package version. New JavaScript and bundled skills take effect after fully restarting DSH and refreshing the page; a browser refresh alone is insufficient.
- Let ongoing work finish before restarting. Terminal/browser connections and process-local API sessions/records do not survive a DSH restart. Installing an update does not itself close those connections or replay operations.
- `UPDATE_METADATA_INVALID`: the entry must return a valid `latest.json`, not HTML, a directory listing or a prerelease. Regenerate the manifest.
- `UPDATE_CHECKSUM_MISMATCH` / `UPDATE_PACKAGE_INVALID`: installation has not been dispatched. Re-copy the matching official tgz and checksum; do not bypass verification.
- `UPDATE_DOWNLOAD_FAILED` / `UPDATE_CHECK_TIMEOUT`: verify that the DSH host can reach the HTTP/HTTPS address and trusts its certificate. Check the server status and file permissions. A browser's ability to reach the URL does not establish that the DSH process can reach it.
- `UPDATE_INSTALL_FAILED`: read the DSH plugin-manager diagnostic path. Registry failures and pending dependency script approvals require fixing the existing DSH configuration. The updater does not grant build approvals or bypass compatibility checks. Retry only after the reported cause is addressed.
- DSH's failed-install recovery restores profile manifest/lock files; downloaded cache/module files may remain. Do not claim a complete filesystem rollback or restart success from an install result alone. If the new plugin cannot load, use the retained old tgz through the DSH plugin manager/CLI after stopping DSH.

Existing older installations need one manual upgrade to a version supporting these sources. Do not tell a user on an older release to look for the new configuration fields.

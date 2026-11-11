export * from "./release-base.js";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compareVersions, downloadRelease as download, fetchLatestRelease as fetchFrom, normalizeUpdateSettings, readUpdateSettings, writeUpdateSettings } from "./release-base.js";
import { PLUGIN_VERSION } from "./version.js";
import { sessionError } from "./common.js";
import target from "./migration-target.json" with { type: "json" };

export async function fetchLatestRelease(settings, options) {
  const original = normalizeUpdateSettings(settings);
  if (original.source !== "custom") throw sessionError("UPDATE_BRIDGE_SOURCE", "过渡包需要使用原有内网 HTTP/HTTPS 更新源。");
  const advertised = await fetchFrom(original, options);
  const full = advertised.latestVersion === PLUGIN_VERSION
    ? { source: "custom", url: new URL("stable/latest.json", original.url).href }
    : original;
  // The normal channel can advance while old PCs are still migrating.
  const fixed = { source: "custom", url: new URL(`v${target.version}/latest.json`, full.url).href };
  const release = await fetchFrom(fixed, options);
  if (release.latestVersion !== target.version) throw sessionError("UPDATE_BRIDGE_TARGET", `内网完整包清单应指向 v${target.version}，实际为 v${release.latestVersion}。`);
  return { ...release, original, full };
}

// Desktop and Web profiles in the same DSH home share update-settings.json.
async function hasLegacyProfile(root) {
  const profiles = join(dirname(root), "profiles");
  try {
    for (const entry of await readdir(profiles, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      try {
        const path = join(profiles, entry.name, "node_modules/@dsh/remote-ops/package.json");
        const pkg = JSON.parse(await readFile(path, "utf8"));
        if (compareVersions(pkg.version, PLUGIN_VERSION) < 0) return true;
      } catch (error) { if (error.code !== "ENOENT") return true; }
    }
  } catch (error) { if (error.code !== "ENOENT") return true; }
  return false;
}

export async function downloadRelease(release, root, options) {
  const archive = await download(release, root, options);
  if (archive.sha256 !== target.sha256) throw sessionError("UPDATE_CHECKSUM_MISMATCH", "完整包和过渡包中固定的 SHA256 不一致，未执行安装。");
  // Move just this feed to its normal update channel after validating the complete
  // archive. A restart here resumes from the same verified target without another click.
  const current = await readUpdateSettings(root);
  if (current.source === "custom" && current.url === release.full.url) return archive;
  if (current.source !== "custom" || current.url !== release.original.url) throw sessionError("UPDATE_BRIDGE_SOURCE", "下载期间更新源已更改，请重新检查更新。");
  if (!await hasLegacyProfile(root)) await writeUpdateSettings(root, release.full);
  return archive;
}

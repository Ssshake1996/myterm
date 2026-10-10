import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLUGIN_NAME, PLUGIN_VERSION, RELEASE_REPOSITORY } from "./version.js";
import { sessionError } from "./common.js";

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
export const UPDATE_CACHE_MS = 10 * 60 * 1000;

function parseVersion(value) {
  const match = VERSION_RE.exec(String(value ?? "").trim());
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), value: `${match[1]}.${match[2]}.${match[3]}` } : undefined;
}

function compareVersions(left, right) {
  const a = parseVersion(left) ?? { major: 0, minor: 0, patch: 0 };
  const b = parseVersion(right) ?? { major: 0, minor: 0, patch: 0 };
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export async function fetchLatestRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json", "User-Agent": PLUGIN_NAME }, signal: controller.signal });
    if (!response.ok) throw sessionError("UPDATE_CHECK_FAILED", `GitHub release API returned HTTP ${response.status}`);
    const payload = await response.json();
    const version = parseVersion(String(payload.tag_name ?? "").replace(/^dsh-remote-ops-v/, ""));
    if (!version) throw sessionError("UPDATE_METADATA_INVALID", "Latest release tag does not contain a valid plugin version");
    const assetName = `dsh-remote-ops-v${version.value}.tgz`;
    const asset = Array.isArray(payload.assets) ? payload.assets.find((item) => item?.name === assetName && typeof item.browser_download_url === "string") : undefined;
    if (!asset) throw sessionError("UPDATE_ASSET_MISSING", `Latest release does not contain ${assetName}`);
    return { currentVersion: PLUGIN_VERSION, latestVersion: version.value, updateAvailable: compareVersions(version.value, PLUGIN_VERSION) > 0, releaseUrl: payload.html_url, assetUrl: asset.browser_download_url, assetName, publishedAt: payload.published_at ?? null };
  } catch (error) {
    if (error?.name === "AbortError") throw sessionError("UPDATE_CHECK_TIMEOUT", "GitHub release check timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function findProfileRoot() {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let current = resolve(start);
    for (let depth = 0; depth < 10; depth += 1) {
      const manifest = await readFile(join(current, "package.json"), "utf8").then((value) => JSON.parse(value)).catch(() => undefined);
      if (manifest?.dsh?.profile?.bundles && manifest?.dependencies?.["@dsh/remote-ops"]) return current;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw sessionError("UPDATE_PROFILE_NOT_FOUND", "Unable to locate the active DSH profile package.json");
}

export function runPnpm(cwd, args) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const append = (target, chunk) => {
      const value = target + chunk.toString("utf8");
      return value.length > 24_000 ? value.slice(-24_000) : value;
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", reject);
    child.once("close", (code, signal) => resolvePromise({ code: code ?? 1, signal, stdout, stderr }));
  });
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { PLUGIN_NAME, PLUGIN_VERSION, RELEASE_REPOSITORY } from "./version.js";
import { sessionError } from "./common.js";
import { requestFailure } from "./http-diagnostics.js";

export const UPDATE_CACHE_MS = 10 * 60 * 1000;
export const UPDATE_PACKAGE = "@dsh/remote-ops";
export const MAX_UPDATE_BYTES = 64 * 1024 * 1024;
const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
const defaults = { source: "github", url: "" };
const fail = (code, message) => sessionError(code, message);

export function parseReleaseVersion(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw fail("UPDATE_METADATA_INVALID", "仅支持稳定版本号，例如 0.8.1");
  const numbers = value.split(".").map(Number);
  if (!numbers.every(Number.isSafeInteger)) throw fail("UPDATE_METADATA_INVALID", "版本号超出有效范围");
  return numbers;
}

export function compareVersions(left, right) {
  const a = parseReleaseVersion(left), b = parseReleaseVersion(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function httpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw fail("UPDATE_URL_INVALID", "请填写完整的 HTTP 或 HTTPS 更新地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw fail("UPDATE_URL_INVALID", "更新地址需为 HTTP/HTTPS，不能包含账号密码、查询参数或片段");
  return url;
}

export function normalizeUpdateSettings(value = defaults) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !["github", "custom"].includes(value.source)) throw fail("UPDATE_SETTINGS_INVALID", "请选择 GitHub Release 或 HTTP/HTTPS 更新地址");
  if (value.source === "github") return { ...defaults };
  if (typeof value.url !== "string" || value.url.length > 2048) throw fail("UPDATE_URL_INVALID", "请填写更新目录或 latest.json 地址");
  const url = httpUrl(value.url.trim());
  if (!url.pathname.endsWith("/latest.json")) url.pathname = url.pathname.replace(/\/$/, "") + "/latest.json";
  return { source: "custom", url: url.href };
}

export async function readUpdateSettings(root) {
  try { return normalizeUpdateSettings(JSON.parse(await readFile(join(root, "update-settings.json"), "utf8"))); }
  catch (error) {
    if (error.code === "ENOENT") return { ...defaults };
    throw fail("UPDATE_SETTINGS_INVALID", "更新设置无法读取，请在插件更新中重新保存地址");
  }
}

export async function writeUpdateSettings(root, settings) {
  await mkdir(root, { recursive: true });
  const temporary = join(root, `update-settings.${randomUUID()}.tmp`);
  try { await writeFile(temporary, JSON.stringify(settings, null, 2) + "\n"); await rename(temporary, join(root, "update-settings.json")); }
  finally { await unlink(temporary).catch(() => {}); }
}

// Custom sources stay on their configured origin, including redirect hops.
export async function fetchUpdateBytes(address, { limit = 256 * 1024, timeoutMs = 12000, origin, signal, stage = "update-manifest", fetchImpl = fetch } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
  let url = httpUrl(address);
  let status = null, responseSummary = "";
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (origin && url.origin !== origin) throw fail("UPDATE_URL_INVALID", "内网更新文件及重定向必须位于配置地址的同一来源");
      status = null;
      const response = await fetchImpl(url.href, { redirect: "manual", cache: "no-store", signal: combined, headers: { "User-Agent": PLUGIN_NAME, "Cache-Control": "no-cache" } });
      status = response.status;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw fail("UPDATE_DOWNLOAD_FAILED", "更新地址返回了无目标的重定向");
        const next = new URL(location, url);
        // GitHub assets use signed query parameters on HTTPS redirects.
        if (url.protocol === "https:" && next.protocol !== "https:") throw fail("UPDATE_URL_INVALID", "更新下载不能从 HTTPS 降级到 HTTP");
        if (!["http:", "https:"].includes(next.protocol) || next.username || next.password || next.hash) throw fail("UPDATE_URL_INVALID", "无效的更新重定向");
        url = next;
        continue;
      }
      if (!response.ok) {
        // Read a bounded preview even when a proxy returns a large HTML error page.
        const reader = response.body?.getReader(), parts = []; let size = 0;
        try { while (reader && size < 8192) { const { value, done } = await reader.read(); if (done) break; const part = value.subarray(0, 8192 - size); parts.push(part); size += part.length; } }
        finally { await reader?.cancel().catch(() => {}); }
        responseSummary = Buffer.concat(parts).toString("utf8");
        throw fail("UPDATE_DOWNLOAD_FAILED", `更新源返回 HTTP ${response.status}`);
      }
      if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw fail("UPDATE_TOO_LARGE", "更新文件超过大小限制"); }
      const chunks = []; let size = 0;
      if (response.body) for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > limit) throw fail("UPDATE_TOO_LARGE", "更新文件超过大小限制");
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    throw fail("UPDATE_DOWNLOAD_FAILED", "更新地址重定向次数过多");
  } catch (error) {
    const failure = timeout.aborted ? fail("UPDATE_CHECK_TIMEOUT", "访问更新源超时，请检查内网地址和网络连接")
      : signal?.aborted ? fail("UPDATE_CANCELLED", "插件已关闭，更新下载已取消")
      : error.code?.startsWith("UPDATE_") ? error : fail("UPDATE_DOWNLOAD_FAILED", "无法访问更新源，请检查网络、地址及 DSH 主机的证书配置");
    failure.requestFailure = requestFailure({ url: url.href, status, stage, responseSummary, cause: failure.message });
    throw failure;
  }
}

function assetUrl(value, base) {
  if (typeof value !== "string" || !value.trim()) throw fail("UPDATE_METADATA_INVALID", "版本清单缺少安装包或校验文件地址");
  let url;
  try { url = httpUrl(new URL(value, base).href); } catch { throw fail("UPDATE_URL_INVALID", "安装包或校验文件地址无效"); }
  if (url.origin !== new URL(base).origin) throw fail("UPDATE_URL_INVALID", "内网安装包和校验文件必须与版本清单位于同一来源");
  return url.href;
}

export async function fetchLatestRelease(settings = defaults, options = {}) {
  const config = normalizeUpdateSettings(settings), custom = config.source !== "github";
  const origin = config.source === "custom" ? new URL(config.url).origin : undefined;
  const address = custom ? config.url : RELEASE_API;
  const bytes = await fetchUpdateBytes(address, { ...options, origin, stage: "update-manifest" });
  try {
  let payload;
  try { payload = JSON.parse(bytes.toString("utf8")); } catch { throw fail("UPDATE_METADATA_INVALID", "更新入口必须返回 JSON 版本清单"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw fail("UPDATE_METADATA_INVALID", "更新入口必须返回 JSON 对象");
  const version = custom ? payload.version : String(payload.tag_name ?? "").replace(/^dsh-remote-ops-v/, "");
  parseReleaseVersion(version);
  const assetName = `dsh-remote-ops-v${version}.tgz`, checksumName = `SHA256SUMS-dsh-remote-ops-v${version}.txt`;
  let asset, checksum;
  if (custom) {
    if (payload.schemaVersion !== 1 || payload.package !== UPDATE_PACKAGE) throw fail("UPDATE_METADATA_INVALID", "版本清单必须使用 schemaVersion 1 和 @dsh/remote-ops 包名");
    asset = assetUrl(payload.asset, config.url);
    checksum = assetUrl(payload.checksum, config.url);
  } else {
    if (payload.draft || payload.prerelease) throw fail("UPDATE_METADATA_INVALID", "只安装正式稳定版本");
    const find = name => Array.isArray(payload.assets) && payload.assets.find(item => item?.name === name)?.browser_download_url;
    if (!find(assetName) || !find(checksumName)) throw fail("UPDATE_ASSET_MISSING", "Release 缺少 tgz 或 SHA256 校验文件");
    asset = httpUrl(find(assetName)).href; checksum = httpUrl(find(checksumName)).href;
  }
  return { currentVersion: PLUGIN_VERSION, latestVersion: version, updateAvailable: compareVersions(version, PLUGIN_VERSION) > 0, assetUrl: asset, checksumUrl: checksum, assetName, source: config.source, origin };
  } catch (error) {
    error.requestFailure = requestFailure({ url: address, status: 200, stage: "update-manifest", responseSummary: bytes.toString("utf8"), cause: error.message });
    throw error;
  }
}

export function expectedChecksum(text, assetName) {
  const matches = String(text).split(/\r?\n/).map(line => /^([a-f\d]{64})\s+\*?(.+)$/i.exec(line.trim())).filter(match => match && match[2] === assetName);
  if (matches.length !== 1) throw fail("UPDATE_CHECKSUM_INVALID", "SHA256 文件必须包含且仅包含一条与安装包文件名匹配的校验值");
  return matches[0][1].toLowerCase();
}

// Read metadata only; never extract an unverified archive or execute package code.
export function inspectUpdatePackage(bytes, version) {
  let tar;
  try { tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }); } catch { throw fail("UPDATE_PACKAGE_INVALID", "安装包不是有效的 tgz 或解压大小超限"); }
  let manifest;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, "");
    const sizeText = header.subarray(124, 136).toString().replace(/\0.*$/, "").trim();
    const size = /^[0-7]+$/.test(sizeText) ? parseInt(sizeText, 8) : NaN;
    if (!Number.isSafeInteger(size) || offset + 512 + size > tar.length) throw fail("UPDATE_PACKAGE_INVALID", "安装包内容不完整");
    if (name === "package/package.json") {
      if (manifest || size > 128 * 1024 || ![0, 48].includes(header[156])) throw fail("UPDATE_PACKAGE_INVALID", "安装包清单无效或重复");
      try { manifest = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString()); } catch { throw fail("UPDATE_PACKAGE_INVALID", "安装包清单无法解析"); }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (manifest?.name !== UPDATE_PACKAGE || manifest.version !== version || !manifest.dsh?.bundle) throw fail("UPDATE_PACKAGE_INVALID", "安装包名称、版本或 DSH bundle 与更新清单不一致");
  return manifest;
}

export async function downloadRelease(release, root, options = {}) {
  const { onPhase = () => {}, ...network } = options;
  const read = (location, extra) => fetchUpdateBytes(location, { ...network, origin: release.origin, ...extra });
  const checksum = expectedChecksum((await read(release.checksumUrl, { limit: 64 * 1024, stage: "update-checksum" })).toString(), release.assetName);
  onPhase("downloading");
  const bytes = await read(release.assetUrl, { limit: MAX_UPDATE_BYTES, timeoutMs: 120000, stage: "update-package" });
  onPhase("verifying");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== checksum) throw fail("UPDATE_CHECKSUM_MISMATCH", "SHA256 校验失败，未执行安装，请重新上传正确的安装包与校验文件");
  inspectUpdatePackage(bytes, release.latestVersion);
  const directory = join(root, "updates", digest);
  await mkdir(directory, { recursive: true });
  const path = join(directory, release.assetName), temporary = path + "." + randomUUID() + ".tmp";
  try { await writeFile(temporary, bytes); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
  return { path, sha256: digest };
}

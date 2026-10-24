#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { UPDATE_PACKAGE, compareVersions, expectedChecksum, inspectUpdatePackage, MAX_UPDATE_BYTES } from "../lib/release.js";

export async function createUpdateManifest(archive, output) {
  const file = resolve(archive), name = basename(file);
  const match = /^dsh-remote-ops-v(\d+\.\d+\.\d+)\.tgz$/.exec(name);
  if (!match) throw Error("Expected dsh-remote-ops-vX.Y.Z.tgz");
  const version = match[1]; compareVersions(version, version);
  const target = resolve(output ?? resolve(dirname(file), "latest.json"));
  if (basename(target) !== "latest.json") throw Error("Output must be named latest.json");
  const checksum = resolve(dirname(file), `SHA256SUMS-dsh-remote-ops-v${version}.txt`);
  const relativeUrl = value => {
    const path = relative(dirname(target), value);
    if (isAbsolute(path) || path.split(sep).includes("..")) throw Error("Package and checksum must be in the manifest directory or its subdirectories");
    return path.split(sep).map(encodeURIComponent).join("/");
  };
  const bytes = await readFile(file);
  if (bytes.length > MAX_UPDATE_BYTES) throw Error("Package exceeds the updater's 64 MiB limit");
  const expected = expectedChecksum(await readFile(checksum, "utf8"), name);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (expected !== actual) throw Error("SHA256 mismatch; latest.json was not changed");
  inspectUpdatePackage(bytes, version);
  const manifest = { schemaVersion: 1, package: UPDATE_PACKAGE, version, asset: relativeUrl(file), checksum: relativeUrl(checksum) };
  const old = await readFile(target, "utf8").then(JSON.parse).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (old && (old.package !== UPDATE_PACKAGE || compareVersions(old.version, version) > 0)) throw Error("Refusing to replace a newer or different package manifest");
  const temporary = target + "." + randomUUID() + ".tmp";
  try { await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n"); await rename(temporary, target); }
  finally { await unlink(temporary).catch(() => {}); }
  return { path: target, manifest, sha256: actual };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [archive, output, ...extra] = process.argv.slice(2);
  if (!archive || extra.length || archive === "--help") {
    console.log("Usage: node create-update-manifest.mjs <dsh-remote-ops-vX.Y.Z.tgz> [path/to/latest.json]\nKeep the matching SHA256SUMS file beside the tgz. Upload both files before publishing latest.json.");
    if (!archive || extra.length) process.exitCode = 1;
  } else {
    try { const result = await createUpdateManifest(archive, output); console.log(`Created ${result.path}\nVersion: ${result.manifest.version}\nSHA256: ${result.sha256}`); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}

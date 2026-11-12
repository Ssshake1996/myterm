import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { expectedChecksum, inspectUpdatePackage } from "../integrations/dsh-remote-ops/lib/release.js";
import { createUpdateManifest } from "../integrations/dsh-remote-ops/scripts/create-update-manifest.mjs";

const plugin = fileURLToPath(new URL("../integrations/dsh-remote-ops/", import.meta.url));
const packOffline = fileURLToPath(new URL("./pack-dsh-prebundled.py", import.meta.url));
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const bridgeVersions = new Map([["0.15.4", "0.14.2"], ["0.15.5", "0.14.3"], ["0.15.6", "0.14.4"]]);
const asset = version => `dsh-remote-ops-v${version}.tgz`;
const checksum = version => `SHA256SUMS-dsh-remote-ops-v${version}.txt`;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const json = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + "\n");
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, windowsHide: true, encoding: "utf8" });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr || `${command} exited with ${result.status}`);
  return result.stdout;
}

async function build(archive, output) {
  const pkg = JSON.parse(await readFile(join(plugin, "package.json"), "utf8"));
  const target = pkg.version, bridge = bridgeVersions.get(target);
  if (!bridge || basename(archive) !== asset(target)) throw new Error(`Expected the full release archive for this checkout and its SHA256SUMS file.`);
  const bytes = await readFile(archive);
  const hash = digest(bytes);
  if (hash !== expectedChecksum(await readFile(join(dirname(archive), checksum(target)), "utf8"), asset(target))) throw new Error("Full package SHA256 mismatch");
  // The official release includes BOTH supported browser runtimes. A workstation's
  // single-platform npm pack can have the same filename and package version.
  const legacyHook = target === "0.15.4";
  if (legacyHook && hash !== "9c912712cf3d4576620e5342aafba4b20a696e82ca2a835b8de300b9126e0942") throw new Error("Expected the published Windows/Linux v0.15.4 release archive");
  const packed = await inspectUpdatePackage(bytes, target);
  if (!legacyHook) {
    if (packed.scripts?.postinstall) throw new Error("The full package must install without a browser lifecycle hook");
    for (const platform of ["win32", "linux"]) {
      const manifest = JSON.parse(run("tar", ["-xOzf", archive, `package/browser/runtime/${platform}-x64/runtime.json`]));
      if (manifest.platform !== platform || manifest.arch !== "x64" || manifest.playwrightVersion !== packed.dependencies["playwright-core"] ||
          !manifest.files.some(f => f.path === manifest.executable && f.size > 0) || !manifest.files.every(f => /^[0-9a-f]{64}$/.test(f.sha256))) {
        throw new Error(`Missing complete ${platform}-x64 browser manifest`);
      }
    }
  }
  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  for (const path of [output, output + ".zip"]) {
    if (await stat(path).then(() => true, error => { if (error.code !== "ENOENT") throw error; return false; })) throw new Error(`Output already exists: ${path}`);
  }
  const temp = await mkdtemp(join(parent, ".remote-ops-bridge-"));
  try {
    const stage = join(temp, "package"), feed = join(temp, "feed"), stable = join(feed, "stable");
    const fixed = join(stable, `v${target}`);
    await mkdir(stage); await mkdir(fixed, { recursive: true });
    const fullFile = join(fixed, asset(target));
    if (legacyHook) run(python, [packOffline, archive, fullFile]);
    else await cp(archive, fullFile);
    const fullHash = digest(await readFile(fullFile));
    await writeFile(join(fixed, checksum(target)), `${fullHash}  ${asset(target)}\n`);
    const { manifest } = await createUpdateManifest(fullFile);
    await json(join(stable, "latest.json"), { ...manifest, asset: `v${target}/${asset(target)}`, checksum: `v${target}/${checksum(target)}` });
    run("tar", ["-xzf", archive, "-C", temp, "package/desktop/runtime"]);
    for (const entry of ["lib", "locale", "skills", "cordis.patch.yml", "THIRD_PARTY_NOTICES.md"]) {
      await cp(join(plugin, entry), join(stage, entry), { recursive: true, filter: p => !/^client-v\d+\.\d+\.\d+\.js$/.test(basename(p)) });
    }
    const lib = join(stage, "lib");
    await rename(join(lib, "index.js"), join(lib, "workspace.js"));
    await rename(join(lib, "release.js"), join(lib, "release-base.js"));
    for (const name of ["index.js", "release.js"]) await cp(join(plugin, "migration", name), join(lib, name));
    await json(join(lib, "migration-target.json"), { version: target, sha256: fullHash });
    const versionModule = await readFile(join(lib, "version.js"), "utf8");
    await writeFile(join(lib, "version.js"), versionModule.replace(`PLUGIN_VERSION = "${target}"`, `PLUGIN_VERSION = "${bridge}"`));
    const client = (await readFile(join(lib, "client.js"), "utf8")).replaceAll(`"${target}"`, `"${bridge}"`);
    await writeFile(join(lib, "client.js"), client);
    await writeFile(join(lib, `client-v${bridge}.js`), client);
    pkg.version = bridge;
    pkg.exports["./client"] = `./lib/client-v${bridge}.js`;
    delete pkg.scripts; delete pkg.devDependencies; delete pkg.files;
    await json(join(stage, "package.json"), pkg);
    const small = join(feed, asset(bridge));
    run("tar", ["-czf", small, "-C", temp, "package"]);
    const smallBytes = await readFile(small);
    if (smallBytes.length >= 64 * 1024 ** 2) throw new Error("Bridge exceeds the legacy compressed size limit");
    gunzipSync(smallBytes, { maxOutputLength: 128 * 1024 ** 2 });
    await writeFile(join(feed, checksum(bridge)), `${digest(smallBytes)}  ${asset(bridge)}\n`);
    await createUpdateManifest(small);
    const guide = legacyHook ? "DEPLOY.zh-CN.md" : `DEPLOY-${target}.zh-CN.md`;
    await cp(join(plugin, "migration", guide), join(feed, "部署说明.md"));
    const zip = join(temp, "site.zip");
    run(python, ["-m", "zipfile", "-c", zip, "latest.json", asset(bridge), checksum(bridge), "stable", "部署说明.md"], feed);
    await rename(feed, output);
    await rename(zip, output + ".zip");
    console.log(`v${bridge} (${smallBytes.length} bytes) -> v${target}, full SHA256 ${fullHash}\n${output}.zip`);
  } finally {
    if (dirname(temp) === parent && basename(temp).startsWith(".remote-ops-bridge-")) await rm(temp, { recursive: true, force: true });
  }
}

const [archive, output, ...extra] = process.argv.slice(2);
if (!archive || !output || extra.length) throw new Error("Usage: node scripts/build-dsh-upgrade-bridge.mjs <full-vX.Y.Z.tgz> <new-feed-directory>");
await build(resolve(archive), resolve(output));

#!/usr/bin/env node
// Cross-platform release of the dsh-remote-ops plugin: validate -> gate -> pack -> checksum -> commit -> tag -> push,
// then wait for the tag workflow (.github/workflows/release.yml) to publish the GitHub Release and verify its assets.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const ROOT_READMES = ["README.md", "README.en.md"];
const USAGE = "Usage: node scripts/release-dsh-remote-ops.mjs <major.minor.patch> [--dry-run] [--no-push] [--no-wait] [--remote <name>] [--branch <name>] [--wait-minutes <n>]";

export const tagName = (version) => `dsh-remote-ops-v${version}`;
export const artifactName = (version) => `dsh-remote-ops-v${version}.tgz`;
export const checksumName = (version) => `SHA256SUMS-dsh-remote-ops-v${version}.txt`;

// GitHub's list order is not a version comparison. Only promote complete, stable plugin releases.
export function selectLatestReleaseTag(pages) {
  if (!Array.isArray(pages)) throw new Error("Release index must be an array");
  const candidates = pages.flat().flatMap((release) => {
    const match = /^dsh-remote-ops-v(\d+)\.(\d+)\.(\d+)$/.exec(release?.tag_name ?? "");
    if (!match || release.draft !== false || release.prerelease !== false) return [];
    const version = match.slice(1).join(".");
    const assets = Array.isArray(release.assets) ? release.assets : [];
    if (![artifactName(version), checksumName(version)].every(name => assets.some(asset => asset?.name === name && asset.state === "uploaded"))) return [];
    return [{ tag: release.tag_name, parts: match.slice(1).map(BigInt) }];
  });
  candidates.sort((a, b) => {
    for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i] ? -1 : 1;
    return 0;
  });
  if (!candidates.length) throw new Error("No complete stable Remote Ops release found");
  return candidates[0].tag;
}

export function parseArgs(argv) {
  const options = { version: undefined, dryRun: false, push: true, wait: true, remote: "origin", branch: undefined, waitMinutes: 10 };
  const rest = [...argv];
  const value = (flag) => {
    const next = rest.shift();
    if (!next || next.startsWith("--")) throw new Error(`${flag} needs a value\n${USAGE}`);
    return next;
  };
  while (rest.length) {
    const arg = rest.shift();
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-push") options.push = false;
    else if (arg === "--no-wait") options.wait = false;
    else if (arg === "--remote") options.remote = value(arg);
    else if (arg === "--branch") options.branch = value(arg);
    else if (arg === "--wait-minutes") options.waitMinutes = Number(value(arg));
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}\n${USAGE}`);
    else if (options.version === undefined) options.version = arg.replace(/^v/, "");
    else throw new Error(`Unexpected argument: ${arg}\n${USAGE}`);
  }
  if (!VERSION_RE.test(options.version ?? "")) throw new Error(`A version like 1.2.3 is required\n${USAGE}`);
  if (!Number.isFinite(options.waitMinutes) || options.waitMinutes <= 0) throw new Error(`--wait-minutes must be a positive number\n${USAGE}`);
  return options;
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// Every place that carries the version must agree before anything is committed or tagged.
export async function checkVersionFiles(root, version) {
  const plugin = join(root, "integrations", "dsh-remote-ops");
  const problems = [];
  const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);
  const json = (path) => { const text = read(path); try { return text === undefined ? undefined : JSON.parse(text); } catch { return undefined; } };
  const manifest = json(join(plugin, "package.json"));
  if (!manifest) problems.push("integrations/dsh-remote-ops/package.json is missing or unreadable");
  else if (manifest.version !== version) problems.push(`package.json version is ${manifest.version}, expected ${version}`);
  const lock = json(join(plugin, "package-lock.json"));
  if (lock && (lock.version !== version || (lock.packages?.[""]?.version ?? version) !== version)) problems.push(`package-lock.json version is ${lock.version}/${lock.packages?.[""]?.version}, expected ${version}`);
  const versionFile = join(plugin, "lib", "version.js");
  if (!existsSync(versionFile)) problems.push("lib/version.js is missing");
  else {
    const loaded = await import(`${pathToFileURL(versionFile).href}?release=${Date.now()}`);
    if (loaded.PLUGIN_VERSION !== version) problems.push(`lib/version.js PLUGIN_VERSION is ${loaded.PLUGIN_VERSION}, expected ${version}`);
  }
  const client = read(join(plugin, "lib", "client.js"));
  if (client !== undefined && !client.includes(`pluginVersion: "${version}"`)) problems.push(`lib/client.js default pluginVersion is not ${version}`);
  const notes = read(join(root, "docs", "releases", `dsh-remote-ops-v${version}.md`));
  if (notes === undefined) problems.push(`docs/releases/dsh-remote-ops-v${version}.md is missing`);
  else if (!new RegExp(`^# dsh-remote-ops v${version.replace(/\./g, "\\.")}\\s*$`, "m").test(notes)) problems.push(`release notes must have the heading "# dsh-remote-ops v${version}"`);
  for (const path of [...ROOT_READMES, "integrations/dsh-remote-ops/README.md", "integrations/dsh-remote-ops/README.zh-CN.md"]) {
    const text = read(join(root, path));
    if (text === undefined) { problems.push(`${path} is missing`); continue; }
    const installs = [...text.matchAll(/\bdsh\s+plugin\b[^\r\n]*?\badd\s+[^\s`"']*dsh-remote-ops-v(\d+\.\d+\.\d+)\.tgz\b/g)];
    if (!installs.length) problems.push(`${path} versioned install example is missing`);
    for (const match of installs) if (match[1] !== version) problems.push(`${path} install example uses ${match[1]}, expected ${version}`);
    if (ROOT_READMES.includes(path)) {
      const releases = [...text.matchAll(/\brelease-dsh-remote-ops\.ps1\s+-Version\s+(\d+\.\d+\.\d+)\b|\bnode\s+scripts\/release-dsh-remote-ops\.mjs\s+(\d+\.\d+\.\d+)\b/g)];
      if (!releases.length) problems.push(`${path} versioned release example is missing`);
      for (const match of releases) {
        const exampleVersion = match[1] ?? match[2];
        if (exampleVersion !== version) problems.push(`${path} release example uses ${exampleVersion}, expected ${version}`);
      }
    }
  }
  return problems;
}

function execute(command, args, { cwd, capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: process.platform === "win32" && command === "npm", stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"] });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${capture ? `\n${result.stderr ?? ""}` : ""}`);
  return { status: result.status, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

// Native binaries are compiled again by CI. Verify the actual release bytes,
// rather than treating a separately compiled local candidate as byte-identical.
async function verifyPublishedAssets({ repository, version, digest, fetchImpl }) {
  const read = async (name, limit) => {
    const url = `https://github.com/${repository}/releases/download/${tagName(version)}/${name}`;
    const response = await fetchImpl(url, { headers: { "User-Agent": "dsh-remote-ops-release-script" }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Release asset ${name} returned HTTP ${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw Object.assign(new Error(`Release asset ${name} exceeds its size limit`), { fatal: true });
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  };
  const checksum = (await read(checksumName(version), 8192)).toString("utf8").trim();
  const match = /^([a-f0-9]{64})\s+\*?(\S+)$/i.exec(checksum);
  if (!match || match[2] !== artifactName(version)) throw Object.assign(new Error("RELEASE_CHECKSUM_INVALID: expected one checksum for the versioned tgz"), { fatal: true });
  const bytes = await read(artifactName(version), 256 * 1024 * 1024);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== match[1].toLowerCase() || (digest && actual !== digest)) throw Object.assign(new Error("RELEASE_CHECKSUM_MISMATCH: downloaded tgz, checksum file and GitHub digest do not agree"), { fatal: true });
  return actual;
}

// Polls the GitHub Release created by the tag workflow until both assets exist, then compares the tarball digest.
export async function waitForRelease({ repository, version, expectedSha256, verifyPublishedChecksum = false, requiredAssets = [], token, timeoutMs, intervalMs = 10_000, fetchImpl = fetch, log = () => {} }) {
  const tag = tagName(version);
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "dsh-remote-ops-release-script", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const deadline = Date.now() + timeoutMs;
  let lastProblem = "release not created yet";
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, { headers });
      if (response.status === 404) lastProblem = "release not created yet";
      else if (!response.ok) lastProblem = `GitHub API returned HTTP ${response.status}`;
      else {
        const release = await response.json();
        const assets = Array.isArray(release.assets) ? release.assets : [];
        const archive = assets.find((asset) => asset.name === artifactName(version));
        const sums = assets.find((asset) => asset.name === checksumName(version));
        if (release.draft) lastProblem = "release is still a draft";
        else if (!archive || !sums || requiredAssets.some(name => !assets.some(asset => asset.name === name))) lastProblem = `assets incomplete (${assets.map((asset) => asset.name).join(", ") || "none"})`;
        else {
          const digest = typeof archive.digest === "string" ? archive.digest.replace(/^sha256:/, "") : undefined;
          if (digest && expectedSha256 && digest !== expectedSha256) throw Object.assign(new Error(`RELEASE_DIGEST_MISMATCH: published ${digest} but the local package is ${expectedSha256}`), { fatal: true });
          const publishedSha256 = verifyPublishedChecksum ? await verifyPublishedAssets({ repository, version, digest, fetchImpl }) : digest;
          if (expectedSha256 && publishedSha256 && expectedSha256 !== publishedSha256) throw Object.assign(new Error("RELEASE_DIGEST_MISMATCH: downloaded release differs from the local package"), { fatal: true });
          return { url: release.html_url, digestVerified: Boolean(digest), checksumVerified: verifyPublishedChecksum, publishedSha256, assets: assets.map((asset) => asset.name) };
        }
      }
    } catch (error) {
      if (error.fatal) throw error;
      lastProblem = error.message;
    }
    log(`waiting for the release workflow: ${lastProblem}`);
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for release ${tag}: ${lastProblem}. Check the "DSH Remote Ops Release" workflow run.`);
}

function githubToken() {
  const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

export async function runRelease(options, { root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), log = (message) => console.log(message), fetchImpl = fetch, intervalMs = 10_000, npm = (args, cwd, capture) => execute("npm", args, { cwd, capture }) } = {}) {
  const { version } = options;
  const plugin = join(root, "integrations", "dsh-remote-ops");
  const artifactRoot = join(root, "dist-release");
  const git = (args, extra) => execute("git", args, { cwd: root, ...extra });
  const tag = tagName(version);

  log(`dsh-remote-ops release v${version}${options.dryRun ? " (dry run)" : ""}`);
  const problems = await checkVersionFiles(root, version);
  if (problems.length) throw new Error(`Version consistency check failed:\n- ${problems.join("\n- ")}`);
  const branch = options.branch ?? git(["rev-parse", "--abbrev-ref", "HEAD"], { capture: true }).stdout;
  if (branch === "HEAD") throw new Error("HEAD is detached; check out a branch or pass --branch <name>");
  if (!options.dryRun) {
    const foreign = git(["diff", "--cached", "--name-only"], { capture: true }).stdout.split("\n").filter(Boolean);
    const releasePaths = ["integrations/dsh-remote-ops/", "scripts/release-dsh-remote-ops.", ".github/workflows/release.yml", `docs/releases/dsh-remote-ops-v${version}.md`];
    const outside = foreign.filter((file) => !ROOT_READMES.includes(file) && !releasePaths.some((prefix) => file.startsWith(prefix)));
    if (outside.length) throw new Error(`The index already contains changes outside the release set; commit or reset them first:\n- ${outside.join("\n- ")}`);
  }

  log("== Plugin checks (npm run check) ==");
  npm(["run", "check"], plugin);

  mkdirSync(artifactRoot, { recursive: true });
  log("== Package ==");
  const packed = npm(["pack", "--silent", "--pack-destination", artifactRoot], plugin, true).stdout.split("\n").pop().trim();
  const packedPath = join(artifactRoot, packed);
  const artifactPath = join(artifactRoot, artifactName(version));
  if (!existsSync(packedPath)) throw new Error(`Package was not created: ${packedPath}`);
  if (packedPath !== artifactPath) { copyFileSync(packedPath, artifactPath); }
  const digest = sha256File(artifactPath);
  writeFileSync(join(artifactRoot, checksumName(version)), `${digest}  ${artifactName(version)}\n`);
  log(`${artifactName(version)}  sha256 ${digest}`);

  if (options.dryRun) {
    log("Dry run: nothing was committed, tagged or pushed.");
    return { version, tag, digest, artifactPath, dryRun: true };
  }

  git(["diff", "--check"]);
  const releaseSet = [...ROOT_READMES, "integrations/dsh-remote-ops", "scripts/release-dsh-remote-ops.ps1", "scripts/release-dsh-remote-ops.mjs", ".github/workflows/release.yml", `docs/releases/dsh-remote-ops-v${version}.md`].filter((path) => existsSync(join(root, path)));
  git(["add", "--", ...releaseSet]);
  git(["diff", "--cached", "--check"]);
  const staged = git(["diff", "--cached", "--quiet"], { allowFailure: true }).status !== 0;
  if (staged) { git(["commit", "-m", `release: publish dsh-remote-ops v${version}`]); log("Committed release changes."); }
  else log("No release changes to commit.");

  const head = git(["rev-parse", "HEAD"], { capture: true }).stdout;
  const existing = git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], { capture: true, allowFailure: true });
  if (existing.status === 0) {
    if (existing.stdout !== head) throw new Error(`Tag ${tag} already points to ${existing.stdout.slice(0, 12)}, not HEAD ${head.slice(0, 12)}`);
    log(`Tag ${tag} already points at HEAD.`);
  } else {
    git(["tag", "-a", tag, "-m", `dsh-remote-ops v${version}`]);
    log(`Created tag ${tag}.`);
  }

  if (!options.push) {
    log("--no-push: commit and tag exist locally only.");
    return { version, tag, digest, artifactPath, pushed: false };
  }
  git(["push", options.remote, `HEAD:refs/heads/${branch}`]);
  git(["push", options.remote, `refs/tags/${tag}`]);
  const remoteTag = git(["ls-remote", "--tags", options.remote, `refs/tags/${tag}^{}`, `refs/tags/${tag}`], { capture: true }).stdout;
  if (!remoteTag.includes(head)) throw new Error(`The remote does not show tag ${tag} at ${head.slice(0, 12)} after pushing`);
  log(`Pushed ${branch} and ${tag} to ${options.remote}.`);

  if (!options.wait) {
    log("--no-wait: the tag workflow will publish the GitHub Release.");
    return { version, tag, digest, artifactPath, pushed: true };
  }
  const loaded = await import(`${pathToFileURL(join(plugin, "lib", "version.js")).href}?release=${Date.now()}`);
  log("== Waiting for the GitHub Release (published by the tag workflow) ==");
  const nativeBuild = existsSync(join(plugin, "desktop", "runtime", "manifest.json"));
  const release = await waitForRelease({ repository: loaded.RELEASE_REPOSITORY, version, expectedSha256: nativeBuild ? undefined : digest, verifyPublishedChecksum: true, token: githubToken(), timeoutMs: options.waitMinutes * 60_000, intervalMs, fetchImpl, log });
  log(`Release: ${release.url} (downloaded tgz and SHA256 verified: ${release.publishedSha256})`);
  return { version, tag, digest, artifactPath, pushed: true, release };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runRelease(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

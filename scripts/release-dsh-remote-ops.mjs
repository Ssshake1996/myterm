#!/usr/bin/env node
// Cross-platform release of the dsh-remote-ops plugin: validate -> gate -> pack -> checksum -> commit -> tag -> push,
// then wait for the tag workflow (.github/workflows/release.yml) to publish the GitHub Release and verify its assets.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const USAGE = "Usage: node scripts/release-dsh-remote-ops.mjs <major.minor.patch> [--dry-run] [--no-push] [--no-wait] [--remote <name>] [--branch <name>] [--wait-minutes <n>]";

export const tagName = (version) => `dsh-remote-ops-v${version}`;
export const artifactName = (version) => `dsh-remote-ops-v${version}.tgz`;
export const checksumName = (version) => `SHA256SUMS-dsh-remote-ops-v${version}.txt`;

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
  return problems;
}

function execute(command, args, { cwd, capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: process.platform === "win32" && command === "npm", stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"] });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${capture ? `\n${result.stderr ?? ""}` : ""}`);
  return { status: result.status, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

// Polls the GitHub Release created by the tag workflow until both assets exist, then compares the tarball digest.
export async function waitForRelease({ repository, version, expectedSha256, token, timeoutMs, intervalMs = 10_000, fetchImpl = fetch, log = () => {} }) {
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
        else if (!archive || !sums) lastProblem = `assets incomplete (${assets.map((asset) => asset.name).join(", ") || "none"})`;
        else {
          const digest = typeof archive.digest === "string" ? archive.digest.replace(/^sha256:/, "") : undefined;
          if (digest && digest !== expectedSha256) throw Object.assign(new Error(`RELEASE_DIGEST_MISMATCH: published ${digest} but the local package is ${expectedSha256}`), { fatal: true });
          return { url: release.html_url, digestVerified: Boolean(digest), assets: assets.map((asset) => asset.name) };
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
    const releasePaths = ["integrations/dsh-remote-ops/", "scripts/release-dsh-remote-ops.", `docs/releases/dsh-remote-ops-v${version}.md`];
    const outside = foreign.filter((file) => !releasePaths.some((prefix) => file.startsWith(prefix)));
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
  const releaseSet = ["integrations/dsh-remote-ops", "scripts/release-dsh-remote-ops.ps1", "scripts/release-dsh-remote-ops.mjs", `docs/releases/dsh-remote-ops-v${version}.md`].filter((path) => existsSync(join(root, path)));
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
  const release = await waitForRelease({ repository: loaded.RELEASE_REPOSITORY, version, expectedSha256: digest, token: githubToken(), timeoutMs: options.waitMinutes * 60_000, intervalMs, fetchImpl, log });
  log(`Release: ${release.url}${release.digestVerified ? " (asset digest verified)" : " (asset digest not reported by GitHub)"}`);
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

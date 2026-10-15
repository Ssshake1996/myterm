import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_VERSION } from "../lib/version.js";
import { artifactName, checkVersionFiles, checksumName, parseArgs, runRelease, sha256File, tagName, waitForRelease } from "../../../scripts/release-dsh-remote-ops.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const quiet = { log: () => {} };
// Only the main end-to-end test runs the real npm; the others stand in for it so the suite stays fast under parallel load.
const fakeNpm = (args, cwd) => {
  if (args[0] !== "pack") return { stdout: "" };
  const name = `dsh-remote-ops-${JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).version}.tgz`;
  writeFileSync(join(args[args.indexOf("--pack-destination") + 1], name), "fake tarball");
  return { stdout: name };
};
const fast = { ...quiet, npm: fakeNpm };
const options = (extra = {}) => ({ version: "1.2.3", dryRun: false, push: true, wait: false, remote: "origin", branch: undefined, waitMinutes: 1, ...extra });

function writeTree(root, version, { clientVersion = version, notesVersion = version, lockVersion = version, pluginVersion = version } = {}) {
  const plugin = join(root, "integrations", "dsh-remote-ops");
  for (const directory of [join(plugin, "lib"), join(root, "docs", "releases"), join(root, "scripts")]) mkdirSync(directory, { recursive: true });
  writeFileSync(join(plugin, "package.json"), JSON.stringify({ name: "@dsh/remote-ops", version: pluginVersion, type: "module", files: ["lib"], scripts: { check: "node -e \"process.exit(0)\"" } }, null, 2));
  writeFileSync(join(plugin, "package-lock.json"), JSON.stringify({ name: "@dsh/remote-ops", version: lockVersion, lockfileVersion: 3, requires: true, packages: { "": { name: "@dsh/remote-ops", version: lockVersion } } }, null, 2));
  writeFileSync(join(plugin, "lib", "version.js"), `export const PLUGIN_NAME = "dsh-remote-ops";\nexport const PLUGIN_VERSION = "${version}";\nexport const RELEASE_REPOSITORY = "owner/repo";\n`);
  writeFileSync(join(plugin, "lib", "client.js"), `const empty = { pluginVersion: "${clientVersion}" };\n`);
  writeFileSync(join(root, "docs", "releases", `dsh-remote-ops-v${version}.md`), `# dsh-remote-ops v${notesVersion}\n\n- notes\n`);
  writeFileSync(join(root, "scripts", "release-dsh-remote-ops.ps1"), "# wrapper\n");
  const install = `dsh plugin --profile web add ./dsh-remote-ops-v${version}.tgz\n`;
  const release = `powershell -File scripts/release-dsh-remote-ops.ps1 -Version ${version}\nnode scripts/release-dsh-remote-ops.mjs ${version} --dry-run\n`;
  for (const name of ["README.md", "README.en.md"]) writeFileSync(join(root, name), `${install}${release}`);
  for (const name of ["README.md", "README.zh-CN.md"]) writeFileSync(join(plugin, name), install);
}

async function releaseRepo(t, { initial = "1.2.3", ...overrides } = {}) {
  const base = await mkdtemp(join(tmpdir(), "dsh-release-script-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, "repo"), remote = join(base, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  execFileSync("git", ["init", "-q", repo]);
  git(repo, "symbolic-ref", "HEAD", "refs/heads/main");
  git(repo, "config", "user.name", "Release Test");
  git(repo, "config", "user.email", "release@example.invalid");
  // Isolate the fixture from the developer's global git setup (signing programs, file system monitors).
  for (const [key, value] of [["commit.gpgsign", "false"], ["tag.gpgsign", "false"], ["core.fsmonitor", "false"]]) git(repo, "config", key, value);
  writeTree(repo, initial, overrides);
  writeFileSync(join(repo, ".gitignore"), "node_modules/\ndist-release/\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "initial");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "-u", "origin", "main");
  return { repo, remote };
}

test("release arguments are parsed strictly", () => {
  assert.deepEqual(parseArgs(["1.2.3"]), { version: "1.2.3", dryRun: false, push: true, wait: true, remote: "origin", branch: undefined, waitMinutes: 10 });
  assert.equal(parseArgs(["v2.0.1"]).version, "2.0.1");
  const all = parseArgs(["1.2.3", "--dry-run", "--no-push", "--no-wait", "--remote", "upstream", "--branch", "release", "--wait-minutes", "3"]);
  assert.deepEqual({ dry: all.dryRun, push: all.push, wait: all.wait, remote: all.remote, branch: all.branch, minutes: all.waitMinutes }, { dry: true, push: false, wait: false, remote: "upstream", branch: "release", minutes: 3 });
  for (const bad of [[], ["1.2"], ["1.2.3.4"], ["latest"], ["1.2.3", "--bogus"], ["1.2.3", "1.2.4"], ["1.2.3", "--remote"], ["1.2.3", "--branch", "--dry-run"], ["1.2.3", "--wait-minutes", "0"], ["1.2.3", "--wait-minutes", "soon"]]) assert.throws(() => parseArgs(bad), Error, JSON.stringify(bad));
  assert.equal(tagName("1.2.3"), "dsh-remote-ops-v1.2.3");
  assert.equal(artifactName("1.2.3"), "dsh-remote-ops-v1.2.3.tgz");
  assert.equal(checksumName("1.2.3"), "SHA256SUMS-dsh-remote-ops-v1.2.3.txt");
});

test("this repository's version files and release notes agree for the current version", async () => {
  assert.deepEqual(await checkVersionFiles(repositoryRoot, PLUGIN_VERSION), []);
});

test("every place that carries the version is checked", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "dsh-release-check-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const cases = [
    [{ pluginVersion: "1.2.4" }, /package\.json version is 1\.2\.4/],
    [{ lockVersion: "1.2.2" }, /package-lock\.json version/],
    [{ clientVersion: "1.2.2" }, /client\.js default pluginVersion/],
    [{ notesVersion: "1.2.2" }, /release notes must have the heading/],
  ];
  for (const [index, [overrides, pattern]] of cases.entries()) {
    const root = join(base, `case-${index}`);
    writeTree(root, "1.2.3", overrides);
    assert.match((await checkVersionFiles(root, "1.2.3")).join("\n"), pattern);
  }
  const clean = join(base, "clean");
  writeTree(clean, "1.2.3");
  assert.deepEqual(await checkVersionFiles(clean, "1.2.3"), []);
  assert.match((await checkVersionFiles(clean, "1.2.4")).join("\n"), /package\.json version is 1\.2\.3, expected 1\.2\.4/);
  assert.match((await checkVersionFiles(join(base, "empty"), "1.2.3")).join("\n"), /package\.json is missing/);
});

test("README install and release commands cannot point users at an older version", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "dsh-release-readme-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const paths = ["README.md", "README.en.md", "integrations/dsh-remote-ops/README.md", "integrations/dsh-remote-ops/README.zh-CN.md"];
  for (const [index, path] of paths.entries()) {
    const root = join(base, `install-${index}`);
    writeTree(root, "1.2.3");
    const filename = join(root, path);
    // A correct example elsewhere must not conceal one obsolete install command.
    writeFileSync(filename, `${readFileSync(filename, "utf8")}dsh plugin --profile web add .\\dsh-remote-ops-v1.2.2.tgz\n`);
    const problems = await checkVersionFiles(root, "1.2.3");
    assert.ok(problems.some((problem) => problem.includes(path) && /install example.*1\.2\.2/.test(problem)), `${path}: ${problems.join("\n")}`);
  }
  for (const [index, command] of ["powershell -File scripts/release-dsh-remote-ops.ps1 -Version 1.2.2", "node scripts/release-dsh-remote-ops.mjs 1.2.2 --dry-run"].entries()) {
    const root = join(base, `release-${index}`);
    writeTree(root, "1.2.3");
    writeFileSync(join(root, "README.en.md"), `${readFileSync(join(root, "README.en.md"), "utf8")}${command}\n`);
    assert.match((await checkVersionFiles(root, "1.2.3")).join("\n"), /README\.en\.md release example.*1\.2\.2/);
  }
  const historical = join(base, "historical");
  writeTree(historical, "1.2.3");
  writeFileSync(join(historical, "README.md"), `${readFileSync(join(historical, "README.md"), "utf8")}Version 0.2.23 fixed an earlier compatibility issue.\n`);
  assert.deepEqual(await checkVersionFiles(historical, "1.2.3"), [], "historical version descriptions remain valid");
});

test("missing README install examples are reported before a release", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "dsh-release-readme-missing-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  writeTree(base, "1.2.3");
  writeFileSync(join(base, "integrations", "dsh-remote-ops", "README.zh-CN.md"), "# Plugin\n");
  assert.match((await checkVersionFiles(base, "1.2.3")).join("\n"), /README\.zh-CN\.md.*install example.*missing/);
});

test("a release commits, packs, checksums, tags and pushes, and repeating it changes nothing", async (t) => {
  const { repo, remote } = await releaseRepo(t);
  writeFileSync(join(repo, "integrations", "dsh-remote-ops", "lib", "client.js"), 'const empty = { pluginVersion: "1.2.3" };\n// changed for the release\n');
  const result = await runRelease(options(), { root: repo, ...quiet });
  assert.equal(result.pushed, true);
  assert.equal(git(repo, "log", "-1", "--format=%s"), "release: publish dsh-remote-ops v1.2.3");
  assert.equal(git(repo, "tag", "--list", "dsh-remote-ops-v1.2.3"), "dsh-remote-ops-v1.2.3");
  assert.equal(git(repo, "cat-file", "-t", "dsh-remote-ops-v1.2.3"), "tag", "the tag is annotated");
  const head = git(repo, "rev-parse", "HEAD");
  assert.equal(git(remote, "rev-parse", "refs/heads/main"), head);
  assert.equal(git(remote, "rev-list", "-n", "1", "dsh-remote-ops-v1.2.3"), head);
  const archive = join(repo, "dist-release", "dsh-remote-ops-v1.2.3.tgz");
  const sums = readFileSync(join(repo, "dist-release", "SHA256SUMS-dsh-remote-ops-v1.2.3.txt"), "utf8");
  assert.equal(sums, `${sha256File(archive)}  dsh-remote-ops-v1.2.3.tgz\n`);
  assert.equal(result.digest, sha256File(archive));
  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" }).stdout;
  assert.match(listing, /package\/lib\/version\.js/);
  assert.equal(git(repo, "status", "--porcelain", "--", "."), "", "dist-release is ignored or untracked-clean");
  const again = await runRelease(options(), { root: repo, ...quiet });
  assert.equal(git(repo, "rev-parse", "HEAD"), head, "a second run must not create another commit");
  assert.equal(again.digest, result.digest, "the package is reproducible");
  assert.equal(git(remote, "rev-list", "-n", "1", "dsh-remote-ops-v1.2.3"), head);
});

test("a dry run validates, checks and packs but never touches git", async (t) => {
  const { repo, remote } = await releaseRepo(t);
  writeFileSync(join(repo, "integrations", "dsh-remote-ops", "lib", "client.js"), 'const empty = { pluginVersion: "1.2.3" };\n// pending\n');
  const head = git(repo, "rev-parse", "HEAD");
  const result = await runRelease(options({ dryRun: true }), { root: repo, ...fast });
  assert.equal(result.dryRun, true);
  assert.equal(git(repo, "rev-parse", "HEAD"), head);
  assert.equal(git(repo, "tag", "--list"), "");
  assert.equal(git(remote, "tag", "--list"), "");
  assert.match(git(repo, "status", "--porcelain"), /client\.js/, "pending changes stay uncommitted");
  assert.equal(existsSync(join(repo, "dist-release", "dsh-remote-ops-v1.2.3.tgz")), true);
});

test("--no-push leaves the commit and tag local", async (t) => {
  const { repo, remote } = await releaseRepo(t);
  writeFileSync(join(repo, "docs", "releases", "dsh-remote-ops-v1.2.3.md"), "# dsh-remote-ops v1.2.3\n\n- edited\n");
  const result = await runRelease(options({ push: false }), { root: repo, ...fast });
  assert.equal(result.pushed, false);
  assert.equal(git(repo, "tag", "--list"), "dsh-remote-ops-v1.2.3");
  assert.equal(git(remote, "tag", "--list"), "");
  assert.notEqual(git(repo, "rev-parse", "HEAD"), git(remote, "rev-parse", "refs/heads/main"));
});

test("the release commits both staged and unstaged root README updates", async (t) => {
  const { repo } = await releaseRepo(t);
  for (const name of ["README.md", "README.en.md"]) writeFileSync(join(repo, name), `${readFileSync(join(repo, name), "utf8")}\nUpdated navigation and upgrade instructions.\n`);
  git(repo, "add", "README.en.md");
  await runRelease(options({ push: false }), { root: repo, ...fast });
  for (const name of ["README.md", "README.en.md"]) assert.match(git(repo, "show", `HEAD:${name}`), /Updated navigation and upgrade instructions/);
  assert.equal(git(repo, "status", "--porcelain"), "", "README changes must be included in the tagged release");
});

test("inconsistent versions, foreign staged changes, detached HEAD and a conflicting tag abort without side effects", async (t) => {
  const { repo, remote } = await releaseRepo(t, { pluginVersion: "1.2.4" });
  await assert.rejects(runRelease(options(), { root: repo, ...fast }), /Version consistency check failed[\s\S]*package\.json version is 1\.2\.4/);
  assert.equal(git(repo, "tag", "--list"), "");

  const clean = await releaseRepo(t);
  writeFileSync(join(clean.repo, "unrelated.txt"), "x");
  git(clean.repo, "add", "unrelated.txt");
  await assert.rejects(runRelease(options(), { root: clean.repo, ...fast }), /outside the release set[\s\S]*unrelated\.txt/);
  assert.equal(git(clean.repo, "tag", "--list"), "");

  const detached = await releaseRepo(t);
  git(detached.repo, "checkout", "-q", "--detach");
  await assert.rejects(runRelease(options(), { root: detached.repo, ...fast }), /detached/);

  const conflict = await releaseRepo(t);
  git(conflict.repo, "tag", "-a", "dsh-remote-ops-v1.2.3", "-m", "old");
  writeFileSync(join(conflict.repo, "integrations", "dsh-remote-ops", "lib", "client.js"), 'const empty = { pluginVersion: "1.2.3" };\n// newer\n');
  await assert.rejects(runRelease(options(), { root: conflict.repo, ...fast }), /already points to/);
  assert.equal(git(conflict.remote, "tag", "--list"), "", "nothing was pushed");
  assert.equal(git(remote, "tag", "--list"), "");
});

const releaseJson = (extra = {}) => ({ html_url: "https://github.com/owner/repo/releases/tag/dsh-remote-ops-v1.2.3", draft: false, assets: [{ name: "dsh-remote-ops-v1.2.3.tgz", digest: "sha256:abc" }, { name: "SHA256SUMS-dsh-remote-ops-v1.2.3.txt" }], ...extra });
const scripted = (responses) => { const calls = []; const impl = async (url, init) => { calls.push({ url, init }); const next = responses.shift(); if (next instanceof Error) throw next; return { status: next.status ?? 200, ok: (next.status ?? 200) < 400, json: async () => next.body }; }; return { impl, calls }; };
const wait = (fetchImpl, extra = {}) => waitForRelease({ repository: "owner/repo", version: "1.2.3", expectedSha256: "abc", token: "secret", timeoutMs: 2000, intervalMs: 2, fetchImpl, log: () => {}, ...extra });

test("waiting for the release tolerates the workflow lag and verifies the published digest", async () => {
  const { impl, calls } = scripted([{ status: 404 }, { body: releaseJson({ draft: true }) }, { body: releaseJson({ assets: [{ name: "dsh-remote-ops-v1.2.3.tgz", digest: "sha256:abc" }] }) }, { status: 502 }, new Error("socket hang up"), { body: releaseJson() }]);
  const release = await wait(impl);
  assert.equal(release.digestVerified, true);
  assert.equal(release.url, "https://github.com/owner/repo/releases/tag/dsh-remote-ops-v1.2.3");
  assert.equal(calls.length, 6);
  assert.match(calls[0].url, /repos\/owner\/repo\/releases\/tags\/dsh-remote-ops-v1\.2\.3$/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret");
  const anonymous = scripted([{ body: releaseJson() }]);
  await wait(anonymous.impl, { token: undefined });
  assert.equal(Object.hasOwn(anonymous.calls[0].init.headers, "Authorization"), false);
});

test("a published package that differs from the local one fails immediately", async () => {
  const { impl, calls } = scripted([{ body: releaseJson({ assets: [{ name: "dsh-remote-ops-v1.2.3.tgz", digest: "sha256:different" }, { name: "SHA256SUMS-dsh-remote-ops-v1.2.3.txt" }] }) }]);
  await assert.rejects(wait(impl), /RELEASE_DIGEST_MISMATCH: published different but the local package is abc/);
  assert.equal(calls.length, 1, "a mismatch is not retried");
});

test('release accepts the tgz and checksum without requiring a Windows bundle', async () => {
  const {impl,calls}=scripted([{body:releaseJson()}]);
  const result=await wait(impl);
  assert.equal(calls.length,1);assert.deepEqual(result.assets,releaseJson().assets.map(asset=>asset.name));
  const workflow=readFileSync(join(repositoryRoot,'.github','workflows','release.yml'),'utf8');
  assert.match(workflow,/needs: \[package, windows\]/);
  assert.match(workflow,/dist-release\/\*\.tgz[\s\S]*dist-release\/SHA256SUMS-\*\.txt/);
  assert.doesNotMatch(workflow,/build-dsh-remote-ops-windows|dist-release\/\*\.zip/);
  const shared=readFileSync(join(repositoryRoot,'scripts','release-dsh-remote-ops.mjs'),'utf8');
  assert.doesNotMatch(shared,/windows-x64\.zip/);
});

test("a missing GitHub digest is reported as unverified and a release that never appears times out with the reason", async () => {
  const unverified = scripted([{ body: releaseJson({ assets: [{ name: "dsh-remote-ops-v1.2.3.tgz" }, { name: "SHA256SUMS-dsh-remote-ops-v1.2.3.txt" }] }) }]);
  assert.equal((await wait(unverified.impl)).digestVerified, false);
  const never = scripted(Array.from({ length: 500 }, () => ({ status: 404 })));
  await assert.rejects(wait(never.impl, { timeoutMs: 40 }), /Timed out waiting for release dsh-remote-ops-v1\.2\.3: release not created yet/);
  const limited = scripted(Array.from({ length: 500 }, () => ({ status: 403 })));
  await assert.rejects(wait(limited.impl, { timeoutMs: 40 }), /HTTP 403/);
});

test("the PowerShell entry point only delegates to the shared script and the shared script runs the gate", () => {
  const wrapper = readFileSync(join(repositoryRoot, "scripts", "release-dsh-remote-ops.ps1"), "utf8");
  assert.match(wrapper, /release-dsh-remote-ops\.mjs/);
  assert.match(wrapper, /--no-push/);
  assert.doesNotMatch(wrapper, /git push|Invoke-RestMethod|npm run check/);
  const shared = readFileSync(join(repositoryRoot, "scripts", "release-dsh-remote-ops.mjs"), "utf8");
  assert.match(shared, /\["run", "check"\]/);
});

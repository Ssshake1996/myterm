import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const runtime = join(repo, "integrations", "deepseek-harness-runtime");
const pluginRoot = join(repo, "integrations", "dsh-remote-ops");
const findings: string[] = [];
const lock = JSON.parse(readFileSync(join(runtime, "harness.lock.json"), "utf8")) as {
  harnessPackage?: string;
  harnessVersion?: string;
  profile?: string;
  sourceModified?: boolean;
};
const packageJson = JSON.parse(readFileSync(join(runtime, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const patch = readFileSync(join(pluginRoot, "cordis.patch.yml"), "utf8");
const hostPlugin = readFileSync(join(pluginRoot, "lib", "index.js"), "utf8");
const clientPlugin = readFileSync(join(pluginRoot, "lib", "client.js"), "utf8");

if (lock.harnessPackage !== "@deepseek-ai/dsh")
  findings.push("official aggregate DSH package is not pinned");
if (packageJson.dependencies?.["@deepseek-ai/dsh"] !== lock.harnessVersion)
  findings.push("installed DSH range differs from harness.lock.json");
if (packageJson.dependencies?.["@dsh/remote-ops"] !== "file:../dsh-remote-ops")
  findings.push("standalone dsh-remote-ops plugin is not installed as a local package");
if (lock.profile !== "web") findings.push("official Web profile is not selected");
if (lock.sourceModified !== false) findings.push("upstream DSH source must remain unmodified");
if (!patch.includes("@deepseek-ai/dsh-terminal") || !patch.includes("@dsh/remote-ops"))
  findings.push("Cordis patch does not load the terminal service and dsh-remote-ops");
for (const marker of [
  "remote_environment_list",
  "remote_terminal_send",
  "remote_terminal_batch",
  "remote_sftp_list",
])
  if (!hostPlugin.includes(marker)) findings.push(`remote-ops marker is missing: ${marker}`);
if (!clientPlugin.includes("rightbar.session"))
  findings.push("remote operations right sidebar is missing");
for (const path of [
  ["launcher", "start.mjs"],
  ["..", "dsh-remote-ops", "package.json"],
  ["..", "dsh-remote-ops", "lib", "index.js"],
  ["..", "dsh-remote-ops", "lib", "client.js"],
]) {
  if (!existsSync(join(runtime, ...path)))
    findings.push(`runtime file is missing: ${path.join("/")}`);
}

console.log(
  JSON.stringify(
    {
      status: findings.length === 0 ? "PASS" : "FAIL",
      harnessPackage: lock.harnessPackage,
      harnessVersion: lock.harnessVersion,
      profile: lock.profile,
      integration: "official DSH Web UI plus standalone dsh-remote-ops",
      sourceModified: lock.sourceModified,
      findings,
    },
    null,
    2,
  ),
);
if (findings.length > 0) process.exitCode = 1;

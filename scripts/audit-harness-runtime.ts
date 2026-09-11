import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const runtime = join(repo, "integrations", "deepseek-harness-runtime");
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
const patch = readFileSync(join(runtime, "bridge", "cordis.patch.yml"), "utf8");
const hostPlugin = readFileSync(join(runtime, "bridge", "lib", "index.js"), "utf8");
const clientPlugin = readFileSync(join(runtime, "bridge", "lib", "client.js"), "utf8");

if (lock.harnessPackage !== "@deepseek-ai/dsh")
  findings.push("official aggregate DSH package is not pinned");
if (packageJson.dependencies?.["@deepseek-ai/dsh"] !== lock.harnessVersion)
  findings.push("installed DSH range differs from harness.lock.json");
if (packageJson.dependencies?.["@myterm/dsh-bridge"] !== "file:bridge")
  findings.push("external myterm bridge is not installed as a local package");
if (lock.profile !== "web") findings.push("official Web profile is not selected");
if (lock.sourceModified !== false) findings.push("upstream DSH source must remain unmodified");
if (!patch.includes("@myterm/dsh-bridge")) findings.push("Cordis patch does not load the bridge");
for (const marker of ["myterm_ssh_environments", "myterm_ssh_cli", "myterm_ssh_exec"])
  if (!hostPlugin.includes(marker)) findings.push(`host bridge marker is missing: ${marker}`);
if (!clientPlugin.includes("conversation.input.dock"))
  findings.push("conversation environment-binding dock is missing");
for (const path of [
  ["launcher", "start.mjs"],
  ["bridge", "package.json"],
  ["bridge", "lib", "index.js"],
  ["bridge", "lib", "client.js"],
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
      integration: "official DSH Web UI plus an external authenticated myterm SSH bridge",
      sourceModified: lock.sourceModified,
      findings,
    },
    null,
    2,
  ),
);
if (findings.length > 0) process.exitCode = 1;

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const runtime = join(repo, "integrations", "deepseek-harness-runtime");
const findings: string[] = [];
const lock = JSON.parse(readFileSync(join(runtime, "harness.lock.json"), "utf8")) as {
  harnessVersion?: string;
  acpProtocolVersion?: number;
  excludedSurfaces?: string[];
  enabledToolPacks?: string[];
};
const packageJson = JSON.parse(readFileSync(join(runtime, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const profile = readFileSync(join(runtime, "profile", "cordis.yml"), "utf8");

for (const [name, version] of Object.entries(packageJson.dependencies ?? {})) {
  if (name.startsWith("@deepseek-ai/dsh-") && version !== lock.harnessVersion) {
    findings.push(`${name} is ${version}; expected pinned Harness version ${lock.harnessVersion}`);
  }
}
for (const surface of ["web", "tui", "headless-cli", "telemetry"]) {
  if (!lock.excludedSurfaces?.includes(surface))
    findings.push(`excluded surface is missing: ${surface}`);
}
for (const toolPack of ["harness-local", "myterm-ssh-mcp", "external-mcp"]) {
  if (!lock.enabledToolPacks?.includes(toolPack))
    findings.push(`required tool pack is missing: ${toolPack}`);
}
for (const marker of [
  "@deepseek-ai/dsh-acp",
  "@deepseek-ai/dsh-agent-loop",
  "@deepseek-ai/dsh-compaction-basic",
  "@deepseek-ai/dsh-goal",
  "@deepseek-ai/dsh-llm-deepseek",
  "@deepseek-ai/dsh-skill-filesystem",
  "@deepseek-ai/dsh-tool-pwsh",
  "@deepseek-ai/dsh-tool-fs",
]) {
  if (!profile.includes(marker)) findings.push(`profile plugin is missing: ${marker}`);
}
if (!profile.includes("MYTERM_HARNESS_DEEPSEEK_CONFIG_JSON"))
  findings.push("DeepSeek provider config injection is missing");
if (!profile.includes("provider: deepseek-official"))
  findings.push("ACP does not use the native deepseek-official route");
if (!profile.includes("MYTERM_HARNESS_SYSTEM_PROMPT"))
  findings.push("system prompt injection is missing");
if (!profile.includes("MYTERM_HARNESS_SKILL_DIRS_JSON"))
  findings.push("Skill directory injection is missing");
if (lock.acpProtocolVersion !== 1)
  findings.push(`unsupported ACP protocol: ${lock.acpProtocolVersion}`);
if (!existsSync(join(runtime, "launcher", "start.mjs"))) findings.push("ACP launcher is missing");

const report = {
  status: findings.length === 0 ? "PASS" : "FAIL",
  harnessVersion: lock.harnessVersion,
  acpProtocolVersion: lock.acpProtocolVersion,
  excludedSurfaces: lock.excludedSurfaces,
  enabledToolPacks: lock.enabledToolPacks,
  note: "Official DeepSeek Harness and dsh-llm-deepseek own model networking. myterm adds only a loopback authenticated Streamable HTTP MCP bridge for host tools.",
  findings,
};

console.log(JSON.stringify(report, null, 2));
if (findings.length > 0) process.exitCode = 1;

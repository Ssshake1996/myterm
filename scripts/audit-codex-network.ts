import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const integration = join(repo, "integrations", "dsh-codex-agent");
const productionRoots = [join(integration, "src"), join(integration, "native", "src")];
const findings: string[] = [];

const forbiddenSourceMarkers: Array<[string, RegExp]> = [
  ["OpenAI public API URL", /api\.openai\.com/i],
  ["ChatGPT URL", /chatgpt\.com/i],
  ["remote compaction", /compact_remote|remote_compaction/i],
  ["telemetry/OTEL", /opentelemetry|\botel\b|telemetry exporter/i],
  ["analytics/feedback upload", /analytics|response-debug-context|feedback upload/i],
  ["keyring", /\bkeyring\b/i],
  ["stdio MCP", /StdioClientTransport|TokioChildProcess|transport-child-process/i],
  ["cloud task", /cloud[-_]tasks?/i],
  ["remote control/model/plugin", /remote[-_](control|models?|plugins?)/i],
  ["forbidden execution subsystem", /shell[-_]escalation|exec[-_]server|unified[-_]exec/i],
  ["Responses/Realtime transport", /ResponsesWebSocket|responses websocket|realtime conversation/i],
  ["browser/computer/image capability", /browser use|computer use|image generation/i],
];

for (const file of walk(productionRoots)) {
  const content = readFileSync(file, "utf8");
  for (const [label, pattern] of forbiddenSourceMarkers) {
    if (pattern.test(content)) findings.push(`${label}: ${relative(repo, file)}`);
  }
}

const allowedNetworkCalls = new Map<string, string>([
  [
    normalize(join(integration, "native", "src", "chat_completions_transport.rs")),
    "intranet Chat Completions + compaction",
  ],
  [normalize(join(integration, "src", "mcp-http.ts")), "explicit allowlisted Streamable HTTP MCP"],
  [normalize(join(integration, "src", "web-search-http.ts")), "explicit fixed-endpoint Web Search"],
]);
const networkCallPatterns = [
  /reqwest::Client::builder/,
  /\.post\(/,
  /\bfetch\(/,
  /new StreamableHTTPClientTransport/,
];
const observedNetworkFiles = new Set<string>();
for (const file of walk(productionRoots)) {
  const content = readFileSync(file, "utf8");
  if (networkCallPatterns.some((pattern) => pattern.test(content))) {
    const normalized = normalize(file);
    observedNetworkFiles.add(normalized);
    if (!allowedNetworkCalls.has(normalized)) {
      findings.push(`unclassified HTTP client call: ${relative(repo, file)}`);
    }
  }
}
for (const file of allowedNetworkCalls.keys()) {
  if (!observedNetworkFiles.has(file))
    findings.push(`expected network call point is missing: ${relative(repo, file)}`);
}

const packageJson = JSON.parse(readFileSync(join(integration, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const productionPackages = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
];
const forbiddenPackages = [
  "dsh-code-runtime",
  "telemetry",
  "opentelemetry",
  "keyring",
  "@openai/codex",
];
for (const dependency of productionPackages) {
  if (forbiddenPackages.some((marker) => dependency.toLowerCase().includes(marker))) {
    findings.push(`forbidden production package: ${dependency}`);
  }
}

const cargoLock = readFileSync(join(integration, "native", "Cargo.lock"), "utf8");
const cargoPackages = [...cargoLock.matchAll(/^name = "([^"]+)"$/gm)].map((match) => match[1]);
for (const dependency of cargoPackages) {
  if (/opentelemetry|keyring|codex-cloud|git2|webbrowser/i.test(dependency)) {
    findings.push(`forbidden native dependency: ${dependency}`);
  }
}

const artifactMarkers: Array<[string, RegExp]> = [
  ["OpenAI public API URL", /api\.openai\.com/i],
  ["ChatGPT URL", /chatgpt\.com/i],
  ["remote compaction", /compact_remote|remote_compaction/i],
  ["telemetry/OTEL", /opentelemetry|harness-telemetry/i],
  ["keyring", /\bkeyring\b/i],
  ["stdio MCP", /StdioClientTransport|TokioChildProcess/i],
  ["cloud/remote control", /cloud[-_]tasks?|remote[-_]control/i],
];
const artifactRoots = [join(integration, "lib"), join(integration, "native-dist")];
for (const file of walkExisting(artifactRoots)) {
  if (!/\.(?:js|node)$/.test(file)) continue;
  const content = readFileSync(file).toString("latin1");
  for (const [label, pattern] of artifactMarkers) {
    if (pattern.test(content)) findings.push(`${label} in built artifact: ${relative(repo, file)}`);
  }
}

const patch = readFileSync(join(integration, "cordis.patch.yml"), "utf8");
const requiredDisabledRows = [
  "agent-loop",
  "compaction-basic",
  "subagent",
  "session-telemetry-otel",
  "credentials",
  "llm-deepseek",
  "llm-pi-ai",
  "web-search-deepseek",
  "code-runtime",
];
for (const id of requiredDisabledRows) {
  const row = new RegExp(`- id: ${escapeRegExp(id)}\\r?\\n  disabled: true`);
  if (!row.test(patch)) findings.push(`Harness competing/remote row is not disabled: ${id}`);
}

const runtime = readFileSync(join(integration, "native", "src", "runtime.rs"), "utf8");
if (!/const COMPACTION_MAX_RETRIES: usize = 3;/.test(runtime)) {
  findings.push("compaction retry policy is not exactly three retries");
}
if (!/COMPACTION_RETRY_DELAYS_MS[^=]*= \[100, 250, 500\]/s.test(runtime)) {
  findings.push("compaction retry backoff is not 100/250/500ms");
}

const report = {
  status: findings.length === 0 ? "PASS" : "FAIL",
  productionScope: relative(repo, integration),
  allowedNetworkExits: [...allowedNetworkCalls.entries()].map(([file, purpose]) => ({
    file: relative(repo, file),
    purpose,
  })),
  productionPackages: productionPackages.sort(),
  nativePackageCount: cargoPackages.length,
  artifactScope: artifactRoots.map((path) => relative(repo, path)),
  findings,
};

console.log(JSON.stringify(report, null, 2));
if (findings.length > 0) process.exitCode = 1;

function walk(roots: string[]): string[] {
  const files: string[] = [];
  for (const root of roots) visit(root, files);
  return files.filter((file) => /\.(?:rs|ts)$/.test(file));
}

function walkExisting(roots: string[]): string[] {
  return walk(
    roots.filter((root) => {
      try {
        statSync(root);
        return true;
      } catch {
        return false;
      }
    }),
  );
}

function visit(path: string, files: string[]): void {
  const stat = statSync(path);
  if (stat.isFile()) {
    files.push(path);
    return;
  }
  for (const entry of readdirSync(path)) visit(join(path, entry), files);
}

function normalize(path: string): string {
  return resolve(path).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

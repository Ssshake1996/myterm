import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PLUGIN_VERSION } from "../../integrations/dsh-remote-ops/lib/version.js";
import { startApp } from "../harness/server.mjs";
import { scenarios } from "../scenarios/index.mjs";
import { renderHtml, renderJUnit, renderMarkdown, summarize } from "./report.mjs";

const root = new URL("..", import.meta.url);

function commit() {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: fileUrl(root), encoding: "utf8" }).trim(); } catch { return null; }
}
function fileUrl(url) { return url.pathname; }

function parseArgs(argv) {
  const options = { list: false, grep: "", output: "" };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    if (arg === "--list") options.list = true;
    else if (arg === "--grep") options.grep = rest.shift() ?? "";
    else if (arg === "--output") options.output = rest.shift() ?? "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function shot(page, directory, name) {
  const safe = name.replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/^-|-$/g, "") || "shot";
  const file = join(directory, `${safe}.png`);
  const buffer = await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
  return { name, file, dataUrl: `data:image/png;base64,${buffer.toString("base64")}` };
}

async function runScenario(browser, scenario, directory) {
  const home = join(tmpdir(), `remote-ops-e2e-${scenario.id}-${Date.now()}`);
  await mkdir(home, { recursive: true });
  const app = await startApp({ home });
  const context = await browser.newContext({ baseURL: app.url, viewport: scenario.viewport ?? { width: 1280, height: 800 } });
  const page = await context.newPage();
  const steps = [];
  const shots = [];
  const problems = [];
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) problems.push({ kind: "console", text: message.text() }); });
  page.on("response", (response) => { if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) problems.push({ kind: "http", text: `${response.status()} ${response.url()}` }); });
  page.on("pageerror", (error) => problems.push({ kind: "pageerror", text: String(error) }));
  page.on("dialog", async (dialog) => { if (dialog.type() === "prompt") await dialog.dismiss(); else await dialog.accept(); });
  const started = Date.now();
  const t = {
    page,
    info: async () => page.evaluate(async () => fetch("/e2e/info").then((response) => response.json())),
    acceptNextDialog() {},
    async shot(name) { shots.push(await shot(page, directory, `${scenario.id}-${shots.length + 1}-${name}`)); },
    async step(name, action) {
      const stepStarted = Date.now();
      try {
        await action();
        steps.push({ name, status: "passed", durationMs: Date.now() - stepStarted });
        shots.push(await shot(page, directory, `${scenario.id}-${shots.length + 1}-${name}`));
      } catch (error) {
        steps.push({ name, status: "failed", durationMs: Date.now() - stepStarted });
        try { shots.push(await shot(page, directory, `${scenario.id}-failed-${name}`)); } catch { /* page may already be closed */ }
        throw error;
      }
    },
  };
  let status = "passed";
  let error = "";
  try {
    await page.goto(app.url, { waitUntil: "domcontentloaded" });
    await page.locator("html[data-e2e-ready=true]").waitFor();
    shots.push(await shot(page, directory, `${scenario.id}-打开`));
    await scenario.run(t);
    if (problems.length) throw new Error(problems.map((problem) => `${problem.kind}: ${problem.text}`).join("\n"));
  } catch (caught) {
    status = "failed";
    error = caught?.stack ?? String(caught);
    try { shots.push(await shot(page, directory, `${scenario.id}-失败`)); } catch { /* ignore */ }
  } finally {
    await context.close().catch(() => {});
    await app.close().catch(() => {});
  }
  return { id: scenario.id, title: scenario.title, status, error, durationMs: Date.now() - started, steps, shots, problems };
}

export async function runSuite(options = {}) {
  const selected = scenarios.filter((scenario) => !options.grep || `${scenario.id} ${scenario.title}`.includes(options.grep));
  if (!selected.length) throw new Error(`No scenario matches ${options.grep}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = options.output || join(fileUrl(root), "..", "output", "e2e", stamp);
  await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const browserVersion = browser.version();
  const started = Date.now();
  const results = [];
  try {
    for (const scenario of selected) results.push(await runScenario(browser, scenario, directory));
  } finally {
    await browser.close().catch(() => {});
  }
  const report = { pluginVersion: PLUGIN_VERSION, commit: commit(), browser: browserVersion, layer: "仿宿主（真实 client.js + 真实插件 + 假设备）", startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, results };
  await writeFile(join(directory, "report.json"), JSON.stringify(report, (key, value) => key === "dataUrl" ? undefined : value, 2));
  await writeFile(join(directory, "report.md"), renderMarkdown(report));
  await writeFile(join(directory, "report.html"), renderHtml(report));
  await writeFile(join(directory, "junit.xml"), renderJUnit(report));
  return { report, directory, summary: summarize(results) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    for (const scenario of scenarios) console.log(`${scenario.id}\t${scenario.title}`);
    process.exit(0);
  }
  const { report, directory, summary } = await runSuite(options);
  console.log(`${summary.ok ? "passed" : "failed"} ${summary.passed}/${summary.total}`);
  console.log(directory);
  console.log(renderMarkdown(report));
  process.exit(summary.ok ? 0 : 1);
}

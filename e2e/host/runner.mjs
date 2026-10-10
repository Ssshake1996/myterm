import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { PLUGIN_VERSION } from "../../integrations/dsh-remote-ops/lib/version.js";
import { startFakeDevice } from "../harness/fake-device.mjs";
import { renderHtml, renderJUnit, renderMarkdown, summarize } from "../runner/report.mjs";
import { redactLaunchOutput } from "./url.mjs";
import { installPlugin, nodeForHost, startWeb } from "./launch.mjs";
import { dismissHostChrome, hostScenarios } from "./scenarios.mjs";

const root = new URL("..", import.meta.url);
const pluginDir = fileUrl(new URL("../../integrations/dsh-remote-ops/", import.meta.url));
const dshPath = fileUrl(new URL("./node_modules/@deepseek-ai/dsh/lib/bin.js", import.meta.url));

function fileUrl(url) { return url instanceof URL ? url.pathname : url; }

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

function commit() {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: fileUrl(new URL("../..", import.meta.url)), encoding: "utf8" }).trim(); } catch { return null; }
}

function packPlugin(destination) {
  return new Promise((resolve, reject) => {
    execFile("npm", ["pack", "--silent", "--pack-destination", destination], { cwd: pluginDir }, (error, stdout) => {
      if (error) reject(error);
      else resolve(join(destination, stdout.trim().split("\n").pop()));
    });
  });
}

async function shot(page, directory, name) {
  const safe = name.replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/^-|-$/g, "") || "shot";
  const file = join(directory, `${safe}.png`);
  const buffer = await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
  return { name, file, dataUrl: `data:image/png;base64,${buffer.toString("base64")}` };
}

async function runScenario(browser, scenario, directory, target) {
  const context = await browser.newContext({
    baseURL: target.origin,
    viewport: scenario.viewport ?? { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
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
    device: target.device,
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
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    await dismissHostChrome(page);
    shots.push(await shot(page, directory, `${scenario.id}-打开`));
    await scenario.run(t);
    if (problems.length) throw new Error(problems.map((problem) => `${problem.kind}: ${problem.text}`).join("\n"));
  } catch (caught) {
    status = "failed";
    error = caught?.stack ?? String(caught);
    try {
      const aria = await page.locator("body").ariaSnapshot().catch(() => "");
      await writeFile(join(directory, `${scenario.id}-aria.txt`), aria);
      shots.push(await shot(page, directory, `${scenario.id}-失败`));
    } catch { /* ignore */ }
  } finally {
    await context.close().catch(() => {});
  }
  return { id: scenario.id, title: scenario.title, status, error, durationMs: Date.now() - started, steps, shots, problems };
}

export async function runHostSuite(options = {}) {
  const selected = hostScenarios.filter((scenario) => !options.grep || `${scenario.id} ${scenario.title}`.includes(options.grep));
  if (!selected.length) throw new Error(`No scenario matches ${options.grep}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = options.output || join(fileUrl(root), "..", "output", "e2e-host", stamp);
  await mkdir(directory, { recursive: true });
  const home = await mkdtemp(join(tmpdir(), "dsh-host-e2e-"));
  const packDir = await mkdtemp(join(tmpdir(), "dsh-host-pack-"));
  const nodePath = nodeForHost();
  const lines = [];
  const log = (text) => { lines.push(text); };
  let web;
  let device;
  let browser;
  let browserVersion = "";
  const started = Date.now();
  const results = [];
  try {
    const tarball = await packPlugin(packDir);
    device = await startFakeDevice();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    browserVersion = browser.version();
    await installPlugin({ home, pluginTarball: tarball, nodePath, dshPath, log });
    web = await startWeb({ home, nodePath, dshPath, log });
    for (const scenario of selected) results.push(await runScenario(browser, scenario, directory, { ...web, device }));
  } finally {
    await browser?.close().catch(() => {});
    await web?.close().catch(() => {});
    await device?.close().catch(() => {});
    await writeFile(join(directory, "host.log"), redactLaunchOutput(lines.join("")));
    await rm(home, { recursive: true, force: true });
    await rm(packDir, { recursive: true, force: true });
  }
  const report = { pluginVersion: PLUGIN_VERSION, commit: commit(), browser: browserVersion, layer: "完整 DSH 宿主 0.2.0-rc.2（真实 client.js + 真实插件 + 假设备）", startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, results };
  await writeFile(join(directory, "report.json"), JSON.stringify(report, (key, value) => key === "dataUrl" ? undefined : value, 2));
  await writeFile(join(directory, "report.md"), renderMarkdown(report));
  await writeFile(join(directory, "report.html"), renderHtml(report));
  await writeFile(join(directory, "junit.xml"), renderJUnit(report));
  return { report, directory, summary: summarize(results) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    for (const scenario of hostScenarios) console.log(`${scenario.id}\t${scenario.title}`);
    process.exit(0);
  }
  const { report, directory, summary } = await runHostSuite(options);
  console.log(`${summary.ok ? "passed" : "failed"} ${summary.passed}/${summary.total}`);
  console.log(directory);
  console.log(renderMarkdown(report));
  process.exit(summary.ok ? 0 : 1);
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs";

const [desktopDir, oldPackage, feedDir, outputDir] = process.argv.slice(2, 6).map(arg => resolve(arg));
const scenario = process.argv[6] ?? "normal";
if (!outputDir || !["normal", "direct", "retry", "tamper", "resume", "sibling"].includes(scenario)) throw new Error("Usage: node upgrade-bridge-native.mjs <Windows Desktop dir> <installed-version.tgz> <feed> <output parent> [normal|direct|retry|tamper|resume|sibling]");
const oldVersion = /^dsh-remote-ops-v(\d+\.\d+\.\d+)\.tgz$/.exec(basename(oldPackage))?.[1];
assert.ok(oldVersion, "expected a versioned legacy package");
const readManifest = async path => JSON.parse(await readFile(join(feedDir, path), "utf8"));
const { version: bridgeVersion } = await readManifest("latest.json");
const { version: targetVersion } = await readManifest("stable/latest.json");
assert.match(bridgeVersion, /^\d+\.\d+\.\d+$/);
assert.match(targetVersion, /^\d+\.\d+\.\d+$/);
const nextVersion = targetVersion.replace(/\d+$/, patch => String(Number(patch) + 1));
await mkdir(outputDir, { recursive: true });
const out = await mkdtemp(join(outputDir, "native-")), home = join(out, "home"), profile = join(home, "profiles/desktop");
const resources = join(desktopDir, "resources"), runtime = join(resources, "app.asar/dsh"), primary = join(resources, "runtime/primary-runtime");
const executable = join(desktopDir, "DeepSeek Harness.exe"), entry = join(runtime, "node_modules/@deepseek-ai/dsh-desktop-host/lib");
const runtimeInfo = JSON.parse(await readFile(join(primary, "runtime.json"), "utf8"));
const env = { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: "1", DSH_CLIENT_VERSION: runtimeInfo.desktopVersion, DSH_TELEMETRY_DISABLED: "1", BRIDGE_TEST_KEY: "local-fixture" };
const receipt = { desktop: runtimeInfo.desktopVersion, node: runtimeInfo.node, scenario, oldVersion, clicks: 0, states: [], downloads: [], browserVisits: 0 };
const files = new Map();
for (const prefix of ["", "stable/", `stable/v${targetVersion}/`]) {
  const name = prefix + "latest.json", manifest = await readManifest(name);
  for (const item of [name, prefix + manifest.asset, prefix + manifest.checksum]) files.set("/feed/" + item, join(feedDir, item));
}
const frozenManifest = `/feed/stable/v${targetVersion}/latest.json`;
let injected = false;
const server = createServer(async (req, res) => {
  if (req.url === "/v1/chat/completions") {
    req.resume();
    res.writeHead(200, {"Content-Type":"text/event-stream"});
    res.end('data: '+JSON.stringify({id:"fixture",object:"chat.completion.chunk",model:"test",choices:[{index:0,delta:{role:"assistant",content:"Ready"},finish_reason:"stop"}]})+'\n\ndata: [DONE]\n\n');
    return;
  }
  if (req.url === "/browser-proof") {receipt.browserVisits++;res.writeHead(200,{"Content-Type":"text/html"}).end("<title>Migration OK</title><h1>BRIDGE_BROWSER_OK</h1>");return;}
  const file = files.get(req.url);
  if (!file) { res.writeHead(404).end(); return; }
  receipt.downloads.push(req.url);
  if (scenario === "retry" && req.url === frozenManifest && !injected) {
    injected = true;
    res.writeHead(503).end("A temporary interruption");
    return;
  }
  if (scenario === "retry" && req.url === "/feed/stable/latest.json") {
    const next = JSON.parse(await readFile(file, "utf8"));
    res.writeHead(200).end(JSON.stringify({ ...next, version: nextVersion }));
    return;
  }
  if (scenario === "tamper" && req.url.endsWith(`/dsh-remote-ops-v${targetVersion}.tgz`)) {
    injected = true;
    res.writeHead(200).end("damaged archive");
    return;
  }
  if (scenario === "resume" && req.url === frozenManifest && !injected) {
    // Keep stage two in flight until the test restarts the host.
    injected = true;
    return;
  }
  res.writeHead(200, { "Content-Length": (await stat(file)).size });
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const source = `http://127.0.0.1:${server.address().port}/feed/${scenario === "direct" ? "stable/" : ""}latest.json`;
const wait = async (fn, ms = 120000) => {
  const until = Date.now() + ms;
  do { const value = await fn(); if (value) return value; await delay(220); } while (Date.now() < until);
  throw new Error("Timed out waiting for " + String(fn).slice(0, 120));
};
let host, browser, page, url, fatal, owner;
const logs = [];
const log = name => { const stream = createWriteStream(join(out, name)); logs.push(stream); return stream; };
async function startHost(attempt) {
  url = undefined;
  fatal = undefined;
  const hostEnv = { ...env, npm_config_offline: "true" };
  host = spawn(executable, ["--expose-internals", join(entry, "index.js"), runtime, profile, primary, join(primary, "dependencies/pnpm/bin/pnpm.mjs"), join(resources, "runtime/bin")], { cwd: profile, env: hostEnv, stdio: ["ignore","pipe","pipe","ipc"], windowsHide: true });
  host.stdout.pipe(log(attempt + ".out")); host.stderr.pipe(log(attempt + ".err"));
  host.on("message", message => { if (message.type === "ready") url = message.url; if (message.type === "fatal") fatal = message.message; });
  await wait(() => { if (fatal || host.exitCode !== null) throw Error(fatal || "Desktop host exited"); return url; });
}
try {
  await mkdir(profile, { recursive: true }); await mkdir(join(home, "remote-ops"), { recursive: true });
  await writeFile(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-desktop", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@dsh/remote-ops"] } } }));
  await writeFile(join(profile, "cordis.yml"), "[]\n");
  await writeFile(join(profile, "cordis.patch.yml"), `- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: 2026-09-28.1\n- id: agent-default-model\n  config:\n    provider: bridge-fixture\n    model: test\n- id: llm-pi-ai\n  config:\n    providers:\n      bridge-fixture:\n        api: openai-completions\n        baseURL: ${new URL(source).origin}/v1\n        apiKeyEnv: BRIDGE_TEST_KEY\n        models:\n          - id: test\n            name: Bridge fixture\n            contextWindow: 262144\n            maxTokens: 4096\n`);
  // Model an already installed legacy profile. Neither migration artifact is preapproved.
  await writeFile(join(profile, "pnpm-workspace.yaml"), 'allowBuilds:\n  "cpu-features@0.0.10": true\n  "ssh2@1.17.0": true\n  "@serialport/bindings-cpp@13.0.0": true\n');
  const install = spawn(executable, ["--expose-internals", join(entry, "cli.js"), "plugin", "--profile", "desktop", "add", oldPackage], { env, windowsHide: true });
  const installLog = log("seed.log"); install.stdout.pipe(installLog, { end: false }); install.stderr.pipe(installLog, { end: false });
  assert.equal(await new Promise((r, reject) => { install.once("error", reject); install.once("close", r); }), 0, "could not seed old package");
  await writeFile(join(home, "remote-ops/update-settings.json"), JSON.stringify({source:"custom", url:source}));
  const envDir = join(home, "remote-ops/environments/default"), knownEnv = '[{"id":"retained","name":"保留配置","group":"default","transport":"telnet","host":"127.0.0.1","port":23}]';
  await mkdir(envDir, { recursive: true }); await writeFile(join(envDir, "environments.default.json"), knownEnv);
  if (scenario === "sibling") {
    const other = join(home, "profiles/web/node_modules/@dsh/remote-ops");
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "package.json"), JSON.stringify({ name: "@dsh/remote-ops", version: oldVersion }));
  }
  await startHost("host");
  browser = await chromium.launch({channel:"chrome", headless:true});
  page = await browser.newPage({locale:"zh-CN", viewport:{width:1440,height:980}});
  page.on("request", r => {
    const address = new URL(r.url());
    if (address.pathname === "/api/dsh-remote-ops/state" && address.searchParams.get("sessionId")) owner=address.searchParams.get("sessionId");
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/dsh-remote-ops/update" && r.postDataJSON()?.action === "install") receipt.clicks++;
  });
  await page.goto(url);
  const editor=page.getByRole("textbox",{name:/描述你想要|发消息或创建任务/});
  await editor.fill("本地升级验收"); await editor.press("Enter");
  await page.getByRole("button",{name:"Remote Ops",exact:true}).click();
  const panel=page.locator(".dsh-remote-ops");
  await panel.getByRole("button",{name:"设置",exact:true}).click();
  await panel.getByRole("tab",{name:"更新",exact:true}).click();
  const get = name => page.evaluate(async name => (await fetch("/api/dsh-remote-ops/" + name)).json(), name);
  assert.equal((await get("update")).currentVersion, oldVersion);
  await panel.getByRole("button",{name:"检查并更新",exact:true}).click();
  const final = await wait(async () => {
    if (host.exitCode !== null) throw Error("Desktop host exited during update");
    const s = await get("update").catch(() => null);
    if (!s?.currentVersion) return;
    const state=[s.currentVersion,s.installedVersion,s.phase].join(" ");
    if (receipt.states.at(-1)!==state) {receipt.states.push(state); console.log(state);}
    if (scenario === "resume" && injected && !receipt.restartedFromBridge && s.currentVersion === bridgeVersion) {
      receipt.restartedFromBridge = true;
      const closed = new Promise(resolve => host.once("close", resolve));
      host.kill();
      await closed;
      await startHost("resumed");
      await page.goto(url);
      return;
    }
    if (s.error && !s.busy) {
      if (scenario === "tamper" && injected && s.error.includes("UPDATE_CHECKSUM_MISMATCH")) return s;
      if (scenario !== "retry" || !s.error.includes("UPDATE_DOWNLOAD_FAILED")) throw Error(s.error);
    }
    if (s.currentVersion === targetVersion && s.installedVersion === targetVersion && !s.busy) return s;
  },240000);
  assert.equal(receipt.clicks,1);
  assert.equal(receipt.states.some(x=>x.startsWith(bridgeVersion + " ")), scenario !== "direct");
  assert.equal(await readFile(join(envDir,"environments.default.json"),"utf8"),knownEnv);
  receipt.environmentPreserved = true;
  if (scenario === "tamper") {
    assert.equal(final.currentVersion, bridgeVersion);
    assert.equal(final.installedVersion, bridgeVersion);
    assert.equal(final.settings.url, source);
    receipt.rejected = "UPDATE_CHECKSUM_MISMATCH";
  } else {
    const expectedSource = ["sibling", "direct"].includes(scenario) ? source : new URL("stable/latest.json", source).href;
    assert.equal(final.settings.url, expectedSource);
    receipt.sourceMovedToStable = final.settings.url !== source;
    if (scenario === "normal" || scenario === "direct") {
      const displayed = panel.locator(".dsh-remote-ops__updateVersions strong");
      // A host that remounts the panel can close Settings during the asset switch.
      if (!await displayed.count()) {
        if (!await panel.isVisible()) await page.getByRole("button", { name: "Remote Ops", exact: true }).click();
        const updateTab = panel.getByRole("tab", { name: "更新", exact: true });
        if (!await updateTab.isVisible()) await panel.getByRole("button", { name: "设置", exact: true }).click();
        await updateTab.click();
        receipt.settingsReopened = true;
      }
      receipt.displayedVersions = await wait(async () => {
        const values = await displayed.allTextContents();
        return values.length === 2 && values.every(value => value === "v" + targetVersion) && values;
      }, 20000);
    }
    if (scenario === "retry") {
      assert.ok(injected && receipt.downloads.filter(path => path === frozenManifest).length === 2);
      const next = await page.evaluate(async () => (await fetch("/api/dsh-remote-ops/update", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "check" })
      })).json());
      assert.equal(next.latestVersion, nextVersion);
      assert.equal(next.updateAvailable, true);
      receipt.nextVersionDetected = next.latestVersion;
    }
    if (scenario === "resume") assert.ok(receipt.restartedFromBridge);
    const data = await get("browser");
    receipt.embeddedRuntime = data.runtime.modes.embedded.source;
    assert.equal(receipt.embeddedRuntime, "bundled");
    assert.ok(owner, "no bound Desktop conversation");
    const opened = await page.evaluate(async body => (await fetch("/api/dsh-remote-ops/browser", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    })).json(), { action: "open-url", url: new URL("/browser-proof", source).href, display: "embedded", browser: "chromium", sessionId: owner });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.equal(receipt.browserVisits, 1);
  }
  receipt.passed=true;
} catch (error) {
  receipt.error=error.message; process.exitCode=1; console.error(error.message);
} finally {
  await writeFile(join(out,"evidence.json"),JSON.stringify(receipt,null,2));
  await browser?.close();
  if (host?.exitCode===null) host.kill();
  server.closeAllConnections(); await new Promise(r=>server.close(r));
  for (const stream of logs) stream.end();
  console.log("Evidence: "+join(out,"evidence.json"));
}

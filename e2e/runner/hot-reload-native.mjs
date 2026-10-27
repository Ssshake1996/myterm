// Real DSH, an isolated profile, real Chrome and SSH protocol connections to a
// scripted local device. Synthetic later releases are fixtures, never published.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs";
import { startFakeDevice } from "../harness/fake-device.mjs";

const cli = process.env.DSH_CLI, pkg = resolve(process.argv[2] ?? "");
if (!cli || !process.argv[2]) throw new Error("Set DSH_CLI; pass the candidate or downloaded official tgz");
const out = resolve(process.env.HOT_RELOAD_OUTPUT ?? `output/hot-reload-native-${Date.now()}`);
await mkdir(out, { recursive: true });
const home = join(out, "home"), profile = join(home, "profiles/web");
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: "1", REMOTE_OPS_ACCEPTANCE_KEY: "isolated-test-fixture" };
const evidence = { kind: "real-dsh-hot-reload-with-local-services", packageSha256: createHash("sha256").update(await readFile(pkg)).digest("hex"), steps: [], errors: [] };
const until = async (fn, timeout = 90000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 200)); } throw Error("Native hot reload did not settle"); };
const run = (exe, args, options = {}) => new Promise((yes, no) => {
  const p = spawn(exe, args, { env, windowsHide: true, ...options }); let output = "";
  p.stdout.on("data", v => output += v); p.stderr.on("data", v => output += v);
  p.once("error", no); p.once("close", code => code ? no(Error(output.slice(-5000))) : yes(output));
});
const step = async (name, work) => { await work(); evidence.steps.push({ name, passed: true }); console.log("PASS " + name); };
const ssh = await startFakeDevice({ name: "Hot reload SSH" });
let host, browser, page, owner, sshId, browserId, apiId, slowResponse, feed, baseVersion, releaseSlow;
const proofs = new Map(), errors = [], moduleRequests = [];
const decode = value => {
  if (typeof value === "string") { try { return decode(JSON.parse(value)); } catch { return value; } }
  if (Array.isArray(value)) return value.map(decode).find(v => v && typeof v === "object") ?? value.map(decode).join("\n");
  return value?.type === "text" ? decode(value.text) : value;
};
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/page") { res.setHeader("Content-Type", "text/html"); res.end('<h1>Hot reload browser</h1><label>Draft<input id="draft"></label>'); return; }
    if (req.url === "/api/login") { res.setHeader("Content-Type", "application/json"); res.end('{"token":"local-fixture-token"}'); return; }
    if (req.url === "/api/slow") { slowResponse = res; releaseSlow = () => { res.setHeader("Content-Type", "application/json"); res.end('{"ok":true,"marker":"completed-once"}'); }; return; }
    if (req.url === "/feed/latest.json") { res.end(JSON.stringify({ schemaVersion: 1, package: "@dsh/remote-ops", version: feed.version, asset: `dsh-remote-ops-v${feed.version}.tgz`, checksum: `SHA256SUMS-dsh-remote-ops-v${feed.version}.txt` })); return; }
    if (req.url?.endsWith(".tgz")) { res.end(feed.bytes); return; }
    if (req.url?.endsWith(".txt")) { res.end(`${createHash("sha256").update(feed.bytes).digest("hex")}  dsh-remote-ops-v${feed.version}.tgz\n`); return; }
    let raw = ""; for await (const part of req) raw += part;
    const body = JSON.parse(raw), messages = body.messages ?? [];
    const at = messages.findLastIndex(m => m.role === "user" && /HOT_NATIVE_(OPEN|AFTER)/.test(JSON.stringify(m.content)));
    const stage = at >= 0 ? /HOT_NATIVE_(OPEN|AFTER)/.exec(JSON.stringify(messages[at].content))[1] : "NONE";
    const results = messages.slice(at + 1).filter(m => m.role === "tool").map(m => decode(m.content));
    const plan = stage === "OPEN" ? [["remote_terminal_open", { environment: "Hot reload SSH" }]] : [["remote_command_execute", { session: sshId, command: "echo HOT_RELOAD_EXEC" }], ["remote_browser_read", { browserId }], ["remote_api_records", { requestId: "slow-before-update" }]];
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (delta, finish_reason = null) => res.write("data: " + JSON.stringify({ id: "hot-native", object: "chat.completion.chunk", created: 1, model: "native-test", choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
    if (at >= 0 && body.tools?.length && results.length < plan.length && !results.some(r => typeof r === "string" && r.startsWith("Error:"))) {
      const [name, args] = plan[results.length]; emit({ role: "assistant", tool_calls: [{ index: 0, id: "hot-" + results.length + "-" + Date.now(), type: "function", function: { name, arguments: JSON.stringify(args) } }] }); emit({}, "tool_calls");
    } else { if (at >= 0 && body.tools?.length) proofs.set(stage, results); emit({ role: "assistant", content: "HOT_NATIVE_DONE" }, "stop"); }
    res.end("data: [DONE]\n\n");
  } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
});
const logs = [];
try {
  await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = `http://127.0.0.1:${server.address().port}`;
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "cordis.patch.yml"), `- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: 2026-09-28.1\n- id: agent-default-model\n  config:\n    provider: remote-ops-acceptance\n    model: native-test\n- id: llm-pi-ai\n  config:\n    providers:\n      remote-ops-acceptance:\n        api: openai-completions\n        baseURL: ${origin}/v1\n        apiKeyEnv: REMOTE_OPS_ACCEPTANCE_KEY\n        models:\n          - id: native-test\n            name: Hot reload acceptance\n            contextWindow: 262144\n            maxTokens: 4096\n            input: [text]\n`);
  await writeFile(join(out, "install.log"), await run(process.execPath, [cli, "plugin", "--profile", "web", "add", pkg]));
  baseVersion = JSON.parse(await readFile(join(profile, "node_modules/@dsh/remote-ops/package.json"), "utf8")).version;
  evidence.installedVersion = baseVersion;
  async function nextPackage(index, broken = false) {
    const parts = baseVersion.split(".").map(Number); parts[2] += index; const version = parts.join(".");
    const dir = join(out, "fixture-" + version); await mkdir(dir, { recursive: true });
    await run("tar", ["-xzf", pkg, "-C", dir]);
    for (const file of ["package.json", "lib/version.js", "lib/client.js"]) {
      const path = join(dir, "package", file); let text = (await readFile(path, "utf8")).replaceAll(baseVersion, version);
      if (file === "lib/client.js") text = text.replace("手动检查并安装更新。", `NATIVE_CLIENT_${version} 手动检查并安装更新。`);
      await writeFile(path, text);
    }
    if (broken) { const path = join(dir, "package/lib/index.js"); await writeFile(path, (await readFile(path, "utf8")).replace("export function apply(ctx) {", 'export function apply(ctx) { throw new Error("native candidate startup failure");')); }
    const npmCli = process.env.NPM_CLI ?? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    await run(process.execPath, [npmCli, "pack", "--silent", "--pack-destination", dir], { cwd: join(dir, "package") });
    return { version, bytes: await readFile(join(dir, `dsh-remote-ops-${version}.tgz`)) };
  }
  feed = await nextPackage(1);
  const portProbe = createServer(); await new Promise(r => portProbe.listen(0, "127.0.0.1", r)); const port = portProbe.address().port; await new Promise(r => portProbe.close(r));
  host = spawn(process.execPath, [cli, "--profile", "web", "--host", "127.0.0.1", "--port", String(port), "--no-open"], { env, windowsHide: true }); evidence.hostPid = host.pid;
  logs.push(createWriteStream(join(out, "stdout.log")), createWriteStream(join(out, "stderr.log"))); host.stdout.pipe(logs[0]); host.stderr.pipe(logs[1]);
  const url = await until(async () => { if (host.exitCode !== null) throw Error("DSH exited"); return (await readFile(join(out, "stdout.log"), "utf8").catch(() => "")).match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?\\S+`))?.[0]; });
  browser = await chromium.launch({ channel: "chrome", headless: true }); page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1500, height: 1000 } }); page.setDefaultTimeout(20000);
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", request => { const u = new URL(request.url()); if (u.pathname.endsWith("/state") && u.searchParams.get("sessionId")) owner = u.searchParams.get("sessionId"); if (u.pathname === "/plugins/" && u.search.includes("remote-ops")) moduleRequests.push(request.url()); });
  await page.goto(url); const editor = page.getByRole("textbox", { name: /描述你想要|发消息或创建任务/ }); await editor.waitFor();
  await page.getByRole("button", { name: "Remote Ops", exact: true }).click(); await page.getByLabel("终端输出", { exact: true }).waitFor();
  const api = (path, body) => page.evaluate(async ({ path, body }) => { const response = await fetch("/api/dsh-remote-ops/" + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}); const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value; }, { path, body });
  const state = () => api("state?sessionId=" + owner), update = () => api("update");
  await step("installed package exposes hot reload in real DSH", async () => { assert.equal((await update()).hotReload.supported, true); });
  await step("real Agent opens SSH and saved configurations are established", async () => {
    await api("action", { action: "environment.save", environment: { id: "hot-ssh", name: "Hot reload SSH", group: "native", host: ssh.host, port: ssh.port, username: ssh.username }, password: ssh.password });
    await editor.fill("HOT_NATIVE_OPEN"); await editor.press("Enter"); const proof = await until(() => proofs.get("OPEN")); sshId = proof[0].sessionId; assert.ok(sshId);
    browserId = (await api("browser", { action: "open-url", sessionId: owner, url: origin + "/page", display: "embedded", browser: "chrome" })).result.id;
    assert.ok(browserId);
    await api("browser", { action: "run", sessionId: owner, browserId, requestId: "fill-before", steps: [{ action: "fill", target: { kind: "css", value: "#draft" }, value: "PRESERVED_PAGE_INPUT" }] });
    apiId = (await api("api", { action: "environment.save", environment: { name: "Saved API", group: "native", baseUrl: origin + "/api/", auth: { mode: "token", username: "fixture", loginPath: "login", tokenPointer: "/token" } }, password: "fixture-password" })).result.id;
    await api("api", { action: "login", sessionId: owner, args: { environment: apiId, requestId: "login-before" } });
    await until(async () => (await api("api?sessionId=" + owner)).sessions.length === 1);
    await api("update", { action: "settings", settings: { source: "custom", url: origin + "/feed/" } });
  });
  let before, pendingRequest;
  await step("update waits for an active API request instead of cancelling it", async () => {
    pendingRequest = api("api", { action: "request", sessionId: owner, args: { environment: apiId, path: "slow", requestId: "slow-before-update" } }); await until(() => slowResponse);
    before = await state(); await editor.fill("对话草稿在热加载后保留");
    const clientLoadsBefore = moduleRequests.length; const value = await api("update", { action: "install" }); assert.equal(value.hotReload.pending, true); assert.equal(value.restartRequired, false);
    await new Promise(r => setTimeout(r, 1800)); assert.equal((await state()).runtimeId, before.runtimeId); assert.ok((await update()).hotReload.blockers.includes("API 请求执行中")); assert.equal(moduleRequests.length, clientLoadsBefore, "frontend must wait for running work too");
    releaseSlow(); await pendingRequest;
  });
  await step("backend and browser module update without restarting DSH or replacing connections", async () => {
    const after = await until(async () => { try { const s = await state(); return s.pluginVersion === feed.version && s; } catch {} });
    assert.notEqual(after.runtimeId, before.runtimeId); assert.equal(host.exitCode, null);
    assert.equal(after.sessions.find(s => s.sessionId === "local-cmd").outputCursor.streamId, before.sessions.find(s => s.sessionId === "local-cmd").outputCursor.streamId);
    assert.equal(after.sessions.find(s => s.sessionId === sshId).outputCursor.streamId, before.sessions.find(s => s.sessionId === sshId).outputCursor.streamId);
    assert.equal(ssh.log.connections, 1); assert.match(await editor.innerText(), /对话草稿在热加载后保留/);
    const apiState = await api("api?sessionId=" + owner); assert.equal(apiState.sessions.length, 1); assert.equal(apiState.records.find(r => r.id === "slow-before-update").state, "completed");
    assert.equal((await update()).settings.source, "custom");
    assert.ok(moduleRequests.length >= 2); evidence.moduleReloads = moduleRequests.length;
    await page.locator(".dsh-remote-ops__headAction").filter({hasText:"设置"}).click();
    await page.getByRole("tab", { name: "更新", exact: true }).click();
    await page.getByText(`NATIVE_CLIENT_${feed.version}`, { exact: false }).waitFor();
    await page.getByRole("button", { name: "检查并更新", exact: true }).waitFor();
    await page.getByText("新版已生效，无需重启 DSH", { exact: true }).waitFor();
    await page.screenshot({ path: join(out, "updated.png") });
  });
  await step("Agent tools work after handoff and keep earlier browser/API identities", async () => {
    await editor.fill("HOT_NATIVE_AFTER"); await editor.press("Enter"); const proof = await until(() => proofs.get("AFTER"));
    assert.equal(proof.length, 3); assert.match(JSON.stringify(proof[0]), /HOT_RELOAD_EXEC/); assert.doesNotMatch(JSON.stringify(proof), /Error:|PRIVATE|Cannot read private/);
    evidence.agentToolsAfter = proof.map((_, index) => ["remote_command_execute", "remote_browser_read", "remote_api_records"][index]);
  });
  await step("second update waits across a batch upload gap and preserves both files", async () => {
    const uploadRoot = join(out, "uploaded"); await mkdir(uploadRoot, { recursive: true });
    // Both panes use isolated host storage; unrelated SFTP directory probes
    // would otherwise create additional SSH connections during this assertion.
    await page.evaluate(({ owner, path }) => localStorage.setItem("remote-ops.files." + owner, JSON.stringify({ panes: [{ kind: "host", path }, { kind: "host", path }] })), { owner, path: uploadRoot });
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await page.getByRole("tablist", { name: "Remote Ops 工作区" }).getByRole("tab", { name: "文件", exact: true }).click();
    await page.getByLabel("位置 A", { exact: true }).selectOption("host");
    await until(() => page.getByLabel("路径 A", { exact: true }).isEnabled());
    await page.getByLabel("路径 A", { exact: true }).fill(uploadRoot);
    const directory = page.waitForResponse(response => { try { const body = response.request().postDataJSON(); return response.url().includes("/workspace") && body.action === "files" && body.endpoint.path === uploadRoot; } catch { return false; } });
    await page.getByLabel("文件来源 A", { exact: true }).getByRole("button", { name: "打开路径", exact: true }).click(); await directory;
    const upload = page.getByLabel("上传文件 A", { exact: true }); await until(() => upload.isEnabled());
    let release, held = false; const gate = new Promise(resolve => release = resolve);
    const pattern = "**/api/dsh-remote-ops/browser-upload?*";
    await page.route(pattern, async route => { if (new URL(route.request().url()).searchParams.get("name") === "gap-two.txt") { held = true; await gate; } await route.continue().catch(() => {}); });
    try {
      await upload.setInputFiles(["gap-one.txt", "gap-two.txt"].map(name => ({ name, mimeType: "text/plain", buffer: Buffer.from(name + " contents") })));
      await until(() => held); assert.equal(await readFile(join(uploadRoot, "gap-one.txt"), "utf8"), "gap-one.txt contents");
      const beforeBatch = await state(), clientLoads = moduleRequests.length;
      feed = await nextPackage(2); await api("update", { action: "install" });
      await new Promise(r => setTimeout(r, 1800));
      assert.equal((await state()).runtimeId, beforeBatch.runtimeId); assert.equal(moduleRequests.length, clientLoads);
      assert.ok((await update()).hotReload.blockers.includes("浏览器批量上传中"));
      release();
      await until(async () => { try { return await readFile(join(uploadRoot, "gap-two.txt"), "utf8") === "gap-two.txt contents"; } catch { return false; } });
      await until(async () => { try { return (await state()).pluginVersion === feed.version; } catch {} });
      assert.equal(ssh.log.connections, 1); assert.equal(host.exitCode, null);
    } finally { release(); await page.unroute(pattern); }
  });
  await step("host profile recomposition keeps the committed runtime and frontend", async () => {
    const path = join(profile, "cordis.patch.yml");
    await writeFile(path, (await readFile(path, "utf8")) + "- id: ui-jobs\n  disabled: true\n");
    await new Promise(r => setTimeout(r, 3000));
    assert.equal((await state()).pluginVersion, feed.version);
    assert.equal(await page.getByRole("button", { name: "Remote Ops", exact: true }).count(), 1);
  });
  await step("candidate startup failure rolls back without replaying requests or dropping SSH", async () => {
    const previous = feed.version; feed = await nextPackage(3, true); await api("update", { action: "install" });
    const failed = await until(async () => { try { const s = await update(); return s.phase === "reload-failed" && s; } catch {} });
    assert.equal(failed.currentVersion, previous); assert.equal(failed.installedVersion, feed.version); assert.match(failed.error, /已恢复旧运行版本/);
    assert.equal((await state()).sessions.find(s => s.sessionId === sshId).status.kind, "running"); assert.equal(ssh.log.connections, 1);
    const command = await api("workspace", { action: "command-execute", sessionId: owner, session: sshId, command: "echo ROLLBACK_OK" }); assert.match(JSON.stringify(command), /ROLLBACK_OK/);
    await page.screenshot({ path: join(out, "rollback.png") });
  });
  evidence.browserErrors = errors; assert.deepEqual(errors, []);
} catch (error) {
  evidence.error = error.stack; process.exitCode = 1; console.error(error);
  if (page) { evidence.failedView = await page.locator("body").innerText().catch(() => "unavailable"); await page.screenshot({ path: join(out, "failure.png"), timeout: 5000 }).catch(() => {}); }
} finally {
  evidence.status = process.exitCode ? "failed" : "passed"; evidence.finishedAt = new Date().toISOString();
  await writeFile(join(out, "evidence.json"), JSON.stringify(evidence, null, 2)); await browser?.close();
  if (host?.exitCode === null) await run("taskkill.exe", ["/PID", String(host.pid), "/T", "/F"]).catch(() => {});
  host?.stdout.destroy(); host?.stderr.destroy(); logs.forEach(log => log.end());
  server.closeAllConnections(); await new Promise(r => server.close(r)); await ssh.close(); console.log("Evidence: " + join(out, "evidence.json"));
}

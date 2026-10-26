import assert from "node:assert/strict";
import { chromium } from "../../integrations/dsh-remote-ops/node_modules/playwright-core/index.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { startWindowsOpenSsh } from "../harness/windows-openssh.mjs";
import { verifyTerminalClose } from "./windows-native-terminal-close.mjs";

// Native DSH, an installed candidate tgz and real Microsoft OpenSSH. The isolated
// model fixture requests actual tools deterministically; it is not an Agent patch.
const cli = process.env.DSH_CLI;
if (!cli || !process.argv[2]) throw new Error("Set DSH_CLI and WINDOWS_OPENSSH_BIN; pass the candidate tgz path");
const pkg = resolve(process.argv[2]), out = resolve(process.env.WINDOWS_NATIVE_OUTPUT ?? `output/windows-native-${Date.now()}`);
await mkdir(out, { recursive: true });
const home = join(out, "dsh-home"), profile = join(home, "profiles/web");
const ssh = await startWindowsOpenSsh({ root: join(out, "ssh") });
const remoteRoot = join(tmpdir(), "Remote Ops Native 中文 " + randomUUID()).replaceAll("\\", "/");
const skills = ["remote-ops-browser", "remote-ops-environments", "remote-ops-terminal-logs", "remote-ops-api", "remote-ops-updates", "remote-ops-windows"];
const evidence = { kind: "native-dsh-real-windows-ssh", packageSha256: createHash("sha256").update(await readFile(pkg)).digest("hex"), steps: [], errors: [], tools: [] };
const decode = value => {
  if (typeof value === "string") { try { return decode(JSON.parse(value)); } catch { return value; } }
  if (Array.isArray(value)) return value.map(decode).find(x => x && typeof x === "object") ?? value.map(decode).join("\n");
  return value?.type === "text" ? decode(value.text) : value;
};
let host, browser, proof, skillProof, origin;
const logs = [];
const closeProof = new Map();
const server = createServer(async (req, res) => {
  try {
    let raw = "";for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), messages = body.messages ?? [];
    const at = messages.findLastIndex(m => m.role === "user" && /WINDOWS_NATIVE_CHECK|WINDOWS_SKILL_CHECK|WINDOWS_CLOSE_OTHER|WINDOWS_CLOSE_BUSY|WINDOWS_CLOSE_LOGS/.test(JSON.stringify(m.content)));
    const closeRun = at >= 0 ? /WINDOWS_CLOSE_(OTHER|BUSY|LOGS)/.exec(JSON.stringify(messages[at].content))?.[1] : null;
    const skillRun = at >= 0 && JSON.stringify(messages[at].content).includes("WINDOWS_SKILL_CHECK");
    const results = messages.slice(at + 1).filter(m => m.role === "tool").map(m => decode(m.content));
    const plan = closeRun === "OTHER" ? [["remote_terminal_open", { environment: "Windows 原生验收" }]]
      : closeRun === "BUSY" ? [["remote_command_execute", { session: proof[5].sessionId, shell: "windows-powershell", command: 'Write-Output "WINDOWS_CLOSE_STARTED"; Start-Sleep -Seconds 120; Write-Output "WINDOWS_CLOSE_ENDED"', timeoutSeconds: 180 }]]
      : closeRun === "LOGS" ? [["remote_terminal_logs", {}]]
      : skillRun ? skills.map(name => ["skill", { name }]) : [
      ["remote_environment_create", { ...ssh.environment, id: undefined, name: "Windows 原生验收" }],
      ["remote_environment_test", { environment: "Windows 原生验收" }],
      ["remote_terminal_open", { environment: "Windows 原生验收" }],
      ["remote_terminal_send", { session: results[2]?.sessionId, text: "echo NATIVE_WINDOWS_CLI", quietMs: 300 }],
      ["remote_environment_update", { environment: "Windows 原生验收", shell: "windows-powershell" }],
      ["remote_terminal_open", { environment: "Windows 原生验收" }],
      ["remote_command_execute", { session: results[5]?.sessionId, shell: "windows-powershell", command: "param($text) @{value=$text;host=[Environment]::MachineName}|ConvertTo-Json -Compress", parameters: { text: "中文 & | % ! ^ \" spaces" } }],
      ["remote_sftp_mkdir", { environment: "Windows 原生验收", path: remoteRoot }],
      ["remote_sftp_write", { environment: "Windows 原生验收", path: remoteRoot + "/结果.txt", content: "Native DSH 中文" }],
      ["remote_sftp_read", { environment: "Windows 原生验收", path: remoteRoot + "/结果.txt" }],
      ["remote_terminal_log_export", { all: true, format: "zip" }],
      ["remote_sftp_delete", { environment: "Windows 原生验收", path: remoteRoot + "/结果.txt" }],
      ["remote_sftp_delete", { environment: "Windows 原生验收", path: remoteRoot }],
    ];
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (delta, finish_reason = null) => res.write("data: " + JSON.stringify({ id: "windows-native", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "native-test", choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
    const failed = results.some(r => typeof r === "string" && /^Error:|SSH_.*FAILED/.test(r) || r?.error || r?.ok === false || r?.status === "failed");
    if (at >= 0 && body.tools?.length && results.length < plan.length && !failed) {
      const [name, args] = plan[results.length];evidence.tools.push(name);
      emit({ role: "assistant", tool_calls: [{ index: 0, id: "win-" + results.length + "-" + Date.now(), type: "function", function: { name, arguments: JSON.stringify(args) } }] });emit({}, "tool_calls");
    } else {
      if (at >= 0 && body.tools?.length) { if (closeRun) closeProof.set(closeRun, results); else if (skillRun) skillProof = { results, catalog: skills.every(name => JSON.stringify(messages).includes(name)) }; else proof = results; }
      emit({ role: "assistant", content: "WINDOWS_NATIVE_DONE" }, "stop");
    }
    res.end("data: [DONE]\n\n");
  } catch (error) { if (!res.headersSent) res.writeHead(500);res.end(String(error)); }
});
const until = async (fn, milliseconds = 60000) => { const end = Date.now() + milliseconds;while (Date.now() < end) { const value = await fn();if (value) return value;await new Promise(r => setTimeout(r, 200)); }throw new Error("Native DSH state did not settle"); };
const step = async (name, work) => { try { await work();evidence.steps.push({ name, pass: true });console.log("PASS " + name); } catch (error) { evidence.steps.push({ name, pass: false, error: error.stack });process.exitCode = 1;throw error; } };
const runCli = (args, env) => new Promise((yes, no) => {
  const child = spawn(process.execPath, [cli, ...args], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = createWriteStream(join(out, "install.log"));child.stdout.pipe(log, { end: false });child.stderr.pipe(log, { end: false });
  child.once("error", no);child.once("close", code => log.end(async () => {
    if (code === 0) yes();
    else no(new Error("DSH plugin install failed: " + (await readFile(join(out, "install.log"), "utf8").catch(() => "unavailable install log")).slice(-4000)));
  }));
});
try {
  await new Promise(r => server.listen(0, "127.0.0.1", r));origin = `http://127.0.0.1:${server.address().port}`;
  const probe = createServer();await new Promise(r => probe.listen(0, "127.0.0.1", r));const port = probe.address().port;await new Promise(r => probe.close(r));
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "cordis.patch.yml"), `- id: ui-settings-general\n  name: '@deepseek-ai/dsh-client-ui-settings-general'\n  config:\n    welcomeNoticeVersion: 2026-09-28.1\n- id: agent-default-model\n  config:\n    provider: remote-ops-acceptance\n    model: native-test\n- id: llm-pi-ai\n  config:\n    providers:\n      remote-ops-acceptance:\n        api: openai-completions\n        baseURL: ${origin}/v1\n        apiKeyEnv: REMOTE_OPS_ACCEPTANCE_KEY\n        models:\n          - id: native-test\n            name: Windows native acceptance\n            contextWindow: 262144\n            maxTokens: 4096\n            input: [text]\n`);
  const env = { ...process.env, DSH_HOME: home, REMOTE_OPS_ACCEPTANCE_KEY: "isolated-test-fixture" };
  await runCli(["plugin", "--profile", "web", "add", pkg], env);
  evidence.installedVersion = JSON.parse(await readFile(join(profile, "node_modules/@dsh/remote-ops/package.json"), "utf8")).version;
  logs.push(createWriteStream(join(out, "dsh.stdout.log")), createWriteStream(join(out, "dsh.stderr.log")));
  host = spawn(process.execPath, [cli, "--profile", "web", "--host", "127.0.0.1", "--port", String(port), "--no-open"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  host.stdout.pipe(logs[0], { end: false });host.stderr.pipe(logs[1], { end: false });
  const url = await until(async () => { if (host.exitCode !== null) throw new Error("DSH exited");return (await readFile(join(out, "dsh.stdout.log"), "utf8").catch(() => "")).match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?\\S+`))?.[0]; });
  browser = await chromium.launch({ channel: "chrome", headless: true });const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } }), p = await context.newPage();
  p.setDefaultTimeout(20000);
  let currentOwner;
  p.on("request", request => { const u = new URL(request.url()); if (u.pathname === "/api/dsh-remote-ops/state" && u.searchParams.get("sessionId")) currentOwner = u.searchParams.get("sessionId"); });
  p.on("pageerror", error => evidence.errors.push(error.message));await p.goto(url);
  const editor = p.getByRole("textbox", { name: /描述你想要|发消息或创建任务/ });await editor.waitFor();
  await p.getByRole("button", { name: "Remote Ops", exact: true }).click();await p.getByLabel("终端输出", { exact: true }).waitFor();
  await step("six bundled skills load through the native DSH registry", async () => {
    await editor.fill("WINDOWS_SKILL_CHECK");await editor.press("Enter");await until(() => skillProof, 90000);
    evidence.skillProof = skillProof;assert.equal(skillProof.catalog, true);assert.equal(skillProof.results.length, 6);
    assert.match(JSON.stringify(skillProof.results[5]), /remote_environment_test/);evidence.skills = skills;
  });
  await step("native Agent Windows tools execute actual PTY, scripts, SFTP and log export", async () => {
    await until(() => editor.isEditable());await editor.fill("WINDOWS_NATIVE_CHECK");await editor.press("Enter");await until(() => proof, 120000);
    evidence.results = proof;assert.equal(proof.length, 13, JSON.stringify(proof).slice(-1500));
    assert.equal(proof[1].detected.platform, "windows");assert.equal(proof[6].exitCode, 0);
    assert.equal(JSON.parse(proof[6].stdout.trim()).value, "中文 & | % ! ^ \" spaces");
    assert.equal(proof[9].content, "Native DSH 中文");assert.match(proof[10].sha256, /^[a-f0-9]{64}$/);
  });
  await step("native environment form and terminal remain usable beside the conversation", async () => {
    const panel = p.locator(".dsh-remote-ops");await editor.fill("Windows 验收草稿");
    await panel.getByRole("button", { name: "环境管理", exact: true }).click();
    await panel.locator(".dsh-remote-ops__env").filter({ hasText: "Windows 原生验收" }).getByRole("button", { name: "编辑", exact: true }).click();
    assert.equal(await p.getByLabel("目标系统", { exact: true }).inputValue(), "windows");
    await p.screenshot({ path: join(out, "windows-environment.png"), animations: "disabled" });
    await p.getByRole("button", { name: "返回工作区", exact: true }).click();
    assert.equal(await editor.innerText(), "Windows 验收草稿");
    await panel.getByRole("tablist", { name: "终端会话" }).getByRole("tab", { name: "Windows 原生验收", exact: true }).first().click();
    await until(async () => (await p.getByLabel("终端输出", { exact: true }).innerText()).includes("NATIVE_WINDOWS_CLI"));
    await p.screenshot({ path: join(out, "windows-terminal.png"), animations: "disabled" });
    await p.setViewportSize({ width: 390, height: 844 });assert.ok(await panel.evaluate(n => n.scrollWidth <= n.clientWidth + 1));
    await p.screenshot({ path: join(out, "windows-narrow.png"), animations: "disabled" });
  });
  if (!process.exitCode) await verifyTerminalClose({ p, url, editor, owner: () => currentOwner, closeProof, until, step, out, evidence });
  assert.deepEqual(evidence.errors, []);
} catch (error) { evidence.error = error.stack;process.exitCode = 1;console.error(error); }
finally {
  evidence.status = process.exitCode ? "failed" : "passed";evidence.finishedAt = new Date().toISOString();
  await writeFile(join(out, "evidence.json"), JSON.stringify(evidence, null, 2));await browser?.close();
  if (host?.exitCode === null) await new Promise(r => { const child = spawn("taskkill.exe", ["/PID", String(host.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });child.once("error", r);child.once("close", r); });
  host?.stdout.destroy();host?.stderr.destroy();host?.unref();logs.forEach(log => log.end());
  server.closeAllConnections();await new Promise(r => server.close(r));await ssh.close();console.log("Evidence: " + join(out, "evidence.json"));
}

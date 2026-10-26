import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { RemoteOpsState } from "../lib/state/index.js";
import { PLUGIN_VERSION } from "../lib/version.js";
import { startWindowsOpenSsh } from "../../../e2e/harness/windows-openssh.mjs";

const output = resolve(process.env.WINDOWS_SSH_OUTPUT ?? "output/windows-ssh-live");
await mkdir(output, { recursive: true });
const server = await startWindowsOpenSsh({ root: join(output, "server") });
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), "remote-ops-win-home-"));
const localOutput = new EventEmitter();
const localHandle = { output: localOutput, done: new Promise(() => {}), write: async () => {}, terminate: async () => {} };
const ctx = { subprocess: { resolveExecutable: async x => x, spawnTerminal: async () => localHandle }, credentials: { resolve: async () => ({ value: process.env.WINDOWS_SSH_TEST_PASSWORD }) } };
const state = new RemoteOpsState(ctx), owner = { id: "windows-live-owner" };
const evidence = { startedAt: new Date().toISOString(), kind: "real-windows-openssh", pluginVersion: PLUGIN_VERSION, node: process.version, stages: [], remoteTestRoot: null };
const step = async (name, work) => { const started = Date.now(); try { const value = await work(); evidence.stages.push({ name, pass: true, durationMs: Date.now() - started }); console.log("PASS " + name); return value; } catch (error) { evidence.stages.push({ name, pass: false, message: error.message }); throw error; } };
let remoteRoot, crossDriveRoot, sessions = [];
try {
  await state.ready; await state.saveEnvironment(server.environment);
  const facts = await step("read-only platform, PTY, SFTP and pinned key diagnosis", async () => {
    const value = await state.testEnvironment(server.environment.id);
    assert.equal(value.ok, true, JSON.stringify(value));
    assert.equal(value.detected.platform, "windows");
    if (process.env.WINDOWS_SSH_PRODUCT_TYPE) assert.equal(value.detected.productType, Number(process.env.WINDOWS_SSH_PRODUCT_TYPE));
    assert.equal(value.identity.trust, "pinned");return value;
  });
  evidence.detected = facts.detected; evidence.identity = facts.identity; evidence.capabilities = facts.capabilities;
  const open = async shell => {
    await state.updateEnvironment(server.environment.id, { shell });
    const sessionId = randomUUID(), session = await state.spawnBackend({ name: server.environment.id, sessionId });
    const record = { sessionId, session, ownerId: owner.id, owner, environment: state.findEnvironment(server.environment.id), direct: true };
    state.sessions.set(sessionId, record); state.trackTerminalLog(owner, sessionId, session, record.environment);sessions.push(record);return record;
  };
  const cmd = await step("CMD visible PTY and raw input", async () => {
    const record = await open("cmd");
    await new Promise(r => setTimeout(r, 700));
    await record.session.write("echo WINDOWS_PTY_" + "中文\r");
    const deadline = Date.now() + 8000;
    while (!record.session.output.includes("WINDOWS_PTY_中文") && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    assert.ok(record.session.output.includes("WINDOWS_PTY_中文"), record.session.output);return record;
  });
  const power = await step("PowerShell PTY opens independently", async () => {
    const record = await open("windows-powershell");
    await new Promise(r => setTimeout(r, 1000));
    await record.session.write("[Console]::WriteLine('POWERSHELL_'+(17+25))\r");
    const deadline = Date.now() + 8000;
    while (!record.session.output.includes("POWERSHELL_42") && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    assert.ok(record.session.output.includes("POWERSHELL_42"), record.session.output);return record;
  });
  if (facts.detected.availableShells.some(item => item.name === "pwsh.exe")) {
    await step("installed PowerShell 7 PTY and structured script", async () => {
      const record = await open("pwsh");
      await new Promise(r => setTimeout(r, 1000));
      await record.session.write("[Console]::WriteLine('PWSH_'+$PSVersionTable.PSVersion.Major)\r");
      const deadline = Date.now() + 8000;
      while (!record.session.output.includes("PWSH_7") && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      assert.ok(record.session.output.includes("PWSH_7"), record.session.output);
      const value = await state.execute(owner, record.sessionId, { command: "param($text) $text", parameters: { text: "PowerShell 7 中文 & |" } });
      assert.equal(value.exitCode, 0);assert.equal(value.stdout.trim(), "PowerShell 7 中文 & |");
    });
  }
  remoteRoot = await step("literal temp path, Unicode parameters and independent exit status", async () => {
    const marker = '中文 spaces " & | % ! ^\nnext';
    const result = await state.execute(owner, power.sessionId, { command: "param($value) @{value=$value;temp=[IO.Path]::GetTempPath()}|ConvertTo-Json -Compress", parameters: { value: marker } });
    assert.equal(result.exitCode, 0, JSON.stringify(result));const parsed = JSON.parse(result.stdout.trim());assert.equal(parsed.value, marker);
    return parsed.temp.replace(/\\/g, "/").replace(/\/$/, "") + "/Remote Ops [中文] " + randomUUID();
  });
  evidence.remoteTestRoot = remoteRoot;
  if (output[0].toLowerCase() !== remoteRoot[0].toLowerCase()) {
    crossDriveRoot = join(output, "remote-cross-drive-中文").replaceAll("\\", "/");
    await step("a second drive is writable through the same SFTP identity", async () => {
      await state.sftp(owner, server.environment.id, "mkdir", { path: crossDriveRoot });
      await state.sftp(owner, server.environment.id, "write", { path: crossDriveRoot + "/跨盘.txt", content: "cross-drive bytes" });
      assert.equal((await state.sftp(owner, server.environment.id, "read", { path: crossDriveRoot + "/跨盘.txt" })).content, "cross-drive bytes");
      evidence.crossDrive = crossDriveRoot.slice(0, 2);
    });
  }
  await step("SFTP mkdir, UTF-8 write/read, rename and errors", async () => {
    await state.sftp(owner, server.environment.id, "mkdir", { path: remoteRoot + "/目录 A" });
    await state.sftp(owner, server.environment.id, "write", { path: remoteRoot + "/目录 A/文件.txt", content: "中文\nfile content" });
    const value = await state.sftp(owner, server.environment.id, "read", { path: remoteRoot + "/目录 A/文件.txt" });assert.equal(value.content, "中文\nfile content");
    await state.sftp(owner, server.environment.id, "rename", { from: remoteRoot + "/目录 A/文件.txt", to: remoteRoot + "/目录 A/renamed.txt" });
    await assert.rejects(state.sftp(owner, server.environment.id, "mkdir", { path: remoteRoot + "/目录 A/renamed.txt/child" }));
    const result = await state.execute(owner, power.sessionId, { command: "(Get-Location).Path", workingDirectory: remoteRoot + "/目录 A" });assert.equal(result.exitCode, 0);assert.equal(result.stdout.trim().replace(/\\/g, "/").toLowerCase(), (remoteRoot + "/目录 A").toLowerCase());
  });
  await step("binary upload/download, conflict, overwrite and SHA256", async () => {
    const source = join(output, "payload.bin"), destination = join(output, "received.bin");
    const bytes = Buffer.from(Array.from({ length: 1024 * 128 }, (_, n) => n % 251));await writeFile(source, bytes);
    await state.sftp(owner, server.environment.id, "upload", { localPath: source, remotePath: remoteRoot + "/binary.bin" });
    await assert.rejects(state.sftp(owner, server.environment.id, "upload", { localPath: source, remotePath: remoteRoot + "/binary.bin" }), { code: "TRANSFER_EXISTS" });
    await state.sftp(owner, server.environment.id, "upload", { localPath: source, remotePath: remoteRoot + "/binary.bin", overwrite: true });
    await state.sftp(owner, server.environment.id, "download", { remotePath: remoteRoot + "/binary.bin", localPath: destination, overwrite: true });
    const digest = data => createHash("sha256").update(data).digest("hex");assert.equal(digest(await readFile(destination)), digest(bytes));evidence.fileSha256 = digest(bytes);
  });
  await step("nonzero exit, error stream, cancellation and owner isolation", async () => {
    const error = await state.execute(owner, power.sessionId, { command: "Write-Error 'expected diagnostic'" });assert.equal(error.exitCode, 1);assert.match(error.stderr, /expected diagnostic/);
    const exit = await state.execute(owner, cmd.sessionId, { command: "echo OK\nexit /b 9" });assert.equal(exit.exitCode, 9);assert.equal(exit.status, "failed");
    const controller = new AbortController();const pending = state.execute(owner, power.sessionId, { command: "Start-Sleep -Seconds 3", signal: controller.signal });setTimeout(() => controller.abort(), 150);
    const cancelled = await pending;assert.equal(cancelled.status, "cancelled");assert.equal(cancelled.completion, "unknown");assert.equal(cancelled.terminationConfirmed, false);
    await assert.rejects(state.execute({ id: "other" }, power.sessionId, { command: "echo forbidden" }), { code: "FOREIGN_SESSION" });
  });
  await step("multi-terminal retained log export", async () => {
    const logs = await state.listTerminalLogs(owner);const values = logs.logs.filter(x => x.kind === "ssh");assert.equal(values.length, sessions.length);
    const archive = await state.exportTerminalLogs(owner, { logIds: values.map(x => x.logId), format: "zip" });assert.ok(archive.sha256);evidence.logs = { count: values.length, sha256: archive.sha256 };
  });
  await step("host-key changes reject terminal and SFTP before dispatch", async () => {
    await state.updateEnvironment(server.environment.id, { hostKeySha256: "SHA256:" + "A".repeat(43) });
    await assert.rejects(state.spawnBackend({ name: server.environment.id, sessionId: "wrong" }), { code: "SSH_HOST_KEY_CHANGED" });
    await assert.rejects(state.sftp(owner, server.environment.id, "list", {}), { code: "SSH_HOST_KEY_CHANGED" });
    await state.updateEnvironment(server.environment.id, { hostKeySha256: server.environment.hostKeySha256 });
  });
  await step("bulk close cancels a real dedicated Windows command and preserves an unselected terminal", async () => {
    ctx.terminals = { kill: async (_owner, id) => state.sessions.get(id).session.close() };
    const pending = state.execute(owner, power.sessionId, { command: "Start-Sleep -Seconds 20", requestId: "windows-bulk-close" });
    const deadline = Date.now() + 5000;
    while (!state.commands.has("windows-bulk-close") && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    assert.equal(state.terminalOperation(power.session, power.sessionId, owner.id).kind, "command");
    await new Promise(r => setTimeout(r, 1000));
    const receipt = await state.closeMany(owner, [power.sessionId]);
    assert.equal(receipt.results[0].closed, true); assert.equal(receipt.results[0].cancelledCommands, 1);
    const result = await pending;
    assert.equal(result.status, "cancelled"); assert.equal(result.terminationConfirmed, false);
    assert.equal(state.sessions.has(cmd.sessionId), true); assert.notEqual(cmd.session.status().kind, "exited");
    assert.equal(state.sessions.has(power.sessionId), false); evidence.bulkClose = { receipt, command: result };
  });
} catch (error) { evidence.error = { message: error.message, stack: error.stack }; process.exitCode = 1;console.error(error); }
finally {
  if (crossDriveRoot) {
    await state.updateEnvironment(server.environment.id, { hostKeySha256: server.environment.hostKeySha256 }).catch(() => {});
    for (const path of ["/跨盘.txt", ""]) await state.sftp(owner, server.environment.id, "delete", { path: crossDriveRoot + path }).catch(error => { (evidence.cleanupErrors ??= []).push(error.message); });
  }
  if (remoteRoot) {
    await state.updateEnvironment(server.environment.id, { hostKeySha256: server.environment.hostKeySha256 }).catch(() => {});
    for (const path of ["/目录 A/renamed.txt", "/binary.bin", "/目录 A", ""]) await state.sftp(owner, server.environment.id, "delete", { path: remoteRoot + path }).catch(error => { (evidence.cleanupErrors ??= []).push(error.message); });
  }
  for (const record of sessions) { await record.session.close(); record.session.client.destroy(); }
  await state.transfers.close(); await server.close();
  evidence.finishedAt = new Date().toISOString();await writeFile(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  if (previousHome === undefined) delete process.env.DSH_HOME;else process.env.DSH_HOME = previousHome;
}

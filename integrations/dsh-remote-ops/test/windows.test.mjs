import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEnvironment } from "../lib/common.js";
import { buildWindowsCommand, interactiveWindowsCommand, windowsProbeCommand } from "../lib/windows-shell.js";
import { normalizeSftpPath, remotePathContains, mkdirSftp } from "../lib/ssh-paths.js";
import { fixture } from "./helpers.mjs";
import { sshFingerprint, connectSsh, openSftpChannel } from "../lib/ssh-connection.js";
import { EventEmitter } from "node:events";
import { SshTerminalSession, buildSshShellOptions } from "../lib/terminal-sessions.js";
import iconv from "iconv-lite";
import { SftpFiles } from "../lib/transfers.js";

const env = { id: "win", name: "Windows", host: "host", username: "HOST\\user", platform: "windows", transport: "ssh", shell: "cmd" };
test("Windows environment validation preserves old SSH and rejects unsupported combinations", async t => {
  assert.equal(validateEnvironment(env).ok, true);
  assert.equal(validateEnvironment({ id: "old", name: "old", host: "host", username: "root" }).ok, true);
  for (const patch of [{ transport: "winrm" }, { platform: "guess" }, { shell: "bash" }, { platform: "posix" }, { readyTimeoutMs: -1 }, { readyTimeoutMs: "5000" }, { hostKeySha256: "wrong" }]) assert.equal(validateEnvironment({ ...env, ...patch }).ok, false, JSON.stringify(patch));
  const { state } = await fixture(t, () => "");
  await state.saveEnvironment(env);
  await state.updateEnvironment("win", { shell: "windows-powershell", readyTimeoutMs: 20000, encoding: "gb18030" });
  assert.equal(state.findEnvironment("win").shell, "windows-powershell");
  assert.equal(state.findEnvironment("win").readyTimeoutMs, 20000);
  const before = state.findEnvironment("win");
  await assert.rejects(state.updateEnvironment("win", { shell: "oops" }), { code: "REMOTE_ENV_INVALID" });
  assert.deepEqual(state.findEnvironment("win"), before);
});

test("Windows payload is data on stdin, with a bounded launcher and explicit shell validation", () => {
  const command = "param($name) $name";
  const parameters = { name: '中文 space " & | % ! ^\nnext' };
  const value = buildWindowsCommand({ command, shell: "windows-powershell", parameters, workingDirectory: "C:\\work [1]\\中文" });
  assert.ok(value.command.length < 8191);
  assert.ok(!value.command.includes(parameters.name));
  assert.deepEqual(JSON.parse(value.input), { command, parameters, workingDirectory: "C:\\work [1]\\中文", shell: "windows-powershell" });
  assert.equal(value.encoding, "utf-8");
  assert.throws(() => buildWindowsCommand({ command: "echo ok", shell: "cmd", parameters }), { code: "WINDOWS_COMMAND_INVALID" });
  assert.throws(() => buildWindowsCommand({ command: "x", shell: "auto" }), { code: "WINDOWS_COMMAND_INVALID" });
  assert.equal(interactiveWindowsCommand({ shell: "server-default" }), null);
  assert.match(interactiveWindowsCommand(env), /^cmd.exe /);
  assert.match(interactiveWindowsCommand({ ...env, shell: "pwsh" }), /^pwsh.exe /);
});

test("Windows independent execution uses a verified fresh connection and preserves the open PTY and its environment snapshot", async t => {
  const { state } = await fixture(t, () => "");
  const owner = { id: "windows-command-owner" }, captured = { ...env, shell: "windows-powershell" };
  let connected, destroyed = 0, payload, ptyTouched = false;
  const fresh = new EventEmitter();fresh.end = () => {};fresh.destroy = () => { destroyed++; };
  fresh.exec = (_command, callback) => {
    const channel = new EventEmitter();channel.stderr = new EventEmitter();
    channel.end = value => { payload = JSON.parse(value);queueMicrotask(() => { channel.emit("data", Buffer.from("中文 result"));channel.emit("exit", 0);channel.emit("close"); }); };
    callback(null, channel);
  };
  const session = { status: () => ({ kind: "running" }), client: { exec() { ptyTouched = true;throw new Error("PTY connection must not dispatch exec"); } } };
  state.sessions.set("win-pty", { sessionId: "win-pty", ownerId: owner.id, environment: captured, session });
  await state.saveEnvironment(captured);await state.updateEnvironment(env.id, { shell: "cmd", host: "new-host" });
  t.mock.method(state, "connectSshEnvironment", async environment => { connected = environment;return { client: fresh }; });
  const value = await state.execute(owner, "win-pty", { command: "param($text) $text", parameters: { text: "中文 & | % ! ^" }, workingDirectory: "C:/space [1]" });
  assert.equal(value.exitCode, 0);assert.equal(value.stdout, "中文 result");assert.equal(value.workingDirectory, "C:/space [1]");
  assert.equal(connected.host, "host");assert.equal(payload.parameters.text, "中文 & | % ! ^");assert.equal(payload.shell, "windows-powershell");
  assert.equal(ptyTouched, false);assert.equal(destroyed, 1);assert.equal(state.commands.size, 0);
  t.mock.method(state, "connectSshEnvironment", async () => { throw Object.assign(new Error("changed host"), { code: "SSH_HOST_KEY_CHANGED" }); });
  await assert.rejects(state.execute(owner, "win-pty", { command: "echo must-not-run" }), { code: "SSH_HOST_KEY_CHANGED" });
  assert.equal(ptyTouched, false);assert.equal(state.commands.size, 0);
});

test("connection diagnostics keep probe failures and numeric SFTP errors in their actual stages", async t => {
  const { state } = await fixture(t, () => "");
  await state.saveEnvironment(env);
  const client = new EventEmitter();let closed = 0;
  client.exec = (_command, callback) => callback(Object.assign(new Error("exec rejected"), { code: "TEST_EXEC_FAILED" }));
  client.sftp = callback => callback(Object.assign(new Error("access denied"), { code: 3 }));
  client.end = () => { closed++; };
  t.mock.method(state, "connectSshEnvironment", async () => ({ client, identity: { trust: "pinned" } }));
  const result = await state.testEnvironment(env.id);
  assert.equal(result.ok, false);assert.equal(result.capabilities.exec, false);
  assert.ok(result.stages.some(x => x.stage === "platform" && x.code === "TEST_EXEC_FAILED"));
  assert.ok(result.stages.some(x => x.stage === "sftp" && x.code === 3));
  assert.equal(closed, 1);
});

test("connection diagnosis can cancel an unresponsive SFTP path request and closes its channel", async t => {
  const { state } = await fixture(t, () => "");
  await state.saveEnvironment({ ...env, shell: "server-default" });
  const client = new EventEmitter();let closed = 0, sftpClosed = 0;
  client.exec = (_command, callback) => callback(new Error("probe unavailable"));
  client.shell = (_window, _options, callback) => callback(null, Object.assign(new EventEmitter(), { close() {} }));
  const controller = new AbortController();
  client.sftp = callback => callback(null, { realpath() { setTimeout(() => controller.abort(new Error("cancelled path")), 10); }, end() { sftpClosed++; } });
  client.end = () => { closed++; };
  t.mock.method(state, "connectSshEnvironment", async () => ({ client }));
  const result = await state.testEnvironment(env.id, { signal: controller.signal });
  assert.equal(result.ok, false);assert.ok(result.stages.some(x => x.stage === "sftp-path" && /cancelled path/.test(x.message)));
  assert.equal(closed, 1);assert.equal(sftpClosed, 1);
});

test("first-use SSH identity is persisted, pinned identities override deliberately and changed keys block all channels", async t => {
  const { state } = await fixture(t, () => "");
  const a = sshFingerprint(Buffer.from("key a")), b = sshFingerprint(Buffer.from("key b"));
  assert.equal((await state.verifySshHost(env, a)).trust, "first-use");
  assert.equal((await state.verifySshHost(env, a)).trust, "remembered");
  state.sshHostKeys = undefined;
  await assert.rejects(state.verifySshHost(env, b), error => error.code === "SSH_HOST_KEY_CHANGED" && error.expectedFingerprint === a && error.observedFingerprint === b);
  assert.equal((await state.verifySshHost({ ...env, hostKeySha256: b }, b)).trust, "pinned");
  await assert.rejects(state.verifySshHost(env, a), { code: "SSH_HOST_KEY_CHANGED" });
  const concurrent = await Promise.allSettled([state.verifySshHost({ ...env, host: "second" }, a), state.verifySshHost({ ...env, host: "second" }, b)]);
  assert.equal(concurrent.filter(x => x.status === "fulfilled").length, 1);
  await state.saveEnvironment(env);
  t.mock.method(state, "connectSshEnvironment", async () => { throw Object.assign(new Error("changed"), { code: "SSH_HOST_KEY_CHANGED" }); });
  await assert.rejects(state.spawnBackend({ name: env.id }), { code: "SSH_HOST_KEY_CHANGED" });
  await assert.rejects(state.connectFiles({ kind: "ssh", environment: env.id }), { code: "SSH_HOST_KEY_CHANGED" });
  await assert.rejects(state.sftp({ id: "owner" }, env.id, "read", { path: "C:/x" }), { code: "SSH_HOST_KEY_CHANGED" });
});

test("a corrupt SSH identity store cannot silently become first-use trust", async t => {
  const { state } = await fixture(t, () => "");
  for (const text of ["broken JSON", "[]", '{"host:22":true}']) {
    state.sshHostKeys = undefined;
    await writeFile(join(state.base, "ssh-host-keys.json"), text);
    await assert.rejects(state.verifySshHost(env, sshFingerprint(Buffer.from("key"))), { code: "SSH_HOST_STORE_INVALID" });
  }
});

test("SSH handshake verifies before authentication and cancellation closes only its connection", async () => {
  let authenticated = false, destroyed = 0;
  class FakeClient extends EventEmitter {
    connect(config) { config.hostVerifier(Buffer.from("key"), accepted => { if (accepted) { authenticated = true; this.emit("ready"); } else this.emit("error", new Error("rejected")); }); }
    destroy() { destroyed++; }
  }
  await assert.rejects(connectSsh(env, { ClientType: FakeClient, verifyHost: () => { throw Object.assign(new Error("bad host"), { code: "SSH_HOST_KEY_CHANGED" }); } }), { code: "SSH_HOST_KEY_CHANGED" });
  assert.equal(authenticated, false); assert.equal(destroyed, 1);
  class HangingClient extends EventEmitter { connect() {} destroy() { destroyed++; } }
  const controller = new AbortController();
  const pending = connectSsh(env, { ClientType: HangingClient, signal: controller.signal });
  controller.abort(new Error("cancelled"));
  await assert.rejects(pending, /cancelled/); assert.equal(destroyed, 3);
});

test("server-default legacy encoding is symmetric, and stdout/stderr decoders do not merge partial characters", () => {
  const client = new EventEmitter(), channel = new EventEmitter();channel.stderr = new EventEmitter();let written;
  channel.write = value => { written = value; };client.end = () => {};
  const session = new SshTerminalSession(client, channel, { ...env, shell: "server-default", encoding: "gb18030" });
  session.write("中文 空格");assert.equal(iconv.decode(written, "gb18030"), "中文 空格");
  const bytes = iconv.encode("中", "gb18030");
  channel.emit("data", bytes.subarray(0,1));channel.stderr.emit("data", iconv.encode("错", "gb18030"));channel.emit("data", bytes.subarray(1));
  assert.equal(session.output, "错中");
  assert.deepEqual(buildSshShellOptions(env).options, {});
});

test("Windows SFTP retries one process-initialization failure before any file operation, never other failures", async () => {
  const client = new EventEmitter();let count = 0;
  client.sftp = callback => { count++; callback(count === 1 ? Object.assign(new Error("DLL init"), { code: 3221225794 }) : null, count === 1 ? undefined : {}); };
  const value = await openSftpChannel(client, { windows: true });assert.equal(count, 2);assert.equal(value.openAttempts, 2);
  for (const code of [3, "SSH_HOST_KEY_CHANGED"]) {
    count=0;client.sftp = callback => { count++; callback(Object.assign(new Error("failure"), { code })); };
    await assert.rejects(openSftpChannel(client, { windows: true }), { code });assert.equal(count, 1);
  }
  count=0;client.sftp = callback => { count++;callback(Object.assign(new Error("still failed"), { code: 3221225794 })); };
  await assert.rejects(openSftpChannel(client, { windows: true }), { code: 3221225794 });assert.equal(count, 2);
});

test("completed SFTP destroys its owned socket before ssh2 end can make destroy a no-op", () => {
  const client = new EventEmitter();let writable = true, destroyed = 0, subsystem = 0;
  client.end = () => { writable = false; };client.destroy = () => { if (writable) destroyed++; };
  new SftpFiles(client, { end() { subsystem++; } }, undefined, true).close();
  assert.equal(subsystem, 1);assert.equal(destroyed, 1);
});

test("SFTP drive roots, relative paths and case-insensitive containment never depend on DSH host cwd", async () => {
  assert.equal(normalizeSftpPath("C:\\目录\\a b" , true), "/C:/目录/a b");
  assert.equal(normalizeSftpPath("D:/", true), "/D:/");
  assert.equal(normalizeSftpPath("/C:/Dir/a", true), "/C:/Dir/a");
  assert.equal(normalizeSftpPath("~/folder", false), "~/folder");
  assert.throws(() => normalizeSftpPath("C:relative", true), { code: "SFTP_PATH_INVALID" });
  assert.throws(() => normalizeSftpPath("\\\\server\\share", true), { code: "SFTP_PATH_INVALID" });
  assert.equal(remotePathContains("/C:/Work", "/c:/work/child", true), true);
  assert.equal(remotePathContains("/C:/Work", "/D:/Work", true), false);
  assert.equal(remotePathContains("/C:/Work", "/c:/Work-two", true), false);
  const created = [];
  const call = async (method, path) => { if (method === "stat") { if (path === "/C:/") return { mode: 0o040755 }; throw Object.assign(new Error("missing"), { code: 2 }); } created.push(path); };
  await mkdirSftp(call, "C:\\中文\\a b", true);
  assert.deepEqual(created, ["/C:/中文", "/C:/中文/a b"]);
  await assert.rejects(mkdirSftp(async () => { throw Object.assign(new Error("denied"), { code: 3 }); }, "/C:/x", true), { code: 3 });
});

function localWindows(request) {
  return new Promise((resolve, reject) => {
    const [file, ...args] = request.command.split(" ");
    const child = spawn(file, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => stdout += chunk);
    child.stderr.setEncoding("utf8").on("data", chunk => stderr += chunk);
    const timeout = setTimeout(() => { child.kill(); reject(new Error("local Windows script timed out")); }, 20000);
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
    child.stdin.end(request.input ?? "");
  });
}
test("native PowerShell executes Unicode parameters and literal cwd, errors and native exit codes", { skip: process.platform !== "win32" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "dsh win [中文] "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parameters = { name: '中文 space " & | % ! ^\nnext' };
  const value = await localWindows(buildWindowsCommand({ command: "param($name) @{name=$name;cwd=(Get-Location).Path}|ConvertTo-Json -Compress", parameters, workingDirectory: root, shell: "windows-powershell" }));
  assert.equal(value.code, 0, value.stderr);
  assert.deepEqual(JSON.parse(value.stdout.trim()), { name: parameters.name, cwd: root });
  const error = await localWindows(buildWindowsCommand({ command: 'Write-Error "test error"', shell: "windows-powershell" }));
  assert.equal(error.code, 1); assert.match(error.stderr, /test error/);
  const exit = await localWindows(buildWindowsCommand({ command: "cmd.exe /c exit 7", shell: "windows-powershell" }));
  assert.equal(exit.code, 7);
  const cmd = await localWindows(buildWindowsCommand({ command: 'echo 中文\necho a^&b\necho 100%%\nexit /b 3', workingDirectory: root, shell: "cmd" }));
  assert.equal(cmd.code, 3, cmd.stderr); assert.match(cmd.stdout, /中文/); assert.match(cmd.stdout, /a&b/); assert.match(cmd.stdout, /100%/);
  const probe = await localWindows(windowsProbeCommand());
  assert.equal(probe.code, 0, probe.stderr);
  const facts = JSON.parse(probe.stdout.trim());
  assert.equal(facts.platform, "windows"); assert.ok([1, 2, 3].includes(facts.productType)); assert.ok(facts.osVersion);
});

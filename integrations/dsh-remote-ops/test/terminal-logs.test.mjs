import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fixture, OWNER } from "./helpers.mjs";
import { TerminalOutputBuffer } from "../lib/output-buffer.js";
import { expectAgentEcho } from "../lib/terminal-echo.js";
import { logText } from "../lib/log-archive.js";
import { registerLogRoutes } from "../lib/log-routes.js";
import { registerTools } from "../lib/tools.js";
import { registerBundledSkills } from "../lib/skills.js";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
const context = {};
vm.runInNewContext(source.slice(source.indexOf("    const terminalScreenModel ="), source.indexOf("    const parseSshCommand =")).replace("const terminalScreenModel", "globalThis.model").replace("const terminalVisibleText = (value, rows = 40, columns = 160) => terminalScreenModel", "const terminalVisibleText = (value, rows = 40, columns = 160) => model").replace("const terminalLineTone", "globalThis.tone").replace("const terminalSemanticRuns", "globalThis.semantic"), context);
const model = context.model;
const roles = screen => screen.runs?.flat().filter(run => run.role).map(run => run.text).join("") ?? "";
const sshLog = (state, owner = OWNER, id = "ssh-one", text = "device> echo one\r\none\r\n") => {
  const session = { outputBuffer: new TerminalOutputBuffer(), status: () => ({ kind: "running" }) };
  session.outputBuffer.append(text);
  const environment = { name: "存储/设备", host: "storage.example", port: 22 };
  const record = { sessionId: id, owner, ownerId: owner.id, session, environment };
  state.sessions.set(id, record); state.trackTerminalLog(owner, id, session, environment);
  return record;
};
const unzip = data => {
  const files = new Map(); let offset = 0;
  while (data.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(data.readUInt16LE(offset + 6), 0x800);
    assert.equal(data.readUInt16LE(offset + 8), 8);
    const bytes = data.readUInt32LE(offset + 18), size = data.readUInt32LE(offset + 22), nameSize = data.readUInt16LE(offset + 26), extra = data.readUInt16LE(offset + 28);
    const name = data.subarray(offset + 30, offset + 30 + nameSize).toString("utf8"), start = offset + 30 + nameSize + extra;
    const raw = inflateRawSync(data.subarray(start, start + bytes)); assert.equal(raw.length, size);
    assert.ok(!/[\\/]/u.test(name)); files.set(name, raw.toString("utf8")); offset = start + bytes;
  }
  assert.equal(data.readUInt32LE(offset), 0x02014b50);
  assert.equal(data.readUInt32LE(data.length - 22), 0x06054b50);
  assert.equal(data.readUInt16LE(data.length - 12), files.size);
  return files;
};

test("Agent echo annotations identify only the leading echoed command across chunks/ANSI, never insert hidden input", () => {
  const buffer = new TerminalOutputBuffer(); buffer.append("device> ");
  expectAgentEcho(buffer, "show status", true);
  buffer.append("\x1b[3"); buffer.append("2mshow st"); buffer.append("atus\x1b[0m\r\nshow status\r\n");
  assert.equal(buffer.commandAnnotations.length, 1);
  const screen = model(buffer.value, 40, 160, { decorate: true, commandAnnotations: buffer.commandAnnotations });
  assert.equal(roles(screen), "show status");
  const before = buffer.value;
  expectAgentEcho(buffer, "HIDDEN_PASSWORD", true); buffer.append("\r\nWelcome\r\n");
  assert.equal(buffer.value, before + "\r\nWelcome\r\n"); assert.ok(!buffer.value.includes("HIDDEN_PASSWORD"));
  assert.equal(buffer.commandAnnotations.length, 1);
  expectAgentEcho(buffer, "raw\x03keys", true); assert.equal(buffer.pendingEcho, undefined);
});

test("send metadata marks Agent echo but human input and raw secret input remain unannotated", async t => {
  const { state, terminal } = await fixture(t, text => text.startsWith("echo ") ? `${text.trim()}\r\nOK\r\n` : "");
  await state.send(OWNER, "local-cmd", { text: "echo colored", quietMs: 30, timeoutSeconds: 1, autoSigint: false });
  let frame = await state.terminalOutput(OWNER, "local-cmd", 0);
  assert.equal(frame.commandAnnotations.length, 1);
  await state.send(OWNER, "local-cmd", { text: "echo manual", actor: "manual", quietMs: 30, timeoutSeconds: 1 });
  await state.input(OWNER, "local-cmd", "SECRET\r");
  frame = await state.terminalOutput(OWNER, "local-cmd", 0);
  assert.equal(frame.commandAnnotations.length, 1); assert.ok(!frame.text.includes("SECRET"));
  assert.deepEqual(terminal.writes, ["echo colored\r", "echo manual\r", "SECRET\r"]);
});

test("decorating SGR/commands preserves text, wrapping, Unicode, cursor edits and alternate-screen geometry", () => {
  const inputs = ["\x1b[32mhello\x1b[0m world\r\n", "a\r\n\r\n\x1b[91mERROR: bad\x1b[0m", "\x1b[34m中文\x1b[0m\r\nhello", "hello\rX\x1b[0K", "\x1b[?1049h\x1b[2;1Htop\x1b[31m红\x1b[0m\x1b[?25l", "shell>\x1b[?1049heditor\x1b[?1049l", "e\u0301\x1b[2G!", "0123456789", "abc  \r\n", "\r\n\r\n"];
  for (const input of inputs) for (const columns of [5, 80]) {
    const decorated = model(input, 4, columns, { decorate: true, commandAnnotations: [{ startOffset: 0, endOffset: 3 }] });
    const { runs, ...geometry } = decorated;
    assert.deepEqual(JSON.parse(JSON.stringify(geometry)), JSON.parse(JSON.stringify(model(input, 4, columns))), input);
    if (runs) assert.equal(runs.map(line => line.map(run => run.text).join("")).join("\n"), decorated.text);
  }
  assert.match(model("\x1b[38;2;12;34;56mRGB", 40, 160, { decorate: true }).runs[0][0].style.color, /rgb\(12,34,56\)/);
  assert.equal(roles(model("cmd", 40, 160, { decorate: true, highlight: false, commandAnnotations: [{ startOffset: 0, endOffset: 3 }] })), "");
});

test("keyword highlighting is conservative and disabled on full-screen programs", () => {
  assert.equal(context.tone("ERROR: device failed", false), "error");
  assert.equal(context.tone("[WARNING] capacity", false), "warning");
  assert.equal(context.tone("[OK] connected", false), "success");
  for (const text of ["0 errors", "failure_count=0", "echo ERROR: test"]) assert.equal(context.tone(text, false), undefined);
  assert.equal(context.tone("ERROR: screen", true), undefined);
});

test("visible CMD and common shell prompts highlight manual/raw commands after ConPTY edits, without adding input", () => {
  const raw = "\x1b[?25l\x1b[2J\x1b[HC:\\ops>dix\x1b[1;10Hr\r\noutput\r\nC:\\ops>\x1b[?25h";
  const screen = model(raw, 40, 160, { decorate: true });
  const runs = screen.text.split("\n").map((line, index) => context.semantic(screen.runs[index], line, false));
  assert.equal(roles({ runs }), "dir");
  assert.equal(runs.map(line => line.map(run => run.text).join("")).join("\n"), screen.text);
  for (const prompt of ["C:\\ops>", "PS C:\\ops> ", "user@host:~$ ", "[root@host ~]# "]) {
    const line = prompt + "echo one  two";
    const decorated = context.semantic(undefined, line, false);
    assert.equal(decorated.filter(run => run.role).map(run => run.text).join("").trim(), "echo one  two");
    assert.equal(decorated.map(run => run.text).join(""), line);
    assert.equal(context.semantic(undefined, prompt, false), undefined);
  }
  for (const line of ["Password: ", "Enter passphrase: ", "echo dir", "0 errors", "2026/10/17 not a listing", "value> 1"]) assert.equal(context.semantic(undefined, line, false), undefined);
});

test("standard dir rows color only the names, including Chinese names, spaces, numeric names and links", () => {
  for (const [line, name, role] of [
    ["2026/10/17  18:27    <DIR>          项目 文件", "项目 文件", "directory"],
    ["10/17/2026  06:27 PM    <DIR>          reports", "reports", "directory"],
    ["17.10.2026  18:27             1,024 123 report.txt", "123 report.txt", "file"],
    ["2026/10/17  下午 06:27            0 空文件.txt", "空文件.txt", "file"],
    ["2026/10/17  18:27    <JUNCTION>     junction [C:\\target]", "junction [C:\\target]", "directory"],
    ["2026/10/17  18:27    <SYMLINK>      link.txt [target.txt]", "link.txt [target.txt]", "file"],
  ]) {
    const runs = context.semantic(undefined, line, false);
    assert.equal(runs.map(run => run.text).join(""), line);
    assert.equal(runs.filter(run => run.role).map(run => run.text).join(""), name);
    assert.equal(runs.at(-1).role, role);
  }
  for (const line of ["               1 File(s)             26 bytes", "               6 Dir(s)  1,000 bytes free", "README.md", "a <DIR> b", "ERROR: 2026/10/17 18:27 1 log"]) assert.equal(context.semantic(undefined, line, false), undefined);
});

test("semantic decorations preserve ANSI runs and Agent markers, and respect disabled/full-screen display", () => {
  const line = "C:\\ops>dir", runs = [{ text: "C:\\ops>", style: {} }, { text: "dir", style: { color: "red" }, role: "agent-command" }];
  const shown = context.semantic(runs, line, false);
  assert.equal(shown.at(-1).role, "agent-command"); assert.equal(shown.at(-1).style.color, "red");
  assert.equal(context.semantic(runs, line, true), runs); assert.equal(context.semantic(runs, line, false, false), runs);
  const listing = "2026/10/17  18:27    <DIR>          folder";
  const colored = [{ text: listing.slice(0, -6) }, { text: "folder", style: { color: "green" } }];
  assert.equal(context.semantic(colored, listing, false).at(-1).style.color, "green");
});

test("logs list and read use retained data without executing, include closed terminals and isolate other owners", async t => {
  const { state, terminal } = await fixture(t, () => "");
  const own = sshLog(state), other = sshLog(state, { id: "other" }, "ssh-other", "FOREIGN_SECRET");
  state.sessions.delete(own.sessionId);
  const list = await state.listTerminalLogs(OWNER);
  assert.equal(list.logs.length, 2); assert.equal(list.logs.find(item => item.kind === "ssh").archived, true);
  assert.equal(list.retention.survivesRestart, false);
  const read = await state.readTerminalLog(OWNER, { logId: own.session.remoteLogId });
  assert.match(read.text, /echo one\none/); assert.equal(read.completion, "unknown");
  await assert.rejects(state.readTerminalLog(OWNER, { logId: other.session.remoteLogId }), /TERMINAL_LOG_NOT_FOUND/);
  assert.deepEqual(terminal.writes, []);
});

test("pagination starts at oldest retained output, preserves raw offsets/Unicode and explicitly reports gaps", async t => {
  const { state } = await fixture(t, () => "");
  const session = state.localSession; session.outputBuffer = new TerminalOutputBuffer(36, 28);
  session.outputBuffer.append("old ".repeat(20)); session.outputBuffer.append("\x1b[32m中😀\x1b[0m\r\nend");
  const list = await state.listTerminalLogs(OWNER), id = list.logs[0].logId;
  let cursor = 0, content = "", count = 0;
  do {
    const page = await state.readTerminalLog(OWNER, { logId: id, cursor, maxChars: 4 });
    assert.equal(page.truncated, true); if (!count) assert.equal(page.gap, true);
    assert.ok(page.nextOffset > cursor); assert.ok(!page.text.includes("\ufffd")); content += page.text; cursor = page.nextOffset; count++;
    if (!page.hasMore) break;
    assert.ok(count < 30);
  } while (true);
  assert.match(content, /中😀/); assert.match(content, /end$/);
  await assert.rejects(state.readTerminalLog(OWNER, { logId: id, streamId: "old-stream" }), /TERMINAL_STREAM_CHANGED/);
  await assert.rejects(state.readTerminalLog(OWNER, { logId: id, cursor: 999 }), /TERMINAL_LOG_INVALID/);
});

test("ZIP packages freeze multiple logs, clean controls, keep unique safe names and include coverage manifest and checksum", async t => {
  const { state } = await fixture(t, () => "");
  const a = sshLog(state), b = sshLog(state, OWNER, "ssh-two", "\x1b[31mERROR: B\x1b[0m\r\n");
  a.session.outputBuffer.append("\x1b]0;PRIVATE_TITLE\x07A🙂\r\n");
  const result = await state.exportTerminalLogs(OWNER, { logIds: [a.session.remoteLogId, b.session.remoteLogId], format: "zip" });
  a.session.outputBuffer.append("AFTER_EXPORT");
  const data = state.getLogExport(OWNER, result.exportId).data, files = unzip(data);
  assert.equal(files.size, 3); assert.equal(result.sha256, createHash("sha256").update(data).digest("hex"));
  const manifest = JSON.parse(files.get("manifest.json"));
  assert.equal(manifest.logs.length, 2);
  for (const [name, text] of files) { assert.ok(!text.includes("AFTER_EXPORT")); assert.ok(!text.includes("PRIVATE_TITLE")); assert.ok(!text.includes("\x1b")); if (name !== "manifest.json") assert.match(text, /Raw offsets:/); }
  assert.match([...files.values()].join("\n"), /A🙂/);
  assert.throws(() => state.getLogExport({ id: "other" }, result.exportId), /TERMINAL_LOG_EXPORT_NOT_FOUND/);
  const entry = state.logExports.get(result.exportId); entry.info.expiresAt = "2000-01-01T00:00:00.000Z";
  assert.throws(() => state.getLogExport(OWNER, result.exportId), /TERMINAL_LOG_EXPORT_NOT_FOUND/);
});

test("exports validate the whole selection and enforce bounds before producing any artifact", async t => {
  const { state } = await fixture(t, () => ""); const a = sshLog(state), b = sshLog(state, { id: "other" }, "ssh-other");
  for (const args of [{ logIds: JSON.stringify([a.session.remoteLogId]) }, { logIds: [a.session.remoteLogId, a.session.remoteLogId] }, { logIds: [] }, { all: true, logIds: [] }, { logIds: [a.session.remoteLogId, b.session.remoteLogId] }, { all: true, format: "txt" }]) await assert.rejects(state.exportTerminalLogs(OWNER, args));
  assert.equal(state.logExports?.size ?? 0, 0);
  const result = await state.exportTerminalLogs(OWNER, { all: true, format: "zip" });
  assert.equal(result.manifest.logs.length, 2);
  a.session.outputBuffer.byteLength = 33 * 1024 * 1024;
  await assert.rejects(state.exportTerminalLogs(OWNER, { logIds: [a.session.remoteLogId] }), /TERMINAL_LOG_TOO_LARGE/);
});

test("closed log retention is bounded and reports eviction without hiding active logs", async t => {
  const { state } = await fixture(t, () => "");
  for (let i = 0; i < 36; i++) { const record = sshLog(state, OWNER, `ssh-${i}`); state.sessions.delete(record.sessionId); }
  const catalog = await state.listTerminalLogs(OWNER);
  assert.equal(catalog.logs.filter(item => item.archived).length, 32); assert.equal(catalog.evictedLogs, 4);
  assert.equal(catalog.logs.filter(item => !item.archived).length, 1);
});

test("native tools, bundled skill and HTTP routes produce an owner-scoped downloadable artifact", async t => {
  const { state, ctx } = await fixture(t, () => "");
  const tools = new Map(), routes = new Map(); let provider;
  ctx.tools = { register: definition => tools.set(definition.name, definition) }; ctx.systemPrompt = { section() {} };
  ctx.agents = { get: id => id === OWNER.id ? OWNER : id === "other" ? { id } : undefined };
  ctx.effect = effect => effect(); ctx.connection = { fetch: { register: route => routes.set(route.path, route) } };
  registerTools(ctx, state); registerLogRoutes(ctx, state);
  registerBundledSkills({ inject: (_names, ready) => ready({ skills: { registerProvider: factory => { provider = factory(); } } }) });
  const skill = await provider.get((await provider.list()).find(item => item.name === "remote-ops-terminal-logs"));
  assert.match(skill.content, /remote_terminal_log_export/);
  const read = tools.get("remote_terminal_log_read"); assert.deepEqual(read.parameters.required, ["logId"]);
  const list = await tools.get("remote_terminal_logs").execute({}, { agent: OWNER });
  const result = await tools.get("remote_terminal_log_export").execute({ logIds: [list.logs[0].logId] }, { agent: OWNER });
  const download = routes.get("/api/dsh-remote-ops/log-download");
  assert.equal(result.downloadUrl, null);
  const response = await download.fetch(new Request(`http://localhost${result.downloadPath}`));
  assert.equal(response.status, 200); assert.match(response.headers.get("Content-Disposition"), /attachment/);
  assert.match(await response.text(), /Remote Ops terminal transcript/);
  assert.equal((await download.fetch(new Request(`http://localhost${result.downloadPath.replace("sessionId=agent", "sessionId=other")}`))).status, 404);
  const route = routes.get("/api/dsh-remote-ops/logs");
  const exported = await route.fetch(new Request("http://localhost/api/dsh-remote-ops/logs", { method: "POST", body: JSON.stringify({ action: "export", all: true, format: "zip" }) }));
  assert.equal(exported.status, 200); assert.equal((await exported.json()).manifest.logs.length, 1);
});

test("chat download URLs use a trusted observed browser origin and missing origins never invent a host", async t => {
  const { state, ctx } = await fixture(t, () => ""); let observe, delegated = 0;
  ctx.effect = effect => effect(); ctx.on = (_event, callback) => { observe = callback; };
  ctx.connection = { fetch: { register() {} }, requestRejection: request => request.headers.origin === "https://dsh.example:8443" ? undefined : 403 };
  registerLogRoutes(ctx, state);
  for (const source of [undefined, "null", "file:///private", "https://untrusted.example/", "https://user:secret@dsh.example:8443/"]) {
    await observe({ headers: { referer: source } }, {}, async () => { delegated++; });
    assert.equal(state.logDownloadOrigin, undefined);
  }
  await observe({ headers: { referer: "https://dsh.example:8443/?unused=sensitive", host: "dsh.example:8443" } }, {}, async () => { delegated++; });
  const exported = await state.exportTerminalLogs(OWNER, { all: true, format: "zip" });
  assert.match(exported.downloadUrl, /^https:\/\/dsh\.example:8443\/api\/dsh-remote-ops\/log-download\?/);
  assert.ok(!exported.downloadUrl.includes("sensitive")); assert.equal(delegated, 6);
  state.localSession = undefined; state.terminalLogs = undefined;
  await assert.rejects(state.readTerminalLog(OWNER, { logId: "missing" }), /TERMINAL_LOG_NOT_FOUND/);
});

test("transcript cleanup strips OSC/DCS/control sequences and normalizes progress and backspaces", () => {
  assert.equal(logText("ab\bc\r10%\r100%\r\n\x1b]title\x07\x1bPsecret\x1b\\done\x00\x1b[31"), "ac\n10%\n100%\ndone");
});

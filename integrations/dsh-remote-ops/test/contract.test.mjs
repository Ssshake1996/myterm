import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = async (path) => readFile(new URL(path, root), "utf8");
const manifest = JSON.parse(await read("package.json"));
const client = await read("lib/client.js");
const server = await read("lib/index.js");
const releaseScript = await read("../../scripts/release-dsh-remote-ops.ps1");
const testPlan = await read("../../docs/testing/dsh-remote-ops-test-plan.md");

test("package exposes one reproducible regression gate", () => {
  assert.equal(manifest.private, false);
  assert.equal(manifest.scripts.test, "npm run test:unit && npm run test:client && npm run test:contract && npm run test:smoke");
  assert.match(manifest.scripts.check, /node --check lib\/index\.js/);
  assert.match(manifest.scripts.check, /npm test/);
  assert.match(releaseScript, /npm run check/);
  assert.match(testPlan, /发布门禁/);
});

test("all remote operation tools remain registered", () => {
  const requiredTools = [
    "remote_environment_list", "remote_environment_create", "remote_environment_delete",
    "remote_environment_group_create", "remote_environment_group_rename", "remote_environment_group_delete",
    "remote_terminal_open", "remote_terminal_send", "remote_terminal_input", "remote_terminal_read",
    "remote_terminal_signal", "remote_terminal_close", "remote_terminal_batch",
    "remote_quick_command_list", "remote_quick_command_save", "remote_quick_command_delete",
    "remote_quick_command_group_create", "remote_quick_command_group_delete", "remote_quick_command_run",
    "remote_sftp_list", "remote_sftp_read", "remote_sftp_write", "remote_sftp_mkdir",
    "remote_sftp_delete", "remote_sftp_rename", "remote_sftp_upload", "remote_sftp_download", "remote_diagnostics",
  ];
  for (const name of requiredTools) assert.match(server, new RegExp(`name: "${name}"`), `${name} is missing`);
});

test("terminal rendering and transport invariants remain present", () => {
  assert.match(client, /box-sizing:border-box/);
  assert.match(client, /overflow-y:scroll/);
  assert.match(client, /scrollbar-gutter:stable/);
  assert.match(client, /terminalFramesRef/);
  assert.match(client, /waitMs/);
  assert.match(client, /rawInputSending/);
  assert.match(client, /terminalVisibleText/);
  assert.match(client, /terminalScreenModel/);
  assert.match(client, /parseSshCommand/);
  assert.doesNotMatch(client, /terminalVisibleText\(activeSession\.viewport\)/);
  assert.match(server, /\/api\/dsh-remote-ops\/terminal/);
  assert.match(server, /Math\.min\(25_000/);
  assert.match(server, /Cache-Control.*no-store/);
  assert.doesNotMatch(server, /export LANG=C\.UTF-8/);
  assert.match(server, /LC_CTYPE/);
});

test("terminal controls expose usable focus and clear panel toggles", () => {
  assert.match(client, /terminalInputRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(client, /terminalInputRef\.current\?\.focus\(\)/);
  assert.match(client, /setDrawer\(\(value\) => !value\)/);
  assert.match(client, /dsh-remote-ops__headAction/);
  assert.match(client, /dsh-remote-ops__drawerClose/);
  assert.match(client, /aria-expanded/);
  assert.match(client, /state-error-primary/);
  assert.match(client, /dsh-remote-ops__inputCursor/);
  assert.match(client, /onCompositionStart/);
  assert.match(client, /onCompositionEnd/);
  assert.match(client, /event\.isComposing/);
  assert.doesNotMatch(client, /position:absolute;left:12px;bottom:10px/);
});

test("terminal transport exposes exact submitted text and existing-session reconciliation", () => {
  assert.match(server, /submittedText/);
  assert.match(server, /reconcileHostSessions/);
  assert.match(server, /terminals\.list/);
  assert.match(server, /openings/);
  assert.match(server, /MAX_SESSIONS_PER_ENVIRONMENT/);
  assert.match(server, /REMOTE_SESSION_LIMIT/);
  assert.match(server, /REMOTE_SESSION_REQUIRED/);
  assert.match(server, /connectionCount/);
  assert.match(server, /listLocalFiles/);
  assert.match(server, /findEnvironmentBySessionName\(spec\.name\)/);
});

test("environment, quick command, SFTP and update routes stay available", () => {
  for (const marker of [
    "/api/dsh-remote-ops/state", "/api/dsh-remote-ops/action", "/api/dsh-remote-ops/update",
    "environment.save", "quick.save", "remote_sftp_list", "remote_terminal_batch", "fetchLatestRelease",
  ]) assert.match(server, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${marker} is missing`);
  assert.match(client, /dsh-remote-ops__sftpWorkspace/);
  assert.match(client, /action: "files"/);
  assert.match(client, /action: "transfer"/);
  assert.match(client, /\/api\/dsh-remote-ops\/browser-file/);
  assert.match(client, /action: "close"/);
  assert.match(client, /dsh-remote-ops__sftpIcon/);
  assert.doesNotMatch(client, /`\$\{item\.type === "d" \? "目录" : "文件"\}/);
});

test("environment form hides internal ids and defaults blank names to the host", () => {
  assert.doesNotMatch(client, /环境 ID/);
  assert.match(client, /environmentForm\.name\.trim\(\) \|\| environmentForm\.host\.trim\(\)/);
  assert.match(client, /environmentForm\.id \? \{ id: environmentForm\.id\.trim\(\) \} : \{\}/);
  assert.match(server, /toLosslessJson\(await definition\.execute/);
  assert.doesNotMatch(server, /id: stringParam\("Stable environment id", true\)/);
});

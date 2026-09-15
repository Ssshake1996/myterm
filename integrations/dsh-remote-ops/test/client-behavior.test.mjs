import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

function loadClientFunction(name, endMarker) {
  const start = source.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `client function ${name} must exist`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `client function ${name} must have a stable boundary`);
  const segment = source.slice(start, end).replace(`const ${name}`, `globalThis.${name}`);
  const context = {};
  vm.runInNewContext(segment, context, { filename: "client.js" });
  return context[name];
}

const terminalVisibleText = loadClientFunction("terminalVisibleText", "    const ask =");
const parseSshCommand = loadClientFunction("parseSshCommand", "\n\n    const terminalInputEnabled");
const terminalInputEnabled = loadClientFunction("terminalInputEnabled", "\n    function RemoteOpsPanel");

test("VT screen model removes ConPTY initialization blank rows", () => {
  const initial = "\u001b[?25l\u001b[2J\u001b[m\u001b[H\r\n" + "\r\n".repeat(38) + "\u001b[2;34HC:\\Users\\tester\\.dsh\\remote-ops>";
  const visible = terminalVisibleText(initial);
  assert.equal(visible.trimStart(), "C:\\Users\\tester\\.dsh\\remote-ops>");
  assert.equal(visible.includes("\n\n"), false);
});

test("VT screen model preserves cursor overwrites and scrollback", () => {
  assert.equal(terminalVisibleText("old\rnew"), "new");
  assert.equal(terminalVisibleText("one\r\ntwo\r\nthree"), "one\ntwo\nthree");
  assert.equal(terminalVisibleText("\u001b[2J\u001b[Hprompt>"), "prompt>");
});

test("SSH command parser preserves user-supplied host, port and key", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseSshCommand('ssh -p 2200 -i "C:\\keys\\id_ed25519" root@example.com'))), {
    host: "example.com",
    username: "root",
    port: 2200,
    privateKeyPath: "C:\\keys\\id_ed25519",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(parseSshCommand("ssh -l admin 10.0.0.8"))), { host: "10.0.0.8", username: "admin", port: 22, privateKeyPath: "" });
  assert.match(parseSshCommand("ssh")?.error, /缺少主机地址/);
  assert.equal(parseSshCommand("echo ssh root@example.com"), undefined);
});

test("local terminal stays writable before Harness Agent binding", () => {
  assert.equal(terminalInputEnabled({ bound: false, sessions: [{ kind: "local", status: { kind: "running" } }] }), true);
  assert.equal(terminalInputEnabled({ bound: true, sessions: [] }), true);
  assert.equal(terminalInputEnabled({ bound: false, sessions: [{ kind: "local", status: { kind: "starting" } }] }), false);
});

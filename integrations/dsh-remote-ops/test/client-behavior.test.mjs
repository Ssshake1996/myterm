import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

function loadClientFunction(name, endMarker, includeFrom = name, globals = {}) {
  const start = source.indexOf(`const ${includeFrom} =`);
  assert.ok(start >= 0, `client function ${name} must exist`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `client function ${name} must have a stable boundary`);
  const segment = source.slice(start, end).replace(`const ${name}`, `globalThis.${name}`);
  const context = { ...globals };
  vm.runInNewContext(segment, context, { filename: "client.js" });
  return context[name];
}

const terminalScreenModel = loadClientFunction("terminalScreenModel", "    const terminalVisibleText");
const terminalVisibleText = loadClientFunction("terminalVisibleText", "    const ask =", "terminalScreenModel");
const parseSshCommand = loadClientFunction("parseSshCommand", "\n\n    const terminalInputEnabled");
const terminalInputEnabled = loadClientFunction("terminalInputEnabled", "\n    function RemoteOpsPanel");
const terminalInputCompositionValue = loadClientFunction("terminalInputCompositionValue", "\n    function RemoteOpsPanel");

test("shared navigation suppresses the fallback and restores it after unload", () => {
  let plugin;
  const disposers = [];
  const dependencies = new Map();
  let launcher;
  const h = (type, props) => typeof type === "function" ? type(props) : ({ type, props });
  const context = {
    window: { __ModuleLoader__: { load: (definition) => { plugin = definition.factory((name) => name === "react" ? { createElement: h, useSyncExternalStore: (_subscribe, snapshot) => snapshot() } : {}); } } },
    document: { getElementById: () => ({ textContent: "" }) },
  };
  vm.runInNewContext(source, context);
  const ctx = {
    inject: (names, callback) => dependencies.set(names.join(","), callback),
    effect: (fn) => { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); },
    locale: { bind: () => () => "Remote Ops", register: () => () => {} },
    slots: { inject: (_name, fn) => fn(), register: (_definition, render) => { launcher = render; } },
  };
  plugin.apply(ctx);
  assert.equal(launcher({wide:true}).type, "button");
  dependencies.get("pluginNavigation")(ctx);
  assert.equal(launcher({wide:true}), null);
  disposers.pop()();
  assert.equal(launcher({wide:true}).type, "button");
});

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

test("VT screen model exposes the real cursor position", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(terminalScreenModel("abc"))), { text: "abc", cursor: { row: 0, column: 3 } });
  assert.deepEqual(JSON.parse(JSON.stringify(terminalScreenModel("\u001b[2J\u001b[Hprompt>"))), { text: "prompt>", cursor: { row: 0, column: 7 } });
});

test("terminal wide characters preserve cursor placement after absolute positioning", () => {
  assert.equal(terminalScreenModel("中文\u001b[5G!").text, "中文!");
  assert.equal(terminalScreenModel("中文\u001b[5G!").cursor.column, 3);
  assert.equal(terminalScreenModel("e\u0301x\u001b[2G!").text, "e\u0301!");
});

test("terminal preferences clamp invalid values and paste previews stay pinned to the original target", () => {
  const prefs = loadClientFunction("terminalPreferences", "\n    const pasteSubmission");
  assert.deepEqual(JSON.parse(JSON.stringify(prefs({fontSize:100,wrap:false,quickHeight:-5}))), {fontSize:22,wrap:false,quickHeight:92});
  const paste = loadClientFunction("pasteSubmission", "\n    const outputMatches");
  assert.equal(paste({session:"one",owner:"a",text:"echo one\r\necho two"},"a").text,"echo one\recho two");
  assert.throws(() => paste({session:"one",owner:"a",text:"x"},"b"), /PASTE_TARGET_CHANGED/);
  const matches = loadClientFunction("outputMatches", "\n    function SftpWorkspace");
  assert.deepEqual(JSON.parse(JSON.stringify(matches("One\none two\nthree","one"))), [0,1]);
});

test("file requests contain endpoint identity, not directory rows or checkbox state", () => {
  const endpoint = loadClientFunction("fileEndpoint", "\n    function SftpWorkspace");
  assert.deepEqual(JSON.parse(JSON.stringify(endpoint({kind:"host",path:"C:/work",entries:["private"],selected:["a"],draft:"unsubmitted"}))), {kind:"host",path:"C:/work"});
});

test("browser failures retain HTTP status, phase, code and original stack", () => {
  const message = loadClientFunction("failureMessage", "\n    async function request");
  const value = message({code:"EACCES",stage:"file-transfer",error:"denied",stack:"original stack"},400);
  for (const part of ["HTTP 400", "EACCES", "file-transfer", "denied", "original stack"]) assert.ok(value.includes(part));
});

test("copy reports restricted browser clipboard access without an unhandled TypeError", async () => {
  const write = loadClientFunction("writeClipboard", "\n    const terminalPreferences", "writeClipboard", {navigator:{}});
  await assert.rejects(write("selected output"), /CLIPBOARD_UNAVAILABLE/);
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

test("IME composition does not submit intermediate roman characters", () => {
  assert.equal(terminalInputCompositionValue("n", true), undefined);
  assert.equal(terminalInputCompositionValue("ni", true), undefined);
  assert.equal(terminalInputCompositionValue("你", false), "你");
});

test("terminal frames reset on stream replacement and reject discontinuous deltas", () => {
  const mergeTerminalFrame = loadClientFunction("mergeTerminalFrame", "\n    const queueTerminalInput");
  const first = mergeTerminalFrame(undefined, { streamId: "first", text: "abc", startOffset: 0, nextOffset: 3, reset: true });
  const next = mergeTerminalFrame(first, { streamId: "first", text: "def", startOffset: 3, nextOffset: 6, reset: false });
  assert.equal(next.raw, "abcdef");
  const replacement = mergeTerminalFrame(next, { streamId: "second", text: "new", startOffset: 0, nextOffset: 3, reset: true });
  assert.equal(replacement.raw, "new");
  assert.throws(() => mergeTerminalFrame(next, { streamId: "first", text: "lost", startOffset: 8, nextOffset: 12, reset: false }), /TERMINAL_CURSOR_MISMATCH/);
});

test("queued input remains pinned to the terminal and owner selected when typing", () => {
  const queueTerminalInput = loadClientFunction("queueTerminalInput", "\n    function RemoteOpsPanel");
  const queue = [];
  queueTerminalInput(queue, { session: "a", sessionId: "owner-1", text: "echo " });
  queueTerminalInput(queue, { session: "a", sessionId: "owner-1", text: "one\r" });
  queueTerminalInput(queue, { session: "b", sessionId: "owner-1", text: "two\r" });
  queueTerminalInput(queue, { session: "a", sessionId: "owner-2", text: "three\r" });
  assert.deepEqual(JSON.parse(JSON.stringify(queue)), [
    { session: "a", sessionId: "owner-1", text: "echo one\r" },
    { session: "b", sessionId: "owner-1", text: "two\r" },
    { session: "a", sessionId: "owner-2", text: "three\r" },
  ]);
});

test("returning from SFTP restores history position or follows latest output according to user intent", () => {
  const saved = { current: undefined };
  let cleanup;
  let previousDeps;
  let pendingEffect;
  let onResize;
  const viewport = loadClientFunction("useTerminalViewport", "\n    function RemoteOpsPanel", "useTerminalViewport", {
    useRef: (initial) => { if (!saved.current) saved.current = initial; return saved; },
    useEffect: (effect, deps) => {
      if (!previousDeps || deps.some((value, index) => value !== previousDeps[index])) {
        cleanup?.(); pendingEffect = effect; previousDeps = deps;
      }
    },
    window: { requestAnimationFrame: (callback) => { callback(); return 1; }, cancelAnimationFrame() {} },
    ResizeObserver: class { constructor(callback) { onResize = callback; } observe() {} disconnect() {} },
  });
  const output = { current: { scrollTop: 0, scrollHeight: 5000 } };
  const follow = { current: true };
  let rememberScroll;
  const render = (module, height = 190) => {
    rememberScroll = viewport(output, follow, "owner:cmd", "same output", module, true, height);
    if (pendingEffect) { cleanup = pendingEffect(); pendingEffect = undefined; }
  };
  render("terminal");
  assert.equal(output.current.scrollTop, 5000);
  follow.current = false;
  output.current.scrollTop = 1234;
  rememberScroll(output.current);
  // A detached DOM node reports zero before passive effect cleanup runs.
  output.current.scrollTop = 0;
  render("sftp");
  output.current = { scrollTop: 0, scrollHeight: 5000 };
  render("terminal");
  assert.equal(output.current.scrollTop, 1234);
  follow.current = true;
  render("sftp");
  output.current = { scrollTop: 0, scrollHeight: 5100 };
  render("terminal");
  assert.equal(output.current.scrollTop, 5100);
  output.current.scrollTop = 2000;
  render("terminal", 280);
  assert.equal(output.current.scrollTop, 5100);
  output.current.scrollHeight = 6000;
  onResize?.();
  assert.equal(output.current.scrollTop, 6000);
});

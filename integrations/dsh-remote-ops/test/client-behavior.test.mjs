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
const parseSshCommand = loadClientFunction("parseSshCommand", "\n    const terminalUsesGrid");
const environmentProfileValues = loadClientFunction("environmentProfileValues", "\n    // end environment form helpers");
const environmentProfileFromForm = loadClientFunction("environmentProfileFromForm", "\n    // end environment form helpers");
const terminalSizeOptions = loadClientFunction("terminalSizeOptions", "\n    // end environment form helpers", "TERMINAL_SIZE_PRESETS");
const terminalSizeFromValue = loadClientFunction("terminalSizeFromValue", "\n    // end environment form helpers");
const uiNode = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
const environmentAdvancedFields = loadClientFunction("environmentAdvancedFields", "\n    // end environment form helpers", "environmentAdvancedFields", { h: uiNode });
const terminalSizeSelect = loadClientFunction("terminalSizeSelect", "\n    // end environment form helpers", "TERMINAL_SIZE_PRESETS", { h: uiNode });
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

// Export names from DSH ui-primitives 0.2.0-rc.2 and the older Web host.
const iconExports = [
  ["IconStopFill16", "IconStopFillRegular"],
  ["IconRefreshOutline16", "IconRefreshOutlineRegular"],
  ["IconDownloadOutline16", "IconDownloadOutlineRegular"],
  ["IconPanelLeftOutline16", "IconPanelLeftOutlineRegular"],
  ["IconCopyOutline16", "IconCopyOutlineRegular"],
  ["IconEditOutline16", "IconEditOutlineRegular"],
  ["IconFolderClose16", "IconFolderCloseRegular"],
  ["IconPlayOutline16", "IconPlayOutlineRegular"],
  ["IconSearchOutline16", "IconSearchOutlineRegular"],
  ["IconPlusOutline16", "IconPlusOutlineRegular"],
  ["IconSettingsOutline16", "IconSettingsOutlineRegular"],
  ["IconCloseOutline16", "IconCloseOutlineRegular"],
  ["IconChevronDownOutline14", "IconChevronDownOutlineRegular"],
  ["IconChevronUpOutline14", "IconChevronUpOutlineRegular"],
];

function iconClientFixture(exportIndex) {
  const h = (type, props, ...children) => {
    assert.ok(typeof type === "string" || typeof type === "function", `invalid React element type: ${String(type)}`);
    if (typeof type === "function") return type({ ...props, children });
    return { type, props: props ?? {}, children: children.flat(Infinity) };
  };
  const React = {
    createElement: h, Fragment: "fragment",
    useState: initial => [typeof initial === "function" ? initial() : initial, () => {}],
    useRef: current => ({ current }), useEffect() {},
    useCallback: callback => callback, useMemo: callback => callback(),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  const primitives = Object.fromEntries(iconExports.map(names => [names[exportIndex], props => h("svg", { ...props, "data-icon": names[exportIndex] })]));
  let plugin;
  const exposedSource = source.replace("return { inject, apply };", `return { inject, apply, icons: { ${iconExports.map(([name]) => name).join(", ")} } };`);
  vm.runInNewContext(exposedSource, {
    window: { __ModuleLoader__: { load: definition => { plugin = definition.factory(name => name === "react" ? React : primitives); } } },
    document: { getElementById: () => ({ textContent: "" }) },
    localStorage: { getItem: () => null, setItem: () => assert.fail("render must not write preferences") },
    fetch: () => assert.fail("render must not request remote operations"),
  }, { filename: "client.js" });
  const slots = new Map();
  const ctx = {
    effect: fn => fn(),
    inject: (names, callback) => { if (names.includes("sidebarRight")) callback(ctx); },
    locale: { bind: () => () => "Remote Ops", register() {} },
    sidebarRight: {}, sidebarRightTabs: { register() {} },
    slots: { inject: (_name, fn) => fn(), register: (definition, component) => { slots.set(definition.name, component); } },
  };
  plugin.apply(ctx);
  return { plugin, primitives, slots, h };
}

for (const [label, exportIndex] of [["legacy size-specific", 0], ["DSH 0.2.0-rc.2 Regular", 1]]) {
  test(`all fourteen client icons resolve with ${label} exports`, () => {
    const { plugin, primitives } = iconClientFixture(exportIndex);
    for (const names of iconExports)
      assert.equal(plugin.icons[names[0]], primitives[names[exportIndex]], `${names[0]} must resolve to ${names[exportIndex]}`);
  });
  test(`RemoteOpsPanel renders without undefined components with ${label} exports`, () => {
    const { slots, h } = iconClientFixture(exportIndex);
    const tree = h(slots.get("sidebar.right.pane.tab"), { sessionId: "test-owner" });
    assert.equal(tree.props.className, "dsh-remote-ops");
    const rendered = JSON.stringify(tree);
    assert.match(rendered, /Remote Ops/);
    assert.match(rendered, /检查更新/);
    assert.match(rendered, /终端输入/);
    assert.match(rendered, /data-icon/);
  });
}

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
  assert.deepEqual(JSON.parse(JSON.stringify(terminalScreenModel("abc"))), { text: "abc", alternateScreen: false, cursorVisible: true, cursor: { row: 0, column: 3 } });
  assert.deepEqual(JSON.parse(JSON.stringify(terminalScreenModel("\u001b[2J\u001b[Hprompt>"))), { text: "prompt>", alternateScreen: false, cursorVisible: true, cursor: { row: 0, column: 7 } });
});

test("terminal wide characters preserve cursor placement after absolute positioning", () => {
  assert.equal(terminalScreenModel("中文\u001b[5G!").text, "中文!");
  assert.equal(terminalScreenModel("中文\u001b[5G!").cursor.column, 3);
  assert.equal(terminalScreenModel("e\u0301x\u001b[2G!").text, "e\u0301!");
});

test("disconnected tabs retain identity and never silently select a different terminal", () => {
  const merge = loadClientFunction("mergeSessionTabs", "\n    const retryDelay");
  const tabs = merge([{ sessionId: "ssh-one", name: "target", status: { kind: "running" } }], [{ sessionId: "local-cmd", kind: "local" }]);
  assert.equal(tabs.find(x => x.sessionId === "ssh-one").disconnected, true);
  assert.equal(tabs.find(x => x.sessionId === "ssh-one").name, "target");
  assert.equal(merge(tabs, [{sessionId:"ssh-one", status:{kind:"running"}}]).find(x=>x.sessionId==="ssh-one").disconnected, false);
  const delay = loadClientFunction("retryDelay", "\n    const fileWorkspacePreferences");
  assert.ok(delay(5) > delay(1));
  assert.ok(delay(100) <= 30000);
});

test("file workspace preferences retain positions but never stale rows or selections", () => {
  const prefs = loadClientFunction("fileWorkspacePreferences", "\n    const sortedFileEntries");
  const value = prefs({panes:[{kind:"ssh",environment:"env",path:"/work",sort:"size",scrollTop:121,entries:["secret"],selected:["bad"]}],bookmarks:[{kind:"ssh",environment:"env",path:"/work"}]});
  assert.equal(value.panes[0].path, "/work");
  assert.equal(value.panes[0].sort, "size");
  assert.equal(value.panes[0].scrollTop, 121);
  assert.equal(value.panes[0].entries, undefined);
  assert.equal(value.panes[0].selected, undefined);
  assert.equal(value.bookmarks[0].path, "/work");
});

test("alternate-screen applications restore the shell and respect scroll regions", () => {
  const screen = terminalScreenModel("shell>\u001b[?1049h\u001b[Heditor\u001b[?1049l");
  assert.equal(screen.text, "shell>");
  assert.equal(screen.cursor.column, 6);
  const region = terminalScreenModel("header\u001b[2;4r\u001b[4;1Hbottom\nnext", 5, 20);
  assert.ok(region.text.startsWith("header"));
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

test("quick pane grows beyond two rows, clamps to available terminal space and retains saved height", () => {
  const bounds = loadClientFunction("quickPaneHeight", "\n    const quickCommandList");
  assert.equal(bounds(480, 900, 220), 480);
  assert.equal(bounds(900, 600, 240), 360);
  assert.equal(bounds(20, 900, 220), 92);
  const prefs = loadClientFunction("terminalPreferences", "\n    const pasteSubmission");
  assert.equal(prefs({ quickHeight: 560 }).quickHeight, 560);
  assert.equal(bounds(prefs({ quickHeight: 560 }).quickHeight, 900, 220), 560);
});

test("quick dispatch waits for locally typed text or history until Enter or cancellation", () => {
  const pending = loadClientFunction("terminalDraftPending", "\n    const quickPaneHeight");
  assert.equal(pending(false, "echo 中文 "), true);
  assert.equal(pending(true, "\u007f"), true);
  assert.equal(pending(true, "\r"), false);
  assert.equal(pending(true, "\u0003"), false);
  assert.equal(pending(false, "\u001b[A"), true);
  assert.equal(pending(false, "echo one\recho two"), true);
});

test("quick command search includes Chinese and command text without running or hiding unpinned library entries", () => {
  const list = loadClientFunction("quickCommandList", "\n    const quickDispatchDraft");
  const commands = [{ id: "a", name: "磁盘", command: "df -h", group: "常用", pinned: true, order: 2 }, { id: "b", name: "状态", command: "systemctl status", group: "服务", pinned: false, order: 1 }];
  assert.deepEqual(Array.from(list(commands, "", "", true), item => item.id), ["a"]);
  assert.deepEqual(Array.from(list(commands, "STATUS", "", false), item => item.id), ["b"]);
  assert.deepEqual(Array.from(list(commands, "磁盘", "常用", true), item => item.id), ["a"]);
  assert.deepEqual(commands.map(item => item.id), ["a", "b"]);
});

test("quick command confirmation retains target and revision and rejects an owner or stream switch", () => {
  const draft = loadClientFunction("quickDispatchDraft", "\n    const quickDraftValid");
  const valid = loadClientFunction("quickDraftValid", "\n    function QuickCommands");
  const command = { id: "one", name: "状态", command: "echo a", revision: "v1" };
  const target = { sessionId: "ssh-one", name: "SSH" };
  const value = draft(command, target, { streamId: "stream-one" }, "owner", "request");
  command.command = "changed"; target.sessionId = "ssh-two";
  assert.equal(value.command, "echo a");
  assert.equal(value.session, "ssh-one");
  assert.equal(value.revision, "v1");
  assert.equal(valid(value, "owner", "ssh-one", "stream-one"), true);
  assert.equal(valid(value, "other", "ssh-one", "stream-one"), false);
  assert.equal(valid(value, "owner", "ssh-two", "stream-one"), false);
  assert.equal(valid(value, "owner", "ssh-one", "stream-new"), false);
});

test("file requests contain endpoint identity, not directory rows or checkbox state", () => {
  const endpoint = loadClientFunction("fileEndpoint", "\n    function SftpWorkspace");
  assert.deepEqual(JSON.parse(JSON.stringify(endpoint({kind:"host",path:"C:/work",entries:["private"],selected:["a"],draft:"unsubmitted"}))), {kind:"host",path:"C:/work"});
});

test("quick buttons dispatch directly once and confirmation never follows a target switch", async () => {
  let cursor = 0;
  const hooks = [], calls = [];
  let finish;
  const render = loadClientFunction("QuickCommands", "\n    function RemoteOpsPanel", "quickPaneHeight", {
    h: (tag, props, ...children) => ({ tag, props: props ?? {}, children: children.flat(Infinity).filter(Boolean) }),
    React: { Fragment: "fragment" },
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], value => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useEffect() {}, useCallback: value => value,
    crypto: { randomUUID: () => `request-${calls.length}` },
    request: async (_path, init) => { calls.push(JSON.parse(init.body)); return new Promise(resolve => { finish = () => resolve({ status: "written" }); }); },
    IconPlayOutline16: "play", IconPlusOutline16: "plus", IconSettingsOutline16: "settings", IconCloseOutline16: "close", IconChevronDownOutline14: "down", IconChevronUpOutline14: "up", IconEditOutline16: "edit", IconSearchOutline16: "search",
  });
  const props = { commands: [{ id: "one", name: "状态", command: "echo x", revision: "v1", pinned: true, confirm: false }], groups: [], owner: "owner", target: { sessionId: "one", name: "SSH" }, frame: { streamId: "stream" }, ready: true, open: true, height: 190, setOpen() {}, setHeight() {}, inputPending: () => false, refresh: async () => {} };
  const tree = () => { cursor = 0; return render(props); };
  const find = (node, label) => node?.props?.["aria-label"] === label ? node : node?.children?.map(child => find(child, label)).find(Boolean);
  const button = find(tree(), "执行 状态");
  const sending = button.props.onClick({ detail: 1 });
  button.props.onClick({ detail: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "quick.dispatch");
  assert.equal(calls[0].session, "one");
  assert.equal(find(tree(), "执行 状态").props.disabled, true);
  finish(); await sending;
  assert.match(JSON.stringify(tree()), /已写入终端/);
  props.commands[0] = { ...props.commands[0], confirm: true };
  find(tree(), "执行 状态").props.onClick({ detail: 1 });
  assert.equal(calls.length, 1);
  const confirm = find(tree(), "确认下发");
  assert.ok(confirm);
  props.target = { sessionId: "two", name: "Other" }; tree();
  await confirm.props.onClick();
  assert.equal(calls.length, 1);
  find(tree(), "关闭快捷命令弹窗").props.onClick();
  props.action = async () => ({ pinned: false });
  find(tree(), "管理快捷命令").props.onClick();
  find(tree(), "显示按钮 状态").props.onChange({ target: { checked: false } });
  assert.equal(find(tree(), "显示按钮 状态").props.checked, false);
  assert.equal(calls.length, 1, "management never dispatches a command");
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

test("file completion refreshes only the visible matching endpoint and directory", () => {
  const same = loadClientFunction("sameFileLocation", "\n    const sortedFileEntries");
  assert.equal(same({ kind: "ssh", environment: "a", path: "/tmp/out/" }, { kind: "ssh", environment: "a", path: "/tmp/out" }), true);
  assert.equal(same({ kind: "ssh", environment: "b", path: "/tmp/out" }, { kind: "ssh", environment: "a", path: "/tmp/out" }), false);
  assert.equal(same({ kind: "host", path: "F:\\files" }, { kind: "host", path: "F:/files/" }), true);
  assert.equal(same({ kind: "host", path: "F:/elsewhere" }, { kind: "host", path: "F:/files" }), false);
});

test("file path edits wait for an in-flight endpoint change", () => {
  let hook = 0;
  const render = loadClientFunction("SftpWorkspace", "\n    function CommandDialog", "fileEndpoint", {
    h: (tag, props, ...children) => ({ tag, props, children }),
    useState: initial => { let value = typeof initial === "function" ? initial() : initial; if (++hook === 2) value = value.map(pane => ({ ...pane, loading: true })); return [value, () => {}]; },
    useRef: current => ({ current }), useEffect() {}, useCallback: value => value,
    localStorage: { getItem: () => null },
    IconRefreshOutline16: "refresh", IconDownloadOutline16: "download", IconFolderClose16: "folder",
  });
  const tree = render({ sessionId: "owner", environments: [], onError() {}, onClose() {} });
  const nodes = [];
  const visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === "object") { nodes.push(node); visit(node.children); } };
  visit(tree);
  for (const name of ["路径 A", "路径 B"]) assert.equal(nodes.find(node => node.props?.["aria-label"] === name).props.disabled, true);
});

test("revealing a transferred file preserves the target pane sort preference", async () => {
  let hook = 0, panes;
  const task = { names: ["done.txt"], status: "completed", bytes: 4, target: { kind: "host", path: "/out" }, counts: { completed: 1 }, items: [{ name: "done.txt", status: "completed" }] };
  const render = loadClientFunction("SftpWorkspace", "\n    function CommandDialog", "fileEndpoint", {
    h: (tag, props, ...children) => ({ tag, props, children }),
    useState: initial => {
      let value = typeof initial === "function" ? initial() : initial;
      const index = ++hook;
      if (index === 2) panes = value = value.map((pane, side) => ({ ...pane, path: side ? "/out" : "/in", sort: "size" }));
      if (index === 7) value = [task];
      return [value, update => { value = typeof update === "function" ? update(value) : update; if (index === 2) panes = value; }];
    },
    useRef: current => ({ current }), useEffect() {}, useCallback: value => value,
    request: async () => ({ path: "/out", entries: [{ name: "done.txt", type: "-", size: 4 }] }),
    window: { requestAnimationFrame: callback => callback() }, localStorage: { getItem: () => null },
    IconRefreshOutline16: "refresh", IconDownloadOutline16: "download", IconFolderClose16: "folder",
  });
  const tree = render({ sessionId: "owner", environments: [], onError: message => assert.fail(message), onClose() {} });
  const nodes = [];
  const visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === "object") { nodes.push(node); visit(node.children); } };
  visit(tree);
  nodes.find(node => node.tag === "button" && node.children.includes("定位")).props.onClick();
  await new Promise(setImmediate);
  assert.equal(panes[1].sort, "size");
  assert.equal(panes[1].path, "/out");
  assert.deepEqual(Array.from(panes[1].selected), ["done.txt"]);
});

test("full-screen terminal preserves its grid and does not print charset selectors", () => {
  const grid = loadClientFunction("terminalUsesGrid", "\n    const terminalInputEnabled");
  assert.equal(grid(terminalScreenModel("\x1b[?25l\x1b[Htop header")), true, "top hides its cursor without using the alternate screen");
  assert.equal(grid(terminalScreenModel("shell>")), false);
  const screen = terminalScreenModel("\x1b[?1049h\x1b(B\x1b[3;1Htop header\x1b[?25l", 5, 20);
  assert.equal(screen.text.split("\n")[2], "top header");
  assert.equal(screen.alternateScreen, true);
  assert.equal(screen.cursorVisible, false);
  assert.equal(screen.text.includes("B"), false);
  const restored = terminalScreenModel("shell>\x1b[?1049h\x1b[?25l\x1b[?1049l\x1b[?25h", 5, 20);
  assert.equal(restored.text, "shell>");
  assert.equal(restored.cursorVisible, true);
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
  queueTerminalInput(queue, { session: "a", sessionId: "owner-2", streamId: "replacement", text: "new stream\r" });
  assert.deepEqual(JSON.parse(JSON.stringify(queue)), [
    { session: "a", sessionId: "owner-1", text: "echo one\r" },
    { session: "b", sessionId: "owner-1", text: "two\r" },
    { session: "a", sessionId: "owner-2", text: "three\r" },
    { session: "a", sessionId: "owner-2", streamId: "replacement", text: "new stream\r" },
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
  const render = (module, height = 190, fullScreen = false) => {
    rememberScroll = viewport(output, follow, "owner:cmd", "same output", module, true, height, fullScreen);
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
  render("terminal", 280, true);
  assert.equal(output.current.scrollTop, 0, "full-screen apps must start at their header rather than the last rows");
});

test("environment form values reflect the stored profile and terminal size, with safe defaults", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(environmentProfileValues(undefined))), { autoQuitMore: false, autoSigint: true, stripAnsi: false, headTailChars: "", rows: "", cols: "" });
  const stored = environmentProfileValues({ cliProfile: { autoConfirm: true, confirmPattern: "ok\\?", autoQuitMore: true, autoSigint: false, stripAnsi: true, headTailChars: 800 }, terminal: { rows: 50, cols: 200 } });
  assert.deepEqual(JSON.parse(JSON.stringify(stored)), { autoQuitMore: true, autoSigint: false, stripAnsi: true, headTailChars: "800", rows: "50", cols: "200" });
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(stored)), "autoConfirm"), false, "a stored autoConfirm from an older version is not shown");
});

test("environment form submits only non-default profile values and always sends both objects so clearing works", () => {
  const plain = JSON.parse(JSON.stringify(environmentProfileFromForm(environmentProfileValues(undefined))));
  assert.deepEqual(plain, { cliProfile: {}, terminal: {} });
  const full = JSON.parse(JSON.stringify(environmentProfileFromForm({ autoConfirm: true, confirmPattern: "ok", autoQuitMore: true, autoSigint: false, stripAnsi: true, headTailChars: " 800 ", rows: "50", cols: "200" })));
  assert.deepEqual(full, { cliProfile: { autoQuitMore: true, autoSigint: false, stripAnsi: true, headTailChars: 800 }, terminal: { rows: 50, cols: 200 } }, "legacy autoConfirm/confirmPattern in the form state are never submitted");
});

test("environment form rejects invalid profile and size input with a readable message", () => {
  const base = environmentProfileValues(undefined);
  assert.match(environmentProfileFromForm({ ...base, headTailChars: "50" }).error, /200-100000/);
  assert.match(environmentProfileFromForm({ ...base, headTailChars: "1.5" }).error, /200-100000/);
  assert.match(environmentProfileFromForm({ ...base, rows: "3" }).error, /终端行数.*10-200/);
  assert.match(environmentProfileFromForm({ ...base, cols: "wide" }).error, /终端列数.*40-500/);
});

test("terminal size choices include the current custom size and parse back to rows and columns", () => {
  const plain = JSON.parse(JSON.stringify(terminalSizeOptions(undefined)));
  assert.deepEqual(plain.map((option) => option.value), ["24x80", "40x120", "40x160", "50x200"]);
  assert.equal(plain[2].label, "160×40");
  const custom = JSON.parse(JSON.stringify(terminalSizeOptions({ rows: 33, cols: 111 })));
  assert.deepEqual(custom.map((option) => option.value), ["33x111", "24x80", "40x120", "40x160", "50x200"], "an unlisted current size stays selectable");
  assert.equal(JSON.parse(JSON.stringify(terminalSizeOptions({ rows: 50, cols: 200 }))).length, 4, "a preset is not listed twice");
  assert.deepEqual(JSON.parse(JSON.stringify(terminalSizeFromValue("50x200"))), { rows: 50, cols: 200 });
  assert.equal(terminalSizeFromValue("wide"), undefined);
  assert.equal(terminalSizeFromValue("50×200"), undefined);
});

test("the terminal screen model wraps at a non-default PTY width", () => {
  const lines80 = terminalScreenModel("a".repeat(200), 24, 80).text.split("\n").filter(Boolean);
  assert.ok(lines80.length >= 3 && lines80.every((line) => line.length <= 80), "an 80-column PTY wraps at 80 columns");
  const lines160 = terminalScreenModel("a".repeat(200)).text.split("\n").filter(Boolean);
  assert.ok(lines160.length === 2 && lines160.every((line) => line.length <= 160));
});

const findNodes = (node, predicate, found = []) => {
  if (node === null || typeof node !== "object") return found;
  if (predicate(node)) found.push(node);
  for (const child of node.children ?? []) findNodes(child, predicate, found);
  return found;
};
const textOf = (node) => typeof node === "string" ? node : (node.children ?? []).map(textOf).join("");
const defaultForm = () => JSON.parse(JSON.stringify(environmentProfileValues(undefined)));

test("the CLI assist section renders every option, offers no automatic confirmation and reports edits by field", () => {
  const edits = [];
  const tree = environmentAdvancedFields(defaultForm(), (field, value) => edits.push([field, value]));
  assert.equal(tree.type, "details");
  assert.equal(tree.props.open, false, "an all-default profile stays collapsed");
  assert.doesNotMatch(textOf(tree), /自动确认|\(y\/n\)|autoConfirm/, "no control for answering confirmations automatically");
  const checkboxes = findNodes(tree, (node) => node.type === "input" && node.props.type === "checkbox");
  assert.equal(checkboxes.length, 3);
  assert.deepEqual(checkboxes.map((node) => node.props.checked), [false, true, false]);
  checkboxes[0].props.onChange({ target: { checked: true } });
  checkboxes[1].props.onChange({ target: { checked: false } });
  checkboxes[2].props.onChange({ target: { checked: true } });
  const texts = findNodes(tree, (node) => node.type === "input" && node.props.type === undefined);
  assert.deepEqual(texts.map((node) => node.props["aria-label"]), ["长输出头尾摘要字符数", "终端行数", "终端列数"]);
  texts[0].props.onChange({ target: { value: "800" } });
  texts[1].props.onChange({ target: { value: "50" } });
  texts[2].props.onChange({ target: { value: "200" } });
  assert.deepEqual(edits, [["autoQuitMore", true], ["autoSigint", false], ["stripAnsi", true], ["headTailChars", "800"], ["rows", "50"], ["cols", "200"]]);
});

test("the CLI assist section opens by itself when a stored option is active", () => {
  for (const change of [{ autoQuitMore: true }, { stripAnsi: true }, { autoSigint: false }, { headTailChars: "800" }, { rows: "50" }, { cols: "200" }]) {
    assert.equal(environmentAdvancedFields({ ...defaultForm(), ...change }, () => {}).props.open, true, JSON.stringify(change));
  }
});

test("the size selector shows the current size, offers presets and only reports valid choices", () => {
  const chosen = [];
  const select = (size, disabled = false) => findNodes(terminalSizeSelect(size, disabled, (value) => chosen.push(value)), (node) => node.type === "select")[0];
  const initial = select({ rows: 33, cols: 111 });
  assert.equal(initial.props.value, "33x111");
  assert.deepEqual(initial.children.map((option) => option.props.value), ["33x111", "24x80", "40x120", "40x160", "50x200"]);
  assert.equal(select(undefined).props.value, "40x160");
  assert.equal(select(undefined, true).props.disabled, true);
  initial.props.onChange({ target: { value: "50x200" } });
  initial.props.onChange({ target: { value: "garbage" } });
  assert.deepEqual(JSON.parse(JSON.stringify(chosen)), [{ rows: 50, cols: 200 }]);
});

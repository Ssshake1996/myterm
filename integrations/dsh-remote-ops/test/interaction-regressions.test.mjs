import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

function clientSection(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `client section ${startMarker} exists`);
  return source.slice(start, end);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function inputFixture() {
  const sent = [], previews = [];
  const context = {
    h: (_type, props) => props,
    terminalInputRef: { current: null }, terminalInput: "", terminalReady: true,
    composingRef: { current: false }, setInputFocused() {}, setTerminalInput() {},
    queueRawInput: text => sent.push(text), previewInput: text => previews.push(text),
  };
  vm.runInNewContext(
    clientSection("const keySequence =", "\n      const addGroup") + "\n" +
    clientSection("const terminalInputCapture =", "\n      const jumpToLatest") +
    "\nglobalThis.input = terminalInputCapture;", context,
  );
  return { input: context.input, sent, previews };
}

for (const shiftKey of [false, true]) {
  test(`${shiftKey ? "Ctrl+Shift+V" : "Ctrl+V"} preserves native paste and multiline confirmation`, () => {
    const { input, sent, previews } = inputFixture();
    let prevented = false;
    input.onKeyDown({ key: shiftKey ? "V" : "v", ctrlKey: true, shiftKey, altKey: false, metaKey: false, preventDefault() { prevented = true; } });
    assert.equal(prevented, false, "the browser must be allowed to dispatch paste");
    assert.deepEqual(sent, [], "a paste shortcut must not write control characters");
    input.onPaste({ preventDefault() {}, clipboardData: { getData: () => "echo one\necho two" } });
    assert.deepEqual(previews, ["echo one\necho two"]);
    assert.deepEqual(sent, [], "multiline text must wait for confirmation");
  });
}

test("terminal interrupt remains available after reserving paste shortcuts", () => {
  const { input, sent } = inputFixture();
  let prevented = false;
  input.onKeyDown({ key: "c", ctrlKey: true, altKey: false, metaKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(sent, ["\u0003"]);
});

function actionFixture(refresh = async () => {}, name = "action") {
  const response = deferred(), busy = [], errors = [], requests = [];
  const refs = [];
  let hook = 0;
  const ownerRender = vm.runInNewContext(`sessionId => {
    ${clientSection("const viewOwner =", "\n      const snapshot =")}
    return { viewOwner, ...(typeof viewRevision === "undefined" ? {} : { viewRevision }) };
  }`, { useRef: current => { const index = hook++; return refs[index] ??= { current }; } });
  const switchOwner = owner => { hook = 0; return ownerRender(owner); };
  let refreshCount = 0;
  const context = {
    sessionId: "owner-a", ...switchOwner("owner-a"),
    useCallback: fn => fn,
    setBusy: value => busy.push(value), setError: value => errors.push(value),
    request: (_path, init) => { requests.push(JSON.parse(init.body)); return response.promise; },
    refresh: async () => { refreshCount++; await refresh(); },
  };
  const endMarker = name === "workspaceAction" ? "\n      const checkUpdate" : "\n      const installUpdate";
  vm.runInNewContext(clientSection(`const ${name} = useCallback`, endMarker) + `\nglobalThis.invoke = ${name};`, context);
  return { ...context, response, busy, errors, requests, switchOwner, refreshCount: () => refreshCount };
}

test("an SSH action response from the previous owner cannot select a terminal in the current owner", async () => {
  const fixture = actionFixture();
  const pending = fixture.invoke({ action: "open", environment: "ssh-a" });
  fixture.switchOwner("owner-b");
  fixture.response.resolve({ sessionId: "ssh-owned-by-a" });
  assert.equal(await pending, undefined, "connect must not receive a stale session ID");
  assert.equal(fixture.refreshCount(), 0);
  assert.deepEqual(fixture.errors, []);
  assert.deepEqual(fixture.busy, [true], "old completion cannot unlock the current owner's operation");
  assert.equal(fixture.requests[0].sessionId, "owner-a", "the request remains pinned to its original owner");
});

test("owner switching during the post-action refresh also discards the old result", async () => {
  const refreshing = deferred();
  const fixture = actionFixture(() => refreshing.promise);
  const pending = fixture.invoke({ action: "open", environment: "ssh-a" });
  fixture.response.resolve({ sessionId: "ssh-owned-by-a" });
  await new Promise(setImmediate);
  assert.equal(fixture.refreshCount(), 1);
  fixture.switchOwner("owner-b");
  refreshing.resolve();
  assert.equal(await pending, undefined);
  assert.deepEqual(fixture.busy, [true]);
});

test("failures from the previous owner do not replace the current owner's feedback", async () => {
  const fixture = actionFixture();
  const pending = fixture.invoke({ action: "open", environment: "ssh-a" });
  fixture.switchOwner("owner-b");
  fixture.response.reject(new Error("SSH_CONNECT_FAILED"));
  assert.equal(await pending, undefined);
  assert.deepEqual(fixture.errors, []);
  assert.deepEqual(fixture.busy, [true]);
});

test("an action in the current owner refreshes state and returns its result", async () => {
  const fixture = actionFixture();
  const result = { sessionId: "ssh-owned-by-a" };
  const pending = fixture.invoke({ action: "open", environment: "ssh-a" });
  fixture.response.resolve(result);
  assert.equal(await pending, result);
  assert.equal(fixture.refreshCount(), 1);
  assert.deepEqual(fixture.errors, [""]);
  assert.deepEqual(fixture.busy, [true, false]);
});

test("an old workspace action cannot unlock the current owner's operation", async () => {
  const fixture = actionFixture(undefined, "workspaceAction");
  const pending = fixture.invoke({ action: "enter", environment: "ssh-a" });
  fixture.switchOwner("owner-b");
  fixture.response.resolve({ sessionId: "ssh-owned-by-a" });
  assert.equal(await pending, undefined);
  assert.deepEqual(fixture.busy, [true]);
});

test("entering a terminal also discards its result when owners change during refresh", async () => {
  const refreshing = deferred();
  const fixture = actionFixture(() => refreshing.promise, "workspaceAction");
  const pending = fixture.invoke({ action: "enter", environment: "ssh-a" });
  fixture.response.resolve({ sessionId: "ssh-owned-by-a" });
  await new Promise(setImmediate);
  fixture.switchOwner("owner-b");
  refreshing.resolve();
  assert.equal(await pending, undefined);
  assert.deepEqual(fixture.busy, [true]);
});

for (const name of ["action", "workspaceAction"]) {
  test(`${name} discards a response from an earlier visit to the same owner`, async () => {
    const fixture = actionFixture(undefined, name);
    const pending = fixture.invoke({ action: name === "action" ? "open" : "enter", environment: "ssh-a" });
    fixture.switchOwner("owner-b");
    fixture.switchOwner("owner-a");
    fixture.response.resolve({ sessionId: "terminal-from-earlier-visit" });
    assert.equal(await pending, undefined, "returning to owner A must not revive an old selection request");
    assert.equal(fixture.refreshCount(), 0);
    assert.deepEqual(fixture.busy, [true]);
    assert.deepEqual(fixture.errors, []);
  });
}

test("switching owners resets the busy state left by the previous owner", () => {
  const busy = [];
  const context = {
    sessionId: "owner-b", useEffect: fn => fn(),
    setPasteDraft() {}, setConnectionChoices() {}, setActiveSessionId() {}, setReviewStream() {},
    setBusy: value => busy.push(value),
  };
  vm.runInNewContext(clientSection("useEffect(() => { setPasteDraft(null)", "\n      const refresh ="), context);
  assert.deepEqual(busy, [false]);
});

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
  const endMarker = name === "workspaceAction" ? "\n      const refreshNow" : "\n      const tabs";
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

function draftFixture(rawRequest = () => ({ status: "written" })) {
  const requests = [], rawRequests = [], errors = [];
  const context = {
    h: (tag, props, ...children) => ({ tag, props, children }),
    useRef: current => ({ current }), useCallback: fn => fn, useEffect() {},
    useState: initial => [typeof initial === "function" ? initial() : initial, () => {}],
    crypto: { randomUUID: () => "quick-request" },
    window: { setTimeout: () => 1, clearTimeout() {} },
    request: async (url, init) => { const input = JSON.parse(init.body); if (url.endsWith("/action")) { rawRequests.push(input); return rawRequest(input); } requests.push(input); return { status: "written" }; },
    setError: value => errors.push(value),
    React: { Fragment: "fragment" },
    IconCloseOutline16: "svg", IconPlayOutline16: "svg", IconChevronDownOutline14: "svg",
    IconChevronUpOutline14: "svg", IconPlusOutline16: "svg", IconSettingsOutline16: "svg",
  };
  const inputPending = clientSection("const quickPanel =", "\n      const markUserScrollIntent").match(/inputPending: (\(\) => Boolean\(.+\)) \}\);/)[1];
  vm.runInNewContext(clientSection("const queueTerminalInput =", "\n    const useTerminalViewport") + clientSection("const pasteSubmission =", "\n    const outputMatches") + clientSection("const terminalDraftPending =", "\n    function RemoteOpsPanel") + `
    globalThis.panel = (sessionId = "owner", activeTerminalId = "terminal", streamId = "stream-1") => {
      const cleanups = [];
      const useEffect = effect => { const cleanup = effect(); if (typeof cleanup === "function") cleanups.push(cleanup); };
      ${clientSection("const manualDrafts =", "\n      const quickSending")}
      const activeTerminalFrame = { streamId }, terminalReady = true;
      const quickSending = { current: false }, rawInputQueue = { current: [] }, rawInputSending = { current: false }, rawInputTimer = { current: null };
      const composingRef = { current: false }, terminalInputRef = { current: null }, pendingSshInputRef = { current: "" };
      const scrollIntentTimer = { current: null }, activeSessionId = activeTerminalId, snapshot = { sessions: [] };
      const openFromSshCommand = () => {}, setPendingSshInput = () => {}, setTerminalInput = () => {};
      ${clientSection("const flushRawInput =", "\n      const keySequence")}
      let pasteDraft, pendingPasteResponse;
      const action = () => pendingPasteResponse, setPasteDraft = value => { pasteDraft = value; };
      ${clientSection("const submitPaste =", "\n      const dismissTab")}
      const inputPending = ${inputPending};
      const command = { id: "cmd", name: "Test", command: "echo suffix", revision: 1 };
      const tree = QuickCommands({ commands: [command], groups: [], owner: sessionId, target: { sessionId: activeTerminalId }, frame: activeTerminalFrame, ready: true, open: true, height: 190, inputPending });
      const nodes = [];
      const visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === "object") { nodes.push(node); visit(node.children); } };
      visit(tree);
      return {
        queue: queueRawInput, pending: inputPending, store: manualDrafts.current,
        paste(text, response) { pasteDraft = { owner: sessionId, session: activeTerminalId, streamId, text }; pendingPasteResponse = response; return submitPaste(); },
        flush() { rawInputTimer.current = null; return flushRawInput(); },
        unmount() { cleanups.forEach(cleanup => cleanup()); },
        sendQuick: () => nodes.find(node => node.props?.["aria-label"] === "执行 Test").props.onClick({ detail: 1 }),
      };
    };
  `, context);
  return { panel: context.panel, requests, rawRequests, errors };
}

test("remounting the panel preserves unsubmitted PTY input and blocks quick dispatch", async () => {
  const fixture = draftFixture();
  const first = fixture.panel();
  first.queue("echo prefix "); await first.flush();
  assert.equal(first.pending(), true);
  const remounted = fixture.panel(); await remounted.flush();
  await remounted.sendQuick();
  assert.equal(fixture.requests.length, 0, "quick dispatch must not append to the existing PTY half-line");
  assert.equal(remounted.pending(), true);
  assert.deepEqual([...remounted.store.values()], [true], "retain only a pending boolean, never input text");
});

test("visiting another owner does not clear the previous owner's pending input", async () => {
  const fixture = draftFixture();
  const first = fixture.panel(); first.queue("partial"); await first.flush();
  await fixture.panel("other-owner").flush();
  const restored = fixture.panel(); await restored.flush();
  assert.equal(restored.pending(), true);
});

for (const input of ["\r", "\u0003"]) {
  test(`${input === "\r" ? "Enter" : "Ctrl+C"} clears preserved pending input`, async () => {
    const fixture = draftFixture();
    const first = fixture.panel(); first.queue("partial"); await first.flush();
    const restored = fixture.panel(); restored.queue(input); await restored.flush();
    assert.equal(restored.pending(), false);
    await restored.sendQuick();
    assert.equal(fixture.requests.length, 1);
    assert.equal(restored.store.size, 0);
  });

  test(`${input === "\r" ? "Enter" : "Ctrl+C"} dropped during unmount keeps the PTY half-line protected`, async () => {
    const fixture = draftFixture();
    const first = fixture.panel(); first.queue("partial"); await first.flush();
    first.queue(input);
    first.unmount();
    const restored = fixture.panel();
    await restored.sendQuick();
    assert.equal(fixture.rawRequests.length, 1, "the queued clearing input was never sent");
    assert.equal(restored.pending(), true);
    assert.equal(fixture.requests.length, 0, "quick dispatch must not append to the still-pending PTY half-line");
  });
}

test("a new terminal stream is isolated and reclaims the old stream marker", async () => {
  const fixture = draftFixture();
  const first = fixture.panel(); first.queue("old partial"); await first.flush();
  const replaced = fixture.panel("owner", "terminal", "stream-2"); await replaced.flush();
  assert.equal(replaced.pending(), false);
  replaced.queue("new partial"); await replaced.flush();
  assert.equal(replaced.store.size, 1);
  assert.equal(replaced.store.has("owner:terminal:stream-1"), false);
});

test("pending input storage is bounded without evicting live draft protection", async () => {
  const fixture = draftFixture();
  const first = fixture.panel(); first.queue("first partial"); await first.flush();
  for (let index = 1; index < 300; index++) fixture.panel("owner", `terminal-${index}`).queue("partial");
  assert.ok(first.store.size <= 256);
  assert.equal(first.pending(), true, "the oldest pending terminal must remain protected");
  assert.ok(fixture.errors.some(message => message.startsWith("TERMINAL_DRAFT_LIMIT")), "excess pending terminals must be refused explicitly");
});

test("pasting Enter keeps the old pending marker until the input is acknowledged", async () => {
  const fixture = draftFixture();
  const panel = fixture.panel(); panel.queue("partial"); await panel.flush();
  const response = deferred();
  const pending = panel.paste("\n", response.promise);
  assert.equal(panel.pending(), true, "a pending paste must not unlock quick dispatch early");
  response.resolve({ ok: true });
  await pending;
  assert.equal(panel.pending(), false);
});

test("raw Enter keeps the pending marker until its write is acknowledged", async () => {
  const response = deferred();
  const fixture = draftFixture(input => input.text === "\r" ? response.promise : { status: "written" });
  const panel = fixture.panel(); panel.queue("partial"); await panel.flush();
  panel.queue("\r");
  const pending = panel.flush();
  const remounted = fixture.panel();
  await remounted.sendQuick();
  assert.equal(fixture.requests.length, 0);
  assert.equal(remounted.pending(), true);
  response.resolve({ status: "written" });
  await pending;
  assert.equal(panel.pending(), false);
});

test("a failed raw Enter preserves the pending marker after remount", async () => {
  const fixture = draftFixture(input => input.text === "\r" ? Promise.reject(new Error("input failed")) : { status: "written" });
  const panel = fixture.panel(); panel.queue("partial"); await panel.flush();
  panel.queue("\r"); await panel.flush(); panel.unmount();
  const remounted = fixture.panel();
  await remounted.sendQuick();
  assert.equal(remounted.pending(), true);
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.errors.length, 1);
});

test("an input acknowledgment from an unmounted panel cannot clear a new draft", async () => {
  const response = deferred();
  const fixture = draftFixture(input => input.text === "\r" ? response.promise : { status: "written" });
  const panel = fixture.panel(); panel.queue("partial"); await panel.flush();
  panel.queue("\r"); const pending = panel.flush(); panel.unmount();
  const remounted = fixture.panel(); remounted.queue("new partial"); await remounted.flush();
  response.resolve({ status: "written" }); await pending;
  assert.equal(remounted.pending(), true);
  await remounted.sendQuick();
  assert.equal(fixture.requests.length, 0);
});

test("raw Enter cannot unlock dispatch while later input for the stream is queued", async () => {
  const response = deferred(), nextResponse = deferred();
  const fixture = draftFixture(input => input.text === "\r" ? response.promise : input.text === "next partial" ? nextResponse.promise : { status: "written" });
  const panel = fixture.panel(); panel.queue("partial"); await panel.flush();
  panel.queue("\r"); const pending = panel.flush(); panel.queue("next partial");
  response.resolve({ status: "written" }); await new Promise(setImmediate);
  const remounted = fixture.panel();
  assert.equal(remounted.pending(), true);
  nextResponse.resolve({ status: "written" }); await pending;
  assert.equal(remounted.pending(), true);
  panel.queue("\r"); await panel.flush();
  assert.equal(panel.pending(), false);
});

test("queued control input after Enter does not leave a false draft marker", async () => {
  const response = deferred();
  const fixture = draftFixture(input => input.text === "\r" ? response.promise : { status: "written" });
  const panel = fixture.panel(); panel.queue("partial"); await panel.flush();
  panel.queue("\r"); const pending = panel.flush(); panel.queue("\u000c");
  response.resolve({ status: "written" }); await pending;
  assert.equal(panel.pending(), false);
  assert.equal(panel.store.size, 0);
});

test("an old stream acknowledgment cannot replace the new stream's draft marker", async () => {
  const response = deferred();
  const fixture = draftFixture(input => input.text === "\r" ? response.promise : { status: "written" });
  const first = fixture.panel(); first.queue("partial"); await first.flush();
  first.queue("\r"); const pending = first.flush();
  const replaced = fixture.panel("owner", "terminal", "stream-2"); replaced.queue("new partial"); await replaced.flush();
  response.resolve({ status: "written" }); await pending;
  assert.equal(replaced.pending(), true);
  assert.deepEqual([...replaced.store.keys()], ["owner:terminal:stream-2"]);
});

test("paste submission waits for earlier raw input instead of racing its acknowledgment", async () => {
  const response = deferred();
  const fixture = draftFixture(input => input.text === "\r" ? response.promise : { status: "written" });
  const panel = fixture.panel(); panel.queue("partial"); await panel.flush();
  panel.queue("\r"); const pending = panel.flush();
  await panel.paste("new partial", { status: "written" });
  assert.ok(fixture.errors.some(message => message.startsWith("TERMINAL_INPUT_PENDING")));
  response.resolve({ status: "written" }); await pending;
  await panel.paste("new partial", { status: "written" });
  assert.equal(panel.pending(), true);
});

test("a paste acknowledgment from an unmounted panel cannot clear a new draft", async () => {
  const fixture = draftFixture();
  const panel = fixture.panel(); panel.queue("partial"); await panel.flush();
  const response = deferred();
  const pending = panel.paste("\n", response.promise); panel.unmount();
  const remounted = fixture.panel(); remounted.queue("new partial"); await remounted.flush();
  response.resolve({ status: "written" }); await pending;
  assert.equal(remounted.pending(), true);
});

test("paste input stays serialized after its modal is closed while awaiting acknowledgment", async () => {
  const fixture = draftFixture();
  const panel = fixture.panel(); panel.queue("partial"); await panel.flush();
  const response = deferred();
  const pending = panel.paste("\n", response.promise);
  panel.queue("new partial"); await panel.flush();
  assert.equal(fixture.rawRequests.length, 1, "raw input must be refused while paste is in flight");
  assert.ok(fixture.errors.some(message => message.startsWith("TERMINAL_INPUT_PENDING")));
  await panel.sendQuick();
  assert.equal(fixture.requests.length, 0);
  response.resolve({ status: "written" }); await pending;
  panel.queue("new partial"); await panel.flush();
  assert.equal(panel.pending(), true, "normal input resumes after the paste acknowledgment");
});

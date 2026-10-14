import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(process.env.REMOTE_OPS_TEST_CLIENT ?? new URL("../lib/client.js", import.meta.url), "utf8");
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function fixture() {
  const requests = [], xhrs = [], timers = new Map(), storage = new Map();
  let timerId = 0, active, plugin;
  const hooks = kind => {
    const index = active.index++;
    return active.hooks[index] ??= { kind };
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const hook = hooks("state"); if (!("value" in hook)) hook.value = typeof initial === "function" ? initial() : initial; return [hook.value, value => { hook.value = typeof value === "function" ? value(hook.value) : value; }]; },
    useRef(current) { const hook = hooks("ref"); return hook.value ??= { current }; },
    useEffect(effect, deps) { const hook = hooks("effect"); if (!hook.deps || !deps || deps.some((value, index) => value !== hook.deps[index])) { hook.deps = deps; active.effects.push(() => { hook.cleanup?.(); hook.cleanup = effect(); }); } },
    useCallback(fn, deps) { const hook = hooks("callback"); if (!hook.deps || deps.some((value, index) => value !== hook.deps[index])) { hook.value = fn; hook.deps = deps; } return hook.value; },
    useMemo(fn, deps) { const hook = hooks("memo"); if (!hook.deps || deps.some((value, index) => value !== hook.deps[index])) { hook.value = fn(); hook.deps = deps; } return hook.value; },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
  };
  class Xhr {
    constructor() { this.upload = {}; xhrs.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    send(file) { this.file = file; }
    abort() { this.aborted = true; this.onabort?.(); }
    finish(status = 200, value = { id: "browser-" + xhrs.indexOf(this), status: "completed", finishedAt: "now", target: { kind: "host", path: "/files" } }) { this.status = status; this.responseText = JSON.stringify(value); this.onload(); }
  }
  const directory = { path: "/files", entries: [{ name: "keep.txt", type: "-", size: 12 }, { name: "remove.txt", type: "-", size: 2 }] };
  let tasks = [], filesReply = () => directory;
  vm.runInNewContext(source.replace("return { inject, apply };", "return { inject, apply, SftpWorkspace, browserUploads: typeof browserUploads === 'undefined' ? null : browserUploads };"), {
    window: { __ModuleLoader__: { load: value => { plugin = value.factory(name => name === "react" ? React : {}); } }, requestAnimationFrame: fn => fn() },
    document: { getElementById: () => ({ textContent: "" }) },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    URLSearchParams, XMLHttpRequest: Xhr, crypto: { randomUUID: () => "upload-" + (xhrs.length + 1) },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    fetch: async (_url, init) => { const body = JSON.parse(init.body); requests.push(body); const value = body.action === "files" ? await filesReply(body) : body.action === "transfers" ? { tasks } : { conflictCount: 0 }; return { ok: true, text: async () => JSON.stringify(value) }; },
  });
  const nodes = tree => { const result = []; const visit = node => { if (node && typeof node === "object") { result.push(node); node.children?.forEach(visit); } }; visit(tree); return result; };
  const mount = (owner = "owner-a") => {
    if (!storage.has("remote-ops.files." + owner)) storage.set("remote-ops.files." + owner, JSON.stringify({ panes: [{ kind: "host", path: "/files" }, { kind: "host", path: "/files" }] }));
    const view = { hooks: [], effects: [], index: 0, tree: null, errors: [], visible: true };
    view.render = () => { view.index = 0; active = view; view.tree = plugin.SftpWorkspace({ sessionId: owner, environments: [], visible: view.visible, onError: error => view.errors.push(error), onClose() {} }); active = null; view.effects.splice(0).forEach(effect => effect()); return view; };
    view.find = predicate => nodes(view.tree).find(predicate);
    view.unmount = () => view.hooks.forEach(hook => hook.cleanup?.());
    return view.render();
  };
  return { plugin, mount, requests, xhrs, storage, directory, files: reply => { filesReply = reply; }, tasks: value => { tasks = value; }, async poll() { const entry = [...timers].find(([, value]) => value.delay === 1500); assert.ok(entry, "transfer poll scheduled"); timers.delete(entry[0]); await entry[1].fn(); await tick(); } };
}

const file = name => ({ name, size: 100, lastModified: 1 });
const completed = (id, path = "/files") => ({ id, status: "completed", finishedAt: "now", target: { kind: "host", path }, names: [id], bytes: 1 });

test("historical completed transfers establish a baseline without reloading either pane", async () => {
  const f = fixture(); f.tasks([completed("one"), completed("two"), completed("three")]);
  f.mount(); await tick();
  assert.equal(f.requests.filter(row => row.action === "files").length, 2);
  await f.poll();
  assert.equal(f.requests.filter(row => row.action === "files").length, 2);
});

test("Enter opens a directory once, while Space and ordinary file activation never navigate", async () => {
  const f = fixture();
  f.files(() => ({ path: "/files", entries: [{ name: "folder", type: "d", size: 0 }, f.directory.entries[0]] }));
  const view = f.mount(); await tick(); view.render();
  const folder = view.find(node => node.type === "button" && node.props.title === "folder");
  assert.equal(typeof folder.props.onKeyDown, "function", "directory names need keyboard activation");
  let prevented = 0;
  folder.props.onKeyDown({ key: " ", preventDefault: () => prevented++ });
  assert.equal(f.requests.filter(row => row.action === "files").length, 2);
  folder.props.onKeyDown({ key: "Enter", preventDefault: () => prevented++ });
  await tick(); view.render();
  assert.equal(f.requests.filter(row => row.action === "files" && row.endpoint.path === "/files/folder").length, 1);
  assert.equal(prevented, 1);
  const regular = view.find(node => node.type === "button" && node.props.title === "keep.txt");
  regular.props.onKeyDown?.({ key: "Enter", preventDefault() {} });
  assert.equal(f.requests.filter(row => row.action === "files").length, 3);
});

test("a file selection survives switching workspaces but is reconciled with fresh directory contents", async () => {
  const f = fixture(), first = f.mount(); await tick(); first.render();
  first.find(node => node.props["aria-label"] === "选择 keep.txt").props.onChange({ target: { checked: true } }); first.render(); first.unmount();
  const returned = f.mount(); await tick(); returned.render();
  assert.equal(returned.find(node => node.props["aria-label"] === "选择 keep.txt").props.checked, true);
  returned.unmount(); f.files(() => ({path:"/files",entries:[f.directory.entries[1]]}));
  const changed = f.mount(); await tick(); changed.render();
  assert.equal(changed.find(node => node.props["aria-label"] === "选择 keep.txt"), undefined);
  assert.equal(changed.find(node => node.props["aria-label"] === "选择 remove.txt").props.checked, false);
});

test("Shift selection follows the filtered sorted directory and never selects a hidden file", async () => {
  const f=fixture(); f.files(()=>({path:"/files",entries:[{name:"a.log",type:"-",size:1},{name:"b.txt",type:"-",size:1},{name:"c.log",type:"-",size:1},{name:"d.log",type:"-",size:1}]}));
  const view=f.mount();await tick();view.render();
  view.find(n=>n.props["aria-label"]==="筛选目录 A").props.onChange({target:{value:".log"}});view.render();
  view.find(n=>n.props["aria-label"]==="选择 a.log").props.onChange({target:{checked:true}});view.render();
  view.find(n=>n.props["aria-label"]==="选择 d.log").props.onChange({target:{checked:true},nativeEvent:{shiftKey:true}});view.render();
  assert.equal(view.find(n=>n.props["aria-label"]==="选择 c.log").props.checked,true);
  view.find(n=>n.props["aria-label"]==="筛选目录 A").props.onChange({target:{value:""}});view.render();
  assert.equal(view.find(n=>n.props["aria-label"]==="选择 b.txt").props.checked,false);
});

test("new completions refresh each matching pane once and repeated polls do nothing", async () => {
  const f = fixture(); f.mount(); await tick();
  f.tasks([completed("one"), completed("two"), completed("elsewhere", "/other")]); await f.poll();
  assert.equal(f.requests.filter(row => row.action === "files").length, 4);
  await f.poll(); assert.equal(f.requests.filter(row => row.action === "files").length, 4);
});

test("returning to a retained file view refreshes each pane once, coalescing completions while hidden",async()=>{
  const f=fixture(),view=f.mount();await tick();view.render();
  view.visible=false;view.render();const requests=f.requests.length;
  f.tasks([completed("hidden-one"),completed("hidden-two")]);await tick();assert.equal(f.requests.length,requests);
  view.visible=true;view.render();await tick();view.render();
  assert.equal(f.requests.filter(row=>row.action==="files").length,4);
  await f.poll();assert.equal(f.requests.filter(row=>row.action==="files").length,4);
});

test("refresh keeps visible entries, current selection and scroll until updated results arrive", async () => {
  const f = fixture(), view = f.mount(); await tick(); view.render();
  view.find(node => node.props["aria-label"] === "选择 keep.txt").props.onChange({ target: { checked: true } }); view.render();
  const list = { scrollTop: 70, querySelector: () => null };
  view.find(node => node.props.className === "dsh-remote-ops__sftpEntries").props.ref(list);
  view.find(node => node.props.className === "dsh-remote-ops__sftpEntries").props.onScroll({ currentTarget: list });
  const response = deferred(); f.files(() => response.promise);
  const pending = view.find(node => node.props["aria-label"] === "刷新目录 A").props.onClick(); view.render();
  assert.ok(view.find(node => node.props["aria-label"] === "选择 keep.txt"), "the current list must remain rendered while refreshing");
  assert.equal(view.find(node => node.props["aria-label"] === "选择 keep.txt").props.checked, true);
  list.scrollTop = 90;
  view.find(node => node.props.className === "dsh-remote-ops__sftpEntries").props.onScroll({ currentTarget: list });
  response.resolve({ path: "/files", entries: [f.directory.entries[0]] }); await pending; await tick(); view.render();
  assert.equal(view.find(node => node.props["aria-label"] === "选择 keep.txt").props.checked, true);
  assert.equal(list.scrollTop, 90, "a scroll performed during refresh must also be retained");
});

test("browser upload continues across file-view and plugin remounts, retaining its owner and batch", async () => {
  const f = fixture(), first = f.mount(); await tick(); first.render();
  const upload = first.find(node => node.type === "input" && node.props.type === "file");
  upload.props.onChange({ target: { files: [file("first.txt"), file("second.txt")], value: "" } }); await tick();
  assert.equal(f.xhrs.length, 1); first.unmount();
  assert.notEqual(f.xhrs[0].aborted, true, "switching views must not abort the request");
  const other = f.mount("owner-b"); await tick(); other.render();
  assert.equal(other.find(node => node.type === "button" && node.children.includes("取消上传")), undefined, "another owner must not control this upload");
  f.xhrs[0].finish(); await tick(); assert.equal(f.xhrs.length, 2, "the remaining batch continues without a mounted view");
  assert.equal(new URL(f.xhrs[1].url, "http://localhost").searchParams.get("sessionId"), "owner-a");
  const returned = f.mount(); await tick(); returned.render();
  assert.ok(returned.find(node => node.type === "button" && node.children.includes("取消上传")));
  f.xhrs[1].finish(); await tick(); returned.render();
  assert.equal(f.plugin.browserUploads.get("owner-a").status, "completed");
});

test("explicit cancellation aborts the active request and never sends remaining files", async () => {
  const f = fixture(); assert.ok(f.plugin.browserUploads, "uploads must be owned outside the file view");
  f.plugin.browserUploads.start({ owner: "owner-a", target: { kind: "host", path: "/files" }, files: [file("one"), file("two")], conflict: "error" });
  f.plugin.browserUploads.cancel("owner-a"); await tick();
  assert.equal(f.xhrs[0].aborted, true); assert.equal(f.xhrs.length, 1);
  assert.equal(f.plugin.browserUploads.get("owner-a").status, "cancelled");
});

test("a failed browser upload retains useful feedback after remount and stops the batch", async () => {
  const f = fixture(); assert.ok(f.plugin.browserUploads);
  f.plugin.browserUploads.start({ owner: "owner-a", target: { kind: "host", path: "/files" }, files: [file("one"), file("two")], conflict: "error" });
  f.xhrs[0].finish(400, { error: "TARGET_FULL: destination full" }); await tick();
  assert.equal(f.plugin.browserUploads.get("owner-a").status, "failed");
  assert.match(f.plugin.browserUploads.get("owner-a").error, /destination full/); assert.equal(f.xhrs.length, 1);
});

test("browser completion and server polling share one directory invalidation", async () => {
  const f = fixture(); assert.ok(f.plugin.browserUploads); f.mount(); await tick();
  f.plugin.browserUploads.start({ owner: "owner-a", target: { kind: "host", path: "/files" }, files: [file("one")], conflict: "error" });
  const task = completed("browser-task"); f.xhrs[0].finish(200, task); await tick();
  f.tasks([task]); await f.poll();
  assert.equal(f.requests.filter(row => row.action === "files").length, 4);
  await f.poll(); assert.equal(f.requests.filter(row => row.action === "files").length, 4);
});

test("completions during an in-flight directory request queue one follow-up instead of overlapping requests", async () => {
  const f = fixture(), view = f.mount(); await tick(); view.render();
  const response = deferred(); let count = 0;
  f.files(body => body.endpoint.path === "/files" && count++ === 0 ? response.promise : f.directory);
  view.find(node => node.props["aria-label"] === "刷新目录 A").props.onClick(); view.render();
  f.tasks([completed("one"), completed("two")]); await f.poll();
  assert.equal(f.requests.filter(row => row.action === "files").length, 4, "only B may refresh while A's request is active");
  response.resolve(f.directory); await tick();
  assert.equal(f.requests.filter(row => row.action === "files").length, 5, "A receives exactly one follow-up");
});

test("a queued refresh after directory navigation keeps the address at the directory being shown",async()=>{
  const f=fixture();f.files(()=>({path:"/files",entries:[{name:"folder",type:"d",size:0}]}));
  const view=f.mount();await tick();view.render();
  const response=deferred();let count=0;
  f.files(body=>body.endpoint.path==="/files/folder"&&count++===0?response.promise:{path:body.endpoint.path,entries:[]});
  view.find(n=>n.type==="button"&&n.props.title==="folder").props.onKeyDown({key:"Enter",preventDefault(){}});view.render();
  f.tasks([completed("navigation-finished","/files/folder")]);await f.poll();
  response.resolve({path:"/files/folder",entries:[]});await tick();view.render();
  assert.equal(view.find(n=>n.props["aria-label"]==="路径 A").props.value,"/files/folder");
  assert.equal(f.requests.filter(r=>r.action==="files"&&r.endpoint.path==="/files/folder").length,2);
});

test("directory refresh retains an actual unsubmitted path edit",async()=>{
  const f=fixture(),view=f.mount();await tick();view.render();
  view.find(n=>n.props["aria-label"]==="路径 A").props.onChange({target:{value:"/typed-but-not-opened"}});view.render();
  view.find(n=>n.props["aria-label"]==="刷新目录 A").props.onClick();await tick();view.render();
  assert.equal(view.find(n=>n.props["aria-label"]==="路径 A").props.value,"/typed-but-not-opened");
});

test("the plugin upload owner rejects a duplicate batch and disposes active requests on plugin unload", async () => {
  const f = fixture(); assert.ok(f.plugin.browserUploads);
  const job = { owner: "owner-a", target: { kind: "host", path: "/files" }, files: [file("one")], conflict: "error" };
  assert.equal(f.plugin.browserUploads.start(job), true);
  assert.equal(f.plugin.browserUploads.start(job), false);
  f.plugin.browserUploads.dispose(); await tick();
  assert.equal(f.xhrs[0].aborted, true); assert.equal(f.xhrs.length, 1);
  assert.equal(f.plugin.browserUploads.get("owner-a"), null);
});

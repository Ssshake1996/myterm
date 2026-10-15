import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { BrowserWorkspace, browserInstallerCli } from "../lib/browser-workspace.js";
import { execFileSync } from "node:child_process";
import { registerBrowserRoutes } from "../lib/browser-routes.js";
import { registerBrowserTools } from "../lib/browser-tools.js";
import { registerBrowserSkill } from "../lib/browser-skill.js";
import { browserRunSource, browserSteps } from "../lib/browser-steps.js";

test("bundled browser skill exposes valid inline examples through the native provider", async () => {
  let provider;
  registerBrowserSkill({ inject: (services, ready) => {
    assert.deepEqual(services, ["skills"]);
    ready({ skills: { registerProvider: create => { provider = create(); } } });
  } });
  const [candidate] = await provider.list({});
  const skill = await provider.get(candidate, {});
  assert.equal(candidate.name, "remote-ops-browser");
  assert.equal(candidate.source, "bundled");
  assert.equal(candidate.rank, 600);
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true });
  assert.equal(candidate.path.endsWith(join("skills", "remote-ops-browser", "SKILL.md")), true);
  assert.ok(candidate.description.length > 20);
  assert.doesNotMatch(skill.content, /^---/);
  const example = JSON.parse(skill.content.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(example.flowId, undefined);
  assert.equal(browserRunSource(example), example.steps);
  assert.equal(browserSteps(example.steps).at(-1).action, "read");
});

test("optional native skills service does not gate browser operations", () => {
  assert.doesNotThrow(() => registerBrowserSkill({}));
  let services;
  assert.doesNotThrow(() => registerBrowserSkill({ inject: value => { services = value; } }));
  assert.deepEqual(services, ["skills"]);
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "remote-ops-browser-"));
  const secrets = new Map(), writes = [], launches = [];
  const page = new EventEmitter();
  let address = "about:blank", block;
  const locator = selector => { const value = selector.replace(/^(css|xpath)=/, ""); return ({
    count: async () => value === "missing" ? 0 : value === "duplicate" ? 2 : 1,
    isVisible: async () => true,
    evaluate: async () => ({ password: false, origin: new URL(address).origin }),
    fill: async text => { writes.push(text); },
    click: async () => { writes.push(value); if (block) await block; },
    press: async key => writes.push(key),
    highlight: async () => {},
    waitFor: async () => {},
    innerText: async () => "result test-secret",
  }); };
  Object.assign(page, { url: () => address, isClosed: () => false, mainFrame: () => page,
    title: async () => "Test", locator, getByRole: (_role, { name }) => locator(name), getByLabel: locator,
    getByText: locator, getByPlaceholder: locator, frameLocator: () => ({ locator }),
    goto: async value => { address = value; page.emit("framenavigated", page); },
    bringToFront: async () => {}, screenshot: async () => Buffer.from("png"),
    evaluate: async () => ({ text: "test-secret", elements: [] }),
  });
  const context = new EventEmitter();
  Object.assign(context, { pages: () => [page], newPage: async () => page, close: async () => { context.emit("close"); } });
  const credentials = { set: async (key, value) => secrets.set(key, value), resolve: async key => ({ value: secrets.get(key) }) };
  const workspace = new BrowserWorkspace({ root, credentials, launchContext: async (path, options) => { launches.push({ path, options }); return context; } });
  await workspace.ready;
  const site = await workspace.saveSite({ name: "Test site", url: "https://example.test/login", browser: "msedge" }, "test-secret");
  t.after(async () => { await workspace.dispose(); await rm(root, { recursive: true, force: true }); });
  return { workspace, site, root, page, writes, launches, block: promise => { block = promise; } };
}
const until = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error("test condition timed out"); };
const click = value => ({ action: "click", target: { kind: "css", value } });

function browserRunEntry(workspace, entry) {
  const routes = new Map(), tools = new Map();
  const ctx = { effect: effect => effect(), connection: { fetch: { register: route => routes.set(route.path, route) } }, tools: { register: tool => tools.set(tool.name, tool) }, systemPrompt: { section() {} } };
  const state = { browser: workspace, resolveOwner: async id => ({ id }) };
  registerBrowserRoutes(ctx, state); registerBrowserTools(ctx, state);
  return async args => {
    if (entry === "tool") return tools.get("remote_browser_run").execute(args, { agent: { id: "owner" } });
    const response = await routes.get("/api/dsh-remote-ops/browser").fetch(new Request("http://local/api", { method: "POST", body: JSON.stringify({ action: "run", sessionId: "owner", ...args }) }));
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error), { code: value.code });
    return value.result;
  };
}

test("browser run treats omitted, null and blank flow IDs as inline steps in tools and HTTP", async t => {
  const { workspace: w, site, writes } = await fixture(t), session = await w.open("owner", site.id);
  for (const entry of ["tool", "http"]) for (const [index, flowId] of [undefined, null, "", " ", "\t\n"].entries()) {
    const value = entry + index, result = await browserRunEntry(w, entry)({ browserId: session.id, requestId: value, flowId, steps: [click(value)] });
    await w.session("owner", session.id).job.done;
    assert.equal(result.count, 1); assert.equal(w.session("owner", session.id).job.status, "completed");
  }
  assert.deepEqual(writes, ["tool0", "tool1", "tool2", "tool3", "tool4", "http0", "http1", "http2", "http3", "http4"]);
});

test("saved browser flows accept trimmed IDs and empty optional steps without losing deduplication", async t => {
  const { workspace: w, site, writes } = await fixture(t), session = await w.open("owner", site.id);
  const flow = await w.saveFlow({ name: "Saved", siteId: site.id, steps: [click("saved")] });
  for (const entry of ["tool", "http"]) {
    const run = browserRunEntry(w, entry), args = { browserId: session.id, requestId: "saved-" + entry, flowId: " " + flow.id + " ", steps: [] };
    const first = await run(args); await w.session("owner", session.id).job.done;
    assert.equal((await run({ ...args, flowId: flow.id })).id, first.id);
  }
  assert.deepEqual(writes, ["saved", "saved"]);
});

test("nonblank browser flow IDs and inline steps conflict before either source executes", async t => {
  const { workspace: w, site, writes } = await fixture(t), session = await w.open("owner", site.id);
  const flow = await w.saveFlow({ name: "Saved", siteId: site.id, steps: [click("saved")] });
  for (const entry of ["tool", "http"]) for (const flowId of [flow.id, "not-saved"]) {
    await assert.rejects(browserRunEntry(w, entry)({ browserId: session.id, requestId: entry, flowId, steps: [click("inline")] }), { code: "BROWSER_RUN_SOURCE_CONFLICT" });
  }
  assert.deepEqual(writes, []); assert.equal(w.session("owner", session.id).job, undefined); assert.equal(w.receipts.size, 0);
});

test("invalid browser run field types are diagnosed before dispatch without exposing their contents", async t => {
  const { workspace: w, site, writes } = await fixture(t), session = await w.open("owner", site.id);
  for (const entry of ["tool", "http"]) for (const fields of [{ steps: JSON.stringify([click("test-secret")]) }, { steps: {} }, { steps: 4 }, { flowId: 3 }, { flowId: {} }]) {
    const code = Object.hasOwn(fields, "steps") ? "BROWSER_STEP_INVALID" : "BROWSER_FLOW_ID_INVALID";
    await assert.rejects(browserRunEntry(w, entry)({ browserId: session.id, requestId: entry, ...fields }), error => error.code === code && !error.message.includes("test-secret"));
  }
  assert.deepEqual(writes, []); assert.equal(w.receipts.size, 0);
});

test("browser run without a nonempty flow ID or steps array reports the missing source", async t => {
  const { workspace: w, site, writes } = await fixture(t), session = await w.open("owner", site.id);
  for (const entry of ["tool", "http"]) for (const fields of [{}, { flowId: "" }, { flowId: " ", steps: [] }, { flowId: null, steps: null }]) {
    await assert.rejects(browserRunEntry(w, entry)({ browserId: session.id, requestId: entry, ...fields }), { code: "BROWSER_RUN_SOURCE_REQUIRED" });
  }
  assert.deepEqual(writes, []); assert.equal(w.receipts.size, 0);
});

test("missing browser flow errors are recoverable with inline steps under the same unaccepted request ID", async t => {
  const { workspace: w, site, writes } = await fixture(t), session = await w.open("owner", site.id);
  for (const entry of ["tool", "http"]) {
    const run = browserRunEntry(w, entry), requestId = "recover-" + entry;
    await assert.rejects(run({ browserId: session.id, requestId, flowId: "missing" }), error => error.code === "BROWSER_FLOW_NOT_FOUND" && /remote_browser_list/.test(error.message) && /steps/.test(error.message));
    assert.equal(w.receipts.has("owner:" + session.id + ":" + requestId), false);
    const args = { browserId: session.id, requestId, steps: [click(entry)] }, first = await run(args); await w.session("owner", session.id).job.done;
    assert.equal((await run(args)).id, first.id);
  }
  assert.deepEqual(writes, ["tool", "http"]);
});

test("saved browser flows remain site-bound even when a direct URL has the same origin", async t => {
  const { workspace: w, site, writes } = await fixture(t);
  const flow = await w.saveFlow({ name: "Saved", siteId: site.id, steps: [click("saved")] });
  const direct = await w.openUrl("owner", site.url); assert.notEqual(direct.siteId, site.id);
  for (const entry of ["tool", "http"]) {
    const run = browserRunEntry(w, entry);
    await assert.rejects(run({ requestId: "wrong-site-" + entry, flowId: flow.id }), { code: "BROWSER_FLOW_SITE_MISMATCH" });
    assert.equal(w.active.get("owner"), direct.id); assert.deepEqual(writes, []);
  }
  const result = await browserRunEntry(w, "tool")({ requestId: "direct-inline", flowId: "", steps: [click("inline")] });
  await w.session("owner", direct.id).job.done; assert.equal(result.count, 1); assert.deepEqual(writes, ["inline"]);
});

test("the Chromium installer resolves a runnable packaged CLI", () => {
  assert.match(execFileSync(process.execPath, [browserInstallerCli(), "--version"], { encoding: "utf8" }), /Version 1\.64\.0/);
});

test("browser profiles are visible, deduplicate opens and isolate DSH owners", async t => {
  const { workspace: w, site, launches } = await fixture(t);
  const [one, same] = await Promise.all([w.open("owner-a", site.id), w.open("owner-a", site.id)]);
  assert.equal(one.id, same.id); assert.equal(launches.length, 1);
  assert.equal(launches[0].options.headless, false);
  await w.open("owner-b", site.id);
  assert.notEqual(launches[0].path, launches[1].path);
  assert.throws(() => w.session("owner-b", one.id), /BROWSER_SESSION_NOT_FOUND/);
});

test("site persistence contains credential references but never the password", async t => {
  const { workspace: w, site, root } = await fixture(t);
  const text = await readFile(join(root, "sites.json"), "utf8");
  assert.ok(site.passwordRef); assert.ok(!text.includes("test-secret"));
  await assert.rejects(w.saveSite({ url: "file:///private", name: "bad" }), /BROWSER_URL_INVALID/);
  await assert.rejects(w.saveSite({ id: "../escape", url: "https://a.test", name: "bad" }), /BROWSER_SITE_INVALID/);
});

test("steps require exactly one match and never click an ambiguous selector", async t => {
  const { workspace: w, site, writes } = await fixture(t);
  const session = await w.open("owner", site.id);
  for (const target of ["missing", "duplicate"]) {
    const job = await w.run("owner", session.id, [click(target)]);
    await until(() => job.status === "failed");
    assert.equal(job.error.code, "BROWSER_TARGET_COUNT");
  }
  assert.deepEqual(writes, []);
});

test("run receipts prevent duplicate effects and reject changed retry payloads", async t => {
  const { workspace: w, site, writes } = await fixture(t);
  const session = await w.open("owner", site.id);
  const job = await w.run("owner", session.id, [click("save")], { requestId: "same" });
  const same = await w.run("owner", session.id, [click("save")], { requestId: "same" });
  assert.equal(same.id, job.id); await until(() => job.status === "completed");
  assert.deepEqual(writes, ["save"]);
  await assert.rejects(w.run("owner", session.id, [click("delete")], { requestId: "same" }), /BROWSER_REQUEST_CONFLICT/);
});

test("native conversation cancellation waits for the current effect and stops subsequent steps", async t => {
  const { workspace: w, site, writes, block } = await fixture(t);
  let finish; block(new Promise(resolve => { finish = resolve; }));
  const session = await w.open("owner", site.id);
  const job = await w.run("owner", session.id, [click("first"), click("second")]);
  await until(() => writes.length === 1);
  const controller=new AbortController();w.bindOwnerSignal('owner',controller.signal);controller.abort();
  assert.equal(job.status,"stopping");
  finish(); await until(() => job.status === "stopped");
  assert.deepEqual(writes, ["first"]);
  assert.equal(w.session('owner',session.id).closed,false);
});

test("single-step and stop preserve a paused browser without replaying completed actions", async t => {
  const { workspace: w, site, writes } = await fixture(t);
  const session = await w.open("owner", site.id);
  const job = await w.run("owner", session.id, [click("one"), click("two")], { mode: "step" });
  assert.equal(job.status, "paused");
  await w.control("owner", session.id, "step"); await until(() => writes.length === 1 && job.status === "paused");
  await w.control("owner", session.id, "stop"); await until(() => job.status === "stopped");
  assert.deepEqual(writes, ["one"]); assert.equal(w.session("owner", session.id).closed, false);
});

test("credential values are origin restricted and redacted from results and errors", async t => {
  const { workspace: w, site, writes, page } = await fixture(t);
  const session = await w.open("owner", site.id);
  const job = await w.run("owner", session.id, [{ action: "fill", target: { kind: "css", value: "password" }, secretRef: site.passwordRef }, { action: "read", target: { kind: "css", value: "output" } }]);
  await until(() => job.status === "completed");
  assert.deepEqual(writes, ["test-secret"]); assert.ok(!JSON.stringify(w.snapshot("owner")).includes("test-secret"));
  await page.goto("https://other.test");
  const denied = await w.run("owner", session.id, [{ action: "fill", target: { kind: "css", value: "password" }, secretRef: site.passwordRef }]);
  await until(() => denied.status === "failed"); assert.equal(denied.error.code, "BROWSER_CREDENTIAL_ORIGIN");
});

test("flow persistence validates actions and expands parameters without executing code", async t => {
  const { workspace: w, site, writes } = await fixture(t);
  const flow = await w.saveFlow({ name: "Query", siteId: site.id, steps: [{ action: "fill", target: { kind: "css", value: "command" }, value: "{{command}}" }] });
  const session = await w.open("owner", site.id);
  const job = await w.run("owner", session.id, flow.id, { variables: { command: "show version" } });
  await until(() => job.status === "completed"); assert.deepEqual(writes, ["show version"]);
  await assert.rejects(w.saveFlow({ name: "bad", siteId: site.id, steps: [{ action: "evaluate", value: "process.exit()" }] }), /BROWSER_STEP_INVALID/);
  await assert.rejects(w.run("owner", session.id, flow.id), /BROWSER_VARIABLE_MISSING/);
});

test("concurrent configuration saves retain both sites", async t => {
  const { workspace: w } = await fixture(t);
  await Promise.all([w.saveSite({ name: "A", url: "https://a.test" }), w.saveSite({ name: "B", url: "https://b.test" })]);
  assert.deepEqual(w.sites.map(site => site.name).sort(), ["A", "B", "Test site"]);
});

test("a cross-origin frame cannot receive the saved site password", async t => {
  const { workspace: w, site, page, writes } = await fixture(t);
  const session = await w.open("owner", site.id);
  page.frameLocator = () => ({ locator: () => ({ count: async () => 1, evaluate: async () => ({ origin: "https://other.test" }), fill: async value => writes.push(value) }) });
  const job = await w.run("owner", session.id, [{ action: "fill", secretRef: site.passwordRef, target: { kind: "css", value: "password", frame: "iframe" } }]);
  await job.done;
  assert.equal(job.status, "failed"); assert.equal(job.error.code, "BROWSER_CREDENTIAL_ORIGIN"); assert.deepEqual(writes, []);
});

test("an effect followed by an error stays uncertain and duplicate requests do not replay it", async t => {
  const { workspace: w, site, page, writes } = await fixture(t);
  const session = await w.open("owner", site.id);
  page.locator = () => ({ count: async () => 1, click: async () => { writes.push("sent"); throw new Error("response lost"); } });
  const job = await w.run("owner", session.id, [click("submit")], { requestId: "uncertain" }); await job.done;
  assert.equal(job.status, "unknown");
  assert.equal((await w.run("owner", session.id, [click("submit")], { requestId: "uncertain" })).id, job.id);
  assert.deepEqual(writes, ["sent"]);
});

test("browser HTTP routes and tools enforce owner isolation and expose only serializable results", async t => {
  const { workspace: w, site } = await fixture(t);
  const routes = new Map(), tools = new Map(), agents = new Map([["owner", { id: "owner" }], ["other", { id: "other" }]]);
  const state = { browser: w, resolveOwner: async id => { if (!agents.has(id)) throw new Error("unknown owner"); return agents.get(id); } };
  const ctx = { effect: effect => effect(), connection: { fetch: { register: route => routes.set(route.path, route) } }, agents: { get: id => agents.get(id) }, tools: { register: tool => tools.set(tool.name, tool) }, systemPrompt: { section() {} } };
  registerBrowserRoutes(ctx, state); registerBrowserTools(ctx, state);
  const post = body => routes.get("/api/dsh-remote-ops/browser").fetch(new Request("http://local/api", { method: "POST", body: JSON.stringify(body) }));
  const opened = await tools.get("remote_browser_open").execute({ siteId: site.id }, { agent: agents.get("owner") });
  const denied = await post({ action: "run", sessionId: "other", browserId: opened.id, steps: [click("save")] });
  assert.equal(denied.status, 400); assert.equal((await denied.json()).code, "BROWSER_SESSION_NOT_FOUND");
  const result = await tools.get("remote_browser_run").execute({ browserId: opened.id, steps: [click("save")], requestId: "http-test" }, { agent: agents.get("owner") });
  assert.ok(result.id); assert.equal(result.done, undefined); assert.doesNotThrow(() => JSON.stringify(result));
  await w.session("owner", opened.id).job.done;
  const screenshot = routes.get("/api/dsh-remote-ops/browser/screenshot");
  assert.equal((await screenshot.fetch(new Request(`http://local/api?sessionId=other&browserId=${opened.id}`))).status, 404);
  assert.equal((await screenshot.fetch(new Request(`http://local/api?sessionId=owner&browserId=${opened.id}`))).headers.get("Content-Type"), "image/png");
});

test("a role locator without a name matches the role rather than an empty accessible name", async t => {
  const { workspace: w, site, page } = await fixture(t);
  const session = await w.open("owner", site.id);
  page.getByRole = (_role, options) => { assert.ok(!Object.hasOwn(options, "name")); return page.locator("button"); };
  const job = await w.run("owner", session.id, [{ action: "read", target: { kind: "role", value: "button" } }]); await job.done;
  assert.equal(job.status, "completed");
});

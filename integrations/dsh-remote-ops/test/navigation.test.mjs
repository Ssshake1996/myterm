import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
const PANEL_ID = "dsh-remote-ops";
const legacySlots = ["shell.overlay", "sidebar.footer.action", "sidebar.right.pane.tab", "sidebar.right.pane.tab.title"];

// Exercise registrations against disposable service/slot scopes. Business panel
// elements stay unmounted: these tests do not claim browser or transport coverage.
function navigationFixture({ native = false, rightbar = false, manager = false, tooltip = false } = {}) {
  const registrations = new Set(), watchers = new Set(), timers = new Map(), tabTypes = new Set();
  const slots = new Set(legacySlots), services = new Map(), warnings = [];
  let currentScope, timerId = 0, plugin, language = "zh";
  const scopes = new Set();
  const own = (scope, dispose) => {
    let active = true;
    const once = () => { if (active) { active = false; scope.disposers.delete(once); dispose(); } };
    scope.disposers.add(once);
    return once;
  };
  const newScope = () => {
    const scope = { disposers: new Set(), closed: false };
    scope.close = () => {
      if (scope.closed) return;
      scope.closed = true;
      for (const dispose of [...scope.disposers].reverse()) dispose();
      scopes.delete(scope);
    };
    scopes.add(scope);
    return scope;
  };
  const run = (scope, callback) => {
    const previous = currentScope;
    currentScope = scope;
    try {
      const result = callback();
      if (typeof result === "function") own(scope, result);
      return result;
    } finally { currentScope = previous; }
  };
  const watch = (owner, ready, callback) => {
    let child;
    const watcher = {
      sync() {
        if (owner.closed) return;
        if (!ready()) { child?.close(); child = undefined; }
        else if (!child) { child = newScope(); run(child, () => callback(context(child))); }
      },
    };
    watchers.add(watcher);
    const dispose = own(owner, () => { watchers.delete(watcher); child?.close(); });
    watcher.sync();
    return dispose;
  };
  const sync = () => { for (const watcher of [...watchers]) watcher.sync(); };
  const dictionaries = new Map();
  function context(scope) {
    return {
      get: name => services.get(name),
      effect: callback => {
        const effectScope = newScope();
        const dispose = own(currentScope ?? scope, effectScope.close);
        run(effectScope, callback);
        return dispose;
      },
      inject: (names, callback) => watch(currentScope ?? scope, () => names.every(name => services.has(name)), callback),
      locale: {
        register: (namespace, values) => {
          dictionaries.set(namespace, values);
          return () => dictionaries.delete(namespace);
        },
        bind: namespace => key => dictionaries.get(namespace)?.[language]?.[key] ?? `${language}:${key}`,
      },
      slots: {
        inject: (name, callback) => watch(currentScope ?? scope, () => slots.has(name), callback),
        register: (definition, component) => {
          const entry = { definition, component };
          registrations.add(entry);
          return own(currentScope ?? scope, () => registrations.delete(entry));
        },
      },
    };
  }
  const h = (type, props, ...children) => ({ type, key: props?.key, props: { ...props, children: children.flat() } });
  const React = {
    createElement: h,
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  const tooltips = [];
  const primitives = tooltip ? { Tooltip: props => { tooltips.push(props); return props.children[0]; } } : {};
  const window = {
    __ModuleLoader__: { load: definition => { plugin = definition.factory(name => name === "react" ? React : primitives); } },
    setInterval: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearInterval: id => timers.delete(id),
  };
  vm.runInNewContext(source, {
    window, document: { getElementById: () => ({ textContent: "" }) },
    console: { warn: message => warnings.push(message) },
  }, { filename: "client.js" });
  if (manager) services.set("pluginNavigation", { openBundle() {} });
  if (native) { services.set("layout", {}); slots.add("main"); slots.add("sidebar.panellist"); }
  if (rightbar) {
    services.set("sidebarRight", { openTab() {} });
    services.set("sidebarRightTabs", { register: definition => { tabTypes.add(definition); return () => tabTypes.delete(definition); } });
  }
  const root = newScope();
  run(root, () => plugin.apply(context(root)));
  const entries = name => [...registrations].filter(entry => entry.definition.name === name);
  const render = (element) => {
    if (element == null) return null;
    if (typeof element.type === "function" && element.type.name !== "RemoteOpsPanel") return render(element.type(element.props));
    return element;
  };
  const renderSlot = (name, props = {}) => {
    const entry = entries(name)[0];
    assert.ok(entry, `${name} registration must exist`);
    return render(h(entry.component, props));
  };
  return {
    entries, renderSlot, timers, warnings, registrations, watchers, scopes, tabTypes, dictionaries, tooltips,
    setService(name, value) { if (value === undefined) services.delete(name); else services.set(name, value); sync(); },
    setSlot(name, available) { if (available) slots.add(name); else slots.delete(name); sync(); },
    setLanguage(value) { language = value; },
    tick(count = 1) { for (let i = 0; i < count; i++) for (const callback of [...timers.values()]) callback(); },
    dispose: root.close,
  };
}

test("left entry opens the native right Sidebar without registering a main workspace", () => {
  const fixture = navigationFixture({ native: true, manager: true });
  const opened = [];
  fixture.setService("sidebarRight", { openTab: kind => opened.push(kind) });
  assert.equal(fixture.entries("sidebar.panellist").length, 0);
  assert.equal(fixture.entries("main").length, 0);
  assert.equal(fixture.entries("sidebar.footer.action").length, 1);
  fixture.renderSlot("sidebar.footer.action", { wide: true }).props.onClick();
  assert.deepEqual(opened, ["dsh-remote-ops"]);
  fixture.dispose();
});

test("left action metadata and accessible name follow the locale binding", () => {
  const fixture = navigationFixture({ native: true });
  const [entry] = fixture.entries("sidebar.footer.action");
  assert.equal(typeof entry.definition.label, "function");
  assert.ok(entry.definition.locale);
  assert.equal(entry.definition.label(), "Remote Ops");
  assert.equal(fixture.renderSlot("sidebar.footer.action", { wide: true }).props["aria-label"], "Remote Ops");
  fixture.setLanguage("unregistered-test-language");
  assert.equal(entry.definition.label(), "unregistered-test-language:title");
  assert.equal(fixture.renderSlot("sidebar.footer.action", { wide: false }).props["aria-label"], "unregistered-test-language:title");
  fixture.dispose();
});

test("the collapsed action delegates its tooltip to the public host primitive", () => {
  const fixture = navigationFixture({ tooltip: true });
  const button = fixture.renderSlot("sidebar.footer.action", { wide: false });
  assert.equal(button.type, "button");
  assert.equal(button.props["aria-label"], "Remote Ops");
  assert.equal(button.props.title, undefined, "do not add a duplicate native title tooltip");
  assert.equal(fixture.tooltips[0].disabled, false);
  assert.equal(fixture.tooltips[0].label, "Remote Ops");
  fixture.renderSlot("sidebar.footer.action", { wide: true });
  assert.equal(fixture.tooltips[1].disabled, true);
  fixture.dispose();
});

test("packaged locale files match the dictionaries registered with DSH", async () => {
  const fixture = navigationFixture({ native: true });
  const namespace = fixture.entries("sidebar.footer.action")[0].definition.locale;
  for (const language of ["en", "zh"]) {
    const packaged = JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), "utf8"));
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.dictionaries.get(namespace)[language])), packaged);
  }
  fixture.dispose();
});

test("right panel uses the host session owner and remounts for a different conversation", () => {
  const fixture = navigationFixture({ native: true, rightbar: true });
  const first = fixture.renderSlot("sidebar.right.pane.tab", { sessionId: "owner-a" });
  const next = fixture.renderSlot("sidebar.right.pane.tab", { sessionId: "owner-b" });
  assert.equal(first.type.name, "RemoteOpsPanel");
  assert.equal(first.props.sessionId, "owner-a");
  assert.equal(first.key, "owner-a");
  assert.equal(next.props.sessionId, "owner-b");
  assert.notEqual(first.key, next.key);
  fixture.dispose();
});

test("a stored main panel selection cannot suppress the right panel", () => {
  const fixture = navigationFixture({ native: true, rightbar: true });
  const panel = fixture.renderSlot("sidebar.right.pane.tab", { sessionId: "owner-a", usePanelInfo: select => select({ activePanelId: PANEL_ID }) });
  assert.equal(panel.type.name, "RemoteOpsPanel");
  assert.equal(panel.props.sessionId, "owner-a");
  fixture.dispose();
});

test("plugin manager availability cannot hide the direct left action", () => {
  const fixture = navigationFixture({ native: true, manager: true });
  assert.equal(fixture.renderSlot("sidebar.footer.action", { wide: true }).type, "button");
  fixture.setService("pluginNavigation", undefined);
  assert.equal(fixture.renderSlot("sidebar.footer.action", { wide: false }).type, "button");
  fixture.dispose();
});

test("right tab keeps its published identity without duplicate guide links", () => {
  const fixture = navigationFixture({ native: true, rightbar: true });
  const [tab] = fixture.tabTypes;
  assert.equal(tab.id, "@dsh/remote-ops");
  assert.equal(tab.kind, "dsh-remote-ops");
  assert.equal(tab.guide.length, 0);
  assert.equal(fixture.entries("sidebar.right.pane.tab")[0].definition.key, tab.id);
  fixture.dispose();
  assert.equal(fixture.tabTypes.size, 0);
});

for (const capability of ["main", "sidebar.panellist", "layout"]) {
  test(`the left action survives unrelated ${capability} unload`, () => {
    const fixture = navigationFixture({ native: true, rightbar: true });
    if (capability === "layout") fixture.setService(capability, undefined);
    else fixture.setSlot(capability, false);
    assert.equal(fixture.entries("main").length, 0);
    assert.equal(fixture.entries("sidebar.panellist").length, 0);
    assert.equal(fixture.renderSlot("sidebar.footer.action").type, "button");
    fixture.dispose();
  });
}

test("the left action unloads and reloads once with its host slot", () => {
  const fixture = navigationFixture({ native: true, rightbar: true });
  fixture.setSlot("sidebar.footer.action", false);
  assert.equal(fixture.entries("sidebar.footer.action").length, 0);
  fixture.setSlot("sidebar.footer.action", true);
  assert.equal(fixture.entries("sidebar.footer.action").length, 1);
  fixture.dispose();
});

test("legacy launcher waits for the service and a success on the last retry emits no error", () => {
  const fixture = navigationFixture();
  fixture.renderSlot("sidebar.footer.action").props.onClick();
  assert.equal(fixture.timers.size, 1);
  fixture.tick(39);
  let opened = 0;
  fixture.setService("sidebarRight", { openTab: () => opened++ });
  fixture.tick();
  assert.equal(opened, 1);
  assert.equal(fixture.timers.size, 0);
  assert.deepEqual(fixture.warnings, []);
  assert.equal(fixture.renderSlot("shell.overlay"), null);
  fixture.dispose();
});

test("legacy launcher retries remain single and recover cleanly after a visible failure", () => {
  const fixture = navigationFixture();
  const click = () => fixture.renderSlot("sidebar.footer.action").props.onClick();
  click(); click();
  assert.equal(fixture.timers.size, 1);
  fixture.tick(40);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.renderSlot("shell.overlay").props.role, "alert");
  fixture.setService("sidebarRight", { openTab() {} });
  click();
  assert.equal(fixture.renderSlot("shell.overlay"), null);
  fixture.dispose();
});

test("plugin unload disposes navigation, compatibility registrations, pending timers and dictionaries", () => {
  const fixture = navigationFixture({ rightbar: true });
  fixture.setService("sidebarRight", { openTab() { throw new Error("not ready"); } });
  fixture.renderSlot("sidebar.footer.action").props.onClick();
  assert.equal(fixture.timers.size, 1);
  fixture.setService("layout", {});
  fixture.setSlot("main", true);
  fixture.setSlot("sidebar.panellist", true);
  fixture.dispose();
  assert.equal(fixture.registrations.size, 0);
  assert.equal(fixture.watchers.size, 0);
  assert.equal(fixture.scopes.size, 0);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.tabTypes.size, 0);
  assert.equal(fixture.dictionaries.size, 0);
  fixture.tick(40);
  assert.deepEqual(fixture.warnings, []);
});

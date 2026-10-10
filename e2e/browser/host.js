import React from "react";
import { createRoot } from "react-dom/client";

const SESSION_ID = "e2e-session";

const icon = (name) => function HostIcon(props) {
  return React.createElement("svg", { ...props, "data-icon": name, width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": props?.["aria-hidden"] ?? true }, React.createElement("rect", { width: 10, height: 10, x: 3, y: 3, fill: "currentColor" }));
};
const icons = new Proxy({}, { get: (_target, name) => icon(String(name)) });
const requireModule = (name) => {
  if (name === "react") return React;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return icons;
  throw new Error(`e2e host has no module ${name}`);
};

const slotStore = { map: new Map(), listeners: new Set() };
const notifySlots = () => { for (const listener of slotStore.listeners) listener(); };
const slotSnapshot = (name) => slotStore.map.get(name) ?? [];
function useSlot(name) {
  return React.useSyncExternalStore((listener) => { slotStore.listeners.add(listener); return () => slotStore.listeners.delete(listener); }, () => slotSnapshot(name));
}

const uiStore = { open: false, listeners: new Set() };
const notifyUi = () => { for (const listener of uiStore.listeners) listener(); };
function useOpen() {
  return React.useSyncExternalStore((listener) => { uiStore.listeners.add(listener); return () => uiStore.listeners.delete(listener); }, () => uiStore.open);
}

function createContext() {
  const dictionaries = {};
  const ctx = {
    effect(effect) { const dispose = effect(); return typeof dispose === "function" ? dispose : undefined; },
    inject(names, callback) { if (names.every((name) => ctx[name])) callback(ctx); },
    get(name) { return ctx[name]; },
    locale: {
      bind: () => (key) => dictionaries[key] ?? key,
      register(_namespace, packs) { Object.assign(dictionaries, packs.zh ?? {}); },
    },
    slots: {
      inject(_name, register) { return register(); },
      register(definition, component) {
        const list = [...(slotStore.map.get(definition.name) ?? []), { definition, component }];
        slotStore.map.set(definition.name, list);
        notifySlots();
        return () => { slotStore.map.set(definition.name, (slotStore.map.get(definition.name) ?? []).filter((entry) => entry.component !== component)); notifySlots(); };
      },
    },
    sidebarRight: { openTab() { uiStore.open = true; notifyUi(); } },
    sidebarRightTabs: { register() { return () => {}; } },
  };
  return ctx;
}

function Slot({ name, props }) {
  const entries = useSlot(name);
  return entries.map((entry) => React.createElement(entry.component, { key: entry.definition.id ?? entry.definition.key ?? name, ...props }));
}

function Host() {
  const open = useOpen();
  return React.createElement("div", { className: "e2e-host" },
    React.createElement("main", { className: "e2e-conversation" },
      React.createElement("h1", null, "对话"),
      React.createElement("p", null, "仿宿主只提供侧栏插槽，主对话保持可见。"),
      React.createElement("div", { className: "e2e-footer" }, React.createElement(Slot, { name: "sidebar.footer.action", props: { wide: true } })),
    ),
    open ? React.createElement("aside", { className: "e2e-sidebar", "data-e2e": "sidebar" },
      React.createElement("div", { className: "e2e-sidebar-title" }, React.createElement(Slot, { name: "sidebar.right.pane.tab.title" })),
      React.createElement("div", { className: "e2e-sidebar-body" }, React.createElement(Slot, { name: "sidebar.right.pane.tab", props: { sessionId: SESSION_ID } })),
    ) : null,
    React.createElement(Slot, { name: "shell.overlay" }),
  );
}

const style = document.createElement("style");
style.textContent = "html,body,#root{height:100%;margin:0}body{font:14px/1.4 system-ui,sans-serif;background:#f4f6f8;color:#182230}.e2e-host{height:100%;display:flex}.e2e-conversation{flex:1;min-width:0;padding:16px}.e2e-footer{position:absolute;left:12px;bottom:12px}.e2e-sidebar{width:min(960px,72vw);min-width:360px;display:flex;flex-direction:column;border-left:1px solid #d8dce5;background:#fff}.e2e-sidebar-title{padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:650}.e2e-sidebar-body{flex:1;min-height:0}.e2e-sidebar-body>.dsh-remote-ops{height:100%}@media (max-width:700px){.e2e-host{flex-direction:column}.e2e-conversation{flex:none;padding:8px}.e2e-conversation p{display:none}.e2e-footer{position:static}.e2e-sidebar{width:auto;min-width:0;flex:1;border-left:0;border-top:1px solid #d8dce5}}";
document.head.appendChild(style);

window.__ModuleLoader__ = { load(definition) { window.__remoteOpsPlugin = definition.factory(requireModule); } };
await new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = "/client.js";
  script.onload = () => resolve();
  script.onerror = () => reject(new Error("failed to load client.js"));
  document.head.appendChild(script);
});
window.__remoteOpsPlugin.apply(createContext());
createRoot(document.getElementById("root")).render(React.createElement(Host));
document.documentElement.dataset.e2eReady = "true";

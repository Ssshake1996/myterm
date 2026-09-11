window.__ModuleLoader__.load({
  id: "@dsh/remote-ops",
  factory: (require) => {
    const React = require("react");
    const { createElement: h, useCallback, useEffect, useState } = React;
    const styleId = "dsh-remote-ops-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = ".dsh-remote-ops{height:100%;display:flex;flex-direction:column;background:var(--color-bg-primary,#fff);color:var(--color-text-primary,#182230);font:12px/1.45 system-ui,sans-serif}.dsh-remote-ops__head{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--color-border,#d8dce5)}.dsh-remote-ops__title{font-weight:700;flex:1}.dsh-remote-ops__tabs{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid var(--color-border,#d8dce5);overflow:auto}.dsh-remote-ops button{border:1px solid var(--color-border,#d8dce5);background:var(--color-bg-secondary,#f6f8fa);color:inherit;border-radius:6px;padding:5px 8px;cursor:pointer}.dsh-remote-ops__tabs button[data-active=true]{border-color:#4d6bfe;background:#eef2ff}.dsh-remote-ops__body{padding:10px;overflow:auto;flex:1}.dsh-remote-ops__card{border:1px solid var(--color-border,#d8dce5);border-radius:8px;padding:8px;margin:6px 0;background:var(--color-bg-secondary,#f8fafb)}.dsh-remote-ops__row{display:flex;align-items:center;gap:6px}.dsh-remote-ops__row span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-remote-ops__muted{color:var(--color-text-tertiary,#98a2b3)}.dsh-remote-ops__error{color:#d92d20;white-space:pre-wrap}.dsh-remote-ops__terminal{font:11px/1.35 ui-monospace,Consolas,monospace;white-space:pre-wrap;max-height:240px;overflow:auto;background:#0b1220;color:#d7e3f4;border-radius:6px;padding:8px}.dsh-remote-ops input{width:100%;box-sizing:border-box;border:1px solid var(--color-border,#d8dce5);border-radius:6px;padding:6px;margin:4px 0;background:var(--color-bg-primary,#fff);color:inherit}";
      document.head.appendChild(style);
    }
    async function request(path, init) {
      const response = await fetch(path, init);
      const text = await response.text();
      let value = {};
      try { value = text ? JSON.parse(text) : {}; } catch { throw new Error(`HTTP ${response.status}: ${text}`); }
      if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
      return value;
    }
    function RemoteOpsPanel({ sessionId }) {
      const [snapshot, setSnapshot] = useState({ environments: [], sessions: [], quickCommands: [], events: [] });
      const [tab, setTab] = useState("environments");
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [path, setPath] = useState(".");
      const [entries, setEntries] = useState([]);
      const refresh = useCallback(async () => {
        if (!sessionId) return;
        try { setSnapshot(await request(`/api/dsh-remote-ops/state?sessionId=${encodeURIComponent(sessionId)}`)); setError(""); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      }, [sessionId]);
      useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 1500); return () => clearInterval(timer); }, [refresh]);
      const action = useCallback(async (body) => {
        setBusy(true);
        try { const value = await request("/api/dsh-remote-ops/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessionId }) }); setError(""); await refresh(); return value; }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return undefined; }
        finally { setBusy(false); }
      }, [refresh, sessionId]);
      if (!sessionId) return h("aside", { className: "dsh-remote-ops" }, h("div", { className: "dsh-remote-ops__body dsh-remote-ops__muted" }, "请先打开或选择一个 DSH 对话。"));
      const renderEnvironments = () => h("section", null, h("h3", null, "已保存环境"), snapshot.environments.length ? snapshot.environments.map((env) => h("div", { className: "dsh-remote-ops__card", key: env.id }, h("div", { className: "dsh-remote-ops__row" }, h("span", null, `${env.group} / ${env.name}`), h("button", { disabled: busy, onClick: () => void action({ action: "open", environment: env.id }) }, env.active ? "复用" : "连接")), h("div", { className: "dsh-remote-ops__muted" }, `${env.username}@${env.host}:${env.port ?? 22}`))) : h("div", { className: "dsh-remote-ops__muted" }, "没有环境；可通过 Agent 工具创建。"));
      const renderSessions = () => h("section", null, h("h3", null, "活动终端"), snapshot.sessions.length ? snapshot.sessions.map((item) => h("div", { className: "dsh-remote-ops__card", key: item.sessionId }, h("div", { className: "dsh-remote-ops__row" }, h("span", null, `${item.name} · ${item.status?.kind ?? "unknown"}`), h("button", { disabled: busy, onClick: () => void action({ action: "send", session: item.sessionId, text: "", submit: false }) }, "读取")))) : h("div", { className: "dsh-remote-ops__muted" }, "当前没有活动终端。"));
      const renderQuick = () => h("section", null, h("h3", null, "快捷命令"), snapshot.quickCommands.length ? snapshot.quickCommands.map((item) => h("div", { className: "dsh-remote-ops__card", key: item.id }, h("div", { className: "dsh-remote-ops__row" }, h("span", null, item.name), h("button", { disabled: busy || !snapshot.environments.length, onClick: () => void action({ action: "send", environment: snapshot.environments[0]?.id, text: item.command, submit: true }) }, "执行")))) : h("div", { className: "dsh-remote-ops__muted" }, "没有快捷命令。"));
      const renderSftp = () => h("section", null, h("h3", null, "SFTP 目录"), h("input", { value: path, onChange: (event) => setPath(event.target.value), placeholder: "远程路径，例如 /etc" }), snapshot.environments.map((env) => h("div", { className: "dsh-remote-ops__card", key: env.id }, h("div", { className: "dsh-remote-ops__row" }, h("span", null, env.name), h("button", { disabled: busy, onClick: async () => { const value = await action({ action: "sftp", operation: "list", environment: env.id, path }); if (value?.entries) setEntries(value.entries); } }, "读取")))), h("div", null, entries.map((entry) => h("div", { className: "dsh-remote-ops__row", key: entry.name }, h("span", null, `${entry.type === "d" ? "目录" : "文件"} ${entry.name}`), h("span", { className: "dsh-remote-ops__muted" }, String(entry.size ?? ""))))));
      const renderDiagnostics = () => h("section", null, h("h3", null, "最近事件"), h("div", { className: "dsh-remote-ops__terminal" }, (snapshot.events ?? []).map((item) => JSON.stringify(item)).join("\n") || "暂无事件"));
      const body = tab === "environments" ? renderEnvironments() : tab === "sessions" ? renderSessions() : tab === "quick" ? renderQuick() : tab === "sftp" ? renderSftp() : renderDiagnostics();
      const tabs = [["environments", "环境"], ["sessions", "终端"], ["quick", "快捷命令"], ["sftp", "SFTP"], ["diagnostics", "诊断"]];
      return h("aside", { className: "dsh-remote-ops" }, h("div", { className: "dsh-remote-ops__head" }, h("span", { className: "dsh-remote-ops__title" }, "Remote Ops"), h("span", { className: "dsh-remote-ops__muted" }, `${snapshot.sessions.length} 个会话`), h("button", { disabled: busy, onClick: () => void refresh }, "刷新")), h("div", { className: "dsh-remote-ops__tabs" }, tabs.map(([id, title]) => h("button", { key: id, "data-active": tab === id, onClick: () => setTab(id) }, title))), h("div", { className: "dsh-remote-ops__body" }, error ? h("div", { className: "dsh-remote-ops__error" }, error) : null, body));
    }
    const inject = ["slots", "uiSession"];
    function apply(ctx) { ctx.slots.inject("rightbar.session", () => ctx.slots.register({ name: "rightbar.session", id: "dsh-remote-ops", inject: (sessionId) => ({ sessionId }) }, RemoteOpsPanel)); }
    return { inject, apply };
  },
});

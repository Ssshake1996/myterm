window.__ModuleLoader__.load({
  id: "@dsh/remote-ops",
  factory: (require) => {
    const React = require("react");
    const { createElement: h, useCallback, useEffect, useState } = React;
    const NS = "dshRemoteOps";
    const TAB_ID = "@dsh/remote-ops";
    const TAB_KIND = "dsh-remote-ops";
    const MAIN_PANEL_ID = "dsh-remote-ops";
    const styleId = "dsh-remote-ops-style";

    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .dsh-remote-ops{height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#182230);font:13px/1.45 system-ui,sans-serif}
        .dsh-remote-ops__head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:.5px solid var(--dsw-alias-border-l2,#d8dce5);flex:none}
        .dsh-remote-ops__title{font-weight:600;flex:1;min-width:0}
        .dsh-remote-ops__meta{color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:12px}
        .dsh-remote-ops__tabs{display:flex;gap:4px;padding:8px 10px;border-bottom:.5px solid var(--dsw-alias-border-l2,#d8dce5);overflow:auto;flex:none}
        .dsh-remote-ops button{border:.5px solid var(--dsw-alias-border-l3,#d8dce5);background:var(--dsw-alias-bg-layer-1,#f6f8fa);color:inherit;border-radius:7px;padding:5px 9px;cursor:pointer;font:inherit}
        .dsh-remote-ops button:hover{background:var(--dsw-alias-interactive-bg-hover,#edf1f5)}
        .dsh-remote-ops button:disabled{opacity:.5;cursor:default}
        .dsh-remote-ops__tabs button[data-active=true]{border-color:var(--dsw-alias-interactive-brand,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-interactive-brand,#4d6bfe) 12%,transparent)}
        .dsh-remote-ops__body{padding:12px;overflow:auto;flex:1;min-height:0}
        .dsh-remote-ops__card{border:.5px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:10px;padding:10px;margin:7px 0;background:var(--dsw-alias-bg-layer-1,#f8fafb)}
        .dsh-remote-ops__row{display:flex;align-items:center;gap:8px;min-width:0}
        .dsh-remote-ops__row>span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .dsh-remote-ops__muted{color:var(--dsw-alias-label-tertiary,#98a2b3)}
        .dsh-remote-ops__error{color:var(--dsw-alias-state-error-primary,#d92d20);white-space:pre-wrap;margin-bottom:8px}
        .dsh-remote-ops__terminal{font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow:auto;background:#0b1220;color:#d7e3f4;border-radius:8px;padding:10px;min-height:110px;max-height:300px}
        .dsh-remote-ops input{width:100%;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3,#d8dce5);border-radius:7px;padding:7px;margin:4px 0;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit}
        .dsh-remote-ops h3{font-size:13px;margin:2px 0 10px}
        .dsh-remote-ops__launch{border:.5px solid var(--dsw-alias-border-l2,#d8dce5);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-1,#f8fafb)}
        .dsh-remote-ops__launch p{margin:6px 0 10px;color:var(--dsw-alias-label-secondary,#667085)}
        .dsh-remote-ops__launchButton{background:var(--dsw-alias-button-primary-fill,#4d6bfe)!important;color:var(--dsw-alias-label-primary-inverted,#fff)!important;border-color:transparent!important}
        .dsh-remote-ops__panelIcon{display:inline-flex;align-items:center;justify-content:center;font:600 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:-.04em}
        .dsh-remote-ops__panelIcon[data-active=true]{color:var(--dsw-alias-brand-primary,#4d6bfe)}
      `;
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

    function RemoteOpsPanel({ sessionId, onStartSession }) {
      const [snapshot, setSnapshot] = useState({ environments: [], sessions: [], quickCommands: [], events: [] });
      const [tab, setTab] = useState("environments");
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [path, setPath] = useState(".");
      const [entries, setEntries] = useState([]);

      const refresh = useCallback(async () => {
        try {
          const endpoint = sessionId ? `/api/dsh-remote-ops/state?sessionId=${encodeURIComponent(sessionId)}` : "/api/dsh-remote-ops/catalog";
          setSnapshot(await request(endpoint));
          setError("");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }, [sessionId]);

      useEffect(() => {
        void refresh();
        const timer = setInterval(() => void refresh(), 1500);
        return () => clearInterval(timer);
      }, [refresh]);

      const action = useCallback(async (body) => {
        if (!sessionId) {
          setError("请先新建或选择一个 DSH 对话，再执行 SSH 或 SFTP 操作。");
          return undefined;
        }
        setBusy(true);
        try {
          const value = await request("/api/dsh-remote-ops/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, sessionId }),
          });
          setError("");
          await refresh();
          return value;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
          return undefined;
        } finally {
          setBusy(false);
        }
      }, [refresh, sessionId]);

      const renderEnvironments = () => h("section", null,
        h("h3", null, "已保存环境"),
        snapshot.environments.length ? snapshot.environments.map((env) => h("div", { className: "dsh-remote-ops__card", key: env.id },
          h("div", { className: "dsh-remote-ops__row" },
            h("span", null, `${env.group} / ${env.name}`),
            h("button", { disabled: busy || !sessionId, onClick: () => void action({ action: "open", environment: env.id }) }, sessionId ? (env.active ? "复用" : "连接") : "需绑定对话")
          ),
          h("div", { className: "dsh-remote-ops__muted" }, `${env.username}@${env.host}:${env.port ?? 22}`)
        )) : h("div", { className: "dsh-remote-ops__muted" }, "没有环境；可通过 Agent 工具创建。")
      );

      const renderSessions = () => h("section", null,
        h("h3", null, "活动终端"),
        snapshot.sessions.length ? snapshot.sessions.map((item) => h("div", { className: "dsh-remote-ops__card", key: item.sessionId },
          h("div", { className: "dsh-remote-ops__row" },
            h("span", null, `${item.name} · ${item.status?.kind ?? "unknown"}`),
            h("button", { disabled: busy, onClick: () => void action({ action: "send", session: item.sessionId, text: "", submit: false }) }, "刷新")
          )
        )) : h("div", { className: "dsh-remote-ops__muted" }, "当前没有活动终端。")
      );

      const renderQuick = () => h("section", null,
        h("h3", null, "快捷命令"),
        snapshot.quickCommands.length ? snapshot.quickCommands.map((item) => h("div", { className: "dsh-remote-ops__card", key: item.id },
          h("div", { className: "dsh-remote-ops__row" },
            h("span", null, item.name),
            h("button", { disabled: busy || !sessionId || !snapshot.environments.length, onClick: () => void action({ action: "send", environment: snapshot.environments[0]?.id, text: item.command, submit: true }) }, sessionId ? "执行" : "需绑定对话")
          )
        )) : h("div", { className: "dsh-remote-ops__muted" }, "没有快捷命令。")
      );

      const renderSftp = () => h("section", null,
        h("h3", null, "SFTP 目录"),
        h("input", { value: path, onChange: (event) => setPath(event.target.value), placeholder: "远程路径，例如 /etc" }),
        snapshot.environments.map((env) => h("div", { className: "dsh-remote-ops__card", key: env.id },
          h("div", { className: "dsh-remote-ops__row" },
            h("span", null, env.name),
            h("button", { disabled: busy || !sessionId, onClick: async () => { const value = await action({ action: "sftp", operation: "list", environment: env.id, path }); if (value?.entries) setEntries(value.entries); } }, sessionId ? "读取" : "需绑定对话")
          )
        )),
        h("div", null, entries.map((entry) => h(
          "div",
          { className: "dsh-remote-ops__row", key: entry.name },
          h("span", null, `${entry.type === "d" ? "目录" : "文件"} ${entry.name}`),
          h("span", { className: "dsh-remote-ops__muted" }, String(entry.size ?? "")),
        )))
      );

      const renderDiagnostics = () => h("section", null,
        h("h3", null, "最近事件"),
        h("pre", { className: "dsh-remote-ops__terminal" }, (snapshot.events ?? []).map((item) => JSON.stringify(item)).join("\n") || "暂无事件")
      );

      const body = tab === "environments" ? renderEnvironments() : tab === "sessions" ? renderSessions() : tab === "quick" ? renderQuick() : tab === "sftp" ? renderSftp() : renderDiagnostics();
      const tabs = [["environments", "环境"], ["sessions", "终端"], ["quick", "快捷命令"], ["sftp", "SFTP"], ["diagnostics", "诊断"]];
      return h("div", { className: "dsh-remote-ops" },
        h("div", { className: "dsh-remote-ops__head" },
          h("span", { className: "dsh-remote-ops__title" }, "Remote Ops"),
          h("span", { className: "dsh-remote-ops__meta" }, sessionId ? `${snapshot.sessions.length} 个会话` : "未绑定 DSH 对话"),
          h("button", { disabled: busy, onClick: () => void refresh }, "刷新")
        ),
        h("div", { className: "dsh-remote-ops__tabs" }, tabs.map(([id, title]) => h("button", { key: id, "data-active": tab === id, onClick: () => setTab(id) }, title))),
        h("div", { className: "dsh-remote-ops__body" },
          !sessionId ? h("div", { className: "dsh-remote-ops__launch" },
            h("h3", null, "Remote Ops 已启动"),
            h("p", null, "环境和快捷命令已加载。连接 SSH、终端和 SFTP 操作需要绑定一个 DSH 对话。"),
            onStartSession ? h("button", { className: "dsh-remote-ops__launchButton", onClick: onStartSession }, "新建 DSH 对话并继续") : null,
          ) : null,
          error ? h("div", { className: "dsh-remote-ops__error" }, error) : null,
          body,
        )
      );
    }

    function RemoteOpsTitle() { return h("span", null, "Remote Ops"); }
    function RemoteOpsIcon({ active, size }) {
      return h("span", { className: "dsh-remote-ops__panelIcon", "data-active": active, style: { width: size, height: size }, "aria-hidden": true }, "SSH");
    }

    const inject = ["slots", "locale", "sidebarRightTabs", "layout", "uiWorkspace"];
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh: { title: "Remote Ops", guideTitle: "远程运维", guideDescription: "管理 SSH 环境、终端和 SFTP" }, en: { title: "Remote Ops", guideTitle: "Remote operations", guideDescription: "Manage SSH environments, terminals and SFTP" } }), "dsh-remote-ops: dictionaries");
      ctx.effect(() => ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: MAIN_PANEL_ID }, () => h(RemoteOpsPanel, { onStartSession: () => ctx.uiWorkspace.startSession() })), "dsh-remote-ops: main panel"));
      ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: MAIN_PANEL_ID, order: 40, label: () => t("title") }, RemoteOpsIcon)), "dsh-remote-ops: launch button");
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        priority: "extension",
        title: () => t("title"),
        guide: [{ order: 30, title: () => t("guideTitle"), description: () => t("guideDescription") }],
      }), "dsh-remote-ops: tab type");
      ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID }, RemoteOpsPanel)), "dsh-remote-ops: tab body");
      ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({ name: "sidebar.right.pane.tab.title", key: TAB_ID }, RemoteOpsTitle)), "dsh-remote-ops: tab title");
    }

    return { inject, apply };
  },
});

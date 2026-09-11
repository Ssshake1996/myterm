window.__ModuleLoader__.load({
  id: "@myterm/dsh-bridge",
  factory: (require) => {
    const React = require("react");
    const { createElement: h, useCallback, useEffect, useMemo, useState } = React;

    const styleId = "myterm-dsh-binding-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .myterm-bindings{margin:0 2px 8px;padding:8px 10px;border:1px solid color-mix(in srgb,var(--color-border,#d8dce5) 82%,transparent);border-radius:10px;background:color-mix(in srgb,var(--color-bg-secondary,#f7f8fa) 86%,transparent);font:12px/1.4 system-ui,sans-serif}
        .myterm-bindings__row{display:flex;align-items:center;gap:7px;min-width:0}
        .myterm-bindings__label{flex:0 0 auto;color:var(--color-text-secondary,#667085);font-weight:600}
        .myterm-bindings__chips{display:flex;align-items:center;gap:5px;min-width:0;flex:1;overflow-x:auto;scrollbar-width:thin}
        .myterm-bindings__chip{display:inline-flex;align-items:center;gap:4px;min-width:0;padding:3px 7px;border:1px solid var(--color-border,#d8dce5);border-radius:999px;background:var(--color-bg-primary,#fff);color:var(--color-text-primary,#182230);white-space:nowrap}
        .myterm-bindings__chip[data-primary=true]{border-color:#4d6bfe;background:color-mix(in srgb,#4d6bfe 9%,var(--color-bg-primary,#fff))}
        .myterm-bindings button,.myterm-bindings select{height:27px;border:1px solid var(--color-border,#d8dce5);border-radius:7px;background:var(--color-bg-primary,#fff);color:var(--color-text-primary,#182230);font:inherit}
        .myterm-bindings button{padding:0 7px;cursor:pointer}
        .myterm-bindings button:hover{border-color:#4d6bfe}
        .myterm-bindings button:disabled{opacity:.5;cursor:default}
        .myterm-bindings select{min-width:118px;max-width:180px;padding:0 6px}
        .myterm-bindings__error{margin-top:6px;color:#d92d20;white-space:pre-wrap}
        .myterm-bindings__empty{color:var(--color-text-tertiary,#98a2b3)}
      `;
      document.head.appendChild(style);
    }

    async function jsonFetch(url, init) {
      const response = await fetch(url, init);
      const text = await response.text();
      let value;
      try {
        value = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
      return value;
    }

    function BindingDock({ sessionId }) {
      const [snapshot, setSnapshot] = useState({
        environments: [],
        bindings: [],
        primaryProfileId: null,
      });
      const [selected, setSelected] = useState("");
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");

      const reload = useCallback(async () => {
        try {
          const value = await jsonFetch(
            `/api/myterm.environments?sessionId=${encodeURIComponent(sessionId)}`,
          );
          setSnapshot(value);
          setSelected(
            (current) =>
              current || value.environments.find((item) => !item.bound)?.profileId || "",
          );
          setError("");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }, [sessionId]);

      useEffect(() => {
        void reload();
      }, [reload]);

      const bound = useMemo(
        () => snapshot.environments.filter((item) => item.bound),
        [snapshot],
      );
      const available = useMemo(
        () => snapshot.environments.filter((item) => !item.bound),
        [snapshot],
      );

      const mutate = useCallback(
        async (action, profileId) => {
          setBusy(true);
          try {
            await jsonFetch("/api/myterm.bindings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId, action, profileId }),
            });
            setSelected("");
            await reload();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setBusy(false);
          }
        },
        [reload, sessionId],
      );

      return h(
        "section",
        { className: "myterm-bindings" },
        h(
          "div",
          { className: "myterm-bindings__row" },
          h("span", { className: "myterm-bindings__label" }, "SSH 环境"),
          h(
            "div",
            { className: "myterm-bindings__chips" },
            bound.length === 0
              ? h(
                  "span",
                  { className: "myterm-bindings__empty" },
                  "未绑定；Agent 无法调用任何 SSH 工具",
                )
              : bound.map((item) =>
                  h(
                    "span",
                    {
                      className: "myterm-bindings__chip",
                      "data-primary": item.profileId === snapshot.primaryProfileId,
                      key: item.profileId,
                    },
                    h(
                      "span",
                      null,
                      `${item.name}${item.state === "connected" ? " · 在线" : ""}`,
                    ),
                    item.profileId !== snapshot.primaryProfileId && bound.length > 1
                      ? h(
                          "button",
                          {
                            disabled: busy,
                            onClick: () => void mutate("primary", item.profileId),
                            title: "设为主环境",
                          },
                          "主",
                        )
                      : null,
                    h(
                      "button",
                      {
                        disabled: busy,
                        onClick: () => void mutate("unbind", item.profileId),
                        title: "解除绑定；正在执行的该环境调用会被取消",
                      },
                      "×",
                    ),
                  ),
                ),
          ),
          available.length > 0
            ? h(
                React.Fragment,
                null,
                h(
                  "select",
                  {
                    disabled: busy,
                    value: selected,
                    onChange: (event) => setSelected(event.target.value),
                    "aria-label": "选择要绑定的 SSH 环境",
                  },
                  h("option", { value: "" }, "选择环境"),
                  available.map((item) =>
                    h(
                      "option",
                      { key: item.profileId, value: item.profileId },
                      `${item.group} / ${item.name}`,
                    ),
                  ),
                ),
                h(
                  "button",
                  {
                    disabled: busy || !selected,
                    onClick: () => void mutate("bind", selected),
                  },
                  "绑定",
                ),
              )
            : null,
          h(
            "button",
            { disabled: busy, onClick: () => void reload(), title: "刷新连接状态" },
            "↻",
          ),
        ),
        error ? h("div", { className: "myterm-bindings__error" }, error) : null,
      );
    }

    const inject = ["slots", "uiConversation"];
    function apply(ctx) {
      ctx.slots.inject("conversation.input.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.input.dock",
            id: "myterm-environment-bindings",
            order: -20,
            inject: (sessionId) => ({ sessionId }),
          },
          BindingDock,
        ),
      );
    }

    return { inject, apply };
  },
});

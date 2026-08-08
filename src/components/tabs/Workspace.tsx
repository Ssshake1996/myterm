import { Fragment, lazy, Suspense, useEffect } from "react";
import type { SessionProfile } from "../../ipc";
import { useLayoutStore } from "../../store/layout";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";

const SftpView = lazy(() =>
  import("../sftp/SftpView").then((module) => ({ default: module.SftpView })),
);
const TerminalView = lazy(() =>
  import("../terminal/TerminalView").then((module) => ({ default: module.TerminalView })),
);

interface WorkspaceProps {
  profiles: SessionProfile[];
}

function WorkspaceTab({
  tabId,
  profiles,
  visible,
}: {
  tabId: string;
  profiles: SessionProfile[];
  visible: boolean;
}) {
  const tab = useLayoutStore((state) => state.tabs.find((candidate) => candidate.id === tabId));
  const selectPane = useLayoutStore((state) => state.selectPane);
  const splitActive = useLayoutStore((state) => state.splitActive);
  const setSplitRatio = useLayoutStore((state) => state.setSplitRatio);
  const view = useUiStore((state) => state.workspaceView);
  const setView = useUiStore((state) => state.setWorkspaceView);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!visible || !event.ctrlKey || !event.shiftKey || event.code !== "KeyD") return;
      event.preventDefault();
      splitActive();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [splitActive, visible]);

  if (!tab) return null;
  const activePane = tab.panes.find((pane) => pane.id === tab.activePaneId) ?? tab.panes[0];
  const activeProfile = profiles.find((profile) => profile.id === activePane?.profileId);
  const detail =
    activeProfile?.target.kind === "ssh"
      ? `${activeProfile.target.username}@${activeProfile.target.host}:${activeProfile.target.port}`
      : activeProfile?.target.kind === "local"
        ? activeProfile.target.shell
        : "";

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const root = event.currentTarget.parentElement;
    if (!root) return;
    const move = (moveEvent: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      const ratio = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setSplitRatio(tab.id, Math.min(72, Math.max(28, ratio)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <section className={`workspace-tab ${visible ? "is-visible" : ""}`}>
      <header className="workspace-toolbar">
        <div className="connection-identity">
          <span className={`state-dot state-${activePane?.state ?? "disconnected"}`} />
          <span>{detail}</span>
          <span className="identity-divider" />
          <small>{activePane?.state === "connected" ? "xterm-256color" : activePane?.state}</small>
        </div>
        <div className="workspace-actions">
          <button
            aria-label="向右分屏"
            className="icon-button toolbar-button"
            disabled={tab.panes.length >= 2}
            onClick={splitActive}
            title="向右分屏"
            type="button"
          >
            <Icon name="split" />
          </button>
          <fieldset className="segmented compact" aria-label="工作区视图">
            <button
              className={view === "terminal" ? "is-active" : ""}
              onClick={() => setView("terminal")}
              type="button"
            >
              终端
            </button>
            <button
              className={view === "files" ? "is-active" : ""}
              disabled={activeProfile?.target.kind !== "ssh"}
              onClick={() => setView("files")}
              type="button"
            >
              文件
            </button>
          </fieldset>
        </div>
      </header>
      {view === "files" && activePane?.sessionId && activeProfile?.target.kind === "ssh" ? (
        <Suspense fallback={<div className="workspace-loading">正在加载文件视图</div>}>
          <SftpView sessionId={activePane.sessionId} />
        </Suspense>
      ) : (
        <div
          className={`terminal-split panes-${tab.panes.length}`}
          style={
            tab.panes.length === 2
              ? { gridTemplateColumns: `${tab.splitRatio}% 6px 1fr` }
              : undefined
          }
        >
          {tab.panes.map((pane, index) => {
            const profile = profiles.find((candidate) => candidate.id === pane.profileId);
            if (!profile) return null;
            return (
              <Fragment key={pane.id}>
                {index === 1 ? (
                  <hr
                    aria-label="调整分屏宽度"
                    aria-orientation="vertical"
                    aria-valuemax={72}
                    aria-valuemin={28}
                    aria-valuenow={tab.splitRatio}
                    className="split-handle"
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft")
                        setSplitRatio(tab.id, Math.max(28, tab.splitRatio - 2));
                      if (event.key === "ArrowRight")
                        setSplitRatio(tab.id, Math.min(72, tab.splitRatio + 2));
                    }}
                    onPointerDown={beginResize}
                    tabIndex={0}
                  />
                ) : null}
                <div
                  className={`terminal-pane ${pane.id === tab.activePaneId ? "is-active" : ""}`}
                  onFocusCapture={() => selectPane(tab.id, pane.id)}
                >
                  {tab.panes.length > 1 ? (
                    <div className="pane-caption">
                      <span className={`state-dot state-${pane.state}`} />
                      {pane.title}
                    </div>
                  ) : null}
                  <Suspense fallback={<div className="workspace-loading">正在加载终端</div>}>
                    <TerminalView pane={pane} profile={profile} />
                  </Suspense>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function Workspace({ profiles }: WorkspaceProps) {
  const tabs = useLayoutStore((state) => state.tabs);
  const activeTabId = useLayoutStore((state) => state.activeTabId);

  if (!tabs.length) {
    return (
      <div className="workspace-empty">
        <div className="empty-prompt">›_</div>
        <h1>没有活动会话</h1>
        <p>从左侧选择一个 SSH 配置或本地 Shell。</p>
      </div>
    );
  }

  return (
    <div className="workspace-stack">
      {tabs.map((tab) => (
        <WorkspaceTab
          key={tab.id}
          profiles={profiles}
          tabId={tab.id}
          visible={tab.id === activeTabId}
        />
      ))}
    </div>
  );
}

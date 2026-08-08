import { sessionDisconnect } from "../../ipc";
import { useLayoutStore } from "../../store/layout";
import { Icon } from "../shell/Icon";

interface TabBarProps {
  onNewSession: () => void;
}

export function TabBar({ onNewSession }: TabBarProps) {
  const tabs = useLayoutStore((state) => state.tabs);
  const activeTabId = useLayoutStore((state) => state.activeTabId);
  const selectTab = useLayoutStore((state) => state.selectTab);
  const closeTab = useLayoutStore((state) => state.closeTab);
  const reorderTab = useLayoutStore((state) => state.reorderTab);

  const close = async (tabId: string) => {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    await Promise.all(
      tab?.panes.flatMap((pane) =>
        pane.sessionId ? [sessionDisconnect(pane.sessionId).catch(() => undefined)] : [],
      ) ?? [],
    );
    closeTab(tabId);
  };

  return (
    <div className="tabstrip">
      <div className="tablist" role="tablist">
        {tabs.map((tab) => {
          const activePane = tab.panes.find((pane) => pane.id === tab.activePaneId);
          const status = activePane?.state ?? "disconnected";
          return (
            <div
              aria-selected={tab.id === activeTabId}
              className={`session-tab ${tab.id === activeTabId ? "is-active" : ""}`}
              draggable
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={(event) => event.dataTransfer.setData("text/myterm-tab", tab.id)}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = event.dataTransfer.getData("text/myterm-tab");
                if (sourceId) reorderTab(sourceId, tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectTab(tab.id);
                }
              }}
              role="tab"
              tabIndex={tab.id === activeTabId ? 0 : -1}
            >
              <span className={`state-dot state-${status}`} />
              <span className="tab-title">{tab.title}</span>
              {tab.panes.length > 1 ? (
                <span className="tab-pane-count">{tab.panes.length}</span>
              ) : null}
              <button
                aria-label={`关闭 ${tab.title}`}
                className="tab-close"
                onClick={(event) => {
                  event.stopPropagation();
                  void close(tab.id);
                }}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
          );
        })}
      </div>
      <button aria-label="新建会话" className="tab-add" onClick={onNewSession} type="button">
        <Icon name="plus" />
      </button>
    </div>
  );
}

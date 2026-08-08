import { useEffect, useRef, useState } from "react";
import { AiPanel } from "./components/ai/AiPanel";
import { QuickBar } from "./components/quickbar/QuickBar";
import { SessionSidebar } from "./components/sessions/SessionSidebar";
import { Icon } from "./components/shell/Icon";
import { Modal } from "./components/shell/Modal";
import { ToastRegion } from "./components/shell/ToastRegion";
import { TabBar } from "./components/tabs/TabBar";
import { Workspace } from "./components/tabs/Workspace";
import {
  type AppInfo,
  getAppInfo,
  isDesktopRuntime,
  onSessionState,
  profileList,
  type SessionProfile,
} from "./ipc";
import { getActivePane, useLayoutStore } from "./store/layout";
import { useUiStore } from "./store/ui";

export function App() {
  const [profiles, setProfiles] = useState<SessionProfile[]>([]);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 900);
  const [aiCollapsed, setAiCollapsed] = useState(() => window.innerWidth <= 900);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo>({
    version: "0.1.1",
    commitHash: "unknown",
    startupProfile: null,
    portable: false,
  });
  const initialized = useRef(false);
  const openProfile = useLayoutStore((state) => state.openProfile);
  const updateSession = useLayoutStore((state) => state.updateSession);
  const activePane = useLayoutStore(getActivePane);
  const notify = useUiStore((state) => state.notify);
  const setWorkspaceView = useUiStore((state) => state.setWorkspaceView);

  useEffect(() => {
    void Promise.all([profileList(), getAppInfo()])
      .then(([items, info]) => {
        setProfiles(items);
        setAppInfo(info);
        const startup = info.startupProfile
          ? items.find((profile) => profile.name === info.startupProfile)
          : !isDesktopRuntime
            ? items[0]
            : undefined;
        if (startup && !initialized.current) {
          initialized.current = true;
          openProfile(startup);
        } else if (info.startupProfile && !startup) {
          notify(`未找到启动配置：${info.startupProfile}`, "error");
        }
      })
      .catch((error) =>
        notify(error instanceof Error ? error.message : "会话配置读取失败", "error"),
      );
  }, [notify, openProfile]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void onSessionState((session) => {
      updateSession(session.session_id, session.state, session.error);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, [updateSession]);

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 900px)");
    const collapseOverlays = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      setSidebarOpen(false);
      setAiCollapsed(true);
    };
    narrow.addEventListener("change", collapseOverlays);
    return () => narrow.removeEventListener("change", collapseOverlays);
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <img alt="" className="brand-mark" src="/favicon.png" />
          <div>
            <strong>myterm</strong>
            <small>OPERATIONS CONSOLE</small>
          </div>
        </div>
        <TabBar onNewSession={() => setProfileEditorOpen(true)} />
        <div className="topbar-meta">
          {!isDesktopRuntime ? <span className="demo-badge">DEMO</span> : null}
          <span className="secure-indicator">
            <span /> VAULT
          </span>
        </div>
      </header>

      <div className="app-body">
        <nav className="activitybar" aria-label="主导航">
          <button
            aria-label="会话"
            className={sidebarOpen ? "is-active" : ""}
            onClick={() =>
              setSidebarOpen((value) => {
                const next = !value;
                if (next && window.innerWidth <= 900) setAiCollapsed(true);
                return next;
              })
            }
            title="会话"
            type="button"
          >
            <Icon name="terminal" />
          </button>
          <button
            aria-label="文件传输"
            disabled={
              !activePane?.sessionId ||
              profiles.find((profile) => profile.id === activePane.profileId)?.target.kind !== "ssh"
            }
            onClick={() => setWorkspaceView("files")}
            title="文件传输"
            type="button"
          >
            <Icon name="files" />
          </button>
          <button
            aria-label="AI 助手"
            className={!aiCollapsed ? "is-active" : ""}
            onClick={() =>
              setAiCollapsed((value) => {
                const next = !value;
                if (!next && window.innerWidth <= 900) setSidebarOpen(false);
                return next;
              })
            }
            title="AI 助手"
            type="button"
          >
            <Icon name="spark" />
          </button>
          <div className="activity-spacer" />
          <button
            aria-label="关于 myterm"
            onClick={() => setAboutOpen(true)}
            title="关于 myterm"
            type="button"
          >
            <Icon name="settings" />
          </button>
        </nav>
        {sidebarOpen ? (
          <SessionSidebar
            editorOpen={profileEditorOpen}
            onConnect={(profile) => {
              openProfile(profile);
              if (window.innerWidth < 760) setSidebarOpen(false);
            }}
            onEditorOpenChange={setProfileEditorOpen}
            onProfilesChange={setProfiles}
            profiles={profiles}
          />
        ) : profileEditorOpen ? (
          <SessionSidebar
            editorOpen={profileEditorOpen}
            onConnect={openProfile}
            onEditorOpenChange={setProfileEditorOpen}
            onProfilesChange={setProfiles}
            profiles={profiles}
          />
        ) : null}
        <main className="main-stage">
          <Workspace profiles={profiles} />
          <QuickBar />
        </main>
        <AiPanel collapsed={aiCollapsed} onCollapsedChange={setAiCollapsed} />
      </div>

      <footer className="statusbar">
        <span className={`status-connection status-${activePane?.state ?? "disconnected"}`}>
          <span className="state-dot" />
          {activePane?.state === "connected"
            ? "已连接"
            : activePane?.state === "connecting"
              ? "连接中"
              : "未连接"}
        </span>
        <span>UTF-8</span>
        <span>{activePane?.sessionId ? "SFTP READY" : "SFTP IDLE"}</span>
        <span className="status-spacer" />
        <span className="status-ai">
          <Icon name="spark" /> AI {aiCollapsed ? "STANDBY" : "READY"}
        </span>
        <span title={`core ${appInfo.commitHash}`}>v{appInfo.version}</span>
      </footer>
      {aboutOpen ? (
        <Modal onClose={() => setAboutOpen(false)} size="small" title="关于 myterm">
          <dl className="about-details">
            <div>
              <dt>版本</dt>
              <dd>{appInfo.version}</dd>
            </div>
            <div>
              <dt>内核提交</dt>
              <dd>{appInfo.commitHash}</dd>
            </div>
            <div>
              <dt>运行模式</dt>
              <dd>{appInfo.portable ? "便携" : "安装"}</dd>
            </div>
          </dl>
        </Modal>
      ) : null}
      <ToastRegion />
    </div>
  );
}

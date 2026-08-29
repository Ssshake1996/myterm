import { CircleHelp, Leaf, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AiPanel } from "./components/ai/AiPanel";
import { HelpManual } from "./components/help/HelpManual";
import { QuickBar } from "./components/quickbar/QuickBar";
import { SessionSidebar } from "./components/sessions/SessionSidebar";
import { Icon } from "./components/shell/Icon";
import { Modal } from "./components/shell/Modal";
import { ToastRegion } from "./components/shell/ToastRegion";
import { TabBar } from "./components/tabs/TabBar";
import { Workspace } from "./components/tabs/Workspace";
import {
  type AppFontScale,
  type AppInfo,
  type AppTheme,
  appFontScaleGet,
  appFontScaleSave,
  appThemeGet,
  appThemeSave,
  getAppInfo,
  isDesktopRuntime,
  onSessionState,
  profileList,
  type SessionProfile,
  type TerminalPalette,
  terminalFontSizeGet,
  terminalFontSizeSave,
  terminalPaletteGet,
  terminalPaletteSave,
} from "./ipc";
import { getActivePane, useLayoutStore } from "./store/layout";
import { effectiveTerminalFontSize, useUiStore } from "./store/ui";

export function App() {
  const [profiles, setProfiles] = useState<SessionProfile[]>([]);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 900);
  const [aiCollapsed, setAiCollapsed] = useState(() => window.innerWidth <= 900);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo>({
    version: "0.7.1",
    commitHash: "unknown",
    startupProfile: null,
    portable: false,
  });
  const initialized = useRef(false);
  const openProfile = useLayoutStore((state) => state.openProfile);
  const updateSession = useLayoutStore((state) => state.updateSession);
  const activePane = useLayoutStore(getActivePane);
  const notify = useUiStore((state) => state.notify);
  const theme = useUiStore((state) => state.theme);
  const fontScale = useUiStore((state) => state.fontScale);
  const terminalFontSize = useUiStore((state) => state.terminalFontSize);
  const terminalPalette = useUiStore((state) => state.terminalPalette);
  const setTheme = useUiStore((state) => state.setTheme);
  const setFontScale = useUiStore((state) => state.setFontScale);
  const setTerminalFontSize = useUiStore((state) => state.setTerminalFontSize);
  const setTerminalPalette = useUiStore((state) => state.setTerminalPalette);
  const setWorkspaceView = useUiStore((state) => state.setWorkspaceView);

  useEffect(() => {
    void Promise.all([
      profileList(),
      getAppInfo(),
      appThemeGet(),
      appFontScaleGet(),
      terminalFontSizeGet(),
      terminalPaletteGet(),
    ])
      .then(
        ([
          items,
          info,
          savedTheme,
          savedFontScale,
          savedTerminalFontSize,
          savedTerminalPalette,
        ]) => {
          setProfiles(items);
          setAppInfo(info);
          setTheme(savedTheme);
          setFontScale(savedFontScale);
          setTerminalFontSize(savedTerminalFontSize);
          setTerminalPalette(savedTerminalPalette);
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
        },
      )
      .catch((error) =>
        notify(error instanceof Error ? error.message : "会话配置读取失败", "error"),
      );
  }, [notify, openProfile, setFontScale, setTerminalFontSize, setTerminalPalette, setTheme]);

  const selectTheme = async (nextTheme: AppTheme) => {
    const previousTheme = theme;
    setTheme(nextTheme);
    try {
      await appThemeSave(nextTheme);
    } catch (error) {
      setTheme(previousTheme);
      notify(error instanceof Error ? error.message : "主题保存失败", "error");
    }
  };

  const selectFontScale = async (nextScale: AppFontScale) => {
    const previousScale = fontScale;
    setFontScale(nextScale);
    try {
      await appFontScaleSave(nextScale);
    } catch (error) {
      setFontScale(previousScale);
      notify(error instanceof Error ? error.message : "界面字号保存失败", "error");
    }
  };

  const selectTerminalFontSize = async (nextSize: number) => {
    const previousSize = terminalFontSize;
    setTerminalFontSize(nextSize);
    try {
      const saved = await terminalFontSizeSave(nextSize);
      setTerminalFontSize(saved);
    } catch (error) {
      setTerminalFontSize(previousSize);
      notify(error instanceof Error ? error.message : "终端字号保存失败", "error");
    }
  };

  const selectTerminalPalette = async (nextPalette: TerminalPalette) => {
    const previousPalette = terminalPalette;
    setTerminalPalette(nextPalette);
    try {
      const saved = await terminalPaletteSave(nextPalette);
      setTerminalPalette(saved);
    } catch (error) {
      setTerminalPalette(previousPalette);
      notify(error instanceof Error ? error.message : "终端配色保存失败", "error");
    }
  };

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
            aria-label="设置"
            onClick={() => setSettingsOpen(true)}
            title="设置"
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
        <div className="workbench">
          <header className="topbar">
            <TabBar onNewSession={() => setProfileEditorOpen(true)} />
            <div className="topbar-meta">
              {!isDesktopRuntime ? <span className="demo-badge">DEMO</span> : null}
              <span className="secure-indicator">
                <span /> VAULT
              </span>
            </div>
            <button
              aria-label="打开使用说明书"
              className="topbar-help"
              onClick={() => setHelpOpen(true)}
              title="使用说明书"
              type="button"
            >
              <CircleHelp aria-hidden="true" size={16} strokeWidth={1.7} />
            </button>
          </header>
          <div className="workbench-body">
            <main className="main-stage">
              <Workspace profiles={profiles} />
              <QuickBar />
            </main>
            <AiPanel collapsed={aiCollapsed} onCollapsedChange={setAiCollapsed} />
          </div>
        </div>
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
      {settingsOpen ? (
        <Modal onClose={() => setSettingsOpen(false)} size="small" title="设置">
          <section className="appearance-settings">
            <h3>主题</h3>
            <fieldset aria-label="主题" className="theme-options">
              {(
                [
                  ["light", "白色", <Sun aria-hidden="true" key="light" size={17} />],
                  ["eye_care", "护眼色", <Leaf aria-hidden="true" key="eye" size={17} />],
                  ["dark", "深色", <Moon aria-hidden="true" key="dark" size={17} />],
                ] as const
              ).map(([value, label, icon]) => (
                <button
                  aria-pressed={theme === value}
                  className={theme === value ? "is-active" : ""}
                  key={value}
                  onClick={() => void selectTheme(value)}
                  type="button"
                >
                  <span className={`theme-swatch theme-swatch-${value}`}>{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </fieldset>
            <h3>字号</h3>
            <div className="font-settings">
              <label className="font-setting-row">
                <span>
                  <strong>界面字号</strong>
                  <small>放大侧栏、工具栏和设置文字</small>
                </span>
                <select
                  aria-label="界面字号"
                  onChange={(event) => void selectFontScale(event.target.value as AppFontScale)}
                  value={fontScale}
                >
                  <option value="small">小 · 90%</option>
                  <option value="standard">标准 · 100%</option>
                  <option value="large">大 · 115%</option>
                  <option value="extra_large">特大 · 130%</option>
                  <option value="scale_150">超大 · 150%</option>
                  <option value="scale_175">超大 · 175%</option>
                  <option value="scale_200">最大 · 200%</option>
                </select>
              </label>
              <label className="font-setting-row">
                <span>
                  <strong>终端基础字号</strong>
                  <small>
                    随界面比例同步放大；当前实际约
                    {Math.round(effectiveTerminalFontSize(terminalFontSize, fontScale) * 10) / 10}
                    px
                  </small>
                </span>
                <select
                  aria-label="终端字号"
                  onChange={(event) => void selectTerminalFontSize(Number(event.target.value))}
                  value={terminalFontSize}
                >
                  {[12, 13, 14, 15, 16, 18, 20, 22].map((size) => (
                    <option key={size} value={size}>
                      {size}px 基础
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <h3>终端配色</h3>
            <label className="font-setting-row terminal-palette-setting">
              <span>
                <strong>命令与回显</strong>
                <small>命令使用高亮色，回显保持正文色；不修改服务器配置</small>
              </span>
              <select
                aria-label="终端配色"
                onChange={(event) =>
                  void selectTerminalPalette(event.target.value as TerminalPalette)
                }
                value={terminalPalette}
              >
                <option value="graphite_gold">石墨青金 · 稳定对比</option>
                <option value="forest_amber">森林护眼 · 低蓝光</option>
                <option value="midnight_contrast">午夜高对比 · 强区分</option>
              </select>
            </label>
          </section>
          <h3 className="settings-section-title">关于</h3>
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
      {helpOpen ? <HelpManual onClose={() => setHelpOpen(false)} /> : null}
      <ToastRegion />
    </div>
  );
}

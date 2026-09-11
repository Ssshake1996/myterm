import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bot, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { dshWorkspaceStart, isDesktopRuntime } from "../../ipc";
import { fontScaleFactor, useUiStore } from "../../store/ui";

// A label is unique per myterm process so another myterm window (or a
// standalone Harness WebView) can never be mistaken for this workspace.
const WEBVIEW_INSTANCE_ID =
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const WEBVIEW_LABEL = `deepseek-harness-workspace-${WEBVIEW_INSTANCE_ID}`;

function errorText(cause: unknown): string {
  if (cause instanceof Error) return cause.stack || cause.message;
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause, null, 2);
  } catch {
    return String(cause);
  }
}

interface DshWorkspaceProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function DshWorkspace({ collapsed, onCollapsedChange }: DshWorkspaceProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<Webview | null>(null);
  const startIdRef = useRef(0);
  const [width, setWidth] = useState(560);
  const [status, setStatus] = useState<"idle" | "starting" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [version, setVersion] = useState("");
  const fontScale = useUiStore((state) => state.fontScale);

  const syncBounds = useCallback(async () => {
    const webview = webviewRef.current;
    const element = contentRef.current;
    if (!webview || !element || collapsed) return;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    await webview.setPosition(new LogicalPosition(rect.left, rect.top));
    await webview.setSize(new LogicalSize(rect.width, rect.height));
  }, [collapsed]);

  const attachWebview = useCallback(
    async (url: string) => {
      const rect = contentRef.current?.getBoundingClientRect();
      if (!rect) throw new Error("DSH_WEBVIEW_BOUNDS_UNAVAILABLE: 工作区布局尚未就绪");
      const existing = await Webview.getByLabel(WEBVIEW_LABEL);
      const webview =
        existing ??
        new Webview(getCurrentWindow(), WEBVIEW_LABEL, {
          url,
          x: rect.left,
          y: rect.top,
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
          focus: true,
          zoomHotkeysEnabled: true,
        });
      webviewRef.current = webview;
      if (!existing) {
        await new Promise<void>((resolve, reject) => {
          void webview.once("tauri://created", () => resolve());
          void webview.once("tauri://error", (event) =>
            reject(new Error(`DSH_WEBVIEW_CREATE_FAILED: ${String(event.payload)}`)),
          );
        });
      }
      await webview.setZoom(fontScaleFactor[fontScale]);
      await syncBounds();
      await webview.show();
    },
    [fontScale, syncBounds],
  );

  const start = useCallback(async () => {
    if (!isDesktopRuntime || collapsed) return;
    const startId = ++startIdRef.current;
    setStatus("starting");
    setError("");
    try {
      const workspace = await dshWorkspaceStart();
      if (startId !== startIdRef.current) return;
      setVersion(workspace.harnessVersion);
      await attachWebview(workspace.url);
      if (startId !== startIdRef.current) return;
      setStatus("ready");
    } catch (cause) {
      if (startId !== startIdRef.current) return;
      setStatus("error");
      setError(errorText(cause));
    }
  }, [attachWebview, collapsed]);

  useEffect(() => {
    if (collapsed) {
      startIdRef.current += 1;
      void webviewRef.current?.hide();
      return;
    }
    if (webviewRef.current) {
      void syncBounds().then(() => webviewRef.current?.show());
      return;
    }
    void start();
  }, [collapsed, start, syncBounds]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => void syncBounds());
    observer.observe(element);
    window.addEventListener("resize", syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [syncBounds]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    void webview.setZoom(fontScaleFactor[fontScale]);
  }, [fontScale]);

  useEffect(
    () => () => {
      startIdRef.current += 1;
      const webview = webviewRef.current;
      webviewRef.current = null;
      void webview?.close();
    },
    [],
  );

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (move: PointerEvent) => {
      const max = Math.max(480, Math.min(860, window.innerWidth * 0.66));
      setWidth(Math.max(480, Math.min(max, startWidth + startX - move.clientX)));
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
  };

  return (
    <aside
      aria-hidden={collapsed}
      className={`dsh-workspace${collapsed ? " is-collapsed" : ""}`}
      style={{ width }}
    >
      <button
        aria-label="调整 DeepSeek Harness 工作区宽度"
        className="dsh-resizer"
        onPointerDown={startResize}
        type="button"
      />
      <header className="dsh-workspace-header">
        <div className="dsh-workspace-title">
          <span className="dsh-workspace-mark">
            <Bot aria-hidden="true" size={16} strokeWidth={1.8} />
          </span>
          <span>
            <strong>DeepSeek Harness</strong>
            <small>
              {status === "ready"
                ? `官方 Web UI${version ? ` · ${version}` : ""}`
                : status === "starting"
                  ? "正在按需启动…"
                  : status === "error"
                    ? "启动失败"
                    : "按需启动"}
            </small>
          </span>
        </div>
        <div className="dsh-workspace-actions">
          {status === "error" ? (
            <button aria-label="重试启动" onClick={() => void start()} title="重试" type="button">
              <RefreshCw aria-hidden="true" size={15} />
            </button>
          ) : null}
          <button
            aria-label="收起 DeepSeek Harness"
            onClick={() => onCollapsedChange(true)}
            title="收起 Agent 工作区"
            type="button"
          >
            <ChevronRight aria-hidden="true" size={17} />
          </button>
        </div>
      </header>
      <div className="dsh-webview-host" ref={contentRef}>
        {status === "starting" ? (
          <div className="dsh-workspace-state">
            <span className="dsh-spinner" />
            <strong>正在启动官方 DeepSeek Harness</strong>
            <small>首次启动可能需要几秒钟，之后会保持会话状态。</small>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="dsh-workspace-state is-error">
            <strong>DeepSeek Harness 无法启动</strong>
            <pre>{error}</pre>
            <button onClick={() => void start()} type="button">
              重试启动
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

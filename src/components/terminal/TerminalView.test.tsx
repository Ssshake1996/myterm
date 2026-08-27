import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionProfile } from "../../ipc";
import type { PaneModel } from "../../store/layout";
import { useLayoutStore } from "../../store/layout";
import { useUiStore } from "../../store/ui";
import { TerminalView } from "./TerminalView";

const terminalMocks = vi.hoisted(() => ({
  write: vi.fn(),
  fit: vi.fn(),
  dataHandler: undefined as ((data: string) => void) | undefined,
  options: { theme: {} as Record<string, string>, fontSize: 13 },
}));

const ipcMocks = vi.hoisted(() => ({
  publishTerminalOutput: vi.fn(),
  sessionConnect: vi.fn(),
  sessionDisconnect: vi.fn(),
  terminalResize: vi.fn(),
  terminalWrite: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    hasSelection = () => false;
    getSelection = () => "";
    selectAll = vi.fn();
    clearSelection = vi.fn();
    paste = vi.fn();
    options = terminalMocks.options;
    loadAddon = vi.fn();
    open = vi.fn();
    write = terminalMocks.write;
    onData = vi.fn((callback: (data: string) => void) => {
      terminalMocks.dataHandler = callback;
      return { dispose: vi.fn() };
    });
    attachCustomKeyEventHandler = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = terminalMocks.fit;
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext = vi.fn();
  },
}));

vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class {} }));

vi.mock("../../ipc", () => ({
  createChannel: () => ({ onmessage: (_message: unknown) => undefined }),
  formatIpcError: (error: unknown, fallback: string) => {
    if (typeof error !== "object" || error === null) return fallback;
    const value = error as {
      message?: unknown;
      diagnostic?: { summary?: unknown; code?: unknown; stage?: unknown; detail?: unknown };
    };
    if (value.diagnostic) {
      const { summary, code, stage, detail } = value.diagnostic;
      return `${String(summary)} [${String(code)} · ${String(stage)}]\n${String(detail)}`;
    }
    return typeof value.message === "string" && value.message.trim() ? value.message : fallback;
  },
  ...ipcMocks,
}));

const profile: SessionProfile = {
  id: "profile-terminal",
  name: "prod-web",
  group: "prod",
  target: {
    kind: "ssh",
    host: "10.0.0.10",
    port: 22,
    username: "root",
    auth: { kind: "password", vault_ref: "profile.password" },
  },
};

const pane: PaneModel = {
  id: "pane-terminal",
  profileId: profile.id,
  title: profile.name,
  sessionId: null,
  state: "connecting",
  error: null,
};

describe("TerminalView", () => {
  let resizeCallback: ResizeObserverCallback | null;

  beforeEach(() => {
    resizeCallback = null;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: TestResizeObserver,
    });
    ipcMocks.sessionConnect.mockResolvedValue({
      session_id: "session-terminal",
      profile_id: profile.id,
      state: "connected",
      error: null,
    });
    ipcMocks.terminalResize.mockResolvedValue(undefined);
    ipcMocks.terminalWrite.mockResolvedValue(undefined);
    ipcMocks.sessionDisconnect.mockResolvedValue(undefined);
    useUiStore.getState().setTheme("dark");
    useUiStore.getState().setTerminalPalette("graphite_gold");
    useUiStore.getState().setFontScale("standard");
    useUiStore.getState().setTerminalFontSize(13);
    useLayoutStore.setState({
      activeTabId: "tab-terminal",
      tabs: [
        {
          id: "tab-terminal",
          title: profile.name,
          panes: [pane],
          activePaneId: pane.id,
          splitRatio: 50,
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    terminalMocks.dataHandler = undefined;
    vi.clearAllMocks();
  });

  it("writes channel data to xterm as the same binary bytes and resizes the native session", async () => {
    render(<TerminalView pane={pane} profile={profile} />);
    await waitFor(() => expect(ipcMocks.sessionConnect).toHaveBeenCalled());

    const channel = ipcMocks.sessionConnect.mock.calls[0]?.[3] as {
      onmessage: (message: ArrayBuffer) => void;
    };
    const buffer = new Uint8Array([0, 127, 255]).buffer;
    channel.onmessage(buffer);
    const written = terminalMocks.write.mock.calls[0]?.[0] as Uint8Array;
    expect([...written]).toEqual([0, 127, 255]);

    resizeCallback?.([], {} as ResizeObserver);
    await waitFor(() =>
      expect(ipcMocks.terminalResize).toHaveBeenCalledWith("session-terminal", 80, 24),
    );
  });

  it("shows the disconnected overlay and reconnects with the same profile", async () => {
    const { rerender } = render(<TerminalView pane={pane} profile={profile} />);
    await waitFor(() => expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(1));
    rerender(
      <TerminalView
        pane={{ ...pane, sessionId: "session-terminal", state: "disconnected" }}
        profile={profile}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /会话已断开/ }));
    await waitFor(() => expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(2));
    expect(ipcMocks.sessionConnect.mock.calls[1]?.[0]).toBe(profile.id);
  });

  it("updates terminal colors without reconnecting", async () => {
    render(<TerminalView pane={pane} profile={profile} />);
    await waitFor(() => expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(1));

    act(() => useUiStore.getState().setTheme("eye_care"));

    await waitFor(() => expect(terminalMocks.options.theme.background).toBe("#f2f6eb"));
    expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(1);
  });

  it("colors typed commands and separates an inline prompt after output without a newline", async () => {
    render(<TerminalView pane={pane} profile={profile} />);
    await waitFor(() => expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(1));

    act(() => {
      terminalMocks.dataHandler?.("cat /etc/hosts");
      terminalMocks.dataHandler?.("\r");
    });

    expect(terminalMocks.write).toHaveBeenCalledWith("\x1b[38;2;244;210;122m");
    const channel = ipcMocks.sessionConnect.mock.calls[0]?.[3] as {
      onmessage: (message: ArrayBuffer) => void;
    };
    act(() => {
      channel.onmessage(new TextEncoder().encode("cat /etc/hosts\r\nlast line[root@ho").buffer);
      channel.onmessage(new TextEncoder().encode("st]# ").buffer);
    });

    const writes = terminalMocks.write.mock.calls.map(([value]) => value);
    expect(writes).toContain("\r\n");
    expect(writes[writes.length - 1]).toBe("[root@host]# ");
  });

  it("updates the selected terminal palette without reconnecting", async () => {
    render(<TerminalView pane={pane} profile={profile} />);
    await waitFor(() => expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(1));

    act(() => useUiStore.getState().setTerminalPalette("midnight_contrast"));

    await waitFor(() => expect(terminalMocks.options.theme.cursor).toBe("#6dd7ff"));
    expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(1);
  });

  it("colors commands sent by quick actions through the terminal input event", async () => {
    render(<TerminalView pane={pane} profile={profile} />);
    await waitFor(() => expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("myterm:terminal-input", {
          detail: { sessionId: "session-terminal", dataUtf8: "systemctl status nginx\r" },
        }),
      );
    });

    expect(terminalMocks.write).toHaveBeenCalledWith("\x1b[38;2;244;210;122m");
  });

  it("updates terminal font size without reconnecting", async () => {
    render(<TerminalView pane={pane} profile={profile} />);
    await waitFor(() => expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(1));

    act(() => useUiStore.getState().setTerminalFontSize(18));

    await waitFor(() => expect(terminalMocks.options.fontSize).toBe(18));
    expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(1);
  });

  it("opens a terminal context menu with clipboard actions", async () => {
    const { container } = render(<TerminalView pane={pane} profile={profile} />);
    await waitFor(() => expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(1));

    const host = container.querySelector(".terminal-host");
    expect(host).not.toBeNull();
    if (!host) throw new Error("terminal host was not rendered");
    fireEvent.contextMenu(host, { clientX: 120, clientY: 80 });

    expect(screen.getByRole("menu", { name: "终端上下文菜单" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "全选" }));
    expect(screen.queryByRole("menu", { name: "终端上下文菜单" })).not.toBeInTheDocument();
  });

  it("reclaims a session that finishes connecting after its pane was closed", async () => {
    let resolveConnection: ((session: SessionInfo) => void) | undefined;
    ipcMocks.sessionConnect.mockImplementationOnce(
      () =>
        new Promise<SessionInfo>((resolve) => {
          resolveConnection = resolve;
        }),
    );
    render(<TerminalView pane={pane} profile={profile} />);
    await waitFor(() => expect(ipcMocks.sessionConnect).toHaveBeenCalledTimes(1));

    act(() => useLayoutStore.setState({ tabs: [], activeTabId: null }));
    await act(async () => {
      resolveConnection?.({
        session_id: "orphan-session",
        profile_id: profile.id,
        state: "connected",
        error: null,
      });
    });

    await waitFor(() => expect(ipcMocks.sessionDisconnect).toHaveBeenCalledWith("orphan-session"));
  });

  it("shows the original structured SSH connection error instead of a generic failure", async () => {
    ipcMocks.sessionConnect.mockRejectedValueOnce({
      code: "SSH_CONNECT_FAILED",
      message: "connection to 10.0.0.10:22 failed: connection refused",
      diagnostic: {
        stage: "transport",
        code: "SSH_CONNECT_FAILED",
        summary: "SSH 传输连接失败",
        detail: "connection to 10.0.0.10:22 failed: connection refused",
      },
    });
    render(<TerminalView pane={pane} profile={profile} />);

    await waitFor(() => {
      const failedPane = useLayoutStore
        .getState()
        .tabs.flatMap((tab) => tab.panes)
        .find((candidate) => candidate.id === pane.id);
      expect(failedPane?.error).toContain("SSH 传输连接失败 [SSH_CONNECT_FAILED · transport]");
      expect(failedPane?.error).toContain("connection to 10.0.0.10:22 failed: connection refused");
    });
  });
});

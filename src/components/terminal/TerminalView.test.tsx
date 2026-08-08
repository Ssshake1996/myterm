import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionProfile } from "../../ipc";
import type { PaneModel } from "../../store/layout";
import { useLayoutStore } from "../../store/layout";
import { TerminalView } from "./TerminalView";

const terminalMocks = vi.hoisted(() => ({
  write: vi.fn(),
  fit: vi.fn(),
}));

const ipcMocks = vi.hoisted(() => ({
  sessionConnect: vi.fn(),
  terminalResize: vi.fn(),
  terminalWrite: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    hasSelection = () => false;
    getSelection = () => "";
    paste = vi.fn();
    loadAddon = vi.fn();
    open = vi.fn();
    write = terminalMocks.write;
    onData = vi.fn(() => ({ dispose: vi.fn() }));
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
    ipcMocks.sessionConnect.mockResolvedValue("session-terminal");
    ipcMocks.terminalResize.mockResolvedValue(undefined);
    useLayoutStore.setState({ tabs: [], activeTabId: null });
  });

  afterEach(() => {
    cleanup();
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
});

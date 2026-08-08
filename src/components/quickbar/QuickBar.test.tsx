import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutStore } from "../../store/layout";
import { QuickBar } from "./QuickBar";

const ipcMocks = vi.hoisted(() => ({
  quickCommandList: vi.fn(),
  quickCommandSave: vi.fn(),
  quickCommandDelete: vi.fn(),
  terminalWrite: vi.fn(),
}));

vi.mock("../../ipc", () => ({
  ...ipcMocks,
}));

const commands = [
  { id: "a", label: "磁盘", group: "常用", command: "df -h", send_newline: true, sort: 0 },
  {
    id: "b",
    label: "重启",
    group: "常用",
    command: "systemctl restart app",
    send_newline: false,
    sort: 1,
  },
];

describe("QuickBar", () => {
  beforeEach(() => {
    ipcMocks.quickCommandList.mockResolvedValue(commands);
    ipcMocks.terminalWrite.mockResolvedValue(undefined);
    useLayoutStore.setState({
      activeTabId: "tab",
      tabs: [
        {
          id: "tab",
          title: "prod",
          activePaneId: "pane",
          splitRatio: 50,
          panes: [
            {
              id: "pane",
              profileId: "profile",
              title: "prod",
              sessionId: "session-active",
              state: "connected",
              error: null,
            },
          ],
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("routes commands to the active pane and only appends return when configured", async () => {
    const user = userEvent.setup();
    render(<QuickBar />);
    await user.click(await screen.findByRole("button", { name: "磁盘" }));
    await user.click(screen.getByRole("button", { name: /重启/ }));

    expect(ipcMocks.terminalWrite).toHaveBeenNthCalledWith(1, "session-active", "df -h\r");
    expect(ipcMocks.terminalWrite).toHaveBeenNthCalledWith(
      2,
      "session-active",
      "systemctl restart app",
    );
  });

  it("disables command buttons without an active session", async () => {
    useLayoutStore.setState({ tabs: [], activeTabId: null });
    render(<QuickBar />);
    const command = await screen.findByRole("button", { name: "磁盘" });
    await waitFor(() => expect(command).toBeDisabled());
  });
});

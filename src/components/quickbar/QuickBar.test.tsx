import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    ipcMocks.quickCommandSave.mockResolvedValue(undefined);
    ipcMocks.quickCommandDelete.mockResolvedValue(undefined);
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
    await user.click(await screen.findByRole("button", { name: /^磁盘/ }));
    await user.click(screen.getByRole("button", { name: /^重启/ }));

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
    const command = await screen.findByRole("button", { name: /^磁盘/ });
    await waitFor(() => expect(command).toBeDisabled());
  });

  it("keeps large command sets searchable inside a grouped scroll region", async () => {
    const largeSet = Array.from({ length: 32 }, (_, index) => ({
      id: `diagnostic-${index}`,
      label: index === 17 ? "Nginx 错误日志" : `排查命令 ${index + 1}`,
      group: "排查",
      command:
        index === 17 ? "tail -n 200 /var/log/nginx/error.log" : `diagnose --check ${index + 1}`,
      send_newline: true,
      sort: index,
    }));
    ipcMocks.quickCommandList.mockResolvedValue([...commands, ...largeSet]);
    const user = userEvent.setup();
    render(<QuickBar />);

    await user.click(await screen.findByRole("button", { name: "排查 32" }));
    const library = screen.getByLabelText("排查命令");
    expect(within(library).getByText("32 条")).toBeInTheDocument();
    expect(within(library).getAllByRole("listitem")).toHaveLength(32);

    await user.type(screen.getByRole("searchbox", { name: "搜索当前命令集" }), "nginx");
    expect(within(library).getByText("1 / 32 条")).toBeInTheDocument();
    expect(within(library).getAllByRole("listitem")).toHaveLength(1);
    expect(within(library).getByText("Nginx 错误日志")).toBeInTheDocument();
  });

  it("uses an explicit labeled control for collapsed and expanded states", async () => {
    const user = userEvent.setup();
    render(<QuickBar />);

    await user.click(await screen.findByRole("button", { name: "收起" }));
    const expand = screen.getByRole("button", { name: "展开" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "命令集" })).not.toBeInTheDocument();

    await user.click(expand);
    expect(screen.getByRole("button", { name: "收起" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "命令集" })).toBeInTheDocument();
  });

  it("supports keyboard height adjustment on the desktop dock", async () => {
    render(<QuickBar />);
    const resizer = await screen.findByRole("separator", {
      name: "调整快捷命令面板高度",
    });
    expect(resizer).toHaveAttribute("aria-valuenow", "224");

    fireEvent.keyDown(resizer, { key: "ArrowUp" });
    await waitFor(() => expect(resizer).toHaveAttribute("aria-valuenow", "236"));
  });
});

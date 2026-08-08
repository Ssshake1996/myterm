import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutStore } from "../../store/layout";
import { TabBar } from "./TabBar";

const sessionDisconnect = vi.hoisted(() => vi.fn());
vi.mock("../../ipc", () => ({ sessionDisconnect }));

describe("TabBar", () => {
  beforeEach(() => {
    sessionDisconnect.mockResolvedValue(undefined);
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
              sessionId: "session-tab",
              state: "connected",
              error: null,
            },
          ],
        },
      ],
    });
  });

  afterEach(cleanup);

  it("disconnects every pane before removing a tab", async () => {
    const user = userEvent.setup();
    render(<TabBar onNewSession={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "关闭 prod" }));

    expect(sessionDisconnect).toHaveBeenCalledWith("session-tab");
    expect(useLayoutStore.getState().tabs).toHaveLength(0);
  });
});

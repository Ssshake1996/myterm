import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionProfile } from "../../ipc";
import { useLayoutStore } from "../../store/layout";
import { Workspace } from "./Workspace";

const sessionDisconnect = vi.hoisted(() => vi.fn());

vi.mock("../../ipc", () => ({ sessionDisconnect }));
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: () => <div>terminal</div>,
}));

const profile: SessionProfile = {
  id: "profile",
  name: "prod",
  group: "ops",
  target: {
    kind: "ssh",
    host: "10.0.0.8",
    port: 22,
    username: "root",
    auth: { kind: "password", vault_ref: "profile.password" },
  },
};

describe("Workspace split panes", () => {
  beforeEach(() => {
    sessionDisconnect.mockResolvedValue(undefined);
    useLayoutStore.setState({
      activeTabId: "tab",
      tabs: [
        {
          id: "tab",
          title: "prod",
          activePaneId: "right",
          splitRatio: 50,
          panes: [
            {
              id: "left",
              profileId: profile.id,
              title: profile.name,
              sessionId: "session-left",
              state: "connected",
              error: null,
            },
            {
              id: "right",
              profileId: profile.id,
              title: profile.name,
              sessionId: "session-right",
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

  it("disconnects and removes the selected split pane", async () => {
    const user = userEvent.setup();
    render(<Workspace profiles={[profile]} />);

    await user.click(await screen.findByRole("button", { name: "关闭右侧分屏" }));

    expect(sessionDisconnect).toHaveBeenCalledWith("session-right");
    expect(useLayoutStore.getState().tabs[0]).toMatchObject({
      activePaneId: "left",
      panes: [{ id: "left", sessionId: "session-left" }],
    });
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutStore } from "../../store/layout";
import { MarkdownContent } from "./MarkdownContent";

const terminalWrite = vi.hoisted(() => vi.fn());

vi.mock("../../ipc", () => ({ terminalWrite }));

describe("MarkdownContent", () => {
  beforeEach(() => {
    terminalWrite.mockResolvedValue(undefined);
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
              sessionId: "session-ai",
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

  it("renders hostile markup as text and fills code without return", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MarkdownContent
        content={'<img src=x onerror="alert(1)">\n```bash\nsudo systemctl restart nginx\n```'}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /回填/ }));
    expect(terminalWrite).toHaveBeenCalledWith("session-ai", "sudo systemctl restart nginx");
  });
});

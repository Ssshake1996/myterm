import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutStore } from "../../store/layout";
import { AiPanel } from "./AiPanel";

const ipcMocks = vi.hoisted(() => ({
  aiProfileList: vi.fn(),
  aiChat: vi.fn(),
  aiAbort: vi.fn(),
}));

vi.mock("../../ipc", () => {
  return { ...ipcMocks, createChannel: () => ({ onmessage: () => undefined }) };
});

const aiProfile = {
  id: "ai-1",
  name: "Ops AI",
  base_url: "https://api.example.test/v1",
  api_key_ref: "ai.ai-1.key",
  model: "ops-model",
  system_prompt: "",
  context_lines: 80,
};

describe("AiPanel", () => {
  beforeEach(() => {
    ipcMocks.aiProfileList.mockResolvedValue([aiProfile]);
    ipcMocks.aiAbort.mockResolvedValue(undefined);
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
              title: "prod-web",
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

  it("streams deltas and attaches only the active terminal context", async () => {
    ipcMocks.aiChat.mockImplementation(
      async (
        _profileId: string,
        _messages: unknown[],
        _sessionId: string,
        channel: { onmessage: ((delta: string) => void) | null },
      ) => {
        channel.onmessage?.("Diagnosis ");
        channel.onmessage?.("ready");
        return {
          finishReason: "stop",
          attachedContext: "[Terminal output]\nservice failed",
        };
      },
    );
    const user = userEvent.setup();
    render(<AiPanel collapsed={false} onCollapsedChange={vi.fn()} />);

    await screen.findByRole("option", { name: "Ops AI · ops-model" });
    await user.type(screen.getByRole("textbox", { name: "询问 AI" }), "分析故障");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(ipcMocks.aiChat).toHaveBeenCalledWith(
        "ai-1",
        [{ role: "user", content: "分析故障" }],
        "session-active",
        expect.anything(),
      ),
    );
    expect(await screen.findByText("Diagnosis ready")).toBeInTheDocument();
    expect(await screen.findByText(/service failed/u)).toBeInTheDocument();
  });
});

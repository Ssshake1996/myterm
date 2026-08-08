import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutStore } from "../../store/layout";
import { AiPanel } from "./AiPanel";

const ipcMocks = vi.hoisted(() => ({
  agentAbort: vi.fn(),
  agentApprove: vi.fn(),
  agentRun: vi.fn(),
  agentSettingsGet: vi.fn(),
  agentSettingsSave: vi.fn(),
  aiProfileList: vi.fn(),
}));

vi.mock("../../ipc", () => ({
  ...ipcMocks,
  createChannel: () => ({ onmessage: () => undefined }),
}));

const aiProfile = {
  id: "ai-1",
  name: "Ops AI",
  base_url: "https://api.example.test/v1",
  api_key_ref: "ai.ai-1.key",
  model: "ops-model",
  system_prompt: "",
  context_lines: 80,
};

const settings = {
  permission_mode: "full_access" as const,
  max_steps: 8,
  skill_directories: [],
  enabled_skills: [],
  mcp_servers: [],
};

describe("AiPanel Agent trace", () => {
  beforeEach(() => {
    ipcMocks.aiProfileList.mockResolvedValue([aiProfile]);
    ipcMocks.agentSettingsGet.mockResolvedValue(settings);
    ipcMocks.agentSettingsSave.mockImplementation(async (value) => value);
    ipcMocks.agentAbort.mockResolvedValue(undefined);
    ipcMocks.agentApprove.mockResolvedValue(undefined);
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

  it("renders model decisions, tool arguments, results and the final answer", async () => {
    ipcMocks.agentRun.mockImplementation(
      async (
        _profileId: string,
        _prompt: string,
        _sessionId: string,
        channel: { onmessage: (event: Record<string, unknown>) => void },
      ) => {
        channel.onmessage({
          eventType: "status",
          runId: "run",
          step: 1,
          message: "模型决策 · 1/8",
        });
        channel.onmessage({
          eventType: "tool_requested",
          runId: "run",
          step: 1,
          callId: "call-1",
          toolName: "session_info",
          arguments: {},
        });
        channel.onmessage({
          eventType: "tool_result",
          runId: "run",
          step: 1,
          callId: "call-1",
          toolName: "session_info",
          content: '{"host":"prod-web"}',
          isError: false,
        });
        channel.onmessage({
          eventType: "assistant",
          runId: "run",
          step: 2,
          content: "连接正常，可以继续排查。",
        });
        channel.onmessage({ eventType: "complete", runId: "run", step: 2, message: "stop" });
        return { runId: "run", finishReason: "stop", steps: 2 };
      },
    );
    const user = userEvent.setup();
    render(<AiPanel collapsed={false} onCollapsedChange={vi.fn()} />);

    await screen.findByRole("option", { name: "Ops AI · ops-model" });
    await user.type(screen.getByRole("textbox", { name: "输入 Agent 任务" }), "检查连接");
    await user.click(screen.getByRole("button", { name: "运行 Agent" }));

    await waitFor(() =>
      expect(ipcMocks.agentRun).toHaveBeenCalledWith(
        "ai-1",
        "检查连接",
        "session-active",
        expect.anything(),
      ),
    );
    expect(await screen.findByText("读取会话信息")).toBeInTheDocument();
    expect(screen.getByText('{"host":"prod-web"}')).toBeInTheDocument();
    expect(screen.getByText("连接正常，可以继续排查。")).toBeInTheDocument();
    expect(screen.getByText("任务完成")).toBeInTheDocument();
  });

  it("pauses for tool approval in confirmation mode", async () => {
    ipcMocks.agentSettingsGet.mockResolvedValue({ ...settings, permission_mode: "confirm" });
    ipcMocks.agentRun.mockImplementation(
      async (
        _profileId: string,
        _prompt: string,
        _sessionId: string,
        channel: { onmessage: (event: Record<string, unknown>) => void },
      ) => {
        channel.onmessage({
          eventType: "tool_requested",
          runId: "run",
          step: 1,
          callId: "approval-1",
          toolName: "terminal_send",
          arguments: { command: "df -h" },
        });
        channel.onmessage({
          eventType: "approval_required",
          runId: "run",
          step: 1,
          callId: "approval-1",
          toolName: "terminal_send",
          arguments: { command: "df -h" },
        });
        return new Promise(() => undefined);
      },
    );
    const user = userEvent.setup();
    render(<AiPanel collapsed={false} onCollapsedChange={vi.fn()} />);

    await screen.findByRole("option", { name: "Ops AI · ops-model" });
    await user.type(screen.getByRole("textbox", { name: "输入 Agent 任务" }), "检查磁盘");
    await user.click(screen.getByRole("button", { name: "运行 Agent" }));
    await user.click(await screen.findByRole("button", { name: "允许执行" }));

    expect(ipcMocks.agentApprove).toHaveBeenCalledWith("approval-1", true);
    expect(screen.getByText(/df -h/u)).toBeInTheDocument();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutStore } from "../../store/layout";
import { AiPanel } from "./AiPanel";

const ipcMocks = vi.hoisted(() => ({
  agentAbort: vi.fn(),
  agentApprove: vi.fn(),
  agentConversationCreate: vi.fn(),
  agentConversationDelete: vi.fn(),
  agentConversationList: vi.fn(),
  agentConversationTasks: vi.fn(),
  agentGoalCancel: vi.fn(),
  agentGoalGet: vi.fn(),
  agentGoalPause: vi.fn(),
  agentGoalResume: vi.fn(),
  agentInputQueue: vi.fn(),
  agentRun: vi.fn(),
  agentSteer: vi.fn(),
  agentSettingsGet: vi.fn(),
  agentSettingsSave: vi.fn(),
  agentTaskEvents: vi.fn(),
  aiProfileList: vi.fn(),
  errorMessage: (error: unknown, fallback: string) => {
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    return fallback;
  },
  ipcErrorCode: (error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === "string" ? code : undefined;
    }
    return undefined;
  },
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
  reasoning_effort: "high" as const,
  system_prompt: "",
  models: [
    { id: "primary", name: "主模型", model: "ops-model", role: "primary" as const, enabled: true },
  ],
  routing: { fallback_on_error: true },
};

const settings = {
  permission_mode: "full_access" as const,
  skill_directories: [],
  enabled_skills: [],
  mcp_servers: [],
};

describe("AiPanel Agent trace", () => {
  beforeEach(() => {
    ipcMocks.aiProfileList.mockResolvedValue([aiProfile]);
    ipcMocks.agentSettingsGet.mockResolvedValue(settings);
    ipcMocks.agentSettingsSave.mockImplementation(async (value) => value);
    ipcMocks.agentConversationCreate.mockResolvedValue({
      id: "conversation-1",
      title: "新对话",
      profileId: "ai-1",
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      turnCount: 0,
    });
    ipcMocks.agentConversationDelete.mockResolvedValue(true);
    ipcMocks.agentConversationList.mockResolvedValue([]);
    ipcMocks.agentConversationTasks.mockResolvedValue([]);
    ipcMocks.agentGoalGet.mockResolvedValue(null);
    ipcMocks.agentGoalCancel.mockImplementation(async (goal) => goal);
    ipcMocks.agentGoalPause.mockImplementation(async (goal) => goal);
    ipcMocks.agentGoalResume.mockImplementation(async (goal) => goal);
    ipcMocks.agentInputQueue.mockResolvedValue({
      id: "queued-1",
      conversationId: "conversation-1",
      goalId: "goal-1",
      content: "queued",
      mode: "queue",
      state: "queued",
      createdAtMs: Date.now(),
      consumedAtMs: null,
    });
    ipcMocks.agentTaskEvents.mockResolvedValue([]);
    ipcMocks.agentAbort.mockResolvedValue(undefined);
    ipcMocks.agentApprove.mockResolvedValue(undefined);
    ipcMocks.agentSteer.mockResolvedValue({
      conversationId: "conversation-1",
      turnId: "run",
      accepted: true,
    });
    ipcMocks.agentRun.mockResolvedValue({
      runId: "run",
      conversationId: "conversation-1",
      turnId: "run",
      finishReason: "stop",
      steps: 1,
    });
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
        _conversationId: string,
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
        return {
          runId: "run",
          conversationId: "conversation-1",
          turnId: "run",
          finishReason: "stop",
          steps: 2,
        };
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
        "conversation-1",
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

  it("shows an enabled routed model when the primary row was deleted", async () => {
    ipcMocks.aiProfileList.mockResolvedValue([
      {
        ...aiProfile,
        models: [
          {
            id: "fallback",
            name: "备用模型",
            model: "fallback-model",
            role: "fallback",
            enabled: true,
          },
        ],
      },
    ]);

    render(<AiPanel collapsed={false} onCollapsedChange={vi.fn()} />);

    expect(
      await screen.findByRole("option", { name: "Ops AI · fallback-model" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("未配置模型")).not.toBeInTheDocument();
  });

  it("pauses for tool approval in confirmation mode", async () => {
    ipcMocks.agentSettingsGet.mockResolvedValue({ ...settings, permission_mode: "confirm" });
    ipcMocks.agentRun.mockImplementation(
      async (
        _profileId: string,
        _conversationId: string,
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

  it("inserts a newline with Shift+Enter and submits with Enter outside IME composition", async () => {
    const user = userEvent.setup();
    render(<AiPanel collapsed={false} onCollapsedChange={vi.fn()} />);

    await screen.findByRole("option", { name: "Ops AI · ops-model" });
    const input = screen.getByRole("textbox", { name: "输入 Agent 任务" });
    await user.type(input, "先检查 A");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(input, "再观察 B");

    expect(input).toHaveValue("先检查 A\n再观察 B");
    expect(ipcMocks.agentRun).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(ipcMocks.agentRun).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(ipcMocks.agentRun).toHaveBeenCalledWith(
        "ai-1",
        "conversation-1",
        "先检查 A\n再观察 B",
        "session-active",
        expect.anything(),
      ),
    );
  });

  it("offers the active SSH as a passive candidate without a manual binding control", async () => {
    render(<AiPanel collapsed={false} onCollapsedChange={vi.fn()} />);

    await screen.findByRole("option", { name: "Ops AI · ops-model" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("活动 SSH 候选")).toBeInTheDocument();
    expect(screen.getByText("prod-web")).toBeInTheDocument();
  });

  it("resizes the composer upward and caps it at half the Agent panel height", async () => {
    render(<AiPanel collapsed={false} onCollapsedChange={vi.fn()} />);

    await screen.findByRole("option", { name: "Ops AI · ops-model" });
    const resizer = screen.getByRole("separator", { name: "调整 Agent 输入框高度" });
    const composer = resizer.parentElement;

    expect(composer).toHaveStyle({ height: "111px" });
    fireEvent.keyDown(resizer, { key: "ArrowUp" });
    expect(composer).toHaveStyle({ height: "127px" });

    fireEvent.keyDown(resizer, { key: "End" });
    expect(Number.parseInt(composer?.style.height ?? "0", 10)).toBeLessThanOrEqual(
      window.innerHeight / 2,
    );

    fireEvent.keyDown(resizer, { key: "Home" });
    expect(composer).toHaveStyle({ height: "111px" });
  });

  it("starts a clearly separated new conversation from task history", async () => {
    ipcMocks.agentConversationList.mockResolvedValue([
      {
        id: "saved-conversation-1",
        title: "检查旧任务",
        profileId: "ai-1",
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        turnCount: 1,
      },
    ]);
    ipcMocks.agentConversationTasks.mockResolvedValue([
      {
        id: "saved-task-1",
        conversationId: "saved-conversation-1",
        goalId: "saved-goal-1",
        turnIndex: 1,
        continuationIndex: 0,
        profileId: "ai-1",
        prompt: "检查旧任务",
        state: "succeeded",
        permissionMode: "confirm",
        sessionId: "session-active",
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        finishReason: "stop",
        steps: 1,
        errorCode: null,
        errorMessage: null,
      },
    ]);
    ipcMocks.agentTaskEvents.mockResolvedValue([
      {
        schemaVersion: 2,
        sequence: 1,
        createdAtMs: Date.now(),
        eventType: "assistant",
        runId: "saved-task-1",
        content: "旧任务结果",
      },
    ]);
    const user = userEvent.setup();
    render(<AiPanel collapsed={false} onCollapsedChange={vi.fn()} />);

    await user.click(await screen.findByTitle("对话历史"));
    await user.click(screen.getByRole("button", { name: /检查旧任务/u }));
    expect(await screen.findByText("旧任务结果")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建对话" }));
    expect(screen.queryByText("旧任务结果")).not.toBeInTheDocument();
    expect(screen.getByTitle("新对话")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "输入 Agent 任务" })).toHaveFocus();
  });

  it("keeps the composer active and steers the running turn", async () => {
    ipcMocks.agentRun.mockImplementation(
      async (
        _profileId: string,
        _conversationId: string,
        _prompt: string,
        _sessionId: string,
        channel: { onmessage: (event: Record<string, unknown>) => void },
      ) => {
        channel.onmessage({
          eventType: "status",
          runId: "run",
          message: "Codex Core 正在执行",
        });
        return new Promise(() => undefined);
      },
    );
    const user = userEvent.setup();
    render(<AiPanel collapsed={false} onCollapsedChange={vi.fn()} />);

    await screen.findByRole("option", { name: "Ops AI · ops-model" });
    const input = screen.getByRole("textbox", { name: "输入 Agent 任务" });
    await user.type(input, "执行 show system general");
    await user.click(screen.getByRole("button", { name: "运行 Agent" }));
    await screen.findByRole("button", { name: "停止 Agent" });

    expect(input).toBeEnabled();
    await user.type(input, "参数之间是有空格的");
    await user.click(screen.getByRole("button", { name: "追加要求" }));

    await waitFor(() =>
      expect(ipcMocks.agentSteer).toHaveBeenCalledWith("conversation-1", "参数之间是有空格的"),
    );
  });

  it("renders the exact Agent failure detail and error code", async () => {
    const detail =
      'HTTP 502 Bad Gateway\nEndpoint: https://api.example.test/v1/chat/completions\nResponse body:\n{"error":"upstream reset"}';
    ipcMocks.agentRun.mockImplementation(
      async (
        _profileId: string,
        _conversationId: string,
        _prompt: string,
        _sessionId: string,
        channel: { onmessage: (event: Record<string, unknown>) => void },
      ) => {
        channel.onmessage({
          schemaVersion: 2,
          eventType: "complete",
          runId: "run",
          step: 1,
          message: "failed",
          content: detail,
          isError: true,
          errorCode: "ai",
        });
        throw { code: "ai", message: detail };
      },
    );
    const user = userEvent.setup();
    render(<AiPanel collapsed={false} onCollapsedChange={vi.fn()} />);

    await screen.findByRole("option", { name: "Ops AI · ops-model" });
    await user.type(screen.getByRole("textbox", { name: "输入 Agent 任务" }), "检查模型网关");
    await user.click(screen.getByRole("button", { name: "运行 Agent" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("任务执行失败");
    expect(error).toHaveTextContent("ai");
    expect(error.querySelector("pre")?.textContent).toBe(detail);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

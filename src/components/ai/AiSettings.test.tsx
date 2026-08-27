import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettings } from "./AiSettings";

const ipcMocks = vi.hoisted(() => ({
  aiProfileSave: vi.fn(),
  aiTestConnection: vi.fn(),
  aiConfigJson: vi.fn(),
  configOpenLocal: vi.fn(),
  errorMessage: (error: unknown, fallback: string) => {
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    return fallback;
  },
}));

vi.mock("../../ipc", () => ipcMocks);

describe("AiSettings", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("saves an explicit raw API key authentication mode", async () => {
    ipcMocks.aiProfileSave.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <AiSettings
        profile={{
          id: "ai-test",
          name: "Gateway",
          base_url: "https://gateway.example/v1",
          api_key_ref: "ai.ai-test.key",
          auth_mode: "bearer",
          model: "model",
          system_prompt: "",
          context_lines: 80,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "AI 认证方式" }), "api_key");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(ipcMocks.aiProfileSave).toHaveBeenCalledWith(
      expect.objectContaining({ auth_mode: "api_key" }),
      undefined,
    );
  });

  it("persists the provider context mode and model token limits", async () => {
    ipcMocks.aiProfileSave.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AiSettings profile={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Agent 上下文协议" }),
      "local_rollout",
    );
    const windowInput = screen.getByRole("spinbutton", { name: "主模型上下文窗口 Token" });
    const thresholdInput = screen.getByRole("spinbutton", { name: "主模型压缩阈值 Token" });
    await user.clear(windowInput);
    await user.type(windowInput, "64000");
    await user.clear(thresholdInput);
    await user.type(thresholdInput, "48000");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(ipcMocks.aiProfileSave).toHaveBeenCalledWith(
      expect.objectContaining({
        context_mode: "local_rollout",
        models: expect.arrayContaining([
          expect.objectContaining({
            role: "primary",
            context_window_tokens: 64000,
            compact_threshold_tokens: 48000,
          }),
        ]),
      }),
      undefined,
    );
  });

  it("renders the serialized IPC error instead of collapsing it to a generic failure", async () => {
    ipcMocks.aiProfileSave.mockResolvedValue(undefined);
    ipcMocks.aiTestConnection.mockRejectedValue({
      code: "ai",
      message:
        'HTTP 401 Unauthorized\nEndpoint: https://gateway.example/v1/models\nResponse body:\n{"error":"invalid key"}',
    });
    const user = userEvent.setup();
    render(
      <AiSettings
        profile={{
          id: "ai-test",
          name: "Gateway",
          base_url: "https://gateway.example/v1",
          api_key_ref: "ai.ai-test.key",
          auth_mode: "bearer",
          model: "model",
          system_prompt: "",
          context_lines: 80,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "测试连接" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("测试连接 · ai");
    expect(error).not.toHaveTextContent("认证失败");
    expect(screen.queryByText("HTTP 401 Unauthorized")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看详情" }));

    expect(error).toHaveTextContent("HTTP 401 Unauthorized");
    expect(error).toHaveTextContent('{"error":"invalid key"}');
    expect(error.querySelector("pre")?.textContent).toBe(
      'HTTP 401 Unauthorized\nEndpoint: https://gateway.example/v1/models\nResponse body:\n{"error":"invalid key"}',
    );
    expect(screen.getByRole("button", { name: "收起详情" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows backend summary and stack only after opening details", async () => {
    ipcMocks.aiProfileSave.mockResolvedValue(undefined);
    ipcMocks.aiTestConnection.mockResolvedValue({
      ok: false,
      error: {
        stage: "models_request",
        code: "http_401",
        summary: "请求模型列表 · HTTP 401 Unauthorized",
        detail:
          'HTTP 401 Unauthorized\nEndpoint: https://gateway.example/v1/models\nResponse body:\n{"error":"invalid key"}',
        stack: "stack frame A\nstack frame B",
      },
    });
    const user = userEvent.setup();
    render(
      <AiSettings
        profile={{
          id: "ai-test",
          name: "Gateway",
          base_url: "https://gateway.example/v1",
          api_key_ref: "ai.ai-test.key",
          auth_mode: "bearer",
          model: "model",
          system_prompt: "",
          context_lines: 80,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByText("请求模型列表 · HTTP 401 Unauthorized")).toBeInTheDocument();
    expect(screen.queryByText("stack frame A")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看详情" }));
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "PRE" && element.textContent?.includes("stack frame A") === true,
      ),
    ).toBeInTheDocument();
  });

  it("shows returned model identities and raw response details", async () => {
    ipcMocks.aiProfileSave.mockResolvedValue(undefined);
    ipcMocks.aiTestConnection.mockResolvedValue({
      ok: true,
      models: 2,
      endpoint: "https://gateway.example/v1/models",
      modelDetails: [
        { id: "model-a", object: "model", owned_by: "gateway" },
        { id: "model-b", object: "model", owned_by: "gateway" },
      ],
      rawResponse: '{"object":"list","data":[{"id":"model-a"},{"id":"model-b"}]}',
    });
    const user = userEvent.setup();
    render(<AiSettings profile={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText("连接成功 · 2 个模型")).toBeInTheDocument();
    expect(screen.queryByText("model-a")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看模型详情" }));
    expect(screen.getByText("model-a")).toBeInTheDocument();
    expect(screen.getByText("model-b")).toBeInTheDocument();
    expect(screen.getByText("原始返回 JSON")).toBeInTheDocument();
  });

  it("previews current JSON edits and can refresh/open the local config", async () => {
    ipcMocks.aiConfigJson.mockResolvedValue({ version: 2, ai_profiles: [] });
    ipcMocks.configOpenLocal.mockResolvedValue("C:\\Users\\test\\config.json");
    const user = userEvent.setup();
    render(<AiSettings profile={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByText("当前编辑内容（实时）")).toBeInTheDocument();
    expect(screen.getByText(/"ai_profiles"/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "刷新后端 JSON" }));
    expect((await screen.findAllByText(/"version": 2/)).length).toBeGreaterThanOrEqual(2);
    await user.click(screen.getByRole("button", { name: "在本地打开" }));
    expect(ipcMocks.configOpenLocal).toHaveBeenCalledTimes(1);
  });
});

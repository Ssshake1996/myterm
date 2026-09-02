import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiProfile } from "../../ipc";
import { AiSettings } from "./AiSettings";

const ipcMocks = vi.hoisted(() => ({
  aiFetchModels: vi.fn(),
  aiProfileDelete: vi.fn(),
  aiProfileSave: vi.fn(),
  aiTestModel: vi.fn(),
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

function deepSeekProfile(
  id = "ai-test",
  name = "DeepSeek Gateway",
  model = "deepseek-chat",
): AiProfile {
  return {
    id,
    name,
    base_url: "https://gateway.example/v1",
    api_key_ref: `ai.${id}.key`,
    reasoning_effort: "high",
    system_prompt: "",
    models: [{ id: "primary", name: "主模型", model, role: "primary", enabled: true }],
    routing: { fallback_on_error: true },
  };
}

describe("AiSettings", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("saves the native DeepSeek reasoning effort without an authentication mode", async () => {
    ipcMocks.aiProfileSave.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AiSettings profile={deepSeekProfile()} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.queryByRole("combobox", { name: "AI 认证方式" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "DeepSeek 推理强度" }), "max");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(ipcMocks.aiProfileSave).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning_effort: "max" }),
      undefined,
    );
  });

  it("keeps model limits optional and saves explicit context and output values", async () => {
    ipcMocks.aiProfileSave.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AiSettings profile={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.queryByRole("combobox", { name: "Agent 上下文协议" })).not.toBeInTheDocument();
    expect(screen.getByText("Compaction")).toBeInTheDocument();
    expect(screen.getByText(/Session、checkpoint、token 计量/u)).toBeInTheDocument();
    expect(screen.getAllByText("Provider 默认").length).toBeGreaterThan(0);
    await user.click(screen.getAllByText("高级模型限制")[0]);
    await user.type(screen.getByRole("spinbutton", { name: "主模型上下文窗口" }), "131072");
    await user.type(screen.getByRole("spinbutton", { name: "主模型最大输出 Token" }), "16384");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(ipcMocks.aiProfileSave).toHaveBeenCalledWith(
      expect.objectContaining({
        models: expect.arrayContaining([
          expect.objectContaining({
            role: "primary",
            context_window: 131072,
            max_output_tokens: 16384,
          }),
        ]),
      }),
      undefined,
    );
  });

  it("renders the serialized IPC error instead of collapsing it to a generic failure", async () => {
    ipcMocks.aiProfileSave.mockResolvedValue(undefined);
    ipcMocks.aiFetchModels.mockRejectedValue({
      code: "ai",
      message:
        'HTTP 401 Unauthorized\nEndpoint: https://gateway.example/v1/models\nResponse body:\n{"error":"invalid key"}',
    });
    const user = userEvent.setup();
    render(<AiSettings profile={deepSeekProfile()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "获取模型" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("获取模型 · ai");
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
    ipcMocks.aiFetchModels.mockResolvedValue({
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
    render(<AiSettings profile={deepSeekProfile()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "获取模型" }));

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
    ipcMocks.aiFetchModels.mockResolvedValue({
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

    await user.click(screen.getByRole("button", { name: "获取模型" }));
    expect(await screen.findByText("获取成功 · 2 个模型")).toBeInTheDocument();
    expect(screen.queryByText("model-a")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看模型详情" }));
    expect(screen.getByText("model-a")).toBeInTheDocument();
    expect(screen.getByText("model-b")).toBeInTheDocument();
    expect(screen.getByText("原始返回 JSON")).toBeInTheDocument();
  });

  it("tests the selected configured model with the editable prompt", async () => {
    ipcMocks.aiProfileSave.mockResolvedValue(undefined);
    ipcMocks.aiTestModel.mockResolvedValue({
      ok: true,
      model: "model-a",
      content: "hello from model-a",
      elapsedMs: 128,
      endpoint: "https://gateway.example/v1/chat/completions",
      rawResponse: '{"model":"model-a"}',
    });
    const user = userEvent.setup();
    render(
      <AiSettings
        profile={deepSeekProfile("ai-test", "DeepSeek Gateway", "model-a")}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const prompt = screen.getByRole("textbox", { name: "测试提示词" });
    await user.clear(prompt);
    await user.type(prompt, "reply with pong");
    await user.click(screen.getByRole("button", { name: "测试模型" }));

    expect(ipcMocks.aiTestModel).toHaveBeenCalledWith("ai-test", "primary", "reply with pong");
    expect(await screen.findByText("测试成功 · model-a · 128 ms")).toBeInTheDocument();
    expect(screen.getByText("hello from model-a")).toBeInTheDocument();
  });

  it("deletes a non-active saved profile without removing the active profile", async () => {
    ipcMocks.aiProfileDelete.mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onDeleted = vi.fn();
    const profiles = [
      deepSeekProfile("active", "当前服务", "deepseek-chat"),
      deepSeekProfile("backup", "备用服务", "deepseek-reasoner"),
    ];
    const user = userEvent.setup();
    render(
      <AiSettings
        activeProfileId="active"
        onClose={vi.fn()}
        onDeleted={onDeleted}
        onSaved={vi.fn()}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );

    expect(screen.getByText("当前使用")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除 DeepSeek 服务 当前服务" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除 DeepSeek 服务 备用服务" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(ipcMocks.aiProfileDelete).toHaveBeenCalledWith("backup");
    expect(onDeleted).toHaveBeenCalledWith("backup");
    confirm.mockRestore();
  });

  it("previews current JSON edits and can refresh/open the local config", async () => {
    ipcMocks.aiConfigJson.mockResolvedValue({ version: 6, ai_profiles: [] });
    ipcMocks.configOpenLocal.mockResolvedValue("C:\\Users\\test\\config.json");
    const user = userEvent.setup();
    render(<AiSettings profile={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByText("当前编辑内容（实时）")).toBeInTheDocument();
    expect(screen.getByText(/"ai_profiles"/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "刷新后端 JSON" }));
    expect((await screen.findAllByText(/"version": 6/)).length).toBeGreaterThanOrEqual(2);
    await user.click(screen.getByRole("button", { name: "在本地打开" }));
    expect(ipcMocks.configOpenLocal).toHaveBeenCalledTimes(1);
  });
});

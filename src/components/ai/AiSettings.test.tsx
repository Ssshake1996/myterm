import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettings } from "./AiSettings";

const ipcMocks = vi.hoisted(() => ({
  aiProfileSave: vi.fn(),
  aiTestConnection: vi.fn(),
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
});

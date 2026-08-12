import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettings } from "./AiSettings";

const ipcMocks = vi.hoisted(() => ({
  aiProfileSave: vi.fn(),
  aiTestConnection: vi.fn(),
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
});

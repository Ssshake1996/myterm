import { describe, expect, it } from "vitest";
import type { AiProfile } from "../../ipc";
import { aiProfileModelLabel, ensurePrimaryAiModel } from "./ai-profile";

describe("AI profile model routing", () => {
  it("uses the first enabled configured model when no primary model remains", () => {
    const profile: AiProfile = {
      id: "profile",
      name: "Gateway",
      base_url: "https://gateway.example/v1",
      api_key_ref: "ai.profile.key",
      reasoning_effort: "high",
      system_prompt: "",
      models: [
        {
          id: "fallback",
          name: "备用模型",
          model: "fallback-model",
          role: "fallback",
          enabled: true,
        },
        {
          id: "disabled",
          name: "备用模型",
          model: "disabled-model",
          role: "fallback",
          enabled: false,
        },
      ],
    };

    expect(aiProfileModelLabel(profile)).toBe("fallback-model");
  });

  it("promotes an enabled model after the primary row is deleted", () => {
    const models = ensurePrimaryAiModel([
      {
        id: "fallback",
        name: "备用模型",
        model: "fallback-model",
        role: "fallback",
        enabled: true,
      },
    ]);

    expect(models[0].role).toBe("primary");
  });
});

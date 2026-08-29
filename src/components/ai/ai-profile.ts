import type { AiModelConfig, AiProfile } from "../../ipc";

const MODEL_ROLE_PRIORITY = { primary: 0, analysis: 1, fallback: 2 } as const;

export function effectiveAiModels(profile: Pick<AiProfile, "models" | "model">): AiModelConfig[] {
  const configured = (profile.models ?? [])
    .filter((model) => model.enabled && model.model.trim())
    .slice()
    .sort((left, right) => MODEL_ROLE_PRIORITY[left.role] - MODEL_ROLE_PRIORITY[right.role]);
  if (configured.length) return configured;

  const legacyModel = profile.model?.trim();
  return legacyModel
    ? [
        {
          id: "primary",
          name: "主模型",
          model: legacyModel,
          role: "primary",
          enabled: true,
        },
      ]
    : [];
}

export function aiProfileModelLabel(profile: Pick<AiProfile, "models" | "model">): string {
  return effectiveAiModels(profile)[0]?.model.trim() || "未配置模型";
}

export function ensurePrimaryAiModel(models: AiModelConfig[]): AiModelConfig[] {
  if (models.some((model) => model.enabled && model.model.trim() && model.role === "primary")) {
    return models;
  }
  const nextPrimary = models.findIndex((model) => model.enabled && model.model.trim());
  if (nextPrimary < 0) return models;
  return models.map((model, index) =>
    index === nextPrimary ? { ...model, role: "primary" } : model,
  );
}

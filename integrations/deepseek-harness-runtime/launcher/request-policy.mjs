function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function configuredLimits(config, modelId) {
  const catalog = Array.isArray(config?.models) ? config.models : [];
  const model = catalog.map(objectOrNull).find((candidate) => candidate?.id === modelId);
  return {
    contextWindow:
      positiveInteger(model?.contextWindow) ?? positiveInteger(config?.defaultContextWindow),
    maxTokens: positiveInteger(model?.maxTokens) ?? positiveInteger(config?.maxTokens),
  };
}

export function applyChatCompletionsRequestPolicy(init, config) {
  const body = init?.body;
  if (typeof body !== "string") return { init, policy: { maxTokens: "unavailable" } };
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { init, policy: { maxTokens: "unavailable" } };
  }
  const request = objectOrNull(parsed);
  if (!request) return { init, policy: { maxTokens: "unavailable" } };
  const limits = configuredLimits(objectOrNull(config), request.model);
  const policy = {
    maxTokens: limits.maxTokens === null ? "provider_default" : "explicit",
    configuredContextWindow: limits.contextWindow,
    configuredMaxTokens: limits.maxTokens,
  };
  if (limits.maxTokens !== null || !Object.hasOwn(request, "max_tokens")) {
    return { init, policy };
  }
  const removedInheritedMaxTokens = request.max_tokens;
  delete request.max_tokens;
  return {
    init: { ...init, body: JSON.stringify(request) },
    policy: { ...policy, removedInheritedMaxTokens },
  };
}

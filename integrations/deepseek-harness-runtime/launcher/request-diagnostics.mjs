const KNOWN_REQUEST_FIELDS = new Set([
  "model",
  "messages",
  "stream",
  "stream_options",
  "thinking",
  "reasoning_effort",
  "tools",
  "temperature",
  "max_tokens",
  "stop",
]);

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function contentSummary(content) {
  if (typeof content === "string") return { type: "string", chars: content.length };
  if (!Array.isArray(content)) return { type: content === null ? "null" : typeof content };
  return {
    type: "array",
    parts: content.length,
    partTypes: [
      ...new Set(
        content.map((part) => {
          const value = objectOrNull(part);
          return typeof value?.type === "string" ? value.type : typeof part;
        }),
      ),
    ].sort(),
  };
}

function messageSummary(message, index) {
  const value = objectOrNull(message);
  if (!value) return { index, type: typeof message };
  return {
    index,
    role: value.role,
    content: contentSummary(value.content),
    toolCalls: Array.isArray(value.tool_calls) ? value.tool_calls.length : 0,
    hasReasoningContent:
      typeof value.reasoning_content === "string" && value.reasoning_content.length > 0,
    hasToolCallId: typeof value.tool_call_id === "string" && value.tool_call_id.length > 0,
    hasName: typeof value.name === "string" && value.name.length > 0,
  };
}

function toolSummary(tool, index) {
  const value = objectOrNull(tool);
  const definition = objectOrNull(value?.function);
  const parameters = objectOrNull(definition?.parameters);
  const properties = objectOrNull(parameters?.properties);
  return {
    index,
    type: value?.type,
    name: definition?.name,
    descriptionChars:
      typeof definition?.description === "string" ? definition.description.length : 0,
    parameterKeys: parameters ? Object.keys(parameters).sort() : [],
    schemaType: parameters?.type,
    properties: properties ? Object.keys(properties).length : 0,
    required: Array.isArray(parameters?.required) ? parameters.required.length : 0,
  };
}

export function summarizeChatCompletionsRequest(init) {
  const body = init?.body;
  if (typeof body !== "string") {
    return { bodyType: body === null ? "null" : typeof body };
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return {
      bodyType: "string",
      requestBytes: Buffer.byteLength(body),
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
  const request = objectOrNull(parsed);
  if (!request) return { bodyType: Array.isArray(parsed) ? "array" : typeof parsed };
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const tools = Array.isArray(request.tools) ? request.tools : [];
  const topLevelKeys = Object.keys(request).sort();
  return {
    requestBytes: Buffer.byteLength(body),
    topLevelKeys,
    extensionKeys: topLevelKeys.filter((key) => !KNOWN_REQUEST_FIELDS.has(key)),
    model: request.model,
    stream: request.stream,
    streamOptions: request.stream_options,
    thinking: request.thinking,
    reasoningEffort: request.reasoning_effort,
    temperature: request.temperature,
    maxTokens: request.max_tokens,
    stopType: Array.isArray(request.stop) ? "array" : typeof request.stop,
    messages: messages.map(messageSummary),
    tools: {
      count: tools.length,
      definitions: tools.map(toolSummary),
    },
  };
}

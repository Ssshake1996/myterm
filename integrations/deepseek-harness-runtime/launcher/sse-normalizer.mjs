import { createParser } from "eventsource-parser";
import { LlmError } from "@deepseek-ai/dsh-llm";

const COMPLETE_DONE_EVENT = /(?:^|\r?\n)data:[^\S\r\n]*\[DONE\][^\S\r\n]*(?:\r?\n){2}/u;
const INCOMPLETE_DONE_EVENT =
  /(?:^|\r?\n)data:[^\S\r\n]*\[DONE\][^\S\r\n]*(\r\n|\n|\r)?(?![\s\S])/u;
const DONE_TOKEN = "[DONE]";
const TAIL_LIMIT = 4096;
const PREVIEW_LIMIT = 1024;
const MAX_SSE_BUFFER_CHARS = 4 * 1024 * 1024;

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function rememberKeys(target, value) {
  if (!value) return;
  for (const key of Object.keys(value)) target.add(key);
}

function preview(value) {
  return value.length <= PREVIEW_LIMIT ? value : `${value.slice(0, PREVIEW_LIMIT)}…`;
}

function providerError(root) {
  if (!root) return null;
  const nested = objectOrNull(root.error);
  const code = root.error_code ?? nested?.error_code ?? nested?.code;
  const message = root.error_msg ?? nested?.error_msg ?? nested?.message;
  if (code === undefined && message === undefined) return null;
  return {
    code: code === undefined ? null : String(code),
    message: message === undefined ? null : String(message),
    text: typeof root.text === "string" ? root.text : null,
  };
}

function repairForTail(tail) {
  const incomplete = INCOMPLETE_DONE_EVENT.exec(tail);
  if (!incomplete) return { reason: "missing_done_event", suffix: "\n\ndata: [DONE]\n\n" };
  const lineEnding = incomplete[1];
  return {
    reason: "incomplete_done_event",
    suffix: lineEnding === "\r\n" ? "\r\n" : lineEnding === "\n" ? "\n" : "\n\n",
  };
}

function ensureCompleteTerminator(body, onRepair) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let tail = "";
  let completeDoneSeen = false;
  const observe = (text) => {
    tail = `${tail}${text}`.slice(-TAIL_LIMIT);
    if (COMPLETE_DONE_EVENT.test(tail)) completeDoneSeen = true;
  };
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        observe(decoder.decode(chunk, { stream: true }));
        controller.enqueue(chunk);
      },
      flush(controller) {
        observe(decoder.decode());
        if (completeDoneSeen) return;
        const repair = repairForTail(tail);
        controller.enqueue(encoder.encode(repair.suffix));
        onRepair(repair.reason);
      },
    }),
  );
}

function normalizePayload(data, state) {
  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    state.malformedEvents += 1;
    return data;
  }

  state.dataEvents += 1;
  state.firstEventPreview ??= preview(data);
  state.lastEventPreview = preview(data);
  const root = objectOrNull(payload);
  rememberKeys(state.topLevelKeys, root);
  state.providerError ??= providerError(root);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  state.choices += choices.length;
  let changed = false;

  for (const choiceValue of choices) {
    const choice = objectOrNull(choiceValue);
    rememberKeys(state.choiceKeys, choice);
    if (!choice) continue;

    let delta = objectOrNull(choice.delta);
    const message = objectOrNull(choice.message);
    rememberKeys(state.messageKeys, message);
    if (!delta && message) {
      delta = { ...message };
      choice.delta = delta;
      state.compatibility.messageToDelta += 1;
      changed = true;
    }
    rememberKeys(state.deltaKeys, delta);
    if (!delta) continue;

    if (
      typeof delta.reasoning === "string" &&
      delta.reasoning.length > 0 &&
      !(typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0)
    ) {
      delta.reasoning_content = delta.reasoning;
      state.compatibility.reasoningAlias += 1;
      state.deltaKeys.add("reasoning_content");
      changed = true;
    }

    if (typeof delta.content === "string") state.contentChars += delta.content.length;
    if (typeof delta.reasoning_content === "string") {
      state.reasoningChars += delta.reasoning_content.length;
    }
    if (Array.isArray(delta.tool_calls)) state.toolCalls += delta.tool_calls.length;
  }

  return changed ? JSON.stringify(payload) : data;
}

function diagnostics(state) {
  return {
    terminationRepair: state.terminationRepair,
    compatibility: state.compatibility,
    dataEvents: state.dataEvents,
    malformedEvents: state.malformedEvents,
    choices: state.choices,
    contentChars: state.contentChars,
    reasoningChars: state.reasoningChars,
    toolCalls: state.toolCalls,
    topLevelKeys: [...state.topLevelKeys].sort(),
    choiceKeys: [...state.choiceKeys].sort(),
    deltaKeys: [...state.deltaKeys].sort(),
    messageKeys: [...state.messageKeys].sort(),
    firstEventPreview: state.firstEventPreview,
    lastEventPreview: state.lastEventPreview,
    providerError: state.providerError,
    empty:
      state.contentChars === 0 && state.reasoningChars === 0 && state.toolCalls === 0,
  };
}

export function normalizeChatCompletionsSse(body, onFinalize) {
  const state = {
    terminationRepair: null,
    compatibility: { reasoningAlias: 0, messageToDelta: 0 },
    dataEvents: 0,
    malformedEvents: 0,
    choices: 0,
    contentChars: 0,
    reasoningChars: 0,
    toolCalls: 0,
    topLevelKeys: new Set(),
    choiceKeys: new Set(),
    deltaKeys: new Set(),
    messageKeys: new Set(),
    firstEventPreview: null,
    lastEventPreview: null,
    providerError: null,
  };
  const complete = ensureCompleteTerminator(body, (reason) => {
    state.terminationRepair = reason;
  });
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let parser;
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    onFinalize?.(diagnostics(state));
  };

  return complete.pipeThrough(
    new TransformStream({
      start(controller) {
        parser = createParser({
          maxBufferSize: MAX_SSE_BUFFER_CHARS,
          onEvent(event) {
            const prefix = [
              event.id === undefined ? null : `id: ${event.id}`,
              event.event === undefined ? null : `event: ${event.event}`,
            ]
              .filter(Boolean)
              .join("\n");
            const data =
              event.data === DONE_TOKEN ? DONE_TOKEN : normalizePayload(event.data, state);
            if (state.providerError) {
              finalize();
              const code = state.providerError.code ?? "unknown";
              const message = state.providerError.message ?? "provider returned an error event";
              throw new LlmError(`Provider stream error [${code}]: ${message}`, code);
            }
            controller.enqueue(
              encoder.encode(`${prefix}${prefix ? "\n" : ""}data: ${data}\n\n`),
            );
          },
          onComment(comment) {
            controller.enqueue(encoder.encode(`:${comment}\n\n`));
          },
          onRetry(retry) {
            controller.enqueue(encoder.encode(`retry: ${retry}\n\n`));
          },
          onError(error) {
            throw error;
          },
        });
      },
      transform(chunk) {
        parser.feed(decoder.decode(chunk, { stream: true }));
      },
      flush() {
        parser.feed(decoder.decode());
        parser.reset({ consume: true });
        finalize();
      },
    }),
  );
}

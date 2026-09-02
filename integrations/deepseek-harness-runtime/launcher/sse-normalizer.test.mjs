import assert from "node:assert/strict";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { normalizeChatCompletionsSse } from "./sse-normalizer.mjs";

const encoder = new TextEncoder();

function chunkedBody(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function normalizeAndParse(chunks) {
  let diagnostic;
  const events = [];
  const normalized = normalizeChatCompletionsSse(chunkedBody(chunks), (value) => {
    diagnostic = value;
  });
  const parsed = normalized
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());
  for await (const event of parsed) events.push(event.data);
  return { events, diagnostic };
}

const splitDone = await normalizeAndParse([
  'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DO',
  "NE]\n\n",
]);
assert.deepEqual(splitDone.events, [
  '{"choices":[{"delta":{"content":"ok"}}]}',
  "[DONE]",
]);
assert.equal(splitDone.diagnostic.terminationRepair, null);
assert.equal(splitDone.diagnostic.contentChars, 2);
assert.equal(splitDone.diagnostic.empty, false);

const crlf = await normalizeAndParse([
  'data: {"choices":[{"delta":{"content":"ok"}}]}\r\n\r\ndata: [DONE]\r\n\r\n',
]);
assert.deepEqual(crlf.events, [
  '{"choices":[{"delta":{"content":"ok"}}]}',
  "[DONE]",
]);
assert.equal(crlf.diagnostic.terminationRepair, null);

for (const incompleteDone of ["data: [DONE]", "data: [DONE]\n", "data: [DONE]\r\n"]) {
  const result = await normalizeAndParse([
    `data: {"choices":[{"delta":{"content":"ok"}}]}\n\n${incompleteDone}`,
  ]);
  assert.equal(result.events.filter((event) => event === "[DONE]").length, 1);
  assert.equal(result.diagnostic.terminationRepair, "incomplete_done_event");
}

const contentDone = await normalizeAndParse([
  'data: {"choices":[{"delta":{"content":"[DONE]"}}]}\n\n',
]);
assert.deepEqual(contentDone.events, [
  '{"choices":[{"delta":{"content":"[DONE]"}}]}',
  "[DONE]",
]);
assert.equal(contentDone.diagnostic.terminationRepair, "missing_done_event");

const reasoningAlias = await normalizeAndParse([
  'data: {"choices":[{"delta":{"reasoning":"inspect host"}}]}\n\ndata: [DONE]',
]);
assert.deepEqual(JSON.parse(reasoningAlias.events[0]).choices[0].delta, {
  reasoning: "inspect host",
  reasoning_content: "inspect host",
});
assert.equal(reasoningAlias.diagnostic.compatibility.reasoningAlias, 1);
assert.equal(reasoningAlias.diagnostic.reasoningChars, 12);
assert.equal(reasoningAlias.diagnostic.empty, false);

const finalMessage = await normalizeAndParse([
  'data: {"choices":[{"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
]);
assert.equal(JSON.parse(finalMessage.events[0]).choices[0].delta.content, "hello");
assert.equal(finalMessage.diagnostic.compatibility.messageToDelta, 1);
assert.deepEqual(finalMessage.diagnostic.messageKeys, ["content", "role"]);

const empty = await normalizeAndParse(['data: {"choices":[]}\n\n']);
assert.deepEqual(empty.events, ['{"choices":[]}', "[DONE]"]);
assert.equal(empty.diagnostic.terminationRepair, "missing_done_event");
assert.equal(empty.diagnostic.empty, true);
assert.deepEqual(empty.diagnostic.topLevelKeys, ["choices"]);

process.stdout.write(JSON.stringify({ ok: true, scenarios: 9 }));

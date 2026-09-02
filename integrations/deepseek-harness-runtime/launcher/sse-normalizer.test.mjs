import assert from "node:assert/strict";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { normalizeSseTermination } from "./sse-normalizer.mjs";

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
  const repairs = [];
  const events = [];
  const normalized = normalizeSseTermination(chunkedBody(chunks), (reason) => repairs.push(reason));
  const parsed = normalized
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());
  for await (const event of parsed) events.push(event.data);
  return { events, repairs };
}

assert.deepEqual(await normalizeAndParse(["data: {\"choices\":[]}\n\ndata: [DO", "NE]\n\n"]), {
  events: ['{"choices":[]}', "[DONE]"],
  repairs: [],
});
assert.deepEqual(await normalizeAndParse(["data: {\"choices\":[]}\r\n\r\ndata: [DONE]\r\n\r\n"]), {
  events: ['{"choices":[]}', "[DONE]"],
  repairs: [],
});
assert.deepEqual(await normalizeAndParse(["data: {\"choices\":[]}\n\ndata: [DONE]"]), {
  events: ['{"choices":[]}', "[DONE]"],
  repairs: ["incomplete_done_event"],
});
assert.deepEqual(await normalizeAndParse(["data: {\"choices\":[]}\n\ndata: [DONE]\n"]), {
  events: ['{"choices":[]}', "[DONE]"],
  repairs: ["incomplete_done_event"],
});
assert.deepEqual(await normalizeAndParse(["data: {\"choices\":[{\"delta\":{\"content\":\"[DONE]\"}}]}\n\n"]), {
  events: ['{"choices":[{"delta":{"content":"[DONE]"}}]}', "[DONE]"],
  repairs: ["incomplete_done_event"],
});
assert.deepEqual(await normalizeAndParse(["data: {\"choices\":[]}\n\n"]), {
  events: ['{"choices":[]}', "[DONE]"],
  repairs: ["missing_done_event"],
});

process.stdout.write(JSON.stringify({ ok: true, scenarios: 6 }));

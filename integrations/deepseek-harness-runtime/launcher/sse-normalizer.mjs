const COMPLETE_DONE_EVENT = /(?:^|\r?\n)data:[^\S\r\n]*\[DONE\][^\S\r\n]*(?:\r?\n){2}/u;
const INCOMPLETE_DONE_EVENT =
  /(?:^|\r?\n)data:[^\S\r\n]*\[DONE\][^\S\r\n]*(\r\n|\n|\r)?(?![\s\S])/u;
const DONE_TOKEN = "[DONE]";
const TAIL_LIMIT = 2048;

function repairForTail(tail) {
  const incomplete = INCOMPLETE_DONE_EVENT.exec(tail);
  if (!incomplete) {
    return {
      reason: tail.includes(DONE_TOKEN) ? "incomplete_done_event" : "missing_done_event",
      suffix: "\n\ndata: [DONE]\n\n",
    };
  }
  const lineEnding = incomplete[1];
  return {
    reason: "incomplete_done_event",
    suffix: lineEnding === "\r\n" ? "\r\n" : lineEnding === "\n" ? "\n" : "\n\n",
  };
}

export function normalizeSseTermination(body, onRepair) {
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
        onRepair?.(repair.reason);
      },
    }),
  );
}

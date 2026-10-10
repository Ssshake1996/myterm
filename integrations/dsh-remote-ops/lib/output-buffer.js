import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { MAX_SCROLLBACK_BYTES, RETAINED_SCROLLBACK_BYTES, UI_SCROLLBACK_CHARS } from "./constants.js";

export class TerminalOutputBuffer {
  constructor(maxBytes = MAX_SCROLLBACK_BYTES, retainedBytes = RETAINED_SCROLLBACK_BYTES) {
    this.maxBytes = maxBytes;
    this.retainedBytes = Math.min(retainedBytes, maxBytes);
    this.value = "";
    this.byteLength = 0;
    this.startOffset = 0;
    this.revision = 0;
    this.streamId = randomUUID();
    this.waiters = new Set();
  }

  get length() { return this.value.length; }
  get endOffset() { return this.startOffset + this.value.length; }
  slice(start, end) { return this.value.slice(start, end); }

  append(value) {
    const text = String(value ?? "");
    if (!text) return;
    this.value += text;
    this.byteLength += Buffer.byteLength(text, "utf8");
    this.revision += 1;
    if (this.byteLength > this.maxBytes) {
      const encoded = Buffer.from(this.value, "utf8");
      let byteStart = Math.max(0, encoded.length - this.retainedBytes);
      while (byteStart < encoded.length && (encoded[byteStart] & 0xc0) === 0x80) byteStart += 1;
      const retained = encoded.subarray(byteStart).toString("utf8");
      this.startOffset += this.value.length - retained.length;
      this.value = retained;
      this.byteLength = Buffer.byteLength(retained, "utf8");
    }
    this.notify();
  }

  tail(maxChars = UI_SCROLLBACK_CHARS) {
    return this.value.slice(Math.max(0, this.value.length - maxChars));
  }

  readFrom(offset, maxChars = UI_SCROLLBACK_CHARS) {
    const endOffset = this.endOffset;
    const limit = Math.max(2, Math.min(UI_SCROLLBACK_CHARS, Math.floor(maxChars) || UI_SCROLLBACK_CHARS));
    const validOffset = Number.isSafeInteger(offset) && offset >= this.startOffset && offset <= endOffset;
    let startOffset = validOffset ? offset : Math.max(this.startOffset, endOffset - limit);
    const isLowSurrogate = (at) => { const code = this.value.charCodeAt(at - this.startOffset); return code >= 0xdc00 && code <= 0xdfff; };
    if (isLowSurrogate(startOffset)) startOffset += 1;
    let nextOffset = Math.min(endOffset, startOffset + limit);
    if (nextOffset < endOffset && isLowSurrogate(nextOffset)) nextOffset -= 1;
    return {
      text: this.value.slice(startOffset - this.startOffset, nextOffset - this.startOffset),
      startOffset,
      nextOffset,
      endOffset,
      streamId: this.streamId,
      hasMore: nextOffset < endOffset,
      truncated: !validOffset && (offset !== undefined || startOffset > 0),
      reset: !validOffset,
      revision: this.revision,
    };
  }

  notify() {
    for (const finish of this.waiters) finish();
    this.waiters.clear();
  }

  waitForChange(offset, timeoutMs = 20_000, signal) {
    if (!Number.isSafeInteger(offset) || offset !== this.endOffset || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        this.waiters.delete(finish);
        resolve();
      };
      timer = setTimeout(finish, timeoutMs);
      signal?.addEventListener("abort", finish, { once: true });
      this.waiters.add(finish);
    });
  }
}

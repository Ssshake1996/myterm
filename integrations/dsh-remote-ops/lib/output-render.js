import { incompleteEscapeStart, stripAnsiMapped } from "./ansi.js";

const MIN_OMITTED_CHARS = 200;
const ESCAPE_EXTENSION_CHARS = 256;
const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;
const countLines = (text) => { let lines = 0; for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) lines += 1; return lines; };

// Reads one raw page. When the caller will strip ANSI, a page that ends inside an escape sequence is
// extended forward to the end of that sequence, so no page ever starts or ends with half a sequence
// (pulling the cursor back instead would stall when a sequence begins a very small page).
export function readPage(buffer, offset, maxChars, { stripAnsi = false } = {}) {
  let limit = maxChars;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const frame = buffer.readFrom(offset, limit);
    if (!stripAnsi || frame.nextOffset >= frame.endOffset || incompleteEscapeStart(frame.text) < 0) return frame;
    limit = frame.text.length + ESCAPE_EXTENSION_CHARS;
  }
  return buffer.readFrom(offset, limit);
}

// Renders one raw page for a model. Offsets and cursors always refer to the raw stream: stripping ANSI
// never renumbers them. A sequence cut off at the very end of the stream is dropped.
// frame: { text, startOffset?, nextOffset?, endOffset?, streamId? } (offsets are absent for line history)
export function renderOutput(frame, { stripAnsi = false, headTailChars = 0 } = {}) {
  const raw = String(frame.text ?? "");
  const hasOffsets = Number.isSafeInteger(frame.startOffset) && Number.isSafeInteger(frame.nextOffset) && Number.isSafeInteger(frame.endOffset);
  const stripped = stripAnsi ? stripAnsiMapped(raw) : undefined;
  let text = stripped ? stripped.text : raw;
  if (stripped) {
    const partial = incompleteEscapeStart(text);
    if (partial >= 0) text = text.slice(0, partial);
  }
  const rawIndex = stripped ? stripped.rawIndex : (index) => index;
  const result = {
    text,
    ...(hasOffsets ? { nextOffset: frame.nextOffset, hasMore: frame.nextOffset < frame.endOffset } : {}),
    ...(stripAnsi ? { ansiStripped: true } : {}),
  };
  if (!headTailChars || text.length - headTailChars * 2 < MIN_OMITTED_CHARS) return result;

  let headEnd = headTailChars;
  const headBreak = text.lastIndexOf("\n", headEnd - 1);
  if (headBreak >= headTailChars / 2) headEnd = headBreak + 1;
  if (isHighSurrogate(text.charCodeAt(headEnd - 1))) headEnd -= 1;
  let tailStart = text.length - headTailChars;
  const tailBreak = text.indexOf("\n", tailStart);
  if (tailBreak >= 0 && tailBreak + 1 - tailStart <= headTailChars / 2 && tailBreak + 1 < text.length) tailStart = tailBreak + 1;
  if (isLowSurrogate(text.charCodeAt(tailStart))) tailStart += 1;
  if (tailStart - headEnd < MIN_OMITTED_CHARS) return result;

  const omittedText = text.slice(headEnd, tailStart);
  const omitted = { chars: omittedText.length, lines: countLines(omittedText) };
  let marker;
  if (hasOffsets) {
    omitted.startOffset = frame.startOffset + rawIndex(headEnd);
    omitted.endOffset = frame.startOffset + rawIndex(tailStart);
    marker = `\n[... ${omitted.lines} lines / ${omitted.chars} chars omitted; raw offsets ${omitted.startOffset}-${omitted.endOffset}: read them with remote_terminal_read cursor=${omitted.startOffset} streamId=${frame.streamId ?? "<streamId>"} ...]\n`;
  } else {
    marker = `\n[... ${omitted.lines} lines / ${omitted.chars} chars omitted; browse them with offset/count ...]\n`;
  }
  return { ...result, text: `${text.slice(0, headEnd)}${marker}${text.slice(tailStart)}`, summarized: true, omitted };
}

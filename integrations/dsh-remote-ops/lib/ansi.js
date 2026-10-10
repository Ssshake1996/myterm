// CSI, OSC (BEL or ST terminated), charset selection, other two-byte escapes.
const SEQUENCE = "(?:\\u001b\\[[0-9;?<=>]*[ -/]*[@-~]|\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)|\\u001b[()*+][A-Za-z0-9]|\\u001b[@-Z\\\\^_]|\\u001b[=>78c])";
const SEQUENCE_ANYWHERE = new RegExp(SEQUENCE, "g");
const SEQUENCE_AT_START = new RegExp(`^${SEQUENCE}`);
const MAX_SEQUENCE_CHARS = 256;

export function stripAnsi(text) {
  return String(text ?? "").replace(SEQUENCE_ANYWHERE, "");
}

// Strips sequences and remembers where each kept run came from so a position in the
// stripped text can be mapped back to the raw stream offset it was read from.
export function stripAnsiMapped(text) {
  const source = String(text ?? "");
  const segments = [];
  let output = "";
  let last = 0;
  const keep = (from, to) => {
    if (to <= from) return;
    segments.push({ outputStart: output.length, rawStart: from });
    output += source.slice(from, to);
  };
  for (const match of source.matchAll(SEQUENCE_ANYWHERE)) {
    keep(last, match.index);
    last = match.index + match[0].length;
  }
  keep(last, source.length);
  const rawIndex = (outputIndex) => {
    if (!segments.length) return outputIndex >= output.length ? source.length : 0;
    if (outputIndex >= output.length) return source.length;
    let low = 0, high = segments.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (segments[middle].outputStart <= outputIndex) low = middle; else high = middle - 1;
    }
    return segments[low].rawStart + (outputIndex - segments[low].outputStart);
  };
  return { text: output, rawIndex };
}

// Index of a trailing escape sequence that is cut off at the end of the text, or -1.
export function incompleteEscapeStart(text) {
  const value = String(text ?? "");
  const index = value.lastIndexOf("\u001b");
  if (index < 0 || value.length - index > MAX_SEQUENCE_CHARS) return -1;
  return SEQUENCE_AT_START.test(value.slice(index)) ? -1 : index;
}

import { incompleteEscapeStart, stripAnsiMapped } from "./ansi.js";

// Only mark text actually returned by the terminal. Raw keys and hidden prompt
// answers are never added to the output or exposed as command annotations.
export function expectAgentEcho(buffer, text, submit) {
  buffer.pendingEcho = undefined;
  const value = String(text ?? "");
  if (!submit || !value || value.length > 4096 || /[\x00-\x1f\x7f]/u.test(value)) return;
  buffer.pendingEcho = { text: value, offset: buffer.endOffset, expires: Date.now() + 5000 };
}

export function observeAgentEcho(buffer) {
  buffer.commandAnnotations = (buffer.commandAnnotations ?? []).filter(item => item.endOffset > buffer.startOffset).slice(-200);
  const pending = buffer.pendingEcho;
  if (!pending) return;
  if (pending.expires < Date.now() || pending.offset < buffer.startOffset || buffer.endOffset - pending.offset > 16384) { buffer.pendingEcho = undefined; return; }
  const raw = buffer.value.slice(pending.offset - buffer.startOffset);
  const incomplete = incompleteEscapeStart(raw);
  const mapped = stripAnsiMapped(incomplete < 0 ? raw : raw.slice(0, incomplete));
  const skipped = mapped.text.match(/^\r*/u)[0].length;
  const visible = mapped.text.slice(skipped);
  if (pending.text.startsWith(visible)) return;
  if (visible.startsWith(pending.text) && /^[\r\n]/u.test(visible.slice(pending.text.length))) {
    buffer.commandAnnotations.push({ kind: "agent-command", startOffset: pending.offset + mapped.rawIndex(skipped), endOffset: pending.offset + mapped.rawIndex(skipped + pending.text.length - 1) + 1 });
  }
  buffer.pendingEcho = undefined;
}

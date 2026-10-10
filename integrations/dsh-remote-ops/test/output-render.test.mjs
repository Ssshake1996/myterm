import test from "node:test";
import assert from "node:assert/strict";
import { TerminalOutputBuffer } from "../lib/output-buffer.js";
import { incompleteEscapeStart, stripAnsi, stripAnsiMapped } from "../lib/ansi.js";
import { readPage, renderOutput } from "../lib/output-render.js";

const frameOf = (raw, startAt = 0) => {
  const buffer = new TerminalOutputBuffer();
  buffer.append(raw);
  return buffer.readFrom(startAt);
};

test("stripAnsi removes CSI, OSC, charset and cursor sequences but keeps text and newlines", () => {
  assert.equal(stripAnsi("\u001b[1;31mred\u001b[0m plain"), "red plain");
  assert.equal(stripAnsi("\u001b]0;title\u0007prompt$ \u001b]8;;http://x\u001b\\link"), "prompt$ link");
  assert.equal(stripAnsi("\u001b(Bline1\r\nline2\u001b[?25h\u001b[2K\u001b7\u001b8\u001b="), "line1\r\nline2");
  assert.equal(stripAnsi("无色\u001b[32m绿\u001b[m"), "无色绿");
  assert.equal(stripAnsi(undefined), "");
});

test("mapped stripping maps positions in the stripped text back to raw positions", () => {
  const raw = "ab\u001b[31mcd\u001b[0mef";
  const mapped = stripAnsiMapped(raw);
  assert.equal(mapped.text, "abcdef");
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(mapped.rawIndex), [0, 1, 7, 8, 13, 14]);
  assert.equal(mapped.rawIndex(6), raw.length);
  assert.equal(raw.length, 15);
});

test("incompleteEscapeStart only reports a sequence that is cut off at the end", () => {
  assert.equal(incompleteEscapeStart("abc"), -1);
  assert.equal(incompleteEscapeStart("abc\u001b[31m"), -1);
  assert.equal(incompleteEscapeStart("abc\u001b[31mmore"), -1);
  assert.equal(incompleteEscapeStart("abc\u001b"), 3);
  assert.equal(incompleteEscapeStart("abc\u001b[3"), 3);
  assert.equal(incompleteEscapeStart("abc\u001b]0;title"), 3);
});

test("rendering without options leaves the page untouched", () => {
  const frame = frameOf("plain \u001b[31mcolor\u001b[0m");
  const rendered = renderOutput(frame, {});
  assert.equal(rendered.text, frame.text);
  assert.equal(rendered.nextOffset, frame.nextOffset);
  assert.equal(rendered.hasMore, false);
  assert.equal(Object.hasOwn(rendered, "ansiStripped"), false);
});

test("stripAnsi paging never leaks half an escape sequence and always makes progress", () => {
  const raw = `${"x".repeat(9)}\u001b[1;31m${"red".repeat(4)}\u001b[0m\u001b]0;a long window title\u0007${"y".repeat(7)}\u001b[2K\u001b[10;20Hend`;
  const buffer = new TerminalOutputBuffer();
  buffer.append(raw);
  for (const pageSize of [2, 3, 5, 8, 13, 21]) {
    let cursor = 0, collected = "", pages = 0;
    do {
      const page = readPage(buffer, cursor, pageSize, { stripAnsi: true });
      const rendered = renderOutput(page, { stripAnsi: true });
      assert.ok(rendered.nextOffset >= cursor, "cursor must never move backwards");
      assert.ok(rendered.nextOffset > cursor || rendered.nextOffset === buffer.endOffset, `page size ${pageSize} must not stall at ${cursor}`);
      collected += rendered.text;
      cursor = rendered.nextOffset;
      pages += 1;
      assert.ok(pages < 400, "paging must terminate");
    } while (cursor < buffer.endOffset);
    assert.equal(collected, stripAnsi(raw), `page size ${pageSize}`);
  }
});

test("a trailing partial sequence at the true end of the stream is dropped and the cursor reaches the end", () => {
  const frame = frameOf("done\u001b[3");
  const rendered = renderOutput(frame, { stripAnsi: true });
  assert.equal(rendered.text, "done");
  assert.equal(rendered.nextOffset, frame.endOffset);
  assert.equal(rendered.hasMore, false);
});

test("head and tail summary reports the omitted raw range and the range can be read back", () => {
  const lines = Array.from({ length: 200 }, (_, index) => `line ${String(index).padStart(3, "0")} ${"-".repeat(20)}`);
  const raw = `${lines.join("\r\n")}\r\n`;
  const buffer = new TerminalOutputBuffer();
  buffer.append("earlier output\r\n");
  const startOffset = buffer.endOffset;
  buffer.append(raw);
  const frame = buffer.readFrom(startOffset);
  const rendered = renderOutput(frame, { headTailChars: 300 });
  assert.equal(rendered.summarized, true);
  assert.ok(rendered.text.startsWith("line 000"));
  assert.ok(rendered.text.endsWith("line 199 --------------------\r\n"));
  assert.match(rendered.text, /\[\.\.\. \d+ lines \/ \d+ chars omitted; raw offsets \d+-\d+: read them with remote_terminal_read cursor=\d+ streamId=/);
  assert.ok(rendered.text.length < 1000);
  assert.equal(rendered.nextOffset, frame.nextOffset);
  const omittedRaw = buffer.readFrom(rendered.omitted.startOffset, rendered.omitted.endOffset - rendered.omitted.startOffset).text;
  assert.equal(omittedRaw.length, rendered.omitted.chars);
  assert.equal(omittedRaw.split("\n").length - 1, rendered.omitted.lines);
  const headEnd = rendered.text.indexOf("\n[... ");
  assert.equal(frame.text.startsWith(rendered.text.slice(0, headEnd)), true);
  assert.equal(frame.text.endsWith(rendered.text.slice(rendered.text.indexOf("]\n", headEnd) + 2)), true);
  assert.equal(frame.text.indexOf(omittedRaw), rendered.text.slice(0, headEnd).length);
});

test("summary combined with ANSI stripping maps the omitted range to the raw stream", () => {
  const raw = Array.from({ length: 120 }, (_, index) => `\u001b[3${index % 7}mrow ${index}\u001b[0m ${"=".repeat(24)}\r\n`).join("");
  const frame = frameOf(raw);
  const rendered = renderOutput(frame, { stripAnsi: true, headTailChars: 250 });
  assert.equal(rendered.summarized, true);
  assert.equal(rendered.ansiStripped, true);
  assert.equal(rendered.text.includes("\u001b"), false);
  const omittedRaw = raw.slice(rendered.omitted.startOffset, rendered.omitted.endOffset);
  assert.equal(stripAnsi(omittedRaw).length, rendered.omitted.chars);
});

test("output shorter than the head and tail budget is returned whole", () => {
  const frame = frameOf("short output\r\nsecond line\r\n");
  const rendered = renderOutput(frame, { headTailChars: 200 });
  assert.equal(rendered.text, frame.text);
  assert.equal(Object.hasOwn(rendered, "summarized"), false);
  const slightlyOver = frameOf("z".repeat(450));
  assert.equal(Object.hasOwn(renderOutput(slightlyOver, { headTailChars: 200 }), "summarized"), false, "omitting less than the marker costs is not worth it");
});

test("summary never splits a surrogate pair", () => {
  const raw = "😀".repeat(400);
  const frame = frameOf(raw);
  for (const budget of [201, 250, 299]) {
    const rendered = renderOutput(frame, { headTailChars: budget });
    assert.equal(rendered.summarized, true);
    assert.equal(rendered.text.isWellFormed(), true, `budget ${budget}`);
    assert.equal(raw.isWellFormed(), true);
  }
});

test("line history frames are summarized without offsets", () => {
  const text = Array.from({ length: 300 }, (_, index) => `history ${index}`).join("\n");
  const rendered = renderOutput({ text }, { headTailChars: 400 });
  assert.equal(rendered.summarized, true);
  assert.equal(Object.hasOwn(rendered, "nextOffset"), false);
  assert.match(rendered.text, /omitted; browse them with offset\/count/);
  assert.equal(Object.hasOwn(rendered.omitted, "startOffset"), false);
});

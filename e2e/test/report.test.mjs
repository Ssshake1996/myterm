import test from "node:test";
import assert from "node:assert/strict";
import { redact, renderHtml, renderJUnit, renderMarkdown, summarize } from "../runner/report.mjs";

const report = {
  pluginVersion: "9.9.9",
  commit: "abc",
  browser: "Chrome/1",
  layer: "仿宿主",
  startedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 10,
  results: [
    { id: "ok", title: "打开面板", status: "passed", error: "", durationMs: 4, steps: [{ name: "打开", status: "passed", durationMs: 4 }], shots: [], problems: [] },
    { id: "bad", title: "确认", status: "failed", error: "password e2e-device-pass leaked token=abc.def", durationMs: 6, steps: [{ name: "输入", status: "failed", durationMs: 6 }], shots: [{ name: "失败", file: "失败.png", dataUrl: "data:image/png;base64,aaaa" }], problems: [{ kind: "console", text: "token=abc.def" }] },
  ],
};

test("the summary and markdown put failures first and redact secrets", () => {
  assert.deepEqual(summarize(report.results), { total: 2, passed: 1, failed: 1, ok: false });
  const markdown = renderMarkdown(report);
  assert.ok(markdown.indexOf("失败 · 确认") < markdown.indexOf("通过 · 打开面板"));
  assert.equal(markdown.includes("e2e-device-pass"), false);
  assert.equal(markdown.includes("token=abc.def"), false);
  assert.match(markdown, /\[redacted\]/);
  assert.equal(redact("token=abc.def"), "[redacted]");
});

test("the html report embeds screenshots and the junit file counts failures", () => {
  const html = renderHtml(report);
  assert.match(html, /data:image\/png;base64,aaaa/);
  assert.equal(html.includes("e2e-device-pass"), false);
  const junit = renderJUnit(report);
  assert.match(junit, /failures="1"/);
  assert.match(junit, /tests="2"/);
  assert.match(junit, /<failure /);
});

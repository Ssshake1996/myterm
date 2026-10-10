import test from "node:test";
import assert from "node:assert/strict";
import { parseWebUrl, redactLaunchOutput } from "../host/url.mjs";
import { workspacePatch } from "../host/workspace-patch.mjs";

test("parseWebUrl reads the token URL printed by dsh web", () => {
  const parsed = parseWebUrl("dsh web: http://127.0.0.1:3999/?token=abc.def_~-XYZ\n");
  assert.equal(parsed.origin, "http://127.0.0.1:3999");
  assert.equal(parsed.token, "abc.def_~-XYZ");
  assert.equal(parsed.url, "http://127.0.0.1:3999/?token=abc.def_~-XYZ");
});

test("launch logs keep the origin and drop the token", () => {
  assert.equal(redactLaunchOutput("dsh web: http://127.0.0.1:9/?token=abc.def"), "dsh web: http://127.0.0.1:9/?token=[redacted]");
});

test("parseWebUrl ignores output that has no launch token", () => {
  assert.equal(parseWebUrl("listening on http://127.0.0.1:3999/\n"), null);
  assert.equal(parseWebUrl(""), null);
});

test("workspacePatch targets the workspace controller with an absolute documents directory", () => {
  const patch = workspacePatch("/tmp/dsh-docs");
  assert.match(patch, /^- id: workspace-controller\n/m);
  assert.match(patch, /documentsDirectory: "\/tmp\/dsh-docs"/);
  assert.throws(() => workspacePatch("relative"), /absolute/);
});

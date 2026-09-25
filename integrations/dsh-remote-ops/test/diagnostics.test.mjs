import test from "node:test";
import assert from "node:assert/strict";
import { describeFailure, diagnosticReport } from "../lib/diagnostics.js";

test("diagnostics retain original phase, code and cause while offering recovery", () => {
  const cause = Object.assign(new Error("All configured authentication methods failed"), { code: "AUTH_FAILED" });
  const error = Object.assign(new Error("SSH_CONNECT_FAILED: target", { cause }), { code: "SSH_CONNECT_FAILED" });
  const result = describeFailure(error, "ssh-connect");
  assert.equal(result.stage, "ssh-connect");
  assert.equal(result.code, "SSH_CONNECT_FAILED");
  assert.match(result.details, /All configured authentication methods failed/);
  assert.match(result.details, /AUTH_FAILED/);
  assert.match(result.details, /diagnostics.test.mjs/);
  assert.equal(result.recovery, "credentials");
});

test("diagnostic exports whitelist metadata and exclude all terminal and credential content", () => {
  const report = diagnosticReport({ pluginVersion: "1", harnessVersion: "2", sessions: [{ kind: "ssh", status: { kind: "running" }, password: "secret", viewport: "token=secret", sessionId: "private-owner" }], events: [{ at: "now", kind: "ssh.send", code: "AUTH_FAILED", command: "password=secret", message: "private-path", stack: "private-path" }] });
  const json = JSON.stringify(report);
  assert.doesNotMatch(json, /secret|private-owner|private-path/);
  assert.equal(report.harnessVersion, "2");
  assert.equal(report.sessions[0].state, "running");
  assert.equal(report.events[0].code, "AUTH_FAILED");
});

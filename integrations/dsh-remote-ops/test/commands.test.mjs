import test from "node:test";
import assert from "node:assert/strict";
import { Duplex, PassThrough } from "node:stream";
import { executeCommand } from "../lib/commands.js";

function localFixture(run) {
  const stdout = new PassThrough(), stderr = new PassThrough();
  let spec, finish;
  const done = new Promise(resolve => { finish = resolve; });
  return { get spec() { return spec; }, subprocess: { async spawn(value) {
    spec = value;
    setImmediate(() => run({ stdout, stderr, finish }));
    return { stdout, stderr, done, terminate() { stdout.end(); stderr.end(); finish({ exitCode: null, signal: "SIGTERM" }); } };
  } } };
}

test("independent execution returns real nonzero exit, separate UTF-8 streams and explicit context", async () => {
  const fixture = localFixture(({ stdout, stderr, finish }) => {
    const bytes = Buffer.from("中文");
    stdout.write(bytes.subarray(0, 2)); stdout.end(bytes.subarray(2));
    stderr.end("diagnostic"); finish({ exitCode: 7, signal: null });
  });
  const value = await executeCommand({ subprocess: fixture.subprocess, cwd: "/workspace", command: "example a b", platform: "linux" });
  assert.equal(value.exitCode, 7); assert.equal(value.status, "failed");
  assert.equal(value.completion, "exited"); assert.equal(value.stdout, "中文"); assert.equal(value.stderr, "diagnostic");
  assert.equal(value.inheritsTerminalState, false); assert.ok(value.durationMs >= 0);
  assert.equal(fixture.spec.cwd, "/workspace"); assert.equal(fixture.spec.stdio.stdin, "ignore");
  assert.deepEqual(fixture.spec.argv, ["/bin/sh", "-c", "example a b"]);
});

test("bounded output drains excess bytes and reports truncation without splitting UTF-8", async () => {
  const fixture = localFixture(({ stdout, stderr, finish }) => { stdout.end("你".repeat(1000)); stderr.end("e".repeat(2000)); finish({ exitCode: 0, signal: null }); });
  const value = await executeCommand({ subprocess: fixture.subprocess, command: "example", cwd: ".", maxBytes: 1024 });
  assert.ok(Buffer.byteLength(value.stdout) <= 1024); assert.equal(value.stdout.includes("\ufffd"), false);
  assert.equal(value.stdoutTruncated, true); assert.equal(value.stderrTruncated, true);
});

test("timeout is not completion or success even when termination is requested", async () => {
  const fixture = localFixture(() => {});
  const value = await executeCommand({ subprocess: fixture.subprocess, command: "example", cwd: ".", timeoutMs: 10 });
  assert.equal(value.status, "timed_out"); assert.equal(value.completion, "unknown"); assert.equal(value.exitCode, null);
});

test("SSH exec reuses the client, closes stdin, preserves shell text and never writes to PTY", async () => {
  const channel = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } }); channel.stderr = new PassThrough();
  let writtenCommand;
  const client = { exec(command, callback) {
    writtenCommand = command; callback(null, channel);
    setImmediate(() => { channel.emit("data", Buffer.from("done")); channel.stderr.emit("data", Buffer.from("warn")); channel.emit("exit", 3); channel.emit("close"); });
  } };
  const value = await executeCommand({ client, command: "printf 'a b'", cwd: null });
  assert.equal(writtenCommand, "printf 'a b'"); assert.equal(channel.writableEnded, true);
  assert.equal(value.stdout, "done"); assert.equal(value.stderr, "warn"); assert.equal(value.exitCode, 3);
  assert.equal(value.workingDirectory, null);
});

test("SSH close without an exit message remains unknown; cancellation preserves that distinction", async () => {
  const channel = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } }); channel.stderr = new PassThrough();
  const value = await executeCommand({ client: { exec(_cmd, callback) { callback(null, channel); setImmediate(() => channel.emit("close")); } }, command: "example" });
  assert.equal(value.completion, "unknown"); assert.equal(value.exitCode, null);
  const controller = new AbortController();
  const pending = executeCommand({ client: { exec() {} }, command: "example", signal: controller.signal });
  controller.abort();
  assert.equal((await pending).status, "cancelled");
});

test("launch errors preserve original code and stack", async () => {
  const error = Object.assign(new Error("spawn example ENOENT"), { code: "ENOENT" });
  await assert.rejects(executeCommand({ subprocess: { spawn() { throw error; } }, command: "example", cwd: "." }), value => value === error && value.stack.includes("ENOENT"));
});

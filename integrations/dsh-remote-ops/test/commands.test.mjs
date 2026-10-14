import test from "node:test";
import assert from "node:assert/strict";
import { Duplex, PassThrough } from "node:stream";
import { executeCommand } from "../lib/commands.js";
import { withCommands } from "../lib/state/commands.js";
import { registerWorkspaceRoutes } from "../lib/workspace-routes.js";

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

function retainedFixture(run) {
  const local = localFixture(run), events = [];
  class Base {
    constructor() { this.ready = Promise.resolve(); this.ctx = {subprocess:local.subprocess}; this.base="/workspace"; this.commands=new Map(); }
    event(...event) { events.push(event); }
  }
  const state = new (withCommands(Base))();
  state.resolveOwner = async id => ({id});
  const routes = new Map();
  registerWorkspaceRoutes({effect:fn=>fn(),agents:{get:()=>null},connection:{fetch:{register:route=>routes.set(route.path,route)}}},state);
  return {state,events,route:routes.get("/api/dsh-remote-ops/workspace"),local};
}

test("a UI command survives an aborted start request and its result is recoverable only by its owner", async () => {
  let complete;
  const f=retainedFixture(value=>{complete=value;});
  const controller=new AbortController();
  const response=await f.route.fetch(new Request("http://localhost/workspace",{method:"POST",signal:controller.signal,body:JSON.stringify({action:"command-start",sessionId:"a",session:"local-cmd",command:"example",requestId:"retained"})}));
  assert.equal(response.status,200);
  const started=await response.json();assert.equal(started.status,"running");
  controller.abort();await new Promise(setImmediate);
  assert.equal(f.state.commands.get("retained").controller.signal.aborted,false);
  assert.equal(f.state.commandJobsFor({id:"b"},"local-cmd").length,0);
  assert.throws(()=>f.state.commandJob({id:"b"},"retained"),/COMMAND_NOT_FOUND/);
  complete.stdout.end("kept result");complete.stderr.end();complete.finish({exitCode:0,signal:null});
  await f.state.commands.get("retained").done;
  const result=f.state.commandJob({id:"a"},"retained");
  assert.equal(result.status,"completed");assert.equal(result.result.stdout,"kept result");
  assert.equal(JSON.stringify(f.state.commandJobsFor({id:"a"},"local-cmd")).includes("kept result"),false,"listing metadata must not repeatedly return every command's output");
  assert.equal(f.state.commands.size,0);assert.equal(f.events.length,1);
});

test("retrying the same UI request never starts the command twice and cannot change its contents", async () => {
  let executions=0, complete;
  const f=retainedFixture(value=>{executions++;complete=value;});
  const args={command:"example a b",requestId:"same",timeoutSeconds:30};
  const first=await f.state.startCommand({id:"a"},"local-cmd",args);
  const second=await f.state.startCommand({id:"a"},"local-cmd",args);
  assert.equal(first.requestId,second.requestId);await new Promise(setImmediate);assert.equal(executions,1);
  await assert.rejects(f.state.startCommand({id:"a"},"local-cmd",{...args,command:"different"}),/COMMAND_ID_CONFLICT/);
  await assert.rejects(f.state.startCommand({id:"b"},"local-cmd",args),/COMMAND_NOT_FOUND/);
  complete.stdout.end();complete.stderr.end();complete.finish({exitCode:null,signal:null});await f.state.commands.get("same").done;
  assert.equal(f.state.commandJob({id:"a"},"same").result.completion,"unknown");
  assert.equal((await f.state.startCommand({id:"a"},"local-cmd",args)).result.completion,"unknown");
  assert.equal(executions,1,"even an unknown outcome must never be replayed");
});

test("retained command output is bounded and expired results cannot be mistaken for an active command",async()=>{
  const f=retainedFixture(({stdout,stderr,finish})=>{stdout.end("small");stderr.end();finish({exitCode:0,signal:null});});
  for(let index=0;index<36;index++){
    const id="bounded-"+index;await f.state.startCommand({id:"a"},"local-cmd",{command:"example",requestId:id});
    await f.state.commands.get(id).done;
  }
  assert.ok(f.state.commandJobsFor({id:"a"},"local-cmd").length<=32);
  assert.throws(()=>f.state.commandJob({id:"a"},"bounded-0"),/COMMAND_NOT_FOUND/);
  assert.equal(f.state.commandJobsFor({id:"a"},"another-target").length,0);
});

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

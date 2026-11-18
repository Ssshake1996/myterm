import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteOpsState } from "../lib/state/index.js";
import { localOptions, localShellArgv, listLocalShells, decodeLocalProbe } from "../lib/local-shells.js";
import { reloadBlockers } from "../lib/hot-reload.js";
import { registerTools } from "../lib/tools.js";

const defaultShell = process.platform === "win32" ? "cmd" : "sh";
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "remote-ops-locals-")), terminals = [];
  const ctx = { terminals: { list: () => [] }, credentials: {}, agents: { list: () => [] }, subprocess: {
    resolveExecutable: async name => name,
    spawnTerminal: async spec => {
      let finish;
      const output = new EventEmitter(), writes = [];
      const terminal = { spec, output, writes, done: new Promise(resolve => { finish = resolve; }),
        write: async text => { writes.push(text); output.emit("data", Buffer.from("OUT:" + text)); },
        terminate: async () => { finish({ exitCode: 0 }); },
        signalForeground: async value => { writes.push(value); return 123; } };
      terminals.push(terminal); return terminal;
    }
  }};
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = root;
  const state = new RemoteOpsState(ctx);
  if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
  await state.ready;
  t.after(async () => { state.disposed = true; await Promise.all(state.localTerminalEntries().map(([,s]) => s.close())); assert.ok(state.base.startsWith(root)); await rm(root, { recursive: true, force: true }); });
  return { root, state, ctx, terminals };
}

test("startup and discovery keep one default; concurrent Agent opens reuse it; explicit new opens one more", async t => {
  const { state, terminals } = await fixture(t);
  assert.equal(state.localSnapshots().length, 1);
  assert.equal(state.localSnapshot().sessionId, "local-cmd");
  // Discovery must not create a terminal, including unavailable engines.
  state.ctx.subprocess.resolveExecutable = async name => { if (name !== process.env.ComSpec && name !== (process.platform === "win32" ? "cmd.exe" : "/bin/sh")) throw Error("absent"); return name; };
  const catalog = await state.localShellCatalog();
  assert.equal(catalog.shells.filter(s => s.available).length, 1);
  const [a,b] = await Promise.all([state.openLocalTerminal(), state.openLocalTerminal()]);
  assert.equal(a.sessionId, "local-cmd"); assert.equal(b.reused, true); assert.equal(terminals.length, 1);
  const extra = await state.openLocalTerminal({ reuse: false });
  assert.match(extra.sessionId, /^local-shell-/); assert.notEqual(extra.name, a.name); assert.equal(terminals.length, 2);
  assert.equal((await state.openLocalTerminal({shell:defaultShell})).sessionId, "local-cmd");
  assert.equal(state.localOpeningCount, 0);
});

test("all local IDs route input, send, read, signals and logs to the selected session across conversations", async t => {
  const {state,terminals}=await fixture(t), owner={id:"owner-a"};
  const extra=await state.openLocalTerminal({reuse:false});
  const result=await state.send(owner,extra.sessionId,{text:"echo spaced text",submit:true,quietMs:1,timeoutSeconds:1});
  assert.equal(result.sessionId,extra.sessionId);
  assert.deepEqual(terminals[0].writes,[]);
  assert.equal(terminals[1].writes[0],"echo spaced text\r");
  await state.input({id:"owner-b"},extra.sessionId,"manual\r");
  assert.match((await state.readTerminal(owner,extra.sessionId)).text,/manual/);
  assert.doesNotMatch((await state.readTerminal(owner,"local-cmd")).text,/manual/);
  await state.signal(owner,extra.sessionId,"INT");
  assert.equal(terminals[1].writes.at(-1),"SIGINT");
  const logs=await state.listTerminalLogs(owner);
  assert.equal(logs.logs.length,2);
  assert.ok(logs.logs.every(x=>x.kind==="local"));
  const exported=await state.exportTerminalLogs(owner,{all:true,format:"zip"});
  assert.ok(exported);
});

test("exit retains output without automatic respawn; explicit reopen changes stream; close preserves pinned default and logs", async t => {
  const {state,terminals}=await fixture(t);
  const extra=await state.openLocalTerminal({reuse:false}), session=state.getLocalSession(extra.sessionId), stream=session.outputBuffer.streamId;
  await state.input(undefined,extra.sessionId,"record survives");
  await session.close(); await new Promise(r=>setImmediate(r));
  assert.equal(state.localSnapshots().find(x=>x.sessionId===extra.sessionId).status.kind,"exited");
  assert.match((await state.readTerminal({id:"a"},extra.sessionId)).text,/record survives/);
  await state.ensureLocalSession(); assert.equal(terminals.length,2);
  const fresh=await state.reopenLocalTerminal(extra.sessionId);
  assert.notEqual(fresh.outputCursor.streamId,stream); assert.equal(terminals.length,3);
  await assert.rejects(state.input(undefined,extra.sessionId,"must not send","manual",stream),{code:"TERMINAL_STREAM_CHANGED"});
  assert.deepEqual(terminals[2].writes,[]);
  await state.close(undefined,extra.sessionId);
  assert.equal(state.localSnapshots().length,1);
  await assert.rejects(state.close(undefined,"local-cmd"),{code:"LOCAL_DEFAULT_PINNED"});
  assert.equal((await state.listTerminalLogs({id:"a"})).logs.length,3);
  assert.equal(state.localSession.closed,false);
});

test("defaults persist without replacing running sessions; matching reuse excludes active, closing and different launch options", async t => {
  const {state,terminals,root}=await fixture(t), first=state.localSession;
  const settings=localOptions({shell:defaultShell,cwd:root});
  await state.saveLocalSettings(settings);
  assert.deepEqual(JSON.parse(await readFile(join(state.base,"local-terminal.json"),"utf8")),settings);
  assert.equal(terminals.length,1); assert.equal(state.localSession,first);
  const next=await state.openLocalTerminal(); assert.equal(next.reused,false); assert.equal(terminals[1].spec.cwd,root);
  state.getLocalSession(next.sessionId).active={};
  const other=await state.openLocalTerminal(); assert.notEqual(other.sessionId,next.sessionId);
  delete state.getLocalSession(next.sessionId).active;
  assert.notEqual((await state.openLocalTerminal({cwd:state.base})).sessionId,"local-cmd");
  assert.deepEqual(reloadBlockers({localSessions:new Map([["x",{pendingSend:{}}]])}),["终端等待回显"]);
});

test("bad local options fail before spawn and closing gates writes", async t => {
  const {state,terminals}=await fixture(t);
  for(const args of [null,[],{reuse:"false"},{shell:"magic"},{cwd:"bad\npath"},{distribution:"x"}]) await assert.rejects(state.openLocalTerminal(args));
  assert.equal(terminals.length,1); assert.equal(state.localOpeningCount,0);
  state.localSession.closing=true;
  await assert.rejects(state.input(undefined,"local-cmd","blocked"),{code:"REMOTE_SESSION_CLOSING"});
  await assert.rejects(state.execute({id:"a"},"local-cmd",{command:"echo blocked"}),{code:"REMOTE_SESSION_CLOSING"});
  assert.equal(terminals[0].writes.length,0);
  state.localSession.closing=false;
});

test("closing and reopening the same terminal cannot leave a replacement behind", async t => {
  const {state,ctx}=await fixture(t), extra=await state.openLocalTerminal({reuse:false});
  const session=state.getLocalSession(extra.sessionId);
  await session.close(); await new Promise(r=>setImmediate(r));
  session.closing=true;
  await assert.rejects(state.reopenLocalTerminal(extra.sessionId),{code:"REMOTE_SESSION_CLOSING"});
  session.closing=false;
  let release, enter; const entered=new Promise(resolve=>{enter=resolve;}), spawn=ctx.subprocess.spawnTerminal;
  ctx.subprocess.spawnTerminal=async options=>{await new Promise(resolve=>{release=resolve;enter();}); return spawn(options);};
  const reopened=state.reopenLocalTerminal(extra.sessionId);
  await entered;
  await assert.rejects(state.closeLocalTerminal(extra.sessionId),{code:"LOCAL_SESSION_BUSY"});
  release(); await reopened;
  assert.equal(state.localSnapshots().length,2);
  await state.closeLocalTerminal(extra.sessionId); assert.equal(state.localSnapshots().length,1);
});

test("Windows argv preserve spaces, unicode, distro and user; PowerShell UTF8 setup and script are encoded", () => {
  const wsl=localOptions({shell:"wsl",distribution:"Ubuntu 24",user:"dev",cwd:"/home/dev/a b"},"win32");
  assert.deepEqual(localShellArgv(wsl,"C:\\Windows\\wsl.exe","printf '中文'"),["C:\\Windows\\wsl.exe","--distribution","Ubuntu 24","--user","dev","--cd","/home/dev/a b","--exec","/bin/sh","-c","printf '中文'"]);
  for(const shell of ["powershell","pwsh"]) {
    const args=localShellArgv(localOptions({shell},"win32"),shell+".exe","Write-Output 'a b 中文'");
    assert.ok(!args.includes("-NoExit"));
    assert.match(Buffer.from(args.at(-1),"base64").toString("utf16le"),/UTF8Encoding.*Write-Output 'a b 中文'/);
    assert.ok(localShellArgv(localOptions({shell},"win32"),shell+".exe").includes("-NoExit"));
  }
  assert.throws(()=>localOptions({shell:"wsl",cwd:"C:\\data"},"win32"),{code:"LOCAL_OPTIONS_INVALID"});
  assert.throws(()=>localOptions({shell:"cmd"},"linux"),{code:"LOCAL_SHELL_UNAVAILABLE"});
});

test("WSL enumeration decodes UTF16 and reports missing distributions without opening PTYs", async () => {
  let calls=0, list="Ubuntu\r\nDebian\r\n";
  const subprocess={
    resolveExecutable:async name=>{if(name==="pwsh.exe")throw Error("missing"); return name;},
    spawn:async spec=>{calls++;assert.deepEqual(spec.argv,["wsl.exe","--list","--quiet"]);const stdout=new PassThrough(),stderr=new PassThrough();return {stdout,stderr,done:new Promise(resolve=>setImmediate(()=>{stdout.end(Buffer.from(list,"utf16le"));resolve({exitCode:0});})),terminate:async()=>{}};}
  };
  const shells=await listLocalShells(subprocess,".","win32");
  assert.deepEqual(shells.filter(x=>x.shell==="wsl").map(x=>x.distribution),["Ubuntu","Debian"]);
  assert.equal(shells.find(x=>x.shell==="pwsh").available,false);
  list=""; const empty=await listLocalShells(subprocess,".","win32");
  assert.equal(empty.find(x=>x.shell==="wsl").available,false);assert.equal(calls,2);
  assert.equal(decodeLocalProbe(Buffer.from("Ubuntu\r\n")),"Ubuntu");
});

test("registered Agent tools expose discovery and precise reuse semantics", async t => {
  const {state}=await fixture(t), tools=new Map();
  registerTools({tools:{register:tool=>tools.set(tool.name,tool)},systemPrompt:{section(){}}},state);
  const opened=await tools.get("remote_local_open").execute({shell:defaultShell},{agent:{id:"a"}});
  assert.equal(opened.sessionId,"local-cmd");assert.equal(opened.reused,true);
  assert.equal(tools.get("remote_local_shells").parameters.type,"object");
  assert.equal(tools.get("remote_local_open").parameters.properties.reuse.type,"boolean");
});


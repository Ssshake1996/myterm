import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteOpsState } from "../lib/index.js";

export const OWNER = { id: "agent" };

export class ScriptedTerminal {
  constructor(script) {
    this.script = script;
    this.output = new EventEmitter();
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
    this.writes = [];
    this.signals = [];
  }
  async write(text) {
    this.writes.push(String(text));
    const reply = this.script(String(text), this.writes);
    if (reply) setTimeout(() => this.output.emit("data", Buffer.from(reply)), 5);
  }
  async signalForeground(signal) { this.signals.push(signal); return 1; }
  async terminate() { this.output.emit("end"); this.resolveDone({ exitCode: 0, signal: null }); }
}

export async function fixture(t, script) {
  const root = await mkdtemp(join(tmpdir(), "dsh-cli-assist-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const terminal = new ScriptedTerminal(script);
  const ctx = {
    subprocess: { resolveExecutable: async (value) => value, spawnTerminal: async () => terminal },
    credentials: { async set() {}, async resolve() { return {}; } },
  };
  const state = new RemoteOpsState(ctx);
  await state.ready;
  t.after(async () => {
    state.disposed = true;
    await state.localSession?.close().catch(() => {});
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });
  return { state, terminal, ctx };
}

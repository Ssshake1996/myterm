import { spawn } from "node:child_process";
import { createFakeLocalShell } from "./fake-local-shell.mjs";

const hostError = (code, message) => Object.assign(new Error(message), { code });

// The part of Harness DSH the plugin talks to, with the same ownership rules: a terminal belongs to the Agent that
// spawned it, names are unique per owner, and a backend session only becomes visible once its setup succeeded.
export function createFakeHost({ agentIds = ["e2e-session"], localShellOptions = {} } = {}) {
  const tools = new Map();
  const routes = new Map();
  const systemPrompts = [];
  const cleanups = [];
  const backends = new Map();
  const records = new Map();
  const credentials = new Map();
  const agents = new Map(agentIds.map((id) => [id, { id }]));
  const localShells = [];
  let sequence = 0;

  const owned = (owner, id) => {
    const record = records.get(id);
    if (!record || record.owner.id !== owner?.id) throw hostError("NOT_FOUND", `no terminal ${id} for this owner`);
    return record;
  };
  const snapshot = (record) => ({ sessionId: record.id, name: record.name, type: record.type, status: record.session.status() });

  const terminals = {
    registerBackend(backend) {
      if (backends.has(backend.type)) throw hostError("DUPLICATE_BACKEND", `a PTY backend named "${backend.type}" is already registered`);
      backends.set(backend.type, backend);
      return () => backends.delete(backend.type);
    },
    async spawn(owner, request, signal) {
      const backend = backends.get(request.type);
      if (!backend) throw hostError("UNKNOWN_BACKEND", `no PTY backend named "${request.type}"`);
      const name = request.name ?? `pty-${sequence + 1}`;
      if ([...records.values()].some((record) => record.owner.id === owner.id && record.name === name)) throw hostError("DUPLICATE_NAME", "PTY session name already exists for this owner");
      sequence += 1;
      const id = `pty-${sequence}`;
      const session = await backend.spawn({ ...request, name, sessionId: id, owner, signal });
      records.set(id, { id, owner, name, type: request.type, session });
      return { ...snapshot(records.get(id)), motd: session.motd ?? "" };
    },
    startSend(owner, id, request) { return owned(owner, id).session.startSend(request); },
    read(owner, id, args) { return owned(owner, id).session.read(args); },
    signal(owner, id, signal) { return owned(owner, id).session.signal(signal); },
    async kill(owner, id, reason) {
      const record = owned(owner, id);
      records.delete(id);
      await record.session.close(reason);
    },
    list(owner) { return [...records.values()].filter((record) => record.owner.id === owner.id).map(snapshot); },
  };

  const ctx = {
    effect(effect, label) {
      const dispose = effect();
      if (typeof dispose === "function") cleanups.push({ label, dispose });
      return dispose;
    },
    tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    systemPrompt: { section(section) { systemPrompts.push(section); } },
    agents: { get: (id) => agents.get(id) },
    sessionController: { resolveAgent: async (id) => agents.has(id) ? { agent: agents.get(id) } : { error: hostError("SESSION_NOT_FOUND", `unknown session ${id}`) } },
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } },
    terminals,
    credentials: {
      async set(reference, value) { credentials.set(reference, value); },
      async resolve(reference) { return { value: credentials.get(reference) }; },
    },
    subprocess: {
      async resolveExecutable(name) { return name; },
      async spawnTerminal(options) {
        const shell = createFakeLocalShell({ rows: options.rows, cols: options.cols, ...localShellOptions });
        localShells.push({ shell, options });
        return shell;
      },
      async spawn({ argv, cwd, signal }) {
        const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"], signal });
        const done = new Promise((resolve) => { child.once("close", (exitCode, exitSignal) => resolve({ exitCode, signal: exitSignal })); child.once("error", () => resolve({ exitCode: null, signal: null })); });
        return { stdout: child.stdout, stderr: child.stderr, done, terminate: () => child.kill("SIGTERM") };
      },
    },
  };

  return {
    ctx, tools, routes, systemPrompts, agents, localShells, terminals,
    async dispose() {
      for (const { dispose } of cleanups.splice(0).reverse()) await Promise.resolve(dispose()).catch(() => {});
      for (const record of [...records.values()]) await record.session.close("host disposed").catch(() => {});
      records.clear();
    },
  };
}

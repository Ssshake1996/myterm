import { describeFailure } from "./diagnostics.js";
import { LOCAL_SESSION_ID } from "./constants.js";
import { defaultPasswordRef, normalizeGroupName, sessionError, summarizeError, validateEnvironment } from "./common.js";

const registerRoute = (ctx, label, definition) => ctx.effect(() => ctx.connection.fetch.register(definition), label);

const OWNERLESS_ACTIONS = new Set(["group.create", "group.rename", "group.delete", "environment.save", "environment.delete", "quick-group.create", "quick-group.rename", "quick-group.delete", "quick.save", "quick.delete"]);

const connectionSummary = (opened, extra = {}) => ({ sessionId: opened.sessionId, environment: opened.environment.name, status: opened.session.status(), viewport: opened.session.output.slice(-64 * 1024), ...extra });

async function saveEnvironmentAction(state, body) {
  const environment = state.normalizeEnvironment({ ...body.environment, group: normalizeGroupName(body.environment?.group) });
  const password = typeof body.password === "string" ? body.password : "";
  const validation = validateEnvironment(environment);
  if (!validation.ok) throw sessionError("REMOTE_ENV_INVALID", validation.errors.join(", "));
  if (password) {
    const previous = state.findEnvironment(environment.id);
    const reference = String(environment.passwordRef ?? "").trim() || previous?.passwordRef || defaultPasswordRef(environment.id);
    environment.passwordRef = await state.storePassword(reference, password);
  }
  return { saved: true, environment: await state.saveEnvironment(environment) };
}

const ACTIONS = {
  "group.create": ({ state, body }) => state.createGroup(body.name),
  "group.rename": ({ state, body }) => state.renameGroup(body.group, body.name),
  "group.delete": ({ state, body }) => state.deleteGroup(body.group),
  "environment.save": ({ state, body }) => saveEnvironmentAction(state, body),
  "environment.delete": ({ state, body, agent }) => state.deleteEnvironment(agent, body.environment),
  "quick-group.create": ({ state, body }) => state.createQuickGroup(body.name),
  "quick-group.rename": ({ state, body }) => state.renameQuickGroup(body.group, body.name),
  "quick-group.delete": ({ state, body }) => state.deleteQuickGroup(body.group),
  "quick.save": ({ state, body }) => state.saveQuickCommand({ ...body.command, group: normalizeGroupName(body.command?.group) }),
  "quick.delete": ({ state, body }) => state.deleteQuickCommand(body.commandId),
  "open": async ({ state, body, agent }) => connectionSummary(await state.open(agent, body.environment)),
  "open-command": async ({ state, body, agent }) => connectionSummary(await state.openDirect(agent, body.environment), { direct: true }),
  "send": ({ state, body, agent }) => state.send(agent, body.session, { ...body, actor: "manual" }),
  "input": ({ state, body, agent }) => state.input(agent, body.session, body.text, "manual", body.streamId),
  "signal": ({ state, body, agent }) => state.signal(agent, body.session, body.signal),
  "close": ({ state, body, agent }) => state.close(agent, body.session),
  "sftp": ({ state, body, agent }) => body.operation === "local-list" ? state.listLocalFiles(body.path) : state.sftp(agent, body.environment, body.operation, body),
};

export function registerRoutes(ctx, state) {
  registerRoute(ctx, "dsh-remote-ops state route", {
    path: "/api/dsh-remote-ops/state",
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => {
      const sessionId = new URL(request.url).searchParams.get("sessionId");
      const agent = sessionId ? ctx.agents.get(sessionId) : undefined;
      await state.ready;
      return Response.json(agent ? { ...state.snapshot(agent), bound: true } : state.catalog(), { headers: { "Cache-Control": "no-store" } });
    },
  });
  registerRoute(ctx, "dsh-remote-ops terminal route", {
    path: "/api/dsh-remote-ops/terminal",
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => {
      const url = new URL(request.url);
      const target = url.searchParams.get("session");
      const sessionId = url.searchParams.get("sessionId");
      const rawOffset = url.searchParams.get("offset");
      const waitMs = Math.max(0, Math.min(25_000, Number(url.searchParams.get("waitMs") ?? 0) || 0));
      if (!target) return Response.json({ error: "REMOTE_SESSION_REQUIRED" }, { status: 400 });
      const offset = rawOffset === null ? undefined : Number(rawOffset);
      if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) return Response.json({ error: "REMOTE_OFFSET_INVALID" }, { status: 400 });
      const agent = sessionId ? ctx.agents.get(sessionId) : undefined;
      if (target !== LOCAL_SESSION_ID && !agent) return Response.json({ error: "REMOTE_SESSION_NOT_ACTIVE" }, { status: 404 });
      try { await state.ready; return Response.json(await state.terminalOutput(agent, target, offset, waitMs, request.signal, url.searchParams.get("streamId")), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ error: summarizeError(error), code: error?.code }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
    },
  });
  registerRoute(ctx, "dsh-remote-ops update route", {
    path: "/api/dsh-remote-ops/update",
    methods: ["GET", "POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      try { await state.ready; if (request.method === "POST") return Response.json(await state.upgrade(), { headers: { "Cache-Control": "no-store" } }); return Response.json(await state.checkForUpdate(), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ error: summarizeError(error), code: error?.code }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
    },
  });
  registerRoute(ctx, "dsh-remote-ops action route", {
    path: "/api/dsh-remote-ops/action",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      const body = await request.json();
      await state.ready;
      const localTerminalAction = body.session === LOCAL_SESSION_ID && ["send", "input", "signal"].includes(body.action);
      const localSftpAction = body.action === "sftp" && body.operation === "local-list";
      const ownerOptional = OWNERLESS_ACTIONS.has(body.action) || localTerminalAction || localSftpAction;
      let agent = body.sessionId ? ctx.agents.get(body.sessionId) : undefined;
      if (!agent && !ownerOptional) {
        try { agent = await state.resolveOwner(body.sessionId); } catch (error) { return Response.json({ error: summarizeError(error), ...describeFailure(error, "session-activation") }, { status: 400 }); }
      }
      if (!agent && !ownerOptional) return Response.json({ error: "REMOTE_SESSION_NOT_ACTIVE" }, { status: 404 });
      try {
        if (!Object.hasOwn(ACTIONS, body.action)) throw new Error(`Unknown action: ${body.action}`);
        const value = await ACTIONS[body.action]({ state, body, agent });
        return Response.json(value ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json({ error: summarizeError(error), ...describeFailure(error, body.action) }, { status: 400 });
      }
    },
  });
}

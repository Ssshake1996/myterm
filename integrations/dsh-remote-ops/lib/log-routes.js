import { registerRuntimeFetch } from "./hot-reload.js";
import { summarizeError } from "./common.js";

const headers = { "Cache-Control": "no-store" };
export function registerLogRoutes(ctx, state) {
  // Connection emits this only after admission. Revalidate the browser origin
  // through the same public fence; never infer URLs from proxy headers or tokens.
  ctx.on?.("connection/request", (request, _response, next) => {
    try {
      const source = request.headers.origin || request.headers.referer;
      if (typeof source === "string" && ctx.connection.requestRejection) {
        const url = new URL(source);
        if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
          ctx.connection.requestRejection({ headers: { ...request.headers, origin: url.origin } }) === undefined) state.logDownloadOrigin = url.origin;
      }
    } catch { /* An unavailable browser origin must not interrupt API dispatch. */ }
    return next();
  });
  ctx.effect(() => registerRuntimeFetch(ctx, state, {
    path: "/api/dsh-remote-ops/logs", methods: ["POST"], requestBody: "buffered",
    fetch: async request => {
      try {
        const body = await request.json();
        const owner = body.sessionId ? await state.resolveOwner(body.sessionId) : undefined;
        let result;
        if (body.action === "list") result = await state.listTerminalLogs(owner);
        else if (body.action === "read") result = await state.readTerminalLog(owner, body);
        else if (body.action === "export") result = await state.exportTerminalLogs(owner, body);
        else throw new Error("TERMINAL_LOG_INVALID: action must be list, read or export");
        return Response.json(result, { headers });
      } catch (error) { return Response.json({ error: summarizeError(error), code: error.code }, { status: 400, headers }); }
    },
  }), "dsh-remote-ops terminal logs");
  ctx.effect(() => registerRuntimeFetch(ctx, state, {
    path: "/api/dsh-remote-ops/log-download", methods: ["GET"], requestBody: "buffered",
    fetch: async request => {
      try {
        const params = new URL(request.url).searchParams, sessionId = params.get("sessionId");
        const owner = sessionId ? await state.resolveOwner(sessionId) : undefined;
        const { data, info } = state.getLogExport(owner, params.get("exportId"));
        return new Response(data, { headers: { ...headers, "Content-Type": info.contentType, "Content-Length": String(data.length), "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(info.filename)}` } });
      } catch (error) { return Response.json({ error: summarizeError(error), code: error.code }, { status: 404, headers }); }
    },
  }), "dsh-remote-ops log download");
}

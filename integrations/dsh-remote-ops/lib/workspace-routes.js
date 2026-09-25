import { Readable } from "node:stream";
import { describeFailure, diagnosticReport } from "./diagnostics.js";
import { transferName } from "./transfers.js";

const headers = { "Cache-Control": "no-store" };
const json = value => Response.json(value, { headers });
const errorResponse = (error, stage) => Response.json({ error: String(error.message ?? error), ...describeFailure(error, stage) }, { status: 400, headers });

export function registerWorkspaceRoutes(ctx, state) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: "/api/dsh-remote-ops/workspace", methods: ["POST"], requestBody: "buffered",
    fetch: async request => {
      let body;
      try {
        body = await request.json(); await state.ready;
        const localControl = body.session === "local-cmd" && body.action === "control";
        const localList = body.action === "files" && body.endpoint?.kind === "host";
        const owner = (localControl || localList || body.action === "diagnostics") ? ctx.agents.get(body.sessionId) : await state.resolveOwner(body.sessionId);
        if (body.action === "activate") return json({ bound: true });
        if (body.action === "enter") return json(await state.enter(owner, body.environment));
        if (body.action === "control") return json(await state.control(owner, body.session, body.control));
        if (body.action === "command-execute") return json(await state.execute(owner, body.session, { ...body, signal: request.signal }));
        if (body.action === "command-cancel") return json(state.cancelCommand(owner, body.requestId));
        if (body.action === "files") return json(await state.listFiles(body.endpoint, request.signal));
        if (body.action === "transfer") return json(state.transfers.start(owner.id, body));
        if (body.action === "transfer-preview") return json(await state.transfers.preview(owner.id, body, request.signal));
        if (body.action === "transfer-retry") return json(state.transfers.retry(owner.id, body.id));
        if (body.action === "transfers") return json({ tasks: state.transfers.list(owner.id) });
        if (body.action === "transfer-cancel") return json(state.transfers.cancel(owner.id, body.id));
        if (body.action === "diagnostics") return json(diagnosticReport({ ...(owner ? state.snapshot(owner) : state.catalog()), harnessVersion: state.harnessVersion }));
        throw Object.assign(new Error(`Unknown workspace action: ${body.action}`), { code: "REMOTE_ACTION_INVALID" });
      } catch (error) { return errorResponse(error, body?.action ?? "workspace"); }
    },
  }), "dsh-remote-ops workspace route");
  const browserFile = async request => {
      let files;
      try {
        await state.ready;
        const url = new URL(request.url), owner = await state.resolveOwner(url.searchParams.get("sessionId"));
        const endpoint = { kind: url.searchParams.get("kind"), environment: url.searchParams.get("environment"), path: url.searchParams.get("path") || "." };
        const name = transferName(url.searchParams.get("name"));
        if (request.method === "POST") {
          if (!request.body) throw new Error("UPLOAD_BODY_REQUIRED");
          const task = state.transfers.start(owner.id, { source: { kind: "browser" }, target: endpoint, names: [name], conflict: url.searchParams.get("conflict") || "error" }, Readable.fromWeb(request.body));
          const abort = () => state.transfers.cancel(owner.id, task.id);
          request.signal.addEventListener("abort", abort, { once: true });
          let result;
          try { result = await state.transfers.wait(owner.id, task.id); } finally { request.signal.removeEventListener("abort", abort); }
          if (result.status !== "completed") return Response.json({ error: result.error.message, ...result.error }, { status: 400, headers });
          return json(result);
        }
        files = await state.connectFiles(endpoint, request.signal);
        const path = files.join(await files.canonical(endpoint.path), name);
        const details = await files.stat(path);
        if (details?.type !== "file") throw new Error("DOWNLOAD_FILE_REQUIRED: Select a regular file");
        const stream = files.read(path), connection = files;
        const close = () => { request.signal.removeEventListener("abort", abort); connection.close(); };
        const abort = () => stream.destroy(new Error("Download cancelled"));
        request.signal.addEventListener("abort", abort, { once: true });
        stream.once("close", close);
        files = undefined;
        return new Response(Readable.toWeb(stream), { headers: { ...headers, "Cache-Control": "no-store, no-transform", "Content-Type": "application/octet-stream", "Content-Length": String(details.size), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
      } catch (error) { files?.close(); return errorResponse(error, "browser-file"); }
    };
  // The host streaming bridge attaches a request body, which is invalid for GET.
  ctx.effect(() => ctx.connection.fetch.register({ path: "/api/dsh-remote-ops/browser-upload", methods: ["POST"], requestBody: "streaming", fetch: browserFile }), "dsh-remote-ops browser upload route");
  ctx.effect(() => ctx.connection.fetch.register({ path: "/api/dsh-remote-ops/browser-file", methods: ["GET"], requestBody: "buffered", fetch: browserFile }), "dsh-remote-ops browser download route");
}

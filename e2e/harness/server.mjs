import esbuild from "esbuild";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply } from "../../integrations/dsh-remote-ops/lib/index.js";
import { PLUGIN_VERSION } from "../../integrations/dsh-remote-ops/lib/version.js";
import { createFakeHost } from "./fake-host.mjs";
import { startFakeDevice } from "./fake-device.mjs";
import { installGithubStub } from "./github-stub.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, "..", "..", "integrations", "dsh-remote-ops", "lib", "client.js");
const SESSION_ID = "e2e-session";
let bundlePromise;

function bundleHost() {
  bundlePromise ??= esbuild.build({
    absWorkingDir: join(here, ".."),
    entryPoints: ["browser/host.js"],
    bundle: true,
    format: "esm",
    write: false,
    target: "es2022",
    define: { "process.env.NODE_ENV": '"development"' },
  }).then((result) => result.outputFiles[0].contents);
  return bundlePromise;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function send(response, status, body, headers = {}) {
  response.writeHead(status, { "cache-control": "no-store", ...headers });
  response.end(body);
}

export async function startApp({ home = process.env.DSH_HOME, device: deviceOptions = {} } = {}) {
  if (home) process.env.DSH_HOME = home;
  const device = await startFakeDevice(deviceOptions);
  const github = installGithubStub({ latestVersion: PLUGIN_VERSION });
  const host = createFakeHost({ agentIds: [SESSION_ID] });
  apply(host.ctx);
  const clientSource = await readFile(clientPath);
  const hostBundle = await bundleHost();
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Remote Ops e2e</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
  const agent = host.agents.get(SESSION_ID);
  const server = http.createServer(async (incoming, response) => {
    try {
      const url = new URL(incoming.url, "http://127.0.0.1");
      if (incoming.method === "GET" && url.pathname === "/") return send(response, 200, html, { "content-type": "text/html; charset=utf-8" });
      if (incoming.method === "GET" && url.pathname === "/app.js") return send(response, 200, hostBundle, { "content-type": "text/javascript; charset=utf-8" });
      if (incoming.method === "GET" && url.pathname === "/client.js") return send(response, 200, clientSource, { "content-type": "text/javascript; charset=utf-8" });
      if (incoming.method === "GET" && url.pathname === "/e2e/info") return send(response, 200, JSON.stringify({ sessionId: SESSION_ID, pluginVersion: PLUGIN_VERSION, device: { host: device.host, port: device.port, username: device.username, name: device.name, commands: device.log.commands, replies: device.log.replies, windows: device.log.windows, interrupts: device.log.interrupts, executed: device.log.executed } }), { "content-type": "application/json" });
      if (incoming.method === "POST" && url.pathname === "/e2e/agent") {
        const body = JSON.parse((await readBody(incoming)).toString("utf8") || "{}");
        const tool = host.tools.get(body.tool);
        if (!tool) return send(response, 404, JSON.stringify({ error: `unknown tool ${body.tool}` }), { "content-type": "application/json" });
        try {
          const value = await tool.execute(body.args ?? {}, { agent, signal: AbortSignal.timeout(body.timeoutMs ?? 15000) });
          return send(response, 200, JSON.stringify(value), { "content-type": "application/json" });
        } catch (error) {
          return send(response, 400, JSON.stringify({ error: String(error.message ?? error), code: error.code ?? null }), { "content-type": "application/json" });
        }
      }
      const route = host.routes.get(url.pathname);
      if (!route || !route.methods.includes(incoming.method)) return send(response, 404, "not found", { "content-type": "text/plain" });
      const body = incoming.method === "GET" || incoming.method === "HEAD" ? undefined : await readBody(incoming);
      const request = new Request(url, { method: incoming.method, headers: incoming.headers, body });
      const result = await route.fetch(request);
      const payload = Buffer.from(await result.arrayBuffer());
      const headers = {};
      result.headers.forEach((value, key) => { headers[key] = value; });
      response.writeHead(result.status, headers);
      response.end(payload);
    } catch (error) {
      send(response, 500, String(error.stack ?? error), { "content-type": "text/plain; charset=utf-8" });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, device, sessionId: SESSION_ID,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await host.dispose();
      await device.close();
      github.restore();
    },
  };
}

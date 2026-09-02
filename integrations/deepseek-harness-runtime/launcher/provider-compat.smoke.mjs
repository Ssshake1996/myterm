import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  client as createAcpClientApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stateDir = await mkdtemp(join(tmpdir(), "myterm-harness-provider-compat-"));
let requests = 0;
const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  requests += 1;
  request.resume();
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    [
      "data: " +
        JSON.stringify({
          id: "compat-response",
          model: "compat-model",
          choices: [
            {
              message: {
                role: "assistant",
                reasoning: "compatibility reasoning",
                content: "provider compatibility ok",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
      "",
      "data: [DONE]",
    ].join("\n"),
  );
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("mock provider did not bind TCP");

const child = spawn(process.execPath, [join(root, "launcher", "start.mjs")], {
  cwd: stateDir,
  env: {
    ...process.env,
    DSH_HOME: stateDir,
    MYTERM_HARNESS_CWD: stateDir,
    MYTERM_HARNESS_MODEL: "compat-model",
    MYTERM_HARNESS_DEEPSEEK_CONFIG_JSON: JSON.stringify({
      apiKeyEnv: "MYTERM_HARNESS_DEEPSEEK_API_KEY",
      baseURL: `http://127.0.0.1:${address.port}`,
      reasoningEffort: "off",
      models: [{ id: "compat-model", name: "Compatibility Model" }],
    }),
    MYTERM_HARNESS_DEEPSEEK_API_KEY: "compat-key-not-used",
    MYTERM_HARNESS_ACCESS_PRESET: "workspace-write",
    MYTERM_HARNESS_SKILL_DIRS_JSON: "[]",
    MYTERM_HARNESS_SYSTEM_PROMPT: "Reply with the provider response.",
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let stderr = "";
const updates = [];
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
const clientApp = createAcpClientApp({ name: "myterm-provider-compat-smoke" })
  .onNotification(methods.client.session.update, ({ params }) => {
    updates.push(params);
    return Promise.resolve();
  })
  .onRequest(methods.client.session.requestPermission, () =>
    Promise.resolve({ outcome: { outcome: "cancelled" } }),
  );
const connection = clientApp.connect(stream);

try {
  await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  });
  const session = await connection.agent.request(methods.agent.session.new, {
    cwd: stateDir,
    mcpServers: [],
  });
  const result = await connection.agent.request(methods.agent.session.prompt, {
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: "test provider compatibility" }],
  });
  if (result.stopReason !== "end_turn") {
    throw new Error(`unexpected ACP stop reason: ${result.stopReason}`);
  }
  if (!JSON.stringify(updates).includes("provider compatibility ok")) {
    throw new Error(`ACP updates did not contain the normalized response: ${JSON.stringify(updates)}`);
  }
  if (!stderr.includes('"reasoningAlias":1') || !stderr.includes('"messageToDelta":1')) {
    throw new Error(`provider compatibility diagnostics were not emitted: ${stderr}`);
  }
  process.stdout.write(JSON.stringify({ ok: true, requests, stopReason: result.stopReason }));
} finally {
  child.stdin.end();
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("provider compatibility smoke shutdown timed out")), 10000),
    ),
  ]).catch((error) => {
    child.kill();
    throw error;
  });
  await new Promise((resolve) => server.close(resolve));
  await rm(stateDir, { recursive: true, force: true });
  if (child.exitCode !== 0) {
    throw new Error(`Harness process failed with exit code ${child.exitCode}: ${stderr}`);
  }
}

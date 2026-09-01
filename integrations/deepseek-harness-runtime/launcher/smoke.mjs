import { spawn } from "node:child_process";
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
const stateDir = await mkdtemp(join(tmpdir(), "myterm-harness-smoke-"));
const child = spawn(process.execPath, [join(root, "launcher", "start.mjs")], {
  cwd: stateDir,
  env: {
    ...process.env,
    DSH_HOME: stateDir,
    MYTERM_HARNESS_CWD: stateDir,
    MYTERM_HARNESS_PROVIDER: "myterm-smoke",
    MYTERM_HARNESS_MODEL: "smoke-model",
    MYTERM_HARNESS_PROVIDERS_JSON: JSON.stringify({
      "myterm-smoke": {
        displayName: "myterm smoke",
        apiKeyEnv: "MYTERM_HARNESS_API_KEY",
        api: "openai-completions",
        baseURL: "http://127.0.0.1:9/v1",
        models: [{ id: "smoke-model", name: "Smoke Model", contextWindow: 128000, maxTokens: 4096 }],
      },
    }),
    MYTERM_HARNESS_API_KEY: "smoke-key-not-used",
    MYTERM_HARNESS_PERMISSION_MODE: "read-only",
    MYTERM_HARNESS_SKILL_DIRS_JSON: "[]",
    MYTERM_HARNESS_SYSTEM_PROMPT: "You are the myterm operations assistant.",
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

const stream = ndJsonStream(
  Writable.toWeb(child.stdin),
  Readable.toWeb(child.stdout),
);
const clientApp = createAcpClientApp({ name: "myterm-harness-smoke" })
  .onNotification(methods.client.session.update, () => Promise.resolve())
  .onRequest(methods.client.session.requestPermission, () =>
    Promise.resolve({ outcome: { outcome: "cancelled" } }),
  );
const connection = clientApp.connect(stream);

try {
  const initialized = await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  });
  const session = await connection.agent.request(methods.agent.session.new, {
    cwd: stateDir,
    mcpServers: [],
  });
  process.stdout.write(JSON.stringify({
    ok: true,
    agent: initialized.agentInfo,
    capabilities: initialized.agentCapabilities,
    sessionId: session.sessionId,
  }));
} finally {
  child.stdin.end();
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Harness smoke shutdown timed out")), 10000)),
  ]).catch((error) => {
    child.kill();
    throw error;
  });
  await rm(stateDir, { recursive: true, force: true });
  if (child.exitCode !== 0) {
    throw new Error(`Harness smoke process failed with exit code ${child.exitCode}: ${stderr}`);
  }
}

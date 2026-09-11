import { execFile, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const home = await mkdtemp(join(tmpdir(), "myterm-dsh-web-smoke-"));
const homeBridge = join(home, "node_modules", "@myterm", "dsh-bridge");
await mkdir(join(home, "node_modules", "@myterm"), { recursive: true });
await cp(join(root, "bridge"), homeBridge, { recursive: true });
const bridge = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, value: {} }));
});
await new Promise((resolve, reject) => {
  bridge.once("error", reject);
  bridge.listen(0, "127.0.0.1", resolve);
});
const address = bridge.address();
if (!address || typeof address === "string") throw new Error("unable to start smoke bridge");

const child = spawn(
  process.execPath,
  [
    join(root, "launcher", "start.mjs"),
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--no-open",
  ],
  {
    cwd: home,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: "1",
      MYTERM_DSH_BRIDGE_URL: `http://127.0.0.1:${address.port}`,
      MYTERM_DSH_BRIDGE_BEARER: "smoke",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.stdout.setEncoding("utf8");

try {
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`DSH Web startup timed out: ${stderr}`)), 30_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`DSH Web exited before readiness (${code}): ${stderr}`));
    });
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/dsh web:\s+(http:\/\/\S+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
  });
  const response = await fetch(url, { redirect: "manual" });
  if (![200, 302, 303].includes(response.status)) {
    throw new Error(`DSH Web authentication bootstrap returned HTTP ${response.status}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (child.exitCode !== null) {
    throw new Error(`DSH Web exited after readiness (${child.exitCode}): ${stderr}`);
  }
  process.stdout.write(JSON.stringify({ ok: true, profile: "web", url: new URL(url).origin }));
} finally {
  if (child.pid && process.platform === "win32") {
    await new Promise((resolve) => execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], resolve));
  } else if (child.exitCode === null) {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => bridge.close(resolve));
  await rm(home, { recursive: true, force: true });
}

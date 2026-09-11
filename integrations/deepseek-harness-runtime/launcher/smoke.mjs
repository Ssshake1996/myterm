import { execFile, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const homes = await Promise.all([
  mkdtemp(join(tmpdir(), "myterm-dsh-web-smoke-a-")),
  mkdtemp(join(tmpdir(), "myterm-dsh-web-smoke-b-")),
]);
async function start(home, label) {
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
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`DSH Web startup timed out (${label}): ${stderr}`)),
      30_000,
    );
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`DSH Web exited before readiness (${label}, ${code}): ${stderr}`));
    });
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/dsh web:\s+(http:\/\/\S+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
  });
  return { child, label, stderr, url };
}

let children = [];
try {
  children = await Promise.all(homes.map((home, index) => start(home, String.fromCharCode(97 + index))));
  for (const { url, label } of children) {
    const response = await fetch(url, { redirect: "manual" });
    if (![200, 302, 303].includes(response.status)) {
      throw new Error(`DSH Web authentication bootstrap returned HTTP ${response.status} (${label})`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  for (const { child, label, stderr } of children) {
    if (child.exitCode !== null) {
      throw new Error(`DSH Web exited after readiness (${label}, ${child.exitCode}): ${stderr}`);
    }
  }
  process.stdout.write(
    JSON.stringify({
      ok: true,
      profile: "web",
      isolatedInstances: children.map(({ url }) => new URL(url).origin),
    }),
  );
} finally {
  for (const { child } of children) {
    if (child.pid && process.platform === "win32") {
      await new Promise((resolve) => execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], resolve));
    } else if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true }).catch((error) => {
    if (error?.code !== "EBUSY" && error?.code !== "EPERM") throw error;
  })));
}

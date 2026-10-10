import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseWebUrl, redactLaunchOutput } from "./url.mjs";
import { workspacePatch } from "./workspace-patch.mjs";

export const DSH_PACKAGE = "@deepseek-ai/dsh";
export const DSH_VERSION = "0.2.0-rc.2";

export function nodeForHost(env = process.env, execPath = process.execPath, versions = process.versions) {
  if (env.DSH_NODE) return env.DSH_NODE;
  if (Number(versions.node.split(".")[0]) >= 24) return execPath;
  throw new Error("DSH web needs Node 24. Set DSH_NODE to that binary.");
}

function run(nodePath, dshPath, args, { home, timeoutMs, log }) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, [dshPath, ...args], {
      cwd: home,
      env: { ...process.env, DSH_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timed out after ${timeoutMs}ms: dsh ${args.join(" ")}\n${redactLaunchOutput(output)}`));
    }, timeoutMs);
    const append = (chunk) => { output += chunk.toString("utf8"); log?.(chunk.toString("utf8")); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`dsh ${args.join(" ")} exited ${code}\n${redactLaunchOutput(output)}`));
    });
  });
}

const NATIVE_BUILDS = ["ssh2", "cpu-features"];

function pnpmBin() {
  const found = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error("pnpm is required to install the plugin into a DSH profile");
  return spawnSync("which", ["pnpm"], { encoding: "utf8" }).stdout.trim();
}

// pnpm 10 skips dependency build scripts unless the profile allows them.
// The native module must be compiled by the same Node that later runs dsh web.
async function buildNativeModules(profile, nodePath, log) {
  const workspace = join(profile, "pnpm-workspace.yaml");
  const current = await readFile(workspace, "utf8");
  if (!current.includes("onlyBuiltDependencies:")) {
    const items = NATIVE_BUILDS.map((name) => `  - ${name}`).join("\n");
    await writeFile(workspace, `${current.trimEnd()}\nonlyBuiltDependencies:\n${items}\n`);
  }
  await run(nodePath, pnpmBin(), ["rebuild", ...NATIVE_BUILDS], { home: profile, timeoutMs: 180_000, log });
}

export async function installPlugin({ home, pluginTarball, nodePath, dshPath, log }) {
  await mkdir(home, { recursive: true });
  await run(nodePath, dshPath, ["plugin", "--profile", "web", "add", pluginTarball], { home, timeoutMs: 180_000, log });
  const profile = join(home, "profiles", "web");
  await buildNativeModules(profile, nodePath, log);
  const documents = join(home, "documents");
  await mkdir(documents, { recursive: true });
  await writeFile(join(profile, "cordis.patch.yml"), workspacePatch(documents));
  return { documents };
}

export async function startWeb({ home, nodePath, dshPath, log, timeoutMs = 60_000 }) {
  const child = spawn(nodePath, [dshPath, "web", "--port", "0", "--no-open"], {
    cwd: home,
    env: { ...process.env, DSH_HOME: home },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`dsh web did not print a token URL within ${timeoutMs}ms\n${redactLaunchOutput(output)}`));
    }, timeoutMs);
    const stop = () => { clearTimeout(timer); child.stdout.off("data", onData); child.stderr.off("data", onData); child.off("exit", onExit); };
    const onData = (chunk) => {
      const text = chunk.toString("utf8");
      output += text;
      log?.(text);
      const parsed = parseWebUrl(output);
      if (parsed) { stop(); resolve(parsed); }
    };
    const onExit = (code) => { stop(); reject(new Error(`dsh web exited ${code} before printing a URL\n${redactLaunchOutput(output)}`)); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", onExit);
    child.on("error", (error) => { stop(); reject(error); });
  });
  const parsed = await ready;
  return {
    ...parsed,
    output,
    close: async () => {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      await new Promise((resolve) => child.once("exit", resolve));
    },
  };
}

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginRoot = existsSync(join(root, "dsh-remote-ops", "package.json"))
  ? join(root, "dsh-remote-ops")
  : join(dirname(root), "dsh-remote-ops");
const expected = JSON.parse(await readFile(join(root, "harness.lock.json"), "utf8"));
const installed = JSON.parse(
  await readFile(join(root, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8"),
);
const plugin = JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8"));
const patch = await readFile(join(pluginRoot, "cordis.patch.yml"), "utf8");
const host = await readFile(join(pluginRoot, "lib", "index.js"), "utf8");
const client = await readFile(join(pluginRoot, "lib", "client.js"), "utf8");

if (installed.version !== expected.harnessVersion) {
  throw new Error(
    `DeepSeek Harness version mismatch: expected=${expected.harnessVersion}, installed=${installed.version}`,
  );
}
if (plugin.name !== "@dsh/remote-ops" || !plugin.dsh?.client) {
  throw new Error("dsh-remote-ops package does not declare its client plugin face");
}
if (!patch.includes("@deepseek-ai/dsh-terminal") || !patch.includes("@dsh/remote-ops")) {
  throw new Error("dsh-remote-ops patch does not mount the terminal service and plugin");
}
if (!host.includes("ctx.terminals.registerBackend") || !host.includes("remote_terminal_batch")) {
  throw new Error("dsh-remote-ops host plugin lacks owner-scoped SSH tools");
}
if (!client.includes("rightbar.session") || !client.includes("dsh-remote-ops/state")) {
  throw new Error("dsh-remote-ops client plugin lacks the right sidebar and state route");
}

process.stdout.write(
  JSON.stringify({
    ok: true,
    harnessPackage: expected.harnessPackage,
    harnessVersion: expected.harnessVersion,
    profile: expected.profile,
    integration: "official-web-plus-dsh-remote-ops",
    sourceModified: false,
  }),
);

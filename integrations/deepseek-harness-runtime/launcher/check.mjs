import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const expected = JSON.parse(await readFile(join(root, "harness.lock.json"), "utf8"));
const installed = JSON.parse(
  await readFile(join(root, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8"),
);
const bridge = JSON.parse(await readFile(join(root, "bridge", "package.json"), "utf8"));
const patch = await readFile(join(root, "bridge", "cordis.patch.yml"), "utf8");
const host = await readFile(join(root, "bridge", "lib", "index.js"), "utf8");
const client = await readFile(join(root, "bridge", "lib", "client.js"), "utf8");

if (installed.version !== expected.harnessVersion) {
  throw new Error(
    `DeepSeek Harness version mismatch: expected=${expected.harnessVersion}, installed=${installed.version}`,
  );
}
if (bridge.name !== "@myterm/dsh-bridge" || !bridge.dsh?.client) {
  throw new Error("myterm DSH bridge package does not declare its official client plugin face");
}
if (!patch.includes("@myterm/dsh-bridge")) {
  throw new Error("myterm DSH patch does not mount the bridge package");
}
if (!host.includes("exec.agent?.id") || !host.includes("myterm_ssh_cli_batch")) {
  throw new Error("myterm DSH host bridge lacks session-scoped tools");
}
if (!client.includes("conversation.input.dock") || !client.includes("myterm.environments")) {
  throw new Error("myterm DSH client bridge lacks the environment binding dock");
}

process.stdout.write(
  JSON.stringify({
    ok: true,
    harnessPackage: expected.harnessPackage,
    harnessVersion: expected.harnessVersion,
    profile: expected.profile,
    integration: "official-web-plus-external-bridge",
    sourceModified: false,
  }),
);

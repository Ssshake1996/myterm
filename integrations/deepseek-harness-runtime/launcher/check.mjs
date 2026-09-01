import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lock = JSON.parse(await readFile(join(root, "harness.lock.json"), "utf8"));
const installed = JSON.parse(
  await readFile(join(root, "node_modules", "@deepseek-ai", "dsh-acp", "package.json"), "utf8"),
);

if (installed.version !== lock.harnessVersion) {
  throw new Error(
    `DeepSeek Harness version mismatch: lock=${lock.harnessVersion}, installed=${installed.version}`,
  );
}

process.stdout.write(
  JSON.stringify({
    ok: true,
    harnessPackage: lock.harnessPackage,
    harnessVersion: lock.harnessVersion,
    acpProtocolVersion: lock.acpProtocolVersion,
    profile: lock.profile,
    excludedSurfaces: lock.excludedSurfaces,
    enabledToolPacks: lock.enabledToolPacks,
  }),
);

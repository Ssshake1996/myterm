import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateEnvironment, normalizeGroupName, summarizeError } from "../lib/index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const client = await readFile(join(packageRoot, "lib/client.js"), "utf8");
assert.equal(manifest.version, "0.2.1");
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.deepEqual(manifest.dsh?.client?.inject, [
  "@deepseek-ai/dsh-client-ui-sidebar-right",
  "@deepseek-ai/dsh-client-ui-session",
  "@deepseek-ai/dsh-client-ui-workspace",
]);

assert.equal(normalizeGroupName("生产/华东"), "生产-华东");
assert.equal(normalizeGroupName("  "), "default");
assert.equal(validateEnvironment({ id: "prod-1", name: "生产", host: "10.0.0.1", username: "root" }).ok, true);
assert.equal(validateEnvironment({ id: "bad id", name: "x", host: "10.0.0.1", username: "root" }).ok, false);
assert.match(summarizeError(new Error("ECONNREFUSED")), /ECONNREFUSED/);
assert.match(client, /dsh-remote-ops__drawer/);
assert.match(client, /dsh-remote-ops__terminal/);
assert.match(client, /quick-group\.create/);
assert.match(client, /sidebarRight.*sidebarRightTabs/);
assert.match(client, /检查更新/);
console.log("dsh-remote-ops smoke: ok");

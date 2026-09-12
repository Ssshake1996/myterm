import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateEnvironment, normalizeGroupName, summarizeError, defaultPasswordRef } from "../lib/index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const client = await readFile(join(packageRoot, "lib/client.js"), "utf8");
const server = await readFile(join(packageRoot, "lib/index.js"), "utf8");
assert.equal(manifest.version, "0.2.4");
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
assert.equal(validateEnvironment({ id: "prod-1", name: "生产", host: "10.0.0.1", username: "root", passwordRef: "REMOTE_OPS_PROD_1_PASSWORD" }).ok, true);
assert.equal(validateEnvironment({ id: "prod-1", name: "生产", host: "10.0.0.1", username: "root", passwordRef: "not a ref" }).ok, false);
assert.equal(defaultPasswordRef("prod-east").startsWith("DSH_REMOTE_OPS_PROD_EAST_PASSWORD"), true);
assert.match(summarizeError(new Error("ECONNREFUSED")), /ECONNREFUSED/);
assert.match(client, /dsh-remote-ops__drawer/);
assert.match(client, /dsh-remote-ops__terminal/);
assert.match(client, /dsh-remote-ops__inputCapture/);
assert.match(server, /remote_terminal_input/);
assert.match(server, /const opened = await state.open/);
assert.match(server, /TextDecoder/);
assert.match(client, /terminalVisibleText/);
assert.match(client, /quick-group\.create/);
assert.match(client, /sidebarRight.*sidebarRightTabs/);
assert.match(client, /检查更新/);
assert.match(client, /SSH 密码/);
assert.match(client, /grid-template-rows:minmax\(0,1fr\) auto/);
assert.match(client, /无法打开 Remote Ops/);
console.log("dsh-remote-ops smoke: ok");

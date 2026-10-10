import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const libDirectory = fileURLToPath(new URL("../lib/", import.meta.url));
const files = readdirSync(libDirectory).filter((file) => file.endsWith(".js")).sort();
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", join(libDirectory, file)], { encoding: "utf8" });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(`syntax error in lib/${file}\n${result.stderr}\n`);
  }
}
if (failed) process.exit(1);
console.log(`dsh-remote-ops syntax: ok (${files.length} files)`);

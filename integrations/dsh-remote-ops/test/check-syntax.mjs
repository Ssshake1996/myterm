import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const libDirectory = fileURLToPath(new URL("../lib/", import.meta.url));
const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : entry.name.endsWith(".js") ? [join(directory, entry.name)] : []);
const files = walk(libDirectory).map((path) => relative(libDirectory, path)).sort();
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

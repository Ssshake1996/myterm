import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const nsisRoot = join(projectRoot, "src-tauri", "target", "release", "bundle", "nsis");
const portableRoot = join(projectRoot, "dist-release");
const maximumBytes = 20 * 1024 * 1024;

function newestFile(root: string, suffix: string): string {
  if (!existsSync(root)) throw new Error(`Distribution directory does not exist: ${root}`);
  const matches = readdirSync(root)
    .filter((name) => name.toLowerCase().endsWith(suffix))
    .map((name) => join(root, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (!matches[0]) throw new Error(`No ${suffix} artifact was found in ${root}`);
  return matches[0];
}

function assertSize(file: string): void {
  const bytes = statSync(file).size;
  if (bytes >= maximumBytes) {
    throw new Error(
      `${basename(file)} is ${(bytes / 1024 / 1024).toFixed(2)} MB; expected < 20 MB`,
    );
  }
  console.log(`ok size  ${basename(file)} ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

const installer = newestFile(nsisRoot, ".exe");
const portable = newestFile(portableRoot, ".zip");
assertSize(installer);
assertSize(portable);

const listing = spawnSync("tar", ["-tf", portable], { encoding: "utf8" });
if (listing.status !== 0) {
  throw new Error(`Unable to inspect ${basename(portable)}: ${listing.stderr.trim()}`);
}
const entries = listing.stdout
  .split(/\r?\n/u)
  .map((entry) => entry.replace(/^\.\//u, "").replaceAll("\\", "/").toLowerCase())
  .filter(Boolean);
for (const required of ["myterm.exe", "portable.flag"]) {
  if (!entries.includes(required)) {
    throw new Error(`${basename(portable)} does not contain ${required}`);
  }
}
console.log(`ok files ${basename(portable)}: ${entries.join(", ")}`);

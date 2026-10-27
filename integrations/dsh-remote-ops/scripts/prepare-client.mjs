import { readFile, writeFile, readdir, unlink } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error("Invalid plugin version");
const name = `client-v${pkg.version}.js`;
if (pkg.exports["./client"] !== `./lib/${name}`) throw new Error("Client export must name this package version");
const source = await readFile(new URL("lib/client.js", root), "utf8");
const target = new URL(`lib/${name}`, root);
if (await readFile(target, "utf8").catch(() => "") !== source) await writeFile(target, source);
// Generated files only. Never ship an old filename that a running DSH watches:
// that would cause its frontend to reload before the backend's idle barrier.
for (const entry of await readdir(new URL("lib/", root), { withFileTypes: true })) {
  if (entry.isFile() && /^client-v\d+\.\d+\.\d+\.js$/.test(entry.name) && entry.name !== name) await unlink(new URL(`lib/${entry.name}`, root));
}

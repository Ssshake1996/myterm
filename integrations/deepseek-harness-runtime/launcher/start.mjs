import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(root, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const patch = join(root, "bridge", "cordis.patch.yml");
const dshHome = process.env.DSH_HOME;

if (!dshHome) throw new Error("MYTERM_DSH_HOME_REQUIRED: DSH_HOME is not configured");

const scopeRoot = join(dshHome, "node_modules");
const scopePackage = join(scopeRoot, "@deepseek-ai");
const sourcePackage = join(root, "node_modules", "@deepseek-ai");
await mkdir(scopeRoot, { recursive: true });
await rm(scopePackage, { recursive: true, force: true });
await cp(sourcePackage, scopePackage, { recursive: true });

// The profile is a generated projection of the bundled packages.  A previous
// interrupted launch can leave a Windows junction behind whose target no
// longer exists; allowing dsh to reuse that projection makes every package
// import fail before the web server can start.  Conversations live outside
// this directory, so rebuilding the generated profile is safe and keeps
// startup deterministic across upgrades.
await rm(join(dshHome, "profiles", "web"), { recursive: true, force: true });

process.argv = [process.execPath, bin, "--profile", "web", "--patch", patch, ...process.argv.slice(2)];
const { runCli } = await import(pathToFileURL(bin).href);
await runCli();

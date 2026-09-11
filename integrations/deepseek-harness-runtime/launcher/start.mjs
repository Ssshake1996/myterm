import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(root, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const pluginSource = existsSync(join(root, "node_modules", "@dsh", "remote-ops", "package.json"))
  ? join(root, "node_modules", "@dsh", "remote-ops")
  : existsSync(join(root, "dsh-remote-ops", "package.json"))
    ? join(root, "dsh-remote-ops")
  : join(dirname(root), "dsh-remote-ops");
const patch = join(pluginSource, "cordis.patch.yml");
const dshHome = process.env.DSH_HOME;

if (!dshHome) throw new Error("MYTERM_DSH_HOME_REQUIRED: DSH_HOME is not configured");

const scopeRoot = join(dshHome, "node_modules");
const scopePackage = join(scopeRoot, "@deepseek-ai");
const sourcePackage = join(root, "node_modules", "@deepseek-ai");
const pluginRoot = join(dshHome, "node_modules", "@dsh");
const pluginPackage = join(pluginRoot, "remote-ops");
await mkdir(scopeRoot, { recursive: true });
await rm(scopePackage, { recursive: true, force: true });
await cp(sourcePackage, scopePackage, { recursive: true });
await mkdir(pluginRoot, { recursive: true });
await rm(pluginPackage, { recursive: true, force: true });
await cp(pluginSource, pluginPackage, { recursive: true });

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

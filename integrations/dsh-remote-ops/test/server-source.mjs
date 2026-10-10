import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const libDirectory = fileURLToPath(new URL("../lib/", import.meta.url));

export const SERVER_MODULES = (await readdir(libDirectory)).filter((file) => file.endsWith(".js") && file !== "client.js").sort();

export async function readServerSource() {
  const sources = await Promise.all(SERVER_MODULES.map((file) => readFile(join(libDirectory, file), "utf8")));
  return sources.join("\n");
}

export async function readToolSource(name) {
  const tools = await readFile(join(libDirectory, "tools.js"), "utf8");
  const start = tools.indexOf(`name: "${name}"`);
  if (start < 0) return "";
  const next = tools.indexOf("registerTool(ctx, {", start);
  return tools.slice(start, next < 0 ? tools.length : next);
}

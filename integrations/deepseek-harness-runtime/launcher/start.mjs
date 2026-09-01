import process from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  boot,
  installFailLoud,
  loadLayeredEnv,
} from "@deepseek-ai/dsh-app-boot";
import { DSH_LAUNCH_ENVIRONMENT_KEY } from "@deepseek-ai/dsh-launch-environment";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, "profile", "cordis.yml");
const cwd = process.env.MYTERM_HARNESS_CWD || process.cwd();
const environment = loadLayeredEnv("myterm-harness", cwd);
let context;
let closing;

const close = async () => {
  if (closing) return closing;
  closing = context?.fiber.dispose() ?? Promise.resolve();
  return closing;
};

installFailLoud("myterm-harness", process, close);

try {
  context = await boot(
    "myterm-harness",
    configPath,
    undefined,
    (host) => {
      host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment);
    },
    root,
  );

  await new Promise((resolveDone) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolveDone();
    };
    process.stdin.once("end", done);
    process.stdin.once("close", done);
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
  await close();
} catch (error) {
  process.stderr.write(
    `myterm harness launch failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  try {
    await close();
  } catch (disposeError) {
    process.stderr.write(
      `myterm harness cleanup failed: ${disposeError instanceof Error ? disposeError.stack || disposeError.message : String(disposeError)}\n`,
    );
  }
  process.exitCode = 1;
}

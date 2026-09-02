import process from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  boot,
  installFailLoud,
  loadLayeredEnv,
} from "@deepseek-ai/dsh-app-boot";
import { DSH_LAUNCH_ENVIRONMENT_KEY } from "@deepseek-ai/dsh-launch-environment";
import { normalizeSseTermination } from "./sse-normalizer.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, "profile", "cordis.yml");
const cwd = process.env.MYTERM_HARNESS_CWD || process.cwd();
const environment = loadLayeredEnv("myterm-harness", cwd);
let context;
let closing;

const providerSecrets = (() => {
  try {
    const config = JSON.parse(process.env.MYTERM_HARNESS_DEEPSEEK_CONFIG_JSON || "{}");
    return [config.apiKey, ...(config.routes || []).map((route) => route.apiKey)].filter(Boolean);
  } catch {
    return [];
  }
})();

const redactProviderText = (value) => {
  let redacted = String(value);
  for (const secret of providerSecrets) redacted = redacted.replaceAll(secret, "[REDACTED]");
  return redacted.replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]").slice(0, 8192);
};

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!response.ok && url.includes("/chat/completions")) {
    let body = "";
    try {
      body = redactProviderText(await response.clone().text());
    } catch (error) {
      body = `unable to read response body: ${error instanceof Error ? error.message : String(error)}`;
    }
    process.stderr.write(
      `myterm harness provider error: ${JSON.stringify({
        stage: "chat_completions_response",
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        url,
        body,
      })}\n`,
    );
  }
  if (
    response.ok &&
    url.includes("/chat/completions") &&
    !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")
  ) {
    let body = "";
    try {
      body = redactProviderText(await response.clone().text());
    } catch (error) {
      body = `unable to read response body: ${error instanceof Error ? error.message : String(error)}`;
    }
    process.stderr.write(
      `myterm harness provider error: ${JSON.stringify({
        stage: "chat_completions_content_type",
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        url,
        body,
      })}\n`,
    );
  }
  if (
    response.ok &&
    url.includes("/chat/completions") &&
    response.body &&
    response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")
  ) {
    const normalizedBody = normalizeSseTermination(response.body, (reason) => {
      process.stderr.write(
        `myterm harness provider warning: ${JSON.stringify({
          stage: "chat_completions_stream_finalize",
          status: response.status,
          url,
          reason,
          detail: "provider closed the SSE stream without a complete [DONE] event; appended the standard terminator",
        })}\n`,
      );
    });
    return new Response(normalizedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
};

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

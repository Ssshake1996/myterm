import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { apply as applyAccessBridge } from "./myterm-harness-access-bridge.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lock = JSON.parse(await readFile(join(root, "harness.lock.json"), "utf8"));
const installed = JSON.parse(
  await readFile(join(root, "node_modules", "@deepseek-ai", "dsh-acp", "package.json"), "utf8"),
);
const provider = JSON.parse(
  await readFile(
    join(root, "node_modules", "@deepseek-ai", "dsh-llm-deepseek", "package.json"),
    "utf8",
  ),
);
const profile = await readFile(join(root, "profile", "cordis.yml"), "utf8");
const accessBridgePlugin = await readFile(
  join(root, "launcher", "myterm-harness-access-bridge.mjs"),
  "utf8",
);

if (installed.version !== lock.harnessVersion) {
  throw new Error(
    `DeepSeek Harness version mismatch: lock=${lock.harnessVersion}, installed=${installed.version}`,
  );
}
if (provider.version !== lock.harnessVersion) {
  throw new Error(
    `DeepSeek provider version mismatch: lock=${lock.harnessVersion}, installed=${provider.version}`,
  );
}
if (!profile.includes("../launcher/myterm-harness-access-bridge.mjs")) {
  throw new Error("Harness profile does not load the myterm Host MCP access bridge");
}
if (!accessBridgePlugin.includes('ctx.on("tools/pre-execute"')) {
  throw new Error("Host MCP access bridge does not use the Harness tools/pre-execute hook");
}

async function verifyHostToolDecision(preset) {
  const previousPreset = process.env.MYTERM_HARNESS_ACCESS_PRESET;
  process.env.MYTERM_HARNESS_ACCESS_PRESET = preset;
  let selectedPreset = preset;
  let preExecute;
  const presets = {
    "workspace-write": { sandbox: "workspace-write", approval: "ask" },
    "danger-full-access": { sandbox: "danger-full-access", approval: "never" },
  };
  const session = {};
  try {
    applyAccessBridge({
      permissionPresets: {
        current: () => selectedPreset,
        resolve: (name) => {
          const resolved = presets[name];
          if (!resolved) throw new Error(`unknown test preset: ${name}`);
          return resolved;
        },
        set: (_session, name) => {
          selectedPreset = name;
        },
      },
      sessions: { list: () => [] },
      on: (event, handler) => {
        if (event === "tools/pre-execute") preExecute = handler;
      },
    });
    if (!preExecute) throw new Error("Host MCP access bridge did not register tools/pre-execute");
    return await preExecute(
      {
        name: "mcp__myterm-host-tools__session_status",
        agent: { session },
      },
      async () => ({ kind: "allow" }),
    );
  } finally {
    if (previousPreset === undefined) delete process.env.MYTERM_HARNESS_ACCESS_PRESET;
    else process.env.MYTERM_HARNESS_ACCESS_PRESET = previousPreset;
  }
}

const workspaceDecision = await verifyHostToolDecision("workspace-write");
if (workspaceDecision.kind !== "ask") {
  throw new Error(`workspace-write Host MCP decision must be ask, got ${workspaceDecision.kind}`);
}
const fullAccessDecision = await verifyHostToolDecision("danger-full-access");
if (fullAccessDecision.kind !== "allow") {
  throw new Error(
    `danger-full-access Host MCP decision must be allow, got ${fullAccessDecision.kind}`,
  );
}
process.stdout.write(
  JSON.stringify({
    ok: true,
    harnessPackage: lock.harnessPackage,
    harnessVersion: lock.harnessVersion,
    modelProvider: "@deepseek-ai/dsh-llm-deepseek",
    providerRoute: "deepseek-official",
    accessControl: "harness-permission-presets",
    acpProtocolVersion: lock.acpProtocolVersion,
    profile: lock.profile,
    excludedSurfaces: lock.excludedSurfaces,
    enabledToolPacks: lock.enabledToolPacks,
  }),
);

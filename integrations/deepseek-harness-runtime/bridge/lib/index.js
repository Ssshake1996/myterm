export const name = "myterm-dsh-bridge";
export const inject = ["connection", "systemPrompt", "tools"];

const bridgeUrl = process.env.MYTERM_DSH_BRIDGE_URL;
const bridgeBearer = process.env.MYTERM_DSH_BRIDGE_BEARER;

function assertBridgeConfig() {
  if (!bridgeUrl || !bridgeBearer) {
    throw new Error("MYTERM_DSH_BRIDGE_NOT_CONFIGURED: missing bridge URL or bearer token");
  }
}

async function bridge(path, init = {}, signal) {
  assertBridgeConfig();
  const response = await fetch(`${bridgeUrl}${path}`, {
    ...init,
    signal,
    headers: {
      Authorization: `Bearer ${bridgeBearer}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`MYTERM_DSH_BRIDGE_INVALID_JSON: HTTP ${response.status}: ${text}`);
  }
  if (!response.ok || payload.ok === false) {
    const error = payload.error ?? {};
    throw new Error(`${error.code ?? `HTTP_${response.status}`}: ${error.message ?? text}`);
  }
  return payload.value ?? payload;
}

function sessionIdOf(exec) {
  const sessionId = exec.agent?.id;
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("MYTERM_DSH_SESSION_REQUIRED: this tool requires a DSH conversation");
  }
  return sessionId;
}

const output = {
  schema: { type: "object" },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
};

function registerTool(ctx, definition) {
  const { bridgeName, ...tool } = definition;
  const properties = {};
  const required = [];
  for (const [key, value] of Object.entries(tool.parameters)) {
    const { required: isRequired, ...schema } = value;
    properties[key] = schema;
    if (isRequired) required.push(key);
  }
  ctx.tools.register(
    {
      ...tool,
      parameters: {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
      output,
      async execute(args, exec) {
        const value = await bridge(
          `/v1/tools/${encodeURIComponent(bridgeName)}`,
          {
            method: "POST",
            body: JSON.stringify({ sessionId: sessionIdOf(exec), arguments: args }),
          },
          exec.signal,
        );
        return { result: value };
      },
    },
  );
}

const environment = {
  type: "string",
  description:
    "Bound myterm environment name or id. Omit only when the conversation has one bound environment or a primary environment.",
};

export function apply(ctx) {
  assertBridgeConfig();
  ctx.systemPrompt.section({
    name: "myterm:ssh",
    order: 420,
    text:
      "myterm is the SSH execution host. A conversation may bind zero or more saved environments. " +
      "Binding grants target eligibility only; it never implies that terminal context should be read. " +
      "Use myterm_ssh_environments before cross-environment work or whenever the intended target is ambiguous. " +
      "Every SSH tool is rejected by the host unless its target is currently bound to this exact conversation. " +
      "Prefer one complete myterm_ssh_cli or myterm_ssh_cli_batch call when the full command is known. " +
      "Use myterm_ssh_context and incremental terminal operations only when live terminal state is genuinely needed. " +
      "For multi-SSH coordination, name the environment explicitly on every call and observe the relevant target before continuing.",
  });

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: "/api/myterm.environments",
        methods: ["GET"],
        requestBody: "buffered",
        fetch: async (request) => {
          const sessionId = new URL(request.url).searchParams.get("sessionId");
          if (!sessionId) return Response.json({ error: "missing sessionId" }, { status: 400 });
          const value = await bridge(
            `/v1/sessions/${encodeURIComponent(sessionId)}/environments`,
            {},
            request.signal,
          );
          return Response.json(value, { headers: { "Cache-Control": "no-store" } });
        },
      }),
    "myterm: environment catalog route",
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: "/api/myterm.bindings",
        methods: ["POST"],
        requestBody: "buffered",
        fetch: async (request) => {
          const body = await request.json();
          const value = await bridge(
            "/v1/bindings",
            { method: "POST", body: JSON.stringify(body) },
            request.signal,
          );
          return Response.json(value, { headers: { "Cache-Control": "no-store" } });
        },
      }),
    "myterm: environment binding route",
  );

  registerTool(ctx, {
    name: "myterm_ssh_environments",
    bridgeName: "session_catalog",
    description: "List SSH environments bound to this DSH conversation and their live connection state.",
    parameters: {},
  });
  registerTool(ctx, {
    name: "myterm_ssh_connect",
    bridgeName: "session_connect",
    description: "Connect one bound myterm SSH environment on demand.",
    parameters: { environment },
  });
  registerTool(ctx, {
    name: "myterm_ssh_info",
    bridgeName: "session_info",
    description: "Read saved profile and live connection information for one bound SSH environment.",
    parameters: { environment },
  });
  registerTool(ctx, {
    name: "myterm_ssh_context",
    bridgeName: "terminal_context",
    description: "Read a byte range of one bound SSH terminal transcript and its latest visible cursor screen.",
    parameters: {
      environment,
      offset: { type: "number", description: "Transcript byte offset; default 0." },
      limit: { type: "number", description: "Maximum bytes to read; maximum 65536." },
    },
  });
  registerTool(ctx, {
    name: "myterm_ssh_cli",
    bridgeName: "cli_execute",
    description: "Send one complete CLI command with live-prefix protection and wait for its result.",
    parameters: {
      environment,
      command: {
        type: "string",
        required: true,
        description: "One complete command, preserving every argument separator.",
      },
      timeout_seconds: { type: "number", description: "1-300 seconds; default 30." },
      quiet_ms: { type: "number", description: "Quiet completion window, 500-5000 ms." },
    },
  });
  registerTool(ctx, {
    name: "myterm_ssh_cli_batch",
    bridgeName: "cli_execute_batch",
    description: "Execute 1-8 complete CLI commands sequentially on one bound SSH environment in one tool call.",
    parameters: {
      environment,
      commands: {
        type: "array",
        required: true,
        items: { type: "string" },
        description: "Complete commands in execution order.",
      },
      timeout_seconds: { type: "number", description: "Per-command timeout, 1-300 seconds." },
      quiet_ms: { type: "number", description: "Per-command quiet completion window, 500-5000 ms." },
    },
  });
  registerTool(ctx, {
    name: "myterm_ssh_send",
    bridgeName: "terminal_send",
    description: "Send guarded low-level input. Prefer myterm_ssh_cli for complete commands.",
    parameters: {
      environment,
      command: { type: "string", required: true },
      newline: { type: "boolean", description: "Append Enter; default true." },
      input_mode: {
        type: "string",
        enum: ["complete_line", "raw"],
        description: "Use raw only for interactive input or control keys.",
      },
    },
  });
  registerTool(ctx, {
    name: "myterm_ssh_edit",
    bridgeName: "terminal_edit",
    description: "Guardedly correct the visible SSH input line after reading myterm_ssh_context.",
    parameters: {
      environment,
      operation: {
        type: "string",
        required: true,
        enum: [
          "cancel_line",
          "backspace",
          "delete",
          "cursor_left",
          "cursor_right",
          "home",
          "end",
          "clear_current_line",
          "replace_current_input",
        ],
      },
      count: { type: "number" },
      text: { type: "string" },
      expected_input: { type: "string" },
      expected_cursor_line_before_cursor: { type: "string" },
    },
  });
  registerTool(ctx, {
    name: "myterm_ssh_exec",
    bridgeName: "remote_exec",
    description: "Execute a non-interactive shell command over one bound SSH connection.",
    parameters: {
      environment,
      command: { type: "string", required: true },
      timeout_seconds: { type: "number", description: "1-3600 seconds; default 120." },
    },
  });
  registerTool(ctx, {
    name: "myterm_ssh_wait",
    bridgeName: "session_wait_until",
    description: "Wait until a bound SSH terminal transcript matches a condition for multi-environment coordination.",
    parameters: {
      environment,
      pattern: { type: "string", required: true },
      mode: { type: "string", enum: ["contains", "regex"] },
      timeout_seconds: { type: "number" },
      poll_ms: { type: "number" },
    },
  });
  registerTool(ctx, {
    name: "myterm_ssh_list_directory",
    bridgeName: "list_directory",
    description: "List one remote directory over SFTP in a bound SSH environment.",
    parameters: { environment, path: { type: "string", required: true } },
  });

  const fileTools = [
    [
      "myterm_ssh_file_stat",
      "file_stat",
      "Read remote file metadata over SFTP.",
      { environment, path: { type: "string", required: true } },
    ],
    [
      "myterm_ssh_file_read",
      "file_read",
      "Read a byte range from a remote file over SFTP.",
      {
        environment,
        path: { type: "string", required: true },
        offset: { type: "number" },
        limit: { type: "number" },
      },
    ],
    [
      "myterm_ssh_file_search",
      "file_search",
      "Search remote files below a directory.",
      {
        environment,
        path: { type: "string", required: true },
        pattern: { type: "string", required: true },
        max_files: { type: "number" },
        max_matches: { type: "number" },
      },
    ],
    [
      "myterm_ssh_file_write",
      "file_write",
      "Atomically write a remote UTF-8 file, optionally guarded by its expected hash.",
      {
        environment,
        path: { type: "string", required: true },
        content: { type: "string", required: true },
        expected_hash: { type: "string" },
      },
    ],
    [
      "myterm_ssh_file_patch",
      "file_patch",
      "Replace one exact text occurrence in a remote file, optionally guarded by its expected hash.",
      {
        environment,
        path: { type: "string", required: true },
        search: { type: "string", required: true },
        replace: { type: "string", required: true },
        expected_hash: { type: "string" },
      },
    ],
  ];
  for (const [toolName, bridgeName, description, parameters] of fileTools) {
    registerTool(ctx, { name: toolName, bridgeName, description, parameters });
  }
}

export default { name, inject, apply };

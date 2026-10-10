import { normalizeGroupName, ownerId, sessionError, toLosslessJson, validateEnvironment } from "./common.js";
import { MAX_SESSIONS_PER_ENVIRONMENT } from "./constants.js";

const output = { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] };
const stringParam = (description, required = false) => ({ type: "string", description, ...(required ? { required: true } : {}) });
const numberParam = (description) => ({ type: "number", description });
const boolParam = (description) => ({ type: "boolean", description });
const CLI_ASSIST_PARAMETERS = {
  autoConfirm: boolParam("Auto-answer a trailing (y/n) prompt with y, up to 3 times, then keep waiting; default false"),
  confirmPattern: stringParam("Custom regular expression for the confirmation prompt, matched against the trailing output; default \\(y\\/n\\)\\s*$"),
  autoQuitMore: boolParam("Send q when a --More-- pager appears and read the remaining output; default false"),
  autoSigint: boolParam("Send SIGINT when output shows a parameter-error hint (^ arrow plus [param=?] suggestions) so residual characters do not pollute the next command; default true"),
};
const pickCliAssist = (args) => ({ autoConfirm: args.autoConfirm, confirmPattern: args.confirmPattern, autoQuitMore: args.autoQuitMore, autoSigint: args.autoSigint, quietMs: args.quietMs });

function registerTool(ctx, definition) {
  ctx.tools.register({ ...definition, execute: async (...args) => toLosslessJson(await definition.execute(...args)), output });
}

export function registerTools(ctx, state) {
  ctx.systemPrompt.section({
    name: "dsh-remote-ops",
    order: 410,
    text: "Remote operations are provided by dsh-remote-ops. For self-contained noninteractive commands prefer remote_command_execute on an explicit existing connection or local-cmd for real exit status; it does not inherit interactive cwd or temporary variables. Use remote_environment_list to identify the exact terminal; reuse its sessionId. session=local-cmd is the shared local terminal visible in Remote Ops, NOT the Harness bash/pwsh terminal. For SSH open only when no suitable session exists. Send one complete command preserving spaces; raw input is for interactive keys/passwords. Send returns bounded new output, streamId and nextOffset. Continue with remote_terminal_read(session, cursor=nextOffset, streamId, waitMs=20000); drain hasMore before waiting. No new text, inferred_idle, timeout, and a running shell never prove a command completed or succeeded: completion=unknown. Observe actual results before dependent commands; never resend solely because of echo or silence. reset/truncated means history was replaced or dropped; do not assume missing output. Output is a raw terminal stream, not a rendered screen. For device CLIs with repeated (y/n) confirmations or --More-- pagers pass autoConfirm / autoQuitMore on remote_terminal_send instead of answering each prompt yourself; only enable autoConfirm for commands the user has approved, and review autoActions in the result. A parameter-error hint with a ^ arrow triggers an automatic SIGINT (autoActions has type sigint and the output ends with [auto-sigint: command line cleared]); resend the corrected command. For multiple SSH targets name them explicitly and operate sequentially. MCP provides knowledge, not execution evidence. Never invent credentials or connection success.",
  });

  const owner = (exec) => exec.agent;
  registerTool(ctx, {
    name: "remote_command_execute",
    description: "Execute a noninteractive command separately from the visible terminal, returning real exitCode, stdout, stderr and duration. Does NOT inherit the terminal cwd or temporary variables. Local uses a new shell in the plugin working directory; SSH uses a new exec channel on an explicit existing connection with server-default cwd. No stdin; timeout/cancellation does not prove a remote process stopped. Use remote_terminal_send/read for interactive programs.",
    parameters: {
      session: stringParam("Exact existing SSH session id or local-cmd", true),
      command: stringParam("Complete shell command preserving spaces", true),
      timeoutSeconds: numberParam("1-300 seconds; default 30"),
      maxBytes: numberParam("Per-stream output limit, 1024-262144 bytes; default 65536"),
    },
    execute: async (args, exec) => state.execute(owner(exec), args.session, { ...args, signal: exec.signal }),
  });
  registerTool(ctx, {
    name: "remote_environment_list",
    description: "List saved SSH environments and active owner-scoped sessions.",
    parameters: {},
    execute: async (_args, exec) => {
      await state.ready;
      return state.snapshot(owner(exec));
    },
  });
  registerTool(ctx, {
    name: "remote_environment_create",
    description: "Create one saved SSH environment. The plugin generates the internal id; omit the display name to use the SSH host. Use passwordRef instead of plaintext passwords.",
    parameters: {
      name: stringParam("Display name; defaults to the SSH host"),
      host: stringParam("SSH host", true),
      username: stringParam("SSH username", true),
      group: stringParam("Environment group"),
      port: numberParam("SSH port"),
      privateKeyPath: stringParam("Local private key path"),
      passwordRef: stringParam("Harness credential reference"),
    },
    execute: async (args, exec) => {
      await state.ready;
      const value = state.normalizeEnvironment({ ...args, group: normalizeGroupName(args.group) });
      const validation = validateEnvironment(value);
      if (!validation.ok) throw sessionError("REMOTE_ENV_INVALID", validation.errors.join(", "));
      const saved = await state.saveEnvironment(value);
      state.event(owner(exec), "environment.create", { environment: value.name });
      return { saved: true, environment: saved };
    },
  });
  registerTool(ctx, {
    name: "remote_environment_group_create",
    description: "Create an empty saved SSH environment group.",
    parameters: { group: stringParam("Environment group", true) },
    execute: async (args) => state.createGroup(args.group),
  });
  registerTool(ctx, {
    name: "remote_environment_group_rename",
    description: "Rename a saved SSH environment group.",
    parameters: {
      group: stringParam("Existing group", true),
      name: stringParam("New group name", true),
    },
    execute: async (args) => state.renameGroup(args.group, args.name),
  });
  registerTool(ctx, {
    name: "remote_environment_group_delete",
    description: "Delete an empty saved SSH environment group.",
    parameters: { group: stringParam("Environment group", true) },
    execute: async (args) => state.deleteGroup(args.group),
  });
  registerTool(ctx, {
    name: "remote_environment_delete",
    description: "Delete a saved SSH environment and close its owner sessions.",
    parameters: { environment: stringParam("Environment id or name", true) },
    execute: async (args, exec) => state.deleteEnvironment(owner(exec), args.environment),
  });
  registerTool(ctx, {
    name: "remote_terminal_open",
    description: `Open a new SSH terminal for an environment. Each environment allows at most ${MAX_SESSIONS_PER_ENVIRONMENT} owner-scoped connections; use the returned sessionId for subsequent operations.`,
    parameters: { environment: stringParam("Environment id or name", true) },
    execute: async (_args, exec) => {
      const record = await state.open(owner(exec), _args.environment);
      return { sessionId: record.sessionId, environment: record.environment.name, status: record.session.status(), viewport: record.session.output.slice(-64 * 1024) };
    },
  });
  registerTool(ctx, {
    name: "remote_terminal_send",
    description: "Send exact text to a visible SSH session or local-cmd and wait for new output. Returns bounded delta and a resumable cursor, not old history. Silence/timeout is NOT proof of completion. Continue reading, never resend to poll. For custom device CLIs: autoConfirm answers trailing (y/n) prompts with y (max 3), autoQuitMore sends q at --More-- pagers, and a parameter-error hint with a ^ arrow triggers an automatic SIGINT that clears the polluted command line (disable with autoSigint=false); applied steps are listed in autoActions.",
    parameters: {
      session: stringParam("Existing SSH session id or local-cmd"),
      environment: stringParam("Environment id or name only when opening a new connection"),
      text: stringParam("Input text; preserve every separator", true),
      submit: boolParam("Append Enter; defaults true"),
      quietMs: numberParam("Silence before yielding, not command completion; default 700 ms"),
      timeoutSeconds: numberParam("Wait limit in seconds; does not kill the command"),
      maxChars: numberParam("Output page size; default 16384, maximum 262144"),
      includeViewport: boolParam("Include recent history in addition to delta; default false"),
      ...CLI_ASSIST_PARAMETERS,
    },
    execute: async (args, exec) => state.send(owner(exec), args.session, { ...args, signal: exec.signal }),
  });
  registerTool(ctx, {
    name: "remote_terminal_input",
    description: "Write raw terminal input immediately without waiting. Use for Tab completion, arrow keys, password prompts, interactive programs, or control characters.",
    parameters: {
      session: stringParam("Session id or environment id", true),
      text: stringParam("Raw UTF-8 terminal input", true),
    },
    execute: async (args, exec) => state.input(owner(exec), args.session, args.text),
  });
  registerTool(ctx, {
    name: "remote_terminal_read",
    description: "Read the same terminal stream shown in Remote Ops, including local-cmd. Omit cursor for recent history; then pass nextOffset as cursor and streamId to read only new output. waitMs long-polls without typing. hasMore requires another read; reset/truncated signals missing history. No output does not mean command completion. offset/count explicitly selects backward line history instead.",
    parameters: {
      session: stringParam("SSH session id or local-cmd", true),
      cursor: numberParam("Absolute nextOffset from the previous send/read"),
      streamId: stringParam("Output stream identity from the previous send/read"),
      waitMs: numberParam("Wait for new output, 0-25000 milliseconds"),
      maxChars: numberParam("Output page size; default 16384"),
      offset: numberParam("Newest-relative line offset for explicit history browsing"),
      count: numberParam("History line count"),
    },
    execute: async (args, exec) => state.readTerminal(owner(exec), args.session, { ...args, signal: exec.signal }),
  });
  registerTool(ctx, {
    name: "remote_terminal_signal",
    description: "Interrupt the foreground process in a visible SSH terminal or local-cmd.",
    parameters: {
      session: stringParam("SSH session id or local-cmd", true),
      signal: stringParam("Signal such as SIGINT or SIGTERM", true),
    },
    execute: async (args, exec) => state.signal(owner(exec), args.session, args.signal),
  });
  registerTool(ctx, {
    name: "remote_terminal_close",
    description: "Close an owner-scoped SSH terminal.",
    parameters: { session: stringParam("Session id", true) },
    execute: async (args, exec) => {
      const record = state.getSession(owner(exec), args.session);
      await ctx.terminals.kill(owner(exec), record.sessionId, "agent request");
      state.sessions.delete(record.sessionId);
      return { closed: true, sessionId: record.sessionId };
    },
  });
  registerTool(ctx, {
    name: "remote_terminal_batch",
    description: "Open at most one owner-scoped SSH connection per target and execute complete commands sequentially on that explicit session.",
    parameters: {
      targets: { type: "array", required: true, items: { type: "string" }, description: "Environment ids or names" },
      commands: { type: "array", required: true, items: { type: "string" }, description: "Complete commands in order" },
      timeoutSeconds: numberParam("Per-command timeout"),
      quietMs: numberParam("Silence before yielding per command; default 700 ms"),
      ...CLI_ASSIST_PARAMETERS,
    },
    execute: async (args, exec) => {
      const results = [];
      for (const target of args.targets) { const opened = await state.open(owner(exec), target); const targetResults = []; for (const command of args.commands) targetResults.push(await state.send(owner(exec), opened.sessionId, { ...pickCliAssist(args), text: command, submit: true, timeoutSeconds: args.timeoutSeconds, signal: exec.signal })); results.push({ target, sessionId: opened.sessionId, results: targetResults }); } return { results };
    },
  });
  registerTool(ctx, {
    name: "remote_quick_command_list",
    description: "List saved quick commands and groups.",
    parameters: {},
    execute: async () => {
      await state.ready;
      return { groups: state.quickGroupList(), commands: state.quickCommands };
    },
  });
  registerTool(ctx, {
    name: "remote_quick_command_save",
    description: "Create or replace a saved quick command. The command can contain multiple lines.",
    parameters: {
      id: stringParam("Stable command id", true),
      name: stringParam("Display name", true),
      command: stringParam("Complete command text", true),
      group: stringParam("Quick command group"),
    },
    execute: async (args) => state.saveQuickCommand({ ...args, group: normalizeGroupName(args.group) }),
  });
  registerTool(ctx, {
    name: "remote_quick_command_delete",
    description: "Delete a saved quick command.",
    parameters: { commandId: stringParam("Quick command id", true) },
    execute: async (args) => state.deleteQuickCommand(args.commandId),
  });
  registerTool(ctx, {
    name: "remote_quick_command_group_create",
    description: "Create an empty quick command group.",
    parameters: { group: stringParam("Quick command group", true) },
    execute: async (args) => state.createQuickGroup(args.group),
  });
  registerTool(ctx, {
    name: "remote_quick_command_group_delete",
    description: "Delete an empty quick command group.",
    parameters: { group: stringParam("Quick command group", true) },
    execute: async (args) => state.deleteQuickGroup(args.group),
  });
  registerTool(ctx, {
    name: "remote_quick_command_run",
    description: "Run a saved quick command on one explicit environment.",
    parameters: {
      commandId: stringParam("Quick command id", true),
      environment: stringParam("Environment id or name", true),
      ...CLI_ASSIST_PARAMETERS,
    },
    execute: async (args, exec) => {
      await state.ready;
      const command = state.quickCommands.find((x) => x.id === args.commandId);
      if (!command) throw sessionError("REMOTE_QUICK_COMMAND_NOT_FOUND", args.commandId);
      return state.send(owner(exec), undefined, { ...pickCliAssist(args), environment: args.environment, text: command.command, submit: true });
    },
  });
  registerTool(ctx, {
    name: "remote_sftp_list",
    description: "List a remote SFTP directory.",
    parameters: {
      environment: stringParam("Environment id or name", true),
      path: stringParam("Remote path"),
    },
    execute: async (args, exec) => state.sftp(owner(exec), args.environment, "list", args),
  });
  registerTool(ctx, {
    name: "remote_sftp_read",
    description: "Read a bounded UTF-8 remote SFTP file.",
    parameters: {
      environment: stringParam("Environment id or name", true),
      path: stringParam("Remote path", true),
    },
    execute: async (args, exec) => state.sftp(owner(exec), args.environment, "read", args),
  });
  registerTool(ctx, {
    name: "remote_sftp_write",
    description: "Write a UTF-8 remote SFTP file.",
    parameters: {
      environment: stringParam("Environment id or name", true),
      path: stringParam("Remote path", true),
      content: stringParam("UTF-8 file content", true),
    },
    execute: async (args, exec) => state.sftp(owner(exec), args.environment, "write", args),
  });
  registerTool(ctx, {
    name: "remote_sftp_mkdir",
    description: "Create a remote SFTP directory.",
    parameters: {
      environment: stringParam("Environment id or name", true),
      path: stringParam("Remote path", true),
    },
    execute: async (args, exec) => state.sftp(owner(exec), args.environment, "mkdir", args),
  });
  registerTool(ctx, {
    name: "remote_sftp_delete",
    description: "Delete a remote SFTP file or directory.",
    parameters: {
      environment: stringParam("Environment id or name", true),
      path: stringParam("Remote path", true),
    },
    execute: async (args, exec) => state.sftp(owner(exec), args.environment, "delete", args),
  });
  registerTool(ctx, {
    name: "remote_sftp_rename",
    description: "Rename a remote SFTP file or directory.",
    parameters: {
      environment: stringParam("Environment id or name", true),
      from: stringParam("Existing path", true),
      to: stringParam("New path", true),
    },
    execute: async (args, exec) => state.sftp(owner(exec), args.environment, "rename", args),
  });
  registerTool(ctx, {
    name: "remote_sftp_upload",
    description: "Stream one DSH-host file to SFTP. Existing targets are rejected unless overwrite is explicitly true.",
    parameters: {
      environment: stringParam("Environment id or name", true),
      localPath: stringParam("DSH-host file path", true),
      remotePath: stringParam("Remote file path", true),
      overwrite: boolParam("Replace an existing target; default false"),
    },
    execute: async (args, exec) => state.sftp(owner(exec), args.environment, "upload", { ...args, signal: exec.signal }),
  });
  registerTool(ctx, {
    name: "remote_sftp_download",
    description: "Stream one SFTP file to the DSH host. Existing targets are rejected unless overwrite is explicitly true.",
    parameters: {
      environment: stringParam("Environment id or name", true),
      remotePath: stringParam("Remote file path", true),
      localPath: stringParam("DSH-host file path", true),
      overwrite: boolParam("Replace an existing target; default false"),
    },
    execute: async (args, exec) => state.sftp(owner(exec), args.environment, "download", { ...args, signal: exec.signal }),
  });
  registerTool(ctx, {
    name: "remote_diagnostics",
    description: "Read recent remote operation diagnostics for this Agent.",
    parameters: {},
    execute: async (_args, exec) => ({ events: state.events.get(ownerId(owner(exec))) ?? [] }),
  });
}

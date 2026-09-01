import type {
  AgentConversation,
  AgentEvent,
  AgentGoal,
  AgentQueuedInput,
  AgentRunResult,
  AgentSettings,
  AiChatResult,
  AiMessage,
  AiProfile,
  AiTestResult,
  AppFontScale,
  AppTheme,
  LocalEntry,
  McpToolInfo,
  MessageChannel,
  QuickCommand,
  QuickCommandImportPreview,
  QuickCommandImportResult,
  QuickCommandImportStrategy,
  RemoteEntry,
  SessionInfo,
  SessionProfile,
  TerminalPalette,
  TerminalScreenSnapshot,
  TransferProgress,
} from "../ipc";

interface PortableQuickCommand {
  label: string;
  group: string;
  command: string;
  send_newline: boolean;
  sort: number;
}

interface ParsedQuickCommands {
  format: "myterm" | "xshell_qbl";
  version: string;
  total: number;
  skipped: number;
  commands: PortableQuickCommand[];
}

function decodeQuickCommandBytes(bytes: number[]) {
  const source = Uint8Array.from(bytes);
  if (source[0] === 0xff && source[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(source.slice(2));
  }
  if (source[0] === 0xfe && source[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(source.slice(2));
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(source);
}

function parseDemoQuickCommands(fileName: string, bytes: number[]): ParsedQuickCommands {
  const source = decodeQuickCommandBytes(bytes)
    .replace(/^\uFEFF/, "")
    .trim();
  if (source.startsWith("{")) {
    const value = JSON.parse(source) as {
      format?: string;
      version?: number;
      commands?: PortableQuickCommand[];
    };
    if (value.format !== "myterm.quick-commands" || value.version !== 1) {
      throw new Error("不支持的 myterm 快捷命令文件");
    }
    const commands = (value.commands ?? []).filter(
      (command) => command.label?.trim() && command.group?.trim() && command.command?.trim(),
    );
    return {
      format: "myterm",
      version: "1",
      total: value.commands?.length ?? 0,
      skipped: (value.commands?.length ?? 0) - commands.length,
      commands,
    };
  }

  const sections = new Map<string, Map<string, string>>();
  let current = "";
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      current = line.slice(1, -1).toLowerCase();
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const section = sections.get(current) ?? new Map<string, string>();
    section.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1));
    sections.set(current, section);
  }
  const info = sections.get("info");
  const quick = sections.get("quickbutton");
  if (!quick) throw new Error("Xshell QBL 缺少 [QuickButton] 命令区");
  const total = Number(info?.get("count") ?? 0);
  const group = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || "Xshell 导入";
  const commands: PortableQuickCommand[] = [];
  let skipped = 0;
  for (let index = 0; index < total; index += 1) {
    const type = quick.get(`button_${index}_type`) ?? quick.get(`type_${index}`);
    const label = quick.get(`button_${index}_name`) ?? quick.get(`label_${index}`) ?? "";
    const action = quick.get(`button_${index}_action`) ?? quick.get(`text_${index}`) ?? "";
    if (Number(type) !== 1 || !label.trim() || !action) {
      skipped += 1;
      continue;
    }
    const unescaped = action.replace(/\\r/g, "\r").replace(/\\n/g, "\n");
    commands.push({
      label: label.trim(),
      group,
      command: unescaped.replace(/[\r\n]+$/, "").replace(/\r\n?/g, "\n"),
      send_newline: /[\r\n]$/.test(unescaped),
      sort: index,
    });
  }
  return {
    format: "xshell_qbl",
    version: info?.get("version") ?? "legacy",
    total,
    skipped,
    commands,
  };
}

const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  permission_mode: "confirm",
  skill_directories: [],
  enabled_skills: [],
  mcp_servers: [],
};

const DEFAULT_PROFILES: SessionProfile[] = [
  {
    id: "profile-prod-web-01",
    name: "prod-web-01",
    group: "生产环境/Web",
    target: {
      kind: "ssh",
      host: "192.168.1.10",
      port: 22,
      username: "root",
      auth: { kind: "password", vault_ref: "profile.profile-prod-web-01.password" },
    },
  },
  {
    id: "profile-db-master",
    name: "db-master",
    group: "生产环境/Database",
    target: {
      kind: "ssh",
      host: "192.168.1.20",
      port: 22,
      username: "dba",
      auth: { kind: "password", vault_ref: "profile.profile-db-master.password" },
    },
  },
  {
    id: "profile-test-app",
    name: "test-app-01",
    group: "测试环境",
    target: {
      kind: "ssh",
      host: "10.0.3.15",
      port: 22,
      username: "deploy",
      auth: { kind: "password", vault_ref: "profile.profile-test-app.password" },
    },
  },
  {
    id: "profile-local-powershell",
    name: "PowerShell",
    group: "本地终端",
    target: { kind: "local", shell: "powershell.exe" },
  },
];

const DEFAULT_COMMANDS: QuickCommand[] = [
  { id: "quick-df", label: "磁盘", group: "常用", command: "df -h", send_newline: true, sort: 0 },
  {
    id: "quick-free",
    label: "内存",
    group: "常用",
    command: "free -h",
    send_newline: true,
    sort: 1,
  },
  {
    id: "quick-ports",
    label: "监听端口",
    group: "常用",
    command: "ss -lntp",
    send_newline: true,
    sort: 2,
  },
  {
    id: "quick-service",
    label: "服务状态",
    group: "部署",
    command: "systemctl status app",
    send_newline: true,
    sort: 0,
  },
  {
    id: "quick-restart",
    label: "重启 Nginx",
    group: "部署",
    command: "sudo systemctl restart nginx",
    send_newline: false,
    sort: 1,
  },
  {
    id: "quick-logs",
    label: "追踪日志",
    group: "排查",
    command: "tail -f /var/log/app/app.log",
    send_newline: true,
    sort: 0,
  },
];

const DEFAULT_AI_PROFILES: AiProfile[] = [
  {
    id: "ai-deepseek",
    name: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    api_key_ref: "ai.ai-deepseek.key",
    auth_mode: "bearer",
    models: [
      { id: "primary", name: "主模型", model: "deepseek-chat", role: "primary", enabled: true },
      {
        id: "analysis",
        name: "分析模型",
        model: "deepseek-reasoner",
        role: "analysis",
        enabled: true,
      },
      {
        id: "fallback",
        name: "备用模型",
        model: "deepseek-chat",
        role: "fallback",
        enabled: false,
      },
    ],
    routing: { fallback_on_error: true, analysis_threshold_chars: 32000 },
    system_prompt: "",
  },
  {
    id: "ai-ollama",
    name: "Ollama 本地",
    base_url: "http://localhost:11434/v1",
    api_key_ref: "ai.ai-ollama.key",
    auth_mode: "bearer",
    models: [{ id: "primary", name: "主模型", model: "qwen2.5", role: "primary", enabled: true }],
    routing: { fallback_on_error: true, analysis_threshold_chars: 32000 },
    system_prompt: "",
  },
];

const terminalGreeting = `\r\n\x1b[38;5;108mmyterm demo session\x1b[0m\r\nLast login: Sat Aug  8 20:42:11 2026\r\nroot@prod-web-01:~# systemctl status nginx\r\n● nginx.service - A high performance web server\r\n   Active: \x1b[31mfailed\x1b[0m (Result: exit-code)\r\nroot@prod-web-01:~# df -h /\r\n/dev/vda1        99G   87G  6.9G  93% /\r\nroot@prod-web-01:~# `;

const commandReplies: Record<string, string> = {
  "df -h":
    "\r\nFilesystem      Size  Used Avail Use% Mounted on\r\n/dev/vda1        99G   87G  6.9G  93% /\r\nroot@prod-web-01:~# ",
  "free -h":
    "\r\n              total        used        free      shared  buff/cache   available\r\nMem:           15Gi        11Gi       1.2Gi       345Mi       3.1Gi       3.4Gi\r\nroot@prod-web-01:~# ",
  "ss -lntp":
    '\r\nLISTEN 0 4096 0.0.0.0:22  0.0.0.0:* users:(("sshd",pid=704,fd=3))\r\nroot@prod-web-01:~# ',
};

function publishDemoTerminalOutput(sessionId: string, dataUtf8: string) {
  window.dispatchEvent(
    new CustomEvent("myterm:terminal-output", {
      detail: { sessionId, dataUtf8 },
    }),
  );
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeAgentSettings(settings: AgentSettings): AgentSettings {
  if ((settings.permission_mode as string) === "task_grant") {
    return { ...settings, permission_mode: "full_access" };
  }
  return settings;
}

class DemoBackend {
  private profiles = readStored("myterm.demo.profiles", DEFAULT_PROFILES);
  private commands = readStored("myterm.demo.commands", DEFAULT_COMMANDS);
  private aiProfiles = readStored("myterm.demo.ai-profiles", DEFAULT_AI_PROFILES);
  private agentSettings = normalizeAgentSettings(
    readStored("myterm.demo.agent-settings", DEFAULT_AGENT_SETTINGS),
  );
  private theme = readStored<AppTheme>("myterm.demo.theme", "dark");
  private fontScale = readStored<AppFontScale>("myterm.demo.font-scale", "standard");
  private terminalFontSize = readStored<number>("myterm.demo.terminal-font-size", 13);
  private terminalPalette = readStored<TerminalPalette>(
    "myterm.demo.terminal-palette",
    "graphite_gold",
  );
  private sessions = new Map<string, SessionInfo>();
  private sinks = new Map<string, MessageChannel<ArrayBuffer>>();
  private sessionHandlers = new Set<(payload: SessionInfo) => void>();
  private transferHandlers = new Set<(payload: TransferProgress) => void>();
  private transferTimers = new Map<string, number>();
  private aborted = false;
  private agentAborted = false;
  private approvals = new Map<string, (approved: boolean) => void>();
  private agentConversations: AgentConversation[] = [];
  private agentGoals = new Map<string, AgentGoal>();

  async appThemeGet() {
    return this.theme;
  }

  async appThemeSave(theme: AppTheme) {
    this.theme = theme;
    writeStored("myterm.demo.theme", theme);
    return theme;
  }

  async appFontScaleGet() {
    return this.fontScale;
  }

  async appFontScaleSave(scale: AppFontScale) {
    this.fontScale = scale;
    writeStored("myterm.demo.font-scale", scale);
    return scale;
  }

  async terminalFontSizeGet() {
    return this.terminalFontSize;
  }

  async terminalFontSizeSave(size: number) {
    this.terminalFontSize = Math.max(12, Math.min(22, Math.round(size)));
    writeStored("myterm.demo.terminal-font-size", this.terminalFontSize);
    return this.terminalFontSize;
  }

  async terminalPaletteGet() {
    return this.terminalPalette;
  }

  async terminalPaletteSave(palette: TerminalPalette) {
    this.terminalPalette = palette;
    writeStored("myterm.demo.terminal-palette", palette);
    return palette;
  }

  async sessionConnect(
    profileId: string,
    _cols: number,
    _rows: number,
    sink: MessageChannel<ArrayBuffer>,
  ) {
    const sessionId = crypto.randomUUID();
    const connecting: SessionInfo = {
      session_id: sessionId,
      profile_id: profileId,
      state: "connecting",
      error: null,
    };
    this.sessions.set(sessionId, connecting);
    this.sinks.set(sessionId, sink);
    this.emitSession(connecting);
    await new Promise((resolve) => window.setTimeout(resolve, 260));
    const connected = { ...connecting, state: "connected" as const };
    this.sessions.set(sessionId, connected);
    this.emitSession(connected);
    sink.onmessage(new TextEncoder().encode(terminalGreeting).buffer);
    return connected;
  }

  async sessionDisconnect(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const disconnected = { ...session, state: "disconnected" as const };
    this.sessions.set(sessionId, disconnected);
    this.emitSession(disconnected);
  }

  async sessionList() {
    return [...this.sessions.values()];
  }

  async terminalWrite(sessionId: string, data: string) {
    const sink = this.sinks.get(sessionId);
    if (!sink) return;
    const echoedInput = data.replace(/\r(?!\n)/g, "\r\n");
    sink.onmessage(new TextEncoder().encode(echoedInput).buffer);
    publishDemoTerminalOutput(sessionId, echoedInput);
    const command = data.replace(/[\r\n]+$/g, "");
    const reply = commandReplies[command];
    if (reply && data.includes("\r")) {
      window.setTimeout(() => {
        sink.onmessage(new TextEncoder().encode(reply).buffer);
        publishDemoTerminalOutput(sessionId, reply);
      }, 90);
    }
  }

  async terminalResize(_sessionId: string, _cols: number, _rows: number) {}

  async terminalScreenUpdate(_sessionId: string, _snapshot: TerminalScreenSnapshot) {}

  async profileList() {
    return structuredClone(this.profiles);
  }

  async profileSave(profile: SessionProfile, _secret?: string) {
    const index = this.profiles.findIndex((candidate) => candidate.id === profile.id);
    if (index >= 0) this.profiles[index] = profile;
    else this.profiles.push(profile);
    writeStored("myterm.demo.profiles", this.profiles);
    return structuredClone(profile);
  }

  async profileDelete(profileId: string) {
    this.profiles = this.profiles.filter((profile) => profile.id !== profileId);
    writeStored("myterm.demo.profiles", this.profiles);
  }

  async vaultSet(_ref: string, _secret: string) {}
  async vaultDelete(_ref: string) {}

  async quickCommandList() {
    return structuredClone(this.commands);
  }

  async quickCommandSave(command: QuickCommand) {
    const index = this.commands.findIndex((candidate) => candidate.id === command.id);
    if (index >= 0) this.commands[index] = command;
    else this.commands.push(command);
    writeStored("myterm.demo.commands", this.commands);
  }

  async quickCommandDelete(id: string) {
    this.commands = this.commands.filter((command) => command.id !== id);
    writeStored("myterm.demo.commands", this.commands);
  }

  async quickCommandImportPreview(
    fileName: string,
    bytes: number[],
  ): Promise<QuickCommandImportPreview> {
    const parsed = parseDemoQuickCommands(fileName, bytes);
    let duplicates = 0;
    let conflicts = 0;
    for (const candidate of parsed.commands) {
      const existing = this.commands.find(
        (command) => command.group === candidate.group && command.label === candidate.label,
      );
      if (!existing) continue;
      if (
        existing.command === candidate.command &&
        existing.send_newline === candidate.send_newline
      ) {
        duplicates += 1;
      } else {
        conflicts += 1;
      }
    }
    return {
      source_format: parsed.format,
      source_version: parsed.version,
      total: parsed.total,
      importable: parsed.commands.length - duplicates,
      duplicates,
      conflicts,
      skipped: parsed.skipped,
      groups: [...new Set(parsed.commands.map((command) => command.group))].sort(),
    };
  }

  async quickCommandImportApply(
    fileName: string,
    bytes: number[],
    strategy: QuickCommandImportStrategy,
  ): Promise<QuickCommandImportResult> {
    const parsed = parseDemoQuickCommands(fileName, bytes);
    const result: QuickCommandImportResult = {
      imported: 0,
      replaced: 0,
      renamed: 0,
      duplicates: 0,
      skipped: parsed.skipped,
    };
    for (const candidate of parsed.commands) {
      const existing = this.commands.find(
        (command) => command.group === candidate.group && command.label === candidate.label,
      );
      if (
        existing?.command === candidate.command &&
        existing.send_newline === candidate.send_newline
      ) {
        result.duplicates += 1;
        continue;
      }
      if (existing && strategy === "overwrite") {
        existing.command = candidate.command;
        existing.send_newline = candidate.send_newline;
        result.replaced += 1;
        continue;
      }
      let label = candidate.label;
      if (existing) {
        let suffix = 1;
        do {
          label = `${candidate.label} (导入${suffix === 1 ? "" : ` ${suffix}`})`;
          suffix += 1;
        } while (
          this.commands.some(
            (command) => command.group === candidate.group && command.label === label,
          )
        );
        result.renamed += 1;
      }
      const sort =
        Math.max(
          -1,
          ...this.commands
            .filter((command) => command.group === candidate.group)
            .map((command) => command.sort),
        ) + 1;
      this.commands.push({ ...candidate, id: crypto.randomUUID(), label, sort });
      result.imported += 1;
    }
    writeStored("myterm.demo.commands", this.commands);
    return result;
  }

  async quickCommandExport(group?: string) {
    const commands = this.commands
      .filter((command) => !group || command.group === group)
      .sort(
        (left, right) =>
          left.group.localeCompare(right.group) ||
          left.sort - right.sort ||
          left.label.localeCompare(right.label),
      )
      .map(({ label, group: commandGroup, command, send_newline, sort }) => ({
        label,
        group: commandGroup,
        command,
        send_newline,
        sort,
      }));
    return JSON.stringify(
      {
        format: "myterm.quick-commands",
        version: 1,
        exported_at: Math.floor(Date.now() / 1000),
        scope: group ?? "all",
        commands,
      },
      null,
      2,
    );
  }

  async sftpReadDir(_sessionId: string, path: string): Promise<RemoteEntry[]> {
    return [
      {
        name: "logs",
        path: `${path}/logs`,
        is_dir: true,
        size: 0,
        modified: 1_776_000_000,
        permissions: "rwxr-x---",
      },
      {
        name: "app.jar",
        path: `${path}/app.jar`,
        is_dir: false,
        size: 50_226_124,
        modified: 1_776_012_000,
        permissions: "rw-r--r--",
      },
      {
        name: "nginx.conf",
        path: `${path}/nginx.conf`,
        is_dir: false,
        size: 4096,
        modified: 1_775_990_000,
        permissions: "rw-r--r--",
      },
      {
        name: "backup.tar.gz",
        path: `${path}/backup.tar.gz`,
        is_dir: false,
        size: 1_288_490_189,
        modified: 1_775_800_000,
        permissions: "rw-------",
      },
    ];
  }

  async sftpDefaultDirectory(_sessionId: string) {
    return "/opt/app";
  }

  async localReadDir(path: string): Promise<LocalEntry[]> {
    return [
      { name: "dist", path: `${path}\\dist`, is_dir: true, size: 0, modified: 1_776_000_000 },
      {
        name: "app.jar",
        path: `${path}\\app.jar`,
        is_dir: false,
        size: 50_540_544,
        modified: 1_776_012_000,
      },
      {
        name: "config.yaml",
        path: `${path}\\config.yaml`,
        is_dir: false,
        size: 2048,
        modified: 1_775_990_000,
      },
    ];
  }

  async localDefaultDirectory() {
    return "C:\\deploy";
  }

  async sftpMkdir(_sessionId: string, _path: string) {}
  async sftpRename(_sessionId: string, _from: string, _to: string) {}
  async sftpDelete(_sessionId: string, _path: string, _recursive: boolean) {}

  async sftpUpload(_sessionId: string, _localPath: string, _remotePath: string) {
    return this.startTransfer(50_540_544);
  }

  async sftpDownload(_sessionId: string, _remotePath: string, _localPath: string) {
    return this.startTransfer(1_288_490_189);
  }

  async transferCancel(transferId: string) {
    const timer = this.transferTimers.get(transferId);
    if (timer) window.clearInterval(timer);
    this.transferTimers.delete(transferId);
    this.emitTransfer({
      transfer_id: transferId,
      state: "cancelled",
      transferred: 0,
      total: 0,
      bytes_per_sec: 0,
      error: null,
    });
  }

  async aiProfileList() {
    return structuredClone(this.aiProfiles);
  }

  async aiConfigJson() {
    return {
      version: 2,
      quick_commands: structuredClone(this.commands),
      profiles: structuredClone(this.aiProfiles),
      agent: structuredClone(this.agentSettings),
    };
  }

  async configOpenLocal() {
    return "浏览器演示模式没有本地配置文件";
  }

  async aiProfileSave(profile: AiProfile, _apiKey?: string) {
    const index = this.aiProfiles.findIndex((candidate) => candidate.id === profile.id);
    if (index >= 0) this.aiProfiles[index] = profile;
    else this.aiProfiles.push(profile);
    writeStored("myterm.demo.ai-profiles", this.aiProfiles);
  }

  async aiProfileDelete(profileId: string) {
    this.aiProfiles = this.aiProfiles.filter((profile) => profile.id !== profileId);
    writeStored("myterm.demo.ai-profiles", this.aiProfiles);
  }

  async aiTestConnection(_profileId: string): Promise<AiTestResult> {
    return this.aiFetchModels(_profileId);
  }

  async aiFetchModels(_profileId: string): Promise<AiTestResult> {
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    const modelDetails = [
      { id: "deepseek-chat", object: "model", owned_by: "deepseek" },
      { id: "deepseek-reasoner", object: "model", owned_by: "deepseek" },
      { id: "deepseek-coder", object: "model", owned_by: "deepseek" },
    ];
    return {
      ok: true,
      models: 34,
      modelDetails,
      endpoint: "https://api.deepseek.com/v1/models",
      rawResponse: JSON.stringify({ object: "list", data: modelDetails }, null, 2),
    };
  }

  async aiTestModel(_profileId: string, model: string, prompt: string) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const content = `模型 ${model} 已收到测试提示词：${prompt}`;
    return {
      ok: true,
      model,
      content,
      elapsedMs: 486,
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      rawResponse: JSON.stringify(
        { model, choices: [{ message: { role: "assistant", content } }] },
        null,
        2,
      ),
    };
  }

  async aiChat(
    _profileId: string,
    messages: AiMessage[],
    attachSessionId: string | null,
    sink: MessageChannel<string>,
  ): Promise<AiChatResult> {
    this.aborted = false;
    const question = messages.at(-1)?.content ?? "";
    const response = question.includes("命令")
      ? "可以先确认当前目录的磁盘占用：\n\n```bash\ndu -xh --max-depth=1 / 2>/dev/null | sort -rh | head -10\n```\n\n命令只会回填到终端，不会自动执行。"
      : "从终端输出看，根分区使用率已达到 93%，这很可能是服务异常的直接诱因。建议先定位占用最大的目录：\n\n```bash\ndu -xh --max-depth=1 / 2>/dev/null | sort -rh | head -10\n```\n\n确认结果后再清理滚动日志或临时文件。";
    const context = attachSessionId
      ? '[Terminal transcript of session "prod-web-01" (on-demand ranges)]\n```\nActive: failed\n/dev/vda1  99G  87G  6.9G  93% /\n```'
      : undefined;
    for (const piece of response.match(/.{1,3}/gu) ?? []) {
      if (this.aborted) return { finishReason: "aborted", attachedContext: context };
      await new Promise((resolve) => window.setTimeout(resolve, 24));
      sink.onmessage(piece);
    }
    return { finishReason: "stop", attachedContext: context };
  }

  async aiAbort() {
    this.aborted = true;
  }

  async agentSettingsGet() {
    return structuredClone(this.agentSettings);
  }

  async agentPluginList() {
    return [
      {
        id: "deepseek-harness",
        name: "DeepSeek Harness Agent",
        version: "browser-demo",
        kind: "runtime",
        description:
          "官方 DeepSeek Harness ACP 运行时，保留本地工具，并通过 myterm Host MCP 使用 SSH、CLI、SFTP 和多 SSH 工具。",
        requires: ["codex-core", "ssh.operations", "skills", "mcp"],
        enabled: true,
      },
    ];
  }

  async agentSettingsSave(settings: AgentSettings) {
    this.agentSettings = structuredClone(settings);
    writeStored("myterm.demo.agent-settings", this.agentSettings);
    return structuredClone(this.agentSettings);
  }

  async agentSkillList(skillDirectories = this.agentSettings.skill_directories) {
    return skillDirectories.length
      ? [
          {
            id: `${skillDirectories[0]}\\incident-response\\SKILL.md`,
            name: "incident-response",
            description: "按标准流程收集服务状态、日志和资源占用。",
            path: `${skillDirectories[0]}\\incident-response\\SKILL.md`,
            contentHash: "demo-skill-sha256",
            platforms: ["linux"],
            allowedTools: ["host_facts", "remote_exec", "file_read"],
            risk: "read_only",
            modelInvocable: true,
            trusted: false,
          },
        ]
      : [];
  }

  async agentMcpTest(server: AgentSettings["mcp_servers"][number]): Promise<McpToolInfo[]> {
    await new Promise((resolve) => window.setTimeout(resolve, 320));
    return [
      {
        serverId: server.id,
        serverName: server.name,
        transport: server.transport,
        capabilityId: `mcp:${server.id}:list`,
        name: `mcp__${server.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}__list`,
        title: "列出资源",
        description: "列出服务器提供的资源。",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string", description: "要读取的资源路径" } },
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: { resources: { type: "array" } },
          required: ["resources"],
        },
        annotations: { readOnlyHint: true },
      },
    ];
  }

  async agentRun(
    profileId: string,
    requestedConversationId: string | null,
    prompt: string,
    activeSessionId: string | null,
    sink: MessageChannel<AgentEvent>,
  ): Promise<AgentRunResult> {
    this.agentAborted = false;
    const runId = crypto.randomUUID();
    const conversationId =
      requestedConversationId ?? (await this.agentConversationCreate(profileId, prompt)).id;
    const existingGoal = this.agentGoals.get(conversationId);
    const now = Date.now();
    this.agentGoals.set(conversationId, {
      id: existingGoal?.id ?? crypto.randomUUID(),
      conversationId,
      objective:
        existingGoal?.status === "completed" ? prompt : (existingGoal?.objective ?? prompt),
      status: "active",
      tokenBudget: null,
      tokensUsed: existingGoal?.tokensUsed ?? 0,
      continuationCount: existingGoal?.continuationCount ?? 0,
      currentTurnId: runId,
      createdAtMs: existingGoal?.createdAtMs ?? now,
      updatedAtMs: now,
      completedAtMs: null,
      lastCheckpoint: existingGoal?.lastCheckpoint ?? null,
      lastError: null,
      blockedReason: null,
      noProgressCount: 0,
    });
    const callId = crypto.randomUUID();
    let sequence = 0;
    const emit = (event: Omit<AgentEvent, "schemaVersion" | "sequence" | "createdAtMs">) => {
      sequence += 1;
      sink.onmessage({ ...event, schemaVersion: 1, sequence, createdAtMs: Date.now() });
    };
    emit({ eventType: "status", runId, message: "正在判断任务范围和可用工具" });
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    emit({ eventType: "status", runId, step: 1, message: "模型决策 · 1/8" });
    const usesMcp = /\bmcp\b/iu.test(prompt);
    const usesActiveSession = /当前|终端|这台|本机|服务器|ssh|磁盘|内存|命令/iu.test(prompt);
    if (!usesMcp && !usesActiveSession) {
      emit({
        eventType: "assistant",
        runId,
        step: 1,
        content: "这是一个通用任务，不需要读取活动 SSH。Agent 会保持终端上下文未加载。",
      });
      emit({ eventType: "complete", runId, step: 1, message: "stop" });
      return {
        runId,
        conversationId,
        turnId: runId,
        finishReason: "stop",
        steps: 1,
        modelRequests: 1,
        toolCalls: 0,
        promptTokens: 160,
        completionTokens: 32,
        totalTokens: 192,
      };
    }
    const toolName = usesMcp ? "mcp_status" : "session_info";
    const toolArguments = usesMcp ? {} : { use_active_session: true };
    emit({
      eventType: "tool_requested",
      runId,
      step: 1,
      callId,
      toolName,
      arguments: toolArguments,
    });
    const requiresApproval = !["mcp_status", "session_info"].includes(toolName);
    if (this.agentSettings.permission_mode === "confirm" && requiresApproval) {
      emit({
        eventType: "approval_required",
        runId,
        step: 1,
        callId,
        toolName,
        arguments: toolArguments,
      });
      const approved = await new Promise<boolean>((resolve) => this.approvals.set(callId, resolve));
      if (!approved || this.agentAborted) {
        emit({
          eventType: "tool_result",
          runId,
          step: 1,
          callId,
          toolName,
          content: this.agentAborted ? "任务已停止" : "用户拒绝了本次工具调用",
          isError: true,
        });
        emit({
          eventType: "complete",
          runId,
          step: 1,
          message: this.agentAborted ? "aborted" : "stop",
        });
        return {
          runId,
          conversationId,
          turnId: runId,
          finishReason: this.agentAborted ? "aborted" : "stop",
          steps: 1,
          modelRequests: 1,
          toolCalls: 1,
          promptTokens: 180,
          completionTokens: 24,
          totalTokens: 204,
        };
      }
    }
    const activeSession = activeSessionId ? this.sessions.get(activeSessionId) : undefined;
    emit({
      eventType: "tool_result",
      runId,
      step: 1,
      callId,
      toolName,
      content: usesMcp
        ? JSON.stringify(
            {
              configuredCount: 1,
              readyCount: 1,
              servers: [{ serverName: "CLI Docs", status: "ready", toolCount: 3 }],
            },
            null,
            2,
          )
        : JSON.stringify(
            { session: activeSession ?? null, profile: "prod-web-01", activeCandidate: true },
            null,
            2,
          ),
      isError: false,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    const answer = usesMcp
      ? "MCP 服务器已连接并完成工具发现；本次诊断没有读取活动 SSH。"
      : prompt.includes("磁盘")
        ? "已读取活动会话。根分区使用率较高，建议先运行 `du` 定位占用目录，再决定清理范围。"
        : "已读取活动会话信息，当前连接可用，可以继续执行终端排查。";
    emit({ eventType: "assistant", runId, step: 2, content: answer });
    emit({ eventType: "complete", runId, step: 2, message: "stop" });
    const goal = this.agentGoals.get(conversationId);
    if (goal) {
      this.agentGoals.set(conversationId, {
        ...goal,
        status: "completed",
        tokensUsed: goal.tokensUsed + 356,
        updatedAtMs: Date.now(),
        completedAtMs: Date.now(),
      });
    }
    emit({
      eventType: "runtime_metrics",
      runId,
      message: "本轮模型请求 2 次 · 工具调用 1 次 · Token 356",
      arguments: {
        modelRequests: 2,
        toolCalls: 1,
        promptTokens: 302,
        completionTokens: 54,
        totalTokens: 356,
      },
    });
    return {
      runId,
      conversationId,
      turnId: runId,
      finishReason: "stop",
      steps: 2,
      modelRequests: 2,
      toolCalls: 1,
      promptTokens: 302,
      completionTokens: 54,
      totalTokens: 356,
    };
  }

  async agentConversationCreate(profileId: string, title?: string) {
    const now = Date.now();
    const conversation: AgentConversation = {
      id: crypto.randomUUID(),
      title: title?.trim() || "新对话",
      profileId,
      createdAtMs: now,
      updatedAtMs: now,
      turnCount: 0,
    };
    this.agentConversations.unshift(conversation);
    return conversation;
  }

  async agentConversationList(limit: number) {
    return this.agentConversations.slice(0, limit);
  }

  async agentConversationDelete(conversationId: string) {
    const before = this.agentConversations.length;
    this.agentConversations = this.agentConversations.filter(
      (conversation) => conversation.id !== conversationId,
    );
    this.agentGoals.delete(conversationId);
    return this.agentConversations.length !== before;
  }

  async agentGoalGet(conversationId: string) {
    return structuredClone(this.agentGoals.get(conversationId) ?? null);
  }

  async agentInputQueue(conversationId: string, input: string): Promise<AgentQueuedInput> {
    const goal = this.agentGoals.get(conversationId);
    if (!goal) throw new Error("当前对话没有活动 Goal");
    return {
      id: crypto.randomUUID(),
      conversationId,
      goalId: goal.id,
      content: input,
      mode: "queue",
      state: "queued",
      createdAtMs: Date.now(),
      consumedAtMs: null,
    };
  }

  async agentGoalPause(goalId: string) {
    return this.updateDemoGoal(goalId, "paused");
  }

  async agentGoalResume(goalId: string) {
    return this.updateDemoGoal(goalId, "active");
  }

  async agentGoalCancel(goalId: string) {
    return this.updateDemoGoal(goalId, "canceled");
  }

  private updateDemoGoal(goalId: string, status: AgentGoal["status"]) {
    const entry = [...this.agentGoals.entries()].find(([, goal]) => goal.id === goalId);
    if (!entry) throw new Error("Goal 不存在");
    const [conversationId, goal] = entry;
    const updated = {
      ...goal,
      status,
      updatedAtMs: Date.now(),
      completedAtMs: ["completed", "failed", "canceled"].includes(status) ? Date.now() : null,
    } satisfies AgentGoal;
    this.agentGoals.set(conversationId, updated);
    return structuredClone(updated);
  }

  async agentSteer(conversationId: string, _input: string) {
    return { conversationId, turnId: "demo-running", accepted: true };
  }

  async agentApprove(callId: string, approved: boolean) {
    const resolve = this.approvals.get(callId);
    if (!resolve) throw new Error("审批请求已失效");
    this.approvals.delete(callId);
    resolve(approved);
  }

  async agentAbort(_conversationId: string | null = null) {
    this.agentAborted = true;
    for (const resolve of this.approvals.values()) resolve(false);
    this.approvals.clear();
  }

  async onSessionState(handler: (payload: SessionInfo) => void) {
    this.sessionHandlers.add(handler);
    return () => this.sessionHandlers.delete(handler);
  }

  async onTransferProgress(handler: (payload: TransferProgress) => void) {
    this.transferHandlers.add(handler);
    return () => this.transferHandlers.delete(handler);
  }

  private emitSession(payload: SessionInfo) {
    for (const handler of this.sessionHandlers) handler(payload);
  }

  private emitTransfer(payload: TransferProgress) {
    for (const handler of this.transferHandlers) handler(payload);
  }

  private startTransfer(total: number) {
    const transferId = crypto.randomUUID();
    let transferred = 0;
    this.emitTransfer({
      transfer_id: transferId,
      state: "queued",
      transferred,
      total,
      bytes_per_sec: 0,
      error: null,
    });
    const timer = window.setInterval(() => {
      transferred = Math.min(total, transferred + Math.ceil(total / 18));
      const done = transferred >= total;
      this.emitTransfer({
        transfer_id: transferId,
        state: done ? "done" : "running",
        transferred,
        total,
        bytes_per_sec: 12_400_000,
        error: null,
      });
      if (done) {
        window.clearInterval(timer);
        this.transferTimers.delete(transferId);
      }
    }, 120);
    this.transferTimers.set(transferId, timer);
    return transferId;
  }
}

export const demoBackend = new DemoBackend();

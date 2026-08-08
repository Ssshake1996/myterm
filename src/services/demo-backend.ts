import type {
  AiChatResult,
  AiMessage,
  AiProfile,
  AiTestResult,
  LocalEntry,
  MessageChannel,
  QuickCommand,
  RemoteEntry,
  SessionInfo,
  SessionProfile,
  TransferProgress,
} from "../ipc";

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
    model: "deepseek-chat",
    system_prompt: "",
    context_lines: 80,
  },
  {
    id: "ai-ollama",
    name: "Ollama 本地",
    base_url: "http://localhost:11434/v1",
    api_key_ref: "ai.ai-ollama.key",
    model: "qwen2.5",
    system_prompt: "",
    context_lines: 80,
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

class DemoBackend {
  private profiles = readStored("myterm.demo.profiles", DEFAULT_PROFILES);
  private commands = readStored("myterm.demo.commands", DEFAULT_COMMANDS);
  private aiProfiles = readStored("myterm.demo.ai-profiles", DEFAULT_AI_PROFILES);
  private sessions = new Map<string, SessionInfo>();
  private sinks = new Map<string, MessageChannel<ArrayBuffer>>();
  private sessionHandlers = new Set<(payload: SessionInfo) => void>();
  private transferHandlers = new Set<(payload: TransferProgress) => void>();
  private transferTimers = new Map<string, number>();
  private aborted = false;

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
    window.setTimeout(() => {
      const connected = { ...connecting, state: "connected" as const };
      this.sessions.set(sessionId, connected);
      this.emitSession(connected);
      sink.onmessage(new TextEncoder().encode(terminalGreeting).buffer);
    }, 260);
    return sessionId;
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
    sink.onmessage(new TextEncoder().encode(data).buffer);
    const command = data.replace(/[\r\n]+$/g, "");
    const reply = commandReplies[command];
    if (reply && data.includes("\r")) {
      window.setTimeout(() => sink.onmessage(new TextEncoder().encode(reply).buffer), 90);
    }
  }

  async terminalResize(_sessionId: string, _cols: number, _rows: number) {}

  async profileList() {
    return structuredClone(this.profiles);
  }

  async profileSave(profile: SessionProfile) {
    const index = this.profiles.findIndex((candidate) => candidate.id === profile.id);
    if (index >= 0) this.profiles[index] = profile;
    else this.profiles.push(profile);
    writeStored("myterm.demo.profiles", this.profiles);
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
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    return { ok: true, models: 34 };
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
      ? '[Terminal output of session "prod-web-01" (last 80 lines)]\n```\nActive: failed\n/dev/vda1  99G  87G  6.9G  93% /\n```'
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

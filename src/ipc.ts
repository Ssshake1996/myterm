import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { demoBackend } from "./services/demo-backend";

export type AuthMethod =
  | { kind: "password"; vault_ref: string }
  | { kind: "private_key"; key_path: string; passphrase_ref: string | null };

export type SessionTarget =
  | { kind: "ssh"; host: string; port: number; username: string; auth: AuthMethod }
  | { kind: "local"; shell: string };

export interface SessionProfile {
  id: string;
  name: string;
  group: string;
  environment?: "production" | "staging" | "development";
  target: SessionTarget;
}

export type SessionState = "connecting" | "connected" | "disconnected" | "failed";

export interface SessionDiagnostic {
  stage: string;
  code: string;
  summary: string;
  detail: string;
}

export interface SessionInfo {
  session_id: string;
  profile_id: string;
  state: SessionState;
  error: string | null;
  diagnostic?: SessionDiagnostic | null;
}

export interface RemoteEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  permissions: string;
}

export type TransferState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface TransferProgress {
  transfer_id: string;
  state: TransferState;
  transferred: number;
  total: number;
  bytes_per_sec: number;
  error: string | null;
}

export interface QuickCommand {
  id: string;
  label: string;
  group: string;
  command: string;
  send_newline: boolean;
  sort: number;
}

export type QuickCommandImportStrategy = "keep_both" | "overwrite";

export interface QuickCommandImportPreview {
  source_format: "myterm" | "xshell_qbl";
  source_version: string;
  total: number;
  importable: number;
  duplicates: number;
  conflicts: number;
  skipped: number;
  groups: string[];
}

export interface QuickCommandImportResult {
  imported: number;
  replaced: number;
  renamed: number;
  duplicates: number;
  skipped: number;
}

export type AppTheme = "light" | "eye_care" | "dark";

export type AppFontScale =
  | "small"
  | "standard"
  | "large"
  | "extra_large"
  | "scale_150"
  | "scale_175"
  | "scale_200";

export type TerminalPalette = "graphite_gold" | "forest_amber" | "midnight_contrast";

export type AiModelRole = "primary" | "fallback";

export type AiReasoningEffort = "off" | "low" | "high" | "max";

export interface AiModelConfig {
  id: string;
  name: string;
  model: string;
  /** Uses this saved DeepSeek service's endpoint/key; omitted means the containing service. */
  provider_profile_id?: string;
  role: AiModelRole;
  enabled: boolean;
}

export interface AiRoutingConfig {
  fallback_on_error: boolean;
}

export interface AiProfile {
  id: string;
  name: string;
  base_url: string;
  api_key_ref: string;
  reasoning_effort: AiReasoningEffort;
  system_prompt: string;
  models?: AiModelConfig[];
  routing?: AiRoutingConfig;
}

export interface AiTestResult {
  ok: boolean;
  models?: number;
  modelDetails?: Array<Record<string, unknown>>;
  rawResponse?: string;
  endpoint?: string;
  error?: AiErrorDiagnostic;
}

export interface AiModelTestResult {
  ok: boolean;
  model?: string;
  content?: string;
  elapsedMs?: number;
  rawResponse?: string;
  endpoint?: string;
  error?: AiErrorDiagnostic;
}

export interface AiErrorDiagnostic {
  stage: string;
  code: string;
  summary: string;
  detail: string;
  stack?: string;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export function ipcErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code : undefined;
}

export function ipcErrorDiagnostic(error: unknown): SessionDiagnostic | undefined {
  if (typeof error !== "object" || error === null || !("diagnostic" in error)) {
    return undefined;
  }
  const diagnostic = (error as { diagnostic?: unknown }).diagnostic;
  if (typeof diagnostic !== "object" || diagnostic === null) return undefined;
  const value = diagnostic as Partial<SessionDiagnostic>;
  if (
    typeof value.stage !== "string" ||
    typeof value.code !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.detail !== "string"
  ) {
    return undefined;
  }
  return {
    stage: value.stage,
    code: value.code,
    summary: value.summary,
    detail: value.detail,
  };
}

export function formatIpcError(error: unknown, fallback: string): string {
  const message = errorMessage(error, fallback);
  const diagnostic = ipcErrorDiagnostic(error);
  if (!diagnostic) return message;
  const detail = diagnostic.detail.trim() || message;
  return `${diagnostic.summary} [${diagnostic.code} · ${diagnostic.stage}]\n${detail}`;
}

export type HarnessAccessPreset = "workspace-write" | "danger-full-access";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "streamable_http";
  command: string;
  args: string[];
  cwd: string | null;
  url: string | null;
  headers: McpHeader[];
  enabled: boolean;
}

export interface McpHeader {
  name: string;
  value: string;
}

export interface AgentSettings {
  harness_access_preset: HarnessAccessPreset;
  skill_directories: string[];
  enabled_skills: string[];
  mcp_servers: McpServerConfig[];
  hooks?: AgentHookConfig[];
}

export interface AgentHookConfig {
  id: string;
  event: "SessionStart" | "PreToolUse" | "PostToolUse" | "ToolFailure" | "PreCompact" | "Stop";
  command: string;
  args: string[];
  cwd: string | null;
  enabled: boolean;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  path: string;
  contentHash: string;
  platforms: string[];
  allowedTools: string[];
  risk: string;
  modelInvocable: boolean;
  trusted: boolean;
}

export interface McpToolInfo {
  serverId: string;
  serverName: string;
  transport: string;
  capabilityId: string;
  name: string;
  title?: string | null;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}

export interface AgentPluginInfo {
  id: string;
  name: string;
  version: string;
  kind: string;
  description: string;
  requires: string[];
  enabled: boolean;
}

export interface AgentEvent {
  schemaVersion: number;
  sequence: number;
  createdAtMs: number;
  eventType:
    | "status"
    | "target_connecting"
    | "target_connected"
    | "tool_requested"
    | "tool_output"
    | "policy"
    | "context_compacted"
    | "context_state"
    | "user_steer"
    | "steering_applied"
    | "runtime_metrics"
    | "hook"
    | "approval_required"
    | "tool_result"
    | "job_started"
    | "job_finished"
    | "capability_progress"
    | "session_wait_progress"
    | "skill_restore_warning"
    | "mcp_error"
    | "assistant"
    | "complete";
  runId: string;
  step?: number;
  callId?: string;
  toolName?: string;
  pluginId?: string;
  message?: string;
  content?: string;
  arguments?: unknown;
  isError?: boolean;
  errorCode?: string;
}

export interface AgentRunResult {
  runId: string;
  conversationId: string;
  turnId: string;
  finishReason:
    | "stop"
    | "aborted"
    | "paused"
    | "canceled"
    | "continuation_required"
    | "waiting_approval"
    | "waiting_external"
    | "blocked"
    | "budget_limited"
    | "usage_limited"
    | "loop_detected"
    | "failed"
    | "error";
  steps: number;
  modelRequests?: number;
  toolCalls?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type AgentTaskState =
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "canceled";

export interface AgentTask {
  id: string;
  conversationId: string;
  goalId: string | null;
  turnIndex: number;
  continuationIndex: number;
  profileId: string;
  sessionId: string | null;
  prompt: string;
  state: AgentTaskState;
  createdAtMs: number;
  updatedAtMs: number;
  finishReason: string | null;
  steps: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export type AgentGoalStatus =
  | "active"
  | "paused"
  | "waiting_approval"
  | "waiting_external"
  | "blocked"
  | "budget_limited"
  | "usage_limited"
  | "completed"
  | "failed"
  | "canceled";

export interface AgentGoal {
  id: string;
  conversationId: string;
  objective: string;
  status: AgentGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  continuationCount: number;
  currentTurnId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs: number | null;
  lastCheckpoint: unknown | null;
  lastError: string | null;
  blockedReason: string | null;
  noProgressCount: number;
}

export interface AgentQueuedInput {
  id: string;
  conversationId: string;
  goalId: string | null;
  content: string;
  mode: "steer" | "queue";
  state: string;
  createdAtMs: number;
  consumedAtMs: number | null;
}

export interface AgentConversation {
  id: string;
  title: string;
  profileId: string;
  createdAtMs: number;
  updatedAtMs: number;
  turnCount: number;
}

export interface AgentSteerResult {
  conversationId: string;
  turnId: string;
  accepted: boolean;
}

export interface ExecutionJob {
  id: string;
  taskId: string;
  goalId: string | null;
  conversationId: string | null;
  toolCallId: string;
  state: "running" | "canceling" | "succeeded" | "failed" | "canceled" | "timed_out" | "lost";
  exitCode: number | null;
  signal: string | null;
  startedAtMs: number;
  completedAtMs: number | null;
  artifactPath: string | null;
}

export interface LocalEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export interface AppInfo {
  version: string;
  commitHash: string;
  startupProfile: string | null;
  portable: boolean;
}

export const isDesktopRuntime = isTauri();

let localShellListPromise: Promise<string[]> | null = null;

export interface MessageChannel<T> {
  onmessage: (message: T) => void;
}

export function createChannel<T>(): MessageChannel<T> {
  if (isDesktopRuntime) return new Channel<T>();
  return { onmessage: () => undefined };
}

export async function getAppInfo(): Promise<AppInfo> {
  if (!isDesktopRuntime) {
    return {
      version: __APP_VERSION__,
      commitHash: "browser-demo",
      startupProfile: null,
      portable: false,
    };
  }
  return invoke<AppInfo>("app_info");
}

export async function appThemeGet(): Promise<AppTheme> {
  if (!isDesktopRuntime) return demoBackend.appThemeGet();
  return invoke<AppTheme>("app_theme_get");
}

export async function appThemeSave(theme: AppTheme): Promise<AppTheme> {
  if (!isDesktopRuntime) return demoBackend.appThemeSave(theme);
  return invoke<AppTheme>("app_theme_save", { theme });
}

export async function appFontScaleGet(): Promise<AppFontScale> {
  if (!isDesktopRuntime) return demoBackend.appFontScaleGet();
  return invoke<AppFontScale>("app_font_scale_get");
}

export async function appFontScaleSave(scale: AppFontScale): Promise<AppFontScale> {
  if (!isDesktopRuntime) return demoBackend.appFontScaleSave(scale);
  return invoke<AppFontScale>("app_font_scale_save", { scale });
}

export async function terminalFontSizeGet(): Promise<number> {
  if (!isDesktopRuntime) return demoBackend.terminalFontSizeGet();
  return invoke<number>("terminal_font_size_get");
}

export async function terminalFontSizeSave(size: number): Promise<number> {
  if (!isDesktopRuntime) return demoBackend.terminalFontSizeSave(size);
  return invoke<number>("terminal_font_size_save", { size });
}

export async function terminalPaletteGet(): Promise<TerminalPalette> {
  if (!isDesktopRuntime) return demoBackend.terminalPaletteGet();
  return invoke<TerminalPalette>("terminal_palette_get");
}

export async function terminalPaletteSave(palette: TerminalPalette): Promise<TerminalPalette> {
  if (!isDesktopRuntime) return demoBackend.terminalPaletteSave(palette);
  return invoke<TerminalPalette>("terminal_palette_save", { palette });
}

export async function sessionConnect(
  profileId: string,
  cols: number,
  rows: number,
  onData: MessageChannel<ArrayBuffer>,
): Promise<SessionInfo> {
  if (!isDesktopRuntime) return demoBackend.sessionConnect(profileId, cols, rows, onData);
  return invoke<SessionInfo>("session_connect", { profileId, cols, rows, onData });
}

export async function sessionDisconnect(sessionId: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.sessionDisconnect(sessionId);
  return invoke("session_disconnect", { sessionId });
}

export async function sessionList(): Promise<SessionInfo[]> {
  if (!isDesktopRuntime) return demoBackend.sessionList();
  return invoke<SessionInfo[]>("session_list");
}

export interface TerminalInputEventDetail {
  sessionId: string;
  dataUtf8: string;
}

export interface TerminalOutputEventDetail {
  sessionId: string;
  dataUtf8: string;
}

export interface TerminalScreenSnapshot {
  visibleText: string;
  cursorLine: string;
  cursorLineBeforeCursor: string;
  cursorColumn: number;
  updatedAtMs: number;
}

function publishTerminalInput(detail: TerminalInputEventDetail): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("myterm:terminal-input", { detail }));
  }
}

export function publishTerminalOutput(detail: TerminalOutputEventDetail): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("myterm:terminal-output", { detail }));
  }
}

export async function terminalWrite(sessionId: string, dataUtf8: string): Promise<void> {
  if (!isDesktopRuntime) {
    await demoBackend.terminalWrite(sessionId, dataUtf8);
  } else {
    await invoke("terminal_write", { sessionId, dataUtf8 });
  }
  publishTerminalInput({ sessionId, dataUtf8 });
}

export async function terminalResize(sessionId: string, cols: number, rows: number): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.terminalResize(sessionId, cols, rows);
  return invoke("terminal_resize", { sessionId, cols, rows });
}

export async function terminalScreenUpdate(
  sessionId: string,
  snapshot: TerminalScreenSnapshot,
): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.terminalScreenUpdate(sessionId, snapshot);
  return invoke("terminal_screen_update", { sessionId, snapshot });
}

export async function profileList(): Promise<SessionProfile[]> {
  if (!isDesktopRuntime) return demoBackend.profileList();
  return invoke<SessionProfile[]>("profile_list");
}

export async function profileSave(
  profile: SessionProfile,
  secret?: string,
): Promise<SessionProfile> {
  if (!isDesktopRuntime) return demoBackend.profileSave(profile, secret);
  return invoke<SessionProfile>("profile_save", { profile, secret });
}

export async function profileDelete(profileId: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.profileDelete(profileId);
  return invoke("profile_delete", { profileId });
}

export async function vaultSet(ref: string, secret: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.vaultSet(ref, secret);
  return invoke("vault_set", { ref, secret });
}

export async function vaultDelete(ref: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.vaultDelete(ref);
  return invoke("vault_delete", { ref });
}

export async function localShellList(): Promise<string[]> {
  if (!isDesktopRuntime) return ["powershell.exe", "cmd.exe", "wsl.exe"];
  if (!localShellListPromise) {
    localShellListPromise = invoke<string[]>("local_shell_list").catch((error) => {
      localShellListPromise = null;
      throw error;
    });
  }
  return localShellListPromise;
}

export async function quickCommandList(): Promise<QuickCommand[]> {
  if (!isDesktopRuntime) return demoBackend.quickCommandList();
  return invoke<QuickCommand[]>("quick_command_list");
}

export async function quickCommandSave(command: QuickCommand): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.quickCommandSave(command);
  return invoke("quick_command_save", { cmd: command });
}

export async function quickCommandDelete(id: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.quickCommandDelete(id);
  return invoke("quick_command_delete", { id });
}

export async function quickCommandImportPreview(
  fileName: string,
  bytes: number[],
): Promise<QuickCommandImportPreview> {
  if (!isDesktopRuntime) return demoBackend.quickCommandImportPreview(fileName, bytes);
  return invoke<QuickCommandImportPreview>("quick_command_import_preview", { fileName, bytes });
}

export async function quickCommandImportApply(
  fileName: string,
  bytes: number[],
  strategy: QuickCommandImportStrategy,
): Promise<QuickCommandImportResult> {
  if (!isDesktopRuntime) return demoBackend.quickCommandImportApply(fileName, bytes, strategy);
  return invoke<QuickCommandImportResult>("quick_command_import_apply", {
    fileName,
    bytes,
    strategy,
  });
}

export async function quickCommandExport(group?: string): Promise<string> {
  if (!isDesktopRuntime) return demoBackend.quickCommandExport(group);
  return invoke<string>("quick_command_export", { group: group ?? null });
}

export async function sftpReadDir(sessionId: string, path: string): Promise<RemoteEntry[]> {
  if (!isDesktopRuntime) return demoBackend.sftpReadDir(sessionId, path);
  return invoke<RemoteEntry[]>("sftp_read_dir", { sessionId, path });
}

export async function sftpDefaultDirectory(sessionId: string): Promise<string> {
  if (!isDesktopRuntime) return demoBackend.sftpDefaultDirectory(sessionId);
  return invoke<string>("sftp_default_directory", { sessionId });
}

export async function sftpMkdir(sessionId: string, path: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.sftpMkdir(sessionId, path);
  return invoke("sftp_mkdir", { sessionId, path });
}

export async function sftpRename(sessionId: string, from: string, to: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.sftpRename(sessionId, from, to);
  return invoke("sftp_rename", { sessionId, from, to });
}

export async function sftpDelete(
  sessionId: string,
  path: string,
  recursive: boolean,
): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.sftpDelete(sessionId, path, recursive);
  return invoke("sftp_delete", { sessionId, path, recursive });
}

export async function sftpUpload(
  sessionId: string,
  localPath: string,
  remotePath: string,
): Promise<string> {
  if (!isDesktopRuntime) return demoBackend.sftpUpload(sessionId, localPath, remotePath);
  return invoke<string>("sftp_upload", { sessionId, localPath, remotePath });
}

export async function sftpDownload(
  sessionId: string,
  remotePath: string,
  localPath: string,
): Promise<string> {
  if (!isDesktopRuntime) return demoBackend.sftpDownload(sessionId, remotePath, localPath);
  return invoke<string>("sftp_download", { sessionId, remotePath, localPath });
}

export async function transferCancel(transferId: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.transferCancel(transferId);
  return invoke("transfer_cancel", { transferId });
}

export async function localReadDir(path: string): Promise<LocalEntry[]> {
  if (!isDesktopRuntime) return demoBackend.localReadDir(path);
  return invoke<LocalEntry[]>("local_read_dir", { path });
}

export async function localDefaultDirectory(): Promise<string> {
  if (!isDesktopRuntime) return demoBackend.localDefaultDirectory();
  return invoke<string>("local_default_directory");
}

export async function aiProfileList(): Promise<AiProfile[]> {
  if (!isDesktopRuntime) return demoBackend.aiProfileList();
  return invoke<AiProfile[]>("ai_profile_list");
}

export async function aiConfigJson(): Promise<Record<string, unknown>> {
  if (!isDesktopRuntime) return demoBackend.aiConfigJson();
  return invoke<Record<string, unknown>>("ai_config_json");
}

export async function configOpenLocal(): Promise<string> {
  if (!isDesktopRuntime) return demoBackend.configOpenLocal();
  return invoke<string>("config_open_local");
}

export async function aiProfileSave(profile: AiProfile, apiKey?: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.aiProfileSave(profile, apiKey);
  return invoke("ai_profile_save", { profile, apiKey });
}

export async function aiProfileDelete(profileId: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.aiProfileDelete(profileId);
  return invoke("ai_profile_delete", { profileId });
}

export async function aiTestConnection(profileId: string): Promise<AiTestResult> {
  if (!isDesktopRuntime) return demoBackend.aiTestConnection(profileId);
  return invoke<AiTestResult>("ai_test_connection", { profileId });
}

export async function aiFetchModels(profileId: string): Promise<AiTestResult> {
  if (!isDesktopRuntime) return demoBackend.aiFetchModels(profileId);
  return invoke<AiTestResult>("ai_fetch_models", { profileId });
}

export async function aiTestModel(
  profileId: string,
  model: string,
  prompt: string,
): Promise<AiModelTestResult> {
  if (!isDesktopRuntime) return demoBackend.aiTestModel(profileId, model, prompt);
  return invoke<AiModelTestResult>("ai_test_model", { profileId, model, prompt });
}

export async function agentSettingsGet(): Promise<AgentSettings> {
  if (!isDesktopRuntime) return demoBackend.agentSettingsGet();
  return invoke<AgentSettings>("agent_settings_get");
}

export async function agentPluginList(): Promise<AgentPluginInfo[]> {
  if (!isDesktopRuntime) return demoBackend.agentPluginList();
  return invoke<AgentPluginInfo[]>("agent_plugin_list");
}

export async function agentSettingsSave(settings: AgentSettings): Promise<AgentSettings> {
  if (!isDesktopRuntime) return demoBackend.agentSettingsSave(settings);
  return invoke<AgentSettings>("agent_settings_save", { settings });
}

export async function agentSkillList(skillDirectories?: string[]): Promise<SkillInfo[]> {
  if (!isDesktopRuntime) return demoBackend.agentSkillList(skillDirectories);
  return invoke<SkillInfo[]>("agent_skill_list", { skillDirectories });
}

export async function agentMcpTest(server: McpServerConfig): Promise<McpToolInfo[]> {
  if (!isDesktopRuntime) return demoBackend.agentMcpTest(server);
  return invoke<McpToolInfo[]>("agent_mcp_test", { server });
}

export async function agentRun(
  profileId: string,
  conversationId: string | null,
  prompt: string,
  activeSessionId: string | null,
  onEvent: MessageChannel<AgentEvent>,
): Promise<AgentRunResult> {
  if (!isDesktopRuntime) {
    return demoBackend.agentRun(profileId, conversationId, prompt, activeSessionId, onEvent);
  }
  return invoke<AgentRunResult>("agent_run", {
    profileId,
    conversationId,
    prompt,
    sessionId: activeSessionId,
    onEvent,
  });
}

export async function agentConversationCreate(
  profileId: string,
  title?: string,
): Promise<AgentConversation> {
  if (!isDesktopRuntime) return demoBackend.agentConversationCreate(profileId, title);
  return invoke<AgentConversation>("agent_conversation_create", {
    profileId,
    title: title ?? null,
  });
}

export async function agentConversationList(limit = 50): Promise<AgentConversation[]> {
  if (!isDesktopRuntime) return demoBackend.agentConversationList(limit);
  return invoke<AgentConversation[]>("agent_conversation_list", { limit });
}

export async function agentConversationTasks(conversationId: string): Promise<AgentTask[]> {
  if (!isDesktopRuntime) return [];
  return invoke<AgentTask[]>("agent_conversation_tasks", { conversationId });
}

export async function agentGoalGet(conversationId: string): Promise<AgentGoal | null> {
  if (!isDesktopRuntime) return demoBackend.agentGoalGet(conversationId);
  return invoke<AgentGoal | null>("agent_goal_get", { conversationId });
}

export async function agentInputQueue(
  conversationId: string,
  input: string,
): Promise<AgentQueuedInput> {
  if (!isDesktopRuntime) return demoBackend.agentInputQueue(conversationId, input);
  return invoke<AgentQueuedInput>("agent_input_queue", { conversationId, input });
}

export async function agentGoalPause(goalId: string): Promise<AgentGoal> {
  if (!isDesktopRuntime) return demoBackend.agentGoalPause(goalId);
  return invoke<AgentGoal>("agent_goal_pause", { goalId });
}

export async function agentGoalResume(goalId: string): Promise<AgentGoal> {
  if (!isDesktopRuntime) return demoBackend.agentGoalResume(goalId);
  return invoke<AgentGoal>("agent_goal_resume", { goalId });
}

export async function agentGoalCancel(goalId: string): Promise<AgentGoal> {
  if (!isDesktopRuntime) return demoBackend.agentGoalCancel(goalId);
  return invoke<AgentGoal>("agent_goal_cancel", { goalId });
}

export async function agentConversationDelete(conversationId: string): Promise<boolean> {
  if (!isDesktopRuntime) return demoBackend.agentConversationDelete(conversationId);
  return invoke<boolean>("agent_conversation_delete", { conversationId });
}

export async function agentSteer(conversationId: string, input: string): Promise<AgentSteerResult> {
  if (!isDesktopRuntime) return demoBackend.agentSteer(conversationId, input);
  return invoke<AgentSteerResult>("agent_steer", { conversationId, input });
}

export async function agentApprove(callId: string, approved: boolean): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.agentApprove(callId, approved);
  return invoke("agent_approve", { callId, approved });
}

export async function agentAbort(conversationId?: string | null): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.agentAbort(conversationId ?? null);
  return invoke("agent_abort", { conversationId: conversationId ?? null });
}

export async function agentJobCancel(jobId: string): Promise<ExecutionJob> {
  if (!isDesktopRuntime) {
    return {
      id: jobId,
      taskId: "demo",
      goalId: null,
      conversationId: null,
      toolCallId: "demo",
      state: "canceling",
      exitCode: null,
      signal: null,
      startedAtMs: Date.now(),
      completedAtMs: null,
      artifactPath: null,
    };
  }
  return invoke<ExecutionJob>("agent_job_cancel", { jobId });
}

export async function agentTaskList(limit = 50): Promise<AgentTask[]> {
  if (!isDesktopRuntime) return [];
  return invoke<AgentTask[]>("agent_task_list", { limit });
}

export async function agentTaskGet(taskId: string): Promise<AgentTask> {
  return invoke<AgentTask>("agent_task_get", { taskId });
}

export async function agentTaskEvents(
  taskId: string,
  afterSequence = 0,
  limit = 500,
): Promise<AgentEvent[]> {
  if (!isDesktopRuntime) return [];
  return invoke<AgentEvent[]>("agent_task_events", { taskId, afterSequence, limit });
}

export async function agentTaskDelete(taskId: string): Promise<boolean> {
  if (!isDesktopRuntime) return false;
  return invoke<boolean>("agent_task_delete", { taskId });
}

export async function onSessionState(handler: (payload: SessionInfo) => void): Promise<UnlistenFn> {
  if (!isDesktopRuntime) return demoBackend.onSessionState(handler);
  return listen<SessionInfo>("session://state", (event) => handler(event.payload));
}

export async function onTransferProgress(
  handler: (payload: TransferProgress) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime) return demoBackend.onTransferProgress(handler);
  return listen<TransferProgress>("transfer://progress", (event) => handler(event.payload));
}

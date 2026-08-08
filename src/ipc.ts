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
  target: SessionTarget;
}

export type SessionState = "connecting" | "connected" | "disconnected" | "failed";

export interface SessionInfo {
  session_id: string;
  profile_id: string;
  state: SessionState;
  error: string | null;
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

export interface AiProfile {
  id: string;
  name: string;
  base_url: string;
  api_key_ref: string;
  model: string;
  system_prompt: string;
  context_lines: number;
}

export type AiRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiTestResult {
  ok: boolean;
  models?: number;
  error?: string;
}

export interface AiChatResult {
  finishReason: "stop" | "aborted";
  attachedContext?: string;
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
      version: "0.1.1",
      commitHash: "browser-demo",
      startupProfile: null,
      portable: false,
    };
  }
  return invoke<AppInfo>("app_info");
}

export async function sessionConnect(
  profileId: string,
  cols: number,
  rows: number,
  onData: MessageChannel<ArrayBuffer>,
): Promise<string> {
  if (!isDesktopRuntime) return demoBackend.sessionConnect(profileId, cols, rows, onData);
  return invoke<string>("session_connect", { profileId, cols, rows, onData });
}

export async function sessionDisconnect(sessionId: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.sessionDisconnect(sessionId);
  return invoke("session_disconnect", { sessionId });
}

export async function sessionList(): Promise<SessionInfo[]> {
  if (!isDesktopRuntime) return demoBackend.sessionList();
  return invoke<SessionInfo[]>("session_list");
}

export async function terminalWrite(sessionId: string, dataUtf8: string): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.terminalWrite(sessionId, dataUtf8);
  return invoke("terminal_write", { sessionId, dataUtf8 });
}

export async function terminalResize(sessionId: string, cols: number, rows: number): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.terminalResize(sessionId, cols, rows);
  return invoke("terminal_resize", { sessionId, cols, rows });
}

export async function profileList(): Promise<SessionProfile[]> {
  if (!isDesktopRuntime) return demoBackend.profileList();
  return invoke<SessionProfile[]>("profile_list");
}

export async function profileSave(profile: SessionProfile): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.profileSave(profile);
  return invoke("profile_save", { profile });
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
  return invoke<string[]>("local_shell_list");
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

export async function sftpReadDir(sessionId: string, path: string): Promise<RemoteEntry[]> {
  if (!isDesktopRuntime) return demoBackend.sftpReadDir(sessionId, path);
  return invoke<RemoteEntry[]>("sftp_read_dir", { sessionId, path });
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

export async function aiProfileList(): Promise<AiProfile[]> {
  if (!isDesktopRuntime) return demoBackend.aiProfileList();
  return invoke<AiProfile[]>("ai_profile_list");
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

export async function aiChat(
  profileId: string,
  messages: AiMessage[],
  attachSessionId: string | null,
  onDelta: MessageChannel<string>,
): Promise<AiChatResult> {
  if (!isDesktopRuntime) {
    return demoBackend.aiChat(profileId, messages, attachSessionId, onDelta);
  }
  return invoke<AiChatResult>("ai_chat", { profileId, messages, attachSessionId, onDelta });
}

export async function aiAbort(): Promise<void> {
  if (!isDesktopRuntime) return demoBackend.aiAbort();
  return invoke("ai_abort");
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

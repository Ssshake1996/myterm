use serde::{Deserialize, Serialize};

// ── Session profiles ─────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthMethod {
    /// Password is stored in the vault; only its reference lives here.
    Password { vault_ref: String },
    /// OpenSSH private key; its optional passphrase is stored in the vault.
    PrivateKey {
        key_path: String,
        passphrase_ref: Option<String>,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionTarget {
    Ssh {
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
    },
    /// Local terminal executable such as powershell.exe, cmd.exe, or wsl.exe.
    Local { shell: String },
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionProfile {
    pub id: String,
    pub name: String,
    pub group: String,
    pub target: SessionTarget,
}

// ── Live sessions ────────────────────────────────────────

pub type SessionId = String;

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Connecting,
    Connected,
    Disconnected,
    Failed,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: SessionId,
    pub profile_id: String,
    pub state: SessionState,
    pub error: Option<String>,
}

// ── SFTP ─────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: i64,
    pub permissions: String,
}

pub type TransferId = String;

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferState {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct TransferProgress {
    pub transfer_id: TransferId,
    pub state: TransferState,
    pub transferred: u64,
    pub total: u64,
    pub bytes_per_sec: u64,
    pub error: Option<String>,
}

// ── Quick commands ───────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct QuickCommand {
    pub id: String,
    pub label: String,
    pub group: String,
    pub command: String,
    pub send_newline: bool,
    pub sort: u32,
}

// ── AI ───────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct AiProfile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key_ref: String,
    pub model: String,
    pub system_prompt: String,
    pub context_lines: u32,
}

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiRole {
    System,
    User,
    Assistant,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: AiRole,
    pub content: String,
}

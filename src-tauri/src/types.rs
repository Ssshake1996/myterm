use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    #[serde(default)]
    pub environment: SessionEnvironment,
    pub target: SessionTarget,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SessionEnvironment {
    #[default]
    Production,
    Staging,
    Development,
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileStat {
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: i64,
    pub permissions: String,
    pub sha256: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileRead {
    pub path: String,
    pub offset: u64,
    pub bytes: u64,
    pub eof: bool,
    pub sha256: String,
    pub content: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileMatch {
    pub path: String,
    pub line: u64,
    pub text: String,
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

// ── Appearance ───────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AppTheme {
    Light,
    EyeCare,
    #[default]
    Dark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AppFontScale {
    Small,
    #[default]
    Standard,
    Large,
    ExtraLarge,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AiAuthMode {
    #[default]
    Bearer,
    ApiKey,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AiProfile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key_ref: String,
    #[serde(default)]
    pub auth_mode: AiAuthMode,
    pub model: String,
    pub system_prompt: String,
    pub context_lines: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentPermissionMode {
    ReadOnly,
    #[default]
    #[serde(alias = "full_access")]
    Confirm,
    TaskGrant,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
}

fn enabled_by_default() -> bool {
    true
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AgentSettings {
    #[serde(default = "default_agent_profile")]
    pub profile: String,
    #[serde(default)]
    pub bundles: Vec<String>,
    #[serde(default)]
    pub enabled_plugins: Vec<String>,
    pub permission_mode: AgentPermissionMode,
    pub max_steps: u8,
    #[serde(default)]
    pub skill_directories: Vec<String>,
    #[serde(default)]
    pub enabled_skills: Vec<String>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerConfig>,
    #[serde(default)]
    pub hooks: Vec<AgentHookConfig>,
}

fn default_agent_profile() -> String {
    "desktop".to_owned()
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AgentHookConfig {
    pub id: String,
    pub event: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
}

impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            profile: default_agent_profile(),
            bundles: vec!["core.desktop".to_owned(), "ssh.operations".to_owned()],
            enabled_plugins: Vec::new(),
            permission_mode: AgentPermissionMode::Confirm,
            max_steps: 8,
            skill_directories: Vec::new(),
            enabled_skills: Vec::new(),
            mcp_servers: Vec::new(),
            hooks: Vec::new(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub content_hash: String,
    pub platforms: Vec<String>,
    pub allowed_tools: Vec<String>,
    pub risk: String,
    pub model_invocable: bool,
    pub trusted: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub server_id: String,
    pub server_name: String,
    pub name: String,
    pub description: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub kind: String,
    pub description: String,
    pub requires: Vec<String>,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub schema_version: u16,
    pub sequence: u64,
    pub created_at_ms: i64,
    pub event_type: String,
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub run_id: String,
    pub finish_reason: String,
    pub steps: u8,
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

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const AGENT_EVENT_SCHEMA_VERSION: u16 = 2;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<SessionDiagnostic>,
}

/// Structured evidence for a session connection or transport failure.
///
/// `summary` is safe to show in a compact status line, while `detail` keeps
/// the original error text that is useful to a human or to the Agent.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiagnostic {
    pub stage: String,
    pub code: String,
    pub summary: String,
    pub detail: String,
}

/// Lightweight xterm screen evidence synchronized by the visible terminal.
///
/// This is deliberately not another terminal emulator. It only records what
/// xterm currently renders so Agent input can continue an already typed CLI
/// line without resending the full command.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreenSnapshot {
    pub visible_text: String,
    pub cursor_line: String,
    pub cursor_line_before_cursor: String,
    pub cursor_column: u16,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCatalogTarget {
    pub kind: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub shell: Option<String>,
}

/// Saved profiles joined with live state and the most recent failure evidence.
/// Secrets and vault references are intentionally excluded.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCatalogEntry {
    pub profile_id: String,
    pub name: String,
    pub group: String,
    pub environment: SessionEnvironment,
    pub target: SessionCatalogTarget,
    pub session_id: Option<SessionId>,
    pub state: SessionState,
    pub active: bool,
    pub error: Option<String>,
    pub diagnostic: Option<SessionDiagnostic>,
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
    #[serde(rename = "scale_150")]
    Scale150,
    #[serde(rename = "scale_175")]
    Scale175,
    #[serde(rename = "scale_200")]
    Scale200,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TerminalPalette {
    #[default]
    GraphiteGold,
    ForestAmber,
    MidnightContrast,
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
pub enum AiModelRole {
    #[default]
    Primary,
    Fallback,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AiReasoningEffort {
    Off,
    Low,
    #[default]
    High,
    Max,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AiModelConfig {
    pub id: String,
    pub name: String,
    pub model: String,
    /// Optional DeepSeek service whose endpoint and vault key provide this
    /// route. `None` means the containing service.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_profile_id: Option<String>,
    #[serde(default)]
    pub role: AiModelRole,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AiRoutingConfig {
    #[serde(default = "enabled_by_default")]
    pub fallback_on_error: bool,
}

impl Default for AiRoutingConfig {
    fn default() -> Self {
        Self {
            fallback_on_error: true,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AiProfile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key_ref: String,
    #[serde(default)]
    pub reasoning_effort: AiReasoningEffort,
    pub system_prompt: String,
    #[serde(default)]
    pub models: Vec<AiModelConfig>,
    #[serde(default)]
    pub routing: AiRoutingConfig,
}

impl AiProfile {
    pub fn effective_models(&self) -> Vec<AiModelConfig> {
        let mut models = self
            .models
            .iter()
            .filter(|model| model.enabled && !model.model.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>();
        models.sort_by_key(|model| match model.role {
            AiModelRole::Primary => 0,
            AiModelRole::Fallback => 1,
        });
        models
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentPermissionMode {
    ReadOnly,
    #[default]
    Confirm,
    #[serde(alias = "task_grant")]
    FullAccess,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpTransportKind {
    #[default]
    Stdio,
    StreamableHttp,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct McpHeader {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub transport: McpTransportKind,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Vec<McpHeader>,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
}

fn enabled_by_default() -> bool {
    true
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AgentSettings {
    #[serde(skip, default = "default_agent_profile")]
    pub profile: String,
    #[serde(skip)]
    pub bundles: Vec<String>,
    #[serde(skip)]
    pub enabled_plugins: Vec<String>,
    #[serde(default)]
    pub permission_mode: AgentPermissionMode,
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
    "deepseek-harness".to_owned()
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
            bundles: Vec::new(),
            enabled_plugins: Vec::new(),
            permission_mode: AgentPermissionMode::Confirm,
            skill_directories: Vec::new(),
            enabled_skills: Vec::new(),
            mcp_servers: Vec::new(),
            hooks: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
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
    pub transport: String,
    pub capability_id: String,
    pub name: String,
    pub title: Option<String>,
    pub description: String,
    pub input_schema: Value,
    pub output_schema: Option<Value>,
    pub annotations: Option<Value>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub run_id: String,
    pub conversation_id: String,
    pub turn_id: String,
    pub finish_reason: String,
    pub steps: u8,
    pub model_requests: u32,
    pub tool_calls: u32,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSteerResult {
    pub conversation_id: String,
    pub turn_id: String,
    pub accepted: bool,
}

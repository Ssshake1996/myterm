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

#[derive(Clone, Serialize)]
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
pub enum AiAuthMode {
    #[default]
    Bearer,
    ApiKey,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AiModelRole {
    #[default]
    Primary,
    Analysis,
    Fallback,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AiModelConfig {
    pub id: String,
    pub name: String,
    pub model: String,
    #[serde(default)]
    pub role: AiModelRole,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AiRoutingConfig {
    #[serde(default = "enabled_by_default")]
    pub fallback_on_error: bool,
    #[serde(default = "default_analysis_threshold")]
    pub analysis_threshold_chars: u32,
}

fn default_analysis_threshold() -> u32 {
    32_000
}

impl Default for AiRoutingConfig {
    fn default() -> Self {
        Self {
            fallback_on_error: true,
            analysis_threshold_chars: default_analysis_threshold(),
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
    pub auth_mode: AiAuthMode,
    /// Legacy single-model field. It is migrated into `models.primary` and is
    /// retained only so existing config.json files remain readable.
    #[serde(default, skip_serializing)]
    pub model: String,
    pub system_prompt: String,
    /// Legacy fixed line limit. Agent and chat no longer use this field.
    #[serde(default, skip_serializing)]
    pub context_lines: u32,
    #[serde(default)]
    pub models: Vec<AiModelConfig>,
    #[serde(default)]
    pub routing: AiRoutingConfig,
}

impl AiProfile {
    pub fn effective_models(&self) -> Vec<AiModelConfig> {
        if self.models.is_empty() && !self.model.trim().is_empty() {
            return vec![AiModelConfig {
                id: "primary".to_owned(),
                name: "主模型".to_owned(),
                model: self.model.clone(),
                role: AiModelRole::Primary,
                enabled: true,
            }];
        }
        let mut models = self
            .models
            .iter()
            .filter(|model| model.enabled && !model.model.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>();
        models.sort_by_key(|model| match model.role {
            AiModelRole::Primary => 0,
            AiModelRole::Analysis => 1,
            AiModelRole::Fallback => 2,
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
    #[serde(skip, default = "default_agent_profile")]
    pub profile: String,
    #[serde(skip)]
    pub bundles: Vec<String>,
    #[serde(skip)]
    pub enabled_plugins: Vec<String>,
    #[serde(default)]
    pub permission_mode: AgentPermissionMode,
    #[serde(skip, default = "default_agent_max_steps")]
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
    "dsh-codex-agent".to_owned()
}

fn default_agent_max_steps() -> u8 {
    64
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
            max_steps: default_agent_max_steps(),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
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

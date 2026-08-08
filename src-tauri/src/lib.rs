pub mod agent;
pub mod ai;
pub mod config;
pub mod ipc;
pub mod session;
pub mod sftp;
pub mod types;

use std::sync::Arc;

use agent::service::AgentService;
use ai::service::AiService;
use config::{ConfigService, CredentialVault, KeyringVault};
use serde::Serialize;
use session::manager::{SessionEventSink, SessionManager};
use sftp::service::{SftpService, TransferEventSink};
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;
use tracing_appender::non_blocking::WorkerGuard;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("configuration error: {0}")]
    Config(String),
    #[error("credential vault error: {0}")]
    Vault(String),
    #[error("session error: {0}")]
    Session(String),
    #[error("SFTP error: {0}")]
    Sftp(String),
    #[error("AI service error: {0}")]
    Ai(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize)]
pub struct IpcError {
    pub code: String,
    pub message: String,
}

impl From<AppError> for IpcError {
    fn from(error: AppError) -> Self {
        let code = match &error {
            AppError::Config(_) => "config",
            AppError::Vault(_) => "vault",
            AppError::Session(_) => "session",
            AppError::Sftp(_) => "sftp",
            AppError::Ai(_) => "ai",
            AppError::NotFound(_) => "not_found",
            AppError::InvalidInput(_) => "invalid_input",
            AppError::Io(_) => "io",
            AppError::Json(_) => "json",
        };
        Self {
            code: code.to_owned(),
            message: error.to_string(),
        }
    }
}

impl From<russh::Error> for AppError {
    fn from(error: russh::Error) -> Self {
        Self::Session(error.to_string())
    }
}

pub trait SecretResolver: Send + Sync {
    fn resolve(&self, vault_ref: &str) -> Result<String, AppError>;
}

pub struct AppState {
    pub config: Arc<ConfigService>,
    pub vault: Arc<dyn CredentialVault>,
    pub sessions: Arc<SessionManager>,
    pub sftp: Arc<SftpService>,
    pub ai: Arc<AiService>,
    pub agent: Arc<AgentService>,
    pub startup_profile: Option<String>,
    pub portable: bool,
}

struct TauriSessionEvents(AppHandle);

impl SessionEventSink for TauriSessionEvents {
    fn state_changed(&self, session: &types::SessionInfo) {
        if let Err(error) = self.0.emit("session://state", session) {
            tracing::debug!(%error, "unable to emit session state");
        }
    }
}

struct TauriTransferEvents(AppHandle);

impl TransferEventSink for TauriTransferEvents {
    fn progress(&self, progress: &types::TransferProgress) {
        if let Err(error) = self.0.emit("transfer://progress", progress) {
            tracing::debug!(%error, "unable to emit transfer progress");
        }
    }
}

pub fn run() {
    let arguments: Vec<_> = std::env::args_os().collect();
    let portable = config::portable_mode_enabled(arguments.iter().cloned());
    let startup_profile = config::profile_argument(arguments.iter().cloned());
    let debug = arguments.iter().any(|argument| argument == "--debug");
    let _log_guard = match init_logging(debug) {
        Ok(guard) => guard,
        Err(error) => {
            eprintln!("Unable to initialize debug logging: {error}");
            None
        }
    };
    let config_path = match config::default_config_path(portable) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("Unable to determine configuration path: {error}");
            return;
        }
    };
    let config = match ConfigService::open(config_path) {
        Ok(service) => Arc::new(service),
        Err(error) => {
            eprintln!("Unable to load configuration: {error}");
            return;
        }
    };
    let vault_impl = Arc::new(KeyringVault::new());
    let credential_vault: Arc<dyn CredentialVault> = vault_impl.clone();
    let secret_resolver: Arc<dyn SecretResolver> = vault_impl;

    let builder = tauri::Builder::default().setup(move |app| {
        let sessions = Arc::new(SessionManager::new(
            secret_resolver,
            Arc::new(TauriSessionEvents(app.handle().clone())),
        ));
        let sftp = Arc::new(SftpService::new(
            sessions.clone(),
            Arc::new(TauriTransferEvents(app.handle().clone())),
        ));
        let ai = Arc::new(AiService::new(
            config.clone(),
            credential_vault.clone(),
            sessions.clone(),
        )?);
        let agent = Arc::new(AgentService::new(
            config.clone(),
            credential_vault.clone(),
            sessions.clone(),
            sftp.clone(),
        )?);
        app.manage(AppState {
            config: config.clone(),
            vault: credential_vault.clone(),
            sessions,
            sftp,
            ai,
            agent,
            startup_profile: startup_profile.clone(),
            portable,
        });
        Ok(())
    });
    if let Err(error) = builder
        .invoke_handler(tauri::generate_handler![
            ipc::app_info,
            ipc::session_connect,
            ipc::session_disconnect,
            ipc::session_list,
            ipc::terminal_write,
            ipc::terminal_resize,
            ipc::profile_list,
            ipc::profile_save,
            ipc::profile_delete,
            ipc::vault_set,
            ipc::vault_delete,
            ipc::quick_command_list,
            ipc::quick_command_save,
            ipc::quick_command_delete,
            ipc::app_theme_get,
            ipc::app_theme_save,
            ipc::sftp_read_dir,
            ipc::sftp_mkdir,
            ipc::sftp_rename,
            ipc::sftp_delete,
            ipc::sftp_upload,
            ipc::sftp_download,
            ipc::transfer_cancel,
            ipc::local_read_dir,
            ipc::ai_profile_list,
            ipc::ai_profile_save,
            ipc::ai_profile_delete,
            ipc::ai_test_connection,
            ipc::ai_chat,
            ipc::ai_abort,
            ipc::agent_settings_get,
            ipc::agent_settings_save,
            ipc::agent_skill_list,
            ipc::agent_mcp_test,
            ipc::agent_run,
            ipc::agent_approve,
            ipc::agent_abort,
            ipc::local_shell_list,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Unable to run myterm: {error}");
    }
}

fn init_logging(debug: bool) -> Result<Option<WorkerGuard>, AppError> {
    if !debug {
        return Ok(None);
    }
    let log_dir = dirs::config_dir()
        .ok_or_else(|| AppError::Config("operating system config directory is unavailable".into()))?
        .join("myterm")
        .join("logs");
    std::fs::create_dir_all(&log_dir)?;
    let appender = tracing_appender::rolling::daily(log_dir, "myterm.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);
    tracing_subscriber::fmt()
        .with_ansi(false)
        .with_max_level(tracing::Level::DEBUG)
        .with_writer(writer)
        .try_init()
        .map_err(|error| AppError::Config(format!("logging subscriber: {error}")))?;
    Ok(Some(guard))
}

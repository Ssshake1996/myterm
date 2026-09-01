use std::{path::PathBuf, process::Command, sync::Arc};

use serde::Serialize;
use tauri::{
    ipc::{Channel, Response},
    State,
};

use crate::{
    agent::{
        domain::{AgentConversation, AgentGoal, AgentQueuedInput, AgentTask},
        mcp,
        service::AgentEventSink,
        skills,
    },
    ai::service::{AiModelTestResult, AiTestResult},
    quick_commands::{
        self, QuickCommandImportPreview, QuickCommandImportResult, QuickCommandImportStrategy,
    },
    session::{local::detect_shells, manager::OutputSink, profile},
    sftp::service::local_entries,
    types::{
        AgentEvent, AgentPluginInfo, AgentRunResult, AgentSettings, AiProfile, AppFontScale,
        AppTheme, McpServerConfig, McpToolInfo, QuickCommand, RemoteEntry, SessionInfo,
        SessionProfile, SkillInfo, TerminalPalette, TerminalScreenSnapshot, TransferId,
    },
    AppError, AppState, IpcError,
};

struct TerminalChannel(Channel<Response>);

impl OutputSink for TerminalChannel {
    fn send(&self, data: &[u8]) -> Result<(), AppError> {
        self.0
            .send(Response::new(data.to_vec()))
            .map_err(|error| AppError::Session(format!("terminal channel closed: {error}")))
    }
}

struct AgentChannel(Channel<AgentEvent>);

impl AgentEventSink for AgentChannel {
    fn send(&self, event: AgentEvent) -> Result<(), AppError> {
        self.0
            .send(event)
            .map_err(|error| AppError::Ai(format!("agent event channel closed: {error}")))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: &'static str,
    pub commit_hash: &'static str,
    pub startup_profile: Option<String>,
    pub portable: bool,
}

#[derive(Serialize)]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: i64,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        commit_hash: env!("MYTERM_COMMIT_HASH"),
        startup_profile: state.startup_profile.clone(),
        portable: state.portable,
    }
}

#[tauri::command]
pub async fn session_connect(
    state: State<'_, AppState>,
    profile_id: String,
    cols: u16,
    rows: u16,
    on_data: Channel<Response>,
) -> Result<SessionInfo, IpcError> {
    let profile = state
        .config
        .profile_list()?
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| AppError::NotFound(format!("profile '{profile_id}'")))?;
    state
        .sessions
        .connect(profile, cols, rows, Arc::new(TerminalChannel(on_data)))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn session_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), IpcError> {
    state
        .sessions
        .disconnect(&session_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn session_list(state: State<'_, AppState>) -> Result<Vec<SessionInfo>, IpcError> {
    state.sessions.list().map_err(Into::into)
}

#[tauri::command]
pub async fn terminal_write(
    state: State<'_, AppState>,
    session_id: String,
    data_utf8: String,
) -> Result<(), IpcError> {
    state
        .sessions
        .write(&session_id, data_utf8.as_bytes())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), IpcError> {
    state
        .sessions
        .resize(&session_id, cols, rows)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn terminal_screen_update(
    state: State<'_, AppState>,
    session_id: String,
    snapshot: TerminalScreenSnapshot,
) -> Result<(), IpcError> {
    state
        .sessions
        .update_screen(&session_id, snapshot)
        .map_err(Into::into)
}

#[tauri::command]
pub fn profile_list(state: State<'_, AppState>) -> Result<Vec<SessionProfile>, IpcError> {
    state.config.profile_list().map_err(Into::into)
}

#[tauri::command]
pub fn profile_save(
    state: State<'_, AppState>,
    profile: SessionProfile,
    secret: Option<String>,
) -> Result<SessionProfile, IpcError> {
    profile::save(&state.config, state.vault.as_ref(), profile, secret).map_err(Into::into)
}

#[tauri::command]
pub fn profile_delete(state: State<'_, AppState>, profile_id: String) -> Result<(), IpcError> {
    profile::delete(&state.config, state.vault.as_ref(), &profile_id).map_err(Into::into)
}

#[tauri::command]
pub fn vault_set(
    state: State<'_, AppState>,
    r#ref: String,
    secret: String,
) -> Result<(), IpcError> {
    state.vault.set(&r#ref, &secret).map_err(Into::into)
}

#[tauri::command]
pub fn vault_delete(state: State<'_, AppState>, r#ref: String) -> Result<(), IpcError> {
    state.vault.delete(&r#ref).map_err(Into::into)
}

#[tauri::command]
pub fn quick_command_list(state: State<'_, AppState>) -> Result<Vec<QuickCommand>, IpcError> {
    state.config.quick_command_list().map_err(Into::into)
}

#[tauri::command]
pub fn quick_command_save(state: State<'_, AppState>, cmd: QuickCommand) -> Result<(), IpcError> {
    state.config.quick_command_save(cmd).map_err(Into::into)
}

#[tauri::command]
pub fn quick_command_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    state.config.quick_command_delete(&id).map_err(Into::into)
}

#[tauri::command]
pub fn quick_command_import_preview(
    state: State<'_, AppState>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<QuickCommandImportPreview, IpcError> {
    quick_commands::preview(&state.config, &file_name, &bytes).map_err(Into::into)
}

#[tauri::command]
pub fn quick_command_import_apply(
    state: State<'_, AppState>,
    file_name: String,
    bytes: Vec<u8>,
    strategy: QuickCommandImportStrategy,
) -> Result<QuickCommandImportResult, IpcError> {
    quick_commands::apply(&state.config, &file_name, &bytes, strategy).map_err(Into::into)
}

#[tauri::command]
pub fn quick_command_export(
    state: State<'_, AppState>,
    group: Option<String>,
) -> Result<String, IpcError> {
    quick_commands::export(&state.config, group.as_deref()).map_err(Into::into)
}

#[tauri::command]
pub fn app_theme_get(state: State<'_, AppState>) -> Result<AppTheme, IpcError> {
    state.config.app_theme().map_err(Into::into)
}

#[tauri::command]
pub fn app_theme_save(state: State<'_, AppState>, theme: AppTheme) -> Result<AppTheme, IpcError> {
    state.config.app_theme_save(theme)?;
    state.config.app_theme().map_err(Into::into)
}

#[tauri::command]
pub fn app_font_scale_get(state: State<'_, AppState>) -> Result<AppFontScale, IpcError> {
    state.config.app_font_scale().map_err(Into::into)
}

#[tauri::command]
pub fn app_font_scale_save(
    state: State<'_, AppState>,
    scale: AppFontScale,
) -> Result<AppFontScale, IpcError> {
    state.config.app_font_scale_save(scale)?;
    state.config.app_font_scale().map_err(Into::into)
}

#[tauri::command]
pub fn terminal_font_size_get(state: State<'_, AppState>) -> Result<u32, IpcError> {
    state.config.terminal_font_size().map_err(Into::into)
}

#[tauri::command]
pub fn terminal_font_size_save(state: State<'_, AppState>, size: u32) -> Result<u32, IpcError> {
    state
        .config
        .terminal_font_size_save(size)
        .map_err(Into::into)
}

#[tauri::command]
pub fn terminal_palette_get(state: State<'_, AppState>) -> Result<TerminalPalette, IpcError> {
    state.config.terminal_palette().map_err(Into::into)
}

#[tauri::command]
pub fn terminal_palette_save(
    state: State<'_, AppState>,
    palette: TerminalPalette,
) -> Result<TerminalPalette, IpcError> {
    state.config.terminal_palette_save(palette)?;
    state.config.terminal_palette().map_err(Into::into)
}

#[tauri::command]
pub async fn sftp_read_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<RemoteEntry>, IpcError> {
    state
        .sftp
        .read_dir(&session_id, &path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn sftp_default_directory(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<String, IpcError> {
    state
        .sftp
        .default_directory(&session_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), IpcError> {
    state
        .sftp
        .mkdir(&session_id, &path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    from: String,
    to: String,
) -> Result<(), IpcError> {
    state
        .sftp
        .rename(&session_id, &from, &to)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    recursive: bool,
) -> Result<(), IpcError> {
    state
        .sftp
        .delete(&session_id, &path, recursive)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<TransferId, IpcError> {
    state
        .sftp
        .upload(session_id, PathBuf::from(local_path), remote_path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<TransferId, IpcError> {
    state
        .sftp
        .download(session_id, remote_path, PathBuf::from(local_path))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn transfer_cancel(
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<(), IpcError> {
    state.sftp.cancel(&transfer_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn local_read_dir(path: String) -> Result<Vec<LocalEntry>, IpcError> {
    tauri::async_runtime::spawn_blocking(move || local_entries(&PathBuf::from(path)))
        .await
        .map_err(|error| AppError::Io(std::io::Error::other(error.to_string())))?
        .map_err(Into::into)
}

#[tauri::command]
pub fn local_default_directory() -> Result<String, IpcError> {
    dirs::home_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::Config("local home directory is unavailable".to_owned()).into())
}

#[tauri::command]
pub fn ai_profile_list(state: State<'_, AppState>) -> Result<Vec<AiProfile>, IpcError> {
    state.config.ai_profile_list().map_err(Into::into)
}

#[tauri::command]
pub fn ai_config_json(state: State<'_, AppState>) -> Result<serde_json::Value, IpcError> {
    state.config.ai_config_json().map_err(Into::into)
}

#[tauri::command]
pub fn config_open_local(state: State<'_, AppState>) -> Result<String, IpcError> {
    let path = state.config.path().to_path_buf();
    let target = if path.exists() {
        path.clone()
    } else {
        path.parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| path.clone())
    };
    let target_string = target.to_string_lossy().into_owned();
    let result = if cfg!(windows) {
        Command::new("cmd")
            .args(["/C", "start", "", &target_string])
            .spawn()
            .map(|_| ())
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&target).spawn().map(|_| ())
    } else {
        Command::new("xdg-open").arg(&target).spawn().map(|_| ())
    };
    result.map_err(|error| {
        AppError::Config(format!(
            "无法打开本地配置文件 '{}': {error}",
            target.display()
        ))
    })?;
    Ok(target_string)
}

#[tauri::command]
pub fn ai_profile_save(
    state: State<'_, AppState>,
    mut profile: AiProfile,
    api_key: Option<String>,
) -> Result<(), IpcError> {
    profile.api_key_ref = format!("ai.{}.key", profile.id);
    if let Some(secret) = api_key.filter(|value| !value.is_empty()) {
        state.vault.set(&profile.api_key_ref, &secret)?;
    }
    state.config.ai_profile_save(profile).map_err(Into::into)
}

#[tauri::command]
pub fn ai_profile_delete(state: State<'_, AppState>, profile_id: String) -> Result<(), IpcError> {
    if let Some(profile) = state.config.ai_profile_delete(&profile_id)? {
        state.vault.delete(&profile.api_key_ref)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_test_connection(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<AiTestResult, IpcError> {
    state
        .ai
        .test_connection(&profile_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ai_fetch_models(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<AiTestResult, IpcError> {
    state.ai.fetch_models(&profile_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn ai_test_model(
    state: State<'_, AppState>,
    profile_id: String,
    model: String,
    prompt: String,
) -> Result<AiModelTestResult, IpcError> {
    state
        .ai
        .test_model(&profile_id, &model, &prompt)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn agent_settings_get(state: State<'_, AppState>) -> Result<AgentSettings, IpcError> {
    state.config.agent_settings().map_err(Into::into)
}

#[tauri::command]
pub fn agent_plugin_list(state: State<'_, AppState>) -> Result<Vec<AgentPluginInfo>, IpcError> {
    state.agent.plugin_infos().map_err(Into::into)
}

#[tauri::command]
pub fn agent_settings_save(
    state: State<'_, AppState>,
    settings: AgentSettings,
) -> Result<AgentSettings, IpcError> {
    state.config.agent_settings_save(settings)?;
    state.config.agent_settings().map_err(Into::into)
}

#[tauri::command]
pub fn agent_skill_list(
    state: State<'_, AppState>,
    skill_directories: Option<Vec<String>>,
) -> Result<Vec<SkillInfo>, IpcError> {
    let directories = match skill_directories {
        Some(directories) => directories,
        None => state.config.agent_settings()?.skill_directories,
    };
    skills::discover(&directories).map_err(Into::into)
}

#[tauri::command]
pub async fn agent_mcp_test(server: McpServerConfig) -> Result<Vec<McpToolInfo>, IpcError> {
    mcp::list_tool_info(&server).await.map_err(Into::into)
}

#[tauri::command]
pub async fn agent_run(
    state: State<'_, AppState>,
    profile_id: String,
    prompt: String,
    conversation_id: Option<String>,
    session_id: Option<String>,
    on_event: Channel<AgentEvent>,
) -> Result<AgentRunResult, IpcError> {
    state
        .agent
        .run_in_conversation(
            &profile_id,
            conversation_id,
            prompt,
            session_id,
            Arc::new(AgentChannel(on_event)),
            None,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn agent_conversation_create(
    state: State<'_, AppState>,
    profile_id: String,
    title: Option<String>,
) -> Result<AgentConversation, IpcError> {
    state
        .agent
        .create_conversation(&profile_id, title.as_deref())
        .map_err(Into::into)
}

#[tauri::command]
pub fn agent_conversation_list(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<AgentConversation>, IpcError> {
    state
        .agent
        .conversations(limit.unwrap_or(50))
        .map_err(Into::into)
}

#[tauri::command]
pub fn agent_conversation_tasks(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<AgentTask>, IpcError> {
    state
        .agent
        .conversation_tasks(&conversation_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn agent_goal_get(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Option<AgentGoal>, IpcError> {
    state
        .agent
        .conversation_goal(&conversation_id)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn agent_input_queue(
    state: State<'_, AppState>,
    conversation_id: String,
    input: String,
) -> Result<AgentQueuedInput, IpcError> {
    state
        .agent
        .queue_input(&conversation_id, input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn agent_goal_pause(
    state: State<'_, AppState>,
    goal_id: String,
) -> Result<AgentGoal, IpcError> {
    state.agent.pause_goal(&goal_id).await.map_err(Into::into)
}

#[tauri::command]
pub fn agent_goal_resume(
    state: State<'_, AppState>,
    goal_id: String,
) -> Result<AgentGoal, IpcError> {
    state.agent.resume_goal(&goal_id).map_err(Into::into)
}

#[tauri::command]
pub async fn agent_goal_cancel(
    state: State<'_, AppState>,
    goal_id: String,
) -> Result<AgentGoal, IpcError> {
    state.agent.cancel_goal(&goal_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn agent_conversation_delete(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<bool, IpcError> {
    state
        .agent
        .conversation_delete(&conversation_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn agent_steer(
    state: State<'_, AppState>,
    conversation_id: String,
    input: String,
) -> Result<crate::types::AgentSteerResult, IpcError> {
    state
        .agent
        .steer(&conversation_id, input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn agent_approve(
    state: State<'_, AppState>,
    call_id: String,
    approved: bool,
) -> Result<(), IpcError> {
    state
        .agent
        .approve(&call_id, approved)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn agent_abort(
    state: State<'_, AppState>,
    conversation_id: Option<String>,
) -> Result<(), IpcError> {
    if let Some(conversation_id) = conversation_id {
        state
            .agent
            .abort_conversation(&conversation_id)
            .await
            .map_err(Into::into)
    } else {
        state.agent.abort().await;
        Ok(())
    }
}

#[tauri::command]
pub async fn agent_job_cancel(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<crate::agent::domain::ExecutionJob, IpcError> {
    state.agent.cancel_job(&job_id).await.map_err(Into::into)
}

#[tauri::command]
pub fn agent_task_list(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<AgentTask>, IpcError> {
    state.agent.tasks(limit.unwrap_or(50)).map_err(Into::into)
}

#[tauri::command]
pub fn agent_task_get(state: State<'_, AppState>, task_id: String) -> Result<AgentTask, IpcError> {
    state.agent.task(&task_id).map_err(Into::into)
}

#[tauri::command]
pub fn agent_task_events(
    state: State<'_, AppState>,
    task_id: String,
    after_sequence: Option<u64>,
    limit: Option<usize>,
) -> Result<Vec<AgentEvent>, IpcError> {
    state
        .agent
        .task_events(&task_id, after_sequence.unwrap_or(0), limit.unwrap_or(500))
        .map_err(Into::into)
}

#[tauri::command]
pub fn agent_task_delete(state: State<'_, AppState>, task_id: String) -> Result<bool, IpcError> {
    state.agent.task_delete(&task_id).map_err(Into::into)
}

#[tauri::command]
pub fn local_shell_list() -> Vec<String> {
    detect_shells()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::AppInfo;
    use crate::{
        config::{ConfigService, CredentialVault, MemoryVault},
        session::profile,
        types::{AuthMethod, SessionProfile, SessionTarget},
        AppError,
    };

    fn test_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("myterm-profile-ipc-{}", uuid::Uuid::new_v4()))
    }

    fn password_profile(id: &str, name: &str, host: &str) -> SessionProfile {
        SessionProfile {
            id: id.to_owned(),
            name: name.to_owned(),
            group: "测试服务器".to_owned(),
            environment: crate::types::SessionEnvironment::Production,
            target: SessionTarget::Ssh {
                host: host.to_owned(),
                port: 22,
                username: "root".to_owned(),
                auth: AuthMethod::Password {
                    vault_ref: "untrusted-frontend-reference".to_owned(),
                },
            },
        }
    }

    #[test]
    fn build_information_is_injected() {
        let info = AppInfo {
            version: env!("CARGO_PKG_VERSION"),
            commit_hash: env!("MYTERM_COMMIT_HASH"),
            startup_profile: None,
            portable: false,
        };
        assert!(!info.version.is_empty());
        assert!(!info.commit_hash.is_empty());
    }

    #[test]
    fn profile_save_requires_a_password_and_persists_edits(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = test_root();
        let path = root.join("config.json");
        let config = ConfigService::open(path.clone())?;
        let vault = MemoryVault::default();
        let profile = password_profile("server-one", "初始名称", "192.168.3.94");

        assert!(matches!(
            profile::save(&config, &vault, profile.clone(), None),
            Err(AppError::InvalidInput(_))
        ));
        let saved = profile::save(&config, &vault, profile, Some("test-password".to_owned()))?;
        let reference = match &saved.target {
            SessionTarget::Ssh {
                auth: AuthMethod::Password { vault_ref },
                ..
            } => vault_ref,
            _ => unreachable!(),
        };
        assert_eq!(reference, "profile.server-one.password");
        assert_eq!(vault.get(reference)?.as_deref(), Some("test-password"));

        let edited = password_profile("server-one", "修改后名称", "192.168.3.95");
        profile::save(&config, &vault, edited, None)?;
        let reloaded = ConfigService::open(path)?;
        let profiles = reloaded.profile_list()?;
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "修改后名称");
        assert!(matches!(
            &profiles[0].target,
            SessionTarget::Ssh { host, .. } if host == "192.168.3.95"
        ));
        assert_eq!(vault.get(reference)?.as_deref(), Some("test-password"));

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn profile_auth_changes_and_deletion_remove_credentials(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = test_root();
        let config = ConfigService::open(root.join("config.json"))?;
        let vault = MemoryVault::default();
        let saved = profile::save(
            &config,
            &vault,
            password_profile("server-two", "服务器", "192.168.3.94"),
            Some("test-password".to_owned()),
        )?;
        let password_ref = match &saved.target {
            SessionTarget::Ssh {
                auth: AuthMethod::Password { vault_ref },
                ..
            } => vault_ref.clone(),
            _ => unreachable!(),
        };

        let local = SessionProfile {
            target: SessionTarget::Local {
                shell: "powershell.exe".to_owned(),
            },
            ..saved
        };
        profile::save(&config, &vault, local, None)?;
        assert!(vault.get(&password_ref)?.is_none());

        profile::save(
            &config,
            &vault,
            password_profile("server-two", "服务器", "192.168.3.94"),
            Some("replacement-password".to_owned()),
        )?;
        profile::delete(&config, &vault, "server-two")?;
        assert!(config.profile_list()?.is_empty());
        assert!(vault.get(&password_ref)?.is_none());

        fs::remove_dir_all(root)?;
        Ok(())
    }
}

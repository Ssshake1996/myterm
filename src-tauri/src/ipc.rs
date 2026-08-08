use std::{path::PathBuf, sync::Arc};

use serde::Serialize;
use tauri::{
    ipc::{Channel, Response},
    State,
};

use crate::{
    ai::service::{AiChatResult, AiTestResult, DeltaSink},
    session::{local::detect_shells, manager::OutputSink},
    sftp::service::local_entries,
    types::{
        AiMessage, AiProfile, AuthMethod, QuickCommand, RemoteEntry, SessionInfo, SessionProfile,
        TransferId,
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

struct AiChannel(Channel<String>);

impl DeltaSink for AiChannel {
    fn send(&self, delta: &str) -> Result<(), AppError> {
        self.0
            .send(delta.to_owned())
            .map_err(|error| AppError::Ai(format!("AI channel closed: {error}")))
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
) -> Result<String, IpcError> {
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
pub fn profile_list(state: State<'_, AppState>) -> Result<Vec<SessionProfile>, IpcError> {
    state.config.profile_list().map_err(Into::into)
}

#[tauri::command]
pub fn profile_save(state: State<'_, AppState>, profile: SessionProfile) -> Result<(), IpcError> {
    state.config.profile_save(profile).map_err(Into::into)
}

#[tauri::command]
pub fn profile_delete(state: State<'_, AppState>, profile_id: String) -> Result<(), IpcError> {
    let deleted = state.config.profile_delete(&profile_id)?;
    if let Some(profile) = deleted {
        match profile.target {
            crate::types::SessionTarget::Ssh { auth, .. } => match auth {
                AuthMethod::Password { vault_ref } => state.vault.delete(&vault_ref)?,
                AuthMethod::PrivateKey { passphrase_ref, .. } => {
                    if let Some(reference) = passphrase_ref {
                        state.vault.delete(&reference)?;
                    }
                }
            },
            crate::types::SessionTarget::Local { .. } => {}
        }
    }
    Ok(())
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
pub fn ai_profile_list(state: State<'_, AppState>) -> Result<Vec<AiProfile>, IpcError> {
    state.config.ai_profile_list().map_err(Into::into)
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
pub async fn ai_chat(
    state: State<'_, AppState>,
    profile_id: String,
    messages: Vec<AiMessage>,
    attach_session_id: Option<String>,
    on_delta: Channel<String>,
) -> Result<AiChatResult, IpcError> {
    state
        .ai
        .chat(
            &profile_id,
            messages,
            attach_session_id.as_deref(),
            Arc::new(AiChannel(on_delta)),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ai_abort(state: State<'_, AppState>) -> Result<(), IpcError> {
    state.ai.abort().await;
    Ok(())
}

#[tauri::command]
pub fn local_shell_list() -> Vec<String> {
    detect_shells()
}

#[cfg(test)]
mod tests {
    use super::AppInfo;

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
}

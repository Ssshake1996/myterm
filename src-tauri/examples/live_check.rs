use std::sync::{Arc, Mutex};

use myterm_lib::{
    agent::{mcp, service::AgentEventSink},
    config::{default_config_path, ConfigService, CredentialVault, KeyringVault},
    session::{
        manager::{NullEventSink, OutputSink, SessionManager},
        profile,
    },
    sftp::service::{NullTransferSink, SftpService},
    types::{
        AgentEvent, AgentPermissionMode, AuthMethod, McpServerConfig, SessionProfile, SessionTarget,
    },
    AppError, SecretResolver,
};

const PROFILE_ID: &str = "server-yuxiaservers";

struct DiscardOutput;

impl OutputSink for DiscardOutput {
    fn send(&self, _data: &[u8]) -> Result<(), AppError> {
        Ok(())
    }
}

#[derive(Default)]
struct EventLog(Mutex<Vec<AgentEvent>>);

impl AgentEventSink for EventLog {
    fn send(&self, event: AgentEvent) -> Result<(), AppError> {
        self.0
            .lock()
            .map_err(|_| AppError::Ai("event log lock is poisoned".to_owned()))?
            .push(event);
        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    match std::env::args().nth(1).as_deref() {
        Some("save-profile") => save_profile()?,
        Some("verify-crud") => verify_crud()?,
        Some("verify-profile") => verify_profile().await?,
        Some("verify-agent") => verify_agent().await?,
        Some("verify-mcp") => verify_mcp().await?,
        _ => {
            return Err(
                "usage: cargo run --example live_check -- <save-profile|verify-crud|verify-profile|verify-agent|verify-mcp>"
                    .into(),
            );
        }
    }
    Ok(())
}

fn verify_crud() -> Result<(), Box<dyn std::error::Error>> {
    let password = std::env::var("MYTERM_LIVE_PASSWORD")?;
    let config_path = default_config_path(false)?;
    let config = ConfigService::open(config_path.clone())?;
    let vault = KeyringVault::new();
    let temporary_id = format!("live-crud-{}", uuid::Uuid::new_v4());
    let created = profile::save(
        &config,
        &vault,
        SessionProfile {
            id: temporary_id.clone(),
            name: "临时服务器".to_owned(),
            group: "验证".to_owned(),
            target: SessionTarget::Ssh {
                host: "192.168.3.94".to_owned(),
                port: 22,
                username: "root".to_owned(),
                auth: AuthMethod::Password {
                    vault_ref: String::new(),
                },
            },
        },
        Some(password),
    )?;
    let credential_ref = match &created.target {
        SessionTarget::Ssh {
            auth: AuthMethod::Password { vault_ref },
            ..
        } => vault_ref.clone(),
        _ => return Err("temporary profile has unexpected authentication".into()),
    };
    let edited = profile::save(
        &config,
        &vault,
        SessionProfile {
            name: "临时服务器-已修改".to_owned(),
            group: "验证/修改".to_owned(),
            ..created
        },
        None,
    )?;
    drop(config);

    let reloaded = ConfigService::open(config_path)?;
    let persisted = reloaded
        .profile_list()?
        .into_iter()
        .find(|candidate| candidate.id == temporary_id)
        .ok_or("edited profile was not reloaded")?;
    if persisted.name != edited.name || vault.get(&credential_ref)?.is_none() {
        return Err("edited profile or its credential was not persisted".into());
    }
    profile::delete(&reloaded, &vault, &temporary_id)?;
    drop(reloaded);

    let final_config = ConfigService::open(default_config_path(false)?)?;
    if final_config
        .profile_list()?
        .iter()
        .any(|candidate| candidate.id == temporary_id)
        || vault.get(&credential_ref)?.is_some()
    {
        return Err("deleted profile or credential still exists".into());
    }
    println!("CRUD_VERIFIED create edit delete reload");
    Ok(())
}

fn save_profile() -> Result<(), Box<dyn std::error::Error>> {
    let password = std::env::var("MYTERM_LIVE_PASSWORD")?;
    let config_path = default_config_path(false)?;
    let config = ConfigService::open(config_path.clone())?;
    let vault = KeyringVault::new();
    let saved = profile::save(
        &config,
        &vault,
        SessionProfile {
            id: PROFILE_ID.to_owned(),
            name: "yuxiaservers".to_owned(),
            group: "服务器".to_owned(),
            target: SessionTarget::Ssh {
                host: "192.168.3.94".to_owned(),
                port: 22,
                username: "root".to_owned(),
                auth: AuthMethod::Password {
                    vault_ref: String::new(),
                },
            },
        },
        Some(password),
    )?;
    drop(config);

    let reloaded = ConfigService::open(config_path)?;
    let persisted = reloaded
        .profile_list()?
        .into_iter()
        .find(|candidate| candidate.id == saved.id)
        .ok_or("saved profile was not reloaded")?;
    let reference = match &persisted.target {
        SessionTarget::Ssh {
            auth: AuthMethod::Password { vault_ref },
            ..
        } => vault_ref,
        _ => return Err("saved profile has unexpected authentication".into()),
    };
    if vault.get(reference)?.is_none() {
        return Err("saved profile credential was not reloaded".into());
    }
    println!("PROFILE_SAVED {} {}", persisted.id, persisted.name);
    Ok(())
}

async fn verify_profile() -> Result<(), Box<dyn std::error::Error>> {
    let (config, vault, sessions, profile) = live_services()?;
    let session = sessions
        .connect(profile, 120, 36, Arc::new(DiscardOutput))
        .await?;
    let session_id = session.session_id;
    sessions
        .write(
            &session_id,
            b"printf '\\nMYTERM_SSH_OK\\n'; hostname; whoami\r",
        )
        .await?;
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    let output = sessions.buffer_lines(&session_id, 80)?;
    if !output.contains("MYTERM_SSH_OK") || !output.contains("root") {
        return Err("SSH verification output did not contain the expected marker".into());
    }
    sessions.disconnect(&session_id).await?;
    drop((config, vault));
    println!("SSH_VERIFIED yuxiaservers root");
    Ok(())
}

async fn verify_agent() -> Result<(), Box<dyn std::error::Error>> {
    let source = default_config_path(false)?;
    let temporary_root = std::env::temp_dir().join(format!("myterm-live-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temporary_root)?;
    let temporary_config = temporary_root.join("config.json");
    std::fs::copy(&source, &temporary_config)?;

    let result = verify_agent_with_config(temporary_config).await;
    std::fs::remove_dir_all(&temporary_root)?;
    result
}

async fn verify_agent_with_config(
    config_path: std::path::PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let config = Arc::new(ConfigService::open(config_path)?);
    let mut settings = config.agent_settings()?;
    settings.permission_mode = AgentPermissionMode::FullAccess;
    config.agent_settings_save(settings)?;
    let profile = find_profile(&config)?;
    let ai_profile = config
        .ai_profile_list()?
        .into_iter()
        .next()
        .ok_or("AI profile is not configured")?;
    let vault_impl = Arc::new(KeyringVault::new());
    let vault: Arc<dyn CredentialVault> = vault_impl.clone();
    let resolver: Arc<dyn SecretResolver> = vault_impl;
    let sessions = Arc::new(SessionManager::new(resolver, Arc::new(NullEventSink)));
    let sftp = Arc::new(SftpService::new(
        sessions.clone(),
        Arc::new(NullTransferSink),
    ));
    let agent =
        myterm_lib::agent::service::AgentService::new(config, vault, sessions.clone(), sftp)?;
    let session = sessions
        .connect(profile, 120, 36, Arc::new(DiscardOutput))
        .await?;
    let session_id = session.session_id;
    sessions
        .write(
            &session_id,
            b"printf '\\nMYTERM_AGENT_CONTEXT\\n'; hostname; whoami\r",
        )
        .await?;
    tokio::time::sleep(std::time::Duration::from_millis(900)).await;

    let events = Arc::new(EventLog::default());
    let run = agent
        .run(
            &ai_profile.id,
            "Use all four built-in tools before the final answer: call session_info; call terminal_context; call terminal_send with command `printf 'MYTERM_AGENT_TOOL_OK\\n'`; and call list_directory with scope `remote` and path `/root`. After every tool has returned, report only the hostname and current user."
                .to_owned(),
            Some(session_id.clone()),
            events.clone(),
        )
        .await?;
    sessions.disconnect(&session_id).await?;
    let recorded = events.0.lock().map_err(|_| "event log lock is poisoned")?;
    let tools: Vec<_> = recorded
        .iter()
        .filter(|event| event.event_type == "tool_requested")
        .filter_map(|event| event.tool_name.as_deref())
        .collect();
    let required = [
        "session_info",
        "terminal_context",
        "terminal_send",
        "list_directory",
    ];
    if required.iter().any(|required| !tools.contains(required)) {
        return Err(format!("model did not call every required tool: {tools:?}").into());
    }
    if !recorded.iter().any(|event| event.event_type == "assistant") {
        return Err("agent did not produce a final answer".into());
    }
    println!("AGENT_VERIFIED {} {}", run.finish_reason, tools.join(","));
    Ok(())
}

async fn verify_mcp() -> Result<(), Box<dyn std::error::Error>> {
    let server = McpServerConfig {
        id: "official-everything".to_owned(),
        name: "MCP Everything".to_owned(),
        command: "npx.cmd".to_owned(),
        args: vec![
            "-y".to_owned(),
            "@modelcontextprotocol/server-everything".to_owned(),
        ],
        cwd: None,
        enabled: true,
    };
    let tools = mcp::list_tool_info(&server).await?;
    if tools.is_empty() {
        return Err("MCP server returned no tools".into());
    }
    println!("MCP_VERIFIED {} tools", tools.len());
    Ok(())
}

fn live_services() -> Result<LiveServices, Box<dyn std::error::Error>> {
    let config = Arc::new(ConfigService::open(default_config_path(false)?)?);
    let profile = find_profile(&config)?;
    let vault_impl = Arc::new(KeyringVault::new());
    let vault: Arc<dyn CredentialVault> = vault_impl.clone();
    let resolver: Arc<dyn SecretResolver> = vault_impl;
    let sessions = Arc::new(SessionManager::new(resolver, Arc::new(NullEventSink)));
    Ok((config, vault, sessions, profile))
}

type LiveServices = (
    Arc<ConfigService>,
    Arc<dyn CredentialVault>,
    Arc<SessionManager>,
    SessionProfile,
);

fn find_profile(config: &ConfigService) -> Result<SessionProfile, Box<dyn std::error::Error>> {
    config
        .profile_list()?
        .into_iter()
        .find(|candidate| candidate.id == PROFILE_ID)
        .ok_or_else(|| "live server profile is not configured".into())
}

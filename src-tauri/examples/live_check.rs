use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use myterm_lib::{
    agent::{mcp, service::AgentEventSink},
    ai::service::AiService,
    config::{default_config_path, ConfigService, CredentialVault, KeyringVault},
    session::{
        manager::{NullEventSink, OutputSink, SessionManager},
        profile,
        ssh::{ExecOutputSink, ExecStream},
    },
    sftp::service::{NullTransferSink, SftpService, TransferEventSink},
    types::{
        AgentEvent, AgentPermissionMode, AiAuthMode, AiProfile, AuthMethod, McpServerConfig,
        McpTransportKind, SessionProfile, SessionTarget, TransferProgress, TransferState,
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
struct TransferLog(Mutex<Vec<TransferProgress>>);

impl TransferEventSink for TransferLog {
    fn progress(&self, progress: &TransferProgress) {
        self.0.lock().unwrap().push(progress.clone());
    }
}

async fn wait_for_transfers(
    events: &TransferLog,
    transfer_ids: &[String],
) -> Result<(), Box<dyn std::error::Error>> {
    for _ in 0..200 {
        let latest = {
            let events = events.0.lock().unwrap();
            transfer_ids
                .iter()
                .map(|transfer_id| {
                    events
                        .iter()
                        .rev()
                        .find(|event| &event.transfer_id == transfer_id)
                        .cloned()
                })
                .collect::<Vec<_>>()
        };
        if let Some(failed) = latest.iter().flatten().find(|event| {
            matches!(
                event.state,
                TransferState::Failed | TransferState::Cancelled
            )
        }) {
            return Err(format!(
                "transfer {} failed: {}",
                failed.transfer_id,
                failed.error.as_deref().unwrap_or("cancelled")
            )
            .into());
        }
        if latest.iter().all(|event| {
            event
                .as_ref()
                .is_some_and(|event| event.state == TransferState::Done)
        }) {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    Err("transfer verification timed out".into())
}

async fn remove_temporary_directory(
    path: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut last_error = None;
    for _ in 0..100 {
        match std::fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err(last_error
        .map(|error| {
            format!(
                "unable to remove temporary directory {}: {error}",
                path.display()
            )
        })
        .unwrap_or_else(|| format!("unable to remove temporary directory {}", path.display()))
        .into())
}

#[derive(Default)]
struct ExecCapture {
    stdout: Mutex<Vec<u8>>,
    stderr: Mutex<Vec<u8>>,
    stdout_bytes: Mutex<u64>,
    stderr_bytes: Mutex<u64>,
}

impl ExecOutputSink for ExecCapture {
    fn send(&self, stream: ExecStream, data: &[u8]) -> Result<(), AppError> {
        let (preview, count) = match stream {
            ExecStream::Stdout => (&self.stdout, &self.stdout_bytes),
            ExecStream::Stderr => (&self.stderr, &self.stderr_bytes),
        };
        let mut count = count
            .lock()
            .map_err(|_| AppError::Session("exec byte counter lock is poisoned".to_owned()))?;
        *count = count.saturating_add(data.len() as u64);
        let mut preview = preview
            .lock()
            .map_err(|_| AppError::Session("exec preview lock is poisoned".to_owned()))?;
        let remaining = (64 * 1024usize).saturating_sub(preview.len());
        preview.extend_from_slice(&data[..data.len().min(remaining)]);
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
        Some("verify-exec") => verify_exec().await?,
        Some("verify-files") => verify_files().await?,
        Some("verify-agent") => verify_agent().await?,
        Some("verify-harness") => verify_harness().await?,
        Some("verify-ai-protocol") => verify_ai_protocol().await?,
        Some("verify-mcp") => verify_mcp().await?,
        _ => {
            return Err(
                "usage: cargo run --example live_check -- <save-profile|verify-crud|verify-profile|verify-exec|verify-files|verify-agent|verify-harness|verify-ai-protocol|verify-mcp>"
                    .into(),
            );
        }
    }
    Ok(())
}

fn verify_crud() -> Result<(), Box<dyn std::error::Error>> {
    let config_path = default_config_path(false)?;
    let config = ConfigService::open(config_path.clone())?;
    let vault = KeyringVault::new();
    let saved = find_profile(&config)?;
    let saved_reference = match saved.target {
        SessionTarget::Ssh {
            auth: AuthMethod::Password { vault_ref },
            ..
        } => vault_ref,
        _ => return Err("live profile does not use password authentication".into()),
    };
    let password = vault
        .get(&saved_reference)?
        .ok_or("live profile credential is not available")?;
    let temporary_id = format!("live-crud-{}", uuid::Uuid::new_v4());
    let created = profile::save(
        &config,
        &vault,
        SessionProfile {
            id: temporary_id.clone(),
            name: "临时服务器".to_owned(),
            group: "验证".to_owned(),
            environment: myterm_lib::types::SessionEnvironment::Production,
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
            environment: myterm_lib::types::SessionEnvironment::Production,
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

async fn verify_exec() -> Result<(), Box<dyn std::error::Error>> {
    let (_config, _vault, sessions, profile) = live_services()?;
    let session = sessions
        .connect(profile, 120, 36, Arc::new(DiscardOutput))
        .await?;
    let session_id = session.session_id;

    let run = async {
        let capture = Arc::new(ExecCapture::default());
        let (_cancel, receiver) = tokio::sync::watch::channel(false);
        let result = sessions
            .remote_exec(
                &session_id,
                "printf 'OUT_OK'; printf 'ERR_OK' >&2; exit 7",
                std::time::Duration::from_secs(10),
                receiver,
                capture.clone(),
            )
            .await?;
        if result.exit_code != Some(7)
            || String::from_utf8_lossy(&capture.stdout.lock().unwrap()) != "OUT_OK"
            || String::from_utf8_lossy(&capture.stderr.lock().unwrap()) != "ERR_OK"
        {
            return Err("structured stdout/stderr/exit verification failed".into());
        }

        let timeout_capture = Arc::new(ExecCapture::default());
        let (_cancel, receiver) = tokio::sync::watch::channel(false);
        let timed_out = sessions
            .remote_exec(
                &session_id,
                "sleep 2",
                std::time::Duration::from_millis(150),
                receiver,
                timeout_capture,
            )
            .await?;
        if !timed_out.timed_out || timed_out.canceled {
            return Err("structured timeout verification failed".into());
        }

        let large_capture = Arc::new(ExecCapture::default());
        let (_cancel, receiver) = tokio::sync::watch::channel(false);
        let large = sessions
            .remote_exec(
                &session_id,
                "head -c 10485760 /dev/zero",
                std::time::Duration::from_secs(30),
                receiver,
                large_capture.clone(),
            )
            .await?;
        if large.exit_code != Some(0) || *large_capture.stdout_bytes.lock().unwrap() != 10_485_760 {
            return Err("10 MiB streaming output verification failed".into());
        }
        Ok::<_, Box<dyn std::error::Error>>(())
    }
    .await;
    sessions.disconnect(&session_id).await?;
    run?;
    println!("EXEC_VERIFIED exit stderr timeout 10MiB");
    Ok(())
}

async fn verify_files() -> Result<(), Box<dyn std::error::Error>> {
    let (_config, _vault, sessions, profile) = live_services()?;
    let transfer_log = Arc::new(TransferLog::default());
    let sftp = Arc::new(SftpService::new(sessions.clone(), transfer_log.clone()));
    let session = sessions
        .connect(profile, 120, 36, Arc::new(DiscardOutput))
        .await?;
    let session_id = session.session_id;
    let default_directory = sftp.default_directory(&session_id).await?;
    if !default_directory.starts_with('/') {
        return Err("SFTP default directory is not absolute".into());
    }
    let default_entries = sftp.read_dir(&session_id, &default_directory).await?;
    let directory = format!("/tmp/myterm-live-{}", uuid::Uuid::new_v4());
    let path = format!("{directory}/check.txt");
    let local_directory =
        std::env::temp_dir().join(format!("myterm-transfer-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&local_directory)?;
    let upload_sources = [
        local_directory.join("alpha.txt"),
        local_directory.join("beta.txt"),
    ];
    std::fs::write(&upload_sources[0], b"upload alpha\n")?;
    std::fs::write(&upload_sources[1], b"upload beta\n")?;
    let run = async {
        sftp.mkdir(&session_id, &directory).await?;
        let created = sftp
            .file_write_atomic(&session_id, &path, b"alpha\nbeta\n", None)
            .await?;
        let read = sftp.file_read(&session_id, &path, 0, 1024).await?;
        if read.content != "alpha\nbeta\n" {
            return Err("file readback differs from atomic write".into());
        }
        let changed = sftp
            .file_write_atomic(
                &session_id,
                &path,
                b"alpha\ngamma\n",
                created.sha256.as_deref(),
            )
            .await?;
        let matches = sftp
            .file_search(&session_id, &directory, "gamma", 10, 10)
            .await?;
        if changed.sha256 == created.sha256 || matches.len() != 1 {
            return Err("file optimistic write or search verification failed".into());
        }
        let mut upload_ids = Vec::new();
        for (name, source) in ["alpha.txt", "beta.txt"].iter().zip(&upload_sources) {
            upload_ids.push(
                sftp.upload(
                    session_id.clone(),
                    source.clone(),
                    format!("{directory}/{name}"),
                )
                .await?,
            );
        }
        wait_for_transfers(&transfer_log, &upload_ids).await?;
        if sftp
            .file_read(&session_id, &format!("{directory}/alpha.txt"), 0, 1024)
            .await?
            .content
            != "upload alpha\n"
        {
            return Err("batch upload readback differs".into());
        }
        let download_targets = [
            local_directory.join("download-alpha.txt"),
            local_directory.join("download-beta.txt"),
        ];
        let mut download_ids = Vec::new();
        for (name, target) in ["alpha.txt", "beta.txt"].iter().zip(&download_targets) {
            download_ids.push(
                sftp.download(
                    session_id.clone(),
                    format!("{directory}/{name}"),
                    target.clone(),
                )
                .await?,
            );
        }
        wait_for_transfers(&transfer_log, &download_ids).await?;
        if std::fs::read(&download_targets[0])? != b"upload alpha\n"
            || std::fs::read(&download_targets[1])? != b"upload beta\n"
        {
            return Err("batch download readback differs".into());
        }
        Ok::<_, Box<dyn std::error::Error>>(())
    }
    .await;
    let _ = sftp.delete(&session_id, &directory, true).await;
    let _ = std::fs::remove_dir_all(&local_directory);
    sessions.disconnect(&session_id).await?;
    run?;
    println!(
        "FILES_VERIFIED default={} entries={} atomic-write read search batch-upload batch-download cleanup",
        default_directory,
        default_entries.len()
    );
    Ok(())
}

async fn verify_agent() -> Result<(), Box<dyn std::error::Error>> {
    let source = default_config_path(false)?;
    let temporary_root = std::env::temp_dir().join(format!("myterm-live-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temporary_root)?;
    let temporary_config = temporary_root.join("config.json");
    std::fs::copy(&source, &temporary_config)?;

    let result = verify_agent_with_config(temporary_config).await;
    let cleanup = remove_temporary_directory(&temporary_root).await;
    result?;
    cleanup
}

async fn verify_harness() -> Result<(), Box<dyn std::error::Error>> {
    let source = default_config_path(false)?;
    let temporary_root =
        std::env::temp_dir().join(format!("myterm-harness-live-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temporary_root)?;
    let temporary_config = temporary_root.join("config.json");
    std::fs::copy(&source, &temporary_config)?;

    let result = async {
        let config = Arc::new(ConfigService::open(temporary_config)?);
        let mut settings = config.agent_settings()?;
        settings.permission_mode = AgentPermissionMode::ReadOnly;
        config.agent_settings_save(settings)?;
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
        let agent = Arc::new(myterm_lib::agent::service::AgentService::new(
            config,
            vault,
            sessions,
            sftp,
        )?);
        let events = Arc::new(EventLog::default());
        let local_tool = if cfg!(windows) { "pwsh" } else { "bash" };
        let run = agent
            .run(
                &ai_profile.id,
                format!(
                    "Call the Harness LOCAL `{local_tool}` tool exactly once to inspect the current working directory. Do not call any MCP, SSH, or myterm-host-tools tool. Then answer with exactly: HARNESS_LOCAL_TOOLS_OK"
                ),
                None,
                events.clone(),
            )
            .await?;
        agent.shutdown().await;
        let recorded = events.0.lock().map_err(|_| "event log lock is poisoned")?;
        let tools = recorded
            .iter()
            .filter(|event| event.event_type == "tool_requested")
            .filter_map(|event| event.tool_name.clone())
            .collect::<Vec<_>>();
        let answer = recorded
            .iter()
            .filter(|event| event.event_type == "assistant")
            .filter_map(|event| event.content.as_deref())
            .collect::<String>();
        if !tools.iter().any(|tool| tool == local_tool) {
            return Err(format!(
                "DeepSeek Harness did not call the required local {local_tool} tool: {tools:?}"
            )
            .into());
        }
        if tools
            .iter()
            .any(|tool| tool.starts_with("mcp__myterm-host-tools__"))
        {
            return Err(format!(
                "DeepSeek Harness crossed the local/remote tool boundary: {tools:?}"
            )
            .into());
        }
        if !answer.contains("HARNESS_LOCAL_TOOLS_OK") {
            return Err(format!("unexpected Harness answer: {answer}").into());
        }
        let finish_reason = run.finish_reason;
        let tool_names = tools.join(",");
        drop(recorded);
        drop(events);
        drop(agent);
        println!("HARNESS_VERIFIED {finish_reason} {tool_names}");
        Ok::<_, Box<dyn std::error::Error>>(())
    }
    .await;
    let cleanup = remove_temporary_directory(&temporary_root).await;
    result?;
    cleanup
}

#[derive(Default)]
struct StreamProbe {
    network_chunks: usize,
    data_frames: usize,
    choice_frames: usize,
    content_delta_frames: usize,
    tool_call_delta_frames: usize,
    usage_frames: usize,
    error_frames: usize,
    parse_errors: usize,
    done_seen: bool,
    finish_reasons: BTreeSet<String>,
}

async fn verify_ai_protocol() -> Result<(), Box<dyn std::error::Error>> {
    let config = Arc::new(ConfigService::open(default_config_path(false)?)?);
    let owner = config
        .ai_profile_list()?
        .into_iter()
        .next()
        .ok_or("AI profile is not configured")?;
    let model = owner
        .effective_models()
        .into_iter()
        .next()
        .ok_or("AI profile has no enabled model")?;
    let provider = resolve_live_provider(config.as_ref(), &owner, &model.provider_profile_id)?;
    let vault_impl = Arc::new(KeyringVault::new());
    let api_key = vault_impl
        .get(&provider.api_key_ref)?
        .filter(|value| !value.trim().is_empty())
        .ok_or("AI provider API key is not available")?;

    let vault: Arc<dyn CredentialVault> = vault_impl.clone();
    let resolver: Arc<dyn SecretResolver> = vault_impl;
    let sessions = Arc::new(SessionManager::new(resolver, Arc::new(NullEventSink)));
    let ai = AiService::new(config, vault, sessions)?;
    let non_stream = ai
        .test_model(&owner.id, &model.id, "Reply with exactly: HI")
        .await?;
    if !non_stream.ok {
        let diagnostic = non_stream
            .error
            .map(|error| format!("{}\n{}", error.summary, error.detail))
            .unwrap_or_else(|| "non-stream request failed without diagnostics".to_owned());
        return Err(diagnostic.into());
    }
    println!(
        "AI_NON_STREAM_VERIFIED model={} elapsed_ms={}",
        non_stream.model.as_deref().unwrap_or(&model.model),
        non_stream.elapsed_ms.unwrap_or_default()
    );

    let plain = inspect_chat_stream(&provider, &model.model, &api_key, false).await?;
    print_stream_probe("plain", &plain);
    let tool = inspect_chat_stream(&provider, &model.model, &api_key, true).await?;
    print_stream_probe("tool", &tool);
    Ok(())
}

fn resolve_live_provider(
    config: &ConfigService,
    owner: &AiProfile,
    provider_profile_id: &Option<String>,
) -> Result<AiProfile, Box<dyn std::error::Error>> {
    let Some(provider_id) = provider_profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != owner.id)
    else {
        return Ok(owner.clone());
    };
    config
        .ai_profile_list()?
        .into_iter()
        .find(|profile| profile.id == provider_id)
        .ok_or_else(|| format!("AI provider profile '{provider_id}' is not configured").into())
}

async fn inspect_chat_stream(
    provider: &AiProfile,
    model: &str,
    api_key: &str,
    force_tool: bool,
) -> Result<StreamProbe, Box<dyn std::error::Error>> {
    let endpoint = live_chat_endpoint(&provider.base_url)?;
    let client = reqwest::Client::builder()
        .tls_built_in_native_certs(true)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()?;
    let mut body = serde_json::json!({
        "model": model,
        "messages": [{
            "role": "user",
            "content": if force_tool {
                "Call the protocol_probe tool exactly once."
            } else {
                "Reply with exactly: HI"
            },
        }],
        "stream": true,
        "stream_options": {"include_usage": true},
    });
    if force_tool {
        body["tools"] = serde_json::json!([{
            "type": "function",
            "function": {
                "name": "protocol_probe",
                "description": "A no-op protocol compatibility probe.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false,
                },
            },
        }]);
        body["tool_choice"] = serde_json::json!({
            "type": "function",
            "function": {"name": "protocol_probe"},
        });
    }
    let request = client.post(endpoint.clone()).json(&body);
    let request = match provider.auth_mode {
        AiAuthMode::Bearer => request.bearer_auth(api_key),
        AiAuthMode::ApiKey => request.header(reqwest::header::AUTHORIZATION, api_key),
    };
    let mut response = request.send().await?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("<missing>")
        .to_owned();
    if !status.is_success() {
        let body = response.text().await?;
        return Err(format!(
            "stream probe HTTP {status}; endpoint={endpoint}; content-type={content_type}; body={}",
            bounded_redacted(&body, api_key)
        )
        .into());
    }

    let mut probe = StreamProbe::default();
    let mut pending = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        probe.network_chunks += 1;
        pending.extend_from_slice(&chunk);
        while let Some(position) = pending.iter().position(|byte| *byte == b'\n') {
            let line = pending.drain(..=position).collect::<Vec<_>>();
            inspect_sse_line(&line, &mut probe);
        }
    }
    if !pending.is_empty() {
        inspect_sse_line(&pending, &mut probe);
    }
    println!(
        "AI_STREAM_HTTP scenario={} status={} content_type={}",
        if force_tool { "tool" } else { "plain" },
        status.as_u16(),
        content_type
    );
    Ok(probe)
}

fn inspect_sse_line(line: &[u8], probe: &mut StreamProbe) {
    let line = String::from_utf8_lossy(line);
    let line = line.trim_end_matches(['\r', '\n']);
    let Some(data) = line.strip_prefix("data:").map(str::trim) else {
        return;
    };
    if data == "[DONE]" {
        probe.done_seen = true;
        return;
    }
    if data.is_empty() {
        return;
    }
    probe.data_frames += 1;
    let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
        probe.parse_errors += 1;
        return;
    };
    if value.get("usage").is_some_and(|usage| !usage.is_null()) {
        probe.usage_frames += 1;
    }
    if value.get("error").is_some() {
        probe.error_frames += 1;
    }
    let Some(choices) = value.get("choices").and_then(serde_json::Value::as_array) else {
        return;
    };
    if !choices.is_empty() {
        probe.choice_frames += 1;
    }
    for choice in choices {
        if let Some(reason) = choice
            .get("finish_reason")
            .and_then(serde_json::Value::as_str)
        {
            probe.finish_reasons.insert(reason.to_owned());
        }
        let Some(delta) = choice.get("delta") else {
            continue;
        };
        if delta
            .get("content")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|content| !content.is_empty())
        {
            probe.content_delta_frames += 1;
        }
        if delta
            .get("tool_calls")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|calls| !calls.is_empty())
        {
            probe.tool_call_delta_frames += 1;
        }
    }
}

fn print_stream_probe(scenario: &str, probe: &StreamProbe) {
    let finish_reasons = if probe.finish_reasons.is_empty() {
        "<missing>".to_owned()
    } else {
        probe
            .finish_reasons
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join(",")
    };
    println!(
        "AI_STREAM_PROBE scenario={scenario} network_chunks={} data_frames={} choice_frames={} content_deltas={} tool_call_deltas={} usage_frames={} error_frames={} parse_errors={} done_seen={} finish_reasons={finish_reasons}",
        probe.network_chunks,
        probe.data_frames,
        probe.choice_frames,
        probe.content_delta_frames,
        probe.tool_call_delta_frames,
        probe.usage_frames,
        probe.error_frames,
        probe.parse_errors,
        probe.done_seen,
    );
}

fn live_chat_endpoint(base_url: &str) -> Result<reqwest::Url, Box<dyn std::error::Error>> {
    let mut url = reqwest::Url::parse(base_url)?;
    let configured_path = url.path().trim_end_matches('/');
    let api_root = if configured_path.is_empty() {
        "/v1"
    } else {
        configured_path
    };
    url.set_path(&format!("{api_root}/chat/completions"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn bounded_redacted(value: &str, secret: &str) -> String {
    let redacted = if secret.is_empty() {
        value.to_owned()
    } else {
        value.replace(secret, "[REDACTED]")
    };
    redacted.chars().take(4096).collect()
}

async fn verify_agent_with_config(
    config_path: std::path::PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let config = Arc::new(ConfigService::open(config_path)?);
    let mut settings = config.agent_settings()?;
    settings.permission_mode = AgentPermissionMode::ReadOnly;
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
    let agent = Arc::new(myterm_lib::agent::service::AgentService::new(
        config,
        vault,
        sessions.clone(),
        sftp,
    )?);
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
            "Use all five read-only tools before the final answer: call session_info; call terminal_context; call remote_exec with command `hostname; whoami`; call host_facts; and call list_directory with scope `remote` and path `/root`. After every tool has returned, report only the hostname and current user."
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
        "remote_exec",
        "host_facts",
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
        transport: McpTransportKind::Stdio,
        command: "npx.cmd".to_owned(),
        args: vec![
            "-y".to_owned(),
            "@modelcontextprotocol/server-everything".to_owned(),
        ],
        cwd: None,
        url: None,
        headers: Vec::new(),
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

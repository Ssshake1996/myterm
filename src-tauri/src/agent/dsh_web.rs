use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    extract::{Path as AxumPath, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::{oneshot, watch, Mutex},
    task::JoinHandle,
};

use super::service::{AgentEventSink, AgentService};
use crate::{
    config::ConfigService,
    session::manager::SessionManager,
    types::{AgentEvent, SessionInfo, SessionProfile, SessionState, SessionTarget},
    AppError,
};

const DSH_VERSION: &str = "0.1.5-rc.2";
const AGENT_SESSION_IDLE_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshWorkspaceInfo {
    pub url: String,
    pub harness_version: &'static str,
}

pub struct DshWebService {
    config: Arc<ConfigService>,
    host: Arc<DshHostState>,
    runtime: Mutex<Option<DshRuntime>>,
    bridge: Mutex<Option<BridgeRuntime>>,
}

struct DshRuntime {
    child: Child,
    url: String,
    stdout_task: JoinHandle<()>,
    stderr_task: JoinHandle<()>,
}

struct BridgeRuntime {
    url: String,
    bearer: String,
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
    cleanup: JoinHandle<()>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BindingDocument {
    #[serde(default = "binding_schema_version")]
    version: u32,
    #[serde(default)]
    sessions: BTreeMap<String, ConversationBinding>,
}

fn binding_schema_version() -> u32 {
    1
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationBinding {
    #[serde(default)]
    profile_ids: Vec<String>,
    #[serde(default)]
    primary_profile_id: Option<String>,
}

impl ConversationBinding {
    fn normalize(&mut self) {
        self.profile_ids.retain(|value| !value.trim().is_empty());
        self.profile_ids.sort();
        self.profile_ids.dedup();
        if self
            .primary_profile_id
            .as_ref()
            .is_some_and(|primary| !self.profile_ids.contains(primary))
        {
            self.primary_profile_id = self.profile_ids.first().cloned();
        }
        if self.primary_profile_id.is_none() {
            self.primary_profile_id = self.profile_ids.first().cloned();
        }
    }
}

struct SessionLease {
    session_id: String,
    owned_by_agent: bool,
    active_calls: usize,
    last_used: Instant,
}

struct ActiveCall {
    dsh_session_id: String,
    profile_id: String,
    cancel: watch::Sender<bool>,
}

struct DshHostState {
    config: Arc<ConfigService>,
    sessions: Arc<SessionManager>,
    agent: Arc<AgentService>,
    binding_path: PathBuf,
    bindings: Mutex<BindingDocument>,
    leases: Mutex<HashMap<String, SessionLease>>,
    calls: Mutex<HashMap<String, ActiveCall>>,
    connect_lock: Mutex<()>,
    bearer: Mutex<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolRequest {
    session_id: String,
    #[serde(default)]
    arguments: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BindingRequest {
    session_id: String,
    action: String,
    profile_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BindingSnapshot {
    environments: Vec<EnvironmentView>,
    bindings: Vec<String>,
    primary_profile_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentView {
    profile_id: String,
    name: String,
    group: String,
    environment: String,
    host: String,
    port: u16,
    username: String,
    bound: bool,
    state: SessionState,
    session_id: Option<String>,
    error: Option<String>,
}

struct NoopAgentSink;

impl AgentEventSink for NoopAgentSink {
    fn send(&self, _event: AgentEvent) -> Result<(), AppError> {
        Ok(())
    }
}

impl DshWebService {
    pub fn new(
        config: Arc<ConfigService>,
        sessions: Arc<SessionManager>,
        agent: Arc<AgentService>,
    ) -> Result<Self, AppError> {
        let binding_path = config
            .path()
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("deepseek-harness-web")
            .join("bindings.json");
        let bindings = read_bindings(&binding_path)?;
        Ok(Self {
            config: config.clone(),
            host: Arc::new(DshHostState {
                config,
                sessions,
                agent,
                binding_path,
                bindings: Mutex::new(bindings),
                leases: Mutex::new(HashMap::new()),
                calls: Mutex::new(HashMap::new()),
                connect_lock: Mutex::new(()),
                bearer: Mutex::new(String::new()),
            }),
            runtime: Mutex::new(None),
            bridge: Mutex::new(None),
        })
    }

    pub async fn start(&self) -> Result<DshWorkspaceInfo, AppError> {
        let mut runtime = self.runtime.lock().await;
        if let Some(existing) = runtime.as_mut() {
            if existing.child.try_wait()?.is_none() {
                return Ok(DshWorkspaceInfo {
                    url: existing.url.clone(),
                    harness_version: DSH_VERSION,
                });
            }
            existing.stdout_task.abort();
            existing.stderr_task.abort();
            *runtime = None;
        }

        let (bridge_url, bridge_bearer) = self.ensure_bridge().await?;
        let runtime_root = resolve_runtime_root()?;
        let node = resolve_node_binary(&runtime_root);
        let launcher = runtime_root.join("launcher").join("start.mjs");
        let patch = runtime_root.join("bridge").join("cordis.patch.yml");
        if !launcher.is_file() || !patch.is_file() {
            return Err(AppError::Agent(format!(
                "DSH_RUNTIME_INCOMPLETE: missing '{}' or '{}'",
                launcher.display(),
                patch.display()
            )));
        }
        let dsh_home = self
            .config
            .path()
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("deepseek-harness-web")
            .join("runtime-0.1.5-rc.2-myterm1");
        std::fs::create_dir_all(&dsh_home)?;
        install_bridge_package(&runtime_root, &dsh_home)?;

        let mut command = Command::new(node);
        command
            .arg(launcher)
            .args(["--host", "127.0.0.1", "--port", "0", "--no-open"])
            .env("DSH_HOME", &dsh_home)
            .env("DSH_TELEMETRY_DISABLED", "1")
            .env("MYTERM_DSH_BRIDGE_URL", bridge_url)
            .env("MYTERM_DSH_BRIDGE_BEARER", bridge_bearer)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command.current_dir(&dsh_home);
        let mut child = command.spawn().map_err(|error| {
            AppError::Agent(format!(
                "DSH_WEB_START_FAILED: unable to spawn DSH: {error}"
            ))
        })?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Agent("DSH_WEB_START_FAILED: stdout is unavailable".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Agent("DSH_WEB_START_FAILED: stderr is unavailable".into()))?;
        let (ready_tx, ready_rx) = oneshot::channel();
        let stdout_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            let mut ready_tx = Some(ready_tx);
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(index) = line.find("dsh web: http://") {
                    if let Some(sender) = ready_tx.take() {
                        let _ = sender.send(line[index + "dsh web: ".len()..].trim().to_owned());
                    }
                }
                tracing::debug!(event = "dsh_web_stdout", message = %redact_dsh_url(&line));
            }
        });
        let stderr_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::warn!(event = "dsh_web_stderr", message = %line);
            }
        });
        let url = match tokio::time::timeout(Duration::from_secs(30), ready_rx).await {
            Ok(Ok(url)) => url,
            Ok(Err(_)) => {
                let _ = child.kill().await;
                return Err(AppError::Agent(
                    "DSH_WEB_START_FAILED: DSH exited before publishing its Web URL".into(),
                ));
            }
            Err(_) => {
                let _ = child.kill().await;
                return Err(AppError::Agent(
                    "DSH_WEB_START_TIMEOUT: DSH did not become ready within 30 seconds".into(),
                ));
            }
        };
        tracing::info!(
            event = "dsh_web_started",
            version = DSH_VERSION,
            origin = %url.split('?').next().unwrap_or(&url),
            "Official DeepSeek Harness Web workspace started"
        );
        *runtime = Some(DshRuntime {
            child,
            url: url.clone(),
            stdout_task,
            stderr_task,
        });
        Ok(DshWorkspaceInfo {
            url,
            harness_version: DSH_VERSION,
        })
    }

    async fn ensure_bridge(&self) -> Result<(String, String), AppError> {
        let mut bridge = self.bridge.lock().await;
        if let Some(existing) = bridge.as_ref() {
            return Ok((existing.url.clone(), existing.bearer.clone()));
        }
        let bearer = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
        *self.host.bearer.lock().await = bearer.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let router = Router::new()
            .route(
                "/v1/sessions/{session_id}/environments",
                get(environment_handler),
            )
            .route("/v1/bindings", post(binding_handler))
            .route("/v1/tools/{name}", post(tool_handler))
            .with_state(self.host.clone());
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await
            {
                tracing::error!(event = "dsh_host_bridge_failed", error = %error);
            }
        });
        let cleanup_host = self.host.clone();
        let cleanup = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                cleanup_host.cleanup_idle_sessions().await;
            }
        });
        let url = format!("http://{address}");
        tracing::info!(event = "dsh_host_bridge_started", address = %address);
        *bridge = Some(BridgeRuntime {
            url: url.clone(),
            bearer: bearer.clone(),
            shutdown: Some(shutdown_tx),
            task,
            cleanup,
        });
        Ok((url, bearer))
    }

    pub async fn shutdown(&self) {
        if let Some(mut runtime) = self.runtime.lock().await.take() {
            if let Err(error) = runtime.child.kill().await {
                tracing::debug!(event = "dsh_web_stop_failed", error = %error);
            }
            runtime.stdout_task.abort();
            runtime.stderr_task.abort();
        }
        self.host.disconnect_owned_sessions().await;
        if let Some(mut bridge) = self.bridge.lock().await.take() {
            if let Some(shutdown) = bridge.shutdown.take() {
                let _ = shutdown.send(());
            }
            bridge.cleanup.abort();
            let _ = bridge.task.await;
        }
    }
}

impl DshHostState {
    async fn snapshot(&self, dsh_session_id: &str) -> Result<BindingSnapshot, AppError> {
        let profiles = ssh_profiles(self.config.profile_list()?);
        let live = self.sessions.list()?;
        let binding = self
            .bindings
            .lock()
            .await
            .sessions
            .get(dsh_session_id)
            .cloned()
            .unwrap_or_default();
        let environments = profiles
            .into_iter()
            .map(|profile| environment_view(profile, &binding, &live))
            .collect();
        Ok(BindingSnapshot {
            environments,
            bindings: binding.profile_ids,
            primary_profile_id: binding.primary_profile_id,
        })
    }

    async fn mutate_binding(&self, request: &BindingRequest) -> Result<BindingSnapshot, AppError> {
        if request.session_id.trim().is_empty() || request.profile_id.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "DSH session_id and profile_id are required".into(),
            ));
        }
        let is_ssh = ssh_profiles(self.config.profile_list()?)
            .iter()
            .any(|profile| profile.id == request.profile_id);
        if !is_ssh {
            return Err(AppError::NotFound(format!(
                "SSH profile '{}'",
                request.profile_id
            )));
        }
        {
            let mut document = self.bindings.lock().await;
            let binding = document
                .sessions
                .entry(request.session_id.clone())
                .or_default();
            match request.action.as_str() {
                "bind" => {
                    binding.profile_ids.push(request.profile_id.clone());
                }
                "primary" => {
                    if !binding.profile_ids.contains(&request.profile_id) {
                        return Err(AppError::InvalidInput(
                            "primary environment must already be bound".into(),
                        ));
                    }
                    binding.primary_profile_id = Some(request.profile_id.clone());
                }
                "unbind" => {
                    binding.profile_ids.retain(|id| id != &request.profile_id);
                    if binding.primary_profile_id.as_deref() == Some(&request.profile_id) {
                        binding.primary_profile_id = None;
                    }
                }
                action => {
                    return Err(AppError::InvalidInput(format!(
                        "unsupported binding action '{action}'"
                    )));
                }
            }
            binding.normalize();
            write_bindings(&self.binding_path, &document)?;
        }
        if request.action == "unbind" {
            self.cancel_calls(&request.session_id, &request.profile_id)
                .await;
        }
        self.snapshot(&request.session_id).await
    }

    async fn cancel_calls(&self, dsh_session_id: &str, profile_id: &str) {
        let calls = self.calls.lock().await;
        for call in calls
            .values()
            .filter(|call| call.dsh_session_id == dsh_session_id && call.profile_id == profile_id)
        {
            let _ = call.cancel.send(true);
        }
    }

    async fn resolve_bound_profile(
        &self,
        dsh_session_id: &str,
        arguments: &Value,
    ) -> Result<SessionProfile, AppError> {
        let binding = self
            .bindings
            .lock()
            .await
            .sessions
            .get(dsh_session_id)
            .cloned()
            .unwrap_or_default();
        if binding.profile_ids.is_empty() {
            return Err(AppError::InvalidInput(
                "DSH_SSH_ENVIRONMENT_NOT_BOUND: bind at least one SSH environment to this conversation"
                    .into(),
            ));
        }
        let profiles = ssh_profiles(self.config.profile_list()?);
        let requested = arguments
            .get("environment")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let profile_id = if let Some(requested) = requested {
            let matches = profiles
                .iter()
                .filter(|profile| {
                    profile.id.eq_ignore_ascii_case(requested)
                        || profile.name.eq_ignore_ascii_case(requested)
                })
                .collect::<Vec<_>>();
            if matches.len() != 1 {
                return Err(AppError::InvalidInput(format!(
                    "DSH_SSH_ENVIRONMENT_AMBIGUOUS: '{requested}' matched {} saved SSH environments",
                    matches.len()
                )));
            }
            matches[0].id.clone()
        } else if let Some(primary) = &binding.primary_profile_id {
            primary.clone()
        } else if binding.profile_ids.len() == 1 {
            binding.profile_ids[0].clone()
        } else {
            return Err(AppError::InvalidInput(
                "DSH_SSH_ENVIRONMENT_REQUIRED: specify environment because multiple environments are bound"
                    .into(),
            ));
        };
        if !binding.profile_ids.contains(&profile_id) {
            return Err(AppError::InvalidInput(format!(
                "DSH_SSH_ENVIRONMENT_NOT_BOUND: profile '{profile_id}' is not bound to this conversation"
            )));
        }
        profiles
            .into_iter()
            .find(|profile| profile.id == profile_id)
            .ok_or_else(|| AppError::NotFound(format!("SSH profile '{profile_id}'")))
    }

    async fn ensure_session(&self, profile: SessionProfile) -> Result<SessionInfo, AppError> {
        let _connect = self.connect_lock.lock().await;
        let existing = self.sessions.list()?.into_iter().find(|session| {
            session.profile_id == profile.id && session.state == SessionState::Connected
        });
        let (session, newly_owned) = match existing {
            Some(session) => (session, false),
            None => (self.sessions.ensure_connected(profile.clone()).await?, true),
        };
        let mut leases = self.leases.lock().await;
        let lease = leases.entry(profile.id).or_insert(SessionLease {
            session_id: session.session_id.clone(),
            owned_by_agent: newly_owned,
            active_calls: 0,
            last_used: Instant::now(),
        });
        if lease.session_id != session.session_id {
            lease.session_id = session.session_id.clone();
            lease.owned_by_agent = newly_owned;
            lease.active_calls = 0;
        }
        lease.last_used = Instant::now();
        Ok(session)
    }

    async fn execute_tool(&self, name: &str, request: ToolRequest) -> Result<Value, AppError> {
        if name == "session_catalog" {
            return Ok(serde_json::to_value(
                self.snapshot(&request.session_id).await?,
            )?);
        }
        let supported = matches!(
            name,
            "session_connect"
                | "session_info"
                | "terminal_context"
                | "cli_execute"
                | "cli_execute_batch"
                | "terminal_send"
                | "terminal_edit"
                | "remote_exec"
                | "session_wait_until"
                | "list_directory"
                | "file_stat"
                | "file_read"
                | "file_search"
                | "file_write"
                | "file_patch"
        );
        if !supported {
            return Err(AppError::InvalidInput(format!(
                "DSH_SSH_TOOL_NOT_ALLOWED: '{name}' is not exposed by the myterm bridge"
            )));
        }
        let profile = self
            .resolve_bound_profile(&request.session_id, &request.arguments)
            .await?;
        let session = self.ensure_session(profile.clone()).await?;
        if name == "session_connect" {
            return Ok(json!({
                "profileId": profile.id,
                "profileName": profile.name,
                "sessionId": session.session_id,
                "state": session.state,
            }));
        }
        let call_id = uuid::Uuid::new_v4().to_string();
        let (cancel_tx, cancel_rx) = watch::channel(false);
        self.calls.lock().await.insert(
            call_id.clone(),
            ActiveCall {
                dsh_session_id: request.session_id.clone(),
                profile_id: profile.id.clone(),
                cancel: cancel_tx,
            },
        );
        if let Some(lease) = self.leases.lock().await.get_mut(&profile.id) {
            lease.active_calls += 1;
            lease.last_used = Instant::now();
        }
        let mut arguments = request.arguments.as_object().cloned().unwrap_or_default();
        for forbidden in [
            "environment",
            "session_id",
            "profile_id",
            "profile_name",
            "use_active_session",
            "background",
        ] {
            arguments.remove(forbidden);
        }
        if name == "list_directory" {
            arguments.insert("scope".into(), Value::String("remote".into()));
        }
        let settings = self.config.agent_settings()?;
        let sink: Arc<dyn AgentEventSink> = Arc::new(NoopAgentSink);
        let result = self
            .agent
            .execute_builtin_tool(
                &format!("dsh:{}", request.session_id),
                &call_id,
                name,
                Value::Object(arguments),
                Some(&session.session_id),
                &settings,
                sink.clone(),
                sink,
                cancel_rx,
            )
            .await;
        self.calls.lock().await.remove(&call_id);
        if let Some(lease) = self.leases.lock().await.get_mut(&profile.id) {
            lease.active_calls = lease.active_calls.saturating_sub(1);
            lease.last_used = Instant::now();
        }
        let text = result?;
        serde_json::from_str(&text).or_else(|_| Ok(Value::String(text)))
    }

    async fn cleanup_idle_sessions(&self) {
        let now = Instant::now();
        let expired = {
            let leases = self.leases.lock().await;
            leases
                .iter()
                .filter(|(_, lease)| {
                    lease.owned_by_agent
                        && lease.active_calls == 0
                        && now.duration_since(lease.last_used) >= AGENT_SESSION_IDLE_TTL
                })
                .map(|(profile_id, lease)| (profile_id.clone(), lease.session_id.clone()))
                .collect::<Vec<_>>()
        };
        for (profile_id, session_id) in expired {
            if let Err(error) = self.sessions.disconnect(&session_id).await {
                tracing::debug!(event = "dsh_owned_session_disconnect_failed", %profile_id, %session_id, error = %error.detail());
            }
            self.leases.lock().await.remove(&profile_id);
        }
    }

    async fn disconnect_owned_sessions(&self) {
        let owned = self
            .leases
            .lock()
            .await
            .values()
            .filter(|lease| lease.owned_by_agent)
            .map(|lease| lease.session_id.clone())
            .collect::<Vec<_>>();
        for session_id in owned {
            let _ = self.sessions.disconnect(&session_id).await;
        }
        self.leases.lock().await.clear();
    }
}

async fn environment_handler(
    State(state): State<Arc<DshHostState>>,
    AxumPath(session_id): AxumPath<String>,
    headers: HeaderMap,
) -> (StatusCode, Json<Value>) {
    if let Err(error) = authorize(&state, &headers).await {
        return bridge_error(error);
    }
    match state.snapshot(&session_id).await {
        Ok(value) => bridge_ok(value),
        Err(error) => bridge_error(error),
    }
}

async fn binding_handler(
    State(state): State<Arc<DshHostState>>,
    headers: HeaderMap,
    Json(request): Json<BindingRequest>,
) -> (StatusCode, Json<Value>) {
    if let Err(error) = authorize(&state, &headers).await {
        return bridge_error(error);
    }
    match state.mutate_binding(&request).await {
        Ok(value) => bridge_ok(value),
        Err(error) => bridge_error(error),
    }
}

async fn tool_handler(
    State(state): State<Arc<DshHostState>>,
    AxumPath(name): AxumPath<String>,
    headers: HeaderMap,
    Json(request): Json<ToolRequest>,
) -> (StatusCode, Json<Value>) {
    if let Err(error) = authorize(&state, &headers).await {
        return bridge_error(error);
    }
    match state.execute_tool(&name, request).await {
        Ok(value) => bridge_ok(value),
        Err(error) => bridge_error(error),
    }
}

async fn authorize(state: &DshHostState, headers: &HeaderMap) -> Result<(), AppError> {
    let expected = format!("Bearer {}", state.bearer.lock().await);
    if headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        != Some(expected.as_str())
    {
        return Err(AppError::InvalidInput(
            "DSH_BRIDGE_UNAUTHORIZED: invalid bridge bearer token".into(),
        ));
    }
    Ok(())
}

fn bridge_ok<T: Serialize>(value: T) -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(json!({ "ok": true, "value": value })))
}

fn bridge_error(error: AppError) -> (StatusCode, Json<Value>) {
    let status = match error {
        AppError::NotFound(_) => StatusCode::NOT_FOUND,
        AppError::InvalidInput(_) => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (
        status,
        Json(json!({
            "ok": false,
            "error": { "code": error.code(), "message": error.detail() }
        })),
    )
}

fn ssh_profiles(profiles: Vec<SessionProfile>) -> Vec<SessionProfile> {
    profiles
        .into_iter()
        .filter(|profile| matches!(profile.target, SessionTarget::Ssh { .. }))
        .collect()
}

fn environment_view(
    profile: SessionProfile,
    binding: &ConversationBinding,
    live: &[SessionInfo],
) -> EnvironmentView {
    let session = live.iter().find(|session| {
        session.profile_id == profile.id && session.state == SessionState::Connected
    });
    let (host, port, username) = match &profile.target {
        SessionTarget::Ssh {
            host,
            port,
            username,
            ..
        } => (host.clone(), *port, username.clone()),
        SessionTarget::Local { .. } => unreachable!(),
    };
    EnvironmentView {
        profile_id: profile.id.clone(),
        name: profile.name,
        group: profile.group,
        environment: format!("{:?}", profile.environment).to_ascii_lowercase(),
        host,
        port,
        username,
        bound: binding.profile_ids.contains(&profile.id),
        state: session
            .map(|session| session.state)
            .unwrap_or(SessionState::Disconnected),
        session_id: session.map(|session| session.session_id.clone()),
        error: session.and_then(|session| session.error.clone()),
    }
}

fn read_bindings(path: &Path) -> Result<BindingDocument, AppError> {
    if !path.is_file() {
        return Ok(BindingDocument {
            version: binding_schema_version(),
            sessions: BTreeMap::new(),
        });
    }
    let mut document: BindingDocument = serde_json::from_slice(&std::fs::read(path)?)?;
    for binding in document.sessions.values_mut() {
        binding.normalize();
    }
    Ok(document)
}

fn write_bindings(path: &Path, document: &BindingDocument) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_vec_pretty(document)?)?;
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    std::fs::rename(temporary, path)?;
    Ok(())
}

fn resolve_runtime_root() -> Result<PathBuf, AppError> {
    if let Some(path) = std::env::var_os("MYTERM_DEEPSEEK_HARNESS_ROOT") {
        let path = PathBuf::from(path);
        if path.join("launcher").join("start.mjs").is_file() {
            return Ok(path);
        }
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("integrations")
        .join("deepseek-harness-runtime");
    if development.join("launcher").join("start.mjs").is_file() {
        return Ok(development);
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            for candidate in [
                directory.join("resources").join("deepseek-harness-runtime"),
                directory.join("deepseek-harness-runtime"),
            ] {
                if candidate.join("launcher").join("start.mjs").is_file() {
                    return Ok(candidate);
                }
            }
        }
    }
    Err(AppError::Agent(
        "DSH_RUNTIME_NOT_FOUND: deepseek-harness-runtime is missing".into(),
    ))
}

fn resolve_node_binary(runtime_root: &Path) -> PathBuf {
    if let Some(path) = std::env::var_os("MYTERM_HARNESS_NODE") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return path;
        }
    }
    for candidate in [
        runtime_root.join("runtime").join("node.exe"),
        runtime_root.join("node.exe"),
    ] {
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from("node")
}

fn install_bridge_package(runtime_root: &Path, dsh_home: &Path) -> Result<(), AppError> {
    let source = runtime_root.join("bridge");
    let destination = dsh_home
        .join("node_modules")
        .join("@myterm")
        .join("dsh-bridge");
    if destination.is_dir() {
        std::fs::remove_dir_all(&destination)?;
    }
    copy_directory(&source, &destination)
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn redact_dsh_url(line: &str) -> String {
    line.split_once("?token=")
        .map(|(prefix, _)| format!("{prefix}?token=[redacted]"))
        .unwrap_or_else(|| line.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binding_normalization_keeps_primary_inside_bound_set() {
        let mut binding = ConversationBinding {
            profile_ids: vec!["b".into(), "a".into(), "a".into()],
            primary_profile_id: Some("missing".into()),
        };
        binding.normalize();
        assert_eq!(binding.profile_ids, vec!["a", "b"]);
        assert_eq!(binding.primary_profile_id.as_deref(), Some("a"));
    }

    #[test]
    fn dsh_tokens_are_redacted_from_logs() {
        assert_eq!(
            redact_dsh_url("dsh web: http://127.0.0.1:1/?token=secret"),
            "dsh web: http://127.0.0.1:1/?token=[redacted]"
        );
    }
}

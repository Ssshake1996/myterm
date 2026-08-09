use std::{
    collections::VecDeque,
    convert::Infallible,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{Path, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    response::{sse::Event, IntoResponse, Response, Sse},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio_stream::wrappers::UnboundedReceiverStream;

use crate::{
    agent::{service::AgentEventSink, store::AgentStore},
    config::{default_config_path, ConfigService, CredentialVault, KeyringVault},
    session::manager::{NullEventSink, OutputSink, SessionManager},
    sftp::service::{NullTransferSink, SftpService},
    types::{AgentEvent, AgentPermissionMode, SessionProfile},
    AppError, SecretResolver,
};

const TOKEN_HASH_KEY: &str = "rest_token_hash";
const IDEMPOTENCY_HEADER: &str = "idempotency-key";

#[derive(Clone)]
struct RestState {
    config: Arc<ConfigService>,
    sessions: Arc<SessionManager>,
    agent: Arc<crate::agent::service::AgentService>,
    store: Arc<AgentStore>,
    token_hash: String,
    rate: Arc<Mutex<VecDeque<Instant>>>,
}

struct DiscardOutput;

impl OutputSink for DiscardOutput {
    fn send(&self, _data: &[u8]) -> Result<(), AppError> {
        Ok(())
    }
}

struct NoopAgentEvents;

impl AgentEventSink for NoopAgentEvents {
    fn send(&self, _event: AgentEvent) -> Result<(), AppError> {
        Ok(())
    }
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({
                "error": { "code": self.code, "message": self.message }
            })),
        )
            .into_response()
    }
}

impl From<AppError> for ApiError {
    fn from(error: AppError) -> Self {
        let (status, code) = match error {
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            AppError::InvalidInput(_) => (StatusCode::BAD_REQUEST, "invalid_input"),
            AppError::Ai(_) => (StatusCode::CONFLICT, "agent_busy"),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
        };
        Self {
            status,
            code,
            message: error.to_string(),
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskRequest {
    server: String,
    task: String,
    ai_profile: Option<String>,
    permission: Option<AgentPermissionMode>,
}

#[derive(Deserialize)]
struct ApprovalBody {
    decision: String,
}

pub fn create_token() -> Result<String, AppError> {
    let token = format!(
        "mt_{}{}{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let config = ConfigService::open(default_config_path(false)?)?;
    config.setting_set(TOKEN_HASH_KEY.to_owned(), json!(hash(&token)))?;
    Ok(token)
}

pub fn revoke_token() -> Result<(), AppError> {
    let config = ConfigService::open(default_config_path(false)?)?;
    config.setting_set(TOKEN_HASH_KEY.to_owned(), Value::Null)
}

pub async fn serve(bind: SocketAddr) -> Result<(), AppError> {
    if !bind.ip().is_loopback() {
        return Err(AppError::InvalidInput(
            "non-loopback REST binding requires TLS and is disabled in this build".to_owned(),
        ));
    }
    let config_path = default_config_path(false)?;
    let config = Arc::new(ConfigService::open(config_path.clone())?);
    let token_hash = config
        .setting_get(TOKEN_HASH_KEY)?
        .and_then(|value| value.as_str().map(str::to_owned))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::Config(
                "REST token is not configured; run `myterm api token create`".to_owned(),
            )
        })?;
    let vault_impl = Arc::new(KeyringVault::new());
    let vault: Arc<dyn CredentialVault> = vault_impl.clone();
    let resolver: Arc<dyn SecretResolver> = vault_impl;
    let sessions = Arc::new(SessionManager::new(resolver, Arc::new(NullEventSink)));
    let sftp = Arc::new(SftpService::new(
        sessions.clone(),
        Arc::new(NullTransferSink),
    ));
    let agent = Arc::new(crate::agent::service::AgentService::new(
        config.clone(),
        vault,
        sessions.clone(),
        sftp,
    )?);
    let store_path = config_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("agent.db");
    let state = RestState {
        config,
        sessions,
        agent,
        store: Arc::new(AgentStore::new(store_path)),
        token_hash,
        rate: Arc::new(Mutex::new(VecDeque::new())),
    };
    let router = Router::new()
        .route("/health", get(health))
        .route("/v1/tasks", post(create_task))
        .route("/v1/tasks/{task_id}", get(get_task))
        .route("/v1/tasks/{task_id}/events", get(task_events))
        .route(
            "/v1/tasks/{task_id}/approvals/{approval_id}",
            post(decide_approval),
        )
        .route("/v1/tasks/{task_id}/cancel", post(cancel_task))
        .route("/v1/openapi.json", get(openapi))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .map_err(|error| AppError::Io(std::io::Error::other(error)))
}

async fn create_task(
    State(state): State<RestState>,
    headers: HeaderMap,
    Json(request): Json<CreateTaskRequest>,
) -> Result<impl IntoResponse, ApiError> {
    authorize(&state, &headers)?;
    rate_limit(&state)?;
    if request.task.trim().is_empty() {
        return Err(ApiError::from(AppError::InvalidInput(
            "task is required".to_owned(),
        )));
    }
    let idempotency_key = headers
        .get(IDEMPOTENCY_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            code: "idempotency_required",
            message: "Idempotency-Key header is required".to_owned(),
        })?;
    let proposed = uuid::Uuid::new_v4().to_string();
    let request_hash = hash(&serde_json::to_string(&request).map_err(AppError::from)?);
    if let Some(task_id) = state
        .store
        .idempotency_task(idempotency_key, &request_hash)?
    {
        return Ok((
            StatusCode::OK,
            Json(json!({ "taskId": task_id, "replayed": true })),
        ));
    }
    if state.agent.is_busy().await {
        return Err(ApiError {
            status: StatusCode::CONFLICT,
            code: "agent_busy",
            message: "another agent run is already active".to_owned(),
        });
    }
    let server = find_server(&state.config, &request.server)?;
    let ai_profile = match request.ai_profile.as_deref() {
        Some(reference) => state
            .config
            .ai_profile_list()?
            .into_iter()
            .find(|profile| profile.id == reference || profile.name == reference)
            .ok_or_else(|| AppError::NotFound(format!("AI profile '{reference}'")))?,
        None => state
            .config
            .ai_profile_list()?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::NotFound("AI profile".to_owned()))?,
    };
    let session = state
        .sessions
        .connect(server, 120, 36, Arc::new(DiscardOutput))
        .await?;
    let session_id = session.session_id;
    let (task_id, created) =
        state
            .store
            .reserve_idempotency(idempotency_key, &request_hash, &proposed)?;
    if !created {
        state.sessions.disconnect(&session_id).await?;
        return Ok((
            StatusCode::OK,
            Json(json!({ "taskId": task_id, "replayed": true })),
        ));
    }
    let agent = state.agent.clone();
    let sessions = state.sessions.clone();
    let spawned_task_id = task_id.clone();
    tokio::spawn(async move {
        let _ = agent
            .run_with_task_id(
                spawned_task_id,
                &ai_profile.id,
                request.task,
                Some(session_id.clone()),
                Arc::new(NoopAgentEvents),
                request.permission,
            )
            .await;
        let _ = sessions.disconnect(&session_id).await;
    });
    tokio::task::yield_now().await;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "taskId": task_id, "replayed": false })),
    ))
}

async fn health() -> impl IntoResponse {
    Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

async fn get_task(
    State(state): State<RestState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    authorize(&state, &headers)?;
    let task = state
        .store
        .task(&task_id)?
        .ok_or_else(|| AppError::NotFound(format!("agent task '{task_id}'")))?;
    Ok(Json(task))
}

async fn task_events(
    State(state): State<RestState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    authorize(&state, &headers)?;
    let mut after = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    if state.store.task(&task_id)?.is_none() {
        return Err(AppError::NotFound(format!("agent task '{task_id}'")).into());
    }
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    let store = state.store.clone();
    tokio::spawn(async move {
        loop {
            let events = match store.events_after(&task_id, after, 500) {
                Ok(events) => events,
                Err(_) => break,
            };
            for event in events {
                after = event.sequence;
                let payload = match serde_json::to_string(&event) {
                    Ok(payload) => payload,
                    Err(_) => return,
                };
                if sender
                    .send(Ok::<_, Infallible>(
                        Event::default()
                            .id(after.to_string())
                            .event(&event.event_type)
                            .data(payload),
                    ))
                    .is_err()
                {
                    return;
                }
            }
            let terminal = store
                .task(&task_id)
                .ok()
                .flatten()
                .is_some_and(|task| task.state.is_terminal());
            if terminal {
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    });
    Ok(Sse::new(UnboundedReceiverStream::new(receiver))
        .keep_alive(axum::response::sse::KeepAlive::new().interval(Duration::from_secs(15))))
}

async fn decide_approval(
    State(state): State<RestState>,
    headers: HeaderMap,
    Path((task_id, approval_id)): Path<(String, String)>,
    Json(body): Json<ApprovalBody>,
) -> Result<impl IntoResponse, ApiError> {
    authorize(&state, &headers)?;
    let task = state
        .store
        .task(&task_id)?
        .ok_or_else(|| AppError::NotFound(format!("agent task '{task_id}'")))?;
    if task.state.is_terminal() {
        return Err(ApiError {
            status: StatusCode::CONFLICT,
            code: "task_terminal",
            message: "task is already terminal".to_owned(),
        });
    }
    let approved = match body.decision.as_str() {
        "approve_once" => true,
        "deny" => false,
        _ => {
            return Err(ApiError {
                status: StatusCode::BAD_REQUEST,
                code: "invalid_decision",
                message: "decision must be approve_once or deny".to_owned(),
            })
        }
    };
    state.store.approval_decided(&approval_id, approved)?;
    Ok(Json(json!({ "accepted": true })))
}

async fn cancel_task(
    State(state): State<RestState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    authorize(&state, &headers)?;
    let requested = state.store.request_cancel(&task_id)?;
    if !requested && state.store.task(&task_id)?.is_none() {
        return Err(AppError::NotFound(format!("agent task '{task_id}'")).into());
    }
    Ok(Json(json!({ "cancelRequested": requested })))
}

async fn openapi(
    State(state): State<RestState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    authorize(&state, &headers)?;
    Ok(Json(openapi_document()))
}

fn authorize(state: &RestState, headers: &HeaderMap) -> Result<(), ApiError> {
    let token = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if !constant_time_eq(hash(token).as_bytes(), state.token_hash.as_bytes()) {
        return Err(ApiError {
            status: StatusCode::UNAUTHORIZED,
            code: "unauthorized",
            message: "valid bearer token required".to_owned(),
        });
    }
    Ok(())
}

fn rate_limit(state: &RestState) -> Result<(), ApiError> {
    let mut requests = state.rate.lock().map_err(|_| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        code: "internal_error",
        message: "rate limiter lock is poisoned".to_owned(),
    })?;
    let cutoff = Instant::now() - Duration::from_secs(60);
    while requests.front().is_some_and(|request| *request < cutoff) {
        requests.pop_front();
    }
    if requests.len() >= 60 {
        return Err(ApiError {
            status: StatusCode::TOO_MANY_REQUESTS,
            code: "rate_limited",
            message: "request rate limit exceeded".to_owned(),
        });
    }
    requests.push_back(Instant::now());
    Ok(())
}

fn find_server(config: &ConfigService, reference: &str) -> Result<SessionProfile, AppError> {
    let profiles = config.profile_list()?;
    if let Some(profile) = profiles.iter().find(|profile| profile.id == reference) {
        return Ok(profile.clone());
    }
    let matches = profiles
        .into_iter()
        .filter(|profile| profile.name == reference)
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [profile] => Ok(profile.clone()),
        [] => Err(AppError::NotFound(format!("server profile '{reference}'"))),
        _ => Err(AppError::InvalidInput(format!(
            "server name '{reference}' is ambiguous; use its profile ID"
        ))),
    }
}

fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn openapi_document() -> Value {
    json!({
        "openapi": "3.0.3",
        "info": { "title": "myterm Agent API", "version": "0.6.2" },
        "servers": [{ "url": "http://127.0.0.1:9867" }],
        "security": [{ "bearerAuth": [] }],
        "paths": {
            "/health": { "get": { "summary": "Process health", "security": [], "responses": { "200": { "description": "Healthy" } } } },
            "/v1/tasks": { "post": { "summary": "Create an Agent task", "parameters": [{ "in": "header", "name": "Idempotency-Key", "required": true, "schema": { "type": "string" } }], "responses": { "202": { "description": "Accepted" } } } },
            "/v1/tasks/{taskId}": { "get": { "summary": "Get a task", "responses": { "200": { "description": "Task" } } } },
            "/v1/tasks/{taskId}/events": { "get": { "summary": "Resume task events with Last-Event-ID", "responses": { "200": { "description": "text/event-stream" } } } },
            "/v1/tasks/{taskId}/approvals/{approvalId}": { "post": { "summary": "Decide an approval", "responses": { "200": { "description": "Accepted" } } } },
            "/v1/tasks/{taskId}/cancel": { "post": { "summary": "Request idempotent cancellation", "responses": { "200": { "description": "Accepted" } } } }
        },
        "components": { "securitySchemes": { "bearerAuth": { "type": "http", "scheme": "bearer" } } }
    })
}

#[cfg(test)]
mod tests {
    use super::{constant_time_eq, hash, openapi_document};

    #[test]
    fn token_hash_comparison_and_openapi_contract_are_stable() {
        let digest = hash("secret");
        assert!(constant_time_eq(
            digest.as_bytes(),
            hash("secret").as_bytes()
        ));
        assert!(!constant_time_eq(
            digest.as_bytes(),
            hash("other").as_bytes()
        ));
        let document = openapi_document();
        assert_eq!(document["openapi"], "3.0.3");
        assert!(document["paths"]["/v1/tasks"].is_object());
    }
}

use std::{
    collections::BTreeSet,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use async_trait::async_trait;
use dsh_codex_core::{
    ChatCompletionsTransport, CoreConfig, CoreError, HostBridge, ModelRequest, ModelTransport,
    ProviderContextMode, ProviderContextUpdate, ResponsesTransport, RuntimeEvent, ToolDefinition,
    ToolExecutionResult, ToolInvocation,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::{mpsc, watch, Mutex};
use tokio_util::sync::CancellationToken;

use super::{
    builtin,
    capability::{
        CapabilityDescriptor, CapabilityProvider, CapabilityRegistry, EvidenceLedger,
        EvidenceRecord, McpServerDiagnostic,
    },
    hooks::{self, HookAction},
    policy::{self, PolicyAction},
    service::{self, AgentEventSink, AgentService},
};
use crate::{
    ai::{routing::ResolvedAiModelRoute, service::redact_and_bound},
    config::DEFAULT_AGENT_SYSTEM_PROMPT,
    types::{
        AgentEvent, AgentPermissionMode, AgentRunResult, AgentSettings, AiAuthMode, AiModelConfig,
        AiProfile,
    },
    AppError,
};

const CORE_CONTEXT_WINDOW_TOKENS: usize = 128_000;
const CORE_TURN_STEP_BUDGET: usize = 64;

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run(
    service: Arc<AgentService>,
    profile: AiProfile,
    settings: AgentSettings,
    prompt: String,
    active_session_id: Option<String>,
    sink: Arc<dyn AgentEventSink>,
    continuation_sink: Arc<dyn AgentEventSink>,
    abort: watch::Receiver<bool>,
    mut model_routes: Vec<ResolvedAiModelRoute>,
    run_id: String,
    conversation_id: String,
    mut steering: mpsc::Receiver<String>,
) -> Result<AgentRunResult, AppError> {
    sink.send(service::event(
        &run_id,
        "status",
        Some("dsh-codex-agent 正在初始化 Codex Core".to_owned()),
    ))?;

    let goal_id = service
        .task(&run_id)?
        .goal_id
        .ok_or_else(|| AppError::Agent("agent turn is missing its Goal id".to_owned()))?;

    let session_hooks = hooks::run(
        &settings.hooks,
        "SessionStart",
        &json!({ "runId": run_id, "activeSessionCandidateId": active_session_id }),
    )
    .await;
    if !session_hooks.is_empty() {
        let mut hook_event = service::event(&run_id, "hook", Some("SessionStart".to_owned()));
        hook_event.arguments = Some(hooks::event_payload(&session_hooks));
        sink.send(hook_event)?;
    }

    let mut skill_context =
        super::skills::load_enabled(&settings.skill_directories, &settings.enabled_skills)?;
    let restored = super::skills::restore_for_model(
        &settings.skill_directories,
        &settings.enabled_skills,
        &service.store().goal_skill_ids(&goal_id)?,
    );
    for warning in &restored.warnings {
        let mut event = service::event(
            &run_id,
            "skill_restore_warning",
            Some("Skill 恢复".to_owned()),
        );
        event.content = Some(warning.clone());
        event.is_error = Some(true);
        event.error_code = Some("SKILL_RESTORE_FAILED".to_owned());
        sink.send(event)?;
    }
    let active_skill_context = super::skills::active_context(&restored.loaded);
    if !active_skill_context.is_empty() {
        if !skill_context.is_empty() {
            skill_context.push_str("\n\n");
        }
        skill_context.push_str(&active_skill_context);
    }
    let restored_skill_infos = restored
        .loaded
        .iter()
        .map(|skill| skill.info.clone())
        .collect::<Vec<_>>();
    let prepared_mcp = service.mcp().prepare(&settings.mcp_servers).await;
    for diagnostic in prepared_mcp
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.error_detail.is_some())
    {
        let mut failure = service::event(
            &run_id,
            "mcp_error",
            Some(format!("MCP · {}", diagnostic.server_name)),
        );
        failure.content = diagnostic.error_detail.clone();
        failure.is_error = Some(true);
        failure.error_code = diagnostic.error_code.clone();
        sink.send(failure)?;
    }
    let capabilities = prepared_mcp.capabilities;
    let mcp_providers = prepared_mcp.providers;
    let mcp_diagnostics = prepared_mcp.diagnostics;

    if !profile.routing.fallback_on_error {
        model_routes.truncate(1);
    }
    if model_routes.is_empty() {
        return Err(AppError::Ai(
            "没有启用任何 AI 模型，请在 AI 服务设置中添加主模型".to_owned(),
        ));
    }
    let registry = Arc::new(CapabilityRegistry::new(capabilities));
    let system_prompt = build_system_prompt(
        &profile,
        &skill_context,
        registry.entries(),
        &mcp_diagnostics,
        active_session_id.is_some(),
    );
    let state_dir = service
        .config_path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("dsh-codex-agent");
    std::fs::create_dir_all(&state_dir)?;
    // A Thread may fail over to any route. Use the smallest declared window
    // and threshold so a fallback Provider never receives an oversized local
    // rollout produced for a larger primary model.
    let context_window_tokens = model_routes
        .iter()
        .map(|route| {
            route
                .model
                .context_window_tokens
                .map_or(CORE_CONTEXT_WINDOW_TOKENS, |value| value as usize)
        })
        .min()
        .unwrap_or(CORE_CONTEXT_WINDOW_TOKENS);
    let compact_threshold_tokens = model_routes
        .iter()
        .map(|route| {
            let window = route
                .model
                .context_window_tokens
                .map_or(CORE_CONTEXT_WINDOW_TOKENS, |value| value as usize);
            route
                .model
                .compact_threshold_tokens
                .map_or_else(|| window.saturating_mul(3) / 4, |value| value as usize)
        })
        .min()
        .unwrap_or_else(|| context_window_tokens.saturating_mul(3) / 4)
        .min(context_window_tokens.saturating_mul(3) / 4);
    if compact_threshold_tokens == 0 || compact_threshold_tokens >= context_window_tokens {
        return Err(AppError::InvalidInput(format!(
            "AI 模型 '{}' 的压缩阈值 {} 必须小于上下文窗口 {}",
            model_routes[0].model.model, compact_threshold_tokens, context_window_tokens
        )));
    }
    let core_config = CoreConfig {
        base_url: model_routes[0].provider.base_url.clone(),
        model: model_routes[0].model.model.clone(),
        state_dir: state_dir.to_string_lossy().into_owned(),
        request_timeout_ms: 120_000,
        context_window_tokens,
        compact_threshold_tokens,
        turn_step_budget: CORE_TURN_STEP_BUDGET,
        system_prompt,
    };
    let transports = model_routes
        .iter()
        .map(|route| {
            let provider_id = provider_context_id(&route.provider, &route.model);
            let authorization = match route.provider.auth_mode {
                AiAuthMode::Bearer => format!("Bearer {}", route.api_key),
                AiAuthMode::ApiKey => route.api_key.clone(),
            };
            let chat = ChatCompletionsTransport::new_with_authorization(
                &route.provider.base_url,
                authorization.clone(),
                route.model.model.clone(),
                Duration::from_millis(core_config.request_timeout_ms),
            )
            .map_err(core_error)?;
            let responses = ResponsesTransport::new_with_authorization(
                &route.provider.base_url,
                authorization,
                route.model.model.clone(),
                provider_id.clone(),
                Duration::from_millis(core_config.request_timeout_ms),
            )
            .map_err(core_error)?;
            Ok(ProviderTransport {
                provider_id,
                route_label: format!("{} · {}", route.provider.name, route.model.model),
                diagnostic_secret: Arc::from(route.api_key.as_str()),
                chat,
                responses,
                health: Mutex::new(RouteHealth::default()),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let runtime_fingerprint = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&json!({
            "profileId": profile.id,
            "models": model_routes.iter().map(|route| json!({
                "id": route.model.id,
                "model": route.model.model,
                "role": route.model.role,
                "providerProfileId": route.provider.id,
                "baseUrl": route.provider.base_url,
                "authMode": route.provider.auth_mode,
                "credentialFingerprint": credential_fingerprint(&route.api_key),
                "contextWindowTokens": route.model.context_window_tokens,
                "compactThresholdTokens": route.model.compact_threshold_tokens,
            })).collect::<Vec<_>>(),
            "systemPrompt": core_config.system_prompt,
            "contextWindowTokens": core_config.context_window_tokens,
            "compactThresholdTokens": core_config.compact_threshold_tokens,
            "turnStepBudget": core_config.turn_step_budget,
        }))?)
    );
    let runtime = service
        .runtime_for(
            &conversation_id,
            runtime_fingerprint,
            core_config,
            Arc::new(ProviderContextAdapter { transports }),
        )
        .await?;
    let context_state = match runtime.resume_thread(&conversation_id) {
        Ok(snapshot) => format!(
            "复用对话上下文 · {} 条消息 · 压缩版本 {}",
            snapshot.message_count, snapshot.summary_revision
        ),
        Err(CoreError::ThreadNotFound(_)) => {
            runtime
                .create_thread(&conversation_id, None, None, "root")
                .map_err(core_error)?;
            "创建新的对话上下文".to_owned()
        }
        Err(error) => return Err(core_error(error)),
    };
    let mut context_event = service::event(&run_id, "context_state", Some(context_state));
    context_event.arguments = Some(json!({
        "conversationId": conversation_id,
        "mode": "pending",
    }));
    sink.send(context_event)?;

    let host: Arc<dyn HostBridge> = Arc::new(DshHostBridge {
        service: service.clone(),
        run_id: run_id.clone(),
        goal_id,
        active_session_id,
        settings,
        registry: registry.clone(),
        capability_providers: Arc::new(mcp_providers),
        mcp_diagnostics: Arc::new(mcp_diagnostics),
        evidence: Arc::new(Mutex::new(EvidenceLedger::default())),
        loaded_skills: Arc::new(Mutex::new(restored_skill_infos)),
        sink: sink.clone(),
        continuation_sink,
        abort: abort.clone(),
    });
    let cancel_runtime = runtime.clone();
    let cancel_thread_id = conversation_id.clone();
    let mut cancel_watch = abort.clone();
    let cancel_task = tokio::spawn(async move {
        loop {
            if *cancel_watch.borrow() {
                let _ = cancel_runtime.cancel_thread(&cancel_thread_id).await;
                break;
            }
            if cancel_watch.changed().await.is_err() {
                break;
            }
        }
    });
    let steer_runtime = runtime.clone();
    let steer_thread_id = conversation_id.clone();
    let steer_task = tokio::spawn(async move {
        while let Some(input) = steering.recv().await {
            if steer_runtime
                .steer_thread(&steer_thread_id, input)
                .await
                .is_err()
            {
                break;
            }
        }
    });

    let result = runtime
        .run_turn(
            &conversation_id,
            prompt.trim(),
            tool_definitions(&registry, prompt.trim()),
            host,
        )
        .await;
    // The watcher is intentionally long-lived while the turn is running. On a
    // normal turn completion no abort signal is sent, so awaiting it directly
    // would keep the task in `running` forever. Stop and drain it explicitly
    // before publishing the terminal event.
    stop_and_drain_cancel_task(cancel_task).await;
    stop_and_drain_cancel_task(steer_task).await;
    match result {
        Ok(turn) => {
            let usage = turn.usage.clone().unwrap_or_default();
            let mut metrics = service::event(
                &run_id,
                "runtime_metrics",
                Some(format!(
                    "本轮模型请求 {} 次 · 工具调用 {} 次 · Token {}",
                    turn.model_requests, turn.tool_calls, usage.total_tokens
                )),
            );
            metrics.arguments = Some(json!({
                "modelRequests": turn.model_requests,
                "toolCalls": turn.tool_calls,
                "promptTokens": usage.prompt_tokens,
                "completionTokens": usage.completion_tokens,
                "totalTokens": usage.total_tokens,
            }));
            sink.send(metrics)?;
            if !turn.text.trim().is_empty() {
                let mut answer = service::event(&run_id, "assistant", None);
                answer.content = Some(turn.text);
                answer.step = Some(turn.steps.min(u8::MAX as usize) as u8);
                sink.send(answer)?;
            }
            let mut complete =
                service::event(&run_id, "complete", Some(turn.finish_reason.clone()));
            complete.step = Some(turn.steps.min(u8::MAX as usize) as u8);
            sink.send(complete)?;
            Ok(AgentRunResult {
                run_id: run_id.clone(),
                conversation_id: conversation_id.clone(),
                turn_id: run_id,
                finish_reason: turn.finish_reason,
                steps: turn.steps.min(u8::MAX as usize) as u8,
                model_requests: turn.model_requests.min(u32::MAX as usize) as u32,
                tool_calls: turn.tool_calls.min(u32::MAX as usize) as u32,
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
            })
        }
        Err(CoreError::Cancelled(_detail)) if *abort.borrow() => Ok(AgentRunResult {
            run_id: run_id.clone(),
            conversation_id: conversation_id.clone(),
            turn_id: run_id,
            finish_reason: "aborted".to_owned(),
            steps: 0,
            model_requests: 0,
            tool_calls: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        }),
        Err(error) => {
            let mut failed = service::event(&run_id, "complete", Some("failed".to_owned()));
            failed.content = Some(error.detail());
            failed.error_code = Some(error.diagnostic_code().to_owned());
            failed.is_error = Some(true);
            sink.send(failed)?;
            Err(core_error(error))
        }
    }
}

async fn stop_and_drain_cancel_task(task: tokio::task::JoinHandle<()>) {
    task.abort();
    let _ = task.await;
}

struct ProviderContextAdapter {
    transports: Vec<ProviderTransport>,
}

#[async_trait]
impl ModelTransport for ProviderContextAdapter {
    async fn stream(
        &self,
        request: ModelRequest,
        cancellation: CancellationToken,
        on_text_delta: Option<Arc<dyn Fn(String) + Send + Sync>>,
    ) -> Result<dsh_codex_core::ModelResponse, CoreError> {
        let mut failures = Vec::new();
        for transport in &self.transports {
            if let Some(remaining) = transport.circuit_remaining().await {
                failures.push(
                    CoreError::Model {
                        phase: "routing",
                        code: "MODEL_ROUTE_CIRCUIT_OPEN".to_owned(),
                        status: None,
                        detail: format!(
                            "model route '{}' is cooling down for {} ms after repeated failures",
                            transport.route_label,
                            remaining.as_millis()
                        ),
                        response_body: None,
                    }
                    .to_json(),
                );
                continue;
            }
            for attempt in 0..=2 {
                match transport
                    .stream(request.clone(), cancellation.clone(), on_text_delta.clone())
                    .await
                {
                    Ok(response) => {
                        transport.record_success().await;
                        return Ok(response);
                    }
                    Err(CoreError::Cancelled(detail)) => {
                        return Err(CoreError::Cancelled(detail));
                    }
                    Err(error) => {
                        let retryable = retryable_model_error(&error);
                        if retryable && attempt < 2 {
                            let delay = [400_u64, 1_000][attempt];
                            tracing::warn!(
                                event = "model_route_retry",
                                route = %transport.route_label,
                                attempt = attempt + 1,
                                delay_ms = delay,
                                error_code = error.diagnostic_code(),
                                error_phase = error.phase(),
                                error_detail = %error.to_json(),
                                "retrying transient model route failure"
                            );
                            tokio::select! {
                                _ = cancellation.cancelled() => {
                                    return Err(CoreError::Cancelled("model route retry cancelled".to_owned()));
                                }
                                _ = tokio::time::sleep(Duration::from_millis(delay)) => {}
                            }
                            continue;
                        }
                        transport.record_failure(retryable).await;
                        failures.push(format!(
                            "route '{}': {}",
                            transport.route_label,
                            error.to_json()
                        ));
                        break;
                    }
                }
            }
        }
        Err(CoreError::Model {
            phase: "routing",
            code: "MODEL_ROUTING_FAILED".to_owned(),
            status: None,
            detail: format!("all configured models failed:\n{}", failures.join("\n")),
            response_body: None,
        })
    }
}

struct ProviderTransport {
    provider_id: String,
    route_label: String,
    diagnostic_secret: Arc<str>,
    chat: ChatCompletionsTransport,
    responses: ResponsesTransport,
    health: Mutex<RouteHealth>,
}

#[derive(Default)]
struct RouteHealth {
    consecutive_failures: u8,
    open_until: Option<Instant>,
}

impl ProviderTransport {
    async fn circuit_remaining(&self) -> Option<Duration> {
        let mut health = self.health.lock().await;
        let open_until = health.open_until?;
        let now = Instant::now();
        if open_until <= now {
            health.open_until = None;
            health.consecutive_failures = 0;
            return None;
        }
        Some(open_until.saturating_duration_since(now))
    }

    async fn record_success(&self) {
        let mut health = self.health.lock().await;
        health.consecutive_failures = 0;
        health.open_until = None;
    }

    async fn record_failure(&self, retryable: bool) {
        let mut health = self.health.lock().await;
        if record_route_failure(&mut health, retryable, Instant::now()) {
            tracing::warn!(
                event = "model_route_circuit_opened",
                route = %self.route_label,
                cooldown_ms = 30_000,
                consecutive_failures = health.consecutive_failures,
                "model route circuit opened"
            );
        }
    }

    async fn stream(
        &self,
        request: ModelRequest,
        cancellation: CancellationToken,
        on_text_delta: Option<Arc<dyn Fn(String) + Send + Sync>>,
    ) -> Result<dsh_codex_core::ModelResponse, CoreError> {
        let checkpoint = request
            .provider_contexts
            .iter()
            .find(|context| context.provider_id == self.provider_id);
        let previously_unsupported = checkpoint.is_some_and(|context| context.unsupported);
        let try_responses = request.provider_context_enabled && !previously_unsupported;
        let mut responses_error = None;
        let mut unsupported = previously_unsupported;
        if previously_unsupported {
            tracing::debug!(
                event = "provider_context_route",
                thread_id = %request.thread_id,
                provider_id = %self.provider_id,
                decision = "cached_local_rollout",
                persistent = true,
                "provider context capability cache hit"
            );
        }
        if try_responses {
            tracing::debug!(
                event = "provider_context_probe",
                thread_id = %request.thread_id,
                provider_id = %self.provider_id,
                decision = "try_responses",
                "probing provider context capability"
            );
            match self
                .responses
                .stream(request.clone(), cancellation.clone(), on_text_delta.clone())
                .await
            {
                Ok(response) => return Ok(response),
                Err(CoreError::Cancelled(detail)) => return Err(CoreError::Cancelled(detail)),
                Err(error) => {
                    unsupported = responses_unsupported(&error);
                    let error = redact_model_error(error, self.diagnostic_secret.as_ref());
                    tracing::warn!(
                        event = "provider_context_probe_failed",
                        thread_id = %request.thread_id,
                        provider_id = %self.provider_id,
                        error_code = error.diagnostic_code(),
                        error_phase = error.phase(),
                        error_detail = %error.to_json(),
                        persistent = unsupported,
                        fallback = "chat_completions",
                        "Responses capability probe failed; applying adaptive fallback"
                    );
                    responses_error = Some(error.to_json());
                }
            }
        }
        match self
            .chat
            .stream(request.clone(), cancellation, on_text_delta)
            .await
        {
            Ok(mut response) => {
                if request.provider_context_enabled {
                    response.provider_context = Some(ProviderContextUpdate {
                        provider_id: self.provider_id.clone(),
                        mode: ProviderContextMode::LocalRollout,
                        cursor: None,
                        unsupported,
                    });
                }
                Ok(response)
            }
            Err(error) => {
                let error = redact_model_error(error, self.diagnostic_secret.as_ref());
                if let Some(responses_error) = responses_error {
                    Err(CoreError::Model {
                        phase: "provider_context_fallback",
                        code: "RESPONSES_AND_CHAT_FAILED".to_owned(),
                        status: None,
                        detail: format!(
                            "Responses request failed:\n{responses_error}\nChat Completions fallback failed:\n{}",
                            error.to_json()
                        ),
                        response_body: None,
                    })
                } else {
                    Err(error)
                }
            }
        }
    }
}

fn retryable_model_error(error: &CoreError) -> bool {
    match error {
        CoreError::Model {
            phase,
            code,
            status,
            detail,
            ..
        } => {
            let request_not_streaming = matches!(
                *phase,
                "send"
                    | "responses_send"
                    | "responses_body"
                    | "response_status"
                    | "responses_status"
                    | "provider_context_fallback"
            );
            if !request_not_streaming {
                return false;
            }
            status.is_some_and(|value| value == 408 || value == 429 || value >= 500)
                || matches!(code.as_str(), "TIMEOUT" | "CONNECT" | "HTTP_CLIENT")
                || (code == "RESPONSES_AND_CHAT_FAILED"
                    && ["TIMEOUT", "CONNECT", "HTTP_429", "HTTP_5"]
                        .iter()
                        .any(|marker| detail.contains(marker)))
        }
        _ => false,
    }
}

fn record_route_failure(health: &mut RouteHealth, retryable: bool, now: Instant) -> bool {
    if !retryable {
        return false;
    }
    health.consecutive_failures = health.consecutive_failures.saturating_add(1);
    if health.consecutive_failures < 3 {
        return false;
    }
    health.open_until = Some(now + Duration::from_secs(30));
    true
}

fn provider_context_id(profile: &AiProfile, model: &AiModelConfig) -> String {
    let auth_mode = match profile.auth_mode {
        AiAuthMode::Bearer => "bearer",
        AiAuthMode::ApiKey => "api_key",
    };
    let mut hasher = Sha256::new();
    hasher.update(b"provider-context-v1\0");
    hasher.update(profile.base_url.trim().trim_end_matches('/').as_bytes());
    hasher.update(b"\0");
    hasher.update(model.model.trim().as_bytes());
    hasher.update(b"\0");
    hasher.update(auth_mode.as_bytes());
    let fingerprint = format!("{:x}", hasher.finalize());
    format!("{}:{}:{}", profile.id, model.id, &fingerprint[..16])
}

fn credential_fingerprint(secret: &str) -> String {
    let digest = format!("{:x}", Sha256::digest(secret.as_bytes()));
    digest[..16].to_owned()
}

fn redact_model_error(error: CoreError, secret: &str) -> CoreError {
    match error {
        CoreError::Model {
            phase,
            code,
            status,
            detail,
            response_body,
        } => CoreError::Model {
            phase,
            code,
            status,
            detail: redact_and_bound(&detail, secret),
            response_body: response_body.map(|body| redact_and_bound(&body, secret)),
        },
        other => other,
    }
}

fn responses_unsupported(error: &CoreError) -> bool {
    match error {
        CoreError::Model {
            status,
            response_body,
            ..
        } => {
            matches!(status, Some(404 | 405 | 501))
                || (*status == Some(400)
                    && response_body.as_deref().is_some_and(|body| {
                        let body = body.to_ascii_lowercase();
                        body.contains("responses")
                            || body.contains("context_management")
                            || body.contains("unknown endpoint")
                            || body.contains("not supported")
                    }))
        }
        _ => false,
    }
}

struct DshHostBridge {
    service: Arc<AgentService>,
    run_id: String,
    goal_id: String,
    active_session_id: Option<String>,
    settings: AgentSettings,
    registry: Arc<CapabilityRegistry>,
    capability_providers: Arc<std::collections::HashMap<String, Arc<dyn CapabilityProvider>>>,
    mcp_diagnostics: Arc<Vec<McpServerDiagnostic>>,
    evidence: Arc<Mutex<EvidenceLedger>>,
    loaded_skills: Arc<Mutex<Vec<crate::types::SkillInfo>>>,
    sink: Arc<dyn AgentEventSink>,
    continuation_sink: Arc<dyn AgentEventSink>,
    abort: watch::Receiver<bool>,
}

#[async_trait]
impl HostBridge for DshHostBridge {
    fn emit(&self, event: RuntimeEvent) {
        let Some(mapped) = map_runtime_event(&self.run_id, event) else {
            return;
        };
        if let Err(error) = self.sink.send(mapped) {
            tracing::debug!(%error, "unable to emit dsh-codex-agent runtime event");
        }
    }

    async fn execute_tool(
        &self,
        invocation: ToolInvocation,
    ) -> Result<ToolExecutionResult, CoreError> {
        let targeted_session_id = invocation
            .arguments
            .get("session_id")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                invocation
                    .arguments
                    .get("use_active_session")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    .then_some(self.active_session_id.as_deref())
                    .flatten()
            });
        let policy_context = self
            .service
            .policy_context(targeted_session_id, self.settings.permission_mode)
            .map_err(app_error)?;
        let mut decision =
            policy::evaluate_tool(&invocation.name, &invocation.arguments, policy_context);
        self.apply_skill_constraints(&invocation.name, &mut decision)
            .await;
        let pre_hooks = hooks::run(
            &self.settings.hooks,
            "PreToolUse",
            &json!({
                "runId": self.run_id,
                "callId": invocation.call_id,
                "tool": invocation.name,
                "arguments": invocation.arguments,
                "policy": decision,
            }),
        )
        .await;
        let mut hook_context = Vec::new();
        for hook in &pre_hooks {
            if let Some(context) = hook.context.as_deref() {
                hook_context.push(context.to_owned());
            }
            match hook.action {
                HookAction::Deny => decision.action = PolicyAction::Deny,
                HookAction::Ask | HookAction::Verify => {
                    if self.settings.permission_mode != AgentPermissionMode::FullAccess
                        && decision.action == PolicyAction::Allow
                    {
                        decision.action = PolicyAction::Ask;
                    }
                }
                HookAction::Context => {}
            }
        }
        if !pre_hooks.is_empty() {
            let mut hook_event =
                service::event(&self.run_id, "hook", Some("PreToolUse".to_owned()));
            hook_event.call_id = Some(invocation.call_id.clone());
            hook_event.tool_name = Some(invocation.name.clone());
            hook_event.arguments = Some(hooks::event_payload(&pre_hooks));
            let _ = self.sink.send(hook_event);
        }
        let mut policy_event =
            service::event(&self.run_id, "policy", Some(decision.reason.clone()));
        policy_event.call_id = Some(invocation.call_id.clone());
        policy_event.tool_name = Some(invocation.name.clone());
        policy_event.plugin_id = Some(service::plugin_id_for_tool(&invocation.name).to_owned());
        policy_event.arguments =
            Some(
                serde_json::to_value(&decision).map_err(|error| CoreError::Tool {
                    tool: invocation.name.clone(),
                    detail: error.to_string(),
                })?,
            );
        let _ = self.sink.send(policy_event);

        let approved = match decision.action {
            PolicyAction::Allow => true,
            PolicyAction::Deny => false,
            PolicyAction::Ask => self
                .service
                .wait_for_approval(
                    &self.run_id,
                    &invocation.call_id,
                    &invocation.name,
                    json!({ "toolArguments": invocation.arguments, "policy": decision }),
                    self.sink.clone(),
                    &mut self.abort.clone(),
                )
                .await
                .map_err(app_error)?,
        };
        if !approved {
            let content = if decision.action == PolicyAction::Deny {
                format!("策略拒绝执行：{}", decision.reason)
            } else {
                "用户拒绝了本次工具调用".to_owned()
            };
            self.emit_tool_result(&invocation, content.clone(), true, "POLICY_DENIED");
            self.emit_post_hooks(&invocation, true, &content).await;
            return Ok(ToolExecutionResult {
                content,
                is_error: true,
                status: "denied".to_owned(),
            });
        }

        let result = self.execute_registered_tool(&invocation).await;
        match result {
            Ok(mut content) => {
                if !hook_context.is_empty() {
                    content.push_str("\n\nHook context:\n");
                    content.push_str(&hook_context.join("\n"));
                }
                self.emit_tool_result(&invocation, content.clone(), false, "");
                self.emit_post_hooks(&invocation, false, &content).await;
                Ok(ToolExecutionResult {
                    content,
                    is_error: false,
                    status: "completed".to_owned(),
                })
            }
            Err(error) => {
                let detail = error.detail();
                self.emit_tool_result(&invocation, detail.clone(), true, error.code());
                self.emit_post_hooks(&invocation, true, &detail).await;
                Ok(ToolExecutionResult {
                    content: detail,
                    is_error: true,
                    status: "failed".to_owned(),
                })
            }
        }
    }
}

impl DshHostBridge {
    async fn apply_skill_constraints(
        &self,
        tool_name: &str,
        decision: &mut policy::PolicyDecision,
    ) {
        if matches!(tool_name, "skill_load" | "goal_update" | "evidence_read") {
            return;
        }
        for skill in self.loaded_skills.lock().await.iter() {
            if !super::skills::allows_tool(skill, tool_name) {
                decision.action = PolicyAction::Deny;
                decision.reason = format!(
                    "Skill '{}' does not allow tool '{}'; declared allowed_tools: {}",
                    skill.name,
                    tool_name,
                    skill.allowed_tools.join(", ")
                );
                return;
            }
            let risk = skill.risk.trim().to_ascii_lowercase();
            if matches!(risk.as_str(), "deny" | "blocked") {
                decision.action = PolicyAction::Deny;
                decision.reason = format!("Skill '{}' metadata denies execution", skill.name);
                return;
            }
            if matches!(risk.as_str(), "read_only" | "readonly")
                && decision.effect != policy::ToolEffect::Read
            {
                decision.action = PolicyAction::Deny;
                decision.reason = format!(
                    "Skill '{}' is read-only and cannot authorize a state-changing tool",
                    skill.name
                );
                return;
            }
            if matches!(risk.as_str(), "confirm" | "high" | "critical")
                && decision.effect != policy::ToolEffect::Read
                && decision.action == PolicyAction::Allow
            {
                decision.action = PolicyAction::Ask;
                decision.reason = format!(
                    "Skill '{}' metadata requires user confirmation for state-changing tools: {}",
                    skill.name, decision.reason
                );
            }
        }
    }

    async fn execute_registered_tool(
        &self,
        invocation: &ToolInvocation,
    ) -> Result<String, AppError> {
        if matches!(
            invocation.name.as_str(),
            "cli_execute" | "cli_execute_batch"
        ) {
            let refs = string_array(&invocation.arguments, "evidence_refs")?;
            for reference in &refs {
                self.ensure_evidence_loaded(reference).await?;
            }
            self.evidence.lock().await.validate_refs(&refs)?;
        }
        match invocation.name.as_str() {
            "goal_update" => {
                let status = service::argument_str(&invocation.arguments, "status")?;
                let status = match status {
                    "active" => super::domain::AgentGoalStatus::Active,
                    "waiting_approval" => super::domain::AgentGoalStatus::WaitingApproval,
                    "waiting_external" => super::domain::AgentGoalStatus::WaitingExternal,
                    "blocked" => super::domain::AgentGoalStatus::Blocked,
                    "completed" => super::domain::AgentGoalStatus::Completed,
                    "failed" => super::domain::AgentGoalStatus::Failed,
                    value => {
                        return Err(AppError::InvalidInput(format!(
                            "unsupported Goal status '{value}'"
                        )));
                    }
                };
                let checkpoint = invocation.arguments.get("checkpoint");
                let reason = invocation.arguments.get("reason").and_then(Value::as_str);
                let goal = self.service.store().update_goal(
                    &self.goal_id,
                    super::store::GoalUpdate::new(status)
                        .current_turn(Some(&self.run_id))
                        .checkpoint(checkpoint)
                        .last_error(
                            (status == super::domain::AgentGoalStatus::Failed)
                                .then_some(reason.unwrap_or("Agent marked the Goal as failed")),
                        )
                        .blocked_reason(
                            matches!(
                                status,
                                super::domain::AgentGoalStatus::WaitingApproval
                                    | super::domain::AgentGoalStatus::WaitingExternal
                                    | super::domain::AgentGoalStatus::Blocked
                            )
                            .then_some(reason.unwrap_or("Agent is waiting before it can continue")),
                        ),
                )?;
                Ok(serde_json::to_string(&goal)?)
            }
            "skill_load" => {
                let id = service::argument_str(&invocation.arguments, "id")?;
                let loaded = super::skills::load_for_model(
                    &self.settings.skill_directories,
                    &self.settings.enabled_skills,
                    id,
                )?;
                self.service.store().activate_goal_skill(
                    &self.goal_id,
                    &loaded.info.id,
                    &loaded.info.content_hash,
                )?;
                let mut active = self.loaded_skills.lock().await;
                if !active.iter().any(|skill| skill.id == loaded.info.id) {
                    active.push(loaded.info.clone());
                }
                Ok(serde_json::to_string(&json!({
                    "skill": loaded.info,
                    "instructions": loaded.content,
                    "enforcement": {
                        "allowedToolsEnforced": true,
                        "riskEnforced": true,
                        "hostPolicyStillApplies": true,
                    }
                }))?)
            }
            "mcp_status" => {
                let query = invocation
                    .arguments
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let servers = self
                    .mcp_diagnostics
                    .iter()
                    .filter(|server| server.matches_query(query))
                    .collect::<Vec<_>>();
                Ok(serde_json::to_string(&json!({
                    "query": query,
                    "configuredCount": self.mcp_diagnostics.len(),
                    "enabledCount": self.mcp_diagnostics.iter().filter(|server| server.enabled).count(),
                    "readyCount": self.mcp_diagnostics.iter().filter(|server| server.status == "ready").count(),
                    "failedCount": self.mcp_diagnostics.iter().filter(|server| server.status.ends_with("failed")).count(),
                    "matchCount": servers.len(),
                    "servers": servers,
                }))?)
            }
            "capability_search" => {
                let query = service::argument_str(&invocation.arguments, "query")?;
                let limit = invocation
                    .arguments
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(8) as usize;
                let matches = self
                    .registry
                    .search(query, limit)
                    .into_iter()
                    .map(CapabilityDescriptor::summary)
                    .collect::<Vec<_>>();
                Ok(serde_json::to_string(&json!({
                    "query": query,
                    "matchCount": matches.len(),
                    "capabilities": matches,
                }))?)
            }
            "capability_invoke" => {
                let id = service::argument_str(&invocation.arguments, "capability_id")?;
                let arguments = invocation
                    .arguments
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                self.invoke_capability(&invocation.call_id, id, arguments)
                    .await
            }
            "capability_invoke_batch" => {
                self.invoke_capability_batch(&invocation.call_id, &invocation.arguments)
                    .await
            }
            "capability_resource_list" => {
                let provider_id = invocation
                    .arguments
                    .get("provider_id")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty());
                self.list_provider_values(provider_id, "resources").await
            }
            "capability_resource_read" => {
                let provider_id = service::argument_str(&invocation.arguments, "provider_id")?;
                let uri = service::argument_str(&invocation.arguments, "uri")?;
                let provider = self.provider(provider_id)?;
                let raw = provider.read_resource(uri).await?;
                self.persist_provider_value(provider.as_ref(), "resource", uri, &raw)
                    .await
            }
            "capability_prompt_list" => {
                let provider_id = invocation
                    .arguments
                    .get("provider_id")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty());
                self.list_provider_values(provider_id, "prompts").await
            }
            "capability_prompt_get" => {
                let provider_id = service::argument_str(&invocation.arguments, "provider_id")?;
                let name = service::argument_str(&invocation.arguments, "name")?;
                let arguments = invocation
                    .arguments
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let provider = self.provider(provider_id)?;
                let raw = provider.get_prompt(name, arguments).await?;
                self.persist_provider_value(provider.as_ref(), "prompt", name, &raw)
                    .await
            }
            "evidence_read" => {
                let id = service::argument_str(&invocation.arguments, "evidence_id")?;
                self.ensure_evidence_loaded(id).await?;
                let offset = invocation
                    .arguments
                    .get("offset")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                let limit = invocation
                    .arguments
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(64 * 1024) as usize;
                let value = self.evidence.lock().await.read(id, offset, limit)?;
                Ok(serde_json::to_string(&value)?)
            }
            name => {
                if let Some(capability) = self.registry.find_by_model_name(name) {
                    return self
                        .invoke_capability(
                            &invocation.call_id,
                            &capability.id,
                            invocation.arguments.clone(),
                        )
                        .await;
                }
                self.service
                    .execute_builtin_tool(
                        &self.run_id,
                        &invocation.call_id,
                        &invocation.name,
                        invocation.arguments.clone(),
                        self.active_session_id.as_deref(),
                        &self.settings,
                        self.sink.clone(),
                        self.continuation_sink.clone(),
                        self.abort.clone(),
                    )
                    .await
            }
        }
    }

    async fn invoke_capability(
        &self,
        call_id: &str,
        id: &str,
        arguments: Value,
    ) -> Result<String, AppError> {
        let capability = self
            .registry
            .find_by_id(id)
            .ok_or_else(|| AppError::NotFound(format!("capability '{id}'")))?;
        let provider = self
            .capability_providers
            .get(&capability.provider_id)
            .ok_or_else(|| {
                AppError::NotFound(format!("capability provider '{}'", capability.provider_id))
            })?;
        let progress_sink = {
            let sink = self.sink.clone();
            let run_id = self.run_id.clone();
            let event_call_id = call_id.to_owned();
            let tool_name = capability.original_name.clone();
            let provider_id = capability.provider_id.clone();
            Arc::new(move |progress: super::capability::CapabilityProgress| {
                let mut event = service::event(
                    &run_id,
                    "capability_progress",
                    progress
                        .message
                        .clone()
                        .or_else(|| Some("MCP progress".to_owned())),
                );
                event.call_id = Some(event_call_id.clone());
                event.tool_name = Some(tool_name.clone());
                event.arguments = Some(json!({
                    "providerId": provider_id,
                    "progress": progress.progress,
                    "total": progress.total,
                }));
                if let Err(error) = sink.send(event) {
                    tracing::debug!(%error, "unable to emit MCP capability progress");
                }
            }) as super::capability::CapabilityProgressSink
        };
        let result = provider
            .invoke(capability, arguments, Some(progress_sink))
            .await?;
        let raw = result.raw;
        let evidence_id = format!("ev-{}", uuid::Uuid::new_v4());
        let record =
            self.service
                .persist_evidence(&self.run_id, &evidence_id, &capability.id, &raw)?;
        let raw_bytes = record.bytes;
        let raw_path = record.artifact_path.to_string_lossy().into_owned();
        self.evidence.lock().await.insert(record);
        let structured = result.structured_content.clone();
        let packet = capability_result_packet(
            capability,
            &raw,
            structured,
            result.is_error,
            &evidence_id,
            &raw_path,
            raw_bytes,
        )?;
        let encoded = serde_json::to_string(&packet)?;
        if result.is_error {
            return Err(AppError::Mcp {
                code: "MCP_TOOL_ERROR",
                detail: encoded,
            });
        }
        Ok(encoded)
    }

    fn provider(&self, id: &str) -> Result<Arc<dyn CapabilityProvider>, AppError> {
        self.capability_providers
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("capability provider '{id}'")))
    }

    async fn list_provider_values(
        &self,
        provider_id: Option<&str>,
        kind: &str,
    ) -> Result<String, AppError> {
        let providers = match provider_id {
            Some(id) => vec![self.provider(id)?],
            None => self.capability_providers.values().cloned().collect(),
        };
        let mut results = Vec::with_capacity(providers.len());
        for provider in providers {
            let value = match kind {
                "resources" => provider.list_resources().await,
                "prompts" => provider.list_prompts().await,
                _ => unreachable!("known provider value kind"),
            };
            match value {
                Ok(value) => results.push(json!({
                    "providerId": provider.id(),
                    "providerName": provider.name(),
                    "providerKind": provider.kind(),
                    "transport": provider.transport(),
                    "status": "success",
                    "items": value,
                })),
                Err(error) => results.push(json!({
                    "providerId": provider.id(),
                    "providerName": provider.name(),
                    "status": "error",
                    "errorCode": error.code(),
                    "error": error.detail(),
                })),
            }
        }
        Ok(serde_json::to_string(&json!({
            "kind": kind,
            "providerCount": results.len(),
            "providers": results,
        }))?)
    }

    async fn persist_provider_value(
        &self,
        provider: &dyn CapabilityProvider,
        kind: &str,
        name: &str,
        raw: &Value,
    ) -> Result<String, AppError> {
        const INLINE_BYTES: usize = 24 * 1024;
        let evidence_id = format!("ev-{}", uuid::Uuid::new_v4());
        let capability_id = format!("{}:{}:{}", provider.kind(), provider.id(), kind);
        let record =
            self.service
                .persist_evidence(&self.run_id, &evidence_id, &capability_id, raw)?;
        let raw_bytes = record.bytes;
        let raw_path = record.artifact_path.to_string_lossy().into_owned();
        self.evidence.lock().await.insert(record);
        let encoded = serde_json::to_string(raw)?;
        Ok(serde_json::to_string(&json!({
            "evidenceId": evidence_id,
            "provider": {
                "kind": provider.kind(),
                "id": provider.id(),
                "name": provider.name(),
                "transport": provider.transport(),
            },
            "contentKind": kind,
            "name": name,
            "content": (encoded.len() <= INLINE_BYTES).then_some(raw),
            "contentPreview": truncate_utf8(&encoded, 12 * 1024),
            "readRequired": encoded.len() > INLINE_BYTES,
            "rawArtifact": raw_path,
            "rawBytes": raw_bytes,
        }))?)
    }

    async fn ensure_evidence_loaded(&self, id: &str) -> Result<(), AppError> {
        if self.evidence.lock().await.contains(id) {
            return Ok(());
        }
        let persisted = self
            .service
            .store()
            .evidence(id)?
            .filter(|record| record.goal_id == self.goal_id)
            .ok_or_else(|| AppError::NotFound(format!("evidence '{id}' for current Goal")))?;
        self.evidence.lock().await.insert(EvidenceRecord {
            id: persisted.id,
            capability_id: persisted.capability_id,
            artifact_path: PathBuf::from(persisted.artifact_path),
            bytes: persisted.bytes,
        });
        Ok(())
    }

    async fn invoke_capability_batch(
        &self,
        call_id: &str,
        arguments: &Value,
    ) -> Result<String, AppError> {
        let calls = arguments
            .get("calls")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                AppError::InvalidInput("capability batch calls must be an array".to_owned())
            })?;
        if calls.is_empty() || calls.len() > 8 {
            return Err(AppError::InvalidInput(
                "capability_invoke_batch requires 1 to 8 calls".to_owned(),
            ));
        }
        let mut results = Vec::with_capacity(calls.len());
        let mut failed = false;
        for call in calls {
            let id = service::argument_str(call, "capability_id")?;
            let tool_arguments = call.get("arguments").cloned().unwrap_or_else(|| json!({}));
            match self.invoke_capability(call_id, id, tool_arguments).await {
                Ok(content) => results.push(serde_json::from_str::<Value>(&content)?),
                Err(error) => {
                    failed = true;
                    results.push(json!({
                        "capabilityId": id,
                        "status": "error",
                        "errorCode": error.code(),
                        "error": error.detail(),
                    }));
                }
            }
        }
        let encoded = serde_json::to_string(&json!({
            "status": if failed { "partial_error" } else { "success" },
            "results": results,
        }))?;
        if failed {
            Err(AppError::Mcp {
                code: "MCP_BATCH_ERROR",
                detail: encoded,
            })
        } else {
            Ok(encoded)
        }
    }

    async fn emit_post_hooks(&self, invocation: &ToolInvocation, is_error: bool, content: &str) {
        let event_name = if is_error {
            "ToolFailure"
        } else {
            "PostToolUse"
        };
        let results = hooks::run(
            &self.settings.hooks,
            event_name,
            &json!({
                "runId": self.run_id,
                "callId": invocation.call_id,
                "tool": invocation.name,
                "isError": is_error,
                "resultPreview": content,
            }),
        )
        .await;
        if !results.is_empty() {
            let mut event = service::event(&self.run_id, "hook", Some(event_name.to_owned()));
            event.call_id = Some(invocation.call_id.clone());
            event.tool_name = Some(invocation.name.clone());
            event.arguments = Some(hooks::event_payload(&results));
            let _ = self.sink.send(event);
        }
    }

    fn emit_tool_result(
        &self,
        invocation: &ToolInvocation,
        content: String,
        is_error: bool,
        code: &str,
    ) {
        let mut event = service::event(&self.run_id, "tool_result", None);
        event.call_id = Some(invocation.call_id.clone());
        event.tool_name = Some(invocation.name.clone());
        event.plugin_id = Some(service::plugin_id_for_tool(&invocation.name).to_owned());
        event.content = Some(content);
        event.is_error = Some(is_error);
        event.error_code = (!code.is_empty()).then_some(code.to_owned());
        if let Err(error) = self.sink.send(event) {
            tracing::debug!(%error, "unable to emit dsh-codex-agent tool result");
        }
    }
}

fn string_array(arguments: &Value, name: &str) -> Result<Vec<String>, AppError> {
    let Some(value) = arguments.get(name) else {
        return Ok(Vec::new());
    };
    value
        .as_array()
        .ok_or_else(|| AppError::InvalidInput(format!("tool argument '{name}' must be an array")))?
        .iter()
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                AppError::InvalidInput(format!("tool argument '{name}' must contain strings"))
            })
        })
        .collect()
}

fn capability_result_packet(
    capability: &CapabilityDescriptor,
    raw: &Value,
    structured: Option<Value>,
    is_error: bool,
    evidence_id: &str,
    raw_path: &str,
    raw_bytes: u64,
) -> Result<Value, AppError> {
    const INLINE_CONTENT_BYTES: usize = 24 * 1024;
    let structured_bytes = structured
        .as_ref()
        .and_then(|value| serde_json::to_vec(value).ok())
        .map_or(0, |value| value.len());
    let text = mcp_text_content(raw);
    let text_bytes = text.len();
    let text_content = (!text.is_empty()).then(|| truncate_utf8(&text, INLINE_CONTENT_BYTES));
    let text_truncated = text_bytes > INLINE_CONTENT_BYTES;
    let preview_source = if !text.is_empty() {
        text.clone()
    } else if let Some(value) = structured.as_ref() {
        serde_json::to_string(value)?
    } else {
        serde_json::to_string(raw)?
    };
    let content_preview = truncate_utf8(&preview_source, 12 * 1024);
    Ok(json!({
        "evidenceId": evidence_id,
        "capabilityId": capability.id,
        "provider": {
            "kind": capability.provider_kind,
            "id": capability.provider_id,
            "name": capability.provider_name,
            "transport": capability.transport,
        },
        "tool": capability.original_name,
        "status": if is_error { "error" } else { "success" },
        "isError": is_error,
        "structuredContent": (structured_bytes <= INLINE_CONTENT_BYTES).then_some(structured).flatten(),
        "structuredContentBytes": structured_bytes,
        "textContent": text_content,
        "textContentBytes": text_bytes,
        "textContentTruncated": text_truncated,
        "readRequired": raw_bytes > INLINE_CONTENT_BYTES as u64 || structured_bytes > INLINE_CONTENT_BYTES || text_truncated,
        "contentPreview": content_preview,
        "rawArtifact": raw_path,
        "rawBytes": raw_bytes,
        "outputSchemaValidated": capability.output_schema.is_some() && !is_error,
    }))
}

fn mcp_text_content(raw: &Value) -> String {
    raw.get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|block| {
            (block.get("type").and_then(Value::as_str) == Some("text"))
                .then(|| block.get("text").and_then(Value::as_str))
                .flatten()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn truncate_utf8(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_owned();
    }
    let mut boundary = limit;
    while !value.is_char_boundary(boundary) {
        boundary = boundary.saturating_sub(1);
    }
    format!(
        "{}...[truncated; read the evidence artifact for the complete result]",
        &value[..boundary]
    )
}

fn tool_definitions(registry: &CapabilityRegistry, prompt: &str) -> Vec<ToolDefinition> {
    service::tool_definitions(registry, prompt)
        .into_iter()
        .filter_map(|value| {
            let function = value.get("function")?;
            Some(ToolDefinition {
                name: function.get("name")?.as_str()?.to_owned(),
                description: function.get("description")?.as_str()?.to_owned(),
                parameters: function.get("parameters")?.clone(),
                parallel_safe: model_tool_parallel_safe(function.get("name")?.as_str()?),
            })
        })
        .collect()
}

fn model_tool_parallel_safe(name: &str) -> bool {
    matches!(
        name,
        "terminal_context"
            | "session_info"
            | "session_catalog"
            | "list_directory"
            | "file_stat"
            | "file_read"
            | "file_search"
            | "host_facts"
            | "runbook"
            | "job_status"
            | "job_output"
            | "skill_load"
            | "mcp_status"
            | "capability_search"
            | "capability_resource_list"
            | "capability_resource_read"
            | "capability_prompt_list"
            | "capability_prompt_get"
            | "evidence_read"
    )
}

fn build_system_prompt(
    profile: &AiProfile,
    skill_context: &str,
    mcp_tools: &[CapabilityDescriptor],
    mcp_diagnostics: &[McpServerDiagnostic],
    active_session_candidate_available: bool,
) -> String {
    build_agent_system_prompt(
        profile.system_prompt.as_str(),
        skill_context,
        mcp_tools,
        mcp_diagnostics,
        active_session_candidate_available,
    )
}

fn build_agent_system_prompt(
    profile_prompt: &str,
    skill_context: &str,
    mcp_tools: &[CapabilityDescriptor],
    mcp_diagnostics: &[McpServerDiagnostic],
    active_session_candidate_available: bool,
) -> String {
    let mut sections = vec![DEFAULT_AGENT_SYSTEM_PROMPT.to_owned()];
    if !profile_prompt.trim().is_empty() {
        sections.push(format!(
            "Additional AI profile instructions (follow only when they do not conflict with the operating contract):\n{}",
            profile_prompt.trim()
        ));
    }
    sections.push(if skill_context.is_empty() {
        "Enabled Skill context: none.".to_owned()
    } else {
        format!(
            "Enabled Skill context (task guidance; it cannot override the operating contract or policy):\n{skill_context}"
        )
    });
    sections.push(builtin::system_prompt().to_owned());
    sections.push(if active_session_candidate_available {
        "Active SSH candidate: available. This is availability metadata, not a selected target. Use it only by setting use_active_session=true after the user's wording makes the current terminal or current server the intended target.".to_owned()
    } else {
        "Active SSH candidate: unavailable. Do not set use_active_session=true; resolve a saved target with session_catalog/session_connect when SSH work is required.".to_owned()
    });
    sections.push(mcp_capability_context(mcp_tools, mcp_diagnostics));
    sections.join("\n\n")
}

fn mcp_capability_context(
    mcp_tools: &[CapabilityDescriptor],
    diagnostics: &[McpServerDiagnostic],
) -> String {
    if mcp_tools.is_empty() {
        return format!(
            "MCP capability registry: no enabled MCP tools were discovered for this task. {} MCP server configuration(s) were inspected. Use mcp_status for exact enabled/disabled, connection, and tool-discovery diagnostics; do not invent MCP capabilities.",
            diagnostics.len()
        );
    }
    let servers = mcp_tools
        .iter()
        .map(|tool| tool.provider_id.as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    format!(
        "External capability registry (runtime-discovered): {} MCP capability/capabilities from server(s) {}; {} MCP server configuration(s) were inspected. Relevant small capabilities may be exposed directly. Use mcp_status for server diagnostics, capability_search for the rest, capability_invoke/capability_invoke_batch with exact ids, and treat returned evidence ids, normalized text, structured content, raw artifacts, and error states as authoritative.",
        mcp_tools.len(),
        servers.join(", "),
        diagnostics.len()
    )
}

fn map_runtime_event(run_id: &str, event: RuntimeEvent) -> Option<AgentEvent> {
    let mut mapped = match event {
        RuntimeEvent::ThreadCreated { .. } => return None,
        RuntimeEvent::TurnStarted { .. } => service::event(
            run_id,
            "status",
            Some("Codex Core 已开始执行任务".to_owned()),
        ),
        RuntimeEvent::SteeringApplied { input_count, .. } => service::event(
            run_id,
            "steering_applied",
            Some(format!("Codex Core 已接收 {input_count} 条追加要求")),
        ),
        RuntimeEvent::TextDelta { .. } => return None,
        RuntimeEvent::ToolRequested {
            call_id,
            name,
            arguments_summary,
            ..
        } => {
            let mut event = service::event(run_id, "tool_requested", None);
            event.call_id = Some(call_id);
            event.tool_name = Some(name.clone());
            event.plugin_id = Some(service::plugin_id_for_tool(&name).to_owned());
            event.arguments = serde_json::from_str(&arguments_summary).ok();
            event
        }
        RuntimeEvent::ToolCompleted { .. } => return None,
        RuntimeEvent::CompactionStarted {
            estimated_tokens, ..
        } => service::event(
            run_id,
            "context_compacted",
            Some(format!(
                "Codex Core 正在压缩上下文（约 {estimated_tokens} tokens）"
            )),
        ),
        RuntimeEvent::CompactionRetrying {
            retry,
            max_retries,
            code,
            detail,
            ..
        } => {
            let mut event = service::event(
                run_id,
                "status",
                Some(format!("上下文压缩重试 {retry}/{max_retries}")),
            );
            event.content = Some(detail);
            event.error_code = Some(code);
            event
        }
        RuntimeEvent::CompactionCompleted { revision, .. } => service::event(
            run_id,
            "context_compacted",
            Some(format!("上下文压缩完成，revision {revision}")),
        ),
        RuntimeEvent::CompactionFailed { code, detail, .. } => {
            let mut event = service::event(run_id, "status", Some("上下文压缩失败".to_owned()));
            event.content = Some(detail);
            event.error_code = Some(code);
            event.is_error = Some(true);
            event
        }
        RuntimeEvent::ProviderContextUpdated {
            provider_id,
            mode,
            unsupported,
            ..
        } => {
            let mode = match mode {
                ProviderContextMode::Responses => "responses",
                ProviderContextMode::LocalRollout => "local_rollout",
            };
            let mut event = service::event(
                run_id,
                "context_state",
                Some(if unsupported {
                    "上下文已自动切换为本地 checkpoint".to_owned()
                } else {
                    format!("使用 {mode} provider 上下文")
                }),
            );
            event.arguments = Some(json!({
                "providerId": provider_id,
                "mode": mode,
                "unsupported": unsupported,
                "adaptive": true,
                "persistence": if unsupported { "conversation_provider" } else { "checkpoint" },
            }));
            event
        }
        RuntimeEvent::SubagentStatus {
            thread_id, status, ..
        } => service::event(
            run_id,
            "status",
            Some(format!("Subagent {thread_id}：{status}")),
        ),
        RuntimeEvent::TurnCompleted { finish_reason, .. } => service::event(
            run_id,
            "status",
            Some(format!("Codex Core：{finish_reason}")),
        ),
        RuntimeEvent::Error {
            code,
            phase,
            detail,
            ..
        } => {
            let mut event =
                service::event(run_id, "status", Some(format!("Agent 错误阶段：{phase}")));
            event.content = Some(detail);
            event.error_code = Some(code);
            event.is_error = Some(true);
            event
        }
    };
    if mapped.plugin_id.is_none() {
        mapped.plugin_id = Some("dsh-codex-agent".to_owned());
    }
    Some(mapped)
}

pub(crate) fn core_error(error: CoreError) -> AppError {
    AppError::Agent(error.to_json())
}

fn app_error(error: AppError) -> CoreError {
    CoreError::Tool {
        tool: "myterm_host".to_owned(),
        detail: error.detail(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_agent_system_prompt, capability_result_packet, provider_context_id,
        record_route_failure, redact_model_error, responses_unsupported, retryable_model_error,
        stop_and_drain_cancel_task, RouteHealth,
    };
    use crate::agent::capability::{CapabilityDescriptor, McpServerDiagnostic};
    use crate::types::{AiAuthMode, AiModelConfig, AiModelRole, AiProfile, AiRoutingConfig};
    use dsh_codex_core::CoreError;
    use serde_json::json;
    use std::{future::pending, time::Duration};

    #[tokio::test]
    async fn normal_completion_does_not_wait_for_abort_signal() {
        let watcher = tokio::spawn(async {
            pending::<()>().await;
        });

        tokio::time::timeout(Duration::from_secs(1), stop_and_drain_cancel_task(watcher))
            .await
            .expect("cancel watcher should be stopped after the turn completes");
    }

    #[test]
    fn provider_context_cache_key_tracks_endpoint_model_and_auth_configuration() {
        let model = AiModelConfig {
            id: "primary".to_owned(),
            name: "主模型".to_owned(),
            model: "model-a".to_owned(),
            provider_profile_id: None,
            role: AiModelRole::Primary,
            enabled: true,
            context_window_tokens: None,
            compact_threshold_tokens: None,
        };
        let mut profile = AiProfile {
            id: "profile".to_owned(),
            name: "Gateway".to_owned(),
            base_url: "https://gateway.example/v1/".to_owned(),
            api_key_ref: "ai.profile.key".to_owned(),
            auth_mode: AiAuthMode::Bearer,
            model: String::new(),
            system_prompt: String::new(),
            context_lines: 0,
            models: vec![model.clone()],
            routing: AiRoutingConfig::default(),
        };

        let original = provider_context_id(&profile, &model);
        profile.base_url = "https://gateway.example/v1".to_owned();
        assert_eq!(provider_context_id(&profile, &model), original);

        profile.base_url = "https://gateway-2.example/v1".to_owned();
        assert_ne!(provider_context_id(&profile, &model), original);

        profile.base_url = "https://gateway.example/v1".to_owned();
        let mut next_model = model.clone();
        next_model.model = "model-b".to_owned();
        assert_ne!(provider_context_id(&profile, &next_model), original);

        profile.auth_mode = AiAuthMode::ApiKey;
        assert_ne!(provider_context_id(&profile, &model), original);
        assert!(!original.contains("gateway.example"));
        assert!(!original.contains("model-a"));
    }

    #[test]
    fn provider_diagnostics_keep_exact_errors_but_redact_the_api_key() {
        let error = redact_model_error(
            CoreError::Model {
                phase: "responses_request",
                code: "http_401".to_owned(),
                status: Some(401),
                detail: "Authorization rejected for sk-secret-value".to_owned(),
                response_body: Some(r#"{"error":"sk-secret-value invalid"}"#.to_owned()),
            },
            "sk-secret-value",
        );
        let diagnostic = error.to_json();
        assert!(diagnostic.contains("http_401"));
        assert!(diagnostic.contains("401"));
        assert!(!diagnostic.contains("sk-secret-value"));
        assert!(diagnostic.contains("[REDACTED]"));
    }

    #[test]
    fn retry_classifier_never_replays_a_partially_streamed_failure() {
        let transient_send = CoreError::Model {
            phase: "send",
            code: "TIMEOUT".to_owned(),
            status: None,
            detail: "request timed out before response".to_owned(),
            response_body: None,
        };
        let streamed = CoreError::Model {
            phase: "stream",
            code: "TIMEOUT".to_owned(),
            status: None,
            detail: "stream interrupted after a delta".to_owned(),
            response_body: None,
        };
        let permanent = CoreError::Model {
            phase: "response_status",
            code: "HTTP_401".to_owned(),
            status: Some(401),
            detail: "unauthorized".to_owned(),
            response_body: None,
        };
        assert!(retryable_model_error(&transient_send));
        assert!(!retryable_model_error(&streamed));
        assert!(!retryable_model_error(&permanent));
    }

    #[test]
    fn route_circuit_opens_only_after_three_transient_terminal_failures() {
        let now = std::time::Instant::now();
        let mut health = RouteHealth::default();
        assert!(!record_route_failure(&mut health, false, now));
        assert_eq!(health.consecutive_failures, 0);
        assert!(!record_route_failure(&mut health, true, now));
        assert!(!record_route_failure(&mut health, true, now));
        assert!(record_route_failure(&mut health, true, now));
        assert_eq!(health.consecutive_failures, 3);
        assert_eq!(health.open_until, Some(now + Duration::from_secs(30)));
    }

    #[test]
    fn responses_capability_fallback_is_persisted_only_for_unsupported_endpoints() {
        let unsupported = CoreError::Model {
            phase: "responses_status",
            code: "HTTP_404".to_owned(),
            status: Some(404),
            detail: "not found".to_owned(),
            response_body: Some("unknown endpoint /responses".to_owned()),
        };
        let temporary = CoreError::Model {
            phase: "responses_status",
            code: "HTTP_503".to_owned(),
            status: Some(503),
            detail: "unavailable".to_owned(),
            response_body: Some("try again".to_owned()),
        };
        assert!(responses_unsupported(&unsupported));
        assert!(!responses_unsupported(&temporary));
    }

    #[test]
    fn agent_system_prompt_keeps_core_rules_and_describes_runtime_mcp_capabilities() {
        let mcp_tools = vec![CapabilityDescriptor {
            id: "mcp:storage:show_filesystem".to_owned(),
            model_name: "mcp__storage__show_filesystem".to_owned(),
            provider_kind: "mcp".to_owned(),
            provider_id: "storage".to_owned(),
            provider_name: "Storage".to_owned(),
            transport: "streamable-http".to_owned(),
            original_name: "show_filesystem".to_owned(),
            title: Some("Show file systems".to_owned()),
            description: "Describe storage file systems".to_owned(),
            input_schema: json!({"type": "object"}),
            output_schema: None,
            annotations: None,
        }];
        let prompt = build_agent_system_prompt(
            "Prefer concise answers.",
            "Use the storage deployment skill.",
            &mcp_tools,
            &[McpServerDiagnostic {
                server_id: "storage".to_owned(),
                server_name: "Storage".to_owned(),
                transport: "streamable_http".to_owned(),
                enabled: true,
                status: "ready".to_owned(),
                tool_count: 1,
                error_code: None,
                error_detail: None,
            }],
            true,
        );

        assert!(prompt.contains("You are dsh-codex-agent"));
        assert!(prompt.contains("Additional AI profile instructions"));
        assert!(prompt.contains("Use the storage deployment skill."));
        assert!(prompt.contains("runtime-discovered"));
        assert!(prompt.contains("1 MCP capability/capabilities from server(s) storage"));
        assert!(prompt.contains("exact ids"));
        assert!(prompt.contains("Active SSH candidate: available"));
    }

    #[test]
    fn agent_system_prompt_explicitly_handles_an_empty_mcp_catalog() {
        let prompt = build_agent_system_prompt("", "", &[], &[], false);
        assert!(prompt.contains("no enabled MCP tools were discovered"));
        assert!(prompt.contains("do not invent MCP capabilities"));
        assert!(prompt.contains("mcp_status"));
        assert!(prompt.contains("Active SSH candidate: unavailable"));
    }

    #[test]
    fn mcp_result_packet_exposes_normalized_text_before_raw_json() {
        let capability = CapabilityDescriptor {
            id: "mcp:storage:lookup".to_owned(),
            model_name: "mcp__storage__lookup".to_owned(),
            provider_kind: "mcp".to_owned(),
            provider_id: "storage".to_owned(),
            provider_name: "Storage".to_owned(),
            transport: "streamable_http".to_owned(),
            original_name: "lookup".to_owned(),
            title: None,
            description: "Lookup one product command".to_owned(),
            input_schema: json!({"type": "object"}),
            output_schema: None,
            annotations: None,
        };
        let raw = json!({
            "content": [
                {"type": "text", "text": "Command: show system general"},
                {"type": "text", "text": "Run it as one complete line."}
            ],
            "isError": false
        });
        let packet = capability_result_packet(
            &capability,
            &raw,
            None,
            false,
            "ev-1",
            "evidence/ev-1.json",
            serde_json::to_vec(&raw).unwrap().len() as u64,
        )
        .unwrap();

        assert_eq!(
            packet["textContent"],
            "Command: show system general\nRun it as one complete line."
        );
        assert_eq!(packet["contentPreview"], packet["textContent"]);
        assert_eq!(packet["textContentTruncated"], false);
        assert_eq!(packet["readRequired"], false);
    }
}

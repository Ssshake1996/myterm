use std::{
    collections::{BTreeSet, HashMap},
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use dsh_codex_core::{
    ChatCompletionsTransport, CodexRuntime, CoreConfig, CoreError, HostBridge, ModelRequest,
    ModelTransport, RuntimeEvent, ToolDefinition, ToolExecutionResult, ToolInvocation,
};
use serde_json::{json, Value};
use tokio::sync::{watch, Mutex};
use tokio_util::sync::CancellationToken;

use super::{
    builtin,
    capability::{CapabilityDescriptor, CapabilityRegistry, EvidenceLedger, McpServerDiagnostic},
    hooks::{self, HookAction},
    mcp::McpTaskClient,
    policy::{self, PolicyAction},
    service::{self, AgentEventSink, AgentService},
};
use crate::{
    config::DEFAULT_AGENT_SYSTEM_PROMPT,
    types::{AgentEvent, AgentPermissionMode, AgentRunResult, AgentSettings, AiProfile},
    AppError,
};

const CORE_CONTEXT_WINDOW_TOKENS: usize = 128_000;
const CORE_COMPACT_THRESHOLD_TOKENS: usize = 96_000;
const CORE_MAX_STEPS: usize = 64;

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run(
    service: Arc<AgentService>,
    profile: AiProfile,
    settings: AgentSettings,
    prompt: String,
    active_session_id: Option<String>,
    sink: Arc<dyn AgentEventSink>,
    abort: watch::Receiver<bool>,
    api_key: String,
    run_id: String,
) -> Result<AgentRunResult, AppError> {
    sink.send(service::event(
        &run_id,
        "status",
        Some("dsh-codex-agent 正在初始化 Codex Core".to_owned()),
    ))?;

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

    let skill_context =
        super::skills::load_enabled(&settings.skill_directories, &settings.enabled_skills)?;
    let mut capabilities = Vec::new();
    let mut mcp_clients = HashMap::new();
    let mut mcp_diagnostics = Vec::new();
    for server in &settings.mcp_servers {
        let transport = super::mcp::transport_label(&server.transport).to_owned();
        if !server.enabled {
            mcp_diagnostics.push(McpServerDiagnostic {
                server_id: server.id.clone(),
                server_name: server.name.clone(),
                transport,
                enabled: false,
                status: "disabled".to_owned(),
                tool_count: 0,
                error_code: None,
                error_detail: None,
            });
            continue;
        }
        match McpTaskClient::start(server).await {
            Ok(client) => match client.list_tools().await {
                Ok(tools) => {
                    mcp_diagnostics.push(McpServerDiagnostic {
                        server_id: server.id.clone(),
                        server_name: server.name.clone(),
                        transport,
                        enabled: true,
                        status: "ready".to_owned(),
                        tool_count: tools.len(),
                        error_code: None,
                        error_detail: None,
                    });
                    capabilities.extend(tools);
                    mcp_clients.insert(server.id.clone(), Arc::new(Mutex::new(client)));
                }
                Err(error) => {
                    mcp_diagnostics.push(McpServerDiagnostic {
                        server_id: server.id.clone(),
                        server_name: server.name.clone(),
                        transport,
                        enabled: true,
                        status: "tool_discovery_failed".to_owned(),
                        tool_count: 0,
                        error_code: Some(error.code().to_owned()),
                        error_detail: Some(error.detail()),
                    });
                    sink.send(service::mcp_error_event(&run_id, &server.name, &error))?;
                }
            },
            Err(error) => {
                mcp_diagnostics.push(McpServerDiagnostic {
                    server_id: server.id.clone(),
                    server_name: server.name.clone(),
                    transport,
                    enabled: true,
                    status: "connection_failed".to_owned(),
                    tool_count: 0,
                    error_code: Some(error.code().to_owned()),
                    error_detail: Some(error.detail()),
                });
                sink.send(service::mcp_error_event(&run_id, &server.name, &error))?;
            }
        }
    }

    let mut models = profile.effective_models();
    if !profile.routing.fallback_on_error {
        models.truncate(1);
    }
    if models.is_empty() {
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
    let core_config = CoreConfig {
        base_url: profile.base_url.clone(),
        model: models[0].model.clone(),
        state_dir: state_dir.to_string_lossy().into_owned(),
        request_timeout_ms: 120_000,
        context_window_tokens: CORE_CONTEXT_WINDOW_TOKENS,
        compact_threshold_tokens: CORE_COMPACT_THRESHOLD_TOKENS,
        max_steps: CORE_MAX_STEPS,
        system_prompt,
    };
    let transports = models
        .iter()
        .filter(|candidate| candidate.enabled)
        .map(|candidate| {
            ChatCompletionsTransport::new(
                &profile.base_url,
                api_key.clone(),
                candidate.model.clone(),
                Duration::from_millis(core_config.request_timeout_ms),
            )
            .map_err(core_error)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let runtime = CodexRuntime::new(core_config, Arc::new(FallbackTransport { transports }))
        .map_err(core_error)?;
    runtime
        .create_thread(&run_id, None, None, "root")
        .map_err(core_error)?;

    let host: Arc<dyn HostBridge> = Arc::new(DshHostBridge {
        service: service.clone(),
        run_id: run_id.clone(),
        active_session_id,
        settings,
        registry: registry.clone(),
        mcp_clients: Arc::new(mcp_clients),
        mcp_diagnostics: Arc::new(mcp_diagnostics),
        evidence: Arc::new(Mutex::new(EvidenceLedger::default())),
        sink: sink.clone(),
        abort: abort.clone(),
    });
    let cancel_runtime = runtime.clone();
    let cancel_thread_id = run_id.clone();
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

    let result = runtime
        .run_turn(
            &run_id,
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
    runtime.dispose().await.map_err(core_error)?;

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
                run_id,
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
            run_id,
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
            failed.error_code = Some(error.code().to_owned());
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

struct FallbackTransport {
    transports: Vec<ChatCompletionsTransport>,
}

#[async_trait]
impl ModelTransport for FallbackTransport {
    async fn stream(
        &self,
        request: ModelRequest,
        cancellation: CancellationToken,
        on_text_delta: Option<Arc<dyn Fn(String) + Send + Sync>>,
    ) -> Result<dsh_codex_core::ModelResponse, CoreError> {
        let mut failures = Vec::new();
        for transport in &self.transports {
            match transport
                .stream(request.clone(), cancellation.clone(), on_text_delta.clone())
                .await
            {
                Ok(response) => return Ok(response),
                Err(CoreError::Cancelled(detail)) => {
                    return Err(CoreError::Cancelled(detail));
                }
                Err(error) => failures.push(error.to_json()),
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

struct DshHostBridge {
    service: Arc<AgentService>,
    run_id: String,
    active_session_id: Option<String>,
    settings: AgentSettings,
    registry: Arc<CapabilityRegistry>,
    mcp_clients: Arc<HashMap<String, Arc<Mutex<McpTaskClient>>>>,
    mcp_diagnostics: Arc<Vec<McpServerDiagnostic>>,
    evidence: Arc<Mutex<EvidenceLedger>>,
    sink: Arc<dyn AgentEventSink>,
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
    async fn execute_registered_tool(
        &self,
        invocation: &ToolInvocation,
    ) -> Result<String, AppError> {
        if matches!(
            invocation.name.as_str(),
            "cli_execute" | "cli_execute_batch"
        ) {
            let refs = string_array(&invocation.arguments, "evidence_refs")?;
            self.evidence.lock().await.validate_refs(&refs)?;
        }
        match invocation.name.as_str() {
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
                self.invoke_capability(id, arguments).await
            }
            "capability_invoke_batch" => self.invoke_capability_batch(&invocation.arguments).await,
            "evidence_read" => {
                let id = service::argument_str(&invocation.arguments, "evidence_id")?;
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
                        .invoke_capability(&capability.id, invocation.arguments.clone())
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
                        self.abort.clone(),
                    )
                    .await
            }
        }
    }

    async fn invoke_capability(&self, id: &str, arguments: Value) -> Result<String, AppError> {
        let capability = self
            .registry
            .find_by_id(id)
            .ok_or_else(|| AppError::NotFound(format!("capability '{id}'")))?;
        let client = self
            .mcp_clients
            .get(&capability.provider_id)
            .ok_or_else(|| {
                AppError::NotFound(format!("MCP server '{}'", capability.provider_id))
            })?;
        let result = client.lock().await.call_tool(capability, arguments).await?;
        let raw = serde_json::to_value(&result)?;
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
            result.is_error.unwrap_or(false),
            &evidence_id,
            &raw_path,
            raw_bytes,
        )?;
        let encoded = serde_json::to_string(&packet)?;
        if result.is_error == Some(true) {
            return Err(AppError::Mcp {
                code: "MCP_TOOL_ERROR",
                detail: encoded,
            });
        }
        Ok(encoded)
    }

    async fn invoke_capability_batch(&self, arguments: &Value) -> Result<String, AppError> {
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
            match self.invoke_capability(id, tool_arguments).await {
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

fn core_error(error: CoreError) -> AppError {
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
    use super::{build_agent_system_prompt, capability_result_packet, stop_and_drain_cancel_task};
    use crate::agent::capability::{CapabilityDescriptor, McpServerDiagnostic};
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

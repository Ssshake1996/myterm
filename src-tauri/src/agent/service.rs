use std::{
    collections::{HashMap, VecDeque},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{oneshot, watch, Mutex};

use super::{
    domain::{now_ms, AgentTask, AgentTaskState, ExecutionJob},
    hooks::{self, HookAction},
    mcp,
    policy::{self, PolicyAction, PolicyContext},
    skills,
    store::AgentStore,
};
use crate::{
    ai::service::{endpoint, summarize},
    config::{ConfigService, CredentialVault, DEFAULT_SYSTEM_PROMPT},
    session::{
        manager::SessionManager,
        ssh::{ExecOutputSink, ExecStream},
    },
    sftp::{service::local_entries, service::SftpService},
    types::{AgentEvent, AgentRunResult, AgentSettings, AiProfile, SessionEnvironment},
    AppError,
};

const MAX_TOOL_OUTPUT_CHARS: usize = 12_000;
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_ARTIFACT_BYTES: u64 = 50 * 1024 * 1024;

pub trait AgentEventSink: Send + Sync {
    fn send(&self, event: AgentEvent) -> Result<(), AppError>;
}

struct PersistedEventSink {
    store: Arc<AgentStore>,
    downstream: Arc<dyn AgentEventSink>,
    secrets: Vec<String>,
}

impl AgentEventSink for PersistedEventSink {
    fn send(&self, event: AgentEvent) -> Result<(), AppError> {
        let persisted = self
            .store
            .append_event(redact_event(event, &self.secrets))?;
        if let Err(error) = self.downstream.send(persisted) {
            tracing::debug!(%error, "agent UI event channel is unavailable; task continues");
        }
        Ok(())
    }
}

pub struct AgentService {
    config: Arc<ConfigService>,
    vault: Arc<dyn CredentialVault>,
    sessions: Arc<SessionManager>,
    sftp: Arc<SftpService>,
    store: Arc<AgentStore>,
    client: reqwest::Client,
    active: Mutex<Option<watch::Sender<bool>>>,
    approvals: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    host_facts: Mutex<HashMap<String, (Instant, Value)>>,
    jobs: Arc<Mutex<HashMap<String, JobRuntime>>>,
}

struct JobRuntime {
    task_id: String,
    cancel: watch::Sender<bool>,
}

impl AgentService {
    pub fn new(
        config: Arc<ConfigService>,
        vault: Arc<dyn CredentialVault>,
        sessions: Arc<SessionManager>,
        sftp: Arc<SftpService>,
    ) -> Result<Self, AppError> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|error| AppError::Ai(error.to_string()))?;
        let store_path = config
            .path()
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("agent.db");
        Ok(Self {
            config,
            vault,
            sessions,
            sftp,
            store: Arc::new(AgentStore::new(store_path)),
            client,
            active: Mutex::new(None),
            approvals: Mutex::new(HashMap::new()),
            host_facts: Mutex::new(HashMap::new()),
            jobs: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub async fn run(
        &self,
        profile_id: &str,
        prompt: String,
        session_id: Option<String>,
        sink: Arc<dyn AgentEventSink>,
    ) -> Result<AgentRunResult, AppError> {
        self.run_with_permission(profile_id, prompt, session_id, sink, None)
            .await
    }

    pub async fn run_with_permission(
        &self,
        profile_id: &str,
        prompt: String,
        session_id: Option<String>,
        sink: Arc<dyn AgentEventSink>,
        permission: Option<crate::types::AgentPermissionMode>,
    ) -> Result<AgentRunResult, AppError> {
        self.run_with_task_id(
            uuid::Uuid::new_v4().to_string(),
            profile_id,
            prompt,
            session_id,
            sink,
            permission,
        )
        .await
    }

    pub async fn run_with_task_id(
        &self,
        run_id: String,
        profile_id: &str,
        prompt: String,
        session_id: Option<String>,
        sink: Arc<dyn AgentEventSink>,
        permission: Option<crate::types::AgentPermissionMode>,
    ) -> Result<AgentRunResult, AppError> {
        if prompt.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "agent prompt is required".to_owned(),
            ));
        }
        let profile = self.ai_profile(profile_id)?;
        let mut settings = self.config.agent_settings()?;
        if let Some(permission) = permission {
            settings.permission_mode = permission;
        }
        self.store
            .recover_stale_tasks(now_ms() - Duration::from_secs(300).as_millis() as i64)?;
        let (abort_tx, abort_rx) = watch::channel(false);
        let mut active = self.active.lock().await;
        if active.is_some() {
            return Err(AppError::Ai(
                "another agent run is already active".to_owned(),
            ));
        }
        let api_key = self
            .vault
            .get(&profile.api_key_ref)?
            .ok_or_else(|| AppError::Ai("API key is not configured".to_owned()))?;
        let timestamp = now_ms();
        self.store.create_task(&AgentTask {
            id: run_id.clone(),
            profile_id: profile.id.clone(),
            session_id: session_id.clone(),
            prompt: prompt.trim().to_owned(),
            state: AgentTaskState::Queued,
            permission_mode: settings.permission_mode,
            created_at_ms: timestamp,
            updated_at_ms: timestamp,
            finish_reason: None,
            steps: 0,
            error_code: None,
            error_message: None,
        })?;
        self.store
            .transition_task(&run_id, AgentTaskState::Running, None, 0, None)?;
        let sink: Arc<dyn AgentEventSink> = Arc::new(PersistedEventSink {
            store: self.store.clone(),
            downstream: sink,
            secrets: vec![api_key.clone()],
        });
        *active = Some(abort_tx.clone());
        drop(active);
        let store = self.store.clone();
        let polled_task_id = run_id.clone();
        let polled_abort = abort_tx;
        let (poll_stop_tx, mut poll_stop_rx) = watch::channel(false);
        let cancellation_poll = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(250));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        if store.cancel_requested(&polled_task_id).unwrap_or(false) {
                            let _ = polled_abort.send(true);
                            break;
                        }
                    }
                    changed = poll_stop_rx.changed() => {
                        if changed.is_err() || *poll_stop_rx.borrow() {
                            break;
                        }
                    }
                }
            }
        });
        let result = self
            .run_inner(
                &run_id,
                profile,
                settings,
                prompt,
                session_id,
                sink.clone(),
                abort_rx,
                api_key,
            )
            .await;
        if !matches!(&result, Ok(completed) if completed.finish_reason == "stop") {
            self.cancel_jobs_for_task(&run_id).await;
        }
        let stop_results = hooks::run(
            &self.config.agent_settings()?.hooks,
            "Stop",
            &json!({
                "runId": run_id,
                "finishReason": result.as_ref().map(|result| result.finish_reason.as_str()).unwrap_or("error")
            }),
        )
        .await;
        if !stop_results.is_empty() {
            let mut hook_event = event(&run_id, "hook", Some("Stop".to_owned()));
            hook_event.arguments = Some(hooks::event_payload(&stop_results));
            let _ = sink.send(hook_event);
        }
        let _ = poll_stop_tx.send(true);
        let _ = cancellation_poll.await;
        *self.active.lock().await = None;
        self.reject_pending_approvals().await;
        match &result {
            Ok(completed) => {
                let state = match completed.finish_reason.as_str() {
                    "stop" => AgentTaskState::Succeeded,
                    "aborted" => AgentTaskState::Canceled,
                    _ => AgentTaskState::Failed,
                };
                self.store.transition_task(
                    &run_id,
                    state,
                    Some(&completed.finish_reason),
                    completed.steps,
                    None,
                )?;
            }
            Err(error) => {
                let mut failed = event(&run_id, "complete", Some("failed".to_owned()));
                failed.content = Some(error.to_string());
                failed.is_error = Some(true);
                let _ = sink.send(failed);
                self.store.transition_task(
                    &run_id,
                    AgentTaskState::Failed,
                    Some("error"),
                    0,
                    Some(("agent_run_failed", &error.to_string())),
                )?;
            }
        }
        result
    }

    pub fn tasks(&self, limit: usize) -> Result<Vec<AgentTask>, AppError> {
        self.store.tasks(limit)
    }

    pub fn task(&self, task_id: &str) -> Result<AgentTask, AppError> {
        self.store
            .task(task_id)?
            .ok_or_else(|| AppError::NotFound(format!("agent task '{task_id}'")))
    }

    pub fn task_events(
        &self,
        task_id: &str,
        after_sequence: u64,
        limit: usize,
    ) -> Result<Vec<AgentEvent>, AppError> {
        self.store.events_after(task_id, after_sequence, limit)
    }

    pub fn task_delete(&self, task_id: &str) -> Result<bool, AppError> {
        self.store.delete_task(task_id)
    }

    pub async fn is_busy(&self) -> bool {
        self.active.lock().await.is_some()
    }

    pub async fn cancel_job(&self, job_id: &str) -> Result<ExecutionJob, AppError> {
        let job = self
            .store
            .job(job_id)?
            .ok_or_else(|| AppError::NotFound(format!("execution job '{job_id}'")))?;
        if matches!(job.state.as_str(), "running" | "canceling") {
            if let Some(runtime) = self.jobs.lock().await.get(job_id) {
                let _ = runtime.cancel.send(true);
                self.store.job_canceling(job_id)?;
            }
        }
        self.store
            .job(job_id)?
            .ok_or_else(|| AppError::NotFound(format!("execution job '{job_id}'")))
    }

    pub async fn approve(&self, call_id: &str, approved: bool) -> Result<(), AppError> {
        let sender = self
            .approvals
            .lock()
            .await
            .remove(call_id)
            .ok_or_else(|| AppError::NotFound(format!("agent approval '{call_id}'")))?;
        sender
            .send(approved)
            .map_err(|_| AppError::Ai("agent approval is no longer active".to_owned()))
    }

    pub async fn abort(&self) {
        if let Some(sender) = self.active.lock().await.as_ref() {
            let _ = sender.send(true);
        }
        self.reject_pending_approvals().await;
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_inner(
        &self,
        run_id: &str,
        profile: AiProfile,
        settings: AgentSettings,
        prompt: String,
        session_id: Option<String>,
        sink: Arc<dyn AgentEventSink>,
        mut abort: watch::Receiver<bool>,
        key: String,
    ) -> Result<AgentRunResult, AppError> {
        sink.send(event(
            run_id,
            "status",
            Some("正在准备工具和上下文".to_owned()),
        ))?;

        let session_hooks = hooks::run(
            &settings.hooks,
            "SessionStart",
            &json!({ "runId": run_id, "sessionId": session_id }),
        )
        .await;
        if !session_hooks.is_empty() {
            let mut hook_event = event(run_id, "hook", Some("SessionStart".to_owned()));
            hook_event.arguments = Some(hooks::event_payload(&session_hooks));
            sink.send(hook_event)?;
        }

        let skill_context =
            skills::load_enabled(&settings.skill_directories, &settings.enabled_skills)?;
        let mut mcp_tools = Vec::new();
        let mut mcp_clients = HashMap::new();
        for server in settings.mcp_servers.iter().filter(|server| server.enabled) {
            match mcp::McpTaskClient::start(server).await {
                Ok(client) => match client.list_tools().await {
                    Ok(tools) => {
                        mcp_tools.extend(tools);
                        mcp_clients.insert(server.id.clone(), client);
                    }
                    Err(error) => sink.send(event(
                        run_id,
                        "mcp_error",
                        Some(format!("{}: {error}", server.name)),
                    ))?,
                },
                Err(error) => sink.send(event(
                    run_id,
                    "mcp_error",
                    Some(format!("{}: {error}", server.name)),
                ))?,
            }
        }
        let tools = tool_definitions(&mcp_tools);
        let system_prompt = build_system_prompt(&profile, &settings, &skill_context);
        let mut messages = vec![
            json!({ "role": "system", "content": system_prompt }),
            json!({ "role": "user", "content": prompt.trim() }),
        ];
        let mut last_call_signature = String::new();
        let mut repeated_calls = 0_u8;

        for step in 1..=settings.max_steps {
            if *abort.borrow() {
                return Ok(AgentRunResult {
                    run_id: run_id.to_owned(),
                    finish_reason: "aborted".to_owned(),
                    steps: step.saturating_sub(1),
                });
            }
            let mut status = event(
                run_id,
                "status",
                Some(format!("模型决策 · {step}/{}", settings.max_steps)),
            );
            status.step = Some(step);
            sink.send(status)?;

            let response = tokio::select! {
                changed = abort.changed() => {
                    if changed.is_ok() && *abort.borrow() {
                        return Ok(AgentRunResult { run_id: run_id.to_owned(), finish_reason: "aborted".to_owned(), steps: step.saturating_sub(1) });
                    }
                    continue;
                }
                response = self.request_model(&profile, &key, &messages, &tools) => response?,
            };
            let choice = response
                .choices
                .into_iter()
                .next()
                .ok_or_else(|| AppError::Ai("model returned no choices".to_owned()))?;
            let assistant = choice.message;
            if assistant.tool_calls.is_empty() {
                let running_jobs = self.store.running_job_count(run_id)?;
                if running_jobs > 0 {
                    messages.push(serde_json::to_value(&assistant)?);
                    messages.push(json!({
                        "role": "user",
                        "content": format!(
                            "{running_jobs} background job(s) are still running. Use job_status/job_output and cancel when appropriate. Do not provide a final answer until every job is terminal."
                        )
                    }));
                    let mut waiting = event(
                        run_id,
                        "status",
                        Some(format!("waiting for {running_jobs} background job(s)")),
                    );
                    waiting.step = Some(step);
                    sink.send(waiting)?;
                    continue;
                }
                let content = assistant.content.unwrap_or_default();
                let mut output = event(run_id, "assistant", None);
                output.content = Some(content);
                output.step = Some(step);
                sink.send(output)?;
                let complete = complete_event(run_id, "stop", step);
                sink.send(complete)?;
                return Ok(AgentRunResult {
                    run_id: run_id.to_owned(),
                    finish_reason: "stop".to_owned(),
                    steps: step,
                });
            }

            messages.push(serde_json::to_value(&assistant)?);
            for call in assistant.tool_calls {
                let arguments = serde_json::from_str::<Value>(&call.function.arguments)
                    .unwrap_or_else(|_| json!({ "_raw": call.function.arguments }));
                let signature = format!(
                    "{}:{}",
                    call.function.name,
                    serde_json::to_string(&arguments)?
                );
                if signature == last_call_signature {
                    repeated_calls = repeated_calls.saturating_add(1);
                } else {
                    last_call_signature = signature;
                    repeated_calls = 1;
                }
                if repeated_calls >= 3 {
                    sink.send(complete_event(run_id, "loop_detected", step))?;
                    return Ok(AgentRunResult {
                        run_id: run_id.to_owned(),
                        finish_reason: "loop_detected".to_owned(),
                        steps: step,
                    });
                }
                self.store
                    .tool_requested(run_id, &call.id, &call.function.name, &arguments)?;
                let mut requested = event(run_id, "tool_requested", None);
                requested.step = Some(step);
                requested.call_id = Some(call.id.clone());
                requested.tool_name = Some(call.function.name.clone());
                requested.arguments = Some(arguments.clone());
                sink.send(requested)?;

                let policy_context =
                    self.policy_context(session_id.as_deref(), settings.permission_mode)?;
                let mut decision =
                    policy::evaluate_tool(&call.function.name, &arguments, policy_context);
                let pre_hooks = hooks::run(
                    &settings.hooks,
                    "PreToolUse",
                    &json!({
                        "runId": run_id,
                        "callId": call.id,
                        "tool": call.function.name,
                        "arguments": arguments,
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
                        HookAction::Ask | HookAction::Verify
                            if decision.action == PolicyAction::Allow =>
                        {
                            decision.action = PolicyAction::Ask
                        }
                        _ => {}
                    }
                }
                if !pre_hooks.is_empty() {
                    let mut hook_event = event(run_id, "hook", Some("PreToolUse".to_owned()));
                    hook_event.step = Some(step);
                    hook_event.call_id = Some(call.id.clone());
                    hook_event.tool_name = Some(call.function.name.clone());
                    hook_event.arguments = Some(hooks::event_payload(&pre_hooks));
                    sink.send(hook_event)?;
                }
                let mut policy_event = event(run_id, "policy", Some(decision.reason.clone()));
                policy_event.step = Some(step);
                policy_event.call_id = Some(call.id.clone());
                policy_event.tool_name = Some(call.function.name.clone());
                policy_event.arguments = Some(serde_json::to_value(&decision)?);
                sink.send(policy_event)?;

                let approved = match decision.action {
                    PolicyAction::Allow => true,
                    PolicyAction::Deny => false,
                    PolicyAction::Ask => {
                        self.wait_for_approval(
                            run_id,
                            &call.id,
                            &call.function.name,
                            json!({ "toolArguments": arguments.clone(), "policy": decision.clone() }),
                            sink.clone(),
                            &mut abort,
                        )
                        .await?
                    }
                };
                let (mut output, is_error) = if decision.action == PolicyAction::Deny {
                    (
                        format!("Policy denied this call: {}", decision.reason),
                        true,
                    )
                } else if approved {
                    match self
                        .execute_tool(
                            run_id,
                            &call.id,
                            &call.function.name,
                            arguments,
                            session_id.as_deref(),
                            &settings,
                            &mcp_tools,
                            &mcp_clients,
                            sink.clone(),
                            abort.clone(),
                        )
                        .await
                    {
                        Ok(output) => (truncate(&output), false),
                        Err(error) => (truncate(&error.to_string()), true),
                    }
                } else {
                    ("用户拒绝了本次工具调用".to_owned(), true)
                };
                if !hook_context.is_empty() {
                    output.push_str("\n\nHook context:\n");
                    output.push_str(&hook_context.join("\n"));
                    output = truncate(&output);
                }
                let mut result_event = event(run_id, "tool_result", None);
                result_event.step = Some(step);
                result_event.call_id = Some(call.id.clone());
                result_event.tool_name = Some(call.function.name.clone());
                result_event.content = Some(output.clone());
                result_event.is_error = Some(is_error);
                sink.send(result_event)?;
                self.store.tool_completed(&call.id, &output, is_error)?;
                let post_event = if is_error {
                    "ToolFailure"
                } else {
                    "PostToolUse"
                };
                let post_hooks = hooks::run(
                    &settings.hooks,
                    post_event,
                    &json!({
                        "runId": run_id,
                        "callId": call.id,
                        "tool": call.function.name,
                        "isError": is_error,
                        "resultPreview": output,
                    }),
                )
                .await;
                if !post_hooks.is_empty() {
                    let mut hook_event = event(run_id, "hook", Some(post_event.to_owned()));
                    hook_event.step = Some(step);
                    hook_event.call_id = Some(call.id.clone());
                    hook_event.tool_name = Some(call.function.name.clone());
                    hook_event.arguments = Some(hooks::event_payload(&post_hooks));
                    sink.send(hook_event)?;
                }
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": output,
                }));
            }
            if let Some(removed) = compact_messages(&mut messages) {
                let compact_hooks = hooks::run(
                    &settings.hooks,
                    "PreCompact",
                    &json!({ "runId": run_id, "removedMessages": removed }),
                )
                .await;
                if !compact_hooks.is_empty() {
                    let mut hook_event = event(run_id, "hook", Some("PreCompact".to_owned()));
                    hook_event.step = Some(step);
                    hook_event.arguments = Some(hooks::event_payload(&compact_hooks));
                    sink.send(hook_event)?;
                }
                let mut compacted = event(
                    run_id,
                    "context_compacted",
                    Some(format!("compacted {removed} earlier model messages")),
                );
                compacted.step = Some(step);
                sink.send(compacted)?;
            }
        }

        sink.send(complete_event(run_id, "limit", settings.max_steps))?;
        Ok(AgentRunResult {
            run_id: run_id.to_owned(),
            finish_reason: "limit".to_owned(),
            steps: settings.max_steps,
        })
    }

    async fn request_model(
        &self,
        profile: &AiProfile,
        key: &str,
        messages: &[Value],
        tools: &[Value],
    ) -> Result<ChatResponse, AppError> {
        let response = self
            .client
            .post(endpoint(&profile.base_url, "chat/completions")?)
            .bearer_auth(key)
            .json(&json!({
                "model": profile.model,
                "messages": messages,
                "tools": tools,
                "tool_choice": "auto",
                "stream": false,
            }))
            .send()
            .await
            .map_err(|error| AppError::Ai(error.to_string()))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| AppError::Ai(error.to_string()))?;
        if !status.is_success() {
            return Err(AppError::Ai(format!(
                "HTTP {}: {}",
                status.as_u16(),
                summarize(&body)
            )));
        }
        serde_json::from_str(&body).map_err(|error| {
            AppError::Ai(format!(
                "invalid tool response: {error}; body: {}",
                summarize(&body)
            ))
        })
    }

    async fn wait_for_approval(
        &self,
        run_id: &str,
        call_id: &str,
        tool_name: &str,
        arguments: Value,
        sink: Arc<dyn AgentEventSink>,
        abort: &mut watch::Receiver<bool>,
    ) -> Result<bool, AppError> {
        self.store
            .transition_task(run_id, AgentTaskState::WaitingApproval, None, 0, None)?;
        let policy = arguments
            .get("policy")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let risk = policy.get("risk").and_then(Value::as_str).unwrap_or("high");
        let reason = policy
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("tool execution requires confirmation");
        self.store.approval_requested(
            run_id,
            call_id,
            risk,
            reason,
            now_ms() + APPROVAL_TIMEOUT.as_millis() as i64,
        )?;
        let (sender, receiver) = oneshot::channel();
        self.approvals
            .lock()
            .await
            .insert(call_id.to_owned(), sender);
        let mut approval = event(run_id, "approval_required", None);
        approval.call_id = Some(call_id.to_owned());
        approval.tool_name = Some(tool_name.to_owned());
        approval.arguments = Some(arguments);
        sink.send(approval)?;
        let mut receiver = receiver;
        let deadline = tokio::time::sleep(APPROVAL_TIMEOUT);
        tokio::pin!(deadline);
        let decision = loop {
            tokio::select! {
                _ = abort.changed() => break false,
                decision = &mut receiver => break decision.unwrap_or(false),
                _ = &mut deadline => break false,
                _ = tokio::time::sleep(Duration::from_millis(250)) => {
                    if let Some(decision) = self.store.approval_decision(call_id)? {
                        break decision;
                    }
                }
            }
        };
        self.approvals.lock().await.remove(call_id);
        self.store.approval_decided(call_id, decision)?;
        self.store
            .transition_task(run_id, AgentTaskState::Running, None, 0, None)?;
        Ok(decision)
    }

    #[allow(clippy::too_many_arguments)]
    async fn execute_tool(
        &self,
        run_id: &str,
        call_id: &str,
        name: &str,
        arguments: Value,
        session_id: Option<&str>,
        settings: &AgentSettings,
        mcp_tools: &[mcp::McpToolDefinition],
        mcp_clients: &HashMap<String, mcp::McpTaskClient>,
        sink: Arc<dyn AgentEventSink>,
        abort: watch::Receiver<bool>,
    ) -> Result<String, AppError> {
        match name {
            "terminal_context" => {
                let session_id = require_session(session_id)?;
                let lines = argument_u64(&arguments, "lines")
                    .unwrap_or(80)
                    .clamp(1, 500);
                self.sessions.buffer_lines(session_id, lines as usize)
            }
            "terminal_send" => {
                let session_id = require_session(session_id)?;
                let command = argument_str(&arguments, "command")?;
                let newline = arguments
                    .get("newline")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                let payload = if newline {
                    format!("{command}\r")
                } else {
                    command.to_owned()
                };
                self.sessions.write(session_id, payload.as_bytes()).await?;
                tokio::time::sleep(Duration::from_millis(700)).await;
                Ok(self.sessions.buffer_lines(session_id, 60)?)
            }
            "remote_exec" => {
                let session_id = require_session(session_id)?;
                let command = argument_str(&arguments, "command")?;
                let timeout_seconds = argument_u64(&arguments, "timeout_seconds")
                    .unwrap_or(120)
                    .clamp(1, 3_600);
                if arguments
                    .get("background")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    return self
                        .start_background_job(
                            run_id,
                            call_id,
                            session_id,
                            command,
                            timeout_seconds,
                            sink,
                        )
                        .await;
                }
                Ok(serde_json::to_string(
                    &self
                        .structured_command(
                            run_id,
                            call_id,
                            name,
                            session_id,
                            command,
                            timeout_seconds,
                            sink,
                            abort,
                        )
                        .await?,
                )?)
            }
            "job_status" => {
                let job_id = argument_str(&arguments, "job_id")?;
                let job = self.task_job(run_id, job_id)?;
                Ok(serde_json::to_string(&job)?)
            }
            "job_output" => {
                let job_id = argument_str(&arguments, "job_id")?;
                let stream = arguments
                    .get("stream")
                    .and_then(Value::as_str)
                    .unwrap_or("stdout");
                let offset = argument_u64(&arguments, "offset").unwrap_or(0);
                let limit = argument_u64(&arguments, "limit")
                    .unwrap_or(64 * 1024)
                    .clamp(1, 64 * 1024) as usize;
                let job = self.task_job(run_id, job_id)?;
                Ok(serde_json::to_string(&read_job_output(
                    &job, stream, offset, limit,
                )?)?)
            }
            "job_cancel" => {
                let job_id = argument_str(&arguments, "job_id")?;
                let job = self.task_job(run_id, job_id)?;
                let requested = if let Some(runtime) = self.jobs.lock().await.get(job_id) {
                    runtime.cancel.send(true).is_ok()
                } else {
                    false
                };
                Ok(serde_json::to_string(&json!({
                    "job": job,
                    "cancelRequested": requested,
                }))?)
            }
            "session_info" => {
                let session_id = require_session(session_id)?;
                let session = self
                    .sessions
                    .list()?
                    .into_iter()
                    .find(|session| session.session_id == session_id)
                    .ok_or_else(|| AppError::NotFound(format!("session '{session_id}'")))?;
                let profile = self
                    .config
                    .profile_list()?
                    .into_iter()
                    .find(|profile| profile.id == session.profile_id);
                Ok(serde_json::to_string(
                    &json!({ "session": session, "profile": profile }),
                )?)
            }
            "list_directory" => {
                let scope = arguments
                    .get("scope")
                    .and_then(Value::as_str)
                    .unwrap_or("remote");
                let path = argument_str(&arguments, "path")?;
                if scope == "local" {
                    Ok(serde_json::to_string(&local_entries(&PathBuf::from(
                        path,
                    ))?)?)
                } else if scope == "remote" {
                    let session_id = require_session(session_id)?;
                    Ok(serde_json::to_string(
                        &self.sftp.read_dir(session_id, path).await?,
                    )?)
                } else {
                    Err(AppError::InvalidInput(
                        "directory scope must be 'local' or 'remote'".to_owned(),
                    ))
                }
            }
            "file_stat" => {
                let session_id = require_session(session_id)?;
                let path = argument_str(&arguments, "path")?;
                Ok(serde_json::to_string(
                    &self.sftp.file_stat(session_id, path).await?,
                )?)
            }
            "file_read" => {
                let session_id = require_session(session_id)?;
                let path = argument_str(&arguments, "path")?;
                let offset = argument_u64(&arguments, "offset").unwrap_or(0);
                let limit = argument_u64(&arguments, "limit")
                    .unwrap_or(256 * 1024)
                    .clamp(1, 1024 * 1024);
                Ok(serde_json::to_string(
                    &self.sftp.file_read(session_id, path, offset, limit).await?,
                )?)
            }
            "file_search" => {
                let session_id = require_session(session_id)?;
                let path = argument_str(&arguments, "path")?;
                let pattern = argument_str(&arguments, "pattern")?;
                let max_files = argument_u64(&arguments, "max_files")
                    .unwrap_or(100)
                    .clamp(1, 500) as usize;
                let max_matches = argument_u64(&arguments, "max_matches")
                    .unwrap_or(100)
                    .clamp(1, 1_000) as usize;
                Ok(serde_json::to_string(
                    &self
                        .sftp
                        .file_search(session_id, path, pattern, max_files, max_matches)
                        .await?,
                )?)
            }
            "file_write" => {
                let session_id = require_session(session_id)?;
                let path = argument_str(&arguments, "path")?;
                let content = argument_str(&arguments, "content")?;
                let expected_hash = arguments.get("expected_hash").and_then(Value::as_str);
                Ok(serde_json::to_string(
                    &self
                        .sftp
                        .file_write_atomic(session_id, path, content.as_bytes(), expected_hash)
                        .await?,
                )?)
            }
            "file_patch" => {
                let session_id = require_session(session_id)?;
                let path = argument_str(&arguments, "path")?;
                let search = argument_str(&arguments, "search")?;
                let replace = arguments
                    .get("replace")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        AppError::InvalidInput("tool argument 'replace' is required".to_owned())
                    })?;
                let expected_hash = argument_str(&arguments, "expected_hash")?;
                let current = self
                    .sftp
                    .file_read(session_id, path, 0, 1024 * 1024)
                    .await?;
                if current.content.match_indices(search).count() != 1 {
                    return Err(AppError::Agent(
                        "file_patch search text must match exactly once".to_owned(),
                    ));
                }
                let content = current.content.replacen(search, replace, 1);
                Ok(serde_json::to_string(
                    &self
                        .sftp
                        .file_write_atomic(
                            session_id,
                            path,
                            content.as_bytes(),
                            Some(expected_hash),
                        )
                        .await?,
                )?)
            }
            "host_facts" => {
                let session_id = require_session(session_id)?;
                let refresh = arguments
                    .get("refresh")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if !refresh {
                    if let Some((collected, facts)) = self.host_facts.lock().await.get(session_id) {
                        if collected.elapsed() < Duration::from_secs(600) {
                            return Ok(serde_json::to_string(facts)?);
                        }
                    }
                }
                let command = r#"set -u
. /etc/os-release 2>/dev/null || true
printf 'distribution=%s\n' "${ID:-unknown}"
printf 'version=%s\n' "${VERSION_ID:-unknown}"
printf 'kernel=%s\n' "$(uname -r)"
printf 'architecture=%s\n' "$(uname -m)"
printf 'hostname=%s\n' "$(hostname)"
printf 'user=%s\n' "$(id -un)"
printf 'shell=%s\n' "${SHELL:-unknown}"
if command -v systemctl >/dev/null 2>&1; then init=systemd; elif command -v rc-service >/dev/null 2>&1; then init=openrc; else init=unknown; fi
printf 'init=%s\n' "$init"
if command -v apt-get >/dev/null 2>&1; then package_manager=apt; elif command -v dnf >/dev/null 2>&1; then package_manager=dnf; elif command -v yum >/dev/null 2>&1; then package_manager=yum; elif command -v apk >/dev/null 2>&1; then package_manager=apk; else package_manager=unknown; fi
printf 'package_manager=%s\n' "$package_manager"
printf 'selinux=%s\n' "$(getenforce 2>/dev/null || printf unavailable)"
printf 'apparmor=%s\n' "$(cat /sys/module/apparmor/parameters/enabled 2>/dev/null || printf unavailable)"
printf 'container=%s\n' "$(cat /proc/1/cgroup 2>/dev/null | grep -Eo 'docker|kubepods|containerd|lxc' | head -n1 || printf none)""#;
                let output = self
                    .structured_command(run_id, call_id, name, session_id, command, 30, sink, abort)
                    .await?;
                let facts = parse_host_facts(&output);
                self.host_facts
                    .lock()
                    .await
                    .insert(session_id.to_owned(), (Instant::now(), facts.clone()));
                Ok(serde_json::to_string(&facts)?)
            }
            "runbook" => {
                let session_id = require_session(session_id)?;
                let runbook = argument_str(&arguments, "name")?;
                let target = arguments.get("target").and_then(Value::as_str);
                let (command, evidence, stop_rule, failure_path) =
                    runbook_command(runbook, target)?;
                let output = self
                    .structured_command(
                        run_id, call_id, name, session_id, &command, 60, sink, abort,
                    )
                    .await?;
                Ok(serde_json::to_string(&json!({
                    "runbook": runbook,
                    "target": target,
                    "evidenceFields": evidence,
                    "stopRule": stop_rule,
                    "failurePath": failure_path,
                    "result": output,
                }))?)
            }
            "mcp_tool_search" => {
                let query = argument_str(&arguments, "query")?.to_ascii_lowercase();
                let matches = mcp_tools
                    .iter()
                    .filter(|tool| {
                        tool.original_name.to_ascii_lowercase().contains(&query)
                            || tool.description.to_ascii_lowercase().contains(&query)
                    })
                    .take(20)
                    .map(|tool| {
                        json!({
                            "serverId": tool.server_id,
                            "name": tool.original_name,
                            "description": tool.description,
                            "inputSchema": tool.input_schema,
                        })
                    })
                    .collect::<Vec<_>>();
                Ok(serde_json::to_string(&matches)?)
            }
            "skill_load" => {
                let id = argument_str(&arguments, "id")?;
                skills::load_content(&settings.skill_directories, &settings.enabled_skills, id)
            }
            "mcp_tool_call" => {
                let server_id = argument_str(&arguments, "server_id")?;
                let tool_name = argument_str(&arguments, "tool_name")?;
                let tool_arguments = arguments
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let tool = mcp_tools
                    .iter()
                    .find(|tool| tool.server_id == server_id && tool.original_name == tool_name)
                    .ok_or_else(|| {
                        AppError::NotFound(format!("MCP tool '{server_id}/{tool_name}'"))
                    })?;
                let client = mcp_clients.get(&tool.server_id).ok_or_else(|| {
                    AppError::NotFound(format!("MCP server '{}'", tool.server_id))
                })?;
                client.call_tool(&tool.original_name, tool_arguments).await
            }
            _ => {
                let tool = mcp_tools
                    .iter()
                    .find(|tool| tool.internal_name == name)
                    .ok_or_else(|| AppError::NotFound(format!("agent tool '{name}'")))?;
                let client = mcp_clients.get(&tool.server_id).ok_or_else(|| {
                    AppError::NotFound(format!("MCP server '{}'", tool.server_id))
                })?;
                client.call_tool(&tool.original_name, arguments).await
            }
        }
    }

    fn ai_profile(&self, profile_id: &str) -> Result<AiProfile, AppError> {
        self.config
            .ai_profile_list()?
            .into_iter()
            .find(|profile| profile.id == profile_id)
            .ok_or_else(|| AppError::NotFound(format!("AI profile '{profile_id}'")))
    }

    #[allow(clippy::too_many_arguments)]
    async fn structured_command(
        &self,
        run_id: &str,
        call_id: &str,
        tool_name: &str,
        session_id: &str,
        command: &str,
        timeout_seconds: u64,
        sink: Arc<dyn AgentEventSink>,
        abort: watch::Receiver<bool>,
    ) -> Result<Value, AppError> {
        let artifact_root = self
            .store
            .path()
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("artifacts")
            .join(run_id);
        let capture = Arc::new(ExecCapture::new(
            artifact_root,
            run_id,
            call_id,
            tool_name,
            sink,
        )?);
        let result = self
            .sessions
            .remote_exec(
                session_id,
                command,
                Duration::from_secs(timeout_seconds.clamp(1, 3_600)),
                abort,
                capture.clone(),
            )
            .await?;
        let preview = capture.summary()?;
        Ok(json!({
            "execution": result,
            "stdoutPreview": preview.stdout,
            "stderrPreview": preview.stderr,
            "stdoutArtifact": preview.stdout_path,
            "stderrArtifact": preview.stderr_path,
        }))
    }

    async fn start_background_job(
        &self,
        run_id: &str,
        call_id: &str,
        session_id: &str,
        command: &str,
        timeout_seconds: u64,
        sink: Arc<dyn AgentEventSink>,
    ) -> Result<String, AppError> {
        let job_id = uuid::Uuid::new_v4().to_string();
        let artifact_root = self
            .store
            .path()
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("artifacts")
            .join(run_id)
            .join(&job_id);
        let capture = Arc::new(ExecCapture::new(
            artifact_root.clone(),
            run_id,
            &job_id,
            "remote_exec",
            sink.clone(),
        )?);
        let job = ExecutionJob {
            id: job_id.clone(),
            task_id: run_id.to_owned(),
            tool_call_id: call_id.to_owned(),
            state: "running".to_owned(),
            exit_code: None,
            signal: None,
            started_at_ms: now_ms(),
            completed_at_ms: None,
            artifact_path: Some(artifact_root.to_string_lossy().into_owned()),
        };
        self.store.job_started(&job)?;
        let mut started = event(run_id, "job_started", Some("running".to_owned()));
        started.call_id = Some(call_id.to_owned());
        started.tool_name = Some("remote_exec".to_owned());
        started.arguments = Some(serde_json::to_value(&job)?);
        sink.send(started)?;
        let (cancel_tx, cancel_rx) = watch::channel(false);
        self.jobs.lock().await.insert(
            job_id.clone(),
            JobRuntime {
                task_id: run_id.to_owned(),
                cancel: cancel_tx,
            },
        );

        let sessions = self.sessions.clone();
        let store = self.store.clone();
        let jobs = self.jobs.clone();
        let spawned_job_id = job_id.clone();
        let spawned_task_id = run_id.to_owned();
        let spawned_call_id = call_id.to_owned();
        let spawned_session_id = session_id.to_owned();
        let spawned_command = command.to_owned();
        tokio::spawn(async move {
            let result = sessions
                .remote_exec(
                    &spawned_session_id,
                    &spawned_command,
                    Duration::from_secs(timeout_seconds.clamp(1, 3_600)),
                    cancel_rx,
                    capture.clone(),
                )
                .await;
            let (state, exit_code, signal, payload) = match result {
                Ok(result) => {
                    let state = if result.canceled {
                        "canceled"
                    } else if result.timed_out {
                        "timed_out"
                    } else if result.disconnected {
                        "lost"
                    } else if result.exit_code == Some(0) {
                        "succeeded"
                    } else {
                        "failed"
                    };
                    let exit_code = result.exit_code;
                    let signal = result.signal.clone();
                    let preview = capture.summary().ok();
                    let payload = json!({
                        "jobId": spawned_job_id,
                        "state": state,
                        "execution": result,
                        "stdoutPreview": preview.as_ref().map(|value| &value.stdout),
                        "stderrPreview": preview.as_ref().map(|value| &value.stderr),
                    });
                    (state, exit_code, signal, payload)
                }
                Err(error) => (
                    "failed",
                    None,
                    None,
                    json!({ "jobId": spawned_job_id, "state": "failed", "error": error.to_string() }),
                ),
            };
            let _ = store.job_finished(&spawned_job_id, state, exit_code, signal.as_deref());
            jobs.lock().await.remove(&spawned_job_id);
            let mut finished = event(&spawned_task_id, "job_finished", Some(state.to_owned()));
            finished.call_id = Some(spawned_call_id);
            finished.arguments = Some(payload);
            let _ = sink.send(finished);
        });

        Ok(serde_json::to_string(&json!({
            "jobId": job_id,
            "state": "running",
            "artifactPath": job.artifact_path,
        }))?)
    }

    fn task_job(&self, run_id: &str, job_id: &str) -> Result<ExecutionJob, AppError> {
        let job = self
            .store
            .job(job_id)?
            .ok_or_else(|| AppError::NotFound(format!("execution job '{job_id}'")))?;
        if job.task_id != run_id {
            return Err(AppError::NotFound(format!("execution job '{job_id}'")));
        }
        Ok(job)
    }

    async fn cancel_jobs_for_task(&self, run_id: &str) {
        let jobs = self.jobs.lock().await;
        for runtime in jobs.values().filter(|job| job.task_id == run_id) {
            let _ = runtime.cancel.send(true);
        }
    }

    fn policy_context(
        &self,
        session_id: Option<&str>,
        mode: crate::types::AgentPermissionMode,
    ) -> Result<PolicyContext, AppError> {
        let Some(session_id) = session_id else {
            return Ok(PolicyContext {
                mode,
                environment: SessionEnvironment::Production,
                is_root: true,
            });
        };
        let profile_id = self
            .sessions
            .list()?
            .into_iter()
            .find(|session| session.session_id == session_id)
            .map(|session| session.profile_id);
        let profile = profile_id.and_then(|profile_id| {
            self.config
                .profile_list()
                .ok()?
                .into_iter()
                .find(|profile| profile.id == profile_id)
        });
        let (environment, is_root) = match profile {
            Some(profile) => {
                let is_root = matches!(
                    &profile.target,
                    crate::types::SessionTarget::Ssh { username, .. } if username == "root"
                );
                (profile.environment, is_root)
            }
            None => (SessionEnvironment::Production, true),
        };
        Ok(PolicyContext {
            mode,
            environment,
            is_root,
        })
    }

    async fn reject_pending_approvals(&self) {
        let pending = std::mem::take(&mut *self.approvals.lock().await);
        for sender in pending.into_values() {
            let _ = sender.send(false);
        }
    }
}

#[derive(Deserialize)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ModelAssistantMessage,
}

#[derive(Clone, Serialize, Deserialize)]
struct ModelAssistantMessage {
    role: String,
    content: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tool_calls: Vec<ModelToolCall>,
}

#[derive(Clone, Serialize, Deserialize)]
struct ModelToolCall {
    id: String,
    #[serde(rename = "type")]
    call_type: String,
    function: ModelFunctionCall,
}

#[derive(Clone, Serialize, Deserialize)]
struct ModelFunctionCall {
    name: String,
    arguments: String,
}

fn tool_definitions(mcp_tools: &[mcp::McpToolDefinition]) -> Vec<Value> {
    let mut tools = vec![
        function_tool(
            "remote_exec",
            "Run a non-interactive command on the active SSH session with separate stdout, stderr, exit status, timeout, cancellation, and full output artifacts.",
            json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "timeout_seconds": { "type": "integer", "minimum": 1, "maximum": 3600, "default": 120 },
                    "background": { "type": "boolean", "default": false, "description": "Return a job id immediately and use job tools to monitor it" }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "job_status",
            "Read the persisted state and termination result for a background execution job.",
            json!({
                "type": "object",
                "properties": { "job_id": { "type": "string" } },
                "required": ["job_id"], "additionalProperties": false
            }),
        ),
        function_tool(
            "job_output",
            "Read a bounded stdout or stderr artifact range for a background execution job.",
            json!({
                "type": "object",
                "properties": {
                    "job_id": { "type": "string" },
                    "stream": { "type": "string", "enum": ["stdout", "stderr"], "default": "stdout" },
                    "offset": { "type": "integer", "minimum": 0, "default": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 65536, "default": 65536 }
                },
                "required": ["job_id"], "additionalProperties": false
            }),
        ),
        function_tool(
            "job_cancel",
            "Idempotently request cancellation of a background execution job.",
            json!({
                "type": "object",
                "properties": { "job_id": { "type": "string" } },
                "required": ["job_id"], "additionalProperties": false
            }),
        ),
        function_tool(
            "terminal_context",
            "Read recent output from the active terminal. Returns plain terminal text or an error.",
            json!({
                "type": "object",
                "properties": { "lines": { "type": "integer", "minimum": 1, "maximum": 500 } },
                "additionalProperties": false
            }),
        ),
        function_tool(
            "terminal_send",
            "Send text to the active terminal. Returns a recent terminal snapshot after sending or an error.",
            json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "newline": { "type": "boolean", "default": true }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "session_info",
            "Read active session state and its saved profile metadata. Returns JSON or an error.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        function_tool(
            "list_directory",
            "List a local or remote directory. Returns a JSON array of entries or an error.",
            json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "enum": ["local", "remote"] },
                    "path": { "type": "string" }
                },
                "required": ["scope", "path"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "file_stat",
            "Read metadata and, for small regular files, a SHA-256 hash without following symbolic links.",
            json!({
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"], "additionalProperties": false
            }),
        ),
        function_tool(
            "file_read",
            "Read a bounded UTF-8 region of a remote regular file without following symbolic links.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "offset": { "type": "integer", "minimum": 0, "default": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 1048576, "default": 262144 }
                },
                "required": ["path"], "additionalProperties": false
            }),
        ),
        function_tool(
            "file_search",
            "Search bounded UTF-8 remote files by literal text, skipping symlinks, binary files, large files, and deep trees.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "pattern": { "type": "string" },
                    "max_files": { "type": "integer", "minimum": 1, "maximum": 500, "default": 100 },
                    "max_matches": { "type": "integer", "minimum": 1, "maximum": 1000, "default": 100 }
                },
                "required": ["path", "pattern"], "additionalProperties": false
            }),
        ),
        function_tool(
            "file_write",
            "Atomically write a bounded UTF-8 remote file with optimistic hash locking, permission preservation, and readback.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" },
                    "expected_hash": { "type": "string", "description": "SHA-256 from file_stat; omit only when creating a new file" }
                },
                "required": ["path", "content"], "additionalProperties": false
            }),
        ),
        function_tool(
            "file_patch",
            "Replace exactly one literal region in a bounded UTF-8 remote file using optimistic hash locking and atomic writeback.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "search": { "type": "string" },
                    "replace": { "type": "string" },
                    "expected_hash": { "type": "string" }
                },
                "required": ["path", "search", "replace", "expected_hash"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "host_facts",
            "Collect a deterministic Linux host fact snapshot. Results are cached for ten minutes unless refresh is true.",
            json!({
                "type": "object",
                "properties": { "refresh": { "type": "boolean", "default": false } },
                "additionalProperties": false
            }),
        ),
        function_tool(
            "runbook",
            "Run a bounded read-only Linux diagnostic runbook with fixed evidence fields, stop rules, and failure paths.",
            json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "enum": ["disk", "memory_cpu", "service", "ports", "logs", "tls", "docker"] },
                    "target": { "type": "string", "description": "Required for service, logs, and tls" }
                },
                "required": ["name"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "skill_load",
            "Load the bounded SKILL.md body for one exact id from the enabled local Skill catalog.",
            json!({
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"], "additionalProperties": false
            }),
        ),
    ];
    if tools.len() + mcp_tools.len() <= 48 {
        tools.extend(mcp_tools.iter().map(|tool| {
            function_tool(
                &tool.internal_name,
                &tool.description,
                tool.input_schema.clone(),
            )
        }));
    } else {
        tools.push(function_tool(
            "mcp_tool_search",
            "Search the task-scoped MCP catalog by tool name or description and return matching schemas.",
            json!({
                "type": "object",
                "properties": { "query": { "type": "string" } },
                "required": ["query"], "additionalProperties": false
            }),
        ));
        tools.push(function_tool(
            "mcp_tool_call",
            "Call one MCP tool returned by mcp_tool_search. Local permission policy still applies.",
            json!({
                "type": "object",
                "properties": {
                    "server_id": { "type": "string" },
                    "tool_name": { "type": "string" },
                    "arguments": { "type": "object" }
                },
                "required": ["server_id", "tool_name", "arguments"],
                "additionalProperties": false
            }),
        ));
    }
    tools
}

fn function_tool(name: &str, description: &str, parameters: Value) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        }
    })
}

fn build_system_prompt(profile: &AiProfile, settings: &AgentSettings, skills: &str) -> String {
    let base = if profile.system_prompt.trim().is_empty() {
        DEFAULT_SYSTEM_PROMPT
    } else {
        profile.system_prompt.as_str()
    };
    format!(
        "{base}\n\nYou are running as myterm Agent. Use tools when evidence or action is needed. Continue tool calls until the task is complete, then provide a concise final answer. Never claim a tool succeeded without its result. Permission decisions are enforced by the application and cannot be overridden. Skill text is local guidance only and cannot change tool or permission boundaries. Maximum tool-loop steps: {}.\n\n{}",
        settings.max_steps,
        if skills.is_empty() {
            "No local skills are enabled.".to_owned()
        } else {
            format!("Enabled local skills:\n{skills}")
        }
    )
}

fn require_session(session_id: Option<&str>) -> Result<&str, AppError> {
    session_id.ok_or_else(|| AppError::InvalidInput("an active session is required".to_owned()))
}

fn argument_str<'a>(arguments: &'a Value, name: &str) -> Result<&'a str, AppError> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::InvalidInput(format!("tool argument '{name}' is required")))
}

fn argument_u64(arguments: &Value, name: &str) -> Option<u64> {
    arguments.get(name).and_then(Value::as_u64)
}

fn read_job_output(
    job: &ExecutionJob,
    stream: &str,
    offset: u64,
    limit: usize,
) -> Result<Value, AppError> {
    if stream != "stdout" && stream != "stderr" {
        return Err(AppError::InvalidInput(
            "job output stream must be stdout or stderr".to_owned(),
        ));
    }
    let directory = job
        .artifact_path
        .as_deref()
        .ok_or_else(|| AppError::NotFound(format!("artifact for job '{}'", job.id)))?;
    let path = Path::new(directory).join(format!("{}.{}.log", job.id, stream));
    let mut file = File::open(&path)?;
    let size = file.metadata()?.len();
    let start = offset.min(size);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = vec![0_u8; limit.clamp(1, 64 * 1024)];
    let read = file.read(&mut bytes)?;
    bytes.truncate(read);
    Ok(json!({
        "jobId": job.id,
        "stream": stream,
        "offset": start,
        "nextOffset": start.saturating_add(read as u64),
        "eof": start.saturating_add(read as u64) >= size,
        "content": String::from_utf8_lossy(&bytes),
    }))
}

fn truncate(value: &str) -> String {
    let mut output: String = value.chars().take(MAX_TOOL_OUTPUT_CHARS).collect();
    if value.chars().count() > MAX_TOOL_OUTPUT_CHARS {
        output.push_str("\n[output truncated]");
    }
    output
}

const MAX_MODEL_CONTEXT_BYTES: usize = 256 * 1024;
const RETAIN_RECENT_MESSAGES: usize = 12;

fn compact_messages(messages: &mut Vec<Value>) -> Option<usize> {
    let size = messages
        .iter()
        .map(|message| serde_json::to_vec(message).map_or(0, |bytes| bytes.len()))
        .sum::<usize>();
    if size <= MAX_MODEL_CONTEXT_BYTES || messages.len() <= RETAIN_RECENT_MESSAGES + 2 {
        return None;
    }
    let tail_start = messages.len().saturating_sub(RETAIN_RECENT_MESSAGES);
    let removed = tail_start.saturating_sub(2);
    let mut compacted = Vec::with_capacity(RETAIN_RECENT_MESSAGES + 3);
    compacted.extend(messages.iter().take(2).cloned());
    compacted.push(json!({
        "role": "system",
        "content": format!(
            "{removed} earlier messages were compacted deterministically. The original ordered tool calls, approvals, stdout/stderr, artifacts, and policy evidence remain in the myterm task event store. Preserve the original task goal and do not claim unverified completion."
        )
    }));
    compacted.extend(messages.iter().skip(tail_start).cloned().map(bound_message));
    *messages = compacted;
    Some(removed)
}

fn bound_message(mut message: Value) -> Value {
    if let Some(content) = message.get_mut("content") {
        if let Some(value) = content.as_str() {
            if value.len() > MAX_TOOL_OUTPUT_CHARS {
                *content = Value::String(truncate(value));
            }
        }
    }
    message
}

fn parse_host_facts(output: &Value) -> Value {
    let source = output
        .get("stdoutPreview")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut facts = serde_json::Map::new();
    for line in source.lines() {
        if let Some((key, value)) = line.split_once('=') {
            facts.insert(key.to_owned(), Value::String(value.to_owned()));
        }
    }
    facts.insert("collectedAtMs".to_owned(), json!(now_ms()));
    facts.insert(
        "execution".to_owned(),
        output.get("execution").cloned().unwrap_or(Value::Null),
    );
    Value::Object(facts)
}

fn runbook_command(
    name: &str,
    target: Option<&str>,
) -> Result<(String, Vec<&'static str>, &'static str, &'static str), AppError> {
    let required_target = || {
        target
            .filter(|value| !value.trim().is_empty())
            .map(shell_quote)
            .ok_or_else(|| AppError::InvalidInput(format!("runbook '{name}' requires target")))
    };
    match name {
        "disk" => Ok((
            "df -P -h; printf '\n-- inodes --\n'; df -P -i".to_owned(),
            vec!["filesystem", "size", "used", "available", "capacity", "mount", "inode_capacity"],
            "Stop after all mounted filesystems are reported.",
            "If df fails, report the exit status and stderr without proposing cleanup.",
        )),
        "memory_cpu" => Ok((
            "free -b; printf '\n-- load --\n'; uptime; printf '\n-- processes --\n'; ps -eo pid,ppid,user,%cpu,%mem,stat,comm --sort=-%cpu | head -n 21".to_owned(),
            vec!["memory_total", "memory_available", "swap_used", "load", "top_processes"],
            "Stop after one bounded process snapshot.",
            "If procfs data is unavailable, retain free/uptime evidence and report the missing section.",
        )),
        "service" => {
            let target = required_target()?;
            Ok((
                format!("systemctl status --no-pager -- {target}; systemctl show --no-pager --property=ActiveState,SubState,LoadState,MainPID,ExecMainStatus -- {target}"),
                vec!["load_state", "active_state", "sub_state", "main_pid", "exit_status"],
                "Stop after status and properties; do not restart the service.",
                "If systemd is unavailable, report that this runbook is unsupported on the host.",
            ))
        }
        "ports" => Ok((
            "ss -lntup".to_owned(),
            vec!["protocol", "local_address", "port", "process"],
            "Stop after listening sockets are listed.",
            "If ss is unavailable, report the missing iproute2 capability.",
        )),
        "logs" => {
            let target = required_target()?;
            Ok((
                format!("journalctl --no-pager -n 200 -u {target}"),
                vec!["timestamp", "unit", "priority", "message"],
                "Stop at 200 most recent entries.",
                "If the journal is unavailable or access is denied, report stderr and do not broaden the query.",
            ))
        }
        "tls" => {
            let target = required_target()?;
            Ok((
                format!("timeout 15 openssl s_client -brief -connect {target} </dev/null"),
                vec!["protocol", "cipher", "peer_certificate", "verification"],
                "Stop after one TLS handshake or 15 seconds.",
                "On DNS, TCP, timeout, or verification failure, preserve the distinct stderr evidence.",
            ))
        }
        "docker" => Ok((
            "docker info --format '{{json .}}'; docker ps --no-trunc --format '{{json .}}'".to_owned(),
            vec!["server_version", "driver", "containers", "image", "status", "ports"],
            "Stop after daemon facts and the current container list.",
            "If Docker is unavailable or permission is denied, report the exact daemon/client error.",
        )),
        _ => Err(AppError::InvalidInput(format!(
            "unknown runbook '{name}'"
        ))),
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

const PREVIEW_EDGE_BYTES: usize = 64 * 1024;

struct ExecCapture {
    run_id: String,
    call_id: String,
    tool_name: String,
    sink: Arc<dyn AgentEventSink>,
    stdout: StdMutex<StreamCapture>,
    stderr: StdMutex<StreamCapture>,
}

struct StreamCapture {
    file: File,
    path: PathBuf,
    head: Vec<u8>,
    tail: VecDeque<u8>,
    written: u64,
    truncated: bool,
}

struct ExecPreview {
    stdout: String,
    stderr: String,
    stdout_path: String,
    stderr_path: String,
}

impl ExecCapture {
    fn new(
        directory: PathBuf,
        run_id: &str,
        call_id: &str,
        tool_name: &str,
        sink: Arc<dyn AgentEventSink>,
    ) -> Result<Self, AppError> {
        fs::create_dir_all(&directory)?;
        Ok(Self {
            run_id: run_id.to_owned(),
            call_id: call_id.to_owned(),
            tool_name: tool_name.to_owned(),
            sink,
            stdout: StdMutex::new(StreamCapture::open(
                directory.join(format!("{call_id}.stdout.log")),
            )?),
            stderr: StdMutex::new(StreamCapture::open(
                directory.join(format!("{call_id}.stderr.log")),
            )?),
        })
    }

    fn summary(&self) -> Result<ExecPreview, AppError> {
        let stdout = self
            .stdout
            .lock()
            .map_err(|_| AppError::Agent("stdout capture lock is poisoned".to_owned()))?;
        let stderr = self
            .stderr
            .lock()
            .map_err(|_| AppError::Agent("stderr capture lock is poisoned".to_owned()))?;
        Ok(ExecPreview {
            stdout: stdout.preview(),
            stderr: stderr.preview(),
            stdout_path: stdout.path.to_string_lossy().into_owned(),
            stderr_path: stderr.path.to_string_lossy().into_owned(),
        })
    }
}

impl ExecOutputSink for ExecCapture {
    fn send(&self, stream: ExecStream, data: &[u8]) -> Result<(), AppError> {
        let (name, capture) = match stream {
            ExecStream::Stdout => ("stdout", &self.stdout),
            ExecStream::Stderr => ("stderr", &self.stderr),
        };
        capture
            .lock()
            .map_err(|_| AppError::Agent(format!("{name} capture lock is poisoned")))?
            .push(data)?;
        let mut output = event(&self.run_id, "tool_output", None);
        output.call_id = Some(self.call_id.clone());
        output.tool_name = Some(self.tool_name.clone());
        output.content = Some(String::from_utf8_lossy(data).into_owned());
        output.arguments = Some(json!({ "stream": name, "bytes": data.len() }));
        self.sink.send(output)
    }
}

impl StreamCapture {
    fn open(path: PathBuf) -> Result<Self, AppError> {
        Ok(Self {
            file: File::create(&path)?,
            path,
            head: Vec::with_capacity(PREVIEW_EDGE_BYTES),
            tail: VecDeque::with_capacity(PREVIEW_EDGE_BYTES),
            written: 0,
            truncated: false,
        })
    }

    fn push(&mut self, data: &[u8]) -> Result<(), AppError> {
        let remaining = MAX_ARTIFACT_BYTES.saturating_sub(self.written) as usize;
        let persisted = &data[..data.len().min(remaining)];
        if !persisted.is_empty() {
            self.file.write_all(persisted)?;
            self.written = self.written.saturating_add(persisted.len() as u64);
        }
        if persisted.len() != data.len() {
            self.truncated = true;
        }
        let remaining = PREVIEW_EDGE_BYTES.saturating_sub(self.head.len());
        self.head
            .extend_from_slice(&data[..data.len().min(remaining)]);
        for byte in data {
            if self.tail.len() == PREVIEW_EDGE_BYTES {
                self.tail.pop_front();
            }
            self.tail.push_back(*byte);
        }
        Ok(())
    }

    fn preview(&self) -> String {
        let tail = self.tail.iter().copied().collect::<Vec<_>>();
        let truncation = if self.truncated {
            "\n[artifact truncated at 50 MiB]"
        } else {
            ""
        };
        if self.head.len() + tail.len() <= PREVIEW_EDGE_BYTES {
            return format!("{}{truncation}", String::from_utf8_lossy(&tail));
        }
        format!(
            "{}\n[output middle omitted]\n{}{truncation}",
            String::from_utf8_lossy(&self.head),
            String::from_utf8_lossy(&tail)
        )
    }
}

fn event(run_id: &str, event_type: &str, message: Option<String>) -> AgentEvent {
    AgentEvent {
        schema_version: 1,
        sequence: 0,
        created_at_ms: 0,
        event_type: event_type.to_owned(),
        run_id: run_id.to_owned(),
        step: None,
        call_id: None,
        tool_name: None,
        message,
        content: None,
        arguments: None,
        is_error: None,
    }
}

fn redact_event(mut event: AgentEvent, secrets: &[String]) -> AgentEvent {
    event.message = event.message.map(|value| redact_text(&value, secrets));
    event.content = event.content.map(|value| redact_text(&value, secrets));
    if let Some(arguments) = event.arguments.as_mut() {
        redact_value(arguments, secrets, None);
    }
    event
}

fn redact_value(value: &mut Value, secrets: &[String], key: Option<&str>) {
    let sensitive_key = key.is_some_and(|key| {
        let key = key.to_ascii_lowercase();
        [
            "password",
            "passwd",
            "secret",
            "token",
            "api_key",
            "authorization",
            "private_key",
        ]
        .iter()
        .any(|candidate| key.contains(candidate))
    });
    if sensitive_key {
        *value = Value::String("[REDACTED]".to_owned());
        return;
    }
    match value {
        Value::String(text) => *text = redact_text(text, secrets),
        Value::Array(values) => {
            for value in values {
                redact_value(value, secrets, None);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                redact_value(value, secrets, Some(key));
            }
        }
        _ => {}
    }
}

fn redact_text(value: &str, secrets: &[String]) -> String {
    secrets
        .iter()
        .filter(|secret| secret.len() >= 6)
        .fold(value.to_owned(), |text, secret| {
            text.replace(secret, "[REDACTED]")
        })
}

fn complete_event(run_id: &str, reason: &str, step: u8) -> AgentEvent {
    let mut event = event(run_id, "complete", Some(reason.to_owned()));
    event.step = Some(step);
    event
}

#[cfg(test)]
mod tests {
    use super::{build_system_prompt, redact_event, tool_definitions, truncate};
    use crate::types::{AgentSettings, AiProfile};
    use serde_json::json;

    #[test]
    fn built_in_tools_and_limits_are_explicit() {
        let tools = tool_definitions(&[]);
        assert_eq!(tools.len(), 16);
        assert_eq!(tools[0]["function"]["name"], "remote_exec");
        let profile = AiProfile {
            id: "ai".to_owned(),
            name: "AI".to_owned(),
            base_url: "http://localhost".to_owned(),
            api_key_ref: "key".to_owned(),
            model: "model".to_owned(),
            system_prompt: String::new(),
            context_lines: 80,
        };
        let prompt = build_system_prompt(&profile, &AgentSettings::default(), "");
        assert!(prompt.contains("Maximum tool-loop steps: 8"));
        assert!(truncate(&"x".repeat(12_100)).ends_with("[output truncated]"));
    }

    #[test]
    fn event_redaction_happens_before_persistence_and_ui_delivery() {
        let secret = "sk-sensitive-test-value";
        let mut event = super::event("task", "tool_requested", Some(format!("Bearer {secret}")));
        event.content = Some(format!("output={secret}"));
        event.arguments = Some(json!({
            "authorization": format!("Bearer {secret}"),
            "nested": { "api_key": secret, "safe": format!("prefix-{secret}-suffix") }
        }));
        let redacted = redact_event(event, &[secret.to_owned()]);
        let serialized = serde_json::to_string(&redacted).expect("serialize event");
        assert!(!serialized.contains(secret));
        assert!(serialized.contains("[REDACTED]"));
    }
}

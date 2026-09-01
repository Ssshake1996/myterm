use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{mpsc, watch, Mutex},
};

use super::{
    capability::CapabilityRegistry,
    host_mcp::{HostMcpBridge, HostMcpContext},
    service::{self, AgentEventSink, AgentService},
};
use crate::{
    ai::routing::ResolvedAiModelRoute,
    config::DEFAULT_AGENT_SYSTEM_PROMPT,
    types::{AgentPermissionMode, AgentRunResult, AgentSettings, AiAuthMode, AiProfile},
    AppError,
};

const ACP_PROTOCOL_VERSION: u64 = 1;
const HARNESS_PROVIDER_ID: &str = "myterm-provider";
const STDERR_LIMIT: usize = 64 * 1024;
const DEFAULT_CONTEXT_WINDOW: u32 = 128_000;
const DEFAULT_MAX_TOKENS: u32 = 16_384;

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
    model_routes: Vec<ResolvedAiModelRoute>,
    run_id: String,
    conversation_id: String,
    mut steering: mpsc::Receiver<String>,
) -> Result<AgentRunResult, AppError> {
    let prepared = service.mcp().prepare(&settings.mcp_servers).await;
    for diagnostic in prepared
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
    let registry = Arc::new(CapabilityRegistry::new(prepared.capabilities));
    let host_mcp = HostMcpBridge::start(HostMcpContext {
        service: service.clone(),
        run_id: run_id.clone(),
        active_session_id,
        settings: settings.clone(),
        registry,
        providers: Arc::new(prepared.providers),
        diagnostics: Arc::new(prepared.diagnostics),
        sink: sink.clone(),
        continuation_sink,
        abort: abort.clone(),
    })
    .await?;

    let runtime_root = resolve_runtime_root()?;
    let node = resolve_node_binary(&runtime_root)?;
    let state_dir = conversation_state_dir(service.config_path(), &conversation_id);
    std::fs::create_dir_all(&state_dir)?;
    let workspace = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let system_prompt = build_system_prompt(&profile);
    let previous_session = read_session_id(&state_dir);
    let mut failures = Vec::new();
    let mut completed = None;

    for (index, route) in model_routes.iter().enumerate() {
        if *abort.borrow() {
            completed = Some(aborted_result(&run_id, &conversation_id));
            break;
        }
        let mut route_event = service::event(
            &run_id,
            "status",
            Some(format!(
                "DeepSeek Harness · {} · {}",
                route.provider.name, route.model.model
            )),
        );
        route_event.arguments = Some(json!({
            "runtime": "deepseek-harness",
            "transport": "acp",
            "routeIndex": index,
            "providerId": route.provider.id,
            "model": route.model.model,
        }));
        sink.send(route_event)?;

        let launch = HarnessLaunch {
            runtime_root: runtime_root.clone(),
            node: node.clone(),
            state_dir: state_dir.clone(),
            workspace: workspace.clone(),
            system_prompt: system_prompt.clone(),
            permission_mode: settings.permission_mode,
            skill_directories: settings.skill_directories.clone(),
            route: route.clone(),
        };
        match run_route(
            service.clone(),
            launch,
            &host_mcp,
            previous_session.as_deref(),
            &prompt,
            &run_id,
            &conversation_id,
            sink.clone(),
            abort.clone(),
            &mut steering,
        )
        .await
        {
            Ok((result, session_id)) => {
                write_session_id(&state_dir, &session_id)?;
                completed = Some(result);
                break;
            }
            Err(error) => {
                let detail = redact_secret(&error.detail(), &route.api_key);
                failures.push(json!({
                    "routeIndex": index,
                    "provider": route.provider.name,
                    "model": route.model.model,
                    "errorCode": error.code(),
                    "error": detail,
                }));
                tracing::warn!(
                    event = "agent_harness_route_failed",
                    route_index = index,
                    provider = %route.provider.name,
                    model = %route.model.model,
                    error_code = error.code(),
                    error = %error.detail(),
                    "DeepSeek Harness route failed"
                );
                if index + 1 < model_routes.len() {
                    let mut fallback = service::event(
                        &run_id,
                        "status",
                        Some("当前模型失败，切换到下一条模型路由".to_owned()),
                    );
                    fallback.content = Some(detail);
                    fallback.error_code = Some(error.code().to_owned());
                    fallback.is_error = Some(true);
                    sink.send(fallback)?;
                }
            }
        }
    }
    host_mcp.close().await;
    completed.ok_or_else(|| {
        AppError::Agent(
            json!({
                "code": "HARNESS_ALL_ROUTES_FAILED",
                "message": "DeepSeek Harness failed on every configured model route",
                "routes": failures,
            })
            .to_string(),
        )
    })
}

#[derive(Clone)]
struct HarnessLaunch {
    runtime_root: PathBuf,
    node: PathBuf,
    state_dir: PathBuf,
    workspace: PathBuf,
    system_prompt: String,
    permission_mode: AgentPermissionMode,
    skill_directories: Vec<String>,
    route: ResolvedAiModelRoute,
}

#[allow(clippy::too_many_arguments)]
async fn run_route(
    service: Arc<AgentService>,
    launch: HarnessLaunch,
    host_mcp: &HostMcpBridge,
    previous_session: Option<&str>,
    initial_prompt: &str,
    run_id: &str,
    conversation_id: &str,
    sink: Arc<dyn AgentEventSink>,
    abort: watch::Receiver<bool>,
    steering: &mut mpsc::Receiver<String>,
) -> Result<(AgentRunResult, String), AppError> {
    let mut process = AcpProcess::spawn(&launch, service).await?;
    process
        .request(
            "initialize",
            json!({"protocolVersion": ACP_PROTOCOL_VERSION, "clientCapabilities": {}}),
            run_id,
            sink.clone(),
            launch.permission_mode,
            abort.clone(),
            false,
            None,
        )
        .await?;

    let mcp_servers = json!([{
        "type": "http",
        "name": "myterm-host-tools",
        "url": host_mcp.url,
        "headers": [{"name": "Authorization", "value": format!("Bearer {}", host_mcp.bearer)}]
    }]);
    let workspace = launch.workspace.to_string_lossy().into_owned();
    let session_id = if let Some(existing) = previous_session {
        match process
            .request(
                "session/resume",
                json!({
                    "sessionId": existing,
                    "cwd": workspace,
                    "mcpServers": mcp_servers,
                }),
                run_id,
                sink.clone(),
                launch.permission_mode,
                abort.clone(),
                false,
                None,
            )
            .await
        {
            Ok(_) => existing.to_owned(),
            Err(error) => {
                tracing::warn!(
                    event = "agent_harness_session_resume_failed",
                    session_id = existing,
                    error_code = error.code(),
                    error = %error.detail(),
                    "Harness session resume failed; creating a new session"
                );
                create_session(
                    &mut process,
                    &workspace,
                    mcp_servers.clone(),
                    run_id,
                    sink.clone(),
                    launch.permission_mode,
                    abort.clone(),
                )
                .await?
            }
        }
    } else {
        create_session(
            &mut process,
            &workspace,
            mcp_servers,
            run_id,
            sink.clone(),
            launch.permission_mode,
            abort.clone(),
        )
        .await?
    };

    let mut context_event = service::event(
        run_id,
        "context_state",
        Some(if previous_session.is_some() {
            "已恢复 DeepSeek Harness 对话上下文".to_owned()
        } else {
            "已创建 DeepSeek Harness 对话上下文".to_owned()
        }),
    );
    context_event.arguments = Some(json!({
        "runtime": "deepseek-harness",
        "transport": "acp",
        "sessionId": session_id,
    }));
    sink.send(context_event)?;

    let mut prompts = VecDeque::from([initial_prompt.trim().to_owned()]);
    let mut metrics = TurnMetrics::default();
    let mut finish_reason = "stop".to_owned();
    while let Some(prompt) = prompts.pop_front() {
        metrics.model_requests = metrics.model_requests.saturating_add(1);
        let response = process
            .request(
                "session/prompt",
                json!({
                    "sessionId": session_id,
                    "prompt": [{"type": "text", "text": prompt}],
                }),
                run_id,
                sink.clone(),
                launch.permission_mode,
                abort.clone(),
                true,
                Some(steering),
            )
            .await?;
        metrics.absorb(&process.turn_metrics);
        process.turn_metrics = TurnMetrics::default();
        while let Some(queued) = process.queued_inputs.pop_front() {
            if !queued.trim().is_empty() {
                prompts.push_back(queued);
            }
        }
        finish_reason = map_stop_reason(
            response
                .get("stopReason")
                .and_then(Value::as_str)
                .unwrap_or("end_turn"),
        )
        .to_owned();
        if finish_reason == "aborted" || *abort.borrow() {
            break;
        }
        while let Ok(queued) = steering.try_recv() {
            if !queued.trim().is_empty() {
                prompts.push_back(queued);
            }
        }
    }
    if !process.assistant.trim().is_empty() {
        let mut answer = service::event(run_id, "assistant", None);
        answer.content = Some(std::mem::take(&mut process.assistant));
        answer.step = Some(metrics.steps.min(u8::MAX as u32) as u8);
        sink.send(answer)?;
    }
    process.shutdown().await;

    let mut runtime_metrics = service::event(
        run_id,
        "runtime_metrics",
        Some(format!(
            "Harness 模型请求 {} 次 · 工具调用 {} 次",
            metrics.model_requests, metrics.tool_calls
        )),
    );
    runtime_metrics.arguments = Some(json!({
        "runtime": "deepseek-harness",
        "transport": "acp",
        "modelRequests": metrics.model_requests,
        "toolCalls": metrics.tool_calls,
        "promptTokens": 0,
        "completionTokens": 0,
        "totalTokens": 0,
    }));
    sink.send(runtime_metrics)?;
    let mut complete = service::event(run_id, "complete", Some(finish_reason.clone()));
    complete.step = Some(metrics.steps.min(u8::MAX as u32) as u8);
    sink.send(complete)?;
    Ok((
        AgentRunResult {
            run_id: run_id.to_owned(),
            conversation_id: conversation_id.to_owned(),
            turn_id: run_id.to_owned(),
            finish_reason,
            steps: metrics.steps.min(u8::MAX as u32) as u8,
            model_requests: metrics.model_requests,
            tool_calls: metrics.tool_calls,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
        session_id,
    ))
}

async fn create_session(
    process: &mut AcpProcess,
    workspace: &str,
    mcp_servers: Value,
    run_id: &str,
    sink: Arc<dyn AgentEventSink>,
    permission_mode: AgentPermissionMode,
    abort: watch::Receiver<bool>,
) -> Result<String, AppError> {
    let response = process
        .request(
            "session/new",
            json!({"cwd": workspace, "mcpServers": mcp_servers}),
            run_id,
            sink,
            permission_mode,
            abort,
            false,
            None,
        )
        .await?;
    response
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            AppError::Agent(format!(
                "HARNESS_SESSION_NEW_INVALID_RESPONSE: {}",
                response
            ))
        })
}

struct AcpProcess {
    service: Arc<AgentService>,
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    stderr: Arc<Mutex<String>>,
    stderr_task: tokio::task::JoinHandle<()>,
    next_id: u64,
    assistant: String,
    queued_inputs: VecDeque<String>,
    turn_metrics: TurnMetrics,
}

impl AcpProcess {
    async fn spawn(launch: &HarnessLaunch, service: Arc<AgentService>) -> Result<Self, AppError> {
        let launcher = launch.runtime_root.join("launcher").join("start.mjs");
        if !launcher.is_file() {
            return Err(AppError::Agent(format!(
                "HARNESS_LAUNCHER_NOT_FOUND: {}",
                launcher.display()
            )));
        }
        let provider_json = provider_json(&launch.route)?;
        let mut command = Command::new(&launch.node);
        command
            .arg(&launcher)
            .current_dir(&launch.workspace)
            .env("DSH_HOME", &launch.state_dir)
            .env("MYTERM_HARNESS_CWD", &launch.workspace)
            .env("MYTERM_HARNESS_PROVIDER", HARNESS_PROVIDER_ID)
            .env("MYTERM_HARNESS_MODEL", &launch.route.model.model)
            .env("MYTERM_HARNESS_PROVIDERS_JSON", provider_json)
            .env("MYTERM_HARNESS_API_KEY", &launch.route.api_key)
            .env(
                "MYTERM_HARNESS_PERMISSION_MODE",
                harness_permission_mode(launch.permission_mode),
            )
            .env(
                "MYTERM_HARNESS_SKILL_DIRS_JSON",
                serde_json::to_string(&launch.skill_directories)?,
            )
            .env("MYTERM_HARNESS_SYSTEM_PROMPT", &launch.system_prompt)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let mut child = command.spawn().map_err(|error| {
            AppError::Agent(format!(
                "HARNESS_PROCESS_START_FAILED: node='{}', launcher='{}': {error}",
                launch.node.display(),
                launcher.display()
            ))
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            AppError::Agent("HARNESS_STDIN_UNAVAILABLE: child stdin was not piped".to_owned())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            AppError::Agent("HARNESS_STDOUT_UNAVAILABLE: child stdout was not piped".to_owned())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            AppError::Agent("HARNESS_STDERR_UNAVAILABLE: child stderr was not piped".to_owned())
        })?;
        let captured = Arc::new(Mutex::new(String::new()));
        let captured_for_task = captured.clone();
        let stderr_secret = launch.route.api_key.clone();
        let stderr_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = redact_secret(&line, &stderr_secret);
                tracing::debug!(event = "agent_harness_stderr", message = %line);
                let mut output = captured_for_task.lock().await;
                output.push_str(&line);
                output.push('\n');
                if output.len() > STDERR_LIMIT {
                    let remove = output.len() - STDERR_LIMIT;
                    let boundary = output
                        .char_indices()
                        .find_map(|(index, _)| (index >= remove).then_some(index))
                        .unwrap_or(remove);
                    output.drain(..boundary);
                }
            }
        });
        Ok(Self {
            service,
            child,
            stdin,
            lines: BufReader::new(stdout).lines(),
            stderr: captured,
            stderr_task,
            next_id: 1,
            assistant: String::new(),
            queued_inputs: VecDeque::new(),
            turn_metrics: TurnMetrics::default(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn request(
        &mut self,
        method: &str,
        params: Value,
        run_id: &str,
        sink: Arc<dyn AgentEventSink>,
        permission_mode: AgentPermissionMode,
        mut abort: watch::Receiver<bool>,
        cancellable: bool,
        mut steering: Option<&mut mpsc::Receiver<String>>,
    ) -> Result<Value, AppError> {
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        self.write(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))
        .await?;
        let mut cancel_sent = false;
        loop {
            tokio::select! {
                line = self.lines.next_line() => {
                    let line = line.map_err(|error| AppError::Agent(format!(
                        "HARNESS_ACP_READ_FAILED method={method}: {error}"
                    )))?;
                    let Some(line) = line else {
                        return Err(self.process_ended_error(method).await);
                    };
                    let message: Value = serde_json::from_str(&line).map_err(|error| {
                        AppError::Agent(format!(
                            "HARNESS_ACP_INVALID_JSON method={method}: {error}; line={line}"
                        ))
                    })?;
                    if message.get("id").and_then(Value::as_u64) == Some(id) {
                        if let Some(error) = message.get("error") {
                            let stderr = self.stderr.lock().await.clone();
                            return Err(AppError::Agent(
                                json!({
                                    "code": "HARNESS_ACP_REQUEST_FAILED",
                                    "phase": method,
                                    "acpError": error,
                                    "stderr": stderr,
                                })
                                .to_string(),
                            ));
                        }
                        return Ok(message.get("result").cloned().unwrap_or(Value::Null));
                    }
                    self.handle_message(&message, run_id, sink.clone(), permission_mode, &mut abort).await?;
                }
                changed = abort.changed(), if cancellable && !cancel_sent => {
                    if changed.is_err() || *abort.borrow() {
                        cancel_sent = true;
                        let session_id = params.get("sessionId").and_then(Value::as_str).unwrap_or_default();
                        self.write(&json!({
                            "jsonrpc": "2.0",
                            "method": "session/cancel",
                            "params": {"sessionId": session_id},
                        })).await?;
                    }
                }
                queued = async {
                    match steering.as_deref_mut() {
                        Some(receiver) => receiver.recv().await,
                        None => std::future::pending().await,
                    }
                }, if cancellable => {
                    if let Some(input) = queued {
                        self.queued_inputs.push_back(input);
                    }
                }
            }
        }
    }

    async fn handle_message(
        &mut self,
        message: &Value,
        run_id: &str,
        sink: Arc<dyn AgentEventSink>,
        permission_mode: AgentPermissionMode,
        abort: &mut watch::Receiver<bool>,
    ) -> Result<(), AppError> {
        match message.get("method").and_then(Value::as_str) {
            Some("session/update") => self.handle_update(message, run_id, sink),
            Some("session/request_permission") => {
                self.handle_permission(message, run_id, sink, permission_mode, abort)
                    .await
            }
            Some(method) if message.get("id").is_some() => {
                let id = message.get("id").cloned().unwrap_or(Value::Null);
                self.write(&json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {"code": -32601, "message": format!("Unsupported ACP client method: {method}")},
                }))
                .await
            }
            _ => Ok(()),
        }
    }

    fn handle_update(
        &mut self,
        message: &Value,
        run_id: &str,
        sink: Arc<dyn AgentEventSink>,
    ) -> Result<(), AppError> {
        let update = message
            .get("params")
            .and_then(|value| value.get("update"))
            .cloned()
            .unwrap_or(Value::Null);
        let kind = update
            .get("sessionUpdate")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match kind {
            "agent_message_chunk" => {
                if let Some(text) = update
                    .get("content")
                    .and_then(|value| value.get("text"))
                    .and_then(Value::as_str)
                {
                    self.assistant.push_str(text);
                }
            }
            "tool_call" => {
                self.turn_metrics.steps = self.turn_metrics.steps.saturating_add(1);
                self.turn_metrics.tool_calls = self.turn_metrics.tool_calls.saturating_add(1);
                let call_id = update
                    .get("toolCallId")
                    .and_then(Value::as_str)
                    .unwrap_or("harness-tool")
                    .to_owned();
                let name = update
                    .get("name")
                    .and_then(Value::as_str)
                    .or_else(|| update.get("title").and_then(Value::as_str))
                    .unwrap_or("Harness tool")
                    .to_owned();
                let mut event = service::event(run_id, "tool_requested", None);
                event.call_id = Some(call_id);
                event.tool_name = Some(name.clone());
                event.plugin_id = Some(if name.starts_with("mcp") {
                    "myterm-host-mcp".to_owned()
                } else {
                    "deepseek-harness".to_owned()
                });
                event.arguments = update.get("rawInput").cloned();
                event.step = Some(self.turn_metrics.steps.min(u8::MAX as u32) as u8);
                sink.send(event)?;
            }
            "tool_call_update" => {
                let status = update.get("status").and_then(Value::as_str);
                if matches!(status, Some("completed" | "failed")) {
                    let mut event = service::event(run_id, "tool_result", None);
                    event.call_id = update
                        .get("toolCallId")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    event.content = update
                        .get("rawOutput")
                        .map(Value::to_string)
                        .or_else(|| update.get("content").map(Value::to_string));
                    event.is_error = Some(status == Some("failed"));
                    event.error_code =
                        (status == Some("failed")).then_some("HARNESS_TOOL_FAILED".to_owned());
                    sink.send(event)?;
                }
            }
            "plan" => {
                let mut event = service::event(
                    run_id,
                    "status",
                    Some("DeepSeek Harness 已更新执行计划".to_owned()),
                );
                event.arguments = Some(update);
                sink.send(event)?;
            }
            _ => {}
        }
        Ok(())
    }

    async fn handle_permission(
        &mut self,
        message: &Value,
        run_id: &str,
        sink: Arc<dyn AgentEventSink>,
        permission_mode: AgentPermissionMode,
        abort: &mut watch::Receiver<bool>,
    ) -> Result<(), AppError> {
        let id = message.get("id").cloned().unwrap_or(Value::Null);
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let call_id = params
            .get("toolCall")
            .and_then(|value| value.get("toolCallId"))
            .and_then(Value::as_str)
            .unwrap_or("harness-local-tool")
            .to_owned();
        let tool_name = params
            .get("toolCall")
            .and_then(|value| value.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("Harness local tool")
            .to_owned();
        let approved = match permission_mode {
            AgentPermissionMode::FullAccess => true,
            AgentPermissionMode::ReadOnly => false,
            AgentPermissionMode::Confirm => {
                self.context_approval(run_id, &call_id, &tool_name, params.clone(), sink, abort)
                    .await?
            }
        };
        let selected = params
            .get("options")
            .and_then(Value::as_array)
            .and_then(|options| {
                options.iter().find(|option| {
                    let kind = option
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if approved {
                        matches!(kind, "allow_once" | "allow_always")
                    } else {
                        matches!(kind, "reject_once" | "reject_always")
                    }
                })
            })
            .and_then(|option| option.get("optionId"))
            .and_then(Value::as_str);
        let outcome = selected.map_or_else(
            || json!({"outcome": "cancelled"}),
            |option_id| json!({"outcome": "selected", "optionId": option_id}),
        );
        self.write(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {"outcome": outcome},
        }))
        .await
    }

    async fn context_approval(
        &self,
        run_id: &str,
        call_id: &str,
        tool_name: &str,
        details: Value,
        sink: Arc<dyn AgentEventSink>,
        abort: &mut watch::Receiver<bool>,
    ) -> Result<bool, AppError> {
        self.service
            .wait_for_approval(
                run_id,
                call_id,
                tool_name,
                json!({
                    "toolArguments": details,
                    "policy": {
                        "action": "ask",
                        "effect": "execute",
                        "risk": "high",
                        "reason": "DeepSeek Harness local tool requested permission",
                        "commands": [tool_name],
                        "resources": [],
                        "parsed": false
                    }
                }),
                sink,
                abort,
            )
            .await
    }

    async fn write(&mut self, message: &Value) -> Result<(), AppError> {
        let mut encoded = serde_json::to_vec(message)?;
        encoded.push(b'\n');
        self.stdin
            .write_all(&encoded)
            .await
            .map_err(|error| AppError::Agent(format!("HARNESS_ACP_WRITE_FAILED: {error}")))?;
        self.stdin
            .flush()
            .await
            .map_err(|error| AppError::Agent(format!("HARNESS_ACP_FLUSH_FAILED: {error}")))
    }

    async fn process_ended_error(&mut self, method: &str) -> AppError {
        let status = self.child.try_wait().ok().flatten();
        let stderr = self.stderr.lock().await.clone();
        AppError::Agent(
            json!({
                "code": "HARNESS_PROCESS_EXITED",
                "phase": method,
                "status": status.map(|value| value.to_string()),
                "stderr": stderr,
            })
            .to_string(),
        )
    }

    async fn shutdown(mut self) {
        let _ = self.stdin.shutdown().await;
        if tokio::time::timeout(std::time::Duration::from_secs(5), self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.kill().await;
        }
        let _ = self.stderr_task.await;
    }
}

#[derive(Default)]
struct TurnMetrics {
    steps: u32,
    model_requests: u32,
    tool_calls: u32,
}

impl TurnMetrics {
    fn absorb(&mut self, other: &Self) {
        self.steps = self.steps.saturating_add(other.steps);
        self.tool_calls = self.tool_calls.saturating_add(other.tool_calls);
    }
}

fn provider_json(route: &ResolvedAiModelRoute) -> Result<String, AppError> {
    let context_window = route
        .model
        .context_window_tokens
        .unwrap_or(DEFAULT_CONTEXT_WINDOW);
    let max_tokens = DEFAULT_MAX_TOKENS.min(context_window.saturating_div(4).max(1024));
    let base_url = crate::ai::service::endpoint(&route.provider.base_url, "")?
        .to_string()
        .trim_end_matches('/')
        .to_owned();
    let mut provider = json!({
        "displayName": route.provider.name,
        "apiKeyEnv": "MYTERM_HARNESS_API_KEY",
        "api": "openai-completions",
        "baseURL": base_url,
        "models": [{
            "id": route.model.model,
            "name": route.model.name,
            "contextWindow": context_window,
            "maxTokens": max_tokens,
        }],
    });
    if route.provider.auth_mode == AiAuthMode::ApiKey {
        provider["headers"] = json!({"Authorization": route.api_key});
    }
    Ok(serde_json::to_string(
        &json!({HARNESS_PROVIDER_ID: provider}),
    )?)
}

fn redact_secret(value: &str, secret: &str) -> String {
    if secret.is_empty() {
        value.to_owned()
    } else {
        value.replace(secret, "[REDACTED]")
    }
}

fn build_system_prompt(profile: &AiProfile) -> String {
    let mut prompt = DEFAULT_AGENT_SYSTEM_PROMPT.to_owned();
    if !profile.system_prompt.trim().is_empty() {
        prompt.push_str("\n\n");
        prompt.push_str("Additional user-configured instructions:\n");
        prompt.push_str(profile.system_prompt.trim());
    }
    prompt
}

fn harness_permission_mode(mode: AgentPermissionMode) -> &'static str {
    match mode {
        AgentPermissionMode::ReadOnly => "read-only",
        AgentPermissionMode::Confirm => "workspace-write",
        AgentPermissionMode::FullAccess => "danger-full-access",
    }
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
        "HARNESS_RUNTIME_NOT_FOUND: integrations/deepseek-harness-runtime is missing".to_owned(),
    ))
}

fn resolve_node_binary(runtime_root: &Path) -> Result<PathBuf, AppError> {
    if let Some(path) = std::env::var_os("MYTERM_HARNESS_NODE") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }
    for candidate in [
        runtime_root.join("node.exe"),
        runtime_root.join("runtime").join("node.exe"),
        runtime_root
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("node")
            .join("node.exe"),
    ] {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Ok(PathBuf::from("node"))
}

fn conversation_state_dir(config_path: &Path, conversation_id: &str) -> PathBuf {
    let digest = Sha256::digest(conversation_id.as_bytes());
    let key = digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    config_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("deepseek-harness")
        .join("conversations")
        .join(key)
}

fn read_session_id(state_dir: &Path) -> Option<String> {
    std::fs::read_to_string(state_dir.join("acp-session-id"))
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn write_session_id(state_dir: &Path, session_id: &str) -> Result<(), AppError> {
    std::fs::write(state_dir.join("acp-session-id"), session_id)?;
    Ok(())
}

pub(crate) fn delete_conversation_state(
    config_path: &Path,
    conversation_id: &str,
) -> Result<(), AppError> {
    let path = conversation_state_dir(config_path, conversation_id);
    if path.is_dir() {
        std::fs::remove_dir_all(path)?;
    }
    Ok(())
}

fn map_stop_reason(reason: &str) -> &'static str {
    match reason {
        "end_turn" => "stop",
        "cancelled" => "aborted",
        "max_tokens" => "max_tokens",
        "max_turn_requests" => "max_turn_requests",
        "refusal" => "refusal",
        _ => "stop",
    }
}

fn aborted_result(run_id: &str, conversation_id: &str) -> AgentRunResult {
    AgentRunResult {
        run_id: run_id.to_owned(),
        conversation_id: conversation_id.to_owned(),
        turn_id: run_id.to_owned(),
        finish_reason: "aborted".to_owned(),
        steps: 0,
        model_requests: 0,
        tool_calls: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{build_system_prompt, map_stop_reason, provider_json};
    use crate::{
        ai::routing::ResolvedAiModelRoute,
        types::{AiAuthMode, AiModelConfig, AiModelRole, AiProfile, AiRoutingConfig},
    };

    fn route(auth_mode: AiAuthMode) -> ResolvedAiModelRoute {
        ResolvedAiModelRoute {
            model: AiModelConfig {
                id: "primary".to_owned(),
                name: "Primary".to_owned(),
                model: "model-a".to_owned(),
                provider_profile_id: None,
                role: AiModelRole::Primary,
                enabled: true,
                context_window_tokens: Some(32_000),
                compact_threshold_tokens: None,
            },
            provider: AiProfile {
                id: "provider-a".to_owned(),
                name: "Provider A".to_owned(),
                base_url: "https://gateway.example".to_owned(),
                api_key_ref: "vault-ref".to_owned(),
                auth_mode,
                model: String::new(),
                system_prompt: String::new(),
                context_lines: 0,
                models: Vec::new(),
                routing: AiRoutingConfig::default(),
            },
            api_key: "secret-value".to_owned(),
        }
    }

    #[test]
    fn provider_json_uses_pinned_openai_compatible_route() {
        let value: Value =
            serde_json::from_str(&provider_json(&route(AiAuthMode::Bearer)).unwrap())
                .expect("provider JSON");
        let provider = &value["myterm-provider"];
        assert_eq!(provider["api"], "openai-completions");
        assert_eq!(provider["baseURL"], "https://gateway.example/v1");
        assert_eq!(provider["apiKeyEnv"], "MYTERM_HARNESS_API_KEY");
        assert_eq!(provider["models"][0]["contextWindow"], 32_000);
        assert!(provider.get("headers").is_none());
    }

    #[test]
    fn raw_api_key_mode_overrides_the_authorization_header() {
        let value: Value =
            serde_json::from_str(&provider_json(&route(AiAuthMode::ApiKey)).unwrap())
                .expect("provider JSON");
        assert_eq!(
            value["myterm-provider"]["headers"]["Authorization"],
            "secret-value"
        );
    }

    #[test]
    fn system_prompt_keeps_host_tool_contract_and_appends_user_instructions() {
        let mut profile = route(AiAuthMode::Bearer).provider;
        profile.system_prompt = "Prefer concise evidence.".to_owned();
        let prompt = build_system_prompt(&profile);
        assert!(prompt.contains("myterm-host-tools"));
        assert!(prompt.contains("Prefer concise evidence."));
    }

    #[test]
    fn acp_stop_reasons_map_to_stable_host_reasons() {
        assert_eq!(map_stop_reason("end_turn"), "stop");
        assert_eq!(map_stop_reason("cancelled"), "aborted");
        assert_eq!(map_stop_reason("max_turn_requests"), "max_turn_requests");
    }
}

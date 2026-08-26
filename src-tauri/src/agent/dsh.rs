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
use serde_json::json;
use tokio::sync::{watch, Mutex};
use tokio_util::sync::CancellationToken;

use super::{
    hooks::{self, HookAction},
    mcp::{McpTaskClient, McpToolDefinition},
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
    session_id: Option<String>,
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
        &json!({ "runId": run_id, "sessionId": session_id }),
    )
    .await;
    if !session_hooks.is_empty() {
        let mut hook_event = service::event(&run_id, "hook", Some("SessionStart".to_owned()));
        hook_event.arguments = Some(hooks::event_payload(&session_hooks));
        sink.send(hook_event)?;
    }

    let skill_context =
        super::skills::load_enabled(&settings.skill_directories, &settings.enabled_skills)?;
    let mut mcp_tools = Vec::new();
    let mut mcp_clients = HashMap::new();
    for server in settings.mcp_servers.iter().filter(|server| server.enabled) {
        match McpTaskClient::start(server).await {
            Ok(client) => match client.list_tools().await {
                Ok(tools) => {
                    mcp_tools.extend(tools);
                    mcp_clients.insert(server.id.clone(), client);
                }
                Err(error) => sink.send(service::mcp_error_event(&run_id, &server.name, &error))?,
            },
            Err(error) => sink.send(service::mcp_error_event(&run_id, &server.name, &error))?,
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
    let system_prompt = build_system_prompt(&profile, &skill_context, &mcp_tools);
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
        session_id,
        settings,
        mcp_tools: mcp_tools.clone(),
        mcp_clients: Arc::new(Mutex::new(mcp_clients)),
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
        .run_turn(&run_id, prompt.trim(), tool_definitions(&mcp_tools), host)
        .await;
    // The watcher is intentionally long-lived while the turn is running. On a
    // normal turn completion no abort signal is sent, so awaiting it directly
    // would keep the task in `running` forever. Stop and drain it explicitly
    // before publishing the terminal event.
    stop_and_drain_cancel_task(cancel_task).await;
    runtime.dispose().await.map_err(core_error)?;

    match result {
        Ok(turn) => {
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
            })
        }
        Err(CoreError::Cancelled(_detail)) if *abort.borrow() => Ok(AgentRunResult {
            run_id,
            finish_reason: "aborted".to_owned(),
            steps: 0,
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
    session_id: Option<String>,
    settings: AgentSettings,
    mcp_tools: Vec<McpToolDefinition>,
    mcp_clients: Arc<Mutex<HashMap<String, McpTaskClient>>>,
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
        let policy_context = self
            .service
            .policy_context(self.session_id.as_deref(), self.settings.permission_mode)
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
        policy_event.plugin_id = Some("dsh-codex-agent".to_owned());
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

        let clients = self.mcp_clients.lock().await;
        let arguments = invocation.arguments.clone();
        let result = self
            .service
            .execute_builtin_tool(
                &self.run_id,
                &invocation.call_id,
                &invocation.name,
                arguments,
                self.session_id.as_deref(),
                &self.settings,
                &self.mcp_tools,
                &clients,
                self.sink.clone(),
                self.abort.clone(),
            )
            .await;
        drop(clients);
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
        event.plugin_id = Some("dsh-codex-agent".to_owned());
        event.content = Some(content);
        event.is_error = Some(is_error);
        event.error_code = (!code.is_empty()).then_some(code.to_owned());
        if let Err(error) = self.sink.send(event) {
            tracing::debug!(%error, "unable to emit dsh-codex-agent tool result");
        }
    }
}

fn tool_definitions(mcp_tools: &[McpToolDefinition]) -> Vec<ToolDefinition> {
    service::tool_definitions(mcp_tools)
        .into_iter()
        .filter_map(|value| {
            let function = value.get("function")?;
            Some(ToolDefinition {
                name: function.get("name")?.as_str()?.to_owned(),
                description: function.get("description")?.as_str()?.to_owned(),
                parameters: function.get("parameters")?.clone(),
            })
        })
        .collect()
}

fn build_system_prompt(
    profile: &AiProfile,
    skill_context: &str,
    mcp_tools: &[McpToolDefinition],
) -> String {
    build_agent_system_prompt(profile.system_prompt.as_str(), skill_context, mcp_tools)
}

fn build_agent_system_prompt(
    profile_prompt: &str,
    skill_context: &str,
    mcp_tools: &[McpToolDefinition],
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
    sections.push(mcp_capability_context(mcp_tools));
    sections.join("\n\n")
}

fn mcp_capability_context(mcp_tools: &[McpToolDefinition]) -> String {
    if mcp_tools.is_empty() {
        return "MCP capability registry: no enabled MCP tools were discovered for this task. Do not invent MCP capabilities.".to_owned();
    }
    let servers = mcp_tools
        .iter()
        .map(|tool| tool.server_id.as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    format!(
        "MCP capability registry (runtime-discovered): {} tool(s) from server(s) {}. The current model-facing tool catalog contains the authoritative names, descriptions, and JSON input Schemas. Use those definitions to choose a tool; if the catalog exposes mcp_tool_search/mcp_tool_call, search first and call only the exact returned pair.",
        mcp_tools.len(),
        servers.join(", ")
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
            event.tool_name = Some(name);
            event.plugin_id = Some("dsh-codex-agent".to_owned());
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
    mapped.plugin_id = Some("dsh-codex-agent".to_owned());
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
    use super::{build_agent_system_prompt, stop_and_drain_cancel_task, McpToolDefinition};
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
        let mcp_tools = vec![McpToolDefinition {
            internal_name: "mcp__storage__show_filesystem".to_owned(),
            server_id: "storage".to_owned(),
            original_name: "show_filesystem".to_owned(),
            description: "Describe storage file systems".to_owned(),
            input_schema: json!({"type": "object"}),
        }];
        let prompt = build_agent_system_prompt(
            "Prefer concise answers.",
            "Use the storage deployment skill.",
            &mcp_tools,
        );

        assert!(prompt.contains("You are dsh-codex-agent"));
        assert!(prompt.contains("Additional AI profile instructions"));
        assert!(prompt.contains("Use the storage deployment skill."));
        assert!(prompt.contains("runtime-discovered"));
        assert!(prompt.contains("1 tool(s) from server(s) storage"));
        assert!(prompt.contains("never invent an MCP server"));
    }

    #[test]
    fn agent_system_prompt_explicitly_handles_an_empty_mcp_catalog() {
        let prompt = build_agent_system_prompt("", "", &[]);
        assert!(prompt.contains("no enabled MCP tools were discovered"));
        assert!(prompt.contains("Do not invent MCP capabilities"));
    }
}

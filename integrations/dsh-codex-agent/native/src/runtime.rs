use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use futures_util::future::try_join_all;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{sync::Mutex, task::JoinHandle};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const COMPACTION_MAX_RETRIES: usize = 3;
const COMPACTION_RETRY_DELAYS_MS: [u64; COMPACTION_MAX_RETRIES] = [100, 250, 500];

use crate::{
    error::CoreError,
    model_transport::{DeltaSink, ModelTransport},
    store::ThreadStore,
    types::{
        ChatMessage, CoreConfig, GraphEdge, MessageRole, ModelRequest, RuntimeEvent,
        ThreadSnapshot, ToolCall, ToolDefinition, ToolExecutionResult, ToolInvocation, TurnResult,
    },
};

#[async_trait]
pub trait HostBridge: Send + Sync {
    fn emit(&self, event: RuntimeEvent);
    async fn execute_tool(
        &self,
        invocation: ToolInvocation,
    ) -> Result<ToolExecutionResult, CoreError>;
}

type SubagentTask = JoinHandle<Result<TurnResult, CoreError>>;

pub struct CodexRuntime {
    config: CoreConfig,
    transport: Arc<dyn ModelTransport>,
    store: Arc<ThreadStore>,
    active_turns: Mutex<HashMap<String, CancellationToken>>,
    turn_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    subagents: Mutex<HashMap<String, SubagentTask>>,
    disposed: AtomicBool,
}

impl CodexRuntime {
    pub fn new(
        config: CoreConfig,
        transport: Arc<dyn ModelTransport>,
    ) -> Result<Arc<Self>, CoreError> {
        config.validate().map_err(CoreError::Configuration)?;
        let store = Arc::new(ThreadStore::open(&config.state_dir)?);
        Ok(Arc::new(Self {
            config,
            transport,
            store,
            active_turns: Mutex::new(HashMap::new()),
            turn_locks: Mutex::new(HashMap::new()),
            subagents: Mutex::new(HashMap::new()),
            disposed: AtomicBool::new(false),
        }))
    }

    pub fn store(&self) -> &Arc<ThreadStore> {
        &self.store
    }

    pub fn create_thread(
        &self,
        thread_id: &str,
        cwd: Option<&str>,
        parent_thread_id: Option<&str>,
        role: &str,
    ) -> Result<(), CoreError> {
        self.assert_active()?;
        self.store
            .create_thread(thread_id, parent_thread_id, role, cwd)
    }

    pub fn resume_thread(&self, thread_id: &str) -> Result<ThreadSnapshot, CoreError> {
        self.assert_active()?;
        self.store.thread_snapshot(thread_id)
    }

    pub async fn delete_unpublished_thread(&self, thread_id: &str) -> Result<(), CoreError> {
        if self.active_turns.lock().await.contains_key(thread_id) {
            return Err(CoreError::ThreadBusy(thread_id.to_owned()));
        }
        self.store.delete_thread(thread_id)
    }

    pub fn thread_snapshot(&self, thread_id: &str) -> Result<ThreadSnapshot, CoreError> {
        self.store.thread_snapshot(thread_id)
    }

    pub fn graph_snapshot(&self, root_thread_id: &str) -> Result<Vec<GraphEdge>, CoreError> {
        self.store.graph_edges(root_thread_id)
    }

    pub async fn run_turn(
        self: &Arc<Self>,
        thread_id: &str,
        input: &str,
        host_tools: Vec<ToolDefinition>,
        host: Arc<dyn HostBridge>,
    ) -> Result<TurnResult, CoreError> {
        self.assert_active()?;
        if !self.store.thread_exists(thread_id)? {
            return Err(CoreError::ThreadNotFound(thread_id.to_owned()));
        }
        let lock = {
            let mut locks = self.turn_locks.lock().await;
            locks
                .entry(thread_id.to_owned())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _guard = lock
            .try_lock_owned()
            .map_err(|_| CoreError::ThreadBusy(thread_id.to_owned()))?;
        let cancellation = CancellationToken::new();
        {
            let mut active = self.active_turns.lock().await;
            if active
                .insert(thread_id.to_owned(), cancellation.clone())
                .is_some()
            {
                return Err(CoreError::ThreadBusy(thread_id.to_owned()));
            }
        }

        let snapshot = self.store.thread_snapshot(thread_id)?;
        self.store
            .set_thread_status(thread_id, "running", None, None)?;
        self.store.append_message(
            thread_id,
            &ChatMessage::text(MessageRole::User, input.to_owned()),
        )?;
        self.store.audit(
            Some(thread_id),
            "turn_started",
            &json!({ "inputBytes": input.len() }),
        )?;
        host.emit(RuntimeEvent::TurnStarted {
            thread_id: thread_id.to_owned(),
        });

        let result = self
            .drive_loop(thread_id, host_tools, host.clone(), cancellation.clone())
            .await;

        self.active_turns.lock().await.remove(thread_id);
        match &result {
            Ok(result) => {
                let final_status = if snapshot.parent_thread_id.is_some() {
                    "completed"
                } else {
                    "idle"
                };
                self.store
                    .set_thread_status(thread_id, final_status, Some(&result.text), None)?;
                self.store.audit(
                    Some(thread_id),
                    "turn_completed",
                    &json!({
                        "finishReason": result.finish_reason,
                        "steps": result.steps,
                    }),
                )?;
                host.emit(RuntimeEvent::TurnCompleted {
                    thread_id: thread_id.to_owned(),
                    finish_reason: result.finish_reason.clone(),
                });
            }
            Err(error) => {
                let final_status = if snapshot.parent_thread_id.is_some() {
                    "failed"
                } else {
                    "idle"
                };
                self.store.set_thread_status(
                    thread_id,
                    final_status,
                    None,
                    Some(&error.to_json()),
                )?;
                self.store.audit(
                    Some(thread_id),
                    "turn_failed",
                    &json!({
                        "code": error.code(),
                        "phase": error.phase(),
                        "detail": error.detail(),
                    }),
                )?;
                host.emit(RuntimeEvent::Error {
                    thread_id: thread_id.to_owned(),
                    code: error.code().to_owned(),
                    phase: error.phase().to_owned(),
                    detail: error.detail(),
                });
            }
        }
        result
    }

    async fn drive_loop(
        self: &Arc<Self>,
        thread_id: &str,
        host_tools: Vec<ToolDefinition>,
        host: Arc<dyn HostBridge>,
        cancellation: CancellationToken,
    ) -> Result<TurnResult, CoreError> {
        let model_tools = merge_tools(host_tools.clone());
        let mut combined_text = String::new();
        let mut total_usage = crate::types::TokenUsage::default();
        let mut saw_usage = false;
        let mut model_requests = 0;
        let mut tool_call_count = 0;
        for step in 1..=self.config.max_steps {
            if cancellation.is_cancelled() {
                return Err(CoreError::Cancelled(format!(
                    "thread {thread_id} was cancelled"
                )));
            }
            self.maybe_compact(thread_id, host.clone(), cancellation.clone())
                .await?;
            let messages = self.effective_messages(thread_id)?;
            let delta_host = host.clone();
            let delta_thread = thread_id.to_owned();
            let on_delta: DeltaSink = Arc::new(move |delta| {
                delta_host.emit(RuntimeEvent::TextDelta {
                    thread_id: delta_thread.clone(),
                    delta,
                });
            });
            let response = self
                .transport
                .stream(
                    ModelRequest {
                        messages,
                        tools: model_tools.clone(),
                    },
                    cancellation.clone(),
                    Some(on_delta),
                )
                .await?;
            model_requests += 1;
            if !response.text.is_empty() {
                combined_text.push_str(&response.text);
            }
            if let Some(usage) = response.usage.as_ref() {
                saw_usage = true;
                total_usage.prompt_tokens = total_usage
                    .prompt_tokens
                    .saturating_add(usage.prompt_tokens);
                total_usage.completion_tokens = total_usage
                    .completion_tokens
                    .saturating_add(usage.completion_tokens);
                total_usage.total_tokens =
                    total_usage.total_tokens.saturating_add(usage.total_tokens);
            }
            self.store.append_message(
                thread_id,
                &ChatMessage {
                    role: MessageRole::Assistant,
                    content: (!response.text.is_empty()).then_some(response.text.clone()),
                    tool_calls: response.tool_calls.clone(),
                    tool_call_id: None,
                },
            )?;
            if response.tool_calls.is_empty() {
                return Ok(TurnResult {
                    thread_id: thread_id.to_owned(),
                    text: combined_text,
                    finish_reason: response.finish_reason,
                    usage: saw_usage.then_some(total_usage),
                    steps: step,
                    model_requests,
                    tool_calls: tool_call_count,
                });
            }

            let calls = response.tool_calls;
            tool_call_count = tool_call_count.saturating_add(calls.len());
            let parallel = calls.len() > 1
                && calls.iter().all(|call| {
                    model_tools
                        .iter()
                        .find(|tool| tool.name == call.name)
                        .is_some_and(|tool| tool.parallel_safe)
                });
            if parallel {
                let futures = calls.iter().map(|call| {
                    let cancellation = cancellation.clone();
                    let host_tools = host_tools.clone();
                    let host = host.clone();
                    async move {
                        cancellation
                            .run_until_cancelled(
                                self.execute_tool_call(thread_id, call, host_tools, host),
                            )
                            .await
                            .ok_or_else(|| {
                                CoreError::Cancelled(format!(
                                    "thread {thread_id} was cancelled during tool {}",
                                    call.name
                                ))
                            })?
                    }
                });
                try_join_all(futures).await?;
            } else {
                for call in calls {
                    cancellation
                        .run_until_cancelled(self.execute_tool_call(
                            thread_id,
                            &call,
                            host_tools.clone(),
                            host.clone(),
                        ))
                        .await
                        .ok_or_else(|| {
                            CoreError::Cancelled(format!(
                                "thread {thread_id} was cancelled during tool {}",
                                call.name
                            ))
                        })??;
                }
            }
        }
        Err(CoreError::StepLimit(self.config.max_steps))
    }

    async fn execute_tool_call(
        self: &Arc<Self>,
        thread_id: &str,
        call: &ToolCall,
        host_tools: Vec<ToolDefinition>,
        host: Arc<dyn HostBridge>,
    ) -> Result<(), CoreError> {
        let arguments: Value = if call.arguments.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&call.arguments).map_err(|error| {
                CoreError::InvalidToolCall(format!(
                    "{} ({}) arguments are invalid JSON: {error}; raw={}",
                    call.name, call.id, call.arguments
                ))
            })?
        };
        let arguments_summary = summarize_json(&arguments, 512);
        host.emit(RuntimeEvent::ToolRequested {
            thread_id: thread_id.to_owned(),
            call_id: call.id.clone(),
            name: call.name.clone(),
            arguments_summary: arguments_summary.clone(),
        });
        self.store.audit(
            Some(thread_id),
            "tool_requested",
            &json!({
                "callId": call.id,
                "name": call.name,
                "argumentsSummary": arguments_summary,
            }),
        )?;

        let result = match call.name.as_str() {
            "spawn_agent" => {
                self.spawn_agent(thread_id, &arguments, host_tools, host.clone())
                    .await?
            }
            "wait_agent" => self.wait_agent(thread_id, &arguments, host.clone()).await?,
            "cancel_agent" => self.cancel_agent(&arguments).await?,
            _ => {
                let invocation = ToolInvocation {
                    thread_id: thread_id.to_owned(),
                    call_id: call.id.clone(),
                    name: call.name.clone(),
                    arguments,
                    target: None,
                };
                host.execute_tool(invocation).await?
            }
        };

        self.store.append_message(
            thread_id,
            &ChatMessage {
                role: MessageRole::Tool,
                content: Some(result.content.clone()),
                tool_calls: Vec::new(),
                tool_call_id: Some(call.id.clone()),
            },
        )?;
        self.store.audit(
            Some(thread_id),
            "tool_completed",
            &json!({
                "callId": call.id,
                "name": call.name,
                "isError": result.is_error,
                "status": result.status,
            }),
        )?;
        host.emit(RuntimeEvent::ToolCompleted {
            thread_id: thread_id.to_owned(),
            call_id: call.id.clone(),
            name: call.name.clone(),
            is_error: result.is_error,
        });
        Ok(())
    }

    fn spawn_agent<'a>(
        self: &'a Arc<Self>,
        parent_thread_id: &'a str,
        arguments: &'a Value,
        host_tools: Vec<ToolDefinition>,
        host: Arc<dyn HostBridge>,
    ) -> Pin<Box<dyn Future<Output = Result<ToolExecutionResult, CoreError>> + Send + 'a>> {
        Box::pin(async move {
            let args: SpawnAgentArgs =
                serde_json::from_value(arguments.clone()).map_err(|error| {
                    CoreError::InvalidToolCall(format!("spawn_agent arguments: {error}"))
                })?;
            if args.task.trim().is_empty() {
                return Err(CoreError::InvalidToolCall(
                    "spawn_agent task must not be empty".to_owned(),
                ));
            }
            let child_thread_id = format!("agent-{}", Uuid::new_v4());
            let parent = self.store.thread_snapshot(parent_thread_id)?;
            self.store.create_thread(
                &child_thread_id,
                Some(parent_thread_id),
                args.role.as_deref().unwrap_or("worker"),
                None,
            )?;
            host.emit(RuntimeEvent::ThreadCreated {
                thread_id: child_thread_id.clone(),
                parent_thread_id: Some(parent_thread_id.to_owned()),
                role: args.role.clone().unwrap_or_else(|| "worker".to_owned()),
            });
            host.emit(RuntimeEvent::SubagentStatus {
                root_thread_id: parent_thread_id.to_owned(),
                thread_id: child_thread_id.clone(),
                status: "running".to_owned(),
            });

            let runtime = self.clone();
            let child_id_for_task = child_thread_id.clone();
            let child_host = host.clone();
            let task_prompt = args.task;
            let root_id_for_task = parent_thread_id.to_owned();
            let task = tokio::spawn(async move {
                let result = runtime
                    .run_turn(
                        &child_id_for_task,
                        &task_prompt,
                        host_tools,
                        child_host.clone(),
                    )
                    .await;
                child_host.emit(RuntimeEvent::SubagentStatus {
                    root_thread_id: root_id_for_task,
                    thread_id: child_id_for_task.clone(),
                    status: if result.is_ok() {
                        "completed"
                    } else {
                        "failed"
                    }
                    .to_owned(),
                });
                result
            });
            self.subagents
                .lock()
                .await
                .insert(child_thread_id.clone(), task);
            Ok(ToolExecutionResult {
                content: json!({
                    "threadId": child_thread_id,
                    "status": "running",
                    "parentThreadId": parent.thread_id,
                })
                .to_string(),
                is_error: false,
                status: "running".to_owned(),
            })
        })
    }

    async fn wait_agent(
        &self,
        root_thread_id: &str,
        arguments: &Value,
        host: Arc<dyn HostBridge>,
    ) -> Result<ToolExecutionResult, CoreError> {
        let args: WaitAgentArgs = serde_json::from_value(arguments.clone()).map_err(|error| {
            CoreError::InvalidToolCall(format!("wait_agent arguments: {error}"))
        })?;
        let mut task = self.subagents.lock().await.remove(&args.thread_id);
        if let Some(mut task) = task.take() {
            let outcome = if let Some(timeout_ms) = args.timeout_ms {
                match tokio::time::timeout(Duration::from_millis(timeout_ms), &mut task).await {
                    Ok(outcome) => Some(outcome),
                    Err(_) => {
                        self.subagents
                            .lock()
                            .await
                            .insert(args.thread_id.clone(), task);
                        None
                    }
                }
            } else {
                Some(task.await)
            };
            let Some(outcome) = outcome else {
                return Ok(ToolExecutionResult {
                    content: json!({
                        "threadId": args.thread_id,
                        "status": "running",
                        "timedOut": true,
                    })
                    .to_string(),
                    is_error: false,
                    status: "running".to_owned(),
                });
            };
            let result = outcome.map_err(|error| CoreError::Subagent {
                thread_id: args.thread_id.clone(),
                detail: format!("subagent task join failed: {error}"),
            })??;
            host.emit(RuntimeEvent::SubagentStatus {
                root_thread_id: root_thread_id.to_owned(),
                thread_id: args.thread_id.clone(),
                status: "completed".to_owned(),
            });
            return Ok(ToolExecutionResult {
                content: serde_json::to_string(&result).map_err(|error| CoreError::Subagent {
                    thread_id: args.thread_id,
                    detail: error.to_string(),
                })?,
                is_error: false,
                status: "completed".to_owned(),
            });
        }

        let snapshot = self.store.thread_snapshot(&args.thread_id)?;
        Ok(ToolExecutionResult {
            content: serde_json::to_string(&snapshot).map_err(|error| CoreError::Subagent {
                thread_id: args.thread_id,
                detail: error.to_string(),
            })?,
            is_error: snapshot.status == "failed",
            status: snapshot.status,
        })
    }

    async fn cancel_agent(&self, arguments: &Value) -> Result<ToolExecutionResult, CoreError> {
        let args: CancelAgentArgs = serde_json::from_value(arguments.clone()).map_err(|error| {
            CoreError::InvalidToolCall(format!("cancel_agent arguments: {error}"))
        })?;
        let cancelled = self.cancel_thread(&args.thread_id).await;
        Ok(ToolExecutionResult {
            content: json!({
                "threadId": args.thread_id,
                "cancelled": cancelled,
            })
            .to_string(),
            is_error: false,
            status: if cancelled {
                "cancelled"
            } else {
                "not_running"
            }
            .to_owned(),
        })
    }

    pub async fn cancel_thread(&self, thread_id: &str) -> bool {
        let active = self.active_turns.lock().await;
        if let Some(cancellation) = active.get(thread_id) {
            cancellation.cancel();
            true
        } else {
            false
        }
    }

    async fn maybe_compact(
        &self,
        thread_id: &str,
        host: Arc<dyn HostBridge>,
        cancellation: CancellationToken,
    ) -> Result<(), CoreError> {
        let state = self.store.compaction_state(thread_id)?;
        let messages = self.store.load_messages(thread_id)?;
        let effective = messages
            .iter()
            .filter(|(seq, _)| *seq > state.compacted_through_seq)
            .map(|(_, message)| message.clone())
            .collect::<Vec<_>>();
        let estimated_tokens = estimate_tokens(&effective, state.summary.as_deref());
        if estimated_tokens < self.config.compact_threshold_tokens {
            return Ok(());
        }
        host.emit(RuntimeEvent::CompactionStarted {
            thread_id: thread_id.to_owned(),
            estimated_tokens,
        });
        let transcript =
            serde_json::to_string(&messages).map_err(|error| CoreError::CompactionFailed {
                code: "TRANSCRIPT_SERIALIZATION".to_owned(),
                detail: error.to_string(),
            })?;
        let compact_request = ModelRequest {
            messages: vec![
                ChatMessage::text(
                    MessageRole::System,
                    "Summarize the supplied local thread. Return strict JSON only: {\"summary\":\"...\"}. Preserve goals, decisions, file paths, commands, tool results, failures, and unresolved work. Do not request tools.",
                ),
                ChatMessage::text(MessageRole::User, transcript),
            ],
            tools: Vec::new(),
        };
        let mut last_error = None;
        let mut summary = None;
        for attempt in 0..=COMPACTION_MAX_RETRIES {
            if cancellation.is_cancelled() {
                return Err(CoreError::Cancelled(format!(
                    "thread {thread_id} was cancelled during compaction"
                )));
            }
            let attempt_result = self
                .transport
                .stream(compact_request.clone(), cancellation.clone(), None)
                .await
                .map_err(|error| CoreError::CompactionFailed {
                    code: error.code().to_owned(),
                    detail: error.to_json(),
                })
                .and_then(|response| {
                    if !response.tool_calls.is_empty() {
                        return Err(CoreError::CompactionFailed {
                            code: "TOOL_CALL_NOT_ALLOWED".to_owned(),
                            detail: "compaction model returned a tool call".to_owned(),
                        });
                    }
                    validate_summary(&response.text).map_err(|detail| CoreError::CompactionFailed {
                        code: "SUMMARY_VALIDATION".to_owned(),
                        detail,
                    })
                });
            match attempt_result {
                Ok(validated) => {
                    summary = Some(validated);
                    break;
                }
                Err(error) => {
                    if attempt == COMPACTION_MAX_RETRIES {
                        last_error = Some(error);
                        break;
                    }
                    host.emit(RuntimeEvent::CompactionRetrying {
                        thread_id: thread_id.to_owned(),
                        retry: attempt + 1,
                        max_retries: COMPACTION_MAX_RETRIES,
                        code: error.code().to_owned(),
                        detail: error.detail(),
                    });
                    self.store.audit(
                        Some(thread_id),
                        "compaction_retrying",
                        &json!({
                            "retry": attempt + 1,
                            "maxRetries": COMPACTION_MAX_RETRIES,
                            "code": error.code(),
                            "detail": error.detail(),
                        }),
                    )?;
                    last_error = Some(error);
                    tokio::select! {
                        _ = cancellation.cancelled() => {
                            return Err(CoreError::Cancelled(format!(
                                "thread {thread_id} was cancelled during compaction retry backoff"
                            )));
                        }
                        _ = tokio::time::sleep(Duration::from_millis(COMPACTION_RETRY_DELAYS_MS[attempt])) => {}
                    }
                }
            }
        }
        let summary = match summary {
            Some(summary) => summary,
            None => {
                let error = last_error.unwrap_or_else(|| CoreError::CompactionFailed {
                    code: "UNKNOWN".to_owned(),
                    detail: "compaction attempts ended without a result".to_owned(),
                });
                host.emit(RuntimeEvent::CompactionFailed {
                    thread_id: thread_id.to_owned(),
                    code: error.code().to_owned(),
                    detail: error.detail(),
                });
                return Err(error);
            }
        };
        let through_seq = messages.last().map(|(seq, _)| *seq).unwrap_or(-1);
        let revision =
            self.store
                .commit_compaction(thread_id, &summary, messages.len(), through_seq)?;
        host.emit(RuntimeEvent::CompactionCompleted {
            thread_id: thread_id.to_owned(),
            revision,
        });
        Ok(())
    }

    fn effective_messages(&self, thread_id: &str) -> Result<Vec<ChatMessage>, CoreError> {
        let state = self.store.compaction_state(thread_id)?;
        let mut effective = Vec::new();
        if !self.config.system_prompt.is_empty() {
            effective.push(ChatMessage::text(
                MessageRole::System,
                self.config.system_prompt.clone(),
            ));
        }
        if let Some(summary) = state.summary {
            effective.push(ChatMessage::text(
                MessageRole::System,
                format!(
                    "Local thread summary (revision {}):\n{summary}",
                    state.revision
                ),
            ));
        }
        effective.extend(
            self.store
                .load_messages(thread_id)?
                .into_iter()
                .filter(|(seq, _)| *seq > state.compacted_through_seq)
                .map(|(_, message)| message),
        );
        Ok(effective)
    }

    pub async fn dispose(&self) -> Result<(), CoreError> {
        if self.disposed.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        {
            let active = self.active_turns.lock().await;
            for cancellation in active.values() {
                cancellation.cancel();
            }
        }
        let tasks = {
            let mut tasks = self.subagents.lock().await;
            tasks.drain().map(|(_, task)| task).collect::<Vec<_>>()
        };
        for mut task in tasks {
            if tokio::time::timeout(Duration::from_secs(5), &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = task.await;
            }
        }
        self.store.close()?;
        Ok(())
    }

    fn assert_active(&self) -> Result<(), CoreError> {
        if self.disposed.load(Ordering::Acquire) {
            Err(CoreError::Disposed)
        } else {
            Ok(())
        }
    }
}

fn merge_tools(mut host_tools: Vec<ToolDefinition>) -> Vec<ToolDefinition> {
    host_tools.retain(|tool| {
        !matches!(
            tool.name.as_str(),
            "spawn_agent" | "wait_agent" | "cancel_agent"
        )
    });
    host_tools.extend(internal_tool_definitions());
    host_tools
}

fn internal_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "spawn_agent".to_owned(),
            description: "Create a local subagent with an independent persistent thread. Returns its thread id immediately.".to_owned(),
            parameters: json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["task"],
                "properties": {
                    "task": { "type": "string" },
                    "role": { "type": "string" }
                }
            }),
            parallel_safe: false,
        },
        ToolDefinition {
            name: "wait_agent".to_owned(),
            description: "Wait for a local subagent and return its durable result or current running state.".to_owned(),
            parameters: json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["thread_id"],
                "properties": {
                    "thread_id": { "type": "string" },
                    "timeout_ms": { "type": "integer", "minimum": 1 }
                }
            }),
            parallel_safe: false,
        },
        ToolDefinition {
            name: "cancel_agent".to_owned(),
            description: "Cancel one running local subagent by thread id.".to_owned(),
            parameters: json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["thread_id"],
                "properties": {
                    "thread_id": { "type": "string" }
                }
            }),
            parallel_safe: false,
        },
    ]
}

fn estimate_tokens(messages: &[ChatMessage], summary: Option<&str>) -> usize {
    let message_bytes = messages
        .iter()
        .map(|message| {
            serde_json::to_vec(message)
                .map(|value| value.len())
                .unwrap_or_default()
        })
        .sum::<usize>();
    (message_bytes + summary.map(str::len).unwrap_or_default()).div_ceil(4)
}

fn validate_summary(raw: &str) -> Result<String, String> {
    if raw.trim().is_empty() {
        return Err("compaction response was empty".to_owned());
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct SummaryEnvelope {
        summary: String,
    }
    let envelope: SummaryEnvelope = serde_json::from_str(raw.trim())
        .map_err(|error| format!("compaction response is not strict summary JSON: {error}"))?;
    let summary = envelope.summary.trim();
    if summary.is_empty() {
        return Err("summary field is empty".to_owned());
    }
    if summary.len() > 256_000 {
        return Err("summary exceeds 256000 bytes".to_owned());
    }
    Ok(summary.to_owned())
}

fn summarize_json(value: &Value, max_chars: usize) -> String {
    let serialized = value.to_string();
    if serialized.chars().count() <= max_chars {
        return serialized;
    }
    let mut summary = serialized.chars().take(max_chars).collect::<String>();
    summary.push_str("…");
    summary
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SpawnAgentArgs {
    task: String,
    role: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WaitAgentArgs {
    thread_id: String,
    timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CancelAgentArgs {
    thread_id: String,
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        sync::{
            Mutex as StdMutex,
            atomic::{AtomicUsize, Ordering as AtomicOrdering},
        },
    };

    use super::*;
    use crate::{
        model_transport::DeltaSink,
        types::{ModelResponse, TokenUsage},
    };
    use tempfile::TempDir;

    struct MockTransport {
        responses: StdMutex<VecDeque<Result<ModelResponse, CoreError>>>,
        requests: StdMutex<Vec<ModelRequest>>,
    }

    struct MultiAgentTransport;

    #[derive(Default)]
    struct ConcurrentSubagentTransport {
        active: AtomicUsize,
        max_active: AtomicUsize,
    }

    #[derive(Default)]
    struct BlockingSubagentTransport {
        active: AtomicUsize,
    }

    struct SubagentCompactionFailureTransport;

    #[async_trait]
    impl ModelTransport for MultiAgentTransport {
        async fn stream(
            &self,
            request: ModelRequest,
            _cancellation: CancellationToken,
            _on_text_delta: Option<DeltaSink>,
        ) -> Result<ModelResponse, CoreError> {
            let contains = |needle: &str| {
                request.messages.iter().any(|message| {
                    message
                        .content
                        .as_deref()
                        .is_some_and(|content| content.contains(needle))
                })
            };
            let last = request
                .messages
                .last()
                .and_then(|message| message.content.as_deref())
                .unwrap_or_default();
            if contains("child investigation") {
                return Ok(text_response("child result"));
            }
            if last.contains("\"status\":\"running\"") {
                let value: Value = serde_json::from_str(last).unwrap();
                let child = value["threadId"].as_str().unwrap();
                return Ok(ModelResponse {
                    text: String::new(),
                    tool_calls: vec![ToolCall {
                        index: 0,
                        id: "wait-1".to_owned(),
                        name: "wait_agent".to_owned(),
                        arguments: json!({ "thread_id": child }).to_string(),
                    }],
                    finish_reason: "tool_calls".to_owned(),
                    usage: None,
                });
            }
            if last.contains("child result") {
                return Ok(text_response("root synthesized child result"));
            }
            Ok(ModelResponse {
                text: String::new(),
                tool_calls: vec![ToolCall {
                    index: 0,
                    id: "spawn-1".to_owned(),
                    name: "spawn_agent".to_owned(),
                    arguments: json!({
                        "task": "child investigation",
                        "role": "reviewer",
                    })
                    .to_string(),
                }],
                finish_reason: "tool_calls".to_owned(),
                usage: None,
            })
        }
    }

    #[async_trait]
    impl ModelTransport for ConcurrentSubagentTransport {
        async fn stream(
            &self,
            request: ModelRequest,
            _cancellation: CancellationToken,
            _on_text_delta: Option<DeltaSink>,
        ) -> Result<ModelResponse, CoreError> {
            let is_child = request.messages.iter().any(|message| {
                matches!(message.role, MessageRole::User)
                    && message
                        .content
                        .as_deref()
                        .is_some_and(|content| content.starts_with("parallel child"))
            });
            if is_child {
                let active = self.active.fetch_add(1, AtomicOrdering::AcqRel) + 1;
                self.max_active.fetch_max(active, AtomicOrdering::AcqRel);
                while self.active.load(AtomicOrdering::Acquire) < 2 {
                    tokio::task::yield_now().await;
                }
                tokio::time::sleep(Duration::from_millis(40)).await;
                self.active.fetch_sub(1, AtomicOrdering::AcqRel);
                return Ok(text_response("parallel child result"));
            }

            let tool_contents = request
                .messages
                .iter()
                .filter(|message| matches!(message.role, MessageRole::Tool))
                .filter_map(|message| message.content.as_deref())
                .collect::<Vec<_>>();
            if tool_contents
                .iter()
                .any(|content| content.contains("parallel child result"))
            {
                return Ok(text_response("root combined both children"));
            }
            let child_ids = tool_contents
                .iter()
                .filter_map(|content| serde_json::from_str::<Value>(content).ok())
                .filter_map(|value| value["threadId"].as_str().map(str::to_owned))
                .collect::<Vec<_>>();
            if child_ids.len() == 2 {
                return Ok(ModelResponse {
                    text: String::new(),
                    tool_calls: child_ids
                        .into_iter()
                        .enumerate()
                        .map(|(index, thread_id)| ToolCall {
                            index,
                            id: format!("wait-{index}"),
                            name: "wait_agent".to_owned(),
                            arguments: json!({ "thread_id": thread_id }).to_string(),
                        })
                        .collect(),
                    finish_reason: "tool_calls".to_owned(),
                    usage: None,
                });
            }
            Ok(ModelResponse {
                text: String::new(),
                tool_calls: vec![
                    ToolCall {
                        index: 0,
                        id: "spawn-a".to_owned(),
                        name: "spawn_agent".to_owned(),
                        arguments: json!({ "task": "parallel child A" }).to_string(),
                    },
                    ToolCall {
                        index: 1,
                        id: "spawn-b".to_owned(),
                        name: "spawn_agent".to_owned(),
                        arguments: json!({ "task": "parallel child B" }).to_string(),
                    },
                ],
                finish_reason: "tool_calls".to_owned(),
                usage: None,
            })
        }
    }

    #[async_trait]
    impl ModelTransport for BlockingSubagentTransport {
        async fn stream(
            &self,
            request: ModelRequest,
            cancellation: CancellationToken,
            _on_text_delta: Option<DeltaSink>,
        ) -> Result<ModelResponse, CoreError> {
            let contains = |needle: &str| {
                request.messages.iter().any(|message| {
                    message
                        .content
                        .as_deref()
                        .is_some_and(|content| content.contains(needle))
                })
            };
            if contains("blocking child") {
                self.active.fetch_add(1, AtomicOrdering::AcqRel);
                cancellation.cancelled().await;
                self.active.fetch_sub(1, AtomicOrdering::AcqRel);
                return Err(CoreError::Cancelled("blocking child cancelled".to_owned()));
            }
            if contains("\"timedOut\":true") {
                return Ok(text_response("root observed timeout"));
            }
            let child_id = request.messages.iter().find_map(|message| {
                let content = message.content.as_deref()?;
                let value = serde_json::from_str::<Value>(content).ok()?;
                value["threadId"].as_str().map(str::to_owned)
            });
            if let Some(thread_id) = child_id {
                return Ok(ModelResponse {
                    text: String::new(),
                    tool_calls: vec![ToolCall {
                        index: 0,
                        id: "wait-timeout".to_owned(),
                        name: "wait_agent".to_owned(),
                        arguments: json!({ "thread_id": thread_id, "timeout_ms": 10 }).to_string(),
                    }],
                    finish_reason: "tool_calls".to_owned(),
                    usage: None,
                });
            }
            Ok(ModelResponse {
                text: String::new(),
                tool_calls: vec![ToolCall {
                    index: 0,
                    id: "spawn-blocking".to_owned(),
                    name: "spawn_agent".to_owned(),
                    arguments: json!({ "task": "blocking child" }).to_string(),
                }],
                finish_reason: "tool_calls".to_owned(),
                usage: None,
            })
        }
    }

    #[async_trait]
    impl ModelTransport for SubagentCompactionFailureTransport {
        async fn stream(
            &self,
            request: ModelRequest,
            _cancellation: CancellationToken,
            _on_text_delta: Option<DeltaSink>,
        ) -> Result<ModelResponse, CoreError> {
            if request.tools.is_empty() {
                return Err(CoreError::MalformedSse(
                    "subagent compaction stream was malformed".to_owned(),
                ));
            }
            let is_child = request.messages.iter().any(|message| {
                matches!(message.role, MessageRole::User)
                    && message
                        .content
                        .as_deref()
                        .is_some_and(|content| content == "child compaction probe")
            });
            if is_child {
                return Ok(ModelResponse {
                    text: String::new(),
                    tool_calls: vec![ToolCall {
                        index: 0,
                        id: "inflate-child-context".to_owned(),
                        name: "inflate".to_owned(),
                        arguments: "{}".to_owned(),
                    }],
                    finish_reason: "tool_calls".to_owned(),
                    usage: None,
                });
            }
            let child_id = request.messages.iter().find_map(|message| {
                let content = message.content.as_deref()?;
                let value = serde_json::from_str::<Value>(content).ok()?;
                value["threadId"].as_str().map(str::to_owned)
            });
            if let Some(thread_id) = child_id {
                return Ok(ModelResponse {
                    text: String::new(),
                    tool_calls: vec![ToolCall {
                        index: 0,
                        id: "wait-failed-child".to_owned(),
                        name: "wait_agent".to_owned(),
                        arguments: json!({ "thread_id": thread_id }).to_string(),
                    }],
                    finish_reason: "tool_calls".to_owned(),
                    usage: None,
                });
            }
            Ok(ModelResponse {
                text: String::new(),
                tool_calls: vec![ToolCall {
                    index: 0,
                    id: "spawn-compaction-child".to_owned(),
                    name: "spawn_agent".to_owned(),
                    arguments: json!({
                        "task": "child compaction probe",
                        "role": "failure-probe",
                    })
                    .to_string(),
                }],
                finish_reason: "tool_calls".to_owned(),
                usage: None,
            })
        }
    }

    impl MockTransport {
        fn new(responses: Vec<Result<ModelResponse, CoreError>>) -> Arc<Self> {
            Arc::new(Self {
                responses: StdMutex::new(responses.into()),
                requests: StdMutex::new(Vec::new()),
            })
        }
    }

    #[async_trait]
    impl ModelTransport for MockTransport {
        async fn stream(
            &self,
            request: ModelRequest,
            _cancellation: CancellationToken,
            on_text_delta: Option<DeltaSink>,
        ) -> Result<ModelResponse, CoreError> {
            self.requests.lock().unwrap().push(request);
            let response = self.responses.lock().unwrap().pop_front().unwrap();
            if let Ok(response) = &response {
                if let Some(sink) = on_text_delta {
                    if !response.text.is_empty() {
                        sink(response.text.clone());
                    }
                }
            }
            response
        }
    }

    #[derive(Default)]
    struct MockHost {
        events: StdMutex<Vec<RuntimeEvent>>,
        tool_results: StdMutex<VecDeque<ToolExecutionResult>>,
    }

    #[derive(Default)]
    struct ConcurrentToolHost {
        active: AtomicUsize,
        max_active: AtomicUsize,
    }

    #[async_trait]
    impl HostBridge for MockHost {
        fn emit(&self, event: RuntimeEvent) {
            self.events.lock().unwrap().push(event);
        }

        async fn execute_tool(
            &self,
            _invocation: ToolInvocation,
        ) -> Result<ToolExecutionResult, CoreError> {
            self.tool_results
                .lock()
                .unwrap()
                .pop_front()
                .ok_or_else(|| CoreError::Tool {
                    tool: "mock".to_owned(),
                    detail: "no queued result".to_owned(),
                })
        }
    }

    #[async_trait]
    impl HostBridge for ConcurrentToolHost {
        fn emit(&self, _event: RuntimeEvent) {}

        async fn execute_tool(
            &self,
            _invocation: ToolInvocation,
        ) -> Result<ToolExecutionResult, CoreError> {
            let active = self.active.fetch_add(1, AtomicOrdering::AcqRel) + 1;
            self.max_active.fetch_max(active, AtomicOrdering::AcqRel);
            tokio::time::sleep(Duration::from_millis(40)).await;
            self.active.fetch_sub(1, AtomicOrdering::AcqRel);
            Ok(ToolExecutionResult {
                content: "ok".to_owned(),
                is_error: false,
                status: "completed".to_owned(),
            })
        }
    }

    fn config(temp: &TempDir, threshold: usize) -> CoreConfig {
        CoreConfig {
            base_url: "https://llm.internal".to_owned(),
            model: "test".to_owned(),
            state_dir: temp.path().to_string_lossy().into_owned(),
            request_timeout_ms: 1_000,
            context_window_tokens: threshold + 100,
            compact_threshold_tokens: threshold,
            max_steps: 8,
            system_prompt: "test".to_owned(),
        }
    }

    fn text_response(text: &str) -> ModelResponse {
        ModelResponse {
            text: text.to_owned(),
            tool_calls: Vec::new(),
            finish_reason: "stop".to_owned(),
            usage: Some(TokenUsage {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
            }),
        }
    }

    #[test]
    fn compaction_summary_validation_rejects_empty_and_non_strict_payloads() {
        assert_eq!(
            validate_summary("").unwrap_err(),
            "compaction response was empty"
        );
        assert!(
            validate_summary(r#"{"summary":""}"#)
                .unwrap_err()
                .contains("summary field is empty")
        );
        assert!(
            validate_summary(r#"{"summary":"ok","extra":true}"#)
                .unwrap_err()
                .contains("strict summary JSON")
        );
        assert!(
            validate_summary("plain text")
                .unwrap_err()
                .contains("strict summary JSON")
        );
    }

    #[tokio::test]
    async fn runs_multi_turn_tool_loop_with_core_owned_order() {
        let temp = TempDir::new().unwrap();
        let transport = MockTransport::new(vec![
            Ok(ModelResponse {
                text: String::new(),
                tool_calls: vec![ToolCall {
                    index: 0,
                    id: "call-1".to_owned(),
                    name: "read_file".to_owned(),
                    arguments: "{\"path\":\"README.md\"}".to_owned(),
                }],
                finish_reason: "tool_calls".to_owned(),
                usage: None,
            }),
            Ok(text_response("done")),
        ]);
        let runtime = CodexRuntime::new(config(&temp, 10_000), transport.clone()).unwrap();
        runtime.create_thread("root", None, None, "root").unwrap();
        let host = Arc::new(MockHost::default());
        host.tool_results
            .lock()
            .unwrap()
            .push_back(ToolExecutionResult {
                content: "file body".to_owned(),
                is_error: false,
                status: "completed".to_owned(),
            });
        let result = runtime
            .run_turn(
                "root",
                "inspect",
                vec![ToolDefinition {
                    name: "read_file".to_owned(),
                    description: "read".to_owned(),
                    parameters: json!({"type":"object"}),
                    parallel_safe: true,
                }],
                host,
            )
            .await
            .unwrap();
        assert_eq!(result.text, "done");
        assert_eq!(result.model_requests, 2);
        assert_eq!(result.tool_calls, 1);
        assert_eq!(result.usage.unwrap().total_tokens, 2);
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(matches!(
            requests[1].messages.last().unwrap().role,
            MessageRole::Tool
        ));
    }

    #[tokio::test]
    async fn parallel_safe_tool_calls_share_one_model_round_trip() {
        let temp = TempDir::new().unwrap();
        let transport = MockTransport::new(vec![
            Ok(ModelResponse {
                text: String::new(),
                tool_calls: vec![
                    ToolCall {
                        index: 0,
                        id: "read-a".to_owned(),
                        name: "read_a".to_owned(),
                        arguments: "{}".to_owned(),
                    },
                    ToolCall {
                        index: 1,
                        id: "read-b".to_owned(),
                        name: "read_b".to_owned(),
                        arguments: "{}".to_owned(),
                    },
                ],
                finish_reason: "tool_calls".to_owned(),
                usage: Some(TokenUsage {
                    prompt_tokens: 10,
                    completion_tokens: 2,
                    total_tokens: 12,
                }),
            }),
            Ok(text_response("done")),
        ]);
        let runtime = CodexRuntime::new(config(&temp, 10_000), transport).unwrap();
        runtime.create_thread("root", None, None, "root").unwrap();
        let host = Arc::new(ConcurrentToolHost::default());
        let result = runtime
            .run_turn(
                "root",
                "inspect independent facts",
                ["read_a", "read_b"]
                    .into_iter()
                    .map(|name| ToolDefinition {
                        name: name.to_owned(),
                        description: "read".to_owned(),
                        parameters: json!({"type":"object"}),
                        parallel_safe: true,
                    })
                    .collect(),
                host.clone(),
            )
            .await
            .unwrap();

        assert_eq!(host.max_active.load(AtomicOrdering::Acquire), 2);
        assert_eq!(result.model_requests, 2);
        assert_eq!(result.tool_calls, 2);
        assert_eq!(result.usage.unwrap().total_tokens, 14);
    }

    #[tokio::test]
    async fn compaction_failure_stops_turn_and_preserves_history() {
        let temp = TempDir::new().unwrap();
        let transport = MockTransport::new(
            (0..=COMPACTION_MAX_RETRIES)
                .map(|_| Err(CoreError::MalformedSse("broken event".to_owned())))
                .collect(),
        );
        let runtime = CodexRuntime::new(config(&temp, 1), transport.clone()).unwrap();
        runtime.create_thread("root", None, None, "root").unwrap();
        let host = Arc::new(MockHost::default());
        let error = runtime
            .run_turn("root", "long input", Vec::new(), host)
            .await
            .unwrap_err();
        assert!(matches!(error, CoreError::CompactionFailed { .. }));
        assert_eq!(
            transport.requests.lock().unwrap().len(),
            COMPACTION_MAX_RETRIES + 1
        );
        let snapshot = runtime.store().thread_snapshot("root").unwrap();
        assert_eq!(snapshot.summary_revision, 0);
        assert_eq!(snapshot.message_count, 1);
    }

    #[tokio::test]
    async fn compaction_success_commits_before_normal_model_call() {
        let temp = TempDir::new().unwrap();
        let transport = MockTransport::new(vec![
            Ok(text_response(r#"{"summary":"compact state"}"#)),
            Ok(text_response("answer")),
        ]);
        let runtime = CodexRuntime::new(config(&temp, 1), transport.clone()).unwrap();
        runtime.create_thread("root", None, None, "root").unwrap();
        let result = runtime
            .run_turn(
                "root",
                "long input",
                Vec::new(),
                Arc::new(MockHost::default()),
            )
            .await
            .unwrap();
        assert_eq!(result.text, "answer");
        assert_eq!(
            runtime
                .store()
                .thread_snapshot("root")
                .unwrap()
                .summary_revision,
            1
        );
        let requests = transport.requests.lock().unwrap();
        assert!(requests[0].tools.is_empty());
        assert!(requests[1].messages.iter().any(|message| {
            message
                .content
                .as_deref()
                .unwrap_or_default()
                .contains("compact state")
        }));
    }

    #[tokio::test]
    async fn compaction_can_recover_on_third_retry_without_losing_history() {
        let temp = TempDir::new().unwrap();
        let transport = MockTransport::new(vec![
            Err(CoreError::MalformedSse("first".to_owned())),
            Err(CoreError::EmptyResponse),
            Err(CoreError::Model {
                phase: "stream",
                code: "TIMEOUT".to_owned(),
                status: None,
                detail: "third attempt timed out".to_owned(),
                response_body: None,
            }),
            Ok(text_response(r#"{"summary":"recovered summary"}"#)),
            Ok(text_response("answer after retry")),
        ]);
        let runtime = CodexRuntime::new(config(&temp, 1), transport.clone()).unwrap();
        runtime.create_thread("root", None, None, "root").unwrap();
        let result = runtime
            .run_turn(
                "root",
                "long input",
                Vec::new(),
                Arc::new(MockHost::default()),
            )
            .await
            .unwrap();
        assert_eq!(result.text, "answer after retry");
        assert_eq!(transport.requests.lock().unwrap().len(), 5);
        assert_eq!(
            runtime
                .store()
                .thread_snapshot("root")
                .unwrap()
                .summary_revision,
            1
        );
    }

    #[tokio::test]
    async fn root_spawns_waits_and_persists_an_independent_subagent_thread() {
        let temp = TempDir::new().unwrap();
        let runtime =
            CodexRuntime::new(config(&temp, 10_000), Arc::new(MultiAgentTransport)).unwrap();
        runtime.create_thread("root", None, None, "root").unwrap();
        let result = runtime
            .run_turn(
                "root",
                "delegate this task",
                Vec::new(),
                Arc::new(MockHost::default()),
            )
            .await
            .unwrap();

        assert_eq!(result.text, "root synthesized child result");
        let graph = runtime.graph_snapshot("root").unwrap();
        assert_eq!(graph.len(), 1);
        assert_eq!(graph[0].status, "completed");
        let child = runtime.thread_snapshot(&graph[0].child_thread_id).unwrap();
        assert_eq!(child.parent_thread_id.as_deref(), Some("root"));
        assert_eq!(child.role, "reviewer");
        assert!(child.message_count >= 2);
        assert!(runtime.thread_snapshot("root").unwrap().message_count > child.message_count);

        drop(runtime);
        let reopened = ThreadStore::open(temp.path()).unwrap();
        assert_eq!(reopened.graph_edges("root").unwrap()[0].status, "completed");
    }

    #[tokio::test]
    async fn root_runs_multiple_subagents_concurrently_and_collects_both() {
        let temp = TempDir::new().unwrap();
        let transport = Arc::new(ConcurrentSubagentTransport::default());
        let runtime = CodexRuntime::new(config(&temp, 10_000), transport.clone()).unwrap();
        runtime.create_thread("root", None, None, "root").unwrap();
        let result = runtime
            .run_turn(
                "root",
                "delegate twice",
                Vec::new(),
                Arc::new(MockHost::default()),
            )
            .await
            .unwrap();

        assert_eq!(result.text, "root combined both children");
        assert_eq!(transport.max_active.load(AtomicOrdering::Acquire), 2);
        let graph = runtime.graph_snapshot("root").unwrap();
        assert_eq!(graph.len(), 2);
        assert!(graph.iter().all(|edge| edge.status == "completed"));
    }

    #[tokio::test]
    async fn wait_timeout_is_non_destructive_and_dispose_leaves_no_subagent_task() {
        let temp = TempDir::new().unwrap();
        let transport = Arc::new(BlockingSubagentTransport::default());
        let runtime = CodexRuntime::new(config(&temp, 10_000), transport.clone()).unwrap();
        runtime.create_thread("root", None, None, "root").unwrap();
        let result = runtime
            .run_turn(
                "root",
                "start child",
                Vec::new(),
                Arc::new(MockHost::default()),
            )
            .await
            .unwrap();

        assert_eq!(result.text, "root observed timeout");
        assert_eq!(runtime.graph_snapshot("root").unwrap()[0].status, "running");
        runtime.dispose().await.unwrap();
        assert_eq!(transport.active.load(AtomicOrdering::Acquire), 0);
    }

    #[tokio::test]
    async fn subagent_compaction_failure_is_structured_and_propagates_to_root() {
        let temp = TempDir::new().unwrap();
        let runtime = CodexRuntime::new(
            config(&temp, 1_000),
            Arc::new(SubagentCompactionFailureTransport),
        )
        .unwrap();
        runtime.create_thread("root", None, None, "root").unwrap();
        let host = Arc::new(MockHost::default());
        host.tool_results
            .lock()
            .unwrap()
            .push_back(ToolExecutionResult {
                content: "x".repeat(8_000),
                is_error: false,
                status: "completed".to_owned(),
            });
        let error = runtime
            .run_turn(
                "root",
                "delegate",
                vec![ToolDefinition {
                    name: "inflate".to_owned(),
                    description: "return a large result".to_owned(),
                    parameters: json!({"type":"object"}),
                    parallel_safe: true,
                }],
                host,
            )
            .await
            .unwrap_err();

        assert!(matches!(error, CoreError::CompactionFailed { .. }));
        assert_eq!(error.code(), "COMPACTION_FAILED");
        let graph = runtime.graph_snapshot("root").unwrap();
        assert_eq!(graph.len(), 1);
        assert_eq!(graph[0].status, "failed");
        let child = runtime.thread_snapshot(&graph[0].child_thread_id).unwrap();
        assert!(
            child
                .error
                .as_deref()
                .is_some_and(|value| value.contains("COMPACTION_FAILED"))
        );
    }
}

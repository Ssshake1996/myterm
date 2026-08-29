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
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    sync::{Mutex, mpsc},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const COMPACTION_MAX_RETRIES: usize = 3;
const COMPACTION_RETRY_DELAYS_MS: [u64; COMPACTION_MAX_RETRIES] = [100, 250, 500];

use crate::{
    error::CoreError,
    model_transport::{DeltaSink, ModelTransport},
    result_reducer::{ResultCapsule, ResultFact, reduce_tool_result},
    store::ThreadStore,
    types::{
        ChatMessage, CoreConfig, GraphEdge, MessageRole, ModelRequest, ProviderContext,
        ProviderContextMode, RuntimeEvent, SequencedMessage, ThreadSnapshot, ToolCall,
        ToolDefinition, ToolExecutionResult, ToolInvocation, TurnResult,
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
    active_turns: Mutex<HashMap<String, ActiveTurnControl>>,
    turn_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    subagents: Mutex<HashMap<String, SubagentTask>>,
    disposed: AtomicBool,
}

struct ActiveTurnControl {
    cancellation: CancellationToken,
    steering: mpsc::Sender<String>,
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
        let (steering_tx, steering_rx) = mpsc::channel(32);
        {
            let mut active = self.active_turns.lock().await;
            if active
                .insert(
                    thread_id.to_owned(),
                    ActiveTurnControl {
                        cancellation: cancellation.clone(),
                        steering: steering_tx,
                    },
                )
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
            .drive_loop(
                thread_id,
                host_tools,
                host.clone(),
                cancellation.clone(),
                steering_rx,
            )
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
        mut steering: mpsc::Receiver<String>,
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
            self.apply_pending_steering(thread_id, &host, &mut steering, None)?;
            self.maybe_compact(thread_id, &model_tools, host.clone(), cancellation.clone())
                .await?;
            let messages = self.effective_messages(thread_id)?;
            let sequenced_messages = self
                .store
                .load_messages(thread_id)?
                .into_iter()
                .map(|(seq, message)| SequencedMessage { seq, message })
                .collect();
            let provider_contexts = self.store.provider_contexts(thread_id)?;
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
                        provider_context_enabled: true,
                        thread_id: thread_id.to_owned(),
                        system_prompt: self.config.system_prompt.clone(),
                        messages,
                        sequenced_messages,
                        tools: model_tools.clone(),
                        provider_contexts,
                        compact_threshold_tokens: self.config.compact_threshold_tokens,
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
            let assistant_seq = self.store.append_message(
                thread_id,
                &ChatMessage {
                    role: MessageRole::Assistant,
                    content: (!response.text.is_empty()).then_some(response.text.clone()),
                    tool_calls: response.tool_calls.clone(),
                    tool_call_id: None,
                },
            )?;
            if let Some(update) = response.provider_context.as_ref() {
                let previous = self
                    .store
                    .provider_contexts(thread_id)?
                    .into_iter()
                    .find(|context| context.provider_id == update.provider_id);
                let context = ProviderContext {
                    provider_id: update.provider_id.clone(),
                    mode: update.mode.clone(),
                    cursor: update.cursor.clone(),
                    through_seq: assistant_seq,
                    unsupported: update.unsupported,
                };
                self.store.save_provider_context(thread_id, &context)?;
                host.emit(RuntimeEvent::ProviderContextUpdated {
                    thread_id: thread_id.to_owned(),
                    provider_id: context.provider_id,
                    mode: context.mode,
                    reused: previous
                        .as_ref()
                        .and_then(|value| value.cursor.as_ref())
                        .is_some(),
                    unsupported: context.unsupported,
                });
            }
            if response.tool_calls.is_empty() {
                let first = tokio::time::timeout(Duration::from_millis(25), steering.recv())
                    .await
                    .ok()
                    .flatten();
                if self.apply_pending_steering(thread_id, &host, &mut steering, first)? > 0 {
                    continue;
                }
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

    fn apply_pending_steering(
        &self,
        thread_id: &str,
        host: &Arc<dyn HostBridge>,
        steering: &mut mpsc::Receiver<String>,
        first: Option<String>,
    ) -> Result<usize, CoreError> {
        let mut inputs = Vec::new();
        if let Some(input) = first {
            inputs.push(input);
        }
        while let Ok(input) = steering.try_recv() {
            inputs.push(input);
        }
        for input in &inputs {
            self.store.append_message(
                thread_id,
                &ChatMessage::text(MessageRole::User, input.clone()),
            )?;
        }
        if !inputs.is_empty() {
            self.store.audit(
                Some(thread_id),
                "turn_steered",
                &json!({ "inputCount": inputs.len() }),
            )?;
            host.emit(RuntimeEvent::SteeringApplied {
                thread_id: thread_id.to_owned(),
                input_count: inputs.len(),
            });
        }
        Ok(inputs.len())
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
        let user_intent = self.latest_user_intent(thread_id)?;
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
            "result_read" => self.read_result(thread_id, &arguments)?,
            _ => {
                let invocation = ToolInvocation {
                    thread_id: thread_id.to_owned(),
                    call_id: call.id.clone(),
                    name: call.name.clone(),
                    arguments: arguments.clone(),
                    target: None,
                };
                host.execute_tool(invocation).await?
            }
        };

        let result_id = format!("result-{}", Uuid::new_v4());
        let reduced = reduce_tool_result(
            &result_id,
            &call.name,
            &arguments,
            &result.content,
            &result.status,
            result.is_error,
            &user_intent,
        )
        .map_err(|error| CoreError::Tool {
            tool: call.name.clone(),
            detail: format!("unable to build result capsule: {error}"),
        })?;
        let projected_bytes = reduced.projected_content.len();
        let read_required = reduced.capsule.read_required;
        self.store.append_tool_result(
            thread_id,
            &call.id,
            &call.name,
            &ChatMessage {
                role: MessageRole::Tool,
                content: Some(reduced.projected_content),
                tool_calls: Vec::new(),
                tool_call_id: Some(call.id.clone()),
            },
            &result.content,
            &reduced.capsule,
        )?;
        self.store.audit(
            Some(thread_id),
            "tool_completed",
            &json!({
                "callId": call.id,
                "name": call.name,
                "isError": result.is_error,
                "status": result.status,
                "resultId": result_id,
                "rawBytes": result.content.len(),
                "projectedBytes": projected_bytes,
                "readRequired": read_required,
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

    fn latest_user_intent(&self, thread_id: &str) -> Result<String, CoreError> {
        Ok(self
            .store
            .load_messages(thread_id)?
            .into_iter()
            .rev()
            .find_map(|(_, message)| {
                (message.role == MessageRole::User)
                    .then_some(message.content)
                    .flatten()
            })
            .unwrap_or_default())
    }

    fn read_result(
        &self,
        thread_id: &str,
        arguments: &Value,
    ) -> Result<ToolExecutionResult, CoreError> {
        let args: ResultReadArgs = serde_json::from_value(arguments.clone()).map_err(|error| {
            CoreError::InvalidToolCall(format!("result_read arguments: {error}"))
        })?;
        let record = self.store.tool_result(thread_id, &args.result_id)?;
        let limit = args.limit.unwrap_or(6 * 1024).clamp(1, 6 * 1024);
        let content = if let Some(query) = args.query.as_deref() {
            if query.trim().is_empty() {
                return Err(CoreError::InvalidToolCall(
                    "result_read query must not be empty".to_owned(),
                ));
            }
            if query.len() > 512 {
                return Err(CoreError::InvalidToolCall(
                    "result_read query must not exceed 512 bytes".to_owned(),
                ));
            }
            let source =
                std::fs::read_to_string(&record.raw_path).map_err(|error| CoreError::Store {
                    operation: "read_tool_result_search",
                    detail: error.to_string(),
                })?;
            let query_lower = query.to_ascii_lowercase();
            let mut matches = Vec::new();
            let mut total_matches = 0_usize;
            let mut selected_bytes = 0_usize;
            let mut source_offset = 0_usize;
            for (index, raw_line) in source.split_inclusive('\n').enumerate() {
                let line = raw_line.strip_suffix('\n').unwrap_or(raw_line);
                let line = line.strip_suffix('\r').unwrap_or(line);
                if !line.to_ascii_lowercase().contains(&query_lower) {
                    source_offset = source_offset.saturating_add(raw_line.len());
                    continue;
                }
                total_matches = total_matches.saturating_add(1);
                let match_offset = line
                    .to_ascii_lowercase()
                    .find(&query_lower)
                    .unwrap_or_default();
                let remaining = limit.saturating_sub(selected_bytes);
                if matches.len() < 50 && remaining >= query.len().saturating_add(96) {
                    let text_budget = remaining.saturating_sub(96);
                    let (excerpt, excerpt_start, truncated) =
                        bounded_match_excerpt(line, match_offset, query.len(), text_budget);
                    selected_bytes = selected_bytes
                        .saturating_add(excerpt.len())
                        .saturating_add(96);
                    matches.push(json!({
                        "line": index + 1,
                        "byteOffset": source_offset.saturating_add(match_offset),
                        "excerptByteOffset": source_offset.saturating_add(excerpt_start),
                        "truncated": truncated,
                        "text": excerpt,
                    }));
                }
                source_offset = source_offset.saturating_add(raw_line.len());
            }
            json!({
                "resultId": record.result_id,
                "tool": record.tool_name,
                "query": query,
                "matchCount": total_matches,
                "returnedMatches": matches.len(),
                "readMore": total_matches > matches.len(),
                "matches": matches,
                "rawBytes": record.raw_bytes,
                "rawSha256": record.raw_sha256,
            })
        } else {
            let source =
                std::fs::read_to_string(&record.raw_path).map_err(|error| CoreError::Store {
                    operation: "read_tool_result_artifact",
                    detail: error.to_string(),
                })?;
            let requested_start = usize::try_from(args.offset.unwrap_or(0))
                .unwrap_or(usize::MAX)
                .min(source.len());
            let mut start = requested_start;
            while start < source.len() && !source.is_char_boundary(start) {
                start += 1;
            }
            let mut end = start.saturating_add(limit).min(source.len());
            while end > start && !source.is_char_boundary(end) {
                end -= 1;
            }
            json!({
                "resultId": record.result_id,
                "tool": record.tool_name,
                "offset": start,
                "nextOffset": end,
                "rawBytes": record.raw_bytes,
                "eof": end >= source.len(),
                "content": &source[start..end],
                "rawSha256": record.raw_sha256,
            })
        };
        Ok(ToolExecutionResult {
            content: content.to_string(),
            is_error: false,
            status: "completed".to_owned(),
        })
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
        if let Some(control) = active.get(thread_id) {
            control.cancellation.cancel();
            true
        } else {
            false
        }
    }

    pub async fn steer_thread(&self, thread_id: &str, input: String) -> Result<(), CoreError> {
        if input.trim().is_empty() {
            return Err(CoreError::InvalidToolCall(
                "steering input must not be empty".to_owned(),
            ));
        }
        let steering = self
            .active_turns
            .lock()
            .await
            .get(thread_id)
            .ok_or_else(|| CoreError::ThreadNotFound(thread_id.to_owned()))?
            .steering
            .clone();
        steering
            .send(input)
            .await
            .map_err(|_| CoreError::ThreadNotFound(thread_id.to_owned()))
    }

    async fn maybe_compact(
        &self,
        thread_id: &str,
        tools: &[ToolDefinition],
        host: Arc<dyn HostBridge>,
        cancellation: CancellationToken,
    ) -> Result<(), CoreError> {
        let has_native_responses_context = self
            .store
            .provider_contexts(thread_id)?
            .into_iter()
            .any(|context| {
                context.mode == ProviderContextMode::Responses
                    && context.cursor.is_some()
                    && !context.unsupported
            });
        if has_native_responses_context {
            return Ok(());
        }
        let state = self.store.compaction_state(thread_id)?;
        let messages = self.store.load_messages(thread_id)?;
        let tail = messages
            .iter()
            .filter(|(seq, _)| *seq > state.compacted_through_seq)
            .cloned()
            .collect::<Vec<_>>();
        let effective_messages = tail
            .iter()
            .map(|(_, message)| message.clone())
            .collect::<Vec<_>>();
        let estimated_tokens = estimate_prompt_tokens(
            &self.config.system_prompt,
            tools,
            &effective_messages,
            state.summary.as_deref(),
        );
        let output_reserve = output_reserve_tokens(self.config.context_window_tokens);
        let input_budget = self
            .config
            .context_window_tokens
            .saturating_sub(output_reserve)
            .max(1);
        let effective_threshold = self.config.compact_threshold_tokens.min(input_budget);
        if estimated_tokens < effective_threshold {
            return Ok(());
        }
        host.emit(RuntimeEvent::CompactionStarted {
            thread_id: thread_id.to_owned(),
            estimated_tokens,
        });
        let capsules = self
            .store
            .tool_result_capsules_after(thread_id, state.compacted_through_seq)?;
        let available_facts = capsules
            .iter()
            .flat_map(|capsule| capsule.facts.iter().cloned())
            .collect::<Vec<_>>();
        let transcript = serde_json::to_string(&json!({
            "previousCheckpoint": state
                .summary
                .as_deref()
                .and_then(|summary| serde_json::from_str::<Value>(summary).ok()),
            "messages": tail
                .iter()
                .map(|(seq, message)| json!({ "seq": seq, "message": message }))
                .collect::<Vec<_>>(),
            "availableFacts": available_facts,
            "availableResults": capsules
                .iter()
                .map(|capsule| json!({
                    "resultId": capsule.result_id,
                    "tool": capsule.tool,
                    "status": capsule.status,
                    "isError": capsule.is_error,
                    "summary": capsule.summary,
                    "rawBytes": capsule.raw_bytes,
                    "rawSha256": capsule.raw_sha256,
                }))
                .collect::<Vec<_>>(),
        }))
        .map_err(|error| CoreError::CompactionFailed {
            code: "TRANSCRIPT_SERIALIZATION".to_owned(),
            detail: error.to_string(),
        })?;
        let compact_request = ModelRequest {
            provider_context_enabled: false,
            thread_id: thread_id.to_owned(),
            system_prompt: String::new(),
            messages: vec![
                ChatMessage::text(
                    MessageRole::System,
                    "Create an incremental local conversation checkpoint from previousCheckpoint plus only the new sequenced messages and result facts. Return strict JSON only with these fields: {\"version\":2,\"summary\":\"...\",\"goals\":[],\"constraints\":[],\"userCorrectionRefs\":[],\"factRefs\":[],\"resultRefs\":[],\"unresolved\":[],\"permissionState\":null}. userCorrectionRefs must contain message seq values whose exact user text is a durable correction. factRefs must contain exact available fact ids still needed for goals, decisions, failures, generated commands, or unresolved work. resultRefs retain exact result ids when opaque evidence may need a later result_read. Empty factRefs and resultRefs are valid when the new query output is completed noise. Never copy or rewrite command strings, facts, or evidence: the host injects their exact persisted values from the selected references. Preserve active goals, decisions, paths, permissions, failures, and unresolved work. Drop completed query noise. Do not request tools.",
                ),
                ChatMessage::text(MessageRole::User, transcript),
            ],
            sequenced_messages: Vec::new(),
            tools: Vec::new(),
            provider_contexts: Vec::new(),
            compact_threshold_tokens: self.config.compact_threshold_tokens,
        };
        let mut last_error: Option<CoreError> = None;
        let mut summary = None;
        for attempt in 0..=COMPACTION_MAX_RETRIES {
            if cancellation.is_cancelled() {
                return Err(CoreError::Cancelled(format!(
                    "thread {thread_id} was cancelled during compaction"
                )));
            }
            let mut attempt_request = compact_request.clone();
            if let Some(previous_error) = last_error.as_ref() {
                attempt_request.messages.push(ChatMessage::text(
                    MessageRole::System,
                    format!(
                        "The previous checkpoint attempt failed validation. Correct this exact error and return the complete strict JSON object again:\n{}",
                        previous_error.detail()
                    ),
                ));
            }
            let attempt_result = self
                .transport
                .stream(attempt_request, cancellation.clone(), None)
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
                    validate_checkpoint(
                        &response.text,
                        &messages,
                        state.summary.as_deref(),
                        &capsules,
                    )
                    .map_err(|detail| CoreError::CompactionFailed {
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
        let through_seq = tail
            .last()
            .map(|(seq, _)| *seq)
            .unwrap_or(state.compacted_through_seq);
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
                    "Local conversation checkpoint (revision {}):\n{summary}",
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
            for control in active.values() {
                control.cancellation.cancel();
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
            "spawn_agent" | "wait_agent" | "cancel_agent" | "result_read"
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
        ToolDefinition {
            name: "result_read".to_owned(),
            description: "Read or search the exact locally persisted raw result behind a result capsule. Use result_id from a large tool result. A literal query returns exact matching lines; without query, read a bounded byte range. This is read-only and never re-executes the original tool.".to_owned(),
            parameters: json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["result_id"],
                "properties": {
                    "result_id": { "type": "string" },
                    "query": { "type": "string", "maxLength": 512, "description": "Optional case-insensitive literal search over the complete raw result" },
                    "offset": { "type": "integer", "minimum": 0, "default": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 6144, "default": 6144 }
                }
            }),
            parallel_safe: true,
        },
    ]
}

fn estimate_prompt_tokens(
    system_prompt: &str,
    tools: &[ToolDefinition],
    messages: &[ChatMessage],
    summary: Option<&str>,
) -> usize {
    let message_bytes = messages
        .iter()
        .map(|message| {
            serde_json::to_vec(message)
                .map(|value| value.len())
                .unwrap_or_default()
        })
        .sum::<usize>();
    let tool_bytes = serde_json::to_vec(tools)
        .map(|value| value.len())
        .unwrap_or_default();
    let protocol_bytes = messages
        .len()
        .saturating_mul(64)
        .saturating_add(tools.len().saturating_mul(96));
    (message_bytes
        + system_prompt.len()
        + summary.map(str::len).unwrap_or_default()
        + tool_bytes
        + protocol_bytes)
        .div_ceil(4)
}

fn output_reserve_tokens(context_window_tokens: usize) -> usize {
    if context_window_tokens < 4_096 {
        return context_window_tokens / 10;
    }
    (context_window_tokens / 8).clamp(2_048, 16_384)
}

fn bounded_match_excerpt(
    line: &str,
    match_offset: usize,
    match_bytes: usize,
    budget: usize,
) -> (&str, usize, bool) {
    if line.len() <= budget {
        return (line, 0, false);
    }
    let budget = budget.max(match_bytes).min(line.len());
    let before = budget.saturating_sub(match_bytes) / 2;
    let mut start = match_offset.saturating_sub(before);
    let mut end = start.saturating_add(budget).min(line.len());
    if end == line.len() {
        start = end.saturating_sub(budget);
    }
    while start < line.len() && !line.is_char_boundary(start) {
        start += 1;
    }
    while end > start && !line.is_char_boundary(end) {
        end -= 1;
    }
    (&line[start..end], start, true)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalCheckpoint {
    #[serde(default = "checkpoint_version")]
    version: u8,
    summary: String,
    #[serde(default)]
    goals: Vec<String>,
    #[serde(default)]
    constraints: Vec<String>,
    #[serde(default)]
    user_corrections: Vec<String>,
    #[serde(default)]
    user_correction_refs: Vec<i64>,
    #[serde(default)]
    literal_commands: Vec<String>,
    #[serde(default)]
    tool_facts: Vec<String>,
    #[serde(default)]
    facts: Vec<ResultFact>,
    #[serde(default)]
    fact_refs: Vec<String>,
    #[serde(default)]
    result_refs: Vec<String>,
    #[serde(default)]
    evidence_refs: Vec<String>,
    #[serde(default)]
    unresolved: Vec<String>,
    #[serde(default)]
    permission_state: Option<String>,
}

fn checkpoint_version() -> u8 {
    2
}

fn validate_checkpoint(
    raw: &str,
    messages: &[(i64, ChatMessage)],
    previous_summary: Option<&str>,
    capsules: &[ResultCapsule],
) -> Result<String, String> {
    if raw.trim().is_empty() {
        return Err("compaction response was empty".to_owned());
    }
    let mut checkpoint: LocalCheckpoint = serde_json::from_str(raw.trim())
        .map_err(|error| format!("compaction response is not strict checkpoint JSON: {error}"))?;
    let summary = checkpoint.summary.trim();
    if summary.is_empty() {
        return Err("summary field is empty".to_owned());
    }
    if raw.len() > 256_000 {
        return Err("summary exceeds 256000 bytes".to_owned());
    }
    let previous =
        previous_summary.and_then(|value| serde_json::from_str::<LocalCheckpoint>(value).ok());
    checkpoint.version = 2;
    checkpoint.summary = summary.to_owned();
    if let Some(previous) = previous.as_ref() {
        merge_unique(
            &mut checkpoint.constraints,
            previous.constraints.iter().cloned(),
        );
        merge_unique(
            &mut checkpoint.user_corrections,
            previous.user_corrections.iter().cloned(),
        );
        merge_unique(
            &mut checkpoint.user_correction_refs,
            previous.user_correction_refs.iter().copied(),
        );
        merge_unique(
            &mut checkpoint.tool_facts,
            previous.tool_facts.iter().cloned(),
        );
    }
    let message_by_seq = messages
        .iter()
        .map(|(seq, message)| (*seq, message))
        .collect::<HashMap<_, _>>();
    for seq in checkpoint.user_correction_refs.clone() {
        let message = message_by_seq
            .get(&seq)
            .ok_or_else(|| format!("userCorrectionRefs contains unknown message seq {seq}"))?;
        if message.role != MessageRole::User {
            return Err(format!(
                "userCorrectionRefs seq {seq} does not reference a user message"
            ));
        }
        let text = message
            .content
            .as_ref()
            .ok_or_else(|| format!("userCorrectionRefs seq {seq} has no text"))?;
        if !checkpoint.user_corrections.contains(text) {
            checkpoint.user_corrections.push(text.clone());
        }
    }
    for correction in &checkpoint.user_corrections {
        if !messages.iter().any(|(_, message)| {
            message.role == MessageRole::User && message.content.as_deref() == Some(correction)
        }) && previous
            .as_ref()
            .is_none_or(|prior| !prior.user_corrections.contains(correction))
        {
            return Err(format!(
                "user correction is not an exact persisted user message: {correction:?}"
            ));
        }
    }
    for command in exact_cli_commands(messages) {
        if !checkpoint.literal_commands.contains(&command) {
            checkpoint.literal_commands.push(command);
        }
    }
    let mut available_facts = HashMap::<String, ResultFact>::new();
    if let Some(previous) = previous.as_ref() {
        for fact in &previous.facts {
            available_facts.insert(fact.id.clone(), fact.clone());
        }
    }
    for fact in capsules.iter().flat_map(|capsule| capsule.facts.iter()) {
        available_facts.insert(fact.id.clone(), fact.clone());
    }
    checkpoint.facts.clear();
    checkpoint.evidence_refs.clear();
    let mut available_results = capsules
        .iter()
        .map(|capsule| capsule.result_id.clone())
        .collect::<Vec<_>>();
    if let Some(previous) = previous.as_ref() {
        merge_unique(
            &mut available_results,
            previous.evidence_refs.iter().cloned(),
        );
    }
    for result_id in &checkpoint.result_refs {
        if !available_results.contains(result_id) {
            return Err(format!(
                "resultRefs contains unknown result id {result_id:?}"
            ));
        }
        if !checkpoint.evidence_refs.contains(result_id) {
            checkpoint.evidence_refs.push(result_id.clone());
        }
    }
    for fact_id in &checkpoint.fact_refs {
        let fact = available_facts
            .get(fact_id)
            .ok_or_else(|| format!("factRefs contains unknown fact id {fact_id:?}"))?;
        checkpoint.facts.push(fact.clone());
        if !checkpoint.evidence_refs.contains(&fact.source.result_id) {
            checkpoint.evidence_refs.push(fact.source.result_id.clone());
        }
    }
    serde_json::to_string(&checkpoint)
        .map_err(|error| format!("unable to serialize validated checkpoint: {error}"))
}

fn merge_unique<T: PartialEq>(target: &mut Vec<T>, values: impl IntoIterator<Item = T>) {
    for value in values {
        if !target.contains(&value) {
            target.push(value);
        }
    }
}

fn exact_cli_commands(messages: &[(i64, ChatMessage)]) -> Vec<String> {
    let mut commands = Vec::new();
    for (_, message) in messages {
        for call in &message.tool_calls {
            let Ok(arguments) = serde_json::from_str::<Value>(&call.arguments) else {
                continue;
            };
            match call.name.as_str() {
                "cli_execute" => {
                    if let Some(command) = arguments.get("command").and_then(Value::as_str) {
                        commands.push(command.to_owned());
                    }
                }
                "cli_execute_batch" => {
                    commands.extend(
                        arguments
                            .get("commands")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                            .map(str::to_owned),
                    );
                }
                _ => {}
            }
        }
    }
    commands
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultReadArgs {
    result_id: String,
    query: Option<String>,
    offset: Option<u64>,
    limit: Option<usize>,
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
    use tokio::sync::Notify;

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

    #[derive(Default)]
    struct SteeringTransport {
        first_started: Notify,
        release_first: Notify,
        calls: AtomicUsize,
        requests: StdMutex<Vec<ModelRequest>>,
    }

    #[async_trait]
    impl ModelTransport for SteeringTransport {
        async fn stream(
            &self,
            request: ModelRequest,
            _cancellation: CancellationToken,
            _on_text_delta: Option<DeltaSink>,
        ) -> Result<ModelResponse, CoreError> {
            self.requests.lock().unwrap().push(request);
            let call = self.calls.fetch_add(1, AtomicOrdering::AcqRel);
            if call == 0 {
                self.first_started.notify_one();
                self.release_first.notified().await;
                Ok(text_response("draft"))
            } else {
                Ok(text_response("revised with steering"))
            }
        }
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
                    provider_context: None,
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
                provider_context: None,
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
                    provider_context: None,
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
                provider_context: None,
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
                    provider_context: None,
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
                provider_context: None,
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
                    provider_context: None,
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
                    provider_context: None,
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
                provider_context: None,
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
            provider_context: None,
        }
    }

    #[test]
    fn compaction_summary_validation_rejects_empty_and_non_strict_payloads() {
        assert_eq!(
            validate_checkpoint("", &[], None, &[]).unwrap_err(),
            "compaction response was empty"
        );
        assert!(
            validate_checkpoint(r#"{"summary":""}"#, &[], None, &[])
                .unwrap_err()
                .contains("summary field is empty")
        );
        assert!(
            validate_checkpoint(r#"{"summary":"ok","extra":true}"#, &[], None, &[])
                .unwrap_err()
                .contains("strict checkpoint JSON")
        );
        assert!(
            validate_checkpoint("plain text", &[], None, &[])
                .unwrap_err()
                .contains("strict checkpoint JSON")
        );
    }

    #[test]
    fn checkpoint_injects_exact_cli_commands_without_normalizing_spaces() {
        let messages = vec![(
            0,
            ChatMessage {
                role: MessageRole::Assistant,
                content: None,
                tool_calls: vec![ToolCall {
                    index: 0,
                    id: "call".to_owned(),
                    name: "cli_execute".to_owned(),
                    arguments: r#"{"command":"show system general"}"#.to_owned(),
                }],
                tool_call_id: None,
            },
        )];
        let checkpoint =
            validate_checkpoint(r#"{"summary":"keep command"}"#, &messages, None, &[]).unwrap();
        let value: Value = serde_json::from_str(&checkpoint).unwrap();
        assert_eq!(value["version"], 2);
        assert_eq!(value["literalCommands"][0], "show system general");
    }

    #[test]
    fn checkpoint_v2_resolves_corrections_and_facts_from_persisted_sources() {
        let messages = vec![(
            7,
            ChatMessage::text(MessageRole::User, "参数之间必须保留空格"),
        )];
        let raw = json!({"filesystem": "/data", "usage": "92%"}).to_string();
        let reduced = reduce_tool_result(
            "result-fact",
            "remote_exec",
            &json!({"command": "df -h /data"}),
            &raw,
            "completed",
            false,
            "检查 /data 使用率",
        )
        .unwrap();
        let usage = reduced
            .capsule
            .facts
            .iter()
            .find(|fact| fact.value == "92%")
            .unwrap();
        let checkpoint = validate_checkpoint(
            &json!({
                "version": 2,
                "summary": "retain the exact correction and disk fact",
                "userCorrectionRefs": [7],
                "factRefs": [usage.id],
                "resultRefs": ["result-fact"],
            })
            .to_string(),
            &messages,
            None,
            &[reduced.capsule],
        )
        .unwrap();
        let value: Value = serde_json::from_str(&checkpoint).unwrap();
        assert_eq!(value["version"], 2);
        assert_eq!(value["userCorrections"][0], "参数之间必须保留空格");
        assert_eq!(value["facts"][0]["value"], "92%");
        assert_eq!(value["evidenceRefs"][0], "result-fact");
    }

    #[test]
    fn checkpoint_can_drop_completed_query_noise() {
        let raw = json!({"rows": [1, 2, 3]}).to_string();
        let reduced = reduce_tool_result(
            "result-noise",
            "remote_exec",
            &json!({"command": "list completed records"}),
            &raw.repeat(4_000),
            "completed",
            false,
            "列出已完成记录",
        )
        .unwrap();
        let checkpoint = validate_checkpoint(
            r#"{"version":2,"summary":"query completed","factRefs":[],"resultRefs":[]}"#,
            &[],
            None,
            &[reduced.capsule],
        )
        .unwrap();
        let value: Value = serde_json::from_str(&checkpoint).unwrap();
        assert_eq!(value["facts"], json!([]));
        assert_eq!(value["evidenceRefs"], json!([]));
    }

    #[test]
    fn checkpoint_rejects_unknown_result_reference() {
        let error = validate_checkpoint(
            r#"{"version":2,"summary":"keep evidence","resultRefs":["missing"]}"#,
            &[],
            None,
            &[],
        )
        .unwrap_err();
        assert!(error.contains("unknown result id"));
    }

    #[test]
    fn prompt_estimate_includes_system_prompt_and_tool_schemas() {
        let message = ChatMessage::text(MessageRole::User, "inspect");
        let without_tools = estimate_prompt_tokens("system", &[], &[message.clone()], None);
        let with_tools = estimate_prompt_tokens(
            "system",
            &[ToolDefinition {
                name: "large_tool".to_owned(),
                description: "x".repeat(4_000),
                parameters: json!({"type":"object","properties":{"query":{"type":"string"}}}),
                parallel_safe: true,
            }],
            &[message],
            None,
        );
        assert!(with_tools > without_tools + 900);
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
                provider_context: None,
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
    async fn large_tool_results_are_projected_as_capsules_and_remain_searchable() {
        let temp = TempDir::new().unwrap();
        let transport = MockTransport::new(vec![
            Ok(ModelResponse {
                text: String::new(),
                tool_calls: vec![ToolCall {
                    index: 0,
                    id: "call-large".to_owned(),
                    name: "inspect_logs".to_owned(),
                    arguments: r#"{"query":"needle"}"#.to_owned(),
                }],
                finish_reason: "tool_calls".to_owned(),
                usage: None,
                provider_context: None,
            }),
            Ok(text_response("done")),
        ]);
        let runtime = CodexRuntime::new(config(&temp, 100_000), transport.clone()).unwrap();
        runtime.create_thread("root", None, None, "root").unwrap();
        let host = Arc::new(MockHost::default());
        let mut lines = (0..1_000)
            .map(|index| format!("INFO request {index} completed"))
            .collect::<Vec<_>>();
        lines.push("ERROR needle disk is 92% full".to_owned());
        let raw = lines.join("\n");
        host.tool_results
            .lock()
            .unwrap()
            .push_back(ToolExecutionResult {
                content: raw.clone(),
                is_error: false,
                status: "completed".to_owned(),
            });
        runtime
            .run_turn(
                "root",
                "find the needle error",
                vec![ToolDefinition {
                    name: "inspect_logs".to_owned(),
                    description: "inspect logs".to_owned(),
                    parameters: json!({"type":"object"}),
                    parallel_safe: true,
                }],
                host,
            )
            .await
            .unwrap();

        let requests = transport.requests.lock().unwrap();
        let projected = requests[1]
            .messages
            .iter()
            .rev()
            .find(|message| message.role == MessageRole::Tool)
            .and_then(|message| message.content.as_deref())
            .unwrap();
        assert!(projected.len() < raw.len());
        assert!(!projected.contains("INFO request 999 completed"));
        let capsule: Value = serde_json::from_str(projected).unwrap();
        assert_eq!(capsule["readRequired"], true);
        let result_id = capsule["resultId"].as_str().unwrap();
        drop(requests);

        let searched = runtime
            .read_result("root", &json!({"result_id": result_id, "query": "needle"}))
            .unwrap();
        assert!(searched.content.contains("ERROR needle disk is 92% full"));
        assert_eq!(
            std::fs::read_to_string(
                runtime
                    .store()
                    .tool_result("root", result_id)
                    .unwrap()
                    .raw_path
            )
            .unwrap(),
            raw
        );

        let one_line_raw = json!({
            "padding": "x".repeat(16 * 1024),
            "target": "needle-inside-minified-json",
        })
        .to_string();
        let one_line = reduce_tool_result(
            "result-one-line",
            "inspect_json",
            &json!({"query": "needle-inside-minified-json"}),
            &one_line_raw,
            "completed",
            false,
            "find needle-inside-minified-json",
        )
        .unwrap();
        runtime
            .store()
            .append_tool_result(
                "root",
                "call-one-line",
                "inspect_json",
                &ChatMessage {
                    role: MessageRole::Tool,
                    content: Some(one_line.projected_content),
                    tool_calls: Vec::new(),
                    tool_call_id: Some("call-one-line".to_owned()),
                },
                &one_line_raw,
                &one_line.capsule,
            )
            .unwrap();
        let searched = runtime
            .read_result(
                "root",
                &json!({
                    "result_id": "result-one-line",
                    "query": "needle-inside-minified-json",
                }),
            )
            .unwrap();
        let searched: Value = serde_json::from_str(&searched.content).unwrap();
        assert_eq!(searched["matchCount"], 1);
        assert_eq!(searched["matches"][0]["truncated"], true);
        assert!(
            searched["matches"][0]["text"]
                .as_str()
                .unwrap()
                .contains("needle-inside-minified-json")
        );
    }

    #[tokio::test]
    async fn reopening_a_thread_preserves_previous_turn_corrections() {
        let temp = TempDir::new().unwrap();
        let first_transport = MockTransport::new(vec![Ok(text_response("acknowledged"))]);
        let first_runtime = CodexRuntime::new(config(&temp, 10_000), first_transport).unwrap();
        first_runtime
            .create_thread("conversation-1", None, None, "root")
            .unwrap();
        first_runtime
            .run_turn(
                "conversation-1",
                "参数之间是有空格的",
                Vec::new(),
                Arc::new(MockHost::default()),
            )
            .await
            .unwrap();
        first_runtime.dispose().await.unwrap();
        drop(first_runtime);

        let second_transport = MockTransport::new(vec![Ok(text_response("used correction"))]);
        let second_runtime =
            CodexRuntime::new(config(&temp, 10_000), second_transport.clone()).unwrap();
        second_runtime.resume_thread("conversation-1").unwrap();
        second_runtime
            .run_turn(
                "conversation-1",
                "继续执行",
                Vec::new(),
                Arc::new(MockHost::default()),
            )
            .await
            .unwrap();

        let requests = second_transport.requests.lock().unwrap();
        let contents = requests[0]
            .messages
            .iter()
            .filter_map(|message| message.content.as_deref())
            .collect::<Vec<_>>();
        assert!(contents.contains(&"参数之间是有空格的"));
        assert!(contents.contains(&"继续执行"));
    }

    #[tokio::test]
    async fn steering_is_consumed_before_the_turn_can_finish() {
        let temp = TempDir::new().unwrap();
        let transport = Arc::new(SteeringTransport::default());
        let runtime = CodexRuntime::new(config(&temp, 10_000), transport.clone()).unwrap();
        runtime
            .create_thread("conversation-1", None, None, "root")
            .unwrap();
        let running_runtime = runtime.clone();
        let turn = tokio::spawn(async move {
            running_runtime
                .run_turn(
                    "conversation-1",
                    "执行 show system general",
                    Vec::new(),
                    Arc::new(MockHost::default()),
                )
                .await
        });
        transport.first_started.notified().await;
        runtime
            .steer_thread("conversation-1", "show 后面必须保留空格".to_owned())
            .await
            .unwrap();
        transport.release_first.notify_one();
        let result = turn.await.unwrap().unwrap();
        assert_eq!(result.text, "draftrevised with steering");
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].messages.iter().any(|message| {
            message.content.as_deref() == Some("show 后面必须保留空格")
        }));
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
                provider_context: None,
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
    async fn repeated_compaction_uses_previous_checkpoint_plus_only_new_tail() {
        let temp = TempDir::new().unwrap();
        let transport = MockTransport::new(vec![
            Ok(text_response(
                r#"{"version":2,"summary":"first checkpoint"}"#,
            )),
            Ok(text_response("first answer")),
            Ok(text_response(
                r#"{"version":2,"summary":"second checkpoint"}"#,
            )),
            Ok(text_response("second answer")),
        ]);
        let runtime = CodexRuntime::new(config(&temp, 1), transport.clone()).unwrap();
        runtime
            .create_thread("conversation", None, None, "root")
            .unwrap();
        runtime
            .run_turn(
                "conversation",
                "first original input",
                Vec::new(),
                Arc::new(MockHost::default()),
            )
            .await
            .unwrap();
        runtime
            .run_turn(
                "conversation",
                "second incremental input",
                Vec::new(),
                Arc::new(MockHost::default()),
            )
            .await
            .unwrap();

        let requests = transport.requests.lock().unwrap();
        let second_compaction_payload = requests[2].messages[1].content.as_deref().unwrap();
        assert!(second_compaction_payload.contains("first checkpoint"));
        assert!(second_compaction_payload.contains("first answer"));
        assert!(second_compaction_payload.contains("second incremental input"));
        assert!(!second_compaction_payload.contains("first original input"));
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

use std::{
    collections::{HashMap, VecDeque},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};

use dsh_codex_core::{CodexRuntime, CoreConfig, ModelTransport};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, watch, Mutex, Notify};

use super::{
    builtin,
    capability::{CapabilityRegistry, EvidenceRecord},
    domain::{
        now_ms, AgentConversation, AgentEvidence, AgentGoal, AgentGoalStatus, AgentInputMode,
        AgentQueuedInput, AgentTask, AgentTaskState, ExecutionJob,
    },
    dsh, hooks,
    mcp::McpConnectionManager,
    policy::{PolicyAction, PolicyContext, ToolEffect},
    skills,
    store::{AgentStore, GoalUpdate},
};
use crate::{
    config::{ConfigService, CredentialVault},
    session::{
        manager::SessionManager,
        ssh::{ExecOutputSink, ExecStream},
    },
    sftp::{service::local_entries, service::SftpService},
    types::{
        AgentEvent, AgentRunResult, AgentSettings, AgentSteerResult, AiProfile,
        SessionCatalogEntry, SessionCatalogTarget, SessionEnvironment, SessionProfile,
        SessionState, SessionTarget, TerminalScreenSnapshot, AGENT_EVENT_SCHEMA_VERSION,
    },
    AppError,
};

const APPROVAL_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_ARTIFACT_BYTES: u64 = 50 * 1024 * 1024;
const MAX_CONCURRENT_AGENT_RUNS: usize = 4;
const MAX_CACHED_AGENT_RUNTIMES: usize = 12;
const AGENT_RUNTIME_IDLE_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_NO_PROGRESS_CONTINUATIONS: u32 = 3;
const MAX_WAIT_CAPTURE_BYTES: usize = 4 * 1024 * 1024;

fn safe_artifact_key(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[derive(Debug)]
struct TerminalSendPlan {
    payload: String,
    observed_cursor_line: Option<String>,
    matched_prefix: String,
    mode: &'static str,
    cleaned_control_count: usize,
}

fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn literal_control_escape_len(input: &str, offset: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    if bytes.get(offset) != Some(&b'\\') {
        return None;
    }
    let rest = &bytes[offset + 1..];
    let (value, consumed) = if rest.first() == Some(&b'u') && rest.len() >= 5 {
        let mut value = 0_u8;
        for digit in &rest[1..5] {
            value = value.checked_mul(16)?.checked_add(hex_digit(*digit)?)?;
        }
        (value, 5)
    } else if rest.first() == Some(&b'x') && rest.len() >= 3 {
        let value = hex_digit(rest[1])?
            .checked_mul(16)?
            .checked_add(hex_digit(rest[2])?)?;
        (value, 3)
    } else if rest
        .first()
        .is_some_and(|digit| (b'0'..=b'7').contains(digit))
    {
        let mut value = 0_u8;
        let mut digits = 0;
        for digit in rest.iter().take(3) {
            if !(b'0'..=b'7').contains(digit) {
                break;
            }
            value = value.checked_mul(8)?.checked_add(*digit - b'0')?;
            digits += 1;
        }
        (value, digits)
    } else {
        return None;
    };
    (value.is_ascii_control() || value == 0x7f).then_some(consumed + 1)
}

/// Remove control bytes and escaped control notation from model-produced CLI
/// lines. Raw terminal input deliberately bypasses this helper so Ctrl+C and
/// other interactive keys remain available through terminal_send(raw).
fn sanitize_cli_command(input: &str) -> (String, usize) {
    let bytes = input.as_bytes();
    let mut output = String::with_capacity(input.len());
    let mut offset = 0;
    let mut removed = 0;
    let mut pending_separator = false;
    while offset < bytes.len() {
        if let Some(consumed) = literal_control_escape_len(input, offset) {
            offset += consumed;
            removed += 1;
            pending_separator = true;
            continue;
        }
        if bytes[offset] == 0x1b {
            removed += 1;
            pending_separator = true;
            offset += 1;
            if bytes.get(offset) == Some(&b'[') {
                offset += 1;
                while offset < bytes.len() {
                    let byte = bytes[offset];
                    offset += 1;
                    if (0x40..=0x7e).contains(&byte) {
                        break;
                    }
                }
            } else if bytes.get(offset) == Some(&b']') {
                offset += 1;
                let mut previous_escape = false;
                while offset < bytes.len() {
                    let byte = bytes[offset];
                    offset += 1;
                    if byte == 0x07 || (previous_escape && byte == b'\\') {
                        break;
                    }
                    previous_escape = byte == 0x1b;
                }
            }
            continue;
        }
        let character = input[offset..].chars().next().expect("valid UTF-8 offset");
        let width = character.len_utf8();
        if character.is_control() || character == '\u{7f}' {
            if character == '\t' {
                output.push(' ');
                pending_separator = false;
            } else {
                pending_separator = true;
            }
            removed += 1;
        } else {
            if pending_separator
                && !output.is_empty()
                && output
                    .chars()
                    .last()
                    .is_some_and(|last| !last.is_whitespace())
                && !character.is_whitespace()
            {
                output.push(' ');
            }
            output.push(character);
            pending_separator = false;
        }
        offset += width;
    }
    (output, removed)
}

fn terminal_send_plan(
    command: &str,
    newline: bool,
    input_mode: &str,
    screen: Option<&TerminalScreenSnapshot>,
) -> Result<TerminalSendPlan, AppError> {
    let (sanitized, cleaned_control_count) = if input_mode == "raw" {
        (command.to_owned(), 0)
    } else {
        sanitize_cli_command(command)
    };
    let normalized = sanitized.replace("\r\n", "\n").replace('\r', "\n");
    let observed = screen.map(|value| value.cursor_line_before_cursor.as_str());
    let (remaining, matched_prefix, mode) = match input_mode {
        "raw" => (normalized.as_str(), String::new(), "raw"),
        "complete_line" => match observed {
            None => (
                normalized.as_str(),
                String::new(),
                "complete_line_no_screen",
            ),
            Some(cursor_line) => {
                let desired_first_line = normalized.split('\n').next().unwrap_or_default();
                let editable_input = if desired_first_line.starts_with(cursor_line) {
                    cursor_line
                } else {
                    terminal_editable_input(cursor_line).unwrap_or(cursor_line)
                };
                if desired_first_line.starts_with(editable_input) {
                    let matched_bytes = editable_input.len();
                    (
                        &normalized[matched_bytes..],
                        desired_first_line[..matched_bytes].to_owned(),
                        "complete_line",
                    )
                } else {
                    return Err(AppError::InvalidInput(format!(
                        "terminal input does not match the requested complete command; no text was sent\ncurrent cursor line: {cursor_line}\nrequested command: {command}"
                    )));
                }
            }
        },
        other => {
            return Err(AppError::InvalidInput(format!(
                "terminal_send input_mode must be 'complete_line' or 'raw', got '{other}'"
            )))
        }
    };
    let mut payload = remaining.replace('\n', "\r");
    if newline && !payload.ends_with('\r') {
        payload.push('\r');
    }
    Ok(TerminalSendPlan {
        payload,
        observed_cursor_line: observed.map(str::to_owned),
        matched_prefix,
        mode,
        cleaned_control_count,
    })
}

fn terminal_editable_input(cursor_line: &str) -> Option<&str> {
    let prompt_end = if cursor_line.starts_with('[') {
        let bracket_end = cursor_line.find(']')? + 1;
        cursor_line[bracket_end..]
            .chars()
            .next()
            .filter(|character| matches!(character, '#' | '$' | '>'))
            .map_or(bracket_end, |character| bracket_end + character.len_utf8())
    } else {
        let (marker, character) = cursor_line
            .char_indices()
            .find(|(_, character)| matches!(character, '#' | '$' | '>'))?;
        let mut end = marker + character.len_utf8();
        if character == '>' {
            for trailing in cursor_line[end..].chars() {
                if trailing != '>' {
                    break;
                }
                end += trailing.len_utf8();
            }
        }
        end
    };
    let editable = &cursor_line[prompt_end..];
    Some(editable.strip_prefix(' ').unwrap_or(editable))
}

fn terminal_edit_payload(
    operation: &str,
    count: u64,
    text: Option<&str>,
) -> Result<String, AppError> {
    let count = usize::try_from(count).unwrap_or(256).clamp(1, 256);
    let payload = match operation {
        "cancel_line" => "\u{3}".to_owned(),
        "backspace" => "\u{8}".repeat(count),
        "delete" => "\u{7f}".repeat(count),
        "cursor_left" => "\u{1b}[D".repeat(count),
        "cursor_right" => "\u{1b}[C".repeat(count),
        "home" => "\u{1}".to_owned(),
        "end" => "\u{5}".to_owned(),
        // Ctrl+A + Ctrl+K is the common readline-compatible “go home and
        // delete to end” pair, so replacement is safe even when the cursor is
        // in the middle of the current input line.
        "clear_current_line" => "\u{1}\u{b}".to_owned(),
        "replace_current_input" => {
            let replacement = text.ok_or_else(|| {
                AppError::InvalidInput(
                    "terminal_edit replace_current_input requires a text argument".to_owned(),
                )
            })?;
            let (replacement, _) = sanitize_cli_command(replacement);
            format!("\u{1}\u{b}{replacement}")
        }
        other => {
            return Err(AppError::InvalidInput(format!(
                "terminal_edit operation must be one of cancel_line, backspace, delete, cursor_left, cursor_right, home, end, clear_current_line, replace_current_input; got '{other}'"
            )))
        }
    };
    Ok(payload)
}

fn cli_screen_state(screen: Option<&TerminalScreenSnapshot>) -> Option<&'static str> {
    let line = screen?
        .cursor_line_before_cursor
        .trim_end()
        .to_ascii_lowercase();
    if line.contains("--more--")
        || line.ends_with("password:")
        || line.ends_with("(y/n)")
        || line.ends_with("[y/n]")
        || line.ends_with("yes/no]")
    {
        return Some("interactive");
    }
    line.ends_with(['#', '$', '>', '%']).then_some("prompt")
}

fn transcript_delta(before: &str, after: &str) -> String {
    after
        .strip_prefix(before)
        .map_or_else(|| after.to_owned(), str::to_owned)
}

fn bounded_text_preview(value: &str, limit: usize) -> (String, bool) {
    if value.len() <= limit {
        return (value.to_owned(), false);
    }
    let head = limit.saturating_mul(3) / 4;
    let tail = limit.saturating_sub(head);
    let mut head_end = head.min(value.len());
    while !value.is_char_boundary(head_end) {
        head_end = head_end.saturating_sub(1);
    }
    let mut tail_start = value.len().saturating_sub(tail);
    while tail_start < value.len() && !value.is_char_boundary(tail_start) {
        tail_start += 1;
    }
    (
        format!(
            "{}\n...[CLI output preview truncated; use terminal_context for transcript ranges]...\n{}",
            &value[..head_end],
            &value[tail_start..]
        ),
        true,
    )
}

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
    active: Mutex<HashMap<String, ActiveAgentRun>>,
    active_changed: Notify,
    approvals: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    host_facts: Mutex<HashMap<String, (Instant, Value)>>,
    jobs: Arc<Mutex<HashMap<String, JobRuntime>>>,
    runtimes: Mutex<HashMap<String, RuntimeEntry>>,
    mcp: Arc<McpConnectionManager>,
}

struct ActiveAgentRun {
    turn_id: String,
    abort: watch::Sender<bool>,
    steer: mpsc::Sender<String>,
    sink: Arc<dyn AgentEventSink>,
}

struct RuntimeEntry {
    fingerprint: String,
    runtime: Arc<CodexRuntime>,
    last_used: Instant,
}

struct JobRuntime {
    task_id: String,
    goal_id: Option<String>,
    cancel: watch::Sender<bool>,
}

struct AgentTurnRequest {
    run_id: String,
    conversation_id: String,
    goal_id: Option<String>,
    continuation_index: u32,
    profile_id: String,
    prompt: String,
    active_session_id: Option<String>,
    sink: Arc<dyn AgentEventSink>,
    permission: Option<crate::types::AgentPermissionMode>,
}

struct BackgroundJobRequest {
    run_id: String,
    call_id: String,
    session_id: String,
    command: String,
    timeout_seconds: u64,
    sink: Arc<dyn AgentEventSink>,
    continuation_sink: Arc<dyn AgentEventSink>,
}

impl AgentService {
    pub(crate) fn config_path(&self) -> &std::path::Path {
        self.config.path()
    }

    pub(crate) fn store(&self) -> &AgentStore {
        &self.store
    }

    pub(crate) fn mcp(&self) -> &McpConnectionManager {
        &self.mcp
    }

    pub async fn shutdown(&self) {
        {
            let active = self.active.lock().await;
            for run in active.values() {
                let _ = run.abort.send(true);
            }
        }
        {
            let jobs = self.jobs.lock().await;
            for job in jobs.values() {
                let _ = job.cancel.send(true);
            }
        }
        self.reject_pending_approvals().await;
        let runtimes = {
            let mut runtimes = self.runtimes.lock().await;
            runtimes
                .drain()
                .map(|(_, entry)| entry.runtime)
                .collect::<Vec<_>>()
        };
        for runtime in runtimes {
            let _ = runtime.dispose().await;
        }
        self.mcp.close_all().await;
        tracing::info!(
            event = "agent_runtime_shutdown",
            "Agent runtimes and MCP providers closed"
        );
    }

    pub fn new(
        config: Arc<ConfigService>,
        vault: Arc<dyn CredentialVault>,
        sessions: Arc<SessionManager>,
        sftp: Arc<SftpService>,
    ) -> Result<Self, AppError> {
        let store_path = config
            .path()
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("agent.db");
        let store = Arc::new(AgentStore::new(store_path));
        let recovered = store.recover_stale_tasks(now_ms().saturating_add(1))?;
        if recovered > 0 {
            tracing::warn!(
                recovered_turns = recovered,
                "recovered interrupted Agent Turns; their Goals were paused for explicit resume"
            );
        }
        Ok(Self {
            config,
            vault,
            sessions,
            sftp,
            store,
            active: Mutex::new(HashMap::new()),
            active_changed: Notify::new(),
            approvals: Mutex::new(HashMap::new()),
            host_facts: Mutex::new(HashMap::new()),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            runtimes: Mutex::new(HashMap::new()),
            mcp: Arc::new(McpConnectionManager::default()),
        })
    }

    pub(crate) async fn runtime_for(
        &self,
        conversation_id: &str,
        fingerprint: String,
        config: CoreConfig,
        transport: Arc<dyn ModelTransport>,
    ) -> Result<Arc<CodexRuntime>, AppError> {
        let now = Instant::now();
        let active_conversations = self
            .active
            .lock()
            .await
            .keys()
            .cloned()
            .collect::<std::collections::HashSet<_>>();
        let mut stale = Vec::new();
        let mut runtimes = self.runtimes.lock().await;
        let stale_ids = runtimes
            .iter()
            .filter_map(|(id, entry)| {
                (id != conversation_id
                    && !active_conversations.contains(id)
                    && now.duration_since(entry.last_used) >= AGENT_RUNTIME_IDLE_TTL)
                    .then_some(id.clone())
            })
            .collect::<Vec<_>>();
        for id in stale_ids {
            if let Some(entry) = runtimes.remove(&id) {
                stale.push(entry.runtime);
            }
        }
        if let Some(entry) = runtimes.get_mut(conversation_id) {
            if entry.fingerprint == fingerprint {
                entry.last_used = now;
                let runtime = entry.runtime.clone();
                drop(runtimes);
                for runtime in stale {
                    let _ = runtime.dispose().await;
                }
                return Ok(runtime);
            }
        }
        if let Some(entry) = runtimes.remove(conversation_id) {
            stale.push(entry.runtime);
        }
        while runtimes.len() >= MAX_CACHED_AGENT_RUNTIMES {
            let Some(oldest_id) = runtimes
                .iter()
                .filter(|(id, _)| !active_conversations.contains(*id))
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(id, _)| id.clone())
            else {
                break;
            };
            if let Some(entry) = runtimes.remove(&oldest_id) {
                stale.push(entry.runtime);
            }
        }
        let runtime = CodexRuntime::new(config, transport).map_err(dsh::core_error)?;
        runtimes.insert(
            conversation_id.to_owned(),
            RuntimeEntry {
                fingerprint,
                runtime: runtime.clone(),
                last_used: now,
            },
        );
        drop(runtimes);
        for stale_runtime in stale {
            let _ = stale_runtime.dispose().await;
        }
        Ok(runtime)
    }

    pub async fn run(
        self: &Arc<Self>,
        profile_id: &str,
        prompt: String,
        active_session_id: Option<String>,
        sink: Arc<dyn AgentEventSink>,
    ) -> Result<AgentRunResult, AppError> {
        self.run_in_conversation(profile_id, None, prompt, active_session_id, sink, None)
            .await
    }

    pub async fn run_with_permission(
        self: &Arc<Self>,
        profile_id: &str,
        prompt: String,
        active_session_id: Option<String>,
        sink: Arc<dyn AgentEventSink>,
        permission: Option<crate::types::AgentPermissionMode>,
    ) -> Result<AgentRunResult, AppError> {
        self.run_in_conversation(
            profile_id,
            None,
            prompt,
            active_session_id,
            sink,
            permission,
        )
        .await
    }

    pub fn create_conversation(
        &self,
        profile_id: &str,
        title: Option<&str>,
    ) -> Result<AgentConversation, AppError> {
        self.ai_profile(profile_id)?;
        self.store.create_conversation(
            &uuid::Uuid::new_v4().to_string(),
            profile_id,
            title.unwrap_or("新对话"),
        )
    }

    pub fn conversations(&self, limit: usize) -> Result<Vec<AgentConversation>, AppError> {
        self.store.conversations(limit)
    }

    pub fn conversation_tasks(&self, conversation_id: &str) -> Result<Vec<AgentTask>, AppError> {
        self.store.conversation_tasks(conversation_id)
    }

    pub fn conversation_goal(&self, conversation_id: &str) -> Result<Option<AgentGoal>, AppError> {
        self.store.conversation_goal(conversation_id)
    }

    pub async fn queue_input(
        &self,
        conversation_id: &str,
        input: String,
    ) -> Result<AgentQueuedInput, AppError> {
        let input = input.trim();
        if input.is_empty() {
            return Err(AppError::InvalidInput(
                "queued Agent input is required".to_owned(),
            ));
        }
        let goal = self.store.conversation_goal(conversation_id)?;
        if goal.as_ref().is_none_or(|goal| goal.status.is_terminal()) {
            return Err(AppError::Ai(
                "当前对话没有可接收排队输入的活动 Goal".to_owned(),
            ));
        }
        self.store.enqueue_input(
            conversation_id,
            goal.as_ref().map(|goal| goal.id.as_str()),
            input,
            AgentInputMode::Queue,
        )
    }

    pub async fn pause_goal(&self, goal_id: &str) -> Result<AgentGoal, AppError> {
        let goal = self
            .store
            .goal(goal_id)?
            .ok_or_else(|| AppError::NotFound(format!("agent goal '{goal_id}'")))?;
        let paused = self.store.update_goal(
            goal_id,
            GoalUpdate::new(AgentGoalStatus::Paused)
                .current_turn(goal.current_turn_id.as_deref())
                .checkpoint(goal.last_checkpoint.as_ref())
                .blocked_reason(Some("Paused by user"))
                .no_progress(goal.no_progress_count),
        )?;
        if let Some(active) = self.active.lock().await.get(&goal.conversation_id) {
            let _ = active.abort.send(true);
        }
        Ok(paused)
    }

    pub fn resume_goal(&self, goal_id: &str) -> Result<AgentGoal, AppError> {
        let goal = self
            .store
            .goal(goal_id)?
            .ok_or_else(|| AppError::NotFound(format!("agent goal '{goal_id}'")))?;
        self.store.update_goal(
            goal_id,
            GoalUpdate::new(AgentGoalStatus::Active)
                .current_turn(goal.current_turn_id.as_deref())
                .checkpoint(goal.last_checkpoint.as_ref())
                .no_progress(goal.no_progress_count),
        )
    }

    pub async fn cancel_goal(&self, goal_id: &str) -> Result<AgentGoal, AppError> {
        let goal = self
            .store
            .goal(goal_id)?
            .ok_or_else(|| AppError::NotFound(format!("agent goal '{goal_id}'")))?;
        let canceled = self.store.update_goal(
            goal_id,
            GoalUpdate::new(AgentGoalStatus::Canceled)
                .current_turn(goal.current_turn_id.as_deref())
                .checkpoint(goal.last_checkpoint.as_ref())
                .no_progress(goal.no_progress_count),
        )?;
        if let Some(active) = self.active.lock().await.get(&goal.conversation_id) {
            let _ = active.abort.send(true);
        }
        Ok(canceled)
    }

    pub async fn conversation_delete(&self, conversation_id: &str) -> Result<bool, AppError> {
        if self.active.lock().await.contains_key(conversation_id) {
            return Err(AppError::Ai(
                "正在运行的 Agent 对话不能删除，请先停止或等待当前 Turn 完成".to_owned(),
            ));
        }
        if self
            .store
            .running_job_count_for_conversation(conversation_id)?
            > 0
        {
            return Err(AppError::Ai(
                "对话仍有后台 Job 正在运行，请先等待完成或取消 Job".to_owned(),
            ));
        }
        let (task_ids, goal_ids) = self.store.conversation_storage_ids(conversation_id)?;
        let cached_runtime = self
            .runtimes
            .lock()
            .await
            .get(conversation_id)
            .map(|entry| entry.runtime.clone());
        let core_delete = if let Some(runtime) = cached_runtime.as_ref() {
            runtime.delete_thread_tree(conversation_id).await
        } else {
            dsh_codex_core::delete_persisted_thread_tree(
                self.config_path()
                    .parent()
                    .unwrap_or_else(|| Path::new("."))
                    .join("dsh-codex-agent"),
                conversation_id,
            )
        };
        if let Err(error) = core_delete {
            if !matches!(error, dsh_codex_core::CoreError::ThreadNotFound(_)) {
                return Err(dsh::core_error(error));
            }
        }
        let deleted = self.store.delete_conversation(conversation_id)?;
        if !deleted {
            return Ok(false);
        }
        if let Some(entry) = self.runtimes.lock().await.remove(conversation_id) {
            let _ = entry.runtime.dispose().await;
        }
        self.remove_conversation_artifacts(&task_ids, &goal_ids);
        Ok(true)
    }

    fn remove_conversation_artifacts(&self, task_ids: &[String], goal_ids: &[String]) {
        let root = self
            .store
            .path()
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("artifacts");
        for (kind, id, path) in task_ids.iter().map(|id| ("task", id, root.join(id))).chain(
            goal_ids
                .iter()
                .map(|id| ("goal", id, root.join("goals").join(id))),
        ) {
            if !safe_artifact_key(id) {
                tracing::warn!(
                    event = "agent_artifact_cleanup_skipped",
                    kind,
                    id,
                    "refusing to delete an artifact path with an unsafe persisted id"
                );
                continue;
            }
            if let Err(error) = fs::remove_dir_all(&path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!(
                        event = "agent_artifact_cleanup_failed",
                        kind,
                        id,
                        path = %path.display(),
                        %error,
                        "unable to remove deleted conversation artifacts"
                    );
                }
            }
        }
    }

    pub async fn run_in_conversation(
        self: &Arc<Self>,
        profile_id: &str,
        conversation_id: Option<String>,
        prompt: String,
        active_session_id: Option<String>,
        sink: Arc<dyn AgentEventSink>,
        permission: Option<crate::types::AgentPermissionMode>,
    ) -> Result<AgentRunResult, AppError> {
        let conversation_id = match conversation_id {
            Some(id) => {
                let conversation = self
                    .store
                    .conversation(&id)?
                    .ok_or_else(|| AppError::NotFound(format!("agent conversation '{id}'")))?;
                if conversation.profile_id != profile_id {
                    return Err(AppError::InvalidInput(format!(
                        "agent conversation '{}' belongs to AI profile '{}', not '{}'",
                        conversation.id, conversation.profile_id, profile_id
                    )));
                }
                conversation.id
            }
            None => self.create_conversation(profile_id, Some(&prompt))?.id,
        };
        let mut goal = match self.store.conversation_goal(&conversation_id)? {
            Some(goal) if !goal.status.is_terminal() => goal,
            _ => self.store.create_goal(&conversation_id, &prompt, None)?,
        };
        if goal.status != AgentGoalStatus::Active {
            goal = self.store.update_goal(
                &goal.id,
                GoalUpdate::new(AgentGoalStatus::Active).no_progress(goal.no_progress_count),
            )?;
        }

        let mut next_prompt = prompt;
        loop {
            let turn_id = uuid::Uuid::new_v4().to_string();
            goal = self.store.update_goal(
                &goal.id,
                GoalUpdate::new(AgentGoalStatus::Active)
                    .current_turn(Some(&turn_id))
                    .no_progress(goal.no_progress_count),
            )?;
            let result = self
                .run_with_task_id(AgentTurnRequest {
                    run_id: turn_id,
                    conversation_id: conversation_id.clone(),
                    goal_id: Some(goal.id.clone()),
                    continuation_index: goal.continuation_count,
                    profile_id: profile_id.to_owned(),
                    prompt: next_prompt,
                    active_session_id: active_session_id.clone(),
                    sink: sink.clone(),
                    permission,
                })
                .await;

            let mut completed = match result {
                Ok(completed) => completed,
                Err(error) => {
                    let detail = error.detail();
                    let _ = self.store.update_goal(
                        &goal.id,
                        GoalUpdate::new(AgentGoalStatus::Failed)
                            .current_turn(goal.current_turn_id.as_deref())
                            .checkpoint(Some(&json!({ "phase": "turn", "error": detail })))
                            .last_error(Some(&detail))
                            .no_progress(goal.no_progress_count),
                    );
                    return Err(error);
                }
            };

            let token_total = goal.tokens_used.saturating_add(completed.total_tokens);
            if goal
                .token_budget
                .is_some_and(|budget| token_total >= budget)
            {
                completed.finish_reason = "budget_limited".to_owned();
                self.store.update_goal(
                    &goal.id,
                    GoalUpdate::new(AgentGoalStatus::BudgetLimited)
                        .current_turn(Some(&completed.turn_id))
                        .tokens(completed.total_tokens)
                        .checkpoint(Some(&json!({
                            "reason": "token_budget",
                            "tokensUsed": token_total,
                        })))
                        .blocked_reason(Some("Goal token budget reached"))
                        .no_progress(goal.no_progress_count),
                )?;
                return Ok(completed);
            }

            match completed.finish_reason.as_str() {
                "continuation_required" => {
                    let no_progress_count = if completed.tool_calls == 0 {
                        goal.no_progress_count.saturating_add(1)
                    } else {
                        0
                    };
                    if no_progress_count >= MAX_NO_PROGRESS_CONTINUATIONS {
                        completed.finish_reason = "loop_detected".to_owned();
                        self.store.update_goal(
                            &goal.id,
                            GoalUpdate::new(AgentGoalStatus::Blocked)
                                .current_turn(Some(&completed.turn_id))
                                .tokens(completed.total_tokens)
                                .checkpoint(Some(&json!({
                                    "reason": "no_progress",
                                    "continuations": no_progress_count,
                                })))
                                .blocked_reason(Some(
                                    "Agent reached repeated continuation boundaries without tool progress",
                                ))
                                .no_progress(no_progress_count),
                        )?;
                        return Ok(completed);
                    }
                    goal = self.store.update_goal(
                        &goal.id,
                        GoalUpdate::new(AgentGoalStatus::Active)
                            .current_turn(Some(&completed.turn_id))
                            .tokens(completed.total_tokens)
                            .continuation(1)
                            .checkpoint(Some(&json!({
                                "reason": "turn_step_budget",
                                "turnId": completed.turn_id,
                                "steps": completed.steps,
                                "modelRequests": completed.model_requests,
                                "toolCalls": completed.tool_calls,
                            })))
                            .no_progress(no_progress_count),
                    )?;
                    next_prompt = format!(
                        "Continue the persisted Goal without repeating completed work. Goal: {}. Read the existing Thread history and latest tool evidence, then continue from the last verified checkpoint.",
                        goal.objective
                    );
                }
                "stop" => {
                    if let Some(queued) = self.store.consume_next_input(&conversation_id)? {
                        goal = self.store.update_goal(
                            &goal.id,
                            GoalUpdate::new(AgentGoalStatus::Active)
                                .current_turn(Some(&completed.turn_id))
                                .tokens(completed.total_tokens)
                                .continuation(1)
                                .checkpoint(Some(&json!({
                                    "reason": "queued_user_input",
                                    "inputId": queued.id,
                                }))),
                        )?;
                        next_prompt = queued.content;
                        continue;
                    }
                    let persisted = self
                        .store
                        .goal(&goal.id)?
                        .ok_or_else(|| AppError::NotFound(format!("agent goal '{}'", goal.id)))?;
                    if persisted.status != AgentGoalStatus::Active {
                        completed.finish_reason = persisted.status.as_str().to_owned();
                        self.store.update_goal(
                            &goal.id,
                            GoalUpdate::new(persisted.status)
                                .current_turn(Some(&completed.turn_id))
                                .tokens(completed.total_tokens)
                                .checkpoint(persisted.last_checkpoint.as_ref())
                                .last_error(persisted.last_error.as_deref())
                                .blocked_reason(persisted.blocked_reason.as_deref())
                                .no_progress(persisted.no_progress_count),
                        )?;
                        return Ok(completed);
                    }
                    self.store.update_goal(
                        &goal.id,
                        GoalUpdate::new(AgentGoalStatus::Completed)
                            .current_turn(Some(&completed.turn_id))
                            .tokens(completed.total_tokens)
                            .checkpoint(Some(&json!({ "reason": "model_stop" }))),
                    )?;
                    return Ok(completed);
                }
                "aborted" => {
                    let persisted = self
                        .store
                        .goal(&goal.id)?
                        .ok_or_else(|| AppError::NotFound(format!("agent goal '{}'", goal.id)))?;
                    let status = match persisted.status {
                        AgentGoalStatus::Paused | AgentGoalStatus::Canceled => persisted.status,
                        _ => AgentGoalStatus::Canceled,
                    };
                    completed.finish_reason = status.as_str().to_owned();
                    self.store.update_goal(
                        &goal.id,
                        GoalUpdate::new(status)
                            .current_turn(Some(&completed.turn_id))
                            .tokens(completed.total_tokens)
                            .checkpoint(Some(&json!({
                                "reason": if status == AgentGoalStatus::Paused {
                                    "user_pause"
                                } else {
                                    "user_abort"
                                }
                            })))
                            .blocked_reason(persisted.blocked_reason.as_deref())
                            .no_progress(persisted.no_progress_count),
                    )?;
                    return Ok(completed);
                }
                _ => {
                    self.store.update_goal(
                        &goal.id,
                        GoalUpdate::new(AgentGoalStatus::Failed)
                            .current_turn(Some(&completed.turn_id))
                            .tokens(completed.total_tokens)
                            .checkpoint(Some(&json!({ "reason": completed.finish_reason })))
                            .last_error(Some(&format!(
                                "Turn finished with {}",
                                completed.finish_reason
                            )))
                            .no_progress(goal.no_progress_count),
                    )?;
                    return Ok(completed);
                }
            }
        }
    }

    async fn run_with_task_id(
        self: &Arc<Self>,
        request: AgentTurnRequest,
    ) -> Result<AgentRunResult, AppError> {
        let AgentTurnRequest {
            run_id,
            conversation_id,
            goal_id,
            continuation_index,
            profile_id,
            prompt,
            active_session_id,
            sink,
            permission,
        } = request;
        if prompt.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "agent prompt is required".to_owned(),
            ));
        }
        let profile = self.ai_profile(&profile_id)?;
        let mut settings = self.config.agent_settings()?;
        if let Some(permission) = permission {
            settings.permission_mode = permission;
        }
        let (abort_tx, abort_rx) = watch::channel(false);
        let (steer_tx, steer_rx) = mpsc::channel(32);
        let mut active = self.active.lock().await;
        if active.contains_key(&conversation_id) {
            return Err(AppError::Ai(
                "this conversation already has an active agent run".to_owned(),
            ));
        }
        if active.len() >= MAX_CONCURRENT_AGENT_RUNS {
            return Err(AppError::Ai(format!(
                "agent concurrency limit reached ({MAX_CONCURRENT_AGENT_RUNS})"
            )));
        }
        let model_routes = crate::ai::routing::resolve_model_routes(
            self.config.as_ref(),
            self.vault.as_ref(),
            &profile,
        )?;
        if model_routes.is_empty() {
            return Err(AppError::Ai(
                "没有启用任何 AI 模型，请在 AI 服务设置中添加主模型".to_owned(),
            ));
        }
        let timestamp = now_ms();
        let turn_index = self.store.next_turn_index(&conversation_id)?;
        let goal_id_for_run = goal_id.clone();
        self.store.create_task(&AgentTask {
            id: run_id.clone(),
            conversation_id: conversation_id.clone(),
            goal_id,
            turn_index,
            continuation_index,
            profile_id: profile.id.clone(),
            // The active UI session is only a task-time candidate. Persisting it
            // here would incorrectly describe the whole conversation as bound
            // before the model has selected any SSH target.
            session_id: None,
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
        let continuation_sink = sink.clone();
        let sink: Arc<dyn AgentEventSink> = Arc::new(PersistedEventSink {
            store: self.store.clone(),
            downstream: sink,
            secrets: model_routes
                .iter()
                .map(|route| route.api_key.clone())
                .collect(),
        });
        active.insert(
            conversation_id.clone(),
            ActiveAgentRun {
                turn_id: run_id.clone(),
                abort: abort_tx.clone(),
                steer: steer_tx,
                sink: sink.clone(),
            },
        );
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
        let result = dsh::run(
            self.clone(),
            profile,
            settings,
            prompt,
            active_session_id,
            sink.clone(),
            continuation_sink,
            abort_rx,
            model_routes,
            run_id.clone(),
            conversation_id.clone(),
            steer_rx,
        )
        .await;
        if !matches!(&result, Ok(completed) if matches!(completed.finish_reason.as_str(), "stop" | "continuation_required"))
        {
            if let Some(goal_id) = goal_id_for_run.as_deref() {
                self.cancel_jobs_for_goal(goal_id).await;
            } else {
                self.cancel_jobs_for_task(&run_id).await;
            }
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
        self.active.lock().await.remove(&conversation_id);
        self.active_changed.notify_waiters();
        match &result {
            Ok(completed) => {
                let state = match completed.finish_reason.as_str() {
                    "stop" | "continuation_required" => AgentTaskState::Succeeded,
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
                let detail = error.detail();
                let mut failed = event(&run_id, "complete", Some("failed".to_owned()));
                failed.content = Some(detail.clone());
                failed.is_error = Some(true);
                failed.error_code = Some(error.code().to_owned());
                let _ = sink.send(failed);
                self.store.transition_task(
                    &run_id,
                    AgentTaskState::Failed,
                    Some("error"),
                    0,
                    Some(("agent_run_failed", &detail)),
                )?;
            }
        }
        result
    }

    pub async fn steer(
        &self,
        conversation_id: &str,
        input: String,
    ) -> Result<AgentSteerResult, AppError> {
        let input = input.trim().to_owned();
        if input.is_empty() {
            return Err(AppError::InvalidInput(
                "agent steering input is required".to_owned(),
            ));
        }
        let active = self.active.lock().await;
        let active = active
            .get(conversation_id)
            .ok_or_else(|| AppError::Ai("没有正在运行的 Agent 回合".to_owned()))?;
        let mut event = event(
            &active.turn_id,
            "user_steer",
            Some("追加要求已接收".to_owned()),
        );
        event.content = Some(input.clone());
        event.arguments = Some(json!({
            "conversationId": conversation_id,
            "turnId": active.turn_id,
        }));
        active.sink.send(event)?;
        active.steer.try_send(input).map_err(|error| match error {
            mpsc::error::TrySendError::Full(_) => {
                AppError::Ai("追加要求队列已满（上限 32 条），请等待 Agent 消费后重试".to_owned())
            }
            mpsc::error::TrySendError::Closed(_) => {
                AppError::Ai("当前 Agent 回合已结束，追加要求未发送".to_owned())
            }
        })?;
        Ok(AgentSteerResult {
            conversation_id: conversation_id.to_owned(),
            turn_id: active.turn_id.clone(),
            accepted: true,
        })
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
        !self.active.lock().await.is_empty()
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
        for active in self.active.lock().await.values() {
            let _ = active.abort.send(true);
        }
        self.reject_pending_approvals().await;
    }

    pub async fn abort_conversation(&self, conversation_id: &str) -> Result<(), AppError> {
        let active = self.active.lock().await;
        let active = active
            .get(conversation_id)
            .ok_or_else(|| AppError::Ai("该对话没有正在运行的 Agent 回合".to_owned()))?;
        let _ = active.abort.send(true);
        Ok(())
    }

    pub(crate) async fn wait_for_approval(
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

    fn session_catalog(
        &self,
        query: Option<&str>,
        active_session_id: Option<&str>,
    ) -> Result<Vec<SessionCatalogEntry>, AppError> {
        let profiles = self.config.profile_list()?;
        let live_sessions = self.sessions.list()?;
        let normalized_query = query
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase());

        profiles
            .into_iter()
            .filter(|profile| {
                let Some(query) = normalized_query.as_deref() else {
                    return true;
                };
                let target_text = match &profile.target {
                    SessionTarget::Ssh {
                        host,
                        port,
                        username,
                        ..
                    } => format!("{username}@{host}:{port}"),
                    SessionTarget::Local { shell } => shell.clone(),
                };
                [
                    profile.id.as_str(),
                    profile.name.as_str(),
                    profile.group.as_str(),
                    target_text.as_str(),
                ]
                .iter()
                .any(|value| value.to_ascii_lowercase().contains(query))
            })
            .map(|profile| {
                let live = live_sessions
                    .iter()
                    .filter(|session| session.profile_id == profile.id)
                    .find(|session| Some(session.session_id.as_str()) == active_session_id)
                    .or_else(|| {
                        live_sessions
                            .iter()
                            .find(|session| session.profile_id == profile.id)
                    });
                let last_failure = self.sessions.last_failure(&profile.id)?;
                let target = match &profile.target {
                    SessionTarget::Ssh {
                        host,
                        port,
                        username,
                        ..
                    } => SessionCatalogTarget {
                        kind: "ssh".to_owned(),
                        host: Some(host.clone()),
                        port: Some(*port),
                        username: Some(username.clone()),
                        shell: None,
                    },
                    SessionTarget::Local { shell } => SessionCatalogTarget {
                        kind: "local".to_owned(),
                        host: None,
                        port: None,
                        username: None,
                        shell: Some(shell.clone()),
                    },
                };
                let diagnostic = live
                    .and_then(|session| session.diagnostic.clone())
                    .or(last_failure.clone());
                let error = live
                    .and_then(|session| session.error.clone())
                    .or_else(|| diagnostic.as_ref().map(|item| item.detail.clone()));
                Ok(SessionCatalogEntry {
                    profile_id: profile.id,
                    name: profile.name,
                    group: profile.group,
                    environment: profile.environment,
                    target,
                    session_id: live.map(|session| session.session_id.clone()),
                    state: live.map(|session| session.state).unwrap_or_else(|| {
                        if diagnostic.is_some() {
                            SessionState::Failed
                        } else {
                            SessionState::Disconnected
                        }
                    }),
                    active: live.is_some_and(|session| {
                        Some(session.session_id.as_str()) == active_session_id
                    }),
                    error,
                    diagnostic,
                })
            })
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn execute_builtin_tool(
        self: &Arc<Self>,
        run_id: &str,
        call_id: &str,
        name: &str,
        arguments: Value,
        session_id: Option<&str>,
        settings: &AgentSettings,
        sink: Arc<dyn AgentEventSink>,
        continuation_sink: Arc<dyn AgentEventSink>,
        abort: watch::Receiver<bool>,
    ) -> Result<String, AppError> {
        match name {
            "terminal_context" => {
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
                let offset = argument_u64(&arguments, "offset").unwrap_or(0) as usize;
                let limit = argument_u64(&arguments, "limit")
                    .unwrap_or(64 * 1024)
                    .clamp(1, 64 * 1024) as usize;
                let range = self.sessions.buffer_range(session_id, offset, limit)?;
                let screen = self.sessions.screen_snapshot(session_id)?;
                Ok(serde_json::to_string(&json!({
                    "offset": range.offset,
                    "nextOffset": range.next_offset,
                    "totalBytes": range.total_bytes,
                    "totalLines": range.total_lines,
                    "eof": range.eof,
                    "content": range.content,
                    "readMore": !range.eof,
                    "screen": screen,
                }))?)
            }
            "cli_execute" => {
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
                let command = argument_str(&arguments, "command")?;
                let timeout_seconds = argument_u64(&arguments, "timeout_seconds")
                    .unwrap_or(30)
                    .clamp(1, 300);
                let quiet_ms = argument_u64(&arguments, "quiet_ms")
                    .unwrap_or(1_200)
                    .clamp(500, 5_000);
                let evidence_refs = argument_string_array(&arguments, "evidence_refs")?;
                let result = self
                    .execute_cli_command(
                        session_id,
                        command,
                        timeout_seconds,
                        quiet_ms,
                        evidence_refs,
                        abort,
                    )
                    .await?;
                Ok(serde_json::to_string(&result)?)
            }
            "cli_execute_batch" => {
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
                let commands = argument_string_array(&arguments, "commands")?;
                if commands.is_empty() || commands.len() > 8 {
                    return Err(AppError::InvalidInput(
                        "cli_execute_batch requires 1 to 8 complete commands".to_owned(),
                    ));
                }
                let timeout_seconds = argument_u64(&arguments, "timeout_seconds")
                    .unwrap_or(30)
                    .clamp(1, 300);
                let quiet_ms = argument_u64(&arguments, "quiet_ms")
                    .unwrap_or(1_200)
                    .clamp(500, 5_000);
                let evidence_refs = argument_string_array(&arguments, "evidence_refs")?;
                let _operation = self.sessions.lock_operation(session_id).await?;
                let mut results = Vec::new();
                let mut stopped = false;
                for command in commands {
                    let result = self
                        .execute_cli_command_locked(
                            session_id,
                            &command,
                            timeout_seconds,
                            quiet_ms,
                            evidence_refs.clone(),
                            abort.clone(),
                        )
                        .await?;
                    stopped = matches!(
                        result.get("completionReason").and_then(Value::as_str),
                        Some("interactive" | "timeout")
                    );
                    results.push(result);
                    if stopped {
                        break;
                    }
                }
                Ok(serde_json::to_string(&json!({
                    "sessionId": session_id,
                    "requestedCommands": results.len(),
                    "stopped": stopped,
                    "results": results,
                }))?)
            }
            "terminal_send" => {
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
                let command = argument_str(&arguments, "command")?;
                let newline = arguments
                    .get("newline")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                let input_mode = arguments
                    .get("input_mode")
                    .and_then(Value::as_str)
                    .unwrap_or("complete_line");
                let _operation = self.sessions.lock_operation(session_id).await?;
                let input = self.sessions.lock_input(session_id).await?;
                let screen = self.sessions.screen_snapshot(session_id)?;
                let plan = terminal_send_plan(command, newline, input_mode, screen.as_ref())?;
                if !plan.payload.is_empty() {
                    input.write(plan.payload.as_bytes()).await?;
                }
                drop(input);
                tokio::time::sleep(Duration::from_millis(700)).await;
                let range = self.sessions.buffer_range(session_id, 0, 8 * 1024)?;
                Ok(serde_json::to_string(&json!({
                    "mode": plan.mode,
                    "requestedCommand": command,
                    "cleanedControlCount": plan.cleaned_control_count,
                    "observedCursorLine": plan.observed_cursor_line,
                    "matchedPrefix": plan.matched_prefix,
                    "sentText": plan.payload,
                    "offset": range.offset,
                    "nextOffset": range.next_offset,
                    "totalBytes": range.total_bytes,
                    "totalLines": range.total_lines,
                    "eof": range.eof,
                    "content": range.content,
                    "readMore": !range.eof,
                }))?)
            }
            "remote_exec" => {
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
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
                        .start_background_job(BackgroundJobRequest {
                            run_id: run_id.to_owned(),
                            call_id: call_id.to_owned(),
                            session_id: session_id.to_owned(),
                            command: command.to_owned(),
                            timeout_seconds,
                            sink,
                            continuation_sink,
                        })
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
            "terminal_edit" => {
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
                let operation = argument_str(&arguments, "operation")?;
                let count = arguments
                    .get("count")
                    .and_then(Value::as_u64)
                    .unwrap_or(1)
                    .clamp(1, 256);
                let screen = self.sessions.screen_snapshot(session_id)?;
                let expected_line = arguments
                    .get("expected_cursor_line_before_cursor")
                    .and_then(Value::as_str);
                if operation != "cancel_line" && expected_line.is_none() {
                    return Err(AppError::InvalidInput(
                        "terminal_edit requires expected_cursor_line_before_cursor; call terminal_context first so edits are guarded by the visible SSH line"
                            .to_owned(),
                    ));
                }
                if let Some(expected) = expected_line {
                    let actual = screen
                        .as_ref()
                        .map(|value| value.cursor_line_before_cursor.as_str())
                        .unwrap_or_default();
                    if actual != expected {
                        return Err(AppError::InvalidInput(format!(
                            "terminal edit refused because the visible cursor line changed; expected '{expected}', observed '{actual}'"
                        )));
                    }
                }
                if operation == "replace_current_input" {
                    let expected_input = arguments
                        .get("expected_input")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            AppError::InvalidInput(
                                "tool argument 'expected_input' is required for replace_current_input"
                                    .to_owned(),
                            )
                        })?;
                    let actual_line = screen
                        .as_ref()
                        .map(|value| value.cursor_line_before_cursor.as_str())
                        .unwrap_or_default();
                    let actual_input = terminal_editable_input(actual_line).unwrap_or(actual_line);
                    if actual_input != expected_input {
                        return Err(AppError::InvalidInput(format!(
                            "terminal edit refused because the editable input changed; expected '{expected_input}', observed '{actual_input}'"
                        )));
                    }
                }
                let text = arguments.get("text").and_then(Value::as_str);
                let payload = terminal_edit_payload(operation, count, text)?;
                let _operation = self.sessions.lock_operation(session_id).await?;
                let input = self.sessions.lock_input(session_id).await?;
                input.write(payload.as_bytes()).await?;
                drop(input);
                Ok(serde_json::to_string(&json!({
                    "sessionId": session_id,
                    "operation": operation,
                    "count": count,
                    "observedCursorLine": screen.map(|value| value.cursor_line_before_cursor),
                    "sentText": payload,
                    "guarded": expected_line.is_some(),
                }))?)
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
            "session_wait_until" => {
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
                self.wait_until(run_id, call_id, session_id, &arguments, sink, abort)
                    .await
            }
            "session_info" => {
                let requested_session_id = arguments.get("session_id").and_then(Value::as_str);
                let requested_profile_id = arguments.get("profile_id").and_then(Value::as_str);
                let requested_name = arguments.get("profile_name").and_then(Value::as_str);
                let selected_active_session_id = selected_session_id(&arguments, session_id);
                let profiles = self.config.profile_list()?;
                let live_sessions = self.sessions.list()?;
                let session = if let Some(id) = requested_session_id {
                    live_sessions.iter().find(|item| item.session_id == id)
                } else if requested_profile_id.is_some() || requested_name.is_some() {
                    live_sessions.iter().find(|item| {
                        profiles.iter().any(|profile| {
                            profile.id == item.profile_id
                                && (requested_profile_id.is_some_and(|id| profile.id == id)
                                    || requested_name.is_some_and(|name| profile.name == name))
                        })
                    })
                } else {
                    selected_active_session_id
                        .and_then(|id| live_sessions.iter().find(|item| item.session_id == id))
                };
                let profile = if let Some(session) = session {
                    profiles
                        .iter()
                        .find(|profile| profile.id == session.profile_id)
                } else {
                    profiles.iter().find(|profile| {
                        requested_profile_id.is_some_and(|id| profile.id == id)
                            || requested_name.is_some_and(|name| profile.name == name)
                    })
                };
                if session.is_none() && profile.is_none() {
                    return Err(AppError::NotFound(
                        requested_session_id
                            .map(|id| format!("session '{id}'"))
                            .or_else(|| requested_profile_id.map(|id| format!("profile '{id}'")))
                            .or_else(|| requested_name.map(|name| format!("profile '{name}'")))
                            .unwrap_or_else(|| {
                                "SSH target (explicit session_id or use_active_session=true)"
                                    .to_owned()
                            }),
                    ));
                }
                Ok(serde_json::to_string(&json!({
                    "session": session,
                    "profile": profile,
                    "activeCandidate": session.is_some_and(|item| Some(item.session_id.as_str()) == session_id),
                }))?)
            }
            "session_catalog" => {
                let query = arguments.get("query").and_then(Value::as_str);
                Ok(serde_json::to_string(
                    &self.session_catalog(query, session_id)?,
                )?)
            }
            "session_connect" => {
                let profile = self.resolve_profile_target(&arguments)?;
                let profile_name = profile.name.clone();
                let profile_id = profile.id.clone();
                let mut connecting = event(
                    run_id,
                    "target_connecting",
                    Some(format!("正在自动连接目标服务器：{profile_name}")),
                );
                connecting.call_id = Some(call_id.to_owned());
                connecting.tool_name = Some(name.to_owned());
                connecting.plugin_id = Some(builtin::MULTI_SSH_COORDINATOR_ID.to_owned());
                connecting.arguments = Some(json!({
                    "profileId": profile_id,
                    "profileName": profile_name,
                }));
                sink.send(connecting)?;
                let connected = self.sessions.ensure_connected(profile).await?;
                let mut connected_event = event(
                    run_id,
                    "target_connected",
                    Some("目标服务器 SSH 已连接".to_owned()),
                );
                connected_event.call_id = Some(call_id.to_owned());
                connected_event.tool_name = Some(name.to_owned());
                connected_event.plugin_id = Some(builtin::MULTI_SSH_COORDINATOR_ID.to_owned());
                connected_event.arguments = Some(json!({
                    "profileId": connected.profile_id,
                    "sessionId": connected.session_id,
                    "state": connected.state,
                }));
                sink.send(connected_event)?;
                Ok(serde_json::to_string(&json!({
                    "sessionId": connected.session_id,
                    "profileId": connected.profile_id,
                    "state": connected.state,
                    "message": "SSH 连接已建立，请将 sessionId 用于后续工具调用",
                }))?)
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
                    let session_id = require_session(selected_session_id(&arguments, session_id))?;
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
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
                let path = argument_str(&arguments, "path")?;
                Ok(serde_json::to_string(
                    &self.sftp.file_stat(session_id, path).await?,
                )?)
            }
            "file_read" => {
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
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
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
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
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
                let path = argument_str(&arguments, "path")?;
                let content = argument_str(&arguments, "content")?;
                let expected_hash = arguments.get("expected_hash").and_then(Value::as_str);
                let _operation = self.sessions.lock_operation(session_id).await?;
                Ok(serde_json::to_string(
                    &self
                        .sftp
                        .file_write_atomic(session_id, path, content.as_bytes(), expected_hash)
                        .await?,
                )?)
            }
            "file_patch" => {
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
                let path = argument_str(&arguments, "path")?;
                let search = argument_str(&arguments, "search")?;
                let replace = arguments
                    .get("replace")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        AppError::InvalidInput("tool argument 'replace' is required".to_owned())
                    })?;
                let expected_hash = argument_str(&arguments, "expected_hash")?;
                let _operation = self.sessions.lock_operation(session_id).await?;
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
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
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
                let session_id = require_session(selected_session_id(&arguments, session_id))?;
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
            "skill_load" => {
                let id = argument_str(&arguments, "id")?;
                skills::load_content(&settings.skill_directories, &settings.enabled_skills, id)
            }
            _ => Err(AppError::NotFound(format!("agent tool '{name}'"))),
        }
    }

    async fn execute_cli_command(
        &self,
        session_id: &str,
        command: &str,
        timeout_seconds: u64,
        quiet_ms: u64,
        evidence_refs: Vec<String>,
        abort: watch::Receiver<bool>,
    ) -> Result<Value, AppError> {
        let _operation = self.sessions.lock_operation(session_id).await?;
        self.execute_cli_command_locked(
            session_id,
            command,
            timeout_seconds,
            quiet_ms,
            evidence_refs,
            abort,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn wait_until(
        &self,
        run_id: &str,
        call_id: &str,
        session_id: &str,
        arguments: &Value,
        sink: Arc<dyn AgentEventSink>,
        mut abort: watch::Receiver<bool>,
    ) -> Result<String, AppError> {
        let command = argument_str(arguments, "command")?;
        let condition = arguments
            .get("condition")
            .and_then(Value::as_str)
            .unwrap_or("exit_code_zero");
        let expected = arguments
            .get("expected")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !matches!(
            condition,
            "exit_code_zero"
                | "stdout_contains"
                | "stdout_not_contains"
                | "stdout_equals"
                | "stderr_contains"
                | "stderr_not_contains"
        ) {
            return Err(AppError::InvalidInput(format!(
                "unsupported wait condition '{condition}'"
            )));
        }
        if condition != "exit_code_zero" && expected.is_empty() {
            return Err(AppError::InvalidInput(format!(
                "wait condition '{condition}' requires a non-empty expected value"
            )));
        }
        let read_check = super::policy::evaluate_tool(
            "remote_exec",
            &json!({ "command": command }),
            PolicyContext {
                mode: crate::types::AgentPermissionMode::ReadOnly,
                environment: SessionEnvironment::Production,
                is_root: false,
            },
        );
        let observational_execute = read_check.effect == ToolEffect::Execute
            && !read_check.commands.is_empty()
            && read_check
                .commands
                .iter()
                .all(|name| matches!(name.as_str(), "test" | "[" | "true" | "false"));
        if read_check.action != PolicyAction::Allow && !observational_execute {
            return Err(AppError::InvalidInput(format!(
                "session_wait_until only accepts a statically parsed read-only observation command; analysis: {}",
                read_check.reason
            )));
        }

        let interval = Duration::from_secs(
            argument_u64(arguments, "interval_seconds")
                .unwrap_or(3)
                .clamp(1, 30),
        );
        let timeout = Duration::from_secs(
            argument_u64(arguments, "timeout_seconds")
                .unwrap_or(300)
                .clamp(1, 3_600),
        );
        let poll_timeout = Duration::from_secs(
            argument_u64(arguments, "poll_timeout_seconds")
                .unwrap_or(15)
                .clamp(1, 60),
        );
        let started = Instant::now();
        let mut attempts = 0_u32;
        let mut last_progress = Instant::now() - Duration::from_secs(10);
        loop {
            if *abort.borrow() {
                return Err(AppError::Agent("session wait canceled".to_owned()));
            }
            attempts = attempts.saturating_add(1);
            let capture = Arc::new(WaitExecCapture::default());
            let result = self
                .sessions
                .remote_exec(
                    session_id,
                    command,
                    poll_timeout.min(timeout.saturating_sub(started.elapsed())),
                    abort.clone(),
                    capture.clone(),
                )
                .await?;
            let (stdout, stderr, output_truncated) = capture.snapshot()?;
            let matched = match condition {
                "exit_code_zero" => result.exit_code == Some(0),
                "stdout_contains" => stdout.contains(expected),
                "stdout_not_contains" => !stdout.contains(expected),
                "stdout_equals" => stdout.trim_end() == expected,
                "stderr_contains" => stderr.contains(expected),
                "stderr_not_contains" => !stderr.contains(expected),
                _ => false,
            };
            if matched {
                return Ok(serde_json::to_string(&json!({
                    "sessionId": session_id,
                    "command": command,
                    "condition": condition,
                    "expected": expected,
                    "matched": true,
                    "attempts": attempts,
                    "elapsedMs": started.elapsed().as_millis().min(u64::MAX as u128) as u64,
                    "execution": result,
                    "stdout": stdout,
                    "stderr": stderr,
                    "outputTruncated": output_truncated,
                }))?);
            }
            if output_truncated {
                return Err(AppError::Agent(format!(
                    "session_wait_until poll output exceeded {MAX_WAIT_CAPTURE_BYTES} bytes before the condition matched; narrow the observation command"
                )));
            }
            if started.elapsed() >= timeout {
                return Ok(serde_json::to_string(&json!({
                    "sessionId": session_id,
                    "command": command,
                    "condition": condition,
                    "expected": expected,
                    "matched": false,
                    "timedOut": true,
                    "attempts": attempts,
                    "elapsedMs": started.elapsed().as_millis().min(u64::MAX as u128) as u64,
                    "execution": result,
                    "stdout": stdout,
                    "stderr": stderr,
                }))?);
            }
            if last_progress.elapsed() >= Duration::from_secs(5) {
                let mut progress = event(
                    run_id,
                    "session_wait_progress",
                    Some(format!("等待条件 · 第 {attempts} 次检查")),
                );
                progress.call_id = Some(call_id.to_owned());
                progress.tool_name = Some("session_wait_until".to_owned());
                progress.arguments = Some(json!({
                    "sessionId": session_id,
                    "attempts": attempts,
                    "elapsedMs": started.elapsed().as_millis().min(u64::MAX as u128) as u64,
                    "lastExitCode": result.exit_code,
                }));
                sink.send(progress)?;
                last_progress = Instant::now();
            }
            tokio::select! {
                changed = abort.changed() => {
                    if changed.is_err() || *abort.borrow() {
                        return Err(AppError::Agent("session wait canceled".to_owned()));
                    }
                }
                _ = tokio::time::sleep(interval.min(timeout.saturating_sub(started.elapsed()))) => {}
            }
        }
    }

    async fn execute_cli_command_locked(
        &self,
        session_id: &str,
        command: &str,
        timeout_seconds: u64,
        quiet_ms: u64,
        evidence_refs: Vec<String>,
        abort: watch::Receiver<bool>,
    ) -> Result<Value, AppError> {
        let input = self.sessions.lock_input(session_id).await?;
        let before_transcript = self.sessions.buffer_snapshot(session_id)?;
        let before_screen = self.sessions.screen_snapshot(session_id)?;
        let plan = terminal_send_plan(command, true, "complete_line", before_screen.as_ref())?;
        if !plan.payload.is_empty() {
            input.write(plan.payload.as_bytes()).await?;
        }
        drop(input);

        let started = Instant::now();
        let mut last_change = Instant::now();
        let mut last_transcript = before_transcript.clone();
        let mut saw_activity = false;
        let completion_reason = loop {
            if *abort.borrow() {
                return Err(AppError::Agent("CLI execution canceled".to_owned()));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
            let transcript = self.sessions.buffer_snapshot(session_id)?;
            if transcript != last_transcript {
                last_transcript = transcript;
                last_change = Instant::now();
                saw_activity = true;
            }
            let elapsed = started.elapsed();
            let quiet_for = last_change.elapsed();
            let screen = self.sessions.screen_snapshot(session_id)?;
            let screen_changed = match (before_screen.as_ref(), screen.as_ref()) {
                (Some(before), Some(after)) => after.updated_at_ms > before.updated_at_ms,
                (None, Some(_)) => true,
                _ => false,
            };
            saw_activity |= screen_changed;
            if screen_changed && quiet_for >= Duration::from_millis(350) {
                if let Some(state) = cli_screen_state(screen.as_ref()) {
                    break state;
                }
            }
            if saw_activity
                && elapsed >= Duration::from_millis(500)
                && quiet_for >= Duration::from_millis(quiet_ms)
            {
                break "quiet_fallback";
            }
            if elapsed >= Duration::from_secs(timeout_seconds) {
                break "timeout";
            }
        };
        let after_transcript = self.sessions.buffer_snapshot(session_id)?;
        let after_screen = self.sessions.screen_snapshot(session_id)?;
        let output = transcript_delta(&before_transcript, &after_transcript);
        let (output_preview, output_truncated) = bounded_text_preview(&output, 64 * 1024);
        Ok(json!({
            "executionId": uuid::Uuid::new_v4().to_string(),
            "sessionId": session_id,
            "requestedCommand": command,
            "cleanedControlCount": plan.cleaned_control_count,
            "mode": plan.mode,
            "observedCursorLine": plan.observed_cursor_line,
            "matchedPrefix": plan.matched_prefix,
            "sentText": plan.payload,
            "completionReason": completion_reason,
            "complete": matches!(completion_reason, "prompt" | "quiet_fallback"),
            "elapsedMs": started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            "outputBytes": output.len(),
            "outputTruncated": output_truncated,
            "outputDelta": output_preview,
            "screenBefore": before_screen,
            "screenAfter": after_screen,
            "evidenceRefs": evidence_refs,
        }))
    }

    pub(crate) fn persist_evidence(
        &self,
        run_id: &str,
        evidence_id: &str,
        capability_id: &str,
        raw: &Value,
    ) -> Result<EvidenceRecord, AppError> {
        let task = self
            .store
            .task(run_id)?
            .ok_or_else(|| AppError::NotFound(format!("agent task '{run_id}'")))?;
        let goal_id = task
            .goal_id
            .as_deref()
            .ok_or_else(|| AppError::Agent("MCP evidence requires a persisted Goal".to_owned()))?;
        let directory = self
            .store
            .path()
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("artifacts")
            .join("goals")
            .join(goal_id)
            .join("evidence");
        fs::create_dir_all(&directory)?;
        let path = directory.join(format!("{evidence_id}.json"));
        let bytes = serde_json::to_vec_pretty(raw)?;
        if bytes.len() as u64 > MAX_ARTIFACT_BYTES {
            return Err(AppError::Mcp {
                code: "MCP_EVIDENCE_TOO_LARGE",
                detail: format!(
                    "MCP evidence '{}' from capability '{}' is {} bytes; the per-artifact limit is {} bytes",
                    evidence_id,
                    capability_id,
                    bytes.len(),
                    MAX_ARTIFACT_BYTES
                ),
            });
        }
        fs::write(&path, &bytes)?;
        self.store.save_evidence(&AgentEvidence {
            id: evidence_id.to_owned(),
            goal_id: goal_id.to_owned(),
            conversation_id: task.conversation_id,
            task_id: run_id.to_owned(),
            capability_id: capability_id.to_owned(),
            artifact_path: path.to_string_lossy().into_owned(),
            bytes: bytes.len() as u64,
            created_at_ms: now_ms(),
        })?;
        Ok(EvidenceRecord {
            id: evidence_id.to_owned(),
            capability_id: capability_id.to_owned(),
            artifact_path: path,
            bytes: bytes.len() as u64,
        })
    }

    pub(crate) fn plugin_infos(&self) -> Result<Vec<crate::types::AgentPluginInfo>, AppError> {
        Ok(vec![
            crate::types::AgentPluginInfo {
                id: "dsh-codex-agent".to_owned(),
                name: "Codex Harness Agent".to_owned(),
                version: "0.1.0".to_owned(),
                kind: "runtime".to_owned(),
                description:
                    "myterm 内置 Agent 运行时，负责线程历史、工具循环、上下文压缩和 Subagent Graph。"
                        .to_owned(),
                requires: vec![
                    "codex-core".to_owned(),
                    "ssh.operations".to_owned(),
                    "skills".to_owned(),
                    "mcp".to_owned(),
                ],
                enabled: true,
            },
            builtin::multi_ssh_plugin_info(),
        ])
    }

    fn resolve_profile_target(&self, arguments: &Value) -> Result<SessionProfile, AppError> {
        let profile_id = arguments.get("profile_id").and_then(Value::as_str);
        let profile_name = arguments.get("profile_name").and_then(Value::as_str);
        if profile_id.is_none() && profile_name.is_none() {
            return Err(AppError::InvalidInput(
                "session_connect requires profile_id or profile_name".to_owned(),
            ));
        }
        let profiles = self.config.profile_list()?;
        let matches = profiles
            .into_iter()
            .filter(|profile| {
                profile_id.is_some_and(|id| profile.id == id)
                    || profile_name.is_some_and(|name| profile.name == name)
            })
            .collect::<Vec<_>>();
        match matches.len() {
            0 => Err(AppError::NotFound(
                profile_id
                    .map(|id| format!("profile '{id}'"))
                    .or_else(|| profile_name.map(|name| format!("profile '{name}'")))
                    .unwrap_or_else(|| "profile".to_owned()),
            )),
            1 => Ok(matches.into_iter().next().expect("one profile match")),
            _ => Err(AppError::InvalidInput(
                "profile_name matches multiple saved servers; use profile_id".to_owned(),
            )),
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
        let _operation = self.sessions.lock_operation(session_id).await?;
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
        self: &Arc<Self>,
        request: BackgroundJobRequest,
    ) -> Result<String, AppError> {
        let BackgroundJobRequest {
            run_id,
            call_id,
            session_id,
            command,
            timeout_seconds,
            sink,
            continuation_sink,
        } = request;
        let operation_guard = self.sessions.lock_operation(&session_id).await?;
        let job_id = uuid::Uuid::new_v4().to_string();
        let task = self
            .store
            .task(&run_id)?
            .ok_or_else(|| AppError::NotFound(format!("agent task '{run_id}'")))?;
        let artifact_root = self
            .store
            .path()
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("artifacts")
            .join("goals")
            .join(task.goal_id.as_deref().unwrap_or(&run_id))
            .join("jobs")
            .join(&job_id);
        let capture = Arc::new(ExecCapture::new(
            artifact_root.clone(),
            &run_id,
            &job_id,
            "remote_exec",
            sink.clone(),
        )?);
        let job = ExecutionJob {
            id: job_id.clone(),
            task_id: run_id.clone(),
            goal_id: task.goal_id.clone(),
            conversation_id: Some(task.conversation_id.clone()),
            tool_call_id: call_id.clone(),
            state: "running".to_owned(),
            exit_code: None,
            signal: None,
            started_at_ms: now_ms(),
            completed_at_ms: None,
            artifact_path: Some(artifact_root.to_string_lossy().into_owned()),
        };
        self.store.job_started(&job)?;
        let mut started = event(&run_id, "job_started", Some("running".to_owned()));
        started.call_id = Some(call_id.clone());
        started.tool_name = Some("remote_exec".to_owned());
        started.arguments = Some(serde_json::to_value(&job)?);
        sink.send(started)?;
        let (cancel_tx, cancel_rx) = watch::channel(false);
        self.jobs.lock().await.insert(
            job_id.clone(),
            JobRuntime {
                task_id: run_id.clone(),
                goal_id: task.goal_id.clone(),
                cancel: cancel_tx,
            },
        );

        let sessions = self.sessions.clone();
        let store = self.store.clone();
        let jobs = self.jobs.clone();
        let service = self.clone();
        let spawned_job_id = job_id.clone();
        let spawned_task_id = run_id;
        let spawned_goal_id = task.goal_id.clone();
        let spawned_conversation_id = task.conversation_id.clone();
        let spawned_profile_id = task.profile_id.clone();
        let spawned_permission = task.permission_mode;
        let spawned_call_id = call_id;
        let spawned_session_id = session_id;
        let spawned_command = command;
        tokio::spawn(async move {
            let _operation_guard = operation_guard;
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
                    json!({
                        "jobId": spawned_job_id,
                        "state": "failed",
                        "errorCode": error.code(),
                        "error": error.detail()
                    }),
                ),
            };
            let _ = store.job_finished(&spawned_job_id, state, exit_code, signal.as_deref());
            jobs.lock().await.remove(&spawned_job_id);
            let mut finished = event(&spawned_task_id, "job_finished", Some(state.to_owned()));
            finished.call_id = Some(spawned_call_id);
            finished.arguments = Some(payload);
            let _ = sink.send(finished);
            if let Some(goal_id) = spawned_goal_id {
                service
                    .resume_waiting_goal_after_job(
                        &goal_id,
                        &spawned_conversation_id,
                        &spawned_profile_id,
                        spawned_permission,
                        &spawned_job_id,
                        state,
                        continuation_sink,
                    )
                    .await;
            }
        });

        Ok(serde_json::to_string(&json!({
            "jobId": job_id,
            "state": "running",
            "artifactPath": job.artifact_path,
        }))?)
    }

    #[allow(clippy::too_many_arguments)]
    async fn resume_waiting_goal_after_job(
        self: &Arc<Self>,
        goal_id: &str,
        conversation_id: &str,
        profile_id: &str,
        permission: crate::types::AgentPermissionMode,
        job_id: &str,
        job_state: &str,
        sink: Arc<dyn AgentEventSink>,
    ) {
        // The job may complete while the Turn that started it is still
        // publishing its final checkpoint. Wait for the conversation slot
        // event instead of polling or imposing an arbitrary long-task timeout.
        loop {
            let idle = self.active_changed.notified();
            tokio::pin!(idle);
            idle.as_mut().enable();
            if !self.active.lock().await.contains_key(conversation_id) {
                break;
            }
            idle.await;
        }
        let goal = match self.store.goal(goal_id) {
            Ok(Some(goal)) => goal,
            Ok(None) => return,
            Err(error) => {
                tracing::error!(
                    event = "goal_auto_resume_failed",
                    goal_id,
                    job_id,
                    error_code = error.code(),
                    error_detail = %error.detail(),
                    "unable to read Goal after background job completion"
                );
                return;
            }
        };
        if goal.status != AgentGoalStatus::WaitingExternal {
            tracing::debug!(
                event = "goal_auto_resume_skipped",
                goal_id,
                job_id,
                status = goal.status.as_str(),
                reason = "goal_not_waiting_external",
                "background job completion does not require an automatic continuation"
            );
            return;
        }
        let prompt = format!(
            "Background execution job {job_id} reached terminal state '{job_state}'. Continue the persisted Goal from its checkpoint. Read job_status and the required job_output ranges, verify the result, then continue or report the exact failure."
        );
        tracing::info!(
            event = "goal_auto_resume_started",
            goal_id,
            conversation_id,
            job_id,
            job_state,
            "automatically continuing Goal after background job completion"
        );
        if let Err(error) = self
            .run_in_conversation(
                profile_id,
                Some(conversation_id.to_owned()),
                prompt,
                None,
                sink,
                Some(permission),
            )
            .await
        {
            tracing::error!(
                event = "goal_auto_resume_failed",
                goal_id,
                conversation_id,
                job_id,
                error_code = error.code(),
                error_detail = %error.detail(),
                "automatic Goal continuation failed"
            );
        }
    }

    fn task_job(&self, run_id: &str, job_id: &str) -> Result<ExecutionJob, AppError> {
        let job = self
            .store
            .job(job_id)?
            .ok_or_else(|| AppError::NotFound(format!("execution job '{job_id}'")))?;
        let task = self
            .store
            .task(run_id)?
            .ok_or_else(|| AppError::NotFound(format!("agent task '{run_id}'")))?;
        let same_goal = task.goal_id.is_some() && task.goal_id == job.goal_id;
        if job.task_id != run_id && !same_goal {
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

    async fn cancel_jobs_for_goal(&self, goal_id: &str) {
        let jobs = self.jobs.lock().await;
        for runtime in jobs
            .values()
            .filter(|job| job.goal_id.as_deref() == Some(goal_id))
        {
            let _ = runtime.cancel.send(true);
        }
    }

    pub(crate) fn policy_context(
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
            None => (SessionEnvironment::Production, false),
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

pub(crate) fn tool_definitions(registry: &CapabilityRegistry, prompt: &str) -> Vec<Value> {
    let mut tools = vec![
        function_tool(
            "goal_update",
            "Persist the current Goal checkpoint and lifecycle status. Call this when the Goal is complete, waiting for a material user clarification, blocked, waiting on an external condition, or explicitly failed. Do not mark completed until the requested outcome has been verified.",
            json!({
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["active", "waiting_approval", "waiting_external", "blocked", "completed", "failed"] },
                    "checkpoint": { "description": "Compact structured checkpoint containing completed work, verified evidence, pending work, and safe resume information" },
                    "reason": { "type": "string", "description": "Exact unresolved decision or reason for waiting_approval, blocked, waiting_external, or failed states" }
                },
                "required": ["status"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "remote_exec",
            "Run a non-interactive command on the selected SSH session (or the active session by default) with separate stdout, stderr, exit status, timeout, cancellation, and full output artifacts.",
            json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id from session_catalog; defaults to the active session" },
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
            "Read the selected terminal transcript in byte ranges and the latest visible xterm screen/cursor line. Use this for investigation or interactive follow-up; cli_execute already performs an atomic live-screen check before sending a complete command.",
            json!({
                "type": "object",
                "properties": {
                    "offset": { "type": "integer", "minimum": 0, "default": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 65536, "default": 65536 },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" }
                },
                "additionalProperties": false
            }),
        ),
        function_tool(
            "cli_execute",
            "Execute one exact, complete command line in an interactive CLI using one atomic host transaction. Always pass the full intended command with its original whitespace, never only a remaining fragment. The host compares the full command byte-for-byte with the editable xterm prefix and sends only the exact missing suffix: target 'show system general' with visible 'show' sends ' system general'; visible 'show ' sends 'system general'. An incompatible prefix sends nothing. The tool then waits for a prompt/interaction/quiet/timeout boundary and returns only this execution's output delta. Include evidence_refs when the command was synthesized from MCP evidence.",
            json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "The exact complete desired CLI command line, preserving every space; do not pass only the missing suffix" },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" },
                    "timeout_seconds": { "type": "integer", "minimum": 1, "maximum": 300, "default": 30 },
                    "quiet_ms": { "type": "integer", "minimum": 500, "maximum": 5000, "default": 1200 },
                    "evidence_refs": { "type": "array", "items": { "type": "string" }, "maxItems": 16, "default": [] }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "cli_execute_batch",
            "Execute 1-8 already-known, non-branching interactive CLI commands serially in one tool call. Each command gets its own live-screen check and output boundary; the batch stops on interaction or timeout. Do not use when a later command depends on an earlier result.",
            json!({
                "type": "object",
                "properties": {
                    "commands": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 8 },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" },
                    "timeout_seconds": { "type": "integer", "minimum": 1, "maximum": 300, "default": 30 },
                    "quiet_ms": { "type": "integer", "minimum": 500, "maximum": 5000, "default": 1200 },
                    "evidence_refs": { "type": "array", "items": { "type": "string" }, "maxItems": 16, "default": [] }
                },
                "required": ["commands"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "terminal_send",
            "Low-level terminal input. Prefer cli_execute for complete commands. Use input_mode=raw only for interactive replies, confirmations, control keys, pager input, or an already-running REPL.",
            json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "newline": { "type": "boolean", "default": true },
                    "input_mode": { "type": "string", "enum": ["complete_line", "raw"], "default": "complete_line" },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "terminal_edit",
            "Guarded editing of the currently visible SSH input line. Call terminal_context first, pass its exact cursor_line_before_cursor as expected_cursor_line_before_cursor, then use backspace/delete/cursor movement or replace_current_input to correct a malformed command. The host refuses the edit when the visible line changed, so this never blindly clears another command. cancel_line is available for an intentional Ctrl+C and does not require a line guard.",
            json!({
                "type": "object",
                "properties": {
                    "operation": { "type": "string", "enum": ["cancel_line", "backspace", "delete", "cursor_left", "cursor_right", "home", "end", "clear_current_line", "replace_current_input"] },
                    "count": { "type": "integer", "minimum": 1, "maximum": 256, "default": 1 },
                    "text": { "type": "string", "description": "Replacement text for replace_current_input; control characters are removed before sending" },
                    "expected_input": { "type": "string", "description": "Exact editable suffix from terminal_context; required for replace_current_input" },
                    "expected_cursor_line_before_cursor": { "type": "string", "description": "Exact cursor_line_before_cursor returned by terminal_context; required for every operation except cancel_line" },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" }
                },
                "required": ["operation"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "session_info",
            "Read a live session and its saved profile metadata. Without arguments it reads the active session; provide session_id, profile_id, or profile_name to inspect a non-active session or saved server.",
            json!({
                "type": "object",
                "properties": {
                    "session_id": { "type": "string" },
                    "profile_id": { "type": "string" },
                    "profile_name": { "type": "string" }
                },
                "additionalProperties": false
            }),
        ),
        function_tool(
            "session_catalog",
            "List saved server profiles joined with live session state and the latest SSH connection diagnostic. Use this first when the user names an environment or the target session is not active; secrets are never returned.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Case-insensitive match against profile id, name, group, host, user, or shell" }
                },
                "additionalProperties": false
            }),
        ),
        function_tool(
            "session_connect",
            "Start or reuse an SSH session for one exact saved server. Use session_catalog first and pass profile_id or profile_name; the result contains the session_id required by later tools. This is the built-in Multi-SSH Coordinator connection primitive and remains subject to policy, timeout, cancellation, and audit.",
            json!({
                "type": "object",
                "properties": {
                    "profile_id": { "type": "string", "description": "Exact saved profile id from session_catalog" },
                    "profile_name": { "type": "string", "description": "Exact saved profile name when it is unique" }
                },
                "additionalProperties": false
            }),
        ),
        function_tool(
            "list_directory",
            "List a local or remote directory. Returns a JSON array of entries or an error.",
            json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "enum": ["local", "remote"] },
                    "path": { "type": "string" },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id for remote scope" }
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
                "properties": {
                    "path": { "type": "string" },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" }
                },
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
                    "limit": { "type": "integer", "minimum": 1, "maximum": 1048576, "default": 262144 },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" }
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
                    "max_matches": { "type": "integer", "minimum": 1, "maximum": 1000, "default": 100 },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" }
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
                    "expected_hash": { "type": "string", "description": "SHA-256 from file_stat; omit only when creating a new file" },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" }
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
                    "expected_hash": { "type": "string" },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" }
                },
                "required": ["path", "search", "replace", "expected_hash"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "host_facts",
            "Collect a deterministic Linux host fact snapshot from the selected SSH session (active session by default). Results are cached for ten minutes unless refresh is true.",
            json!({
                "type": "object",
                "properties": {
                    "refresh": { "type": "boolean", "default": false },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" }
                },
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
                    "target": { "type": "string", "description": "Required for service, logs, and tls" },
                    "session_id": { "type": "string", "description": "Optional explicit target session_id; defaults to the active session" }
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
        function_tool(
            "mcp_status",
            "Read task-start diagnostics for every configured MCP server, including transport, enabled state, connection/tool-discovery stage, exact error code, original error detail, and discovered tool count. This tool never requires an SSH session.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Optional case-insensitive server id, name, transport, status, code, or error filter" }
                },
                "additionalProperties": false
            }),
        ),
        function_tool(
            "evidence_read",
            "Read a byte range from the exact raw result artifact for one external capability evidence id returned earlier in the current Goal.",
            json!({
                "type": "object",
                "properties": {
                    "evidence_id": { "type": "string" },
                    "offset": { "type": "integer", "minimum": 0, "default": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 65536, "default": 65536 }
                },
                "required": ["evidence_id"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "session_wait_until",
            "Poll one statically read-only command on a selected SSH session until an exact condition matches or the timeout expires. Use this to coordinate target A with an observable prerequisite on target B without generating repeated short model requests.",
            json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "A statically parsed read-only observation command" },
                    "condition": { "type": "string", "enum": ["exit_code_zero", "stdout_contains", "stdout_not_contains", "stdout_equals", "stderr_contains", "stderr_not_contains"], "default": "exit_code_zero" },
                    "expected": { "type": "string", "description": "Required except for exit_code_zero" },
                    "interval_seconds": { "type": "integer", "minimum": 1, "maximum": 30, "default": 3 },
                    "timeout_seconds": { "type": "integer", "minimum": 1, "maximum": 3600, "default": 300 },
                    "poll_timeout_seconds": { "type": "integer", "minimum": 1, "maximum": 60, "default": 15 }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "capability_resource_list",
            "List MCP resources through the unified capability provider layer. Omit provider_id to inspect every ready provider; exact provider errors are preserved per provider.",
            json!({
                "type": "object",
                "properties": {
                    "provider_id": { "type": "string", "description": "Optional exact provider id from mcp_status or capability_search" }
                },
                "additionalProperties": false
            }),
        ),
        function_tool(
            "capability_resource_read",
            "Read one exact MCP resource URI through its provider. The immutable raw response is persisted as Goal-scoped evidence and large content must be paged with evidence_read.",
            json!({
                "type": "object",
                "properties": {
                    "provider_id": { "type": "string" },
                    "uri": { "type": "string" }
                },
                "required": ["provider_id", "uri"],
                "additionalProperties": false
            }),
        ),
        function_tool(
            "capability_prompt_list",
            "List reusable MCP prompts through the unified capability provider layer. Omit provider_id to inspect every ready provider.",
            json!({
                "type": "object",
                "properties": {
                    "provider_id": { "type": "string" }
                },
                "additionalProperties": false
            }),
        ),
        function_tool(
            "capability_prompt_get",
            "Resolve one exact MCP prompt with Schema-compatible arguments. The immutable result is persisted as Goal-scoped evidence.",
            json!({
                "type": "object",
                "properties": {
                    "provider_id": { "type": "string" },
                    "name": { "type": "string" },
                    "arguments": { "type": "object", "default": {} }
                },
                "required": ["provider_id", "name"],
                "additionalProperties": false
            }),
        ),
    ];
    add_explicit_session_targeting(&mut tools);
    if !registry.entries().is_empty() {
        tools.extend(
            registry
                .selected_for_prompt(prompt)
                .into_iter()
                .map(|capability| {
                    function_tool(
                        &capability.model_name,
                        &format!(
                            "{} [capabilityId={}, provider={}]",
                            capability.description, capability.id, capability.provider_name
                        ),
                        capability.input_schema.clone(),
                    )
                }),
        );
        tools.push(function_tool(
            "capability_search",
            "Search the task-scoped external capability registry by intent, name, description, provider, and Schema terms. Returns exact capability ids plus input/output Schemas.",
            json!({
                "type": "object", "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 8 }
                },
                "required": ["query"], "additionalProperties": false
            }),
        ));
        tools.push(function_tool(
            "capability_invoke",
            "Invoke one exact capability returned by capability_search. Arguments are validated against its input Schema; output is returned as a sourced evidence packet and validated against outputSchema when present.",
            json!({
                "type": "object",
                "properties": {
                    "capability_id": { "type": "string" },
                    "arguments": { "type": "object" }
                },
                "required": ["capability_id", "arguments"],
                "additionalProperties": false
            }),
        ));
        tools.push(function_tool(
            "capability_invoke_batch",
            "Invoke 1-8 exact external capabilities in one tool call when their queries are independent. Results remain individually sourced and Schema-validated.",
            json!({
                "type": "object",
                "properties": {
                    "calls": {
                        "type": "array", "minItems": 1, "maxItems": 8,
                        "items": {
                            "type": "object",
                            "properties": {
                                "capability_id": { "type": "string" },
                                "arguments": { "type": "object" }
                            },
                            "required": ["capability_id", "arguments"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["calls"], "additionalProperties": false
            }),
        ));
    }

    tools
}

fn add_explicit_session_targeting(tools: &mut [Value]) {
    const SESSION_TARGETED_TOOLS: &[&str] = &[
        "remote_exec",
        "session_wait_until",
        "terminal_context",
        "cli_execute",
        "cli_execute_batch",
        "terminal_send",
        "terminal_edit",
        "session_info",
        "list_directory",
        "file_stat",
        "file_read",
        "file_search",
        "file_write",
        "file_patch",
        "host_facts",
        "runbook",
    ];
    for tool in tools {
        let Some(function) = tool.get_mut("function").and_then(Value::as_object_mut) else {
            continue;
        };
        let Some(name) = function
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            continue;
        };
        if !SESSION_TARGETED_TOOLS.contains(&name.as_str()) {
            continue;
        }
        if let Some(description) = function.get_mut("description") {
            let current = description.as_str().unwrap_or_default();
            let target_contract = match name.as_str() {
                "session_info" => "To inspect the current SSH candidate, set use_active_session=true; profile_id, profile_name, or session_id remain valid explicit selectors.",
                "list_directory" => "For remote scope, pass session_id or set use_active_session=true only when the user's task refers to the current SSH; local scope needs neither.",
                _ => "Target selection is explicit: pass session_id, or set use_active_session=true only when the user's task refers to the current SSH.",
            };
            *description = Value::String(format!("{} {target_contract}", current.trim(),));
        }
        let Some(properties) = function
            .get_mut("parameters")
            .and_then(Value::as_object_mut)
            .and_then(|parameters| parameters.get_mut("properties"))
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        if let Some(session_id) = properties
            .get_mut("session_id")
            .and_then(Value::as_object_mut)
        {
            session_id.insert(
                "description".to_owned(),
                Value::String(
                    "Explicit target session_id returned by session_catalog or session_connect"
                        .to_owned(),
                ),
            );
        }
        properties.insert(
            "use_active_session".to_owned(),
            json!({
                "type": "boolean",
                "default": false,
                "description": "Set true only when the user refers to the current terminal, this server, or the visible SSH; never use it merely because an active pane exists"
            }),
        );
    }
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

pub(crate) fn plugin_id_for_tool(name: &str) -> &'static str {
    if matches!(name, "session_connect" | "session_wait_until") {
        builtin::MULTI_SSH_COORDINATOR_ID
    } else {
        "dsh-codex-agent"
    }
}

fn require_session(session_id: Option<&str>) -> Result<&str, AppError> {
    session_id.ok_or_else(|| {
        AppError::InvalidInput(
            "an SSH target is required: pass an explicit session_id, or set use_active_session=true only when the user refers to the current terminal or current server"
                .to_owned(),
        )
    })
}

fn selected_session_id<'a>(
    arguments: &'a Value,
    active_session_candidate: Option<&'a str>,
) -> Option<&'a str> {
    arguments
        .get("session_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            arguments
                .get("use_active_session")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                .then_some(active_session_candidate)
                .flatten()
        })
}

pub(crate) fn argument_str<'a>(arguments: &'a Value, name: &str) -> Result<&'a str, AppError> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::InvalidInput(format!("tool argument '{name}' is required")))
}

fn argument_u64(arguments: &Value, name: &str) -> Option<u64> {
    arguments.get(name).and_then(Value::as_u64)
}

fn argument_string_array(arguments: &Value, name: &str) -> Result<Vec<String>, AppError> {
    let Some(value) = arguments.get(name) else {
        return Ok(Vec::new());
    };
    value
        .as_array()
        .ok_or_else(|| AppError::InvalidInput(format!("tool argument '{name}' must be an array")))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| {
                    AppError::InvalidInput(format!(
                        "tool argument '{name}' must contain non-empty strings"
                    ))
                })
        })
        .collect()
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

#[derive(Default)]
struct WaitExecCapture {
    stdout: StdMutex<WaitStreamCapture>,
    stderr: StdMutex<WaitStreamCapture>,
}

#[derive(Default)]
struct WaitStreamCapture {
    bytes: Vec<u8>,
    truncated: bool,
}

impl WaitExecCapture {
    fn snapshot(&self) -> Result<(String, String, bool), AppError> {
        let stdout = self
            .stdout
            .lock()
            .map_err(|_| AppError::Agent("wait stdout capture lock is poisoned".to_owned()))?;
        let stderr = self
            .stderr
            .lock()
            .map_err(|_| AppError::Agent("wait stderr capture lock is poisoned".to_owned()))?;
        Ok((
            String::from_utf8_lossy(&stdout.bytes).into_owned(),
            String::from_utf8_lossy(&stderr.bytes).into_owned(),
            stdout.truncated || stderr.truncated,
        ))
    }
}

impl ExecOutputSink for WaitExecCapture {
    fn send(&self, stream: ExecStream, data: &[u8]) -> Result<(), AppError> {
        let capture = match stream {
            ExecStream::Stdout => &self.stdout,
            ExecStream::Stderr => &self.stderr,
        };
        let mut capture = capture
            .lock()
            .map_err(|_| AppError::Agent("wait output capture lock is poisoned".to_owned()))?;
        let remaining = MAX_WAIT_CAPTURE_BYTES.saturating_sub(capture.bytes.len());
        capture
            .bytes
            .extend_from_slice(&data[..data.len().min(remaining)]);
        capture.truncated |= data.len() > remaining;
        Ok(())
    }
}

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

pub(crate) fn event(run_id: &str, event_type: &str, message: Option<String>) -> AgentEvent {
    AgentEvent {
        schema_version: AGENT_EVENT_SCHEMA_VERSION,
        sequence: 0,
        created_at_ms: 0,
        event_type: event_type.to_owned(),
        run_id: run_id.to_owned(),
        step: None,
        call_id: None,
        tool_name: None,
        plugin_id: None,
        message,
        content: None,
        arguments: None,
        is_error: None,
        error_code: None,
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

#[cfg(test)]
mod tests {
    use super::{
        plugin_id_for_tool, redact_event, selected_session_id, terminal_edit_payload,
        terminal_send_plan, tool_definitions,
    };
    use crate::agent::builtin;
    use crate::agent::capability::CapabilityRegistry;
    use crate::types::{AgentSettings, TerminalScreenSnapshot};
    use serde_json::json;

    #[test]
    fn built_in_tools_and_limits_are_explicit() {
        let tools = tool_definitions(&CapabilityRegistry::default(), "");
        let names = tools
            .iter()
            .filter_map(|tool| tool["function"]["name"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            [
                "goal_update",
                "remote_exec",
                "job_status",
                "job_output",
                "job_cancel",
                "terminal_context",
                "cli_execute",
                "cli_execute_batch",
                "terminal_send",
                "terminal_edit",
                "session_info",
                "session_catalog",
                "session_connect",
                "list_directory",
                "file_stat",
                "file_read",
                "file_search",
                "file_write",
                "file_patch",
                "host_facts",
                "runbook",
                "skill_load",
                "mcp_status",
                "evidence_read",
                "session_wait_until",
                "capability_resource_list",
                "capability_resource_read",
                "capability_prompt_list",
                "capability_prompt_get",
            ]
        );
        assert!(tools
            .iter()
            .any(|tool| tool["function"]["name"] == "session_catalog"));
        let remote_exec = tools
            .iter()
            .find(|tool| tool["function"]["name"] == "remote_exec")
            .expect("remote_exec tool");
        assert!(remote_exec["function"]["parameters"]["properties"]["session_id"].is_object());
        assert!(tools
            .iter()
            .any(|tool| tool["function"]["name"] == "session_connect"));
        let terminal_context = tools
            .iter()
            .find(|tool| tool["function"]["name"] == "terminal_context")
            .expect("terminal_context tool");
        assert_eq!(
            terminal_context["function"]["parameters"]["properties"]["limit"]["maximum"],
            65_536
        );
        assert_eq!(
            terminal_context["function"]["parameters"]["properties"]["use_active_session"]
                ["default"],
            false
        );
        assert!(terminal_context["function"]["description"]
            .as_str()
            .is_some_and(|value| value.contains("Target selection is explicit")));
        assert!(tools
            .iter()
            .any(|tool| tool["function"]["name"] == "cli_execute_batch"));
        assert!(tools
            .iter()
            .any(|tool| tool["function"]["name"] == "mcp_status"));
        let settings = AgentSettings::default();
        assert_eq!(settings.profile, "dsh-codex-agent");
    }

    #[test]
    fn coordinator_plugin_is_explicit_and_targeted() {
        let plugin = builtin::multi_ssh_plugin_info();
        assert_eq!(plugin.id, "multi-ssh-coordinator");
        assert_eq!(plugin.kind, "builtin-plugin");
        assert_eq!(
            plugin_id_for_tool("session_connect"),
            "multi-ssh-coordinator"
        );
        assert_eq!(plugin_id_for_tool("remote_exec"), "dsh-codex-agent");
        assert!(builtin::system_prompt().contains("session_connect"));
    }

    #[test]
    fn active_session_candidate_requires_explicit_model_opt_in() {
        let arguments = json!({ "session_id": "secondary" });
        assert_eq!(
            selected_session_id(&arguments, Some("active")),
            Some("secondary")
        );
        assert_eq!(
            selected_session_id(&json!({ "use_active_session": true }), Some("active")),
            Some("active")
        );
        assert_eq!(selected_session_id(&json!({}), Some("active")), None);
        assert_eq!(
            selected_session_id(
                &json!({ "session_id": "", "use_active_session": true }),
                Some("active")
            ),
            Some("active")
        );
    }

    fn screen(cursor_line_before_cursor: &str) -> TerminalScreenSnapshot {
        TerminalScreenSnapshot {
            visible_text: cursor_line_before_cursor.to_owned(),
            cursor_line: cursor_line_before_cursor.to_owned(),
            cursor_line_before_cursor: cursor_line_before_cursor.to_owned(),
            cursor_column: cursor_line_before_cursor.len() as u16,
            updated_at_ms: 1,
        }
    }

    #[test]
    fn terminal_send_completes_only_the_missing_cli_suffix() {
        let snapshot = screen("switch>show system");
        let plan = terminal_send_plan(
            "show system general",
            true,
            "complete_line",
            Some(&snapshot),
        )
        .expect("terminal send plan");
        assert_eq!(plan.matched_prefix, "show system");
        assert_eq!(plan.payload, " general\r");
    }

    #[test]
    fn terminal_send_preserves_the_separator_after_a_partial_command() {
        let snapshot = screen("switch>show");
        let plan = terminal_send_plan(
            "show system general",
            true,
            "complete_line",
            Some(&snapshot),
        )
        .expect("terminal send plan");
        assert_eq!(plan.matched_prefix, "show");
        assert_eq!(plan.payload, " system general\r");
    }

    #[test]
    fn terminal_send_does_not_duplicate_an_existing_separator() {
        let snapshot = screen("switch>show ");
        let plan = terminal_send_plan(
            "show system general",
            true,
            "complete_line",
            Some(&snapshot),
        )
        .expect("terminal send plan");
        assert_eq!(plan.matched_prefix, "show ");
        assert_eq!(plan.payload, "system general\r");
    }

    #[test]
    fn terminal_send_submits_an_already_complete_cli_line_without_duplication() {
        let snapshot = screen("switch>show system general");
        let plan = terminal_send_plan(
            "show system general",
            true,
            "complete_line",
            Some(&snapshot),
        )
        .expect("terminal send plan");
        assert_eq!(plan.matched_prefix, "show system general");
        assert_eq!(plan.payload, "\r");
    }

    #[test]
    fn terminal_send_rejects_conflicting_visible_input() {
        let snapshot = screen("switch>show interface status");
        let error = terminal_send_plan(
            "show system general",
            true,
            "complete_line",
            Some(&snapshot),
        )
        .expect_err("conflicting input must stop the send");
        assert!(error.detail().contains("no text was sent"));
        assert!(error.detail().contains("show interface status"));
    }

    #[test]
    fn terminal_send_does_not_treat_an_accidental_suffix_as_typed_input() {
        let snapshot = screen("switch>show users");
        let error = terminal_send_plan(
            "show system general",
            true,
            "complete_line",
            Some(&snapshot),
        )
        .expect_err("a one-character suffix must not be used as a command prefix");
        assert!(error.detail().contains("no text was sent"));
    }

    #[test]
    fn terminal_send_preserves_special_characters_when_no_prompt_is_visible() {
        let snapshot = screen("echo $PA");
        let plan = terminal_send_plan("echo $PATH", true, "complete_line", Some(&snapshot))
            .expect("no-prompt input should be compared before prompt parsing");
        assert_eq!(plan.matched_prefix, "echo $PA");
        assert_eq!(plan.payload, "TH\r");
    }

    #[test]
    fn terminal_send_removes_control_bytes_and_escaped_control_notation() {
        let plan = terminal_send_plan(
            "name=fstest01\u{3}\u{1b}\\003\\033\\u0003",
            true,
            "complete_line",
            None,
        )
        .expect("control characters should be cleaned");
        assert_eq!(plan.payload, "name=fstest01\r");
        assert_eq!(plan.cleaned_control_count, 5);
    }

    #[test]
    fn terminal_send_inserts_a_separator_when_controls_join_cli_arguments() {
        let plan = terminal_send_plan("name=fstest01\u{3}create foo", true, "complete_line", None)
            .expect("control separator should be cleaned");
        assert_eq!(plan.payload, "name=fstest01 create foo\r");
    }

    #[test]
    fn raw_terminal_input_preserves_control_keys() {
        let plan = terminal_send_plan("\u{3}", false, "raw", None).expect("raw input");
        assert_eq!(plan.payload, "\u{3}");
        assert_eq!(plan.cleaned_control_count, 0);
    }

    #[test]
    fn terminal_edit_payload_is_explicit_and_bounded() {
        assert_eq!(
            terminal_edit_payload("backspace", 3, None).unwrap(),
            "\u{8}\u{8}\u{8}"
        );
        assert_eq!(
            terminal_edit_payload("cursor_left", 2, None).unwrap(),
            "\u{1b}[D\u{1b}[D"
        );
        assert_eq!(
            terminal_edit_payload("replace_current_input", 1, Some("name=fstest01\\003")).unwrap(),
            "\u{1}\u{b}name=fstest01"
        );
        assert!(terminal_edit_payload("unknown", 1, None).is_err());
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

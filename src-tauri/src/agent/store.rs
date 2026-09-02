use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};

use super::domain::{
    now_ms, AgentConversation, AgentEvidence, AgentGoal, AgentGoalStatus, AgentInputMode,
    AgentQueuedInput, AgentTask, AgentTaskState, ExecutionJob,
};
use crate::{
    types::{AgentEvent, AGENT_EVENT_SCHEMA_VERSION},
    AppError,
};

const SCHEMA_VERSION: i64 = 10;

pub struct AgentStore {
    path: PathBuf,
    connection: Mutex<Option<Connection>>,
}

pub(crate) struct GoalUpdate<'a> {
    pub status: AgentGoalStatus,
    pub current_turn_id: Option<&'a str>,
    pub token_delta: u64,
    pub continuation_delta: u32,
    pub checkpoint: Option<&'a serde_json::Value>,
    pub last_error: Option<&'a str>,
    pub blocked_reason: Option<&'a str>,
    pub no_progress_count: u32,
}

impl<'a> GoalUpdate<'a> {
    pub fn new(status: AgentGoalStatus) -> Self {
        Self {
            status,
            current_turn_id: None,
            token_delta: 0,
            continuation_delta: 0,
            checkpoint: None,
            last_error: None,
            blocked_reason: None,
            no_progress_count: 0,
        }
    }

    pub fn current_turn(mut self, turn_id: Option<&'a str>) -> Self {
        self.current_turn_id = turn_id;
        self
    }

    pub fn tokens(mut self, delta: u64) -> Self {
        self.token_delta = delta;
        self
    }

    pub fn continuation(mut self, delta: u32) -> Self {
        self.continuation_delta = delta;
        self
    }

    pub fn checkpoint(mut self, checkpoint: Option<&'a serde_json::Value>) -> Self {
        self.checkpoint = checkpoint;
        self
    }

    pub fn last_error(mut self, error: Option<&'a str>) -> Self {
        self.last_error = error;
        self
    }

    pub fn blocked_reason(mut self, reason: Option<&'a str>) -> Self {
        self.blocked_reason = reason;
        self
    }

    pub fn no_progress(mut self, count: u32) -> Self {
        self.no_progress_count = count;
        self
    }
}

impl AgentStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            connection: Mutex::new(None),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn create_goal(
        &self,
        conversation_id: &str,
        objective: &str,
        token_budget: Option<u64>,
    ) -> Result<AgentGoal, AppError> {
        let timestamp = now_ms();
        let goal = AgentGoal {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_owned(),
            objective: objective.trim().to_owned(),
            status: AgentGoalStatus::Active,
            token_budget,
            tokens_used: 0,
            continuation_count: 0,
            current_turn_id: None,
            created_at_ms: timestamp,
            updated_at_ms: timestamp,
            completed_at_ms: None,
            last_checkpoint: None,
            last_error: None,
            blocked_reason: None,
            no_progress_count: 0,
        };
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO agent_goals(
                    id, conversation_id, objective, status, token_budget, tokens_used,
                    continuation_count, current_turn_id, created_at_ms, updated_at_ms,
                    completed_at_ms, last_checkpoint_json, last_error, blocked_reason,
                    no_progress_count
                 ) VALUES(?1, ?2, ?3, ?4, ?5, 0, 0, NULL, ?6, ?6, NULL, NULL, NULL, NULL, 0)",
                params![
                    goal.id,
                    goal.conversation_id,
                    goal.objective,
                    goal.status.as_str(),
                    goal.token_budget.map(sql_u64),
                    timestamp,
                ],
            )?;
            Ok(goal)
        })
    }

    pub fn goal(&self, id: &str) -> Result<Option<AgentGoal>, AppError> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, conversation_id, objective, status, token_budget, tokens_used,
                            continuation_count, current_turn_id, created_at_ms, updated_at_ms,
                            completed_at_ms, last_checkpoint_json, last_error, blocked_reason,
                            no_progress_count
                     FROM agent_goals WHERE id = ?1",
                    [id],
                    goal_from_row,
                )
                .optional()
                .map_err(Into::into)
        })
    }

    pub fn conversation_goal(&self, conversation_id: &str) -> Result<Option<AgentGoal>, AppError> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, conversation_id, objective, status, token_budget, tokens_used,
                            continuation_count, current_turn_id, created_at_ms, updated_at_ms,
                            completed_at_ms, last_checkpoint_json, last_error, blocked_reason,
                            no_progress_count
                     FROM agent_goals WHERE conversation_id = ?1
                     ORDER BY created_at_ms DESC LIMIT 1",
                    [conversation_id],
                    goal_from_row,
                )
                .optional()
                .map_err(Into::into)
        })
    }

    pub(crate) fn update_goal(
        &self,
        id: &str,
        update: GoalUpdate<'_>,
    ) -> Result<AgentGoal, AppError> {
        self.with_connection(|connection| {
            let current = connection
                .query_row(
                    "SELECT status FROM agent_goals WHERE id = ?1",
                    [id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(|| AppError::NotFound(format!("agent goal '{id}'")))?;
            let current = AgentGoalStatus::try_from(current.as_str()).map_err(AppError::Agent)?;
            if !current.can_transition_to(update.status) {
                return Err(AppError::Agent(format!(
                    "invalid goal state transition {} -> {}",
                    current.as_str(),
                    update.status.as_str()
                )));
            }
            let completed_at_ms = update.status.is_terminal().then_some(now_ms());
            connection.execute(
                "UPDATE agent_goals SET status = ?2, current_turn_id = ?3,
                    tokens_used = tokens_used + ?4,
                    continuation_count = continuation_count + ?5,
                    updated_at_ms = ?6,
                    completed_at_ms = CASE WHEN ?7 IS NULL THEN completed_at_ms ELSE ?7 END,
                    last_checkpoint_json = COALESCE(?8, last_checkpoint_json),
                    last_error = ?9, blocked_reason = ?10, no_progress_count = ?11
                 WHERE id = ?1",
                params![
                    id,
                    update.status.as_str(),
                    update.current_turn_id,
                    sql_u64(update.token_delta),
                    i64::from(update.continuation_delta),
                    now_ms(),
                    completed_at_ms,
                    update.checkpoint.map(serde_json::to_string).transpose()?,
                    update.last_error,
                    update.blocked_reason,
                    i64::from(update.no_progress_count),
                ],
            )?;
            connection
                .query_row(
                    "SELECT id, conversation_id, objective, status, token_budget, tokens_used,
                            continuation_count, current_turn_id, created_at_ms, updated_at_ms,
                            completed_at_ms, last_checkpoint_json, last_error, blocked_reason,
                            no_progress_count
                     FROM agent_goals WHERE id = ?1",
                    [id],
                    goal_from_row,
                )
                .map_err(Into::into)
        })
    }

    pub fn enqueue_input(
        &self,
        conversation_id: &str,
        goal_id: Option<&str>,
        content: &str,
        mode: AgentInputMode,
    ) -> Result<AgentQueuedInput, AppError> {
        let input = AgentQueuedInput {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_owned(),
            goal_id: goal_id.map(str::to_owned),
            content: content.trim().to_owned(),
            mode,
            state: "queued".to_owned(),
            created_at_ms: now_ms(),
            consumed_at_ms: None,
        };
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO agent_queued_inputs(
                    id, conversation_id, goal_id, content, mode, state, created_at_ms, consumed_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, 'queued', ?6, NULL)",
                params![
                    input.id,
                    input.conversation_id,
                    input.goal_id,
                    input.content,
                    match input.mode {
                        AgentInputMode::Steer => "steer",
                        AgentInputMode::Queue => "queue",
                    },
                    input.created_at_ms,
                ],
            )?;
            Ok(input)
        })
    }

    pub fn consume_next_input(
        &self,
        conversation_id: &str,
    ) -> Result<Option<AgentQueuedInput>, AppError> {
        self.with_connection(|connection| {
            let transaction = connection.transaction()?;
            let input = transaction
                .query_row(
                    "SELECT id, conversation_id, goal_id, content, mode, state,
                            created_at_ms, consumed_at_ms
                     FROM agent_queued_inputs
                     WHERE conversation_id = ?1 AND state = 'queued'
                     ORDER BY created_at_ms ASC LIMIT 1",
                    [conversation_id],
                    queued_input_from_row,
                )
                .optional()?;
            if let Some(input) = input.as_ref() {
                transaction.execute(
                    "UPDATE agent_queued_inputs SET state = 'consumed', consumed_at_ms = ?2
                     WHERE id = ?1 AND state = 'queued'",
                    params![input.id, now_ms()],
                )?;
            }
            transaction.commit()?;
            Ok(input.map(|mut value| {
                value.state = "consumed".to_owned();
                value.consumed_at_ms = Some(now_ms());
                value
            }))
        })
    }

    pub fn save_evidence(&self, evidence: &AgentEvidence) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO agent_evidence(
                    id, goal_id, conversation_id, task_id, capability_id,
                    artifact_path, bytes, created_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    goal_id = excluded.goal_id,
                    conversation_id = excluded.conversation_id,
                    task_id = excluded.task_id,
                    capability_id = excluded.capability_id,
                    artifact_path = excluded.artifact_path,
                    bytes = excluded.bytes",
                params![
                    evidence.id,
                    evidence.goal_id,
                    evidence.conversation_id,
                    evidence.task_id,
                    evidence.capability_id,
                    evidence.artifact_path,
                    sql_u64(evidence.bytes),
                    evidence.created_at_ms,
                ],
            )?;
            Ok(())
        })
    }

    pub fn evidence(&self, id: &str) -> Result<Option<AgentEvidence>, AppError> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, goal_id, conversation_id, task_id, capability_id,
                            artifact_path, bytes, created_at_ms
                     FROM agent_evidence WHERE id = ?1",
                    [id],
                    |row| {
                        Ok(AgentEvidence {
                            id: row.get(0)?,
                            goal_id: row.get(1)?,
                            conversation_id: row.get(2)?,
                            task_id: row.get(3)?,
                            capability_id: row.get(4)?,
                            artifact_path: row.get(5)?,
                            bytes: u64::try_from(row.get::<_, i64>(6)?).unwrap_or_default(),
                            created_at_ms: row.get(7)?,
                        })
                    },
                )
                .optional()
                .map_err(Into::into)
        })
    }

    pub fn activate_goal_skill(
        &self,
        goal_id: &str,
        skill_id: &str,
        content_hash: &str,
    ) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO agent_goal_skills(goal_id, skill_id, content_hash, loaded_at_ms)
                 VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(goal_id, skill_id) DO UPDATE SET
                    content_hash = excluded.content_hash,
                    loaded_at_ms = excluded.loaded_at_ms",
                params![goal_id, skill_id, content_hash, now_ms()],
            )?;
            Ok(())
        })
    }

    pub fn goal_skill_ids(&self, goal_id: &str) -> Result<Vec<String>, AppError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT skill_id FROM agent_goal_skills
                 WHERE goal_id = ?1 ORDER BY loaded_at_ms ASC",
            )?;
            let rows = statement.query_map([goal_id], |row| row.get(0))?;
            rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
        })
    }

    pub fn create_conversation(
        &self,
        id: &str,
        profile_id: &str,
        title: &str,
    ) -> Result<AgentConversation, AppError> {
        let timestamp = now_ms();
        let title = conversation_title(title);
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO agent_conversations(
                    id, title, profile_id, created_at_ms, updated_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?4)",
                params![id, title, profile_id, timestamp],
            )?;
            Ok(AgentConversation {
                id: id.to_owned(),
                title,
                profile_id: profile_id.to_owned(),
                created_at_ms: timestamp,
                updated_at_ms: timestamp,
                turn_count: 0,
            })
        })
    }

    pub fn conversation(&self, id: &str) -> Result<Option<AgentConversation>, AppError> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT c.id, c.title, c.profile_id, c.created_at_ms, c.updated_at_ms,
                            COUNT(t.id)
                     FROM agent_conversations c
                     LEFT JOIN agent_tasks t ON t.conversation_id = c.id
                     WHERE c.id = ?1
                     GROUP BY c.id, c.title, c.profile_id, c.created_at_ms, c.updated_at_ms",
                    [id],
                    conversation_from_row,
                )
                .optional()
                .map_err(Into::into)
        })
    }

    pub fn conversations(&self, limit: usize) -> Result<Vec<AgentConversation>, AppError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT c.id, c.title, c.profile_id, c.created_at_ms, c.updated_at_ms,
                        COUNT(t.id)
                 FROM agent_conversations c
                 LEFT JOIN agent_tasks t ON t.conversation_id = c.id
                 GROUP BY c.id, c.title, c.profile_id, c.created_at_ms, c.updated_at_ms
                 ORDER BY c.updated_at_ms DESC LIMIT ?1",
            )?;
            let rows = statement.query_map([limit.clamp(1, 200) as i64], conversation_from_row)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
        })
    }

    pub fn conversation_tasks(&self, conversation_id: &str) -> Result<Vec<AgentTask>, AppError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, conversation_id, goal_id, turn_index, continuation_index,
                        profile_id, session_id, prompt, state, created_at_ms,
                        updated_at_ms, finish_reason, steps, error_code, error_message
                 FROM agent_tasks WHERE conversation_id = ?1
                 ORDER BY turn_index ASC, created_at_ms ASC",
            )?;
            let rows = statement.query_map([conversation_id], task_from_row)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
        })
    }

    pub fn delete_conversation(&self, id: &str) -> Result<bool, AppError> {
        self.with_connection(|connection| {
            let transaction = connection.transaction()?;
            transaction.execute("DELETE FROM agent_tasks WHERE conversation_id = ?1", [id])?;
            let deleted =
                transaction.execute("DELETE FROM agent_conversations WHERE id = ?1", [id])? > 0;
            transaction.commit()?;
            Ok(deleted)
        })
    }

    pub fn conversation_storage_ids(
        &self,
        conversation_id: &str,
    ) -> Result<(Vec<String>, Vec<String>), AppError> {
        self.with_connection(|connection| {
            let mut task_statement = connection.prepare(
                "SELECT id FROM agent_tasks WHERE conversation_id = ?1 ORDER BY created_at_ms",
            )?;
            let task_ids = task_statement
                .query_map([conversation_id], |row| row.get(0))?
                .collect::<Result<Vec<String>, _>>()?;
            let mut goal_statement = connection.prepare(
                "SELECT id FROM agent_goals WHERE conversation_id = ?1 ORDER BY created_at_ms",
            )?;
            let goal_ids = goal_statement
                .query_map([conversation_id], |row| row.get(0))?
                .collect::<Result<Vec<String>, _>>()?;
            Ok((task_ids, goal_ids))
        })
    }

    pub fn next_turn_index(&self, conversation_id: &str) -> Result<u32, AppError> {
        self.with_connection(|connection| {
            let next: i64 = connection.query_row(
                "SELECT COALESCE(MAX(turn_index), 0) + 1
                 FROM agent_tasks WHERE conversation_id = ?1",
                [conversation_id],
                |row| row.get(0),
            )?;
            u32::try_from(next)
                .map_err(|_| AppError::Storage("invalid agent turn index".to_owned()))
        })
    }

    pub fn create_task(&self, task: &AgentTask) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO agent_tasks (
                    id, conversation_id, goal_id, turn_index, continuation_index, profile_id,
                    session_id, prompt, state, created_at_ms, updated_at_ms, finish_reason, steps,
                    error_code, error_message, next_sequence
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1)",
                params![
                    task.id,
                    task.conversation_id,
                    task.goal_id,
                    task.turn_index,
                    task.continuation_index,
                    task.profile_id,
                    task.session_id,
                    task.prompt,
                    task.state.as_str(),
                    task.created_at_ms,
                    task.updated_at_ms,
                    task.finish_reason,
                    task.steps,
                    task.error_code,
                    task.error_message,
                ],
            )?;
            connection.execute(
                "UPDATE agent_conversations SET updated_at_ms = ?2,
                    title = CASE WHEN NOT EXISTS(
                        SELECT 1 FROM agent_tasks
                        WHERE conversation_id = ?1 AND id <> ?3
                    ) THEN ?4 ELSE title END
                 WHERE id = ?1",
                params![
                    task.conversation_id,
                    task.updated_at_ms,
                    task.id,
                    conversation_title(&task.prompt),
                ],
            )?;
            Ok(())
        })
    }

    pub fn transition_task(
        &self,
        task_id: &str,
        next: AgentTaskState,
        finish_reason: Option<&str>,
        steps: u8,
        error: Option<(&str, &str)>,
    ) -> Result<(), AppError> {
        self.with_connection(|connection| {
            let current: Option<String> = connection
                .query_row(
                    "SELECT state FROM agent_tasks WHERE id = ?1",
                    [task_id],
                    |row| row.get(0),
                )
                .optional()?;
            let current =
                current.ok_or_else(|| AppError::NotFound(format!("agent task '{task_id}'")))?;
            let current = AgentTaskState::try_from(current.as_str()).map_err(AppError::Agent)?;
            if current != next && !current.can_transition_to(next) {
                return Err(AppError::Agent(format!(
                    "invalid task state transition {} -> {}",
                    current.as_str(),
                    next.as_str()
                )));
            }
            let (error_code, error_message) = error
                .map(|(code, message)| (Some(code), Some(message)))
                .unwrap_or((None, None));
            connection.execute(
                "UPDATE agent_tasks SET
                    state = ?2, updated_at_ms = ?3, finish_reason = ?4,
                    steps = ?5, error_code = ?6, error_message = ?7
                 WHERE id = ?1",
                params![
                    task_id,
                    next.as_str(),
                    now_ms(),
                    finish_reason,
                    steps,
                    error_code,
                    error_message,
                ],
            )?;
            connection.execute(
                "UPDATE agent_conversations SET updated_at_ms = ?2
                 WHERE id = (SELECT conversation_id FROM agent_tasks WHERE id = ?1)",
                params![task_id, now_ms()],
            )?;
            Ok(())
        })
    }

    pub fn append_event(&self, mut event: AgentEvent) -> Result<AgentEvent, AppError> {
        self.with_connection(|connection| {
            let transaction = connection.transaction()?;
            let sequence: i64 = transaction.query_row(
                "UPDATE agent_tasks
                 SET next_sequence = next_sequence + 1, updated_at_ms = ?2
                 WHERE id = ?1
                 RETURNING next_sequence - 1",
                params![event.run_id, now_ms()],
                |row| row.get(0),
            )?;
            event.schema_version = AGENT_EVENT_SCHEMA_VERSION;
            event.sequence = u64::try_from(sequence)
                .map_err(|_| AppError::Storage("negative event sequence".to_owned()))?;
            event.created_at_ms = now_ms();
            let payload = serde_json::to_string(&event)?;
            transaction.execute(
                "INSERT INTO agent_events (
                    task_id, sequence, schema_version, created_at_ms, event_type, payload
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    event.run_id,
                    sequence,
                    event.schema_version,
                    event.created_at_ms,
                    event.event_type,
                    payload,
                ],
            )?;
            transaction.commit()?;
            Ok(event)
        })
    }

    pub fn events_after(
        &self,
        task_id: &str,
        after_sequence: u64,
        limit: usize,
    ) -> Result<Vec<AgentEvent>, AppError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT payload FROM agent_events
                 WHERE task_id = ?1 AND sequence > ?2
                 ORDER BY sequence ASC LIMIT ?3",
            )?;
            let rows = statement.query_map(
                params![
                    task_id,
                    i64::try_from(after_sequence).unwrap_or(i64::MAX),
                    limit.clamp(1, 1_000) as i64
                ],
                |row| row.get::<_, String>(0),
            )?;
            let mut events = Vec::new();
            for payload in rows {
                events.push(serde_json::from_str(&payload?)?);
            }
            Ok(events)
        })
    }

    pub fn task(&self, task_id: &str) -> Result<Option<AgentTask>, AppError> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, conversation_id, goal_id, turn_index, continuation_index,
                            profile_id, session_id, prompt, state, created_at_ms,
                            updated_at_ms, finish_reason, steps, error_code, error_message
                     FROM agent_tasks WHERE id = ?1",
                    [task_id],
                    task_from_row,
                )
                .optional()
                .map_err(Into::into)
        })
    }

    pub fn tasks(&self, limit: usize) -> Result<Vec<AgentTask>, AppError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, conversation_id, goal_id, turn_index, continuation_index,
                        profile_id, session_id, prompt, state, created_at_ms,
                        updated_at_ms, finish_reason, steps, error_code, error_message
                 FROM agent_tasks ORDER BY created_at_ms DESC LIMIT ?1",
            )?;
            let rows = statement.query_map([limit.clamp(1, 200) as i64], task_from_row)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
        })
    }

    pub fn delete_task(&self, task_id: &str) -> Result<bool, AppError> {
        self.with_connection(|connection| {
            Ok(connection.execute("DELETE FROM agent_tasks WHERE id = ?1", [task_id])? > 0)
        })
    }

    pub fn tool_requested(
        &self,
        task_id: &str,
        call_id: &str,
        tool_name: &str,
        arguments: &serde_json::Value,
    ) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO tool_calls(
                    id, task_id, tool_name, arguments_json, state, started_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, 'requested', ?5)
                 ON CONFLICT(id) DO NOTHING",
                params![
                    call_id,
                    task_id,
                    tool_name,
                    serde_json::to_string(arguments)?,
                    now_ms(),
                ],
            )?;
            Ok(())
        })
    }

    pub fn tool_completed(
        &self,
        call_id: &str,
        result_preview: &str,
        is_error: bool,
    ) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "UPDATE tool_calls SET state = ?2, result_preview = ?3,
                    is_error = ?4, completed_at_ms = ?5 WHERE id = ?1",
                params![
                    call_id,
                    if is_error { "failed" } else { "succeeded" },
                    result_preview,
                    is_error,
                    now_ms(),
                ],
            )?;
            Ok(())
        })
    }

    pub fn approval_requested(
        &self,
        task_id: &str,
        call_id: &str,
        risk: &str,
        reason: &str,
        expires_at_ms: i64,
    ) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO approvals(
                    id, task_id, tool_call_id, risk, reason, state, expires_at_ms
                 ) VALUES (?1, ?2, ?1, ?3, ?4, 'pending', ?5)
                 ON CONFLICT(id) DO NOTHING",
                params![call_id, task_id, risk, reason, expires_at_ms],
            )?;
            Ok(())
        })
    }

    pub fn approval_decided(&self, call_id: &str, approved: bool) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "UPDATE approvals SET state = ?2, decided_at_ms = ?3
                 WHERE id = ?1 AND state = 'pending'",
                params![
                    call_id,
                    if approved { "allowed" } else { "denied" },
                    now_ms(),
                ],
            )?;
            Ok(())
        })
    }

    pub fn approval_decision(&self, call_id: &str) -> Result<Option<bool>, AppError> {
        self.with_connection(|connection| {
            let state: Option<String> = connection
                .query_row(
                    "SELECT state FROM approvals WHERE id = ?1",
                    [call_id],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(match state.as_deref() {
                Some("allowed") => Some(true),
                Some("denied") => Some(false),
                _ => None,
            })
        })
    }

    pub fn job_started(&self, job: &ExecutionJob) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO execution_jobs(
                    id, task_id, goal_id, conversation_id, tool_call_id, state, exit_code, signal,
                    started_at_ms, completed_at_ms, artifact_path
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    job.id,
                    job.task_id,
                    job.goal_id,
                    job.conversation_id,
                    job.tool_call_id,
                    job.state,
                    job.exit_code,
                    job.signal,
                    job.started_at_ms,
                    job.completed_at_ms,
                    job.artifact_path,
                ],
            )?;
            Ok(())
        })
    }

    pub fn job_finished(
        &self,
        job_id: &str,
        state: &str,
        exit_code: Option<i32>,
        signal: Option<&str>,
    ) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "UPDATE execution_jobs SET state = ?2, exit_code = ?3, signal = ?4,
                    completed_at_ms = ?5 WHERE id = ?1",
                params![job_id, state, exit_code, signal, now_ms()],
            )?;
            Ok(())
        })
    }

    pub fn job_canceling(&self, job_id: &str) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "UPDATE execution_jobs SET state = 'canceling'
                 WHERE id = ?1 AND state = 'running'",
                [job_id],
            )?;
            Ok(())
        })
    }

    pub fn job(&self, job_id: &str) -> Result<Option<ExecutionJob>, AppError> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, task_id, goal_id, conversation_id, tool_call_id, state,
                            exit_code, signal, started_at_ms, completed_at_ms, artifact_path
                     FROM execution_jobs WHERE id = ?1",
                    [job_id],
                    |row| {
                        Ok(ExecutionJob {
                            id: row.get(0)?,
                            task_id: row.get(1)?,
                            goal_id: row.get(2)?,
                            conversation_id: row.get(3)?,
                            tool_call_id: row.get(4)?,
                            state: row.get(5)?,
                            exit_code: row.get(6)?,
                            signal: row.get(7)?,
                            started_at_ms: row.get(8)?,
                            completed_at_ms: row.get(9)?,
                            artifact_path: row.get(10)?,
                        })
                    },
                )
                .optional()
                .map_err(Into::into)
        })
    }

    pub fn running_job_count(&self, task_id: &str) -> Result<usize, AppError> {
        self.with_connection(|connection| {
            let count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM execution_jobs
                 WHERE task_id = ?1 AND state IN ('running', 'canceling')",
                [task_id],
                |row| row.get(0),
            )?;
            usize::try_from(count)
                .map_err(|_| AppError::Storage("invalid running job count".to_owned()))
        })
    }

    pub fn running_job_count_for_goal(&self, goal_id: &str) -> Result<usize, AppError> {
        self.with_connection(|connection| {
            let count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM execution_jobs
                 WHERE goal_id = ?1 AND state IN ('running', 'canceling')",
                [goal_id],
                |row| row.get(0),
            )?;
            usize::try_from(count)
                .map_err(|_| AppError::Storage("invalid Goal running job count".to_owned()))
        })
    }

    pub fn running_job_count_for_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<usize, AppError> {
        self.with_connection(|connection| {
            let count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM execution_jobs
                 WHERE conversation_id = ?1 AND state IN ('running', 'canceling')",
                [conversation_id],
                |row| row.get(0),
            )?;
            usize::try_from(count)
                .map_err(|_| AppError::Storage("invalid running job count".to_owned()))
        })
    }

    pub fn request_cancel(&self, task_id: &str) -> Result<bool, AppError> {
        self.with_connection(|connection| {
            Ok(connection.execute(
                "UPDATE agent_tasks SET cancel_requested = 1, updated_at_ms = ?2
                 WHERE id = ?1 AND state IN ('queued', 'running', 'waiting_approval')",
                params![task_id, now_ms()],
            )? > 0)
        })
    }

    pub fn cancel_requested(&self, task_id: &str) -> Result<bool, AppError> {
        self.with_connection(|connection| {
            Ok(connection
                .query_row(
                    "SELECT cancel_requested FROM agent_tasks WHERE id = ?1",
                    [task_id],
                    |row| row.get::<_, bool>(0),
                )
                .optional()?
                .unwrap_or(false))
        })
    }

    pub fn recover_stale_tasks(&self, cutoff_ms: i64) -> Result<usize, AppError> {
        self.with_connection(|connection| recover_interrupted_tasks(connection, cutoff_ms))
    }

    pub fn close(&self) -> Result<(), AppError> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| AppError::Storage("agent database lock is poisoned".to_owned()))?;
        let Some(connection) = guard.take() else {
            return Ok(());
        };
        connection
            .close()
            .map_err(|(_, error)| AppError::Database(error))
    }

    fn with_connection<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| AppError::Storage("agent database lock is poisoned".to_owned()))?;
        if guard.is_none() {
            *guard = Some(open_and_migrate(&self.path)?);
        }
        operation(guard.as_mut().expect("connection initialized"))
    }
}

fn open_and_migrate(path: &Path) -> Result<Connection, AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    reset_incompatible_database(path)?;
    let mut connection = Connection::open(path)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;

    let transaction = connection.transaction()?;
    initialize_schema(&transaction)?;
    transaction.commit()?;
    Ok(connection)
}

fn reset_incompatible_database(path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        return Ok(());
    }
    let current_version = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .and_then(|connection| {
            connection
                .query_row(
                    "SELECT value FROM schema_meta WHERE key = 'schema_version'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
        });
    if matches!(current_version, Ok(Some(version)) if version == SCHEMA_VERSION) {
        return Ok(());
    }

    tracing::warn!(
        event = "agent_database_reset",
        path = %path.display(),
        found_schema = ?current_version.as_ref().ok().and_then(|value| value.as_ref()),
        expected_schema = SCHEMA_VERSION,
        error = current_version.as_ref().err().map(ToString::to_string),
        "removing incompatible development-stage Agent database"
    );
    for suffix in ["", "-wal", "-shm"] {
        let mut value = path.as_os_str().to_os_string();
        value.push(suffix);
        let candidate = PathBuf::from(value);
        if let Err(error) = fs::remove_file(&candidate) {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(AppError::Io(error));
            }
        }
    }
    Ok(())
}

fn initialize_schema(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            value INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS agent_conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS agent_conversations_updated_idx
            ON agent_conversations(updated_at_ms DESC);
         CREATE TABLE IF NOT EXISTS agent_goals (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            objective TEXT NOT NULL,
            status TEXT NOT NULL,
            token_budget INTEGER,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            continuation_count INTEGER NOT NULL DEFAULT 0,
            current_turn_id TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            completed_at_ms INTEGER,
            last_checkpoint_json TEXT,
            last_error TEXT,
            blocked_reason TEXT,
            no_progress_count INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS agent_goals_conversation_idx
            ON agent_goals(conversation_id, created_at_ms DESC);
         CREATE TABLE IF NOT EXISTS agent_tasks (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            goal_id TEXT,
            turn_index INTEGER NOT NULL DEFAULT 1,
            continuation_index INTEGER NOT NULL DEFAULT 0,
            profile_id TEXT NOT NULL,
            session_id TEXT,
            prompt TEXT NOT NULL,
            state TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            finish_reason TEXT,
            steps INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            error_message TEXT,
            next_sequence INTEGER NOT NULL DEFAULT 1,
            cancel_requested INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE,
            FOREIGN KEY(goal_id) REFERENCES agent_goals(id) ON DELETE SET NULL
          );
          CREATE INDEX IF NOT EXISTS agent_tasks_created_idx
             ON agent_tasks(created_at_ms DESC);
          CREATE INDEX IF NOT EXISTS agent_tasks_conversation_idx
             ON agent_tasks(conversation_id, turn_index, created_at_ms);
          CREATE INDEX IF NOT EXISTS agent_tasks_goal_idx
             ON agent_tasks(goal_id, continuation_index, created_at_ms);
         CREATE TABLE IF NOT EXISTS agent_queued_inputs (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            goal_id TEXT,
            content TEXT NOT NULL,
            mode TEXT NOT NULL,
            state TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            consumed_at_ms INTEGER,
            FOREIGN KEY(conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS agent_queued_inputs_pending_idx
            ON agent_queued_inputs(conversation_id, state, created_at_ms);
         CREATE TABLE IF NOT EXISTS agent_evidence (
            id TEXT PRIMARY KEY,
            goal_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            capability_id TEXT NOT NULL,
            artifact_path TEXT NOT NULL,
            bytes INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY(conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS agent_evidence_goal_idx
            ON agent_evidence(goal_id, created_at_ms);
         CREATE TABLE IF NOT EXISTS agent_goal_skills (
            goal_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            loaded_at_ms INTEGER NOT NULL,
            PRIMARY KEY(goal_id, skill_id),
            FOREIGN KEY(goal_id) REFERENCES agent_goals(id) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS agent_events (
            task_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            schema_version INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            PRIMARY KEY(task_id, sequence),
            FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS tool_calls (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            arguments_json TEXT NOT NULL,
            state TEXT NOT NULL,
            result_preview TEXT,
            is_error INTEGER NOT NULL DEFAULT 0,
            started_at_ms INTEGER NOT NULL,
            completed_at_ms INTEGER,
            FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS approvals (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            tool_call_id TEXT NOT NULL,
            risk TEXT NOT NULL,
            reason TEXT NOT NULL,
            state TEXT NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            decided_at_ms INTEGER,
            FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS execution_jobs (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            goal_id TEXT,
            conversation_id TEXT,
            tool_call_id TEXT NOT NULL,
            state TEXT NOT NULL,
            exit_code INTEGER,
            signal TEXT,
            started_at_ms INTEGER NOT NULL,
            completed_at_ms INTEGER,
            artifact_path TEXT,
            FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS execution_jobs_goal_idx
             ON execution_jobs(goal_id, state, started_at_ms);",
    )?;
    transaction.execute(
        "INSERT INTO schema_meta(key, value) VALUES('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [SCHEMA_VERSION],
    )?;
    Ok(())
}

fn recover_interrupted_tasks(
    connection: &mut Connection,
    cutoff_ms: i64,
) -> Result<usize, AppError> {
    let recovered_at = now_ms();
    let transaction = connection.transaction()?;
    transaction.execute(
        "UPDATE execution_jobs SET state = 'lost', completed_at_ms = ?1
         WHERE state IN ('running', 'canceling')
           AND task_id IN (
               SELECT id FROM agent_tasks
               WHERE state IN ('queued', 'running', 'waiting_approval')
                 AND updated_at_ms < ?2
           )",
        params![recovered_at, cutoff_ms],
    )?;
    transaction.execute(
        "UPDATE approvals SET state = 'denied', decided_at_ms = ?1
         WHERE state = 'pending'
           AND task_id IN (
               SELECT id FROM agent_tasks
               WHERE state IN ('queued', 'running', 'waiting_approval')
                 AND updated_at_ms < ?2
           )",
        params![recovered_at, cutoff_ms],
    )?;
    transaction.execute(
        "UPDATE agent_goals SET
            status = 'paused', current_turn_id = NULL, updated_at_ms = ?1,
            last_checkpoint_json = COALESCE(
                last_checkpoint_json,
                '{\"reason\":\"process_restart\",\"resumeRequired\":true}'
            ),
            last_error = 'myterm stopped before the active Turn reached a terminal state'
         WHERE status NOT IN ('completed', 'failed', 'canceled')
           AND id IN (
               SELECT DISTINCT goal_id FROM agent_tasks
               WHERE goal_id IS NOT NULL
                 AND state IN ('queued', 'running', 'waiting_approval')
                 AND updated_at_ms < ?2
           )",
        params![recovered_at, cutoff_ms],
    )?;
    let recovered = transaction.execute(
        "UPDATE agent_tasks SET
            state = 'failed', finish_reason = 'interrupted',
            error_code = 'agent_interrupted',
            error_message = 'myterm stopped before the task reached a terminal state',
            updated_at_ms = ?1
         WHERE state IN ('queued', 'running', 'waiting_approval')
           AND updated_at_ms < ?2",
        params![recovered_at, cutoff_ms],
    )?;
    transaction.commit()?;
    Ok(recovered)
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentTask> {
    let state: String = row.get(8)?;
    let state = AgentTaskState::try_from(state.as_str()).map_err(|message| {
        rusqlite::Error::FromSqlConversionFailure(
            8,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                message,
            )),
        )
    })?;
    Ok(AgentTask {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        goal_id: row.get(2)?,
        turn_index: row.get(3)?,
        continuation_index: row.get(4)?,
        profile_id: row.get(5)?,
        session_id: row.get(6)?,
        prompt: row.get(7)?,
        state,
        created_at_ms: row.get(9)?,
        updated_at_ms: row.get(10)?,
        finish_reason: row.get(11)?,
        steps: row.get(12)?,
        error_code: row.get(13)?,
        error_message: row.get(14)?,
    })
}

fn goal_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentGoal> {
    let status: String = row.get(3)?;
    let status = AgentGoalStatus::try_from(status.as_str()).map_err(|message| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                message,
            )),
        )
    })?;
    let checkpoint = row
        .get::<_, Option<String>>(11)?
        .map(|value| serde_json::from_str(&value))
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                11,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    Ok(AgentGoal {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        objective: row.get(2)?,
        status,
        token_budget: row
            .get::<_, Option<i64>>(4)?
            .map(|value| u64::try_from(value).unwrap_or_default()),
        tokens_used: u64::try_from(row.get::<_, i64>(5)?).unwrap_or_default(),
        continuation_count: u32::try_from(row.get::<_, i64>(6)?).unwrap_or(u32::MAX),
        current_turn_id: row.get(7)?,
        created_at_ms: row.get(8)?,
        updated_at_ms: row.get(9)?,
        completed_at_ms: row.get(10)?,
        last_checkpoint: checkpoint,
        last_error: row.get(12)?,
        blocked_reason: row.get(13)?,
        no_progress_count: u32::try_from(row.get::<_, i64>(14)?).unwrap_or(u32::MAX),
    })
}

fn queued_input_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentQueuedInput> {
    let mode: String = row.get(4)?;
    let mode = match mode.as_str() {
        "steer" => AgentInputMode::Steer,
        "queue" => AgentInputMode::Queue,
        _ => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("unknown queued input mode '{mode}'"),
                )),
            ));
        }
    };
    Ok(AgentQueuedInput {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        goal_id: row.get(2)?,
        content: row.get(3)?,
        mode,
        state: row.get(5)?,
        created_at_ms: row.get(6)?,
        consumed_at_ms: row.get(7)?,
    })
}

fn conversation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentConversation> {
    Ok(AgentConversation {
        id: row.get(0)?,
        title: row.get(1)?,
        profile_id: row.get(2)?,
        created_at_ms: row.get(3)?,
        updated_at_ms: row.get(4)?,
        turn_count: u32::try_from(row.get::<_, i64>(5)?).unwrap_or(u32::MAX),
    })
}

fn conversation_title(prompt: &str) -> String {
    let normalized = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return "新对话".to_owned();
    }
    let mut title = normalized.chars().take(48).collect::<String>();
    if normalized.chars().count() > 48 {
        title.push('…');
    }
    title
}

fn sql_u64(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

#[cfg(test)]
mod tests {
    use super::{AgentStore, GoalUpdate};
    use crate::{
        agent::domain::{
            now_ms, AgentEvidence, AgentGoalStatus, AgentInputMode, AgentTask, AgentTaskState,
            ExecutionJob,
        },
        types::AgentEvent,
    };
    use rusqlite::Connection;

    fn task(id: &str) -> AgentTask {
        AgentTask {
            id: id.to_owned(),
            conversation_id: id.to_owned(),
            goal_id: None,
            turn_index: 1,
            continuation_index: 0,
            profile_id: "ai".to_owned(),
            session_id: Some("ssh".to_owned()),
            prompt: "inspect host".to_owned(),
            state: AgentTaskState::Queued,
            created_at_ms: now_ms(),
            updated_at_ms: now_ms(),
            finish_reason: None,
            steps: 0,
            error_code: None,
            error_message: None,
        }
    }

    fn create_task_with_conversation(
        store: &AgentStore,
        task: &AgentTask,
    ) -> Result<(), crate::AppError> {
        store.create_conversation(&task.conversation_id, &task.profile_id, &task.prompt)?;
        store.create_task(task)
    }

    #[test]
    fn background_job_state_is_persisted_and_removed_api_state_is_cleaned(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = std::env::temp_dir().join(format!("myterm-job-store-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root)?;
        let database_path = root.join("agent.db");
        let legacy = Connection::open(&database_path)?;
        legacy.execute_batch(
            "CREATE TABLE api_idempotency_keys (
                key TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                request_hash TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL
             );
             INSERT INTO api_idempotency_keys VALUES ('old-key', 'old-task', 'old-hash', 1);",
        )?;
        drop(legacy);

        let store = AgentStore::new(database_path);
        let task = task("task-job");
        create_task_with_conversation(&store, &task)?;
        store.job_started(&ExecutionJob {
            id: "job-1".to_owned(),
            task_id: task.id.clone(),
            goal_id: None,
            conversation_id: Some(task.conversation_id.clone()),
            tool_call_id: "call-1".to_owned(),
            state: "running".to_owned(),
            exit_code: None,
            signal: None,
            started_at_ms: now_ms(),
            completed_at_ms: None,
            artifact_path: Some("artifacts/job-1".to_owned()),
        })?;
        assert_eq!(store.running_job_count(&task.id)?, 1);
        store.job_finished("job-1", "succeeded", Some(0), None)?;
        assert_eq!(store.job("job-1")?.expect("job").exit_code, Some(0));
        assert_eq!(store.running_job_count(&task.id)?, 0);

        let api_table_count = store.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'table' AND name = 'api_idempotency_keys'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(Into::into)
        })?;
        assert_eq!(api_table_count, 0);
        drop(store);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn incompatible_agent_database_is_recreated_without_legacy_tasks(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = std::env::temp_dir().join(format!(
            "myterm-conversation-migrate-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root)?;
        let database_path = root.join("agent.db");
        let legacy = Connection::open(&database_path)?;
        legacy.execute_batch(
            r#"CREATE TABLE agent_tasks (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL,
                session_id TEXT,
                prompt TEXT NOT NULL,
                state TEXT NOT NULL,
                permission_mode TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                finish_reason TEXT,
                steps INTEGER NOT NULL DEFAULT 0,
                error_code TEXT,
                error_message TEXT,
                next_sequence INTEGER NOT NULL DEFAULT 1,
                cancel_requested INTEGER NOT NULL DEFAULT 0
             );
             INSERT INTO agent_tasks VALUES(
                'legacy-task', 'ai', NULL, '参数之间是有空格的', 'succeeded',
                '"confirm"', 1, 2, 'stop', 1, NULL, NULL, 1, 0
             );"#,
        )?;
        drop(legacy);

        let store = AgentStore::new(database_path);
        let conversations = store.conversations(10)?;
        assert!(conversations.is_empty());
        let permission_columns = store.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('agent_tasks') WHERE name = 'permission_mode'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(Into::into)
        })?;
        assert_eq!(permission_columns, 0);
        drop(store);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    fn event(id: &str) -> AgentEvent {
        AgentEvent {
            schema_version: 0,
            sequence: 0,
            created_at_ms: 0,
            event_type: "status".to_owned(),
            run_id: id.to_owned(),
            step: None,
            call_id: None,
            tool_name: None,
            plugin_id: None,
            message: Some("running".to_owned()),
            content: None,
            arguments: None,
            is_error: None,
            error_code: None,
        }
    }

    #[test]
    fn store_is_lazy_and_events_are_monotonic_and_resumable(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root =
            std::env::temp_dir().join(format!("myterm-agent-store-{}", uuid::Uuid::new_v4()));
        let path = root.join("agent.db");
        let store = AgentStore::new(path.clone());
        assert!(!path.exists());
        create_task_with_conversation(&store, &task("task-1"))?;
        for _ in 0..10_000 {
            store.append_event(event("task-1"))?;
        }
        let tail = store.events_after("task-1", 9_990, 20)?;
        assert_eq!(tail.len(), 10);
        assert_eq!(tail.first().map(|item| item.sequence), Some(9_991));
        assert_eq!(tail.last().map(|item| item.sequence), Some(10_000));
        drop(store);

        let reopened = AgentStore::new(path);
        reopened.recover_stale_tasks(now_ms() + 1)?;
        assert_eq!(reopened.events_after("task-1", 9_999, 10)?.len(), 1);
        assert_eq!(
            reopened.task("task-1")?.unwrap().state,
            AgentTaskState::Failed
        );
        drop(reopened);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn terminal_tasks_cannot_be_reopened() -> Result<(), Box<dyn std::error::Error>> {
        let root =
            std::env::temp_dir().join(format!("myterm-agent-state-{}", uuid::Uuid::new_v4()));
        let store = AgentStore::new(root.join("agent.db"));
        create_task_with_conversation(&store, &task("task-1"))?;
        store.transition_task("task-1", AgentTaskState::Running, None, 0, None)?;
        store.transition_task("task-1", AgentTaskState::Succeeded, Some("stop"), 1, None)?;
        assert!(store
            .transition_task("task-1", AgentTaskState::Running, None, 1, None)
            .is_err());
        drop(store);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn process_restart_fails_only_the_turn_and_pauses_its_goal_for_resume(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root =
            std::env::temp_dir().join(format!("myterm-agent-recovery-{}", uuid::Uuid::new_v4()));
        let path = root.join("agent.db");
        let store = AgentStore::new(path.clone());
        let conversation = store.create_conversation("conversation", "ai", "long task")?;
        let goal = store.create_goal(&conversation.id, "finish safely", Some(10_000))?;
        let mut interrupted = task("turn-running");
        interrupted.conversation_id = conversation.id;
        interrupted.goal_id = Some(goal.id.clone());
        store.create_task(&interrupted)?;
        store.transition_task(&interrupted.id, AgentTaskState::Running, None, 0, None)?;
        drop(store);

        let reopened = AgentStore::new(path);
        assert_eq!(reopened.recover_stale_tasks(now_ms().saturating_add(1))?, 1);
        assert_eq!(
            reopened.task(&interrupted.id)?.expect("turn").state,
            AgentTaskState::Failed
        );
        let resumed = reopened.goal(&goal.id)?.expect("goal");
        assert_eq!(resumed.status, AgentGoalStatus::Paused);
        assert_eq!(
            resumed.last_checkpoint.expect("checkpoint")["reason"],
            "process_restart"
        );
        drop(reopened);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn goal_queue_jobs_and_evidence_survive_reopen() -> Result<(), Box<dyn std::error::Error>> {
        let root =
            std::env::temp_dir().join(format!("myterm-agent-goal-store-{}", uuid::Uuid::new_v4()));
        let path = root.join("agent.db");
        let store = AgentStore::new(path.clone());
        let conversation = store.create_conversation("conversation-1", "ai", "long task")?;
        let goal = store.create_goal(&conversation.id, "finish the long task", Some(10_000))?;
        let mut first_turn = task("turn-1");
        first_turn.conversation_id = conversation.id.clone();
        first_turn.goal_id = Some(goal.id.clone());
        store.create_task(&first_turn)?;
        let queued = store.enqueue_input(
            &conversation.id,
            Some(&goal.id),
            "also verify the second host",
            AgentInputMode::Queue,
        )?;
        store.save_evidence(&AgentEvidence {
            id: "ev-1".to_owned(),
            goal_id: goal.id.clone(),
            conversation_id: conversation.id.clone(),
            task_id: first_turn.id.clone(),
            capability_id: "mcp:test".to_owned(),
            artifact_path: root.join("ev-1.json").to_string_lossy().into_owned(),
            bytes: 42,
            created_at_ms: now_ms(),
        })?;
        store.job_started(&ExecutionJob {
            id: "job-goal-1".to_owned(),
            task_id: first_turn.id.clone(),
            goal_id: Some(goal.id.clone()),
            conversation_id: Some(conversation.id.clone()),
            tool_call_id: "call-1".to_owned(),
            state: "running".to_owned(),
            exit_code: None,
            signal: None,
            started_at_ms: now_ms(),
            completed_at_ms: None,
            artifact_path: None,
        })?;
        store.update_goal(
            &goal.id,
            GoalUpdate::new(AgentGoalStatus::WaitingExternal)
                .current_turn(Some(&first_turn.id))
                .tokens(123)
                .continuation(1)
                .checkpoint(Some(&serde_json::json!({ "jobId": "job-goal-1" })))
                .blocked_reason(Some("waiting for job")),
        )?;
        store.activate_goal_skill(&goal.id, "skill-safe-linux", "sha256-v1")?;
        drop(store);

        let reopened = AgentStore::new(path);
        let persisted = reopened.goal(&goal.id)?.expect("goal");
        assert_eq!(persisted.status, AgentGoalStatus::WaitingExternal);
        assert_eq!(persisted.tokens_used, 123);
        assert_eq!(persisted.continuation_count, 1);
        assert_eq!(reopened.running_job_count_for_goal(&goal.id)?, 1);
        assert_eq!(reopened.evidence("ev-1")?.expect("evidence").bytes, 42);
        assert_eq!(
            reopened.goal_skill_ids(&goal.id)?,
            vec!["skill-safe-linux".to_owned()]
        );
        assert_eq!(
            reopened
                .consume_next_input(&conversation.id)?
                .expect("queued input")
                .id,
            queued.id
        );
        drop(reopened);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}

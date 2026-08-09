use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use rusqlite::{params, Connection, OptionalExtension, Transaction};

use super::domain::{now_ms, AgentTask, AgentTaskState, ExecutionJob};
use crate::{types::AgentEvent, AppError};

const SCHEMA_VERSION: i64 = 4;

pub struct AgentStore {
    path: PathBuf,
    connection: Mutex<Option<Connection>>,
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

    pub fn create_task(&self, task: &AgentTask) -> Result<(), AppError> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO agent_tasks (
                    id, profile_id, session_id, prompt, state, permission_mode,
                    created_at_ms, updated_at_ms, finish_reason, steps,
                    error_code, error_message, next_sequence
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1)",
                params![
                    task.id,
                    task.profile_id,
                    task.session_id,
                    task.prompt,
                    task.state.as_str(),
                    serde_json::to_string(&task.permission_mode)?,
                    task.created_at_ms,
                    task.updated_at_ms,
                    task.finish_reason,
                    task.steps,
                    task.error_code,
                    task.error_message,
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
            event.schema_version = 1;
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
                    "SELECT id, profile_id, session_id, prompt, state, permission_mode,
                            created_at_ms, updated_at_ms, finish_reason, steps,
                            error_code, error_message
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
                "SELECT id, profile_id, session_id, prompt, state, permission_mode,
                        created_at_ms, updated_at_ms, finish_reason, steps,
                        error_code, error_message
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
                    id, task_id, tool_call_id, state, exit_code, signal,
                    started_at_ms, completed_at_ms, artifact_path
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    job.id,
                    job.task_id,
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
                    "SELECT id, task_id, tool_call_id, state, exit_code, signal,
                            started_at_ms, completed_at_ms, artifact_path
                     FROM execution_jobs WHERE id = ?1",
                    [job_id],
                    |row| {
                        Ok(ExecutionJob {
                            id: row.get(0)?,
                            task_id: row.get(1)?,
                            tool_call_id: row.get(2)?,
                            state: row.get(3)?,
                            exit_code: row.get(4)?,
                            signal: row.get(5)?,
                            started_at_ms: row.get(6)?,
                            completed_at_ms: row.get(7)?,
                            artifact_path: row.get(8)?,
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
    let mut connection = Connection::open(path)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;

    let transaction = connection.transaction()?;
    migrate(&transaction)?;
    transaction.commit()?;
    Ok(connection)
}

fn migrate(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            value INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS agent_tasks (
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
         CREATE INDEX IF NOT EXISTS agent_tasks_created_idx
            ON agent_tasks(created_at_ms DESC);
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
            tool_call_id TEXT NOT NULL,
            state TEXT NOT NULL,
            exit_code INTEGER,
            signal TEXT,
            started_at_ms INTEGER NOT NULL,
            completed_at_ms INTEGER,
            artifact_path TEXT,
            FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
         );",
    )?;
    transaction.execute("DROP TABLE IF EXISTS api_idempotency_keys", [])?;
    let has_cancel_column: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('agent_tasks') WHERE name = 'cancel_requested'",
        [],
        |row| row.get(0),
    )?;
    if has_cancel_column == 0 {
        transaction.execute(
            "ALTER TABLE agent_tasks ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    transaction.execute(
        "INSERT INTO schema_meta(key, value) VALUES('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [SCHEMA_VERSION],
    )?;
    Ok(())
}

fn recover_interrupted_tasks(connection: &Connection, cutoff_ms: i64) -> Result<usize, AppError> {
    connection.execute(
        "UPDATE execution_jobs SET state = 'lost', completed_at_ms = ?1
         WHERE state IN ('running', 'canceling')
           AND task_id IN (
               SELECT id FROM agent_tasks
               WHERE state IN ('queued', 'running', 'waiting_approval')
                 AND updated_at_ms < ?2
           )",
        params![now_ms(), cutoff_ms],
    )?;
    Ok(connection.execute(
        "UPDATE agent_tasks SET
            state = 'failed', finish_reason = 'interrupted',
            error_code = 'agent_interrupted',
            error_message = 'myterm stopped before the task reached a terminal state',
            updated_at_ms = ?1
         WHERE state IN ('queued', 'running', 'waiting_approval')
           AND updated_at_ms < ?2",
        params![now_ms(), cutoff_ms],
    )?)
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentTask> {
    let state: String = row.get(4)?;
    let permission: String = row.get(5)?;
    let state = AgentTaskState::try_from(state.as_str()).map_err(|message| {
        rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                message,
            )),
        )
    })?;
    let permission_mode = serde_json::from_str(&permission).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(AgentTask {
        id: row.get(0)?,
        profile_id: row.get(1)?,
        session_id: row.get(2)?,
        prompt: row.get(3)?,
        state,
        permission_mode,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
        finish_reason: row.get(8)?,
        steps: row.get(9)?,
        error_code: row.get(10)?,
        error_message: row.get(11)?,
    })
}

#[cfg(test)]
mod tests {
    use super::AgentStore;
    use crate::{
        agent::domain::{now_ms, AgentTask, AgentTaskState, ExecutionJob},
        types::{AgentEvent, AgentPermissionMode},
    };
    use rusqlite::Connection;

    fn task(id: &str) -> AgentTask {
        AgentTask {
            id: id.to_owned(),
            profile_id: "ai".to_owned(),
            session_id: Some("ssh".to_owned()),
            prompt: "inspect host".to_owned(),
            state: AgentTaskState::Queued,
            permission_mode: AgentPermissionMode::Confirm,
            created_at_ms: now_ms(),
            updated_at_ms: now_ms(),
            finish_reason: None,
            steps: 0,
            error_code: None,
            error_message: None,
        }
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
        store.create_task(&task)?;
        store.job_started(&ExecutionJob {
            id: "job-1".to_owned(),
            task_id: task.id.clone(),
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
            message: Some("running".to_owned()),
            content: None,
            arguments: None,
            is_error: None,
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
        store.create_task(&task("task-1"))?;
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
        store.create_task(&task("task-1"))?;
        store.transition_task("task-1", AgentTaskState::Running, None, 0, None)?;
        store.transition_task("task-1", AgentTaskState::Succeeded, Some("stop"), 1, None)?;
        assert!(store
            .transition_task("task-1", AgentTaskState::Running, None, 1, None)
            .is_err());
        drop(store);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}

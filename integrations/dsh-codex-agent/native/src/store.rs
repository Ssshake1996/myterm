use std::{
    fs,
    ops::{Deref, DerefMut},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::{
    error::CoreError,
    types::{ChatMessage, GraphEdge, ThreadSnapshot},
};

#[derive(Clone, Debug)]
pub struct CompactionState {
    pub summary: Option<String>,
    pub compacted_through_seq: i64,
    pub revision: u64,
}

pub struct ThreadStore {
    path: PathBuf,
    connection: Mutex<Option<Connection>>,
}

struct ConnectionGuard<'a>(MutexGuard<'a, Option<Connection>>);

impl Deref for ConnectionGuard<'_> {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        self.0
            .as_ref()
            .expect("ThreadStore connection guard is only created while open")
    }
}

impl DerefMut for ConnectionGuard<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.0
            .as_mut()
            .expect("ThreadStore connection guard is only created while open")
    }
}

impl ThreadStore {
    pub fn open(state_dir: impl AsRef<Path>) -> Result<Self, CoreError> {
        let state_dir = state_dir.as_ref();
        fs::create_dir_all(state_dir).map_err(|error| CoreError::Store {
            operation: "create_state_dir",
            detail: error.to_string(),
        })?;
        let path = state_dir.join("codex-core.sqlite3");
        let connection = Connection::open(&path).map_err(store_error("open"))?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA foreign_keys=ON;
                 PRAGMA synchronous=FULL;
                 CREATE TABLE IF NOT EXISTS threads (
                    id TEXT PRIMARY KEY,
                    parent_id TEXT,
                    role TEXT NOT NULL,
                    cwd TEXT,
                    status TEXT NOT NULL,
                    result TEXT,
                    error TEXT,
                    summary TEXT,
                    compacted_through_seq INTEGER NOT NULL DEFAULT -1,
                    summary_revision INTEGER NOT NULL DEFAULT 0,
                    created_at_ms INTEGER NOT NULL,
                    updated_at_ms INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS messages (
                    thread_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    message_json TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL,
                    PRIMARY KEY(thread_id, seq),
                    FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
                 );
                 CREATE TABLE IF NOT EXISTS graph_edges (
                    child_id TEXT PRIMARY KEY,
                    parent_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    result TEXT,
                    error TEXT,
                    summary_revision INTEGER NOT NULL DEFAULT 0,
                    updated_at_ms INTEGER NOT NULL,
                    FOREIGN KEY(parent_id) REFERENCES threads(id) ON DELETE CASCADE,
                    FOREIGN KEY(child_id) REFERENCES threads(id) ON DELETE CASCADE
                 );
                 CREATE INDEX IF NOT EXISTS graph_edges_parent_idx
                    ON graph_edges(parent_id, child_id);
                 CREATE TABLE IF NOT EXISTS compactions (
                    thread_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    summary TEXT NOT NULL,
                    source_message_count INTEGER NOT NULL,
                    compacted_through_seq INTEGER NOT NULL,
                    created_at_ms INTEGER NOT NULL,
                    PRIMARY KEY(thread_id, revision),
                    FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
                 );
                 CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_id TEXT,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL
                 );",
            )
            .map_err(store_error("migrate"))?;
        let has_graph_summary_revision = {
            let mut statement = connection
                .prepare("PRAGMA table_info(graph_edges)")
                .map_err(store_error("inspect_graph_schema"))?;
            statement
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(store_error("read_graph_schema"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(store_error("collect_graph_schema"))?
                .iter()
                .any(|column| column == "summary_revision")
        };
        if !has_graph_summary_revision {
            connection
                .execute(
                    "ALTER TABLE graph_edges ADD COLUMN summary_revision INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .map_err(store_error("migrate_graph_summary_revision"))?;
        }
        Ok(Self {
            path,
            connection: Mutex::new(Some(connection)),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn create_thread(
        &self,
        id: &str,
        parent_id: Option<&str>,
        role: &str,
        cwd: Option<&str>,
    ) -> Result<(), CoreError> {
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(store_error("create_thread_begin"))?;
        transaction
            .execute(
                "INSERT INTO threads(
                    id, parent_id, role, cwd, status, created_at_ms, updated_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, 'idle', ?5, ?5)",
                params![id, parent_id, role, cwd, now],
            )
            .map_err(store_error("create_thread"))?;
        if let Some(parent_id) = parent_id {
            transaction
                .execute(
                    "INSERT INTO graph_edges(child_id, parent_id, status, updated_at_ms)
                     VALUES(?1, ?2, 'open', ?3)",
                    params![id, parent_id, now],
                )
                .map_err(store_error("create_graph_edge"))?;
        }
        transaction
            .commit()
            .map_err(store_error("create_thread_commit"))
    }

    pub fn thread_exists(&self, id: &str) -> Result<bool, CoreError> {
        let connection = self.connection()?;
        let exists = connection
            .query_row("SELECT 1 FROM threads WHERE id = ?1", [id], |_| Ok(()))
            .optional()
            .map_err(store_error("thread_exists"))?
            .is_some();
        Ok(exists)
    }

    pub fn delete_thread(&self, id: &str) -> Result<(), CoreError> {
        let connection = self.connection()?;
        let children: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM graph_edges WHERE parent_id = ?1",
                [id],
                |row| row.get(0),
            )
            .map_err(store_error("count_thread_children"))?;
        if children != 0 {
            return Err(CoreError::Store {
                operation: "delete_thread",
                detail: format!("thread {id} still owns {children} child graph edges"),
            });
        }
        let changed = connection
            .execute("DELETE FROM threads WHERE id = ?1", [id])
            .map_err(store_error("delete_thread"))?;
        if changed != 1 {
            return Err(CoreError::ThreadNotFound(id.to_owned()));
        }
        Ok(())
    }

    pub fn append_message(&self, thread_id: &str, message: &ChatMessage) -> Result<i64, CoreError> {
        let serialized = serde_json::to_string(message).map_err(|error| CoreError::Store {
            operation: "serialize_message",
            detail: error.to_string(),
        })?;
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(store_error("append_message_begin"))?;
        let seq: i64 = transaction
            .query_row(
                "SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE thread_id = ?1",
                [thread_id],
                |row| row.get(0),
            )
            .map_err(store_error("next_message_seq"))?;
        transaction
            .execute(
                "INSERT INTO messages(thread_id, seq, message_json, created_at_ms)
                 VALUES(?1, ?2, ?3, ?4)",
                params![thread_id, seq, serialized, now],
            )
            .map_err(store_error("append_message"))?;
        transaction
            .execute(
                "UPDATE threads SET updated_at_ms = ?2 WHERE id = ?1",
                params![thread_id, now],
            )
            .map_err(store_error("touch_thread"))?;
        transaction
            .commit()
            .map_err(store_error("append_message_commit"))?;
        Ok(seq)
    }

    pub fn load_messages(&self, thread_id: &str) -> Result<Vec<(i64, ChatMessage)>, CoreError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT seq, message_json FROM messages
                 WHERE thread_id = ?1 ORDER BY seq ASC",
            )
            .map_err(store_error("prepare_load_messages"))?;
        let rows = statement
            .query_map([thread_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(store_error("load_messages"))?;
        let mut messages = Vec::new();
        for row in rows {
            let (seq, serialized) = row.map_err(store_error("read_message"))?;
            let message = serde_json::from_str(&serialized).map_err(|error| CoreError::Store {
                operation: "deserialize_message",
                detail: format!("thread={thread_id} seq={seq}: {error}"),
            })?;
            messages.push((seq, message));
        }
        Ok(messages)
    }

    pub fn compaction_state(&self, thread_id: &str) -> Result<CompactionState, CoreError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT summary, compacted_through_seq, summary_revision
                 FROM threads WHERE id = ?1",
                [thread_id],
                |row| {
                    Ok(CompactionState {
                        summary: row.get(0)?,
                        compacted_through_seq: row.get(1)?,
                        revision: row.get::<_, i64>(2)? as u64,
                    })
                },
            )
            .optional()
            .map_err(store_error("load_compaction_state"))?
            .ok_or_else(|| CoreError::ThreadNotFound(thread_id.to_owned()))
    }

    pub fn commit_compaction(
        &self,
        thread_id: &str,
        summary: &str,
        source_message_count: usize,
        compacted_through_seq: i64,
    ) -> Result<u64, CoreError> {
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(store_error("compaction_begin"))?;
        let revision: u64 = transaction
            .query_row(
                "SELECT summary_revision + 1 FROM threads WHERE id = ?1",
                [thread_id],
                |row| Ok(row.get::<_, i64>(0)? as u64),
            )
            .optional()
            .map_err(store_error("compaction_revision"))?
            .ok_or_else(|| CoreError::ThreadNotFound(thread_id.to_owned()))?;
        transaction
            .execute(
                "INSERT INTO compactions(
                    thread_id, revision, summary, source_message_count,
                    compacted_through_seq, created_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    thread_id,
                    revision as i64,
                    summary,
                    source_message_count as i64,
                    compacted_through_seq,
                    now,
                ],
            )
            .map_err(store_error("insert_compaction"))?;
        let changed = transaction
            .execute(
                "UPDATE threads SET
                    summary = ?2,
                    compacted_through_seq = ?3,
                    summary_revision = ?4,
                    updated_at_ms = ?5
                 WHERE id = ?1",
                params![
                    thread_id,
                    summary,
                    compacted_through_seq,
                    revision as i64,
                    now
                ],
            )
            .map_err(store_error("update_compaction"))?;
        if changed != 1 {
            return Err(CoreError::ThreadNotFound(thread_id.to_owned()));
        }
        transaction
            .execute(
                "UPDATE graph_edges SET summary_revision = ?2, updated_at_ms = ?3
                 WHERE child_id = ?1",
                params![thread_id, revision as i64, now],
            )
            .map_err(store_error("update_graph_compaction"))?;
        transaction
            .execute(
                "INSERT INTO audit_events(thread_id, event_type, payload_json, created_at_ms)
                 VALUES(?1, 'compaction_committed', ?2, ?3)",
                params![
                    thread_id,
                    serde_json::json!({
                        "revision": revision,
                        "sourceMessageCount": source_message_count,
                        "compactedThroughSeq": compacted_through_seq,
                    })
                    .to_string(),
                    now,
                ],
            )
            .map_err(store_error("audit_compaction"))?;
        transaction
            .commit()
            .map_err(store_error("compaction_commit"))?;
        Ok(revision)
    }

    pub fn set_thread_status(
        &self,
        thread_id: &str,
        status: &str,
        result: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), CoreError> {
        let now = now_ms();
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(store_error("thread_status_begin"))?;
        let changed = transaction
            .execute(
                "UPDATE threads SET status = ?2, result = ?3, error = ?4, updated_at_ms = ?5
                 WHERE id = ?1",
                params![thread_id, status, result, error, now],
            )
            .map_err(store_error("thread_status"))?;
        if changed != 1 {
            return Err(CoreError::ThreadNotFound(thread_id.to_owned()));
        }
        transaction
            .execute(
                "UPDATE graph_edges SET status = ?2, result = ?3, error = ?4, updated_at_ms = ?5
                 WHERE child_id = ?1",
                params![thread_id, status, result, error, now],
            )
            .map_err(store_error("graph_status"))?;
        transaction
            .commit()
            .map_err(store_error("thread_status_commit"))
    }

    pub fn thread_snapshot(&self, thread_id: &str) -> Result<ThreadSnapshot, CoreError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT id, parent_id, role, status, result, error, summary_revision,
                        (SELECT COUNT(*) FROM messages WHERE messages.thread_id = threads.id)
                 FROM threads WHERE id = ?1",
                [thread_id],
                |row| {
                    Ok(ThreadSnapshot {
                        thread_id: row.get(0)?,
                        parent_thread_id: row.get(1)?,
                        role: row.get(2)?,
                        status: row.get(3)?,
                        result: row.get(4)?,
                        error: row.get(5)?,
                        summary_revision: row.get::<_, i64>(6)? as u64,
                        message_count: row.get::<_, i64>(7)? as usize,
                    })
                },
            )
            .optional()
            .map_err(store_error("thread_snapshot"))?
            .ok_or_else(|| CoreError::ThreadNotFound(thread_id.to_owned()))
    }

    pub fn graph_edges(&self, root_thread_id: &str) -> Result<Vec<GraphEdge>, CoreError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "WITH RECURSIVE descendants(child_id) AS (
                    SELECT child_id FROM graph_edges WHERE parent_id = ?1
                    UNION ALL
                    SELECT graph_edges.child_id FROM graph_edges
                    JOIN descendants ON graph_edges.parent_id = descendants.child_id
                 )
                 SELECT parent_id, child_id, status, result, error, summary_revision
                 FROM graph_edges WHERE child_id IN descendants
                 ORDER BY parent_id, child_id",
            )
            .map_err(store_error("prepare_graph_edges"))?;
        let rows = statement
            .query_map([root_thread_id], |row| {
                Ok(GraphEdge {
                    parent_thread_id: row.get(0)?,
                    child_thread_id: row.get(1)?,
                    status: row.get(2)?,
                    result: row.get(3)?,
                    error: row.get(4)?,
                    summary_revision: row.get::<_, i64>(5)? as u64,
                })
            })
            .map_err(store_error("graph_edges"))?;
        rows.map(|row| row.map_err(store_error("read_graph_edge")))
            .collect()
    }

    pub fn audit(
        &self,
        thread_id: Option<&str>,
        event_type: &str,
        payload: &Value,
    ) -> Result<(), CoreError> {
        let serialized = serde_json::to_string(payload).map_err(|error| CoreError::Store {
            operation: "serialize_audit",
            detail: error.to_string(),
        })?;
        self.connection()?
            .execute(
                "INSERT INTO audit_events(thread_id, event_type, payload_json, created_at_ms)
                 VALUES(?1, ?2, ?3, ?4)",
                params![thread_id, event_type, serialized, now_ms()],
            )
            .map_err(store_error("audit"))?;
        Ok(())
    }

    pub fn close(&self) -> Result<(), CoreError> {
        let mut guard = self.connection.lock().map_err(|_| CoreError::Store {
            operation: "sqlite_lock",
            detail: "SQLite mutex was poisoned".to_owned(),
        })?;
        let Some(connection) = guard.take() else {
            return Ok(());
        };
        connection.close().map_err(|(_, error)| CoreError::Store {
            operation: "close",
            detail: error.to_string(),
        })
    }

    fn connection(&self) -> Result<ConnectionGuard<'_>, CoreError> {
        let guard = self.connection.lock().map_err(|_| CoreError::Store {
            operation: "sqlite_lock",
            detail: "SQLite mutex was poisoned".to_owned(),
        })?;
        if guard.is_none() {
            return Err(CoreError::Store {
                operation: "sqlite",
                detail: "ThreadStore is closed".to_owned(),
            });
        }
        Ok(ConnectionGuard(guard))
    }
}

fn store_error(operation: &'static str) -> impl FnOnce(rusqlite::Error) -> CoreError {
    move |error| CoreError::Store {
        operation,
        detail: error.to_string(),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::MessageRole;
    use tempfile::TempDir;

    #[test]
    fn persists_thread_graph_and_compaction_without_secret_material() {
        let temp = TempDir::new().unwrap();
        let store = ThreadStore::open(temp.path()).unwrap();
        store
            .create_thread("root", None, "root", Some("C:/workspace"))
            .unwrap();
        store
            .create_thread("child", Some("root"), "reviewer", Some("C:/workspace"))
            .unwrap();
        store
            .append_message("root", &ChatMessage::text(MessageRole::User, "hello"))
            .unwrap();
        let revision = store
            .commit_compaction("root", "safe summary", 1, 0)
            .unwrap();
        assert_eq!(revision, 1);
        store
            .set_thread_status("child", "completed", Some("done"), None)
            .unwrap();

        let graph = store.graph_edges("root").unwrap();
        assert_eq!(graph.len(), 1);
        assert_eq!(graph[0].status, "completed");
        assert_eq!(store.thread_snapshot("root").unwrap().summary_revision, 1);

        drop(store);
        let bytes = fs::read(temp.path().join("codex-core.sqlite3")).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("sk-never-write-this"));
    }

    #[test]
    fn reopening_restores_thread_and_graph_state() {
        let temp = TempDir::new().unwrap();
        {
            let store = ThreadStore::open(temp.path()).unwrap();
            store.create_thread("root", None, "root", None).unwrap();
            store
                .create_thread("child", Some("root"), "worker", None)
                .unwrap();
        }
        let reopened = ThreadStore::open(temp.path()).unwrap();
        assert!(reopened.thread_exists("root").unwrap());
        assert_eq!(reopened.graph_edges("root").unwrap().len(), 1);
    }

    #[test]
    fn subagent_compaction_revision_is_committed_to_thread_and_graph_atomically() {
        let temp = TempDir::new().unwrap();
        let store = ThreadStore::open(temp.path()).unwrap();
        store.create_thread("root", None, "root", None).unwrap();
        store
            .create_thread("child", Some("root"), "worker", None)
            .unwrap();
        store
            .append_message(
                "child",
                &ChatMessage::text(MessageRole::User, "context".to_owned()),
            )
            .unwrap();
        let revision = store.commit_compaction("child", "summary", 1, 0).unwrap();

        assert_eq!(revision, 1);
        assert_eq!(store.thread_snapshot("child").unwrap().summary_revision, 1);
        assert_eq!(store.graph_edges("root").unwrap()[0].summary_revision, 1);
    }
}

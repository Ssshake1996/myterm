use std::{
    collections::HashMap,
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant, UNIX_EPOCH},
};

use russh_sftp::client::SftpSession;
use sha2::{Digest, Sha256};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::{Mutex, RwLock, Semaphore},
};

use crate::{
    session::{
        manager::SessionManager,
        ssh::{ExecOutputSink, ExecStream},
    },
    types::{
        RemoteEntry, RemoteFileMatch, RemoteFileRead, RemoteFileStat, SessionId, TransferId,
        TransferProgress, TransferState,
    },
    AppError,
};

const BLOCK_SIZE: usize = 64 * 1024;
const MAX_AGENT_FILE_BYTES: u64 = 1024 * 1024;

pub trait TransferEventSink: Send + Sync {
    fn progress(&self, progress: &TransferProgress);
}

pub struct NullTransferSink;

impl TransferEventSink for NullTransferSink {
    fn progress(&self, _progress: &TransferProgress) {}
}

struct DiscardExecOutput;

impl ExecOutputSink for DiscardExecOutput {
    fn send(&self, _stream: ExecStream, _data: &[u8]) -> Result<(), AppError> {
        Ok(())
    }
}

pub struct SftpService {
    sessions: Arc<SessionManager>,
    sftp: RwLock<HashMap<SessionId, Arc<SftpSession>>>,
    cancellations: Mutex<HashMap<TransferId, Arc<AtomicBool>>>,
    concurrency: Arc<Semaphore>,
    events: Arc<dyn TransferEventSink>,
}

impl SftpService {
    pub fn new(sessions: Arc<SessionManager>, events: Arc<dyn TransferEventSink>) -> Self {
        Self {
            sessions,
            sftp: RwLock::new(HashMap::new()),
            cancellations: Mutex::new(HashMap::new()),
            concurrency: Arc::new(Semaphore::new(2)),
            events,
        }
    }

    pub async fn read_dir(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<RemoteEntry>, AppError> {
        let sftp = self.session(session_id).await?;
        let mut result = Vec::new();
        for entry in sftp
            .read_dir(path)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?
        {
            let metadata = entry.metadata();
            result.push(RemoteEntry {
                name: entry.file_name(),
                path: entry.path(),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                modified: i64::from(metadata.mtime.unwrap_or(0)),
                permissions: format_permissions(metadata.permissions.unwrap_or(0)),
            });
        }
        result.sort_by(|left, right| {
            right
                .is_dir
                .cmp(&left.is_dir)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(result)
    }

    pub async fn default_directory(&self, session_id: &str) -> Result<String, AppError> {
        self.session(session_id)
            .await?
            .canonicalize(".")
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))
    }

    pub async fn mkdir(&self, session_id: &str, path: &str) -> Result<(), AppError> {
        self.session(session_id)
            .await?
            .create_dir(path)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))
    }

    pub async fn file_stat(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<RemoteFileStat, AppError> {
        let sftp = self.session(session_id).await?;
        let metadata = sftp
            .symlink_metadata(path)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        let sha256 = if !metadata.is_dir()
            && !metadata.is_symlink()
            && metadata.len() <= MAX_AGENT_FILE_BYTES
        {
            let bytes = sftp
                .read(path)
                .await
                .map_err(|error| AppError::Sftp(error.to_string()))?;
            Some(hex_digest(&bytes))
        } else {
            None
        };
        Ok(RemoteFileStat {
            path: path.to_owned(),
            is_dir: metadata.is_dir(),
            is_symlink: metadata.is_symlink(),
            size: metadata.len(),
            modified: i64::from(metadata.mtime.unwrap_or(0)),
            permissions: format_permissions(metadata.permissions.unwrap_or(0)),
            sha256,
        })
    }

    pub async fn file_read(
        &self,
        session_id: &str,
        path: &str,
        offset: u64,
        limit: u64,
    ) -> Result<RemoteFileRead, AppError> {
        let sftp = self.session(session_id).await?;
        let metadata = sftp
            .symlink_metadata(path)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        if metadata.is_dir() || metadata.is_symlink() {
            return Err(AppError::InvalidInput(
                "file_read refuses directories and symbolic links".to_owned(),
            ));
        }
        let limit = limit.clamp(1, MAX_AGENT_FILE_BYTES);
        let mut file = sftp
            .open(path)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        file.seek(std::io::SeekFrom::Start(offset)).await?;
        let mut bytes = Vec::with_capacity(limit as usize);
        file.take(limit).read_to_end(&mut bytes).await?;
        if bytes.contains(&0) {
            return Err(AppError::InvalidInput(
                "file_read refuses binary content".to_owned(),
            ));
        }
        let content = String::from_utf8(bytes.clone()).map_err(|_| {
            AppError::InvalidInput("file_read content is not valid UTF-8".to_owned())
        })?;
        Ok(RemoteFileRead {
            path: path.to_owned(),
            offset,
            bytes: bytes.len() as u64,
            eof: offset.saturating_add(bytes.len() as u64) >= metadata.len(),
            sha256: hex_digest(&bytes),
            content,
        })
    }

    pub async fn file_write_atomic(
        &self,
        session_id: &str,
        path: &str,
        content: &[u8],
        expected_hash: Option<&str>,
    ) -> Result<RemoteFileStat, AppError> {
        if content.len() as u64 > MAX_AGENT_FILE_BYTES {
            return Err(AppError::InvalidInput(format!(
                "agent file writes are limited to {MAX_AGENT_FILE_BYTES} bytes"
            )));
        }
        if content.contains(&0) {
            return Err(AppError::InvalidInput(
                "file_write refuses binary content".to_owned(),
            ));
        }
        let sftp = self.session(session_id).await?;
        let exists = sftp
            .try_exists(path)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        let metadata = if exists {
            let metadata = sftp
                .symlink_metadata(path)
                .await
                .map_err(|error| AppError::Sftp(error.to_string()))?;
            if metadata.is_dir() || metadata.is_symlink() {
                return Err(AppError::InvalidInput(
                    "file_write refuses directories and symbolic links".to_owned(),
                ));
            }
            if metadata.len() > MAX_AGENT_FILE_BYTES {
                return Err(AppError::InvalidInput(format!(
                    "agent file writes require the existing file to be at most {MAX_AGENT_FILE_BYTES} bytes"
                )));
            }
            let current = sftp
                .read(path)
                .await
                .map_err(|error| AppError::Sftp(error.to_string()))?;
            if let Some(expected) = expected_hash {
                let actual = hex_digest(&current);
                if !constant_time_eq(expected.as_bytes(), actual.as_bytes()) {
                    return Err(AppError::Agent(format!(
                        "file changed since it was read; expected {expected}, found {actual}"
                    )));
                }
            }
            Some(metadata)
        } else {
            if expected_hash.is_some() {
                return Err(AppError::Agent(
                    "file does not exist but an expected hash was provided".to_owned(),
                ));
            }
            None
        };
        let replace_existing = metadata.is_some();
        let (parent, name) = split_remote_path(path)?;
        let temporary = format!(
            "{}/.{}.myterm-{}.tmp",
            parent.trim_end_matches('/'),
            name,
            uuid::Uuid::new_v4()
        );
        let mut file = sftp
            .create(temporary.clone())
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        file.write_all(content)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        file.sync_all()
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        file.shutdown()
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        if let Some(mut metadata) = metadata {
            metadata.size = None;
            metadata.atime = None;
            metadata.mtime = None;
            sftp.set_metadata(temporary.clone(), metadata)
                .await
                .map_err(|error| AppError::Sftp(error.to_string()))?;
        }
        let replaced = if replace_existing {
            let (_cancel, receiver) = tokio::sync::watch::channel(false);
            let command = format!("mv -f -- {} {}", shell_quote(&temporary), shell_quote(path));
            self.sessions
                .remote_exec(
                    session_id,
                    &command,
                    Duration::from_secs(30),
                    receiver,
                    Arc::new(DiscardExecOutput),
                )
                .await
                .map(|result| {
                    result.exit_code == Some(0)
                        && !result.timed_out
                        && !result.canceled
                        && !result.disconnected
                })
                .unwrap_or(false)
        } else {
            sftp.rename(temporary.clone(), path).await.is_ok()
        };
        if !replaced {
            let _ = sftp.remove_file(temporary).await;
            return Err(AppError::Sftp(
                "atomic remote file replacement failed".to_owned(),
            ));
        }
        let readback = sftp
            .read(path)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        if hex_digest(&readback) != hex_digest(content) {
            return Err(AppError::Agent(
                "file readback did not match the requested content".to_owned(),
            ));
        }
        self.file_stat(session_id, path).await
    }

    pub async fn file_search(
        &self,
        session_id: &str,
        path: &str,
        pattern: &str,
        max_files: usize,
        max_matches: usize,
    ) -> Result<Vec<RemoteFileMatch>, AppError> {
        if pattern.is_empty() {
            return Err(AppError::InvalidInput(
                "file_search pattern is required".to_owned(),
            ));
        }
        let sftp = self.session(session_id).await?;
        let mut state = SearchState {
            pattern: pattern.to_owned(),
            files_seen: 0,
            max_files: max_files.clamp(1, 500),
            max_matches: max_matches.clamp(1, 1_000),
            matches: Vec::new(),
        };
        search_remote_tree(sftp, path.to_owned(), 0, &mut state).await?;
        Ok(state.matches)
    }

    pub async fn rename(&self, session_id: &str, from: &str, to: &str) -> Result<(), AppError> {
        self.session(session_id)
            .await?
            .rename(from, to)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))
    }

    pub async fn delete(
        &self,
        session_id: &str,
        path: &str,
        recursive: bool,
    ) -> Result<(), AppError> {
        let sftp = self.session(session_id).await?;
        let metadata = sftp
            .symlink_metadata(path)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        if metadata.is_dir() {
            if recursive {
                remove_remote_tree(sftp.clone(), path.to_owned()).await
            } else {
                sftp.remove_dir(path)
                    .await
                    .map_err(|error| AppError::Sftp(error.to_string()))
            }
        } else {
            sftp.remove_file(path)
                .await
                .map_err(|error| AppError::Sftp(error.to_string()))
        }
    }

    pub async fn upload(
        self: &Arc<Self>,
        session_id: String,
        local_path: PathBuf,
        remote_path: String,
    ) -> Result<TransferId, AppError> {
        if !local_path.exists() {
            return Err(AppError::NotFound(format!(
                "local path '{}'",
                local_path.display()
            )));
        }
        let transfer_id = uuid::Uuid::new_v4().to_string();
        let cancelled = Arc::new(AtomicBool::new(false));
        self.cancellations
            .lock()
            .await
            .insert(transfer_id.clone(), cancelled.clone());
        self.emit(&transfer_id, TransferState::Queued, 0, 0, 0, None);
        let service = self.clone();
        let task_id = transfer_id.clone();
        tokio::spawn(async move {
            let result = service
                .run_upload(
                    &task_id,
                    &session_id,
                    local_path,
                    remote_path,
                    cancelled.clone(),
                )
                .await;
            service.finish_transfer(&task_id, result, &cancelled).await;
        });
        Ok(transfer_id)
    }

    pub async fn download(
        self: &Arc<Self>,
        session_id: String,
        remote_path: String,
        local_path: PathBuf,
    ) -> Result<TransferId, AppError> {
        let transfer_id = uuid::Uuid::new_v4().to_string();
        let cancelled = Arc::new(AtomicBool::new(false));
        self.cancellations
            .lock()
            .await
            .insert(transfer_id.clone(), cancelled.clone());
        self.emit(&transfer_id, TransferState::Queued, 0, 0, 0, None);
        let service = self.clone();
        let task_id = transfer_id.clone();
        tokio::spawn(async move {
            let result = service
                .run_download(
                    &task_id,
                    &session_id,
                    remote_path,
                    local_path,
                    cancelled.clone(),
                )
                .await;
            service.finish_transfer(&task_id, result, &cancelled).await;
        });
        Ok(transfer_id)
    }

    pub async fn cancel(&self, transfer_id: &str) -> Result<(), AppError> {
        let cancellations = self.cancellations.lock().await;
        let cancellation = cancellations
            .get(transfer_id)
            .ok_or_else(|| AppError::NotFound(format!("transfer '{transfer_id}'")))?;
        cancellation.store(true, Ordering::Release);
        Ok(())
    }

    async fn run_upload(
        &self,
        transfer_id: &str,
        session_id: &str,
        local_path: PathBuf,
        remote_path: String,
        cancelled: Arc<AtomicBool>,
    ) -> Result<TransferStats, AppError> {
        let _permit = self
            .concurrency
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| AppError::Sftp("transfer queue is closed".to_owned()))?;
        let total = local_tree_size(local_path.clone()).await?;
        let context = TransferContext::new(transfer_id, total, cancelled, self.events.clone());
        context.emit(TransferState::Running, None);
        let sftp = self.session(session_id).await?;
        upload_path(sftp, local_path, remote_path, &context).await?;
        Ok(context.stats())
    }

    async fn run_download(
        &self,
        transfer_id: &str,
        session_id: &str,
        remote_path: String,
        local_path: PathBuf,
        cancelled: Arc<AtomicBool>,
    ) -> Result<TransferStats, AppError> {
        let _permit = self
            .concurrency
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| AppError::Sftp("transfer queue is closed".to_owned()))?;
        let sftp = self.session(session_id).await?;
        let total = remote_tree_size(sftp.clone(), remote_path.clone()).await?;
        let context = TransferContext::new(transfer_id, total, cancelled, self.events.clone());
        context.emit(TransferState::Running, None);
        download_path(sftp, remote_path, local_path, &context).await?;
        Ok(context.stats())
    }

    async fn finish_transfer(
        &self,
        transfer_id: &str,
        result: Result<TransferStats, AppError>,
        cancelled: &AtomicBool,
    ) {
        let state = if cancelled.load(Ordering::Acquire) {
            TransferState::Cancelled
        } else if result.is_ok() {
            TransferState::Done
        } else {
            TransferState::Failed
        };
        let stats = result.as_ref().ok().cloned().unwrap_or_default();
        let error = if state == TransferState::Cancelled {
            None
        } else {
            result.err().map(|error| error.to_string())
        };
        self.emit(
            transfer_id,
            state,
            stats.transferred,
            stats.total,
            stats.bytes_per_sec,
            error,
        );
        self.cancellations.lock().await.remove(transfer_id);
    }

    async fn session(&self, session_id: &str) -> Result<Arc<SftpSession>, AppError> {
        if let Some(session) = self.sftp.read().await.get(session_id).cloned() {
            return Ok(session);
        }
        let terminal = self.sessions.ssh_terminal(session_id)?;
        let session = Arc::new(terminal.open_sftp().await?);
        self.sftp
            .write()
            .await
            .insert(session_id.to_owned(), session.clone());
        Ok(session)
    }

    fn emit(
        &self,
        transfer_id: &str,
        state: TransferState,
        transferred: u64,
        total: u64,
        bytes_per_sec: u64,
        error: Option<String>,
    ) {
        self.events.progress(&TransferProgress {
            transfer_id: transfer_id.to_owned(),
            state,
            transferred,
            total,
            bytes_per_sec,
            error,
        });
    }
}

fn hex_digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn split_remote_path(path: &str) -> Result<(&str, &str), AppError> {
    let (parent, name) = path.rsplit_once('/').ok_or_else(|| {
        AppError::InvalidInput("remote file path must include its parent directory".to_owned())
    })?;
    if name.is_empty() || name == "." || name == ".." {
        return Err(AppError::InvalidInput(
            "remote file path has an invalid file name".to_owned(),
        ));
    }
    Ok((if parent.is_empty() { "/" } else { parent }, name))
}

struct SearchState {
    pattern: String,
    files_seen: usize,
    max_files: usize,
    max_matches: usize,
    matches: Vec<RemoteFileMatch>,
}

fn search_remote_tree<'a>(
    sftp: Arc<SftpSession>,
    path: String,
    depth: u8,
    state: &'a mut SearchState,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        if depth > 6
            || state.files_seen >= state.max_files
            || state.matches.len() >= state.max_matches
        {
            return Ok(());
        }
        let metadata = sftp
            .symlink_metadata(path.clone())
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        if metadata.is_symlink() {
            return Ok(());
        }
        if metadata.is_dir() {
            for entry in sftp
                .read_dir(path)
                .await
                .map_err(|error| AppError::Sftp(error.to_string()))?
            {
                search_remote_tree(sftp.clone(), entry.path(), depth + 1, state).await?;
                if state.files_seen >= state.max_files || state.matches.len() >= state.max_matches {
                    break;
                }
            }
            return Ok(());
        }
        state.files_seen += 1;
        if metadata.len() > MAX_AGENT_FILE_BYTES {
            return Ok(());
        }
        let bytes = sftp
            .read(path.clone())
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        if bytes.contains(&0) {
            return Ok(());
        }
        let Ok(content) = String::from_utf8(bytes) else {
            return Ok(());
        };
        for (index, line) in content.lines().enumerate() {
            if line.contains(&state.pattern) {
                state.matches.push(RemoteFileMatch {
                    path: path.clone(),
                    line: index as u64 + 1,
                    text: line.chars().take(500).collect(),
                });
                if state.matches.len() >= state.max_matches {
                    break;
                }
            }
        }
        Ok(())
    })
}

#[derive(Clone, Default)]
struct TransferStats {
    transferred: u64,
    total: u64,
    bytes_per_sec: u64,
}

struct TransferContext {
    id: String,
    total: u64,
    transferred: AtomicU64,
    cancelled: Arc<AtomicBool>,
    started: Instant,
    last_emit: Mutex<Instant>,
    events: Arc<dyn TransferEventSink>,
}

impl TransferContext {
    fn new(
        id: &str,
        total: u64,
        cancelled: Arc<AtomicBool>,
        events: Arc<dyn TransferEventSink>,
    ) -> Self {
        let started = Instant::now();
        Self {
            id: id.to_owned(),
            total,
            transferred: AtomicU64::new(0),
            cancelled,
            started,
            last_emit: Mutex::new(started - Duration::from_millis(100)),
            events,
        }
    }

    fn ensure_active(&self) -> Result<(), AppError> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(AppError::Sftp("transfer cancelled".to_owned()))
        } else {
            Ok(())
        }
    }

    async fn add(&self, bytes: u64) {
        self.transferred.fetch_add(bytes, Ordering::AcqRel);
        let mut last = self.last_emit.lock().await;
        if last.elapsed() >= Duration::from_millis(100) {
            self.emit(TransferState::Running, None);
            *last = Instant::now();
        }
    }

    fn emit(&self, state: TransferState, error: Option<String>) {
        let stats = self.stats();
        self.events.progress(&TransferProgress {
            transfer_id: self.id.clone(),
            state,
            transferred: stats.transferred,
            total: stats.total,
            bytes_per_sec: stats.bytes_per_sec,
            error,
        });
    }

    fn stats(&self) -> TransferStats {
        let transferred = self.transferred.load(Ordering::Acquire);
        let elapsed = self.started.elapsed().as_secs_f64().max(0.001);
        TransferStats {
            transferred,
            total: self.total,
            bytes_per_sec: (transferred as f64 / elapsed) as u64,
        }
    }
}

fn upload_path<'a>(
    sftp: Arc<SftpSession>,
    local: PathBuf,
    remote: String,
    context: &'a TransferContext,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        context.ensure_active()?;
        let metadata = fs::metadata(&local).await?;
        if metadata.is_dir() {
            if !sftp
                .try_exists(remote.clone())
                .await
                .map_err(|error| AppError::Sftp(error.to_string()))?
            {
                sftp.create_dir(remote.clone())
                    .await
                    .map_err(|error| AppError::Sftp(error.to_string()))?;
            }
            let mut entries = fs::read_dir(&local).await?;
            while let Some(entry) = entries.next_entry().await? {
                let name = entry.file_name().to_string_lossy().into_owned();
                upload_path(
                    sftp.clone(),
                    entry.path(),
                    format!("{}/{}", remote.trim_end_matches('/'), name),
                    context,
                )
                .await?;
            }
            return Ok(());
        }
        let partial = format!("{remote}.part");
        let mut source = fs::File::open(&local).await?;
        let mut destination = sftp
            .create(partial.clone())
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        let mut buffer = vec![0_u8; BLOCK_SIZE];
        loop {
            context.ensure_active().inspect_err(|_| {
                let sftp = sftp.clone();
                let partial = partial.clone();
                tokio::spawn(async move {
                    let _ = sftp.remove_file(partial).await;
                });
            })?;
            let length = source.read(&mut buffer).await?;
            if length == 0 {
                break;
            }
            destination
                .write_all(&buffer[..length])
                .await
                .map_err(|error| AppError::Sftp(error.to_string()))?;
            context.add(length as u64).await;
        }
        destination
            .shutdown()
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        sftp.rename(partial, remote)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))
    })
}

fn download_path<'a>(
    sftp: Arc<SftpSession>,
    remote: String,
    local: PathBuf,
    context: &'a TransferContext,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        context.ensure_active()?;
        let metadata = sftp
            .symlink_metadata(remote.clone())
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        if metadata.is_dir() {
            fs::create_dir_all(&local).await?;
            for entry in sftp
                .read_dir(remote.clone())
                .await
                .map_err(|error| AppError::Sftp(error.to_string()))?
            {
                download_path(
                    sftp.clone(),
                    entry.path(),
                    local.join(entry.file_name()),
                    context,
                )
                .await?;
            }
            return Ok(());
        }
        if let Some(parent) = local.parent() {
            fs::create_dir_all(parent).await?;
        }
        let partial = partial_local_path(&local);
        let mut source = sftp
            .open(remote)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        let mut destination = fs::File::create(&partial).await?;
        let mut buffer = vec![0_u8; BLOCK_SIZE];
        loop {
            if let Err(error) = context.ensure_active() {
                drop(destination);
                let _ = fs::remove_file(&partial).await;
                return Err(error);
            }
            let length = source
                .read(&mut buffer)
                .await
                .map_err(|error| AppError::Sftp(error.to_string()))?;
            if length == 0 {
                break;
            }
            destination.write_all(&buffer[..length]).await?;
            context.add(length as u64).await;
        }
        destination.flush().await?;
        drop(destination);
        fs::rename(partial, local).await?;
        Ok(())
    })
}

fn remove_remote_tree(
    sftp: Arc<SftpSession>,
    path: String,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send>> {
    Box::pin(async move {
        for entry in sftp
            .read_dir(path.clone())
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?
        {
            let entry_path = entry.path();
            if entry.metadata().is_dir() {
                remove_remote_tree(sftp.clone(), entry_path).await?;
            } else {
                sftp.remove_file(entry_path)
                    .await
                    .map_err(|error| AppError::Sftp(error.to_string()))?;
            }
        }
        sftp.remove_dir(path)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))
    })
}

fn remote_tree_size(
    sftp: Arc<SftpSession>,
    path: String,
) -> Pin<Box<dyn Future<Output = Result<u64, AppError>> + Send>> {
    Box::pin(async move {
        let metadata = sftp
            .symlink_metadata(path.clone())
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?;
        if !metadata.is_dir() {
            return Ok(metadata.len());
        }
        let mut total = 0;
        for entry in sftp
            .read_dir(path)
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))?
        {
            total += remote_tree_size(sftp.clone(), entry.path()).await?;
        }
        Ok(total)
    })
}

async fn local_tree_size(path: PathBuf) -> Result<u64, AppError> {
    tokio::task::spawn_blocking(move || local_tree_size_sync(&path))
        .await
        .map_err(|error| AppError::Sftp(error.to_string()))?
}

fn local_tree_size_sync(path: &Path) -> Result<u64, AppError> {
    let metadata = std::fs::metadata(path)?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    let mut total = 0;
    for entry in std::fs::read_dir(path)? {
        total += local_tree_size_sync(&entry?.path())?;
    }
    Ok(total)
}

fn partial_local_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map_or_else(|| "download".into(), |name| name.to_os_string());
    name.push(".part");
    path.with_file_name(name)
}

fn format_permissions(mode: u32) -> String {
    let mut value = String::with_capacity(9);
    for (mask, symbol) in [
        (0o400, 'r'),
        (0o200, 'w'),
        (0o100, 'x'),
        (0o040, 'r'),
        (0o020, 'w'),
        (0o010, 'x'),
        (0o004, 'r'),
        (0o002, 'w'),
        (0o001, 'x'),
    ] {
        value.push(if mode & mask == 0 { '-' } else { symbol });
    }
    value
}

pub fn local_entries(path: &Path) -> Result<Vec<crate::ipc::LocalEntry>, AppError> {
    let mut result = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_secs() as i64);
        result.push(crate::ipc::LocalEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified,
        });
    }
    result.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{format_permissions, partial_local_path};
    use std::path::Path;

    #[test]
    fn formats_permissions_and_partial_paths() {
        assert_eq!(format_permissions(0o755), "rwxr-xr-x");
        assert_eq!(
            partial_local_path(Path::new("C:\\tmp\\archive.tar")),
            Path::new("C:\\tmp\\archive.tar.part")
        );
    }
}

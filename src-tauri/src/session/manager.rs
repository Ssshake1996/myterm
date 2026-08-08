use std::{
    collections::HashMap,
    sync::{Arc, Mutex, RwLock},
};

use super::{buffer::TerminalBuffer, local::LocalTerminal, ssh::SshTerminal};
use crate::{
    types::{SessionId, SessionInfo, SessionProfile, SessionState, SessionTarget},
    AppError, SecretResolver,
};

pub trait OutputSink: Send + Sync {
    fn send(&self, data: &[u8]) -> Result<(), AppError>;
}

pub trait SessionEventSink: Send + Sync {
    fn state_changed(&self, session: &SessionInfo);
}

pub struct NullEventSink;

impl SessionEventSink for NullEventSink {
    fn state_changed(&self, _session: &SessionInfo) {}
}

struct BufferedSink {
    output: Arc<dyn OutputSink>,
    buffer: Arc<TerminalBuffer>,
}

impl OutputSink for BufferedSink {
    fn send(&self, data: &[u8]) -> Result<(), AppError> {
        self.buffer.push(data)?;
        self.output.send(data)
    }
}

enum SessionControl {
    Local(LocalTerminal),
    Ssh(SshTerminal),
}

struct ManagedSession {
    info: Mutex<SessionInfo>,
    buffer: Arc<TerminalBuffer>,
    control: SessionControl,
}

pub struct SessionManager {
    sessions: RwLock<HashMap<SessionId, Arc<ManagedSession>>>,
    resolver: Arc<dyn SecretResolver>,
    events: Arc<dyn SessionEventSink>,
}

impl SessionManager {
    pub fn new(resolver: Arc<dyn SecretResolver>, events: Arc<dyn SessionEventSink>) -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            resolver,
            events,
        }
    }

    pub async fn connect(
        self: &Arc<Self>,
        profile: SessionProfile,
        cols: u16,
        rows: u16,
        output: Arc<dyn OutputSink>,
    ) -> Result<SessionInfo, AppError> {
        let session_id = uuid::Uuid::new_v4().to_string();
        let connecting = SessionInfo {
            session_id: session_id.clone(),
            profile_id: profile.id.clone(),
            state: SessionState::Connecting,
            error: None,
        };
        self.events.state_changed(&connecting);
        let buffer = Arc::new(TerminalBuffer::default());
        let sink: Arc<dyn OutputSink> = Arc::new(BufferedSink {
            output,
            buffer: buffer.clone(),
        });
        let started: Result<(SessionControl, ExitSignal), AppError> = match &profile.target {
            SessionTarget::Local { shell } => {
                LocalTerminal::start(shell, cols, rows, sink).map(|(terminal, receiver)| {
                    (SessionControl::Local(terminal), ExitSignal::Local(receiver))
                })
            }
            SessionTarget::Ssh {
                host,
                port,
                username,
                auth,
            } => SshTerminal::connect(
                host,
                *port,
                username,
                auth,
                cols,
                rows,
                self.resolver.clone(),
                sink,
            )
            .await
            .map(|(terminal, receiver)| (SessionControl::Ssh(terminal), ExitSignal::Ssh(receiver))),
        };
        let (control, exit) = match started {
            Ok(value) => value,
            Err(error) => {
                self.events.state_changed(&SessionInfo {
                    state: SessionState::Failed,
                    error: Some(error.to_string()),
                    ..connecting
                });
                return Err(error);
            }
        };
        let connected = SessionInfo {
            state: SessionState::Connected,
            ..connecting
        };
        let session = Arc::new(ManagedSession {
            info: Mutex::new(connected.clone()),
            buffer,
            control,
        });
        self.sessions
            .write()
            .map_err(|_| AppError::Session("session map lock is poisoned".to_owned()))?
            .insert(session_id.clone(), session);
        self.events.state_changed(&connected);
        let weak = Arc::downgrade(self);
        let exited_id = session_id.clone();
        tokio::spawn(async move {
            exit.wait().await;
            if let Some(manager) = weak.upgrade() {
                let _ = manager.mark_disconnected(&exited_id, None);
            }
        });
        Ok(connected)
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<(), AppError> {
        let session = self.get(session_id)?;
        match &session.control {
            SessionControl::Local(terminal) => terminal.disconnect()?,
            SessionControl::Ssh(terminal) => terminal.disconnect().await?,
        }
        self.mark_disconnected(session_id, None)
    }

    pub async fn write(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
        let session = self.get(session_id)?;
        match &session.control {
            SessionControl::Local(terminal) => terminal.write(data),
            SessionControl::Ssh(terminal) => terminal.write(data).await,
        }
    }

    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let session = self.get(session_id)?;
        match &session.control {
            SessionControl::Local(terminal) => terminal.resize(cols, rows),
            SessionControl::Ssh(terminal) => terminal.resize(cols, rows).await,
        }
    }

    pub fn list(&self) -> Result<Vec<SessionInfo>, AppError> {
        self.sessions
            .read()
            .map_err(|_| AppError::Session("session map lock is poisoned".to_owned()))?
            .values()
            .map(|session| {
                session
                    .info
                    .lock()
                    .map(|info| info.clone())
                    .map_err(|_| AppError::Session("session state lock is poisoned".to_owned()))
            })
            .collect()
    }

    pub fn buffer_lines(&self, session_id: &str, count: usize) -> Result<String, AppError> {
        self.get(session_id)?.buffer.snapshot_lines(count)
    }

    pub(crate) fn ssh_terminal(&self, session_id: &str) -> Result<Arc<SshTerminal>, AppError> {
        let session = self.get(session_id)?;
        match &session.control {
            SessionControl::Ssh(terminal) => Ok(Arc::new(terminal.clone_handle())),
            SessionControl::Local(_) => Err(AppError::Sftp(
                "SFTP is only available for SSH sessions".to_owned(),
            )),
        }
    }

    fn get(&self, session_id: &str) -> Result<Arc<ManagedSession>, AppError> {
        self.sessions
            .read()
            .map_err(|_| AppError::Session("session map lock is poisoned".to_owned()))?
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("session '{session_id}'")))
    }

    fn mark_disconnected(&self, session_id: &str, error: Option<String>) -> Result<(), AppError> {
        let session = self.get(session_id)?;
        let mut info = session
            .info
            .lock()
            .map_err(|_| AppError::Session("session state lock is poisoned".to_owned()))?;
        info.state = if error.is_some() {
            SessionState::Failed
        } else {
            SessionState::Disconnected
        };
        info.error = error;
        let disconnected = info.clone();
        drop(info);
        self.events.state_changed(&disconnected);
        self.sessions
            .write()
            .map_err(|_| AppError::Session("session map lock is poisoned".to_owned()))?
            .remove(session_id);
        Ok(())
    }
}

enum ExitSignal {
    Local(std::sync::mpsc::Receiver<()>),
    Ssh(tokio::sync::oneshot::Receiver<()>),
}

impl ExitSignal {
    async fn wait(self) {
        match self {
            Self::Local(receiver) => {
                let _ = tokio::task::spawn_blocking(move || receiver.recv()).await;
            }
            Self::Ssh(receiver) => {
                let _ = receiver.await;
            }
        }
    }
}

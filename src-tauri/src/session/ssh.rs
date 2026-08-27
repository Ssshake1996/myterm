use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use russh::{
    client,
    keys::{self, ssh_key, HashAlg, PrivateKeyWithHashAlg},
    ChannelMsg, Disconnect,
};
use tokio::sync::{oneshot, Mutex};

use super::manager::OutputSink;
use crate::{config::atomic_replace, types::AuthMethod, AppError, SecretResolver};

fn ssh_failure(
    stage: &'static str,
    code: &'static str,
    summary: &'static str,
    detail: impl Into<String>,
) -> AppError {
    AppError::SessionFailure {
        stage,
        code,
        summary,
        detail: detail.into(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecStream {
    Stdout,
    Stderr,
}

pub trait ExecOutputSink: Send + Sync {
    fn send(&self, stream: ExecStream, data: &[u8]) -> Result<(), AppError>;
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub stdout_bytes: u64,
    pub stderr_bytes: u64,
    pub duration_ms: u64,
    pub timed_out: bool,
    pub canceled: bool,
    pub disconnected: bool,
}

pub struct ClientHandler {
    host_key: String,
    known_hosts_path: PathBuf,
}

impl client::Handler for ClientHandler {
    type Error = AppError;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint(HashAlg::Sha256).to_string();
        let mut known = read_known_hosts(&self.known_hosts_path)?;
        if let Some(expected) = known.get(&self.host_key) {
            if expected != &fingerprint {
                return Err(ssh_failure(
                    "host_key",
                    "SSH_HOST_KEY_CHANGED",
                    "SSH 主机密钥发生变化",
                    format!(
                        "server host key changed for {}; connection refused",
                        self.host_key
                    ),
                ));
            }
            return Ok(true);
        }
        known.insert(self.host_key.clone(), fingerprint);
        write_known_hosts(&self.known_hosts_path, &known)?;
        Ok(true)
    }
}

pub struct SshTerminal {
    writer: Arc<russh::ChannelWriteHalf<client::Msg>>,
    handle: Arc<Mutex<client::Handle<ClientHandler>>>,
}

impl SshTerminal {
    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        cols: u16,
        rows: u16,
        resolver: Arc<dyn SecretResolver>,
        sink: Arc<dyn OutputSink>,
    ) -> Result<(Self, oneshot::Receiver<()>), AppError> {
        let handler = ClientHandler {
            host_key: format!("{host}:{port}"),
            known_hosts_path: default_known_hosts_path()?,
        };
        let config = Arc::new(client::Config {
            inactivity_timeout: None,
            keepalive_interval: Some(Duration::from_secs(30)),
            keepalive_max: 3,
            ..client::Config::default()
        });
        let endpoint = format!("{host}:{port}");
        let mut handle = tokio::time::timeout(
            Duration::from_secs(10),
            client::connect(config, (host, port), handler),
        )
        .await
        .map_err(|_| {
            ssh_failure(
                "transport",
                "SSH_CONNECT_TIMEOUT",
                "SSH 连接超时",
                format!("connection to {endpoint} timed out after 10 seconds"),
            )
        })?
        .map_err(|error| {
            ssh_failure(
                "transport",
                "SSH_CONNECT_FAILED",
                "SSH 传输连接失败",
                format!("connection to {endpoint} failed: {error}"),
            )
        })?;
        let authenticated = match auth {
            AuthMethod::Password { vault_ref } => {
                let password = resolver.resolve(vault_ref).map_err(|error| {
                    ssh_failure(
                        "credentials",
                        "SSH_CREDENTIALS_UNAVAILABLE",
                        "读取 SSH 凭据失败",
                        error.detail(),
                    )
                })?;
                handle
                    .authenticate_password(username, password)
                    .await
                    .map_err(|error| {
                        ssh_failure(
                            "authentication",
                            "SSH_AUTH_REQUEST_FAILED",
                            "SSH 密码认证请求失败",
                            error.to_string(),
                        )
                    })?
                    .success()
            }
            AuthMethod::PrivateKey {
                key_path,
                passphrase_ref,
            } => {
                let passphrase = match passphrase_ref {
                    Some(reference) => Some(resolver.resolve(reference).map_err(|error| {
                        ssh_failure(
                            "credentials",
                            "SSH_CREDENTIALS_UNAVAILABLE",
                            "读取 SSH 凭据失败",
                            error.detail(),
                        )
                    })?),
                    None => None,
                };
                let private_key =
                    keys::load_secret_key(key_path, passphrase.as_deref()).map_err(|error| {
                        ssh_failure(
                            "credentials",
                            "SSH_PRIVATE_KEY_INVALID",
                            "SSH 私钥读取失败",
                            format!("private key error: {error}"),
                        )
                    })?;
                let hash = handle
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|error| {
                        ssh_failure(
                            "authentication",
                            "SSH_AUTH_CAPABILITY_FAILED",
                            "读取 SSH 公钥认证能力失败",
                            error.to_string(),
                        )
                    })?
                    .flatten();
                handle
                    .authenticate_publickey(
                        username,
                        PrivateKeyWithHashAlg::new(Arc::new(private_key), hash),
                    )
                    .await
                    .map_err(|error| {
                        ssh_failure(
                            "authentication",
                            "SSH_AUTH_REQUEST_FAILED",
                            "SSH 私钥认证请求失败",
                            error.to_string(),
                        )
                    })?
                    .success()
            }
        };
        if !authenticated {
            return Err(ssh_failure(
                "authentication",
                "SSH_AUTH_REJECTED",
                "SSH 认证被服务器拒绝",
                format!("server rejected authentication for user '{username}' at {endpoint}"),
            ));
        }
        let channel = handle.channel_open_session().await.map_err(|error| {
            ssh_failure(
                "channel",
                "SSH_CHANNEL_OPEN_FAILED",
                "SSH 会话通道创建失败",
                error.to_string(),
            )
        })?;
        channel
            .request_pty(
                true,
                "xterm-256color",
                u32::from(cols),
                u32::from(rows),
                0,
                0,
                &[],
            )
            .await
            .map_err(|error| {
                ssh_failure(
                    "terminal",
                    "SSH_PTY_REQUEST_FAILED",
                    "SSH 终端请求失败",
                    error.to_string(),
                )
            })?;
        channel.request_shell(true).await.map_err(|error| {
            ssh_failure(
                "terminal",
                "SSH_SHELL_REQUEST_FAILED",
                "SSH Shell 请求失败",
                error.to_string(),
            )
        })?;
        let (mut reader, writer) = channel.split();
        let writer = Arc::new(writer);
        let (exit_tx, exit_rx) = oneshot::channel();
        tokio::spawn(async move {
            while let Some(message) = reader.wait().await {
                match message {
                    ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                        if sink.send(data.as_ref()).is_err() {
                            break;
                        }
                    }
                    ChannelMsg::Close | ChannelMsg::Eof | ChannelMsg::ExitStatus { .. } => break,
                    _ => {}
                }
            }
            let _ = exit_tx.send(());
        });
        Ok((
            Self {
                writer,
                handle: Arc::new(Mutex::new(handle)),
            },
            exit_rx,
        ))
    }

    pub fn clone_handle(&self) -> Self {
        Self {
            writer: self.writer.clone(),
            handle: self.handle.clone(),
        }
    }

    pub async fn write(&self, data: &[u8]) -> Result<(), AppError> {
        self.writer.data(data).await.map_err(Into::into)
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        self.writer
            .window_change(u32::from(cols), u32::from(rows), 0, 0)
            .await
            .map_err(Into::into)
    }

    pub async fn disconnect(&self) -> Result<(), AppError> {
        let _ = self.writer.close().await;
        self.handle
            .lock()
            .await
            .disconnect(Disconnect::ByApplication, "session closed", "en")
            .await
            .map_err(Into::into)
    }

    pub async fn exec(
        &self,
        command: &str,
        timeout: Duration,
        mut cancel: tokio::sync::watch::Receiver<bool>,
        sink: Arc<dyn ExecOutputSink>,
    ) -> Result<ExecResult, AppError> {
        let mut channel = self.handle.lock().await.channel_open_session().await?;
        channel.exec(true, command.as_bytes()).await?;

        let started = std::time::Instant::now();
        let deadline = tokio::time::sleep(timeout);
        tokio::pin!(deadline);
        let mut stdout = Vec::with_capacity(64 * 1024);
        let mut stderr = Vec::with_capacity(64 * 1024);
        let mut stdout_bytes = 0_u64;
        let mut stderr_bytes = 0_u64;
        let mut exit_code = None;
        let mut signal = None;
        let mut timed_out = false;
        let mut canceled = false;
        let mut disconnected = false;
        let mut last_flush = std::time::Instant::now();

        loop {
            let message = tokio::select! {
                _ = &mut deadline => {
                    timed_out = true;
                    None
                }
                changed = cancel.changed() => {
                    if changed.is_ok() && *cancel.borrow() {
                        canceled = true;
                        None
                    } else {
                        continue;
                    }
                }
                message = channel.wait() => message,
            };

            match message {
                Some(ChannelMsg::Data { data }) => {
                    stdout_bytes = stdout_bytes.saturating_add(data.len() as u64);
                    stdout.extend_from_slice(data.as_ref());
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    stderr_bytes = stderr_bytes.saturating_add(data.len() as u64);
                    stderr.extend_from_slice(data.as_ref());
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    exit_code = i32::try_from(exit_status).ok();
                }
                Some(ChannelMsg::ExitSignal { signal_name, .. }) => {
                    signal = Some(format!("{signal_name:?}"));
                }
                Some(ChannelMsg::Eof) => {}
                Some(ChannelMsg::Close) => break,
                Some(_) => {}
                None => {
                    disconnected =
                        !timed_out && !canceled && exit_code.is_none() && signal.is_none();
                    let _ = channel.close().await;
                    break;
                }
            }

            if stdout.len() + stderr.len() >= 64 * 1024
                || last_flush.elapsed() >= Duration::from_millis(50)
            {
                flush_exec_output(&sink, &mut stdout, &mut stderr)?;
                last_flush = std::time::Instant::now();
            }
        }
        flush_exec_output(&sink, &mut stdout, &mut stderr)?;

        Ok(ExecResult {
            exit_code,
            signal,
            stdout_bytes,
            stderr_bytes,
            duration_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            timed_out,
            canceled,
            disconnected,
        })
    }

    pub(crate) async fn open_sftp(&self) -> Result<russh_sftp::client::SftpSession, AppError> {
        let channel = self.handle.lock().await.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        russh_sftp::client::SftpSession::new(channel.into_stream())
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))
    }
}

fn flush_exec_output(
    sink: &Arc<dyn ExecOutputSink>,
    stdout: &mut Vec<u8>,
    stderr: &mut Vec<u8>,
) -> Result<(), AppError> {
    if !stdout.is_empty() {
        sink.send(ExecStream::Stdout, stdout)?;
        stdout.clear();
    }
    if !stderr.is_empty() {
        sink.send(ExecStream::Stderr, stderr)?;
        stderr.clear();
    }
    Ok(())
}

fn default_known_hosts_path() -> Result<PathBuf, AppError> {
    let directory = dirs::config_dir().ok_or_else(|| {
        AppError::Config("operating system config directory is unavailable".to_owned())
    })?;
    Ok(directory.join("myterm").join("known_hosts.json"))
}

fn read_known_hosts(path: &Path) -> Result<BTreeMap<String, String>, AppError> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn write_known_hosts(path: &Path, known: &BTreeMap<String, String>) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(known)?)?;
    atomic_replace(&temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{read_known_hosts, ssh_failure, write_known_hosts};
    use std::collections::BTreeMap;

    #[test]
    fn known_hosts_overwrite_is_atomic_and_readable() -> Result<(), Box<dyn std::error::Error>> {
        let root =
            std::env::temp_dir().join(format!("myterm-known-hosts-{}", uuid::Uuid::new_v4()));
        let path = root.join("known_hosts.json");
        let mut known = BTreeMap::from([("host:22".to_owned(), "SHA256:first".to_owned())]);
        write_known_hosts(&path, &known)?;
        known.insert("host:22".to_owned(), "SHA256:second".to_owned());
        write_known_hosts(&path, &known)?;
        assert_eq!(read_known_hosts(&path)?, known);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn connection_failure_keeps_machine_code_and_original_detail() {
        let error = ssh_failure(
            "transport",
            "SSH_CONNECT_FAILED",
            "SSH 传输连接失败",
            "connection refused by 192.168.3.94:22",
        );
        assert_eq!(error.code(), "SSH_CONNECT_FAILED");
        assert_eq!(error.detail(), "connection refused by 192.168.3.94:22");
        let diagnostic = error.diagnostic().expect("diagnostic");
        assert_eq!(diagnostic.stage, "transport");
        assert_eq!(diagnostic.summary, "SSH 传输连接失败");
    }
}

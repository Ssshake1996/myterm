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
                return Err(AppError::Session(format!(
                    "server host key changed for {}; connection refused",
                    self.host_key
                )));
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
        let mut handle = tokio::time::timeout(
            Duration::from_secs(10),
            client::connect(config, (host, port), handler),
        )
        .await
        .map_err(|_| AppError::Session(format!("connection to {host}:{port} timed out")))??;
        let authenticated = match auth {
            AuthMethod::Password { vault_ref } => {
                let password = resolver.resolve(vault_ref)?;
                handle
                    .authenticate_password(username, password)
                    .await?
                    .success()
            }
            AuthMethod::PrivateKey {
                key_path,
                passphrase_ref,
            } => {
                let passphrase = match passphrase_ref {
                    Some(reference) => Some(resolver.resolve(reference)?),
                    None => None,
                };
                let private_key = keys::load_secret_key(key_path, passphrase.as_deref())
                    .map_err(|error| AppError::Session(format!("private key error: {error}")))?;
                let hash = handle.best_supported_rsa_hash().await?.flatten();
                handle
                    .authenticate_publickey(
                        username,
                        PrivateKeyWithHashAlg::new(Arc::new(private_key), hash),
                    )
                    .await?
                    .success()
            }
        };
        if !authenticated {
            return Err(AppError::Session("authentication failed".to_owned()));
        }
        let channel = handle.channel_open_session().await?;
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
            .await?;
        channel.request_shell(true).await?;
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

    pub(crate) async fn open_sftp(&self) -> Result<russh_sftp::client::SftpSession, AppError> {
        let channel = self.handle.lock().await.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        russh_sftp::client::SftpSession::new(channel.into_stream())
            .await
            .map_err(|error| AppError::Sftp(error.to_string()))
    }
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
    use super::{read_known_hosts, write_known_hosts};
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
}

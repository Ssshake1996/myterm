use std::{
    io::{Read, Write},
    path::Path,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

#[cfg(not(windows))]
use portable_pty::ChildKiller;

use super::manager::OutputSink;
use crate::AppError;

pub struct LocalTerminal {
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    #[cfg(not(windows))]
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    #[cfg(windows)]
    process_id: u32,
    disconnected: AtomicBool,
}

impl LocalTerminal {
    pub fn start(
        shell: &str,
        cols: u16,
        rows: u16,
        sink: Arc<dyn OutputSink>,
    ) -> Result<(Self, mpsc::Receiver<()>), AppError> {
        if !command_exists(shell) {
            return Err(AppError::Session(format!(
                "local shell executable '{shell}' was not found"
            )));
        }
        let system = native_pty_system();
        let pair = system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AppError::Session(error.to_string()))?;
        let mut command = CommandBuilder::new(shell);
        if let Some(home) = dirs::home_dir() {
            command.cwd(home);
        }
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| AppError::Session(error.to_string()))?;
        drop(pair.slave);
        #[cfg(not(windows))]
        let killer = child.clone_killer();
        #[cfg(windows)]
        let process_id = child
            .process_id()
            .ok_or_else(|| AppError::Session("local shell process ID is unavailable".to_owned()))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| AppError::Session(error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| AppError::Session(error.to_string()))?;
        let master = Arc::new(Mutex::new(Some(pair.master)));
        let reader_master = master.clone();
        let (exit_tx, exit_rx) = mpsc::channel();
        thread::Builder::new()
            .name("myterm-pty-reader".to_owned())
            .spawn(move || {
                let mut chunk = [0_u8; 64 * 1024];
                loop {
                    match reader.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(length) => {
                            if sink.send(&chunk[..length]).is_err() {
                                break;
                            }
                        }
                        Err(error) => {
                            tracing::debug!(%error, "local terminal reader stopped");
                            break;
                        }
                    }
                }
                drop(reader);
                if let Ok(mut master) = reader_master.lock() {
                    drop(master.take());
                }
            })
            .map_err(AppError::Io)?;
        thread::Builder::new()
            .name("myterm-pty-wait".to_owned())
            .spawn(move || {
                if let Err(error) = child.wait() {
                    tracing::debug!(%error, "local terminal child wait failed");
                }
                let _ = exit_tx.send(());
            })
            .map_err(AppError::Io)?;

        Ok((
            Self {
                master,
                writer: Mutex::new(Some(writer)),
                #[cfg(not(windows))]
                killer: Mutex::new(killer),
                #[cfg(windows)]
                process_id,
                disconnected: AtomicBool::new(false),
            },
            exit_rx,
        ))
    }

    pub fn write(&self, data: &[u8]) -> Result<(), AppError> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| AppError::Session("local terminal writer lock is poisoned".to_owned()))?;
        let writer = writer
            .as_mut()
            .ok_or_else(|| AppError::Session("local terminal is disconnected".to_owned()))?;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        self.master
            .lock()
            .map_err(|_| AppError::Session("local terminal master lock is poisoned".to_owned()))?
            .as_ref()
            .ok_or_else(|| AppError::Session("local terminal is disconnected".to_owned()))?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AppError::Session(error.to_string()))
    }

    pub fn disconnect(&self) -> Result<(), AppError> {
        if self.disconnected.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        self.writer
            .lock()
            .map_err(|_| AppError::Session("local terminal writer lock is poisoned".to_owned()))?
            .take();
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;

            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let result = Command::new("taskkill.exe")
                .args(["/PID", &self.process_id.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()?;
            if !result.status.success() && result.status.code() != Some(128) {
                return Err(AppError::Session(format!(
                    "unable to stop local shell process {}: {}",
                    self.process_id,
                    String::from_utf8_lossy(&result.stderr).trim()
                )));
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            self.killer
                .lock()
                .map_err(|_| AppError::Session("local terminal child lock is poisoned".to_owned()))?
                .kill()
                .map_err(AppError::Io)
        }
    }
}

impl Drop for LocalTerminal {
    fn drop(&mut self) {
        let _ = self.disconnect();
    }
}

pub fn detect_shells() -> Vec<String> {
    #[cfg(windows)]
    {
        let mut shells = ["powershell.exe", "cmd.exe"]
            .into_iter()
            .filter(|shell| command_exists(shell))
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if command_exists("wsl.exe")
            && Command::new("wsl.exe")
                .args(["-l", "-q"])
                .output()
                .ok()
                .is_some_and(|output| {
                    output.status.success() && output.stdout.iter().any(|byte| *byte != 0)
                })
        {
            shells.push("wsl.exe".to_owned());
        }
        shells
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|shell| Path::new(shell).is_file())
            .into_iter()
            .collect()
    }
}

fn command_exists(command: &str) -> bool {
    let path = Path::new(command);
    if path.components().count() > 1 {
        return path.is_file();
    }
    #[cfg(windows)]
    let probe = Command::new("where.exe").arg(command).output();
    #[cfg(not(windows))]
    let probe = Command::new("sh")
        .args(["-c", &format!("command -v -- {command}")])
        .output();
    probe.is_ok_and(|output| output.status.success())
}

#[cfg(test)]
mod tests {
    use super::{detect_shells, LocalTerminal};
    use crate::{session::manager::OutputSink, AppError};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct MemorySink(Mutex<Vec<u8>>);

    impl OutputSink for MemorySink {
        fn send(&self, data: &[u8]) -> Result<(), AppError> {
            self.0
                .lock()
                .map_err(|_| AppError::Session("test sink lock is poisoned".to_owned()))?
                .extend_from_slice(data);
            Ok(())
        }
    }

    #[test]
    fn detected_shells_exist() {
        assert!(!detect_shells().is_empty());
    }

    #[test]
    fn missing_shell_returns_its_name() {
        let result = LocalTerminal::start(
            "myterm-shell-that-does-not-exist",
            80,
            24,
            Arc::new(MemorySink::default()),
        );
        assert!(result.err().is_some_and(|error| {
            error
                .to_string()
                .contains("myterm-shell-that-does-not-exist")
        }));
    }

    #[test]
    fn shell_echo_reaches_output_sink() -> Result<(), Box<dyn std::error::Error>> {
        let shell = detect_shells()
            .into_iter()
            .next()
            .ok_or("no local shell is available")?;
        let sink = Arc::new(MemorySink::default());
        let (terminal, _exit) = LocalTerminal::start(&shell, 80, 24, sink.clone())?;
        let cursor_query_deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let queried = sink
                .0
                .lock()
                .map_err(|_| "test sink lock is poisoned")?
                .windows(4)
                .any(|bytes| bytes == b"\x1b[6n");
            if queried || Instant::now() >= cursor_query_deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        terminal.write(b"\x1b[1;1R")?;
        terminal.write(b"echo myterm-local-marker\r")?;
        let deadline = Instant::now() + Duration::from_secs(5);
        let output = loop {
            let output = sink
                .0
                .lock()
                .map_err(|_| "test sink lock is poisoned")?
                .clone();
            if String::from_utf8_lossy(&output).contains("myterm-local-marker")
                || Instant::now() >= deadline
            {
                break output;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        terminal.disconnect()?;
        assert!(
            String::from_utf8_lossy(&output).contains("myterm-local-marker"),
            "local terminal output was: {:?}",
            String::from_utf8_lossy(&output)
        );
        Ok(())
    }
}

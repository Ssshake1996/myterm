use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::RwLock,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    types::{AiProfile, QuickCommand, SessionProfile},
    AppError,
};

pub const DEFAULT_SYSTEM_PROMPT: &str = "You are a senior Linux operations assistant embedded in an SSH terminal client.\nRules:\n- Answer based on the terminal output provided by the user. Do not invent output.\n- When suggesting a fix, give the exact command in a fenced code block, one command per block.\n- Never suggest destructive commands (rm -rf, dd, mkfs...) without an explicit warning.\n- Reply in the language the user writes in.";

#[derive(Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: u32,
    pub profiles: Vec<SessionProfile>,
    pub quick_commands: Vec<QuickCommand>,
    pub ai_profiles: Vec<AiProfile>,
    pub settings: BTreeMap<String, Value>,
}

impl Default for AppConfig {
    fn default() -> Self {
        let commands = [
            ("Disk usage", "df -h"),
            ("Memory", "free -h"),
            ("Listening ports", "ss -lntp"),
            ("Top processes", "ps aux --sort=-%mem | head"),
            ("System log", "tail -f /var/log/messages"),
        ]
        .into_iter()
        .enumerate()
        .map(|(index, (label, command))| QuickCommand {
            id: uuid::Uuid::new_v4().to_string(),
            label: label.to_owned(),
            group: "常用".to_owned(),
            command: command.to_owned(),
            send_newline: true,
            sort: index as u32,
        })
        .collect();
        Self {
            version: 1,
            profiles: Vec::new(),
            quick_commands: commands,
            ai_profiles: Vec::new(),
            settings: BTreeMap::new(),
        }
    }
}

pub struct ConfigService {
    path: PathBuf,
    value: RwLock<AppConfig>,
}

impl ConfigService {
    pub fn open(path: PathBuf) -> Result<Self, AppError> {
        let value = load_config(&path)?;
        Ok(Self {
            path,
            value: RwLock::new(value),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn profile_list(&self) -> Result<Vec<SessionProfile>, AppError> {
        Ok(self.read()?.profiles.clone())
    }

    pub fn profile_save(&self, profile: SessionProfile) -> Result<(), AppError> {
        self.update(|config| upsert(&mut config.profiles, profile, |item| &item.id))
    }

    pub fn profile_delete(&self, id: &str) -> Result<Option<SessionProfile>, AppError> {
        let mut deleted = None;
        self.update(|config| {
            if let Some(index) = config.profiles.iter().position(|profile| profile.id == id) {
                deleted = Some(config.profiles.remove(index));
            }
        })?;
        Ok(deleted)
    }

    pub fn quick_command_list(&self) -> Result<Vec<QuickCommand>, AppError> {
        Ok(self.read()?.quick_commands.clone())
    }

    pub fn quick_command_save(&self, command: QuickCommand) -> Result<(), AppError> {
        self.update(|config| upsert(&mut config.quick_commands, command, |item| &item.id))
    }

    pub fn quick_command_delete(&self, id: &str) -> Result<(), AppError> {
        self.update(|config| config.quick_commands.retain(|command| command.id != id))
    }

    pub fn ai_profile_list(&self) -> Result<Vec<AiProfile>, AppError> {
        Ok(self.read()?.ai_profiles.clone())
    }

    pub fn ai_profile_save(&self, profile: AiProfile) -> Result<(), AppError> {
        self.update(|config| upsert(&mut config.ai_profiles, profile, |item| &item.id))
    }

    pub fn ai_profile_delete(&self, id: &str) -> Result<Option<AiProfile>, AppError> {
        let mut deleted = None;
        self.update(|config| {
            if let Some(index) = config
                .ai_profiles
                .iter()
                .position(|profile| profile.id == id)
            {
                deleted = Some(config.ai_profiles.remove(index));
            }
        })?;
        Ok(deleted)
    }

    pub fn setting_get(&self, key: &str) -> Result<Option<Value>, AppError> {
        Ok(self.read()?.settings.get(key).cloned())
    }

    pub fn setting_set(&self, key: String, value: Value) -> Result<(), AppError> {
        self.update(|config| {
            config.settings.insert(key, value);
        })
    }

    fn read(&self) -> Result<std::sync::RwLockReadGuard<'_, AppConfig>, AppError> {
        self.value
            .read()
            .map_err(|_| AppError::Config("configuration lock is poisoned".to_owned()))
    }

    fn update(&self, mutate: impl FnOnce(&mut AppConfig)) -> Result<(), AppError> {
        let mut value = self
            .value
            .write()
            .map_err(|_| AppError::Config("configuration lock is poisoned".to_owned()))?;
        mutate(&mut value);
        write_atomic(&self.path, &value)
    }
}

fn upsert<T>(items: &mut Vec<T>, value: T, id: impl Fn(&T) -> &String) {
    if let Some(index) = items.iter().position(|item| id(item) == id(&value)) {
        items[index] = value;
    } else {
        items.push(value);
    }
}

fn load_config(path: &Path) -> Result<AppConfig, AppError> {
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let source = fs::read(path)?;
    match serde_json::from_slice(&source) {
        Ok(config) => Ok(config),
        Err(error) => {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |duration| duration.as_secs());
            let backup = path.with_file_name(format!("config.json.bak-{timestamp}"));
            fs::rename(path, &backup)?;
            tracing::warn!(backup = %backup.display(), %error, "invalid configuration moved aside");
            Ok(AppConfig::default())
        }
    }
}

fn write_atomic(path: &Path, value: &AppConfig) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(value)?;
    fs::write(&temporary, bytes)?;
    atomic_replace(&temporary, path)?;
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
pub(crate) fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    if !destination.exists() {
        return fs::rename(source, destination);
    }
    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }
    let replaced: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let replacement: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        ReplaceFileW(
            replaced.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub fn portable_mode_enabled<I>(arguments: I) -> bool
where
    I: IntoIterator<Item = OsString>,
{
    let explicit = arguments
        .into_iter()
        .any(|argument| argument == "--portable");
    explicit
        || std::env::current_exe()
            .ok()
            .is_some_and(|executable| super::portable_flag_present(&executable))
}

pub fn default_config_path(portable: bool) -> Result<PathBuf, AppError> {
    if portable {
        let executable = std::env::current_exe()?;
        let directory = executable
            .parent()
            .ok_or_else(|| AppError::Config("executable has no parent directory".to_owned()))?;
        return Ok(directory.join("data").join("config.json"));
    }
    let directory = dirs::config_dir().ok_or_else(|| {
        AppError::Config("operating system config directory is unavailable".to_owned())
    })?;
    Ok(directory.join("myterm").join("config.json"))
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, ConfigService};
    use crate::types::{AuthMethod, SessionProfile, SessionTarget};
    use std::fs;

    fn test_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("myterm-config-{}", uuid::Uuid::new_v4()))
    }

    fn profile(id: &str) -> SessionProfile {
        SessionProfile {
            id: id.to_owned(),
            name: "prod".to_owned(),
            group: "ops".to_owned(),
            target: SessionTarget::Ssh {
                host: "127.0.0.1".to_owned(),
                port: 22,
                username: "root".to_owned(),
                auth: AuthMethod::Password {
                    vault_ref: "profile.prod.password".to_owned(),
                },
            },
        }
    }

    #[test]
    fn defaults_and_crud_are_persisted_atomically() -> Result<(), Box<dyn std::error::Error>> {
        let root = test_root();
        let path = root.join("config.json");
        let service = ConfigService::open(path.clone())?;
        assert_eq!(service.quick_command_list()?.len(), 5);
        service.profile_save(profile("one"))?;
        service.profile_save(profile("two"))?;
        assert_eq!(service.profile_list()?.len(), 2);
        assert!(!path.with_extension("json.tmp").exists());
        let reloaded = ConfigService::open(path)?;
        assert_eq!(reloaded.profile_list()?.len(), 2);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn corrupt_configuration_is_backed_up() -> Result<(), Box<dyn std::error::Error>> {
        let root = test_root();
        fs::create_dir_all(&root)?;
        let path = root.join("config.json");
        fs::write(&path, b"{not-json")?;
        let service = ConfigService::open(path)?;
        assert_eq!(service.profile_list()?.len(), 0);
        let backups = fs::read_dir(&root)?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("config.json.bak-")
            })
            .count();
        assert_eq!(backups, 1);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn serialized_config_has_no_secret_field() -> Result<(), Box<dyn std::error::Error>> {
        let source = serde_json::to_string(&AppConfig::default())?;
        assert!(!source.contains("password"));
        assert!(!source.contains("api_key\""));
        Ok(())
    }
}

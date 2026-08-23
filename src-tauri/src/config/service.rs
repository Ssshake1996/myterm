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
    types::{
        AgentSettings, AiModelConfig, AiModelRole, AiProfile, AppFontScale, AppTheme,
        QuickCommand, SessionProfile,
    },
    AppError,
};

pub const DEFAULT_SYSTEM_PROMPT: &str = "You are a senior Linux operations assistant embedded in an SSH terminal client.\nRules:\n- Answer based on the terminal output provided by the user. Do not invent output.\n- When suggesting a fix, give the exact command in a fenced code block, one command per block.\n- Never suggest destructive commands (rm -rf, dd, mkfs...) without an explicit warning.\n- Reply in the language the user writes in.";
pub const CONFIG_SCHEMA_VERSION: u32 = 2;
const THEME_SETTING_KEY: &str = "theme";
const FONT_SCALE_SETTING_KEY: &str = "font_scale";
const TERMINAL_FONT_SIZE_SETTING_KEY: &str = "terminal_font_size";
const REMOVED_REST_TOKEN_SETTING_KEY: &str = "rest_token_hash";

#[derive(Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: u32,
    pub profiles: Vec<SessionProfile>,
    pub quick_commands: Vec<QuickCommand>,
    pub ai_profiles: Vec<AiProfile>,
    pub settings: BTreeMap<String, Value>,
    #[serde(default)]
    pub agent: AgentSettings,
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
            version: CONFIG_SCHEMA_VERSION,
            profiles: Vec::new(),
            quick_commands: commands,
            ai_profiles: Vec::new(),
            settings: BTreeMap::new(),
            agent: AgentSettings::default(),
        }
    }
}

pub struct ConfigService {
    path: PathBuf,
    value: RwLock<AppConfig>,
}

impl ConfigService {
    pub fn open(path: PathBuf) -> Result<Self, AppError> {
        let mut value = load_config(&path)?;
        let migrated = migrate_config(&mut value);
        let removed_legacy_rest = value
            .settings
            .remove(REMOVED_REST_TOKEN_SETTING_KEY)
            .is_some();
        if migrated || removed_legacy_rest {
            write_atomic(&path, &value)?;
        }
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

    pub fn quick_command_replace_all(&self, commands: Vec<QuickCommand>) -> Result<(), AppError> {
        self.update(|config| config.quick_commands = commands)
    }

    pub fn app_theme(&self) -> Result<AppTheme, AppError> {
        Ok(self
            .setting_get(THEME_SETTING_KEY)?
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default())
    }

    pub fn app_theme_save(&self, theme: AppTheme) -> Result<(), AppError> {
        self.setting_set(THEME_SETTING_KEY.to_owned(), serde_json::to_value(theme)?)
    }

    pub fn app_font_scale(&self) -> Result<AppFontScale, AppError> {
        Ok(self
            .setting_get(FONT_SCALE_SETTING_KEY)?
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default())
    }

    pub fn app_font_scale_save(&self, scale: AppFontScale) -> Result<(), AppError> {
        self.setting_set(
            FONT_SCALE_SETTING_KEY.to_owned(),
            serde_json::to_value(scale)?,
        )
    }

    pub fn terminal_font_size(&self) -> Result<u32, AppError> {
        Ok(self
            .setting_get(TERMINAL_FONT_SIZE_SETTING_KEY)?
            .and_then(|value| value.as_u64())
            .map(|value| value.clamp(12, 22) as u32)
            .unwrap_or(13))
    }

    pub fn terminal_font_size_save(&self, size: u32) -> Result<u32, AppError> {
        let size = size.clamp(12, 22);
        self.setting_set(
            TERMINAL_FONT_SIZE_SETTING_KEY.to_owned(),
            serde_json::json!(size),
        )?;
        Ok(size)
    }

    pub fn ai_profile_list(&self) -> Result<Vec<AiProfile>, AppError> {
        Ok(self.read()?.ai_profiles.clone())
    }

    pub fn ai_profile_save(&self, profile: AiProfile) -> Result<(), AppError> {
        self.update(|config| {
            let mut profile = profile;
            normalize_ai_profile(&mut profile);
            upsert(&mut config.ai_profiles, profile, |item| &item.id)
        })
    }

    pub fn ai_config_json(&self) -> Result<Value, AppError> {
        let value = self.read()?;
        serde_json::to_value(&*value).map_err(Into::into)
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

    pub fn agent_settings(&self) -> Result<AgentSettings, AppError> {
        Ok(self.read()?.agent.clone())
    }

    pub fn agent_settings_save(&self, mut settings: AgentSettings) -> Result<(), AppError> {
        settings.max_steps = settings.max_steps.clamp(1, 32);
        settings
            .skill_directories
            .retain(|directory| !directory.trim().is_empty());
        settings.skill_directories.sort();
        settings.skill_directories.dedup();
        settings.enabled_skills.sort();
        settings.enabled_skills.dedup();
        self.update(|config| config.agent = settings)
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

fn migrate_config(config: &mut AppConfig) -> bool {
    let mut changed = config.version < CONFIG_SCHEMA_VERSION;
    config.version = CONFIG_SCHEMA_VERSION;
    for profile in &mut config.ai_profiles {
        changed |= normalize_ai_profile(profile);
    }
    changed
}

fn normalize_ai_profile(profile: &mut AiProfile) -> bool {
    if !profile.models.is_empty() {
        return false;
    }
    if profile.model.trim().is_empty() {
        return false;
    }
    profile.models.push(AiModelConfig {
        id: "primary".to_owned(),
        name: "主模型".to_owned(),
        model: profile.model.trim().to_owned(),
        role: AiModelRole::Primary,
        enabled: true,
    });
    true
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
    use crate::types::{AppFontScale, AppTheme, AuthMethod, SessionProfile, SessionTarget};
    use serde_json::Value;
    use std::fs;

    fn test_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("myterm-config-{}", uuid::Uuid::new_v4()))
    }

    fn profile(id: &str) -> SessionProfile {
        SessionProfile {
            id: id.to_owned(),
            name: "prod".to_owned(),
            group: "ops".to_owned(),
            environment: crate::types::SessionEnvironment::Production,
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

    #[test]
    fn appearance_theme_is_validated_and_persisted() -> Result<(), Box<dyn std::error::Error>> {
        let root = test_root();
        let path = root.join("config.json");
        let service = ConfigService::open(path.clone())?;
        assert_eq!(service.app_theme()?, AppTheme::Dark);

        service.app_theme_save(AppTheme::EyeCare)?;
        let reloaded = ConfigService::open(path)?;
        assert_eq!(reloaded.app_theme()?, AppTheme::EyeCare);

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn appearance_font_settings_are_clamped_and_persisted() -> Result<(), Box<dyn std::error::Error>>
    {
        let root = test_root();
        let path = root.join("config.json");
        let service = ConfigService::open(path.clone())?;
        assert_eq!(service.app_font_scale()?, AppFontScale::Standard);
        assert_eq!(service.terminal_font_size()?, 13);

        service.app_font_scale_save(AppFontScale::ExtraLarge)?;
        assert_eq!(service.terminal_font_size_save(99)?, 22);
        let reloaded = ConfigService::open(path)?;
        assert_eq!(reloaded.app_font_scale()?, AppFontScale::ExtraLarge);
        assert_eq!(reloaded.terminal_font_size()?, 22);

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn removed_rest_token_setting_is_deleted_on_open() -> Result<(), Box<dyn std::error::Error>> {
        let root = test_root();
        let path = root.join("config.json");
        let service = ConfigService::open(path.clone())?;
        service.setting_set(
            "rest_token_hash".to_owned(),
            Value::String("digest".to_owned()),
        )?;
        drop(service);

        let reloaded = ConfigService::open(path.clone())?;
        assert!(reloaded.setting_get("rest_token_hash")?.is_none());
        assert!(!fs::read_to_string(path)?.contains("rest_token_hash"));

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn legacy_ai_model_is_migrated_to_json_model_roles() -> Result<(), Box<dyn std::error::Error>> {
        let root = test_root();
        fs::create_dir_all(&root)?;
        let path = root.join("config.json");
        fs::write(
            &path,
            r#"{
              "version": 1,
              "profiles": [],
              "quick_commands": [],
              "ai_profiles": [{
                "id": "legacy",
                "name": "Legacy",
                "base_url": "https://example.test/v1",
                "api_key_ref": "ai.legacy.key",
                "auth_mode": "bearer",
                "model": "legacy-model",
                "system_prompt": "",
                "context_lines": 80
              }],
              "settings": {},
              "agent": {
                "profile": "desktop",
                "permission_mode": "confirm",
                "max_steps": 8
              }
            }"#,
        )?;
        let service = ConfigService::open(path.clone())?;
        let profile = service.ai_profile_list()?.remove(0);
        assert_eq!(profile.models.len(), 1);
        assert_eq!(profile.models[0].role, crate::types::AiModelRole::Primary);
        assert_eq!(profile.models[0].model, "legacy-model");
        assert_eq!(serde_json::from_str::<Value>(&fs::read_to_string(path)?)?["version"], 2);
        fs::remove_dir_all(root)?;
        Ok(())
    }
}

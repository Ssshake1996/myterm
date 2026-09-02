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
        AgentSettings, AiModelRole, AiProfile, AppFontScale, AppTheme, QuickCommand,
        SessionProfile, TerminalPalette,
    },
    AppError,
};

pub const DEFAULT_SYSTEM_PROMPT: &str = "You are a senior Linux operations assistant embedded in an SSH terminal client.\nRules:\n- Answer based on the terminal output provided by the user. Do not invent output.\n- When suggesting a fix, give the exact command in a fenced code block, one command per block.\n- Never suggest destructive commands (rm -rf, dd, mkfs...) without an explicit warning.\n- Reply in the language the user writes in.";
pub const DEFAULT_AGENT_SYSTEM_PROMPT: &str = r#"You are the myterm operations Agent running on official DeepSeek Harness.

- Harness local Shell and file tools operate on the LOCAL computer only. All remote Linux, SSH, interactive CLI, SFTP, saved-server, and multi-SSH work must use the myterm-host-tools MCP server. Never present a local command as a remote SSH action.
- Use the active SSH session only when the user refers to the current terminal or server. Otherwise resolve named targets with session_catalog/session_connect and keep session_id explicit. For multiple SSH targets, preserve the A/B target on every action and observation.
- When a command is known, send one complete command with its exact whitespace. For interactive product CLIs, pass the full intended command to cli_execute; myterm safely sends only the suffix missing from the visible input. Batch independent known commands with cli_execute_batch. Use terminal_context only when terminal state matters, not as a mandatory pre-step.
- When a vendor CLI command is uncertain, query the configured MCP capabilities, parse their structured or text result, synthesize the complete command, and then execute it. Do not guess commands or split one decision into many tiny model requests.
- Preserve exact stdout, stderr, exit codes, provider errors, timeouts, and stack details. Do not claim success without tool evidence.
- Tool access, approval prompts, and execution boundaries are owned by DeepSeek Harness. Follow the active Harness access preset and its approval result; do not invent or apply a second myterm permission policy.
- Treat every normal request as potentially long-running. Use Harness goals, checkpoints, compaction, retry, and resumable sessions as needed; users do not need to select a long-task mode or use /goal.
- Ask concise clarification questions only when a material decision cannot be discovered safely. Reply in the user's language."#;
pub const CONFIG_SCHEMA_VERSION: u32 = 6;
const ENVIRONMENT_SCHEMA_VERSION: u32 = 1;
const ENVIRONMENT_DIRECTORY_NAME: &str = "environments";
const ENVIRONMENT_FILE_SUFFIX: &str = ".environments.json";
const MAX_ENVIRONMENT_GROUP_CHARS: usize = 80;
const THEME_SETTING_KEY: &str = "theme";
const FONT_SCALE_SETTING_KEY: &str = "font_scale";
const TERMINAL_FONT_SIZE_SETTING_KEY: &str = "terminal_font_size";
const TERMINAL_PALETTE_SETTING_KEY: &str = "terminal_palette";
const REMOVED_REST_TOKEN_SETTING_KEY: &str = "rest_token_hash";

#[derive(Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: u32,
    pub quick_commands: Vec<QuickCommand>,
    pub ai_profiles: Vec<AiProfile>,
    pub settings: BTreeMap<String, Value>,
    #[serde(default)]
    pub agent: AgentSettings,
}

#[derive(Clone, Serialize, Deserialize)]
struct EnvironmentGroupFile {
    version: u32,
    group_name: String,
    profiles: Vec<SessionProfile>,
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
    profiles: RwLock<Vec<SessionProfile>>,
}

impl ConfigService {
    pub fn open(path: PathBuf) -> Result<Self, AppError> {
        let rewrite_agent_config = agent_config_requires_rewrite(&path);
        let mut value = load_config(&path)?;
        let config_missing = !path.exists();
        let migrated = migrate_config(&mut value);
        let environment_directory = environment_directory(&path)?;
        let profiles = load_environment_profiles(&environment_directory)?;
        let removed_legacy_rest = value
            .settings
            .remove(REMOVED_REST_TOKEN_SETTING_KEY)
            .is_some();
        if config_missing || migrated || removed_legacy_rest || rewrite_agent_config {
            write_atomic(&path, &value)?;
        }
        Ok(Self {
            path,
            value: RwLock::new(value),
            profiles: RwLock::new(profiles),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn profile_list(&self) -> Result<Vec<SessionProfile>, AppError> {
        Ok(self.read_profiles()?.clone())
    }

    pub fn profile_save(&self, profile: SessionProfile) -> Result<(), AppError> {
        validate_environment_group_name(&profile.group)?;
        let mut profiles = self.write_profiles()?;
        let mut next = profiles.clone();
        upsert(&mut next, profile, |item| &item.id);
        write_environment_files(&environment_directory(&self.path)?, &next)?;
        *profiles = next;
        Ok(())
    }

    pub fn profile_delete(&self, id: &str) -> Result<Option<SessionProfile>, AppError> {
        let mut profiles = self.write_profiles()?;
        let mut next = profiles.clone();
        if let Some(index) = next.iter().position(|profile| profile.id == id) {
            let deleted = next.remove(index);
            write_environment_files(&environment_directory(&self.path)?, &next)?;
            *profiles = next;
            return Ok(Some(deleted));
        }
        Ok(None)
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

    pub fn terminal_palette(&self) -> Result<TerminalPalette, AppError> {
        Ok(self
            .setting_get(TERMINAL_PALETTE_SETTING_KEY)?
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default())
    }

    pub fn terminal_palette_save(&self, palette: TerminalPalette) -> Result<(), AppError> {
        self.setting_set(
            TERMINAL_PALETTE_SETTING_KEY.to_owned(),
            serde_json::to_value(palette)?,
        )
    }

    pub fn ai_profile_list(&self) -> Result<Vec<AiProfile>, AppError> {
        Ok(self.read()?.ai_profiles.clone())
    }

    pub fn ai_profile_save(&self, profile: AiProfile) -> Result<(), AppError> {
        let existing = self.ai_profile_list()?;
        validate_ai_profile(&profile, &existing)?;
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
        if let Some(owner) = self.ai_profile_list()?.into_iter().find(|profile| {
            profile.id != id
                && profile
                    .models
                    .iter()
                    .any(|model| model.provider_profile_id.as_deref().map(str::trim) == Some(id))
        }) {
            return Err(AppError::InvalidInput(format!(
                "DeepSeek 服务 '{}' 正被模型路由 '{}' 引用，请先解除引用再删除",
                id, owner.name
            )));
        }
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
        settings.profile = "deepseek-harness".to_owned();
        settings.bundles.clear();
        settings.enabled_plugins.clear();
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

    fn read_profiles(
        &self,
    ) -> Result<std::sync::RwLockReadGuard<'_, Vec<SessionProfile>>, AppError> {
        self.profiles
            .read()
            .map_err(|_| AppError::Config("environment lock is poisoned".to_owned()))
    }

    fn write_profiles(
        &self,
    ) -> Result<std::sync::RwLockWriteGuard<'_, Vec<SessionProfile>>, AppError> {
        self.profiles
            .write()
            .map_err(|_| AppError::Config("environment lock is poisoned".to_owned()))
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

fn environment_directory(config_path: &Path) -> Result<PathBuf, AppError> {
    config_path
        .parent()
        .map(|parent| parent.join(ENVIRONMENT_DIRECTORY_NAME))
        .ok_or_else(|| AppError::Config("configuration path has no parent directory".to_owned()))
}

pub fn validate_environment_group_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::InvalidInput("环境分组名称不能为空".to_owned()));
    }
    if name.trim() != name {
        return Err(AppError::InvalidInput(
            "环境分组名称不能以空白字符开头或结尾".to_owned(),
        ));
    }
    if name.chars().count() > MAX_ENVIRONMENT_GROUP_CHARS {
        return Err(AppError::InvalidInput(format!(
            "环境分组名称不能超过 {MAX_ENVIRONMENT_GROUP_CHARS} 个字符"
        )));
    }
    if let Some(character) = name
        .chars()
        .find(|character| character.is_control() || "<>:\"/\\|?*".contains(*character))
    {
        return Err(AppError::InvalidInput(format!(
            "环境分组名称包含非法字符：{character}"
        )));
    }
    if name.ends_with('.') {
        return Err(AppError::InvalidInput(
            "环境分组名称不能以句点结尾".to_owned(),
        ));
    }
    if is_windows_reserved_name(name) {
        return Err(AppError::InvalidInput(format!(
            "环境分组名称不能使用 Windows 保留名称：{name}"
        )));
    }
    Ok(())
}

fn is_windows_reserved_name(name: &str) -> bool {
    let reserved_base = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    matches!(reserved_base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || reserved_base.strip_prefix("COM").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
        || reserved_base.strip_prefix("LPT").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
}

fn group_name_key(group: &str) -> String {
    group.to_lowercase()
}

fn load_environment_profiles(directory: &Path) -> Result<Vec<SessionProfile>, AppError> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut profiles = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !file_name.ends_with(ENVIRONMENT_FILE_SUFFIX) {
            continue;
        }
        let group_file: EnvironmentGroupFile = serde_json::from_slice(&fs::read(entry.path())?)?;
        validate_environment_group_name(&group_file.group_name)?;
        let expected = format!("{}{}", group_file.group_name, ENVIRONMENT_FILE_SUFFIX);
        if file_name != expected {
            return Err(AppError::Config(format!(
                "环境文件名与分组名称不一致：期望 '{expected}'，实际 '{file_name}'"
            )));
        }
        for mut profile in group_file.profiles {
            profile.group = group_file.group_name.clone();
            upsert(&mut profiles, profile, |item| &item.id);
        }
    }
    Ok(profiles)
}

fn write_environment_files(directory: &Path, profiles: &[SessionProfile]) -> Result<(), AppError> {
    fs::create_dir_all(directory)?;
    let mut groups = BTreeMap::<String, Vec<SessionProfile>>::new();
    let mut group_names = BTreeMap::<String, String>::new();
    for profile in profiles {
        validate_environment_group_name(&profile.group)?;
        let key = group_name_key(&profile.group);
        if let Some(existing) = group_names.get(&key) {
            if existing != &profile.group {
                return Err(AppError::InvalidInput(format!(
                    "环境分组名称在 Windows 中不区分大小写，'{}' 与已有分组 '{}' 冲突",
                    profile.group, existing
                )));
            }
        } else {
            group_names.insert(key, profile.group.clone());
        }
        groups
            .entry(profile.group.clone())
            .or_default()
            .push(profile.clone());
    }
    let desired_files = groups
        .keys()
        .map(|group| format!("{group}{ENVIRONMENT_FILE_SUFFIX}"))
        .collect::<std::collections::BTreeSet<_>>();
    for (group_name, group_profiles) in groups {
        let path = directory.join(format!("{group_name}{ENVIRONMENT_FILE_SUFFIX}"));
        let group_file = EnvironmentGroupFile {
            version: ENVIRONMENT_SCHEMA_VERSION,
            group_name,
            profiles: group_profiles,
        };
        write_json_atomic(&path, &group_file)?;
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if file_name.ends_with(ENVIRONMENT_FILE_SUFFIX) && !desired_files.contains(&file_name) {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(value)?)?;
    atomic_replace(&temporary, path)?;
    Ok(())
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

fn agent_config_requires_rewrite(path: &Path) -> bool {
    let Ok(source) = fs::read(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&source) else {
        return false;
    };
    let Some(agent) = value.get("agent").and_then(Value::as_object) else {
        return false;
    };
    const CURRENT_FIELDS: &[&str] = &[
        "harness_access_preset",
        "skill_directories",
        "enabled_skills",
        "mcp_servers",
        "hooks",
    ];
    agent
        .keys()
        .any(|key| !CURRENT_FIELDS.contains(&key.as_str()))
}

fn migrate_config(config: &mut AppConfig) -> bool {
    let previous_version = config.version;
    let mut changed = previous_version < CONFIG_SCHEMA_VERSION;
    if previous_version < CONFIG_SCHEMA_VERSION && !config.ai_profiles.is_empty() {
        config.ai_profiles.clear();
        changed = true;
        tracing::info!(
            event = "deepseek_native_ai_config_reset",
            previous_version,
            current_version = CONFIG_SCHEMA_VERSION,
            "Removed pre-native-provider AI profiles; DeepSeek service must be configured again"
        );
    }
    config.version = CONFIG_SCHEMA_VERSION;
    for profile in &mut config.ai_profiles {
        changed |= normalize_ai_profile(profile);
    }
    changed
}

fn normalize_ai_profile(profile: &mut AiProfile) -> bool {
    let mut changed = false;
    for model in &mut profile.models {
        let normalized = model
            .provider_profile_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && *value != profile.id)
            .map(str::to_owned);
        if model.provider_profile_id != normalized {
            model.provider_profile_id = normalized;
            changed = true;
        }
    }
    let has_primary = profile.models.iter().any(|model| {
        model.enabled && !model.model.trim().is_empty() && model.role == AiModelRole::Primary
    });
    if !has_primary {
        if let Some(model) = profile
            .models
            .iter_mut()
            .find(|model| model.enabled && !model.model.trim().is_empty())
        {
            model.role = AiModelRole::Primary;
            changed = true;
        }
    }
    changed
}

fn validate_ai_profile(profile: &AiProfile, existing: &[AiProfile]) -> Result<(), AppError> {
    let mut model_ids = std::collections::HashSet::new();
    for model in &profile.models {
        if !model_ids.insert(model.id.trim()) {
            return Err(AppError::InvalidInput(format!(
                "AI 配置 '{}' 包含重复模型 ID '{}'",
                profile.name, model.id
            )));
        }
        if model.context_window == Some(0) {
            return Err(AppError::InvalidInput(format!(
                "模型路由 '{}' 的上下文窗口必须为正整数",
                model.name
            )));
        }
        if model.max_output_tokens == Some(0) {
            return Err(AppError::InvalidInput(format!(
                "模型路由 '{}' 的最大输出 Token 必须为正整数",
                model.name
            )));
        }
        if let (Some(context_window), Some(max_output_tokens)) =
            (model.context_window, model.max_output_tokens)
        {
            if max_output_tokens > context_window {
                return Err(AppError::InvalidInput(format!(
                    "模型路由 '{}' 的最大输出 Token 不能超过上下文窗口",
                    model.name
                )));
            }
        }
        let Some(provider_id) = model
            .provider_profile_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && *value != profile.id)
        else {
            continue;
        };
        if !existing.iter().any(|candidate| candidate.id == provider_id) {
            return Err(AppError::InvalidInput(format!(
                "模型路由 '{}' 引用的 DeepSeek 服务 '{}' 不存在",
                model.name, provider_id
            )));
        }
    }
    Ok(())
}

fn write_atomic(path: &Path, value: &AppConfig) -> Result<(), AppError> {
    write_json_atomic(path, value)
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
    use super::{
        validate_environment_group_name, AppConfig, ConfigService, DEFAULT_AGENT_SYSTEM_PROMPT,
    };
    use crate::types::{
        AiModelConfig, AiModelRole, AiProfile, AiReasoningEffort, AiRoutingConfig, AppFontScale,
        AppTheme, AuthMethod, SessionProfile, SessionTarget, TerminalPalette,
    };
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
        let environment_path = root.join("environments").join("ops.environments.json");
        assert!(environment_path.exists());
        let config_json = serde_json::from_str::<Value>(&fs::read_to_string(&path)?)?;
        assert!(config_json.get("profiles").is_none());
        let reloaded = ConfigService::open(path)?;
        assert_eq!(reloaded.profile_list()?.len(), 2);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn saving_ai_profile_promotes_the_first_enabled_model_to_primary(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = test_root();
        let path = root.join("config.json");
        let service = ConfigService::open(path)?;
        service.ai_profile_save(AiProfile {
            id: "ai".to_owned(),
            name: "Gateway".to_owned(),
            base_url: "https://gateway.example/v1".to_owned(),
            api_key_ref: "ai.ai.key".to_owned(),
            reasoning_effort: AiReasoningEffort::High,
            system_prompt: String::new(),
            models: vec![AiModelConfig {
                id: "fallback".to_owned(),
                name: "备用模型".to_owned(),
                model: "fallback-model".to_owned(),
                context_window: None,
                max_output_tokens: None,
                provider_profile_id: None,
                role: AiModelRole::Fallback,
                enabled: true,
            }],
            routing: AiRoutingConfig::default(),
        })?;

        let saved = service.ai_profile_list()?.remove(0);
        assert_eq!(saved.models[0].role, AiModelRole::Primary);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn ai_model_output_limit_cannot_exceed_its_context_window() {
        let root = test_root();
        let service = ConfigService::open(root.join("config.json")).expect("config service");
        let error = service
            .ai_profile_save(AiProfile {
                id: "ai".to_owned(),
                name: "Gateway".to_owned(),
                base_url: "https://gateway.example/v1".to_owned(),
                api_key_ref: "ai.ai.key".to_owned(),
                reasoning_effort: AiReasoningEffort::High,
                system_prompt: String::new(),
                models: vec![AiModelConfig {
                    id: "primary".to_owned(),
                    name: "主模型".to_owned(),
                    model: "model".to_owned(),
                    context_window: Some(8_192),
                    max_output_tokens: Some(16_384),
                    provider_profile_id: None,
                    role: AiModelRole::Primary,
                    enabled: true,
                }],
                routing: AiRoutingConfig::default(),
            })
            .expect_err("invalid model limits must fail");
        assert!(error.to_string().contains("不能超过上下文窗口"));
        fs::remove_dir_all(root).expect("remove test config");
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
        assert!(!source.contains("\"profiles\""));
        Ok(())
    }

    #[test]
    fn default_agent_prompt_separates_local_and_remote_tools() {
        assert!(DEFAULT_AGENT_SYSTEM_PROMPT.contains("LOCAL computer"));
        assert!(DEFAULT_AGENT_SYSTEM_PROMPT.contains("myterm-host-tools"));
        assert!(DEFAULT_AGENT_SYSTEM_PROMPT.contains("cli_execute"));
        assert!(DEFAULT_AGENT_SYSTEM_PROMPT.contains("Harness goals"));
    }

    #[test]
    fn environment_group_names_are_validated_for_windows_files() {
        assert!(validate_environment_group_name("生产环境").is_ok());
        assert!(validate_environment_group_name("prod/db").is_err());
        assert!(validate_environment_group_name("CON").is_err());
        assert!(validate_environment_group_name("COM1.logs").is_err());
        assert!(validate_environment_group_name("ops.").is_err());
    }

    #[test]
    fn case_only_group_collisions_do_not_overwrite_environment_files(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = test_root();
        let path = root.join("config.json");
        let service = ConfigService::open(path)?;
        let mut first = profile("one");
        first.group = "Ops".to_owned();
        service.profile_save(first)?;
        let mut conflicting = profile("two");
        conflicting.group = "ops".to_owned();

        assert!(service.profile_save(conflicting).is_err());
        assert_eq!(service.profile_list()?.len(), 1);
        assert!(root
            .join("environments")
            .join("Ops.environments.json")
            .exists());
        fs::remove_dir_all(root)?;
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

        service.app_font_scale_save(AppFontScale::Scale200)?;
        assert_eq!(service.terminal_font_size_save(99)?, 22);
        service.terminal_palette_save(TerminalPalette::MidnightContrast)?;
        let reloaded = ConfigService::open(path)?;
        assert_eq!(reloaded.app_font_scale()?, AppFontScale::Scale200);
        assert_eq!(reloaded.terminal_font_size()?, 22);
        assert_eq!(
            reloaded.terminal_palette()?,
            TerminalPalette::MidnightContrast
        );

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
    fn pre_native_ai_profiles_are_removed_instead_of_migrated(
    ) -> Result<(), Box<dyn std::error::Error>> {
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
        assert!(service.ai_profile_list()?.is_empty());
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(&path)?)?["version"],
            6
        );
        let raw = serde_json::from_str::<Value>(&fs::read_to_string(path)?)?;
        let agent = raw
            .get("agent")
            .and_then(Value::as_object)
            .expect("agent settings are persisted");
        assert!(!agent.contains_key("profile"));
        assert!(!agent.contains_key("bundles"));
        assert!(!agent.contains_key("enabled_plugins"));
        assert!(!agent.contains_key("max_steps"));
        assert!(!agent.contains_key("permission_mode"));
        assert_eq!(agent["harness_access_preset"], "workspace-write");
        assert_eq!(service.agent_settings()?.profile, "deepseek-harness");
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn old_ai_provider_shape_is_not_retained_on_open() -> Result<(), Box<dyn std::error::Error>> {
        let root = test_root();
        fs::create_dir_all(&root)?;
        let path = root.join("config.json");
        fs::write(
            &path,
            r#"{
              "version": 3,
              "quick_commands": [],
              "ai_profiles": [{
                "id": "adaptive",
                "name": "Adaptive",
                "base_url": "https://example.test/v1",
                "api_key_ref": "ai.adaptive.key",
                "auth_mode": "bearer",
                "context_mode": "local_rollout",
                "system_prompt": "",
                "models": [{
                  "id": "primary",
                  "name": "主模型",
                  "model": "model-a",
                  "role": "primary",
                  "enabled": true
                }],
                "routing": { "fallback_on_error": true, "analysis_threshold_chars": 32000 }
              }],
              "settings": {},
              "agent": {}
            }"#,
        )?;

        let service = ConfigService::open(path.clone())?;
        assert!(service.ai_profile_list()?.is_empty());
        let raw = fs::read_to_string(&path)?;
        assert!(!raw.contains("context_mode"));
        assert_eq!(serde_json::from_str::<Value>(&raw)?["version"], 6);

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn referenced_ai_provider_cannot_be_deleted_until_the_route_is_removed(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = test_root();
        let service = ConfigService::open(root.join("config.json"))?;
        let provider = AiProfile {
            id: "provider-backup".to_owned(),
            name: "Backup Provider".to_owned(),
            base_url: "https://backup.example/v1".to_owned(),
            api_key_ref: "ai.provider-backup.key".to_owned(),
            reasoning_effort: AiReasoningEffort::High,
            system_prompt: String::new(),
            models: vec![AiModelConfig {
                id: "provider-default".to_owned(),
                name: "Provider Default".to_owned(),
                model: "unused".to_owned(),
                context_window: None,
                max_output_tokens: None,
                provider_profile_id: None,
                role: AiModelRole::Primary,
                enabled: true,
            }],
            routing: AiRoutingConfig::default(),
        };
        let mut owner = provider.clone();
        owner.id = "owner".to_owned();
        owner.name = "Owner".to_owned();
        owner.api_key_ref = "ai.owner.key".to_owned();
        owner.models[0].provider_profile_id = Some(provider.id.clone());
        service.ai_profile_save(provider.clone())?;
        service.ai_profile_save(owner.clone())?;

        let error = match service.ai_profile_delete(&provider.id) {
            Err(error) => error,
            Ok(_) => panic!("referenced provider must remain available"),
        };
        assert!(error.detail().contains("正被模型路由"));
        owner.models[0].provider_profile_id = None;
        service.ai_profile_save(owner)?;
        assert!(service.ai_profile_delete(&provider.id)?.is_some());

        fs::remove_dir_all(root)?;
        Ok(())
    }
}

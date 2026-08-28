mod service;
mod vault;

pub(crate) use service::atomic_replace;
pub use service::{
    default_config_path, portable_mode_enabled, AppConfig, ConfigService,
    EnvironmentMigrationReport, DEFAULT_AGENT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT,
};
pub use vault::{CredentialVault, KeyringVault, MemoryVault};

use std::ffi::OsString;

pub fn portable_flag_present(executable: &std::path::Path) -> bool {
    executable
        .parent()
        .is_some_and(|directory| directory.join("portable.flag").is_file())
}

pub fn profile_argument<I>(arguments: I) -> Option<String>
where
    I: IntoIterator<Item = OsString>,
{
    let mut values = arguments.into_iter();
    while let Some(value) = values.next() {
        if value == "--profile" {
            return values.next().and_then(|name| name.into_string().ok());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{portable_flag_present, profile_argument};
    use std::ffi::OsString;

    #[test]
    fn reads_profile_argument() {
        let args = [
            OsString::from("myterm"),
            OsString::from("--profile"),
            OsString::from("prod-web"),
        ];
        assert_eq!(profile_argument(args), Some("prod-web".to_owned()));
    }

    #[test]
    fn portable_flag_is_detected_next_to_executable() -> Result<(), Box<dyn std::error::Error>> {
        let root = std::env::temp_dir().join(format!("myterm-flag-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root)?;
        let executable = root.join("myterm.exe");
        std::fs::write(&executable, [])?;
        assert!(!portable_flag_present(&executable));
        std::fs::write(root.join("portable.flag"), [])?;
        assert!(portable_flag_present(&executable));
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}

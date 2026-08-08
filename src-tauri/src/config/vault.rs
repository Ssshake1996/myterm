use std::{collections::HashMap, sync::RwLock};

use crate::{AppError, SecretResolver};

pub trait CredentialVault: Send + Sync {
    fn set(&self, reference: &str, secret: &str) -> Result<(), AppError>;
    fn get(&self, reference: &str) -> Result<Option<String>, AppError>;
    fn delete(&self, reference: &str) -> Result<(), AppError>;
}

pub struct KeyringVault;

impl KeyringVault {
    pub fn new() -> Self {
        Self
    }

    #[cfg(not(windows))]
    fn entry(reference: &str) -> Result<keyring::Entry, AppError> {
        keyring::Entry::new("dev.myterm.app", reference)
            .map_err(|error| AppError::Vault(error.to_string()))
    }
}

impl Default for KeyringVault {
    fn default() -> Self {
        Self::new()
    }
}

impl CredentialVault for KeyringVault {
    fn set(&self, reference: &str, secret: &str) -> Result<(), AppError> {
        #[cfg(windows)]
        return windows_vault::set(reference, secret);
        #[cfg(not(windows))]
        Self::entry(reference)?
            .set_password(secret)
            .map_err(|error| AppError::Vault(error.to_string()))
    }

    fn get(&self, reference: &str) -> Result<Option<String>, AppError> {
        #[cfg(windows)]
        return windows_vault::get(reference);
        #[cfg(not(windows))]
        match Self::entry(reference)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(AppError::Vault(error.to_string())),
        }
    }

    fn delete(&self, reference: &str) -> Result<(), AppError> {
        #[cfg(windows)]
        return windows_vault::delete(reference);
        #[cfg(not(windows))]
        match Self::entry(reference)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(AppError::Vault(error.to_string())),
        }
    }
}

#[cfg(windows)]
mod windows_vault {
    use std::{ptr, slice};

    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };

    use crate::AppError;

    const SERVICE: &str = "dev.myterm.app";

    pub fn set(reference: &str, secret: &str) -> Result<(), AppError> {
        let mut target = wide(&format!("{reference}.{SERVICE}"));
        let mut username = wide(reference);
        let mut comment = wide("myterm credential");
        let mut blob: Vec<u8> = secret.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            Comment: comment.as_mut_ptr(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: username.as_mut_ptr(),
            ..CREDENTIALW::default()
        };
        let written = unsafe { CredWriteW(&credential, 0) };
        blob.fill(0);
        if written == 0 {
            return Err(last_error("writing credential"));
        }
        match get(reference)? {
            Some(stored) if stored == secret => Ok(()),
            _ => Err(AppError::Vault(
                "credential write could not be verified".to_owned(),
            )),
        }
    }

    pub fn get(reference: &str) -> Result<Option<String>, AppError> {
        let target = wide(&format!("{reference}.{SERVICE}"));
        let mut raw = ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } == 0 {
            let code = unsafe { GetLastError() };
            if code == ERROR_NOT_FOUND {
                return Ok(None);
            }
            return Err(AppError::Vault(format!(
                "reading credential failed (Windows error {code})"
            )));
        }
        let credential = unsafe { &*raw };
        let blob = unsafe {
            slice::from_raw_parts(
                credential.CredentialBlob,
                credential.CredentialBlobSize as usize,
            )
        };
        let decoded = if blob.len() % 2 == 0 {
            let utf16: Vec<u16> = blob
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect();
            String::from_utf16(&utf16)
                .map_err(|error| AppError::Vault(format!("invalid credential encoding: {error}")))
        } else {
            Err(AppError::Vault("invalid credential blob length".to_owned()))
        };
        unsafe { CredFree(raw.cast()) };
        decoded.map(Some)
    }

    pub fn delete(reference: &str) -> Result<(), AppError> {
        let target = wide(&format!("{reference}.{SERVICE}"));
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
            return Ok(());
        }
        let code = unsafe { GetLastError() };
        if code == ERROR_NOT_FOUND {
            Ok(())
        } else {
            Err(AppError::Vault(format!(
                "deleting credential failed (Windows error {code})"
            )))
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    fn last_error(action: &str) -> AppError {
        let code = unsafe { GetLastError() };
        AppError::Vault(format!("{action} failed (Windows error {code})"))
    }
}

#[derive(Default)]
pub struct MemoryVault {
    values: RwLock<HashMap<String, String>>,
}

impl CredentialVault for MemoryVault {
    fn set(&self, reference: &str, secret: &str) -> Result<(), AppError> {
        self.values
            .write()
            .map_err(|_| AppError::Vault("memory vault lock is poisoned".to_owned()))?
            .insert(reference.to_owned(), secret.to_owned());
        Ok(())
    }

    fn get(&self, reference: &str) -> Result<Option<String>, AppError> {
        Ok(self
            .values
            .read()
            .map_err(|_| AppError::Vault("memory vault lock is poisoned".to_owned()))?
            .get(reference)
            .cloned())
    }

    fn delete(&self, reference: &str) -> Result<(), AppError> {
        self.values
            .write()
            .map_err(|_| AppError::Vault("memory vault lock is poisoned".to_owned()))?
            .remove(reference);
        Ok(())
    }
}

impl<T: CredentialVault + ?Sized> SecretResolver for T {
    fn resolve(&self, vault_ref: &str) -> Result<String, AppError> {
        self.get(vault_ref)?.ok_or_else(|| {
            AppError::Vault(format!("credential reference '{vault_ref}' was not found"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{CredentialVault, MemoryVault};
    use crate::SecretResolver;

    #[test]
    fn memory_vault_resolves_and_deletes_references() -> Result<(), Box<dyn std::error::Error>> {
        let vault = MemoryVault::default();
        vault.set("profile.test.password", "secret-value")?;
        assert_eq!(vault.resolve("profile.test.password")?, "secret-value");
        vault.delete("profile.test.password")?;
        assert!(vault.get("profile.test.password")?.is_none());
        Ok(())
    }

    #[test]
    #[ignore = "requires an interactive operating-system credential store"]
    fn keyring_round_trip() -> Result<(), Box<dyn std::error::Error>> {
        let vault = super::KeyringVault::new();
        let reference = format!("myterm-test-{}", uuid::Uuid::new_v4());
        vault.set(&reference, "temporary-secret")?;
        assert_eq!(vault.get(&reference)?, Some("temporary-secret".to_owned()));
        vault.delete(&reference)?;
        Ok(())
    }
}

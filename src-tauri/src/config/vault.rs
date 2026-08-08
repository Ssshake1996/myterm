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
        Self::entry(reference)?
            .set_password(secret)
            .map_err(|error| AppError::Vault(error.to_string()))
    }

    fn get(&self, reference: &str) -> Result<Option<String>, AppError> {
        match Self::entry(reference)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(AppError::Vault(error.to_string())),
        }
    }

    fn delete(&self, reference: &str) -> Result<(), AppError> {
        match Self::entry(reference)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(AppError::Vault(error.to_string())),
        }
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

use crate::{
    config::{ConfigService, CredentialVault},
    types::{AuthMethod, SessionProfile, SessionTarget},
    AppError,
};

pub fn save(
    config: &ConfigService,
    vault: &dyn CredentialVault,
    mut profile: SessionProfile,
    secret: Option<String>,
) -> Result<SessionProfile, AppError> {
    profile.id = profile.id.trim().to_owned();
    profile.name = profile.name.trim().to_owned();
    profile.group = profile.group.trim().to_owned();
    if profile.id.is_empty() || profile.name.is_empty() {
        return Err(AppError::InvalidInput(
            "profile ID and name are required".to_owned(),
        ));
    }
    if profile.group.is_empty() {
        profile.group = "默认".to_owned();
    }

    let previous = config
        .profile_list()?
        .into_iter()
        .find(|candidate| candidate.id == profile.id);
    let previous_ref = previous.as_ref().and_then(credential_ref);
    let secret = secret.filter(|value| !value.is_empty());
    let next_ref = match &mut profile.target {
        SessionTarget::Local { shell } => {
            *shell = shell.trim().to_owned();
            if shell.is_empty() {
                return Err(AppError::InvalidInput("local shell is required".to_owned()));
            }
            None
        }
        SessionTarget::Ssh {
            host,
            port,
            username,
            auth,
        } => {
            *host = host.trim().to_owned();
            *username = username.trim().to_owned();
            if host.is_empty() || username.is_empty() || *port == 0 {
                return Err(AppError::InvalidInput(
                    "SSH host, port, and username are required".to_owned(),
                ));
            }
            match auth {
                AuthMethod::Password { vault_ref } => {
                    let reference = previous
                        .as_ref()
                        .and_then(|profile| match &profile.target {
                            SessionTarget::Ssh {
                                auth: AuthMethod::Password { vault_ref },
                                ..
                            } => Some(vault_ref.clone()),
                            _ => None,
                        })
                        .unwrap_or_else(|| format!("profile.{}.password", profile.id));
                    *vault_ref = reference.clone();
                    if secret.is_none() && vault.get(&reference)?.is_none() {
                        return Err(AppError::InvalidInput(
                            "password is required for this SSH profile".to_owned(),
                        ));
                    }
                    Some(reference)
                }
                AuthMethod::PrivateKey {
                    key_path,
                    passphrase_ref,
                } => {
                    *key_path = key_path.trim().to_owned();
                    if key_path.is_empty() {
                        return Err(AppError::InvalidInput(
                            "private key path is required".to_owned(),
                        ));
                    }
                    let existing = previous.as_ref().and_then(|profile| match &profile.target {
                        SessionTarget::Ssh {
                            auth: AuthMethod::PrivateKey { passphrase_ref, .. },
                            ..
                        } => passphrase_ref.clone(),
                        _ => None,
                    });
                    *passphrase_ref = if secret.is_some() {
                        Some(
                            existing
                                .unwrap_or_else(|| format!("profile.{}.passphrase", profile.id)),
                        )
                    } else {
                        existing
                    };
                    passphrase_ref.clone()
                }
            }
        }
    };

    let previous_value = match (&next_ref, &secret) {
        (Some(reference), Some(_)) => vault.get(reference)?,
        _ => None,
    };
    if let (Some(reference), Some(secret)) = (&next_ref, &secret) {
        vault.set(reference, secret)?;
    }
    if let Err(error) = config.profile_save(profile.clone()) {
        if let (Some(reference), Some(_)) = (&next_ref, &secret) {
            match previous_value {
                Some(value) => vault.set(reference, &value)?,
                None => vault.delete(reference)?,
            }
        }
        return Err(error);
    }
    if let Some(reference) =
        previous_ref.filter(|reference| next_ref.as_deref() != Some(*reference))
    {
        vault.delete(reference)?;
    }
    Ok(profile)
}

pub fn delete(
    config: &ConfigService,
    vault: &dyn CredentialVault,
    profile_id: &str,
) -> Result<(), AppError> {
    let deleted = config.profile_delete(profile_id)?;
    if let Some(profile) = deleted {
        if let Some(reference) = credential_ref(&profile) {
            vault.delete(reference)?;
        }
    }
    Ok(())
}

fn credential_ref(profile: &SessionProfile) -> Option<&str> {
    match &profile.target {
        SessionTarget::Ssh {
            auth: AuthMethod::Password { vault_ref },
            ..
        } => Some(vault_ref),
        SessionTarget::Ssh {
            auth: AuthMethod::PrivateKey { passphrase_ref, .. },
            ..
        } => passphrase_ref.as_deref(),
        SessionTarget::Local { .. } => None,
    }
}

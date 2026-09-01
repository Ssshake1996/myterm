use crate::{
    config::{ConfigService, CredentialVault},
    types::{AiModelConfig, AiProfile},
    AppError,
};

#[derive(Clone)]
pub(crate) struct ResolvedAiModelRoute {
    pub model: AiModelConfig,
    pub provider: AiProfile,
    pub api_key: String,
}

pub(crate) fn resolve_model_routes(
    config: &ConfigService,
    vault: &dyn CredentialVault,
    profile: &AiProfile,
) -> Result<Vec<ResolvedAiModelRoute>, AppError> {
    let profiles = config.ai_profile_list()?;
    profile
        .effective_models()
        .into_iter()
        .map(|model| {
            let provider_id = model
                .provider_profile_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty() && *value != profile.id)
                .unwrap_or(profile.id.as_str());
            let provider = profiles
                .iter()
                .find(|candidate| candidate.id == provider_id)
                .cloned()
                .ok_or_else(|| {
                    AppError::InvalidInput(format!(
                        "AI 模型路由 '{}' 引用的 DeepSeek 服务 '{}' 不存在",
                        model.name, provider_id
                    ))
                })?;
            let api_key = vault
                .get(&provider.api_key_ref)?
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::Ai(format!(
                        "AI 模型路由 '{}' 的 DeepSeek 服务 '{}' 未配置 API Key",
                        model.name, provider.name
                    ))
                })?;
            Ok(ResolvedAiModelRoute {
                model,
                provider,
                api_key,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc};

    use crate::{
        config::{ConfigService, CredentialVault, MemoryVault},
        types::{AiModelConfig, AiModelRole, AiProfile, AiReasoningEffort, AiRoutingConfig},
    };

    use super::resolve_model_routes;

    fn profile(id: &str, name: &str, model: &str) -> AiProfile {
        AiProfile {
            id: id.to_owned(),
            name: name.to_owned(),
            base_url: format!("https://{id}.example.test/v1"),
            api_key_ref: format!("ai.{id}.key"),
            reasoning_effort: AiReasoningEffort::High,
            system_prompt: String::new(),
            models: vec![AiModelConfig {
                id: "primary".to_owned(),
                name: "主模型".to_owned(),
                model: model.to_owned(),
                provider_profile_id: None,
                role: AiModelRole::Primary,
                enabled: true,
            }],
            routing: AiRoutingConfig::default(),
        }
    }

    #[test]
    fn resolves_a_model_through_another_saved_provider() -> Result<(), Box<dyn std::error::Error>> {
        let root = std::env::temp_dir().join(format!("myterm-routing-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root)?;
        let config = ConfigService::open(root.join("config.json"))?;
        let mut primary = profile("primary", "Primary", "deepseek-primary");
        let provider = profile("backup", "Backup Provider", "unused-default");
        primary.models.push(AiModelConfig {
            id: "fallback".to_owned(),
            name: "备用模型".to_owned(),
            model: "deepseek-backup".to_owned(),
            provider_profile_id: Some(provider.id.clone()),
            role: AiModelRole::Fallback,
            enabled: true,
        });
        config.ai_profile_save(provider.clone())?;
        config.ai_profile_save(primary.clone())?;
        let vault = Arc::new(MemoryVault::default());
        vault.set(&primary.api_key_ref, "primary-secret")?;
        vault.set(&provider.api_key_ref, "backup-secret")?;

        let routes = resolve_model_routes(&config, vault.as_ref(), &primary)?;
        assert_eq!(routes.len(), 2);
        assert_eq!(routes[1].provider.id, provider.id);
        assert_eq!(routes[1].model.model, "deepseek-backup");
        assert_eq!(routes[1].api_key, "backup-secret");
        fs::remove_dir_all(root)?;
        Ok(())
    }
}

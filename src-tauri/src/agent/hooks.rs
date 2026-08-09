use std::{collections::BTreeMap, time::Duration};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::process::Command;

use crate::{types::AgentHookConfig, AppError};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HookAction {
    Context,
    Ask,
    Deny,
    Verify,
}

pub struct HookResult {
    pub hook_id: String,
    pub action: HookAction,
    pub message: String,
    pub context: Option<String>,
    pub stderr: String,
}

#[derive(Deserialize)]
struct HookOutput {
    #[serde(default)]
    action: String,
    #[serde(default)]
    message: String,
    context: Option<String>,
}

pub async fn run(hooks: &[AgentHookConfig], event: &str, payload: &Value) -> Vec<HookResult> {
    let mut results = Vec::new();
    for hook in hooks
        .iter()
        .filter(|hook| hook.enabled && hook.event == event)
    {
        results.push(
            run_one(hook, event, payload)
                .await
                .unwrap_or_else(|error| HookResult {
                    hook_id: hook.id.clone(),
                    action: HookAction::Ask,
                    message: format!("hook failed conservatively: {error}"),
                    context: None,
                    stderr: String::new(),
                }),
        );
    }
    results
}

async fn run_one(
    hook: &AgentHookConfig,
    event: &str,
    payload: &Value,
) -> Result<HookResult, AppError> {
    if hook.command.trim().is_empty() {
        return Err(AppError::InvalidInput(format!(
            "hook '{}' command is empty",
            hook.id
        )));
    }
    let mut command = Command::new(&hook.command);
    command.args(&hook.args).kill_on_drop(true).env_clear();
    for name in ["PATH", "SystemRoot", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command.env("MYTERM_HOOK_EVENT", event);
    command.env("MYTERM_HOOK_PAYLOAD", bounded_json(payload));
    if let Some(cwd) = hook.cwd.as_deref().filter(|cwd| !cwd.trim().is_empty()) {
        command.current_dir(cwd);
    }
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let output = tokio::time::timeout(Duration::from_secs(5), command.output())
        .await
        .map_err(|_| AppError::Agent(format!("hook '{}' timed out", hook.id)))??;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(AppError::Agent(format!(
            "hook '{}' exited with {}: {}",
            hook.id,
            output.status,
            truncate(&stderr)
        )));
    }
    let parsed: HookOutput = serde_json::from_str(&stdout).map_err(|error| {
        AppError::Agent(format!("hook '{}' returned invalid JSON: {error}", hook.id))
    })?;
    let action = match parsed.action.as_str() {
        "deny" => HookAction::Deny,
        "ask" => HookAction::Ask,
        "verify" => HookAction::Verify,
        "context" | "" => HookAction::Context,
        _ => HookAction::Ask,
    };
    Ok(HookResult {
        hook_id: hook.id.clone(),
        action,
        message: truncate(&parsed.message),
        context: parsed.context.map(|context| truncate(&context)),
        stderr: truncate(&stderr),
    })
}

pub fn event_payload(results: &[HookResult]) -> Value {
    Value::Array(
        results
            .iter()
            .map(|result| {
                json!({
                    "hookId": result.hook_id,
                    "action": format!("{:?}", result.action).to_ascii_lowercase(),
                    "message": result.message,
                    "context": result.context,
                    "stderr": result.stderr,
                })
            })
            .collect(),
    )
}

fn bounded_json(value: &Value) -> String {
    let mut secrets = BTreeMap::new();
    secrets.insert("payload", value);
    truncate(&serde_json::to_string(&secrets).unwrap_or_default())
}

fn truncate(value: &str) -> String {
    let mut bounded = value.chars().take(16_000).collect::<String>();
    if value.chars().count() > 16_000 {
        bounded.push_str("\n[hook output truncated]");
    }
    bounded
}

#[cfg(test)]
mod tests {
    use super::truncate;

    #[test]
    fn hook_output_is_bounded() {
        assert!(truncate(&"x".repeat(20_000)).len() < 17_000);
    }
}

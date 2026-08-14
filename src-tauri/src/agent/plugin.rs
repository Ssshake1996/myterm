use std::{collections::HashMap, future::Future, pin::Pin, sync::Arc};

use serde_json::Value;
use tokio::sync::watch;

use super::{
    mcp::{McpTaskClient, McpToolDefinition},
    service::AgentService,
};
use crate::{
    types::{AgentPluginInfo, AgentSettings},
    AppError,
};

pub type ToolFuture<'a> = Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>>;

#[derive(Clone, Debug)]
pub struct PluginManifest {
    pub id: &'static str,
    pub name: &'static str,
    pub version: &'static str,
    pub kind: &'static str,
    pub description: &'static str,
    pub requires: &'static [&'static str],
}

#[derive(Clone, Debug)]
pub struct ToolDescriptor {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub plugin_id: String,
}

pub struct ToolContext<'a> {
    pub service: &'a AgentService,
    pub run_id: &'a str,
    pub call_id: &'a str,
    pub session_id: Option<&'a str>,
    pub settings: &'a AgentSettings,
    pub mcp_tools: &'a [McpToolDefinition],
    pub mcp_clients: &'a HashMap<String, McpTaskClient>,
    pub sink: Arc<dyn super::service::AgentEventSink>,
    pub abort: watch::Receiver<bool>,
}

pub trait AgentToolPlugin: Send + Sync {
    fn manifest(&self) -> PluginManifest;
    fn descriptors(&self, mcp_tools: &[McpToolDefinition]) -> Vec<ToolDescriptor>;
    fn supports(&self, name: &str) -> bool;
    fn execute<'a>(
        &'a self,
        name: &'a str,
        context: ToolContext<'a>,
        arguments: Value,
    ) -> ToolFuture<'a>;
}

pub struct PluginRegistry {
    plugins: Vec<Arc<dyn AgentToolPlugin>>,
}

impl PluginRegistry {
    pub fn desktop() -> Self {
        Self {
            plugins: vec![
                Arc::new(BuiltinToolsPlugin),
                Arc::new(SkillPlugin),
                Arc::new(McpPlugin),
                Arc::new(HooksPlugin),
                Arc::new(ModelPlugin),
            ],
        }
    }

    pub fn for_settings(settings: &AgentSettings) -> Self {
        let registry = Self::desktop();
        if settings.enabled_plugins.is_empty() {
            return registry;
        }
        let enabled = settings
            .enabled_plugins
            .iter()
            .map(String::as_str)
            .collect::<std::collections::HashSet<_>>();
        Self {
            plugins: registry
                .plugins
                .into_iter()
                .filter(|plugin| enabled.contains(plugin.manifest().id))
                .collect(),
        }
    }

    pub fn descriptors(&self, mcp_tools: &[McpToolDefinition]) -> Vec<ToolDescriptor> {
        self.plugins
            .iter()
            .flat_map(|plugin| plugin.descriptors(mcp_tools))
            .collect()
    }

    pub fn execute<'a>(
        &'a self,
        name: &'a str,
        context: ToolContext<'a>,
        arguments: Value,
    ) -> ToolFuture<'a> {
        let Some(plugin) = self.plugins.iter().find(|plugin| plugin.supports(name)) else {
            return Box::pin(
                async move { Err(AppError::NotFound(format!("agent tool '{name}'"))) },
            );
        };
        plugin.execute(name, context, arguments)
    }

    pub fn infos(&self) -> Vec<AgentPluginInfo> {
        self.plugins
            .iter()
            .map(|plugin| plugin_info(plugin.as_ref(), true))
            .collect()
    }

    pub fn infos_for_settings(settings: &AgentSettings) -> Vec<AgentPluginInfo> {
        let enabled = settings
            .enabled_plugins
            .iter()
            .map(String::as_str)
            .collect::<std::collections::HashSet<_>>();
        Self::desktop()
            .plugins
            .iter()
            .map(|plugin| {
                plugin_info(
                    plugin.as_ref(),
                    settings.enabled_plugins.is_empty() || enabled.contains(plugin.manifest().id),
                )
            })
            .collect()
    }

    pub fn plugin_id_for_tool(
        &self,
        name: &str,
        mcp_tools: &[McpToolDefinition],
    ) -> Option<String> {
        self.plugins
            .iter()
            .find(|plugin| {
                plugin
                    .descriptors(mcp_tools)
                    .iter()
                    .any(|tool| tool.name == name)
            })
            .map(|plugin| plugin.manifest().id.to_owned())
    }
}

struct BuiltinToolsPlugin;
struct SkillPlugin;
struct McpPlugin;
struct HooksPlugin;
struct ModelPlugin;

fn plugin_info(plugin: &dyn AgentToolPlugin, enabled: bool) -> AgentPluginInfo {
    let manifest = plugin.manifest();
    AgentPluginInfo {
        id: manifest.id.to_owned(),
        name: manifest.name.to_owned(),
        version: manifest.version.to_owned(),
        kind: manifest.kind.to_owned(),
        description: manifest.description.to_owned(),
        requires: manifest
            .requires
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        enabled,
    }
}

impl AgentToolPlugin for BuiltinToolsPlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest {
            id: "builtin.tools",
            name: "Built-in Operations",
            version: env!("CARGO_PKG_VERSION"),
            kind: "tool",
            description: "SSH, terminal, file, host-facts, runbook, and background-job tools.",
            requires: &["core.session", "core.policy"],
        }
    }

    fn descriptors(&self, _mcp_tools: &[McpToolDefinition]) -> Vec<ToolDescriptor> {
        super::service::tool_definitions(&[])
            .into_iter()
            .filter_map(|definition| {
                let function = definition.get("function")?;
                Some(ToolDescriptor {
                    name: function.get("name")?.as_str()?.to_owned(),
                    description: function.get("description")?.as_str()?.to_owned(),
                    input_schema: function.get("parameters")?.clone(),
                    plugin_id: self.manifest().id.to_owned(),
                })
            })
            .filter(|tool| {
                !matches!(
                    tool.name.as_str(),
                    "skill_load" | "mcp_tool_search" | "mcp_tool_call"
                )
            })
            .collect()
    }

    fn supports(&self, name: &str) -> bool {
        !matches!(name, "skill_load" | "mcp_tool_search" | "mcp_tool_call")
            && !name.starts_with("mcp__")
    }

    fn execute<'a>(
        &'a self,
        name: &'a str,
        context: ToolContext<'a>,
        arguments: Value,
    ) -> ToolFuture<'a> {
        Box::pin(async move {
            context
                .service
                .execute_builtin_tool(
                    context.run_id,
                    context.call_id,
                    name,
                    arguments,
                    context.session_id,
                    context.settings,
                    context.mcp_tools,
                    context.mcp_clients,
                    context.sink,
                    context.abort,
                )
                .await
        })
    }
}

impl AgentToolPlugin for SkillPlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest {
            id: "builtin.skills",
            name: "Local Skills",
            version: env!("CARGO_PKG_VERSION"),
            kind: "capability",
            description: "Loads enabled local SKILL.md workflows on demand.",
            requires: &["core.prompt", "core.policy"],
        }
    }

    fn descriptors(&self, _mcp_tools: &[McpToolDefinition]) -> Vec<ToolDescriptor> {
        vec![ToolDescriptor {
            name: "skill_load".to_owned(),
            description: "Load the bounded SKILL.md body for one exact id from the enabled local Skill catalog.".to_owned(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"], "additionalProperties": false
            }),
            plugin_id: self.manifest().id.to_owned(),
        }]
    }

    fn supports(&self, name: &str) -> bool {
        name == "skill_load"
    }

    fn execute<'a>(
        &'a self,
        _name: &str,
        context: ToolContext<'a>,
        arguments: Value,
    ) -> ToolFuture<'a> {
        Box::pin(async move {
            let id = super::service::argument_str(&arguments, "id")?;
            super::skills::load_content(
                &context.settings.skill_directories,
                &context.settings.enabled_skills,
                id,
            )
        })
    }
}

impl AgentToolPlugin for McpPlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest {
            id: "builtin.mcp",
            name: "MCP Bridge",
            version: env!("CARGO_PKG_VERSION"),
            kind: "capability",
            description: "Discovers and calls task-scoped stdio MCP tools.",
            requires: &["core.tools", "core.policy"],
        }
    }

    fn descriptors(&self, mcp_tools: &[McpToolDefinition]) -> Vec<ToolDescriptor> {
        if mcp_tools.len() + 15 <= 48 {
            return mcp_tools
                .iter()
                .map(|tool| ToolDescriptor {
                    name: tool.internal_name.clone(),
                    description: tool.description.clone(),
                    input_schema: tool.input_schema.clone(),
                    plugin_id: self.manifest().id.to_owned(),
                })
                .collect();
        }
        vec![
            ToolDescriptor {
                name: "mcp_tool_search".to_owned(),
                description: "Search the task-scoped MCP catalog by tool name or description and return matching schemas.".to_owned(),
                input_schema: serde_json::json!({
                    "type": "object", "properties": { "query": { "type": "string" } },
                    "required": ["query"], "additionalProperties": false
                }),
                plugin_id: self.manifest().id.to_owned(),
            },
            ToolDescriptor {
                name: "mcp_tool_call".to_owned(),
                description: "Call one MCP tool returned by mcp_tool_search. Local permission policy still applies.".to_owned(),
                input_schema: serde_json::json!({
                    "type": "object", "properties": {
                        "server_id": { "type": "string" }, "tool_name": { "type": "string" }, "arguments": { "type": "object" }
                    }, "required": ["server_id", "tool_name", "arguments"], "additionalProperties": false
                }),
                plugin_id: self.manifest().id.to_owned(),
            },
        ]
    }

    fn supports(&self, name: &str) -> bool {
        name == "mcp_tool_search" || name == "mcp_tool_call" || name.starts_with("mcp__")
    }

    fn execute<'a>(
        &'a self,
        name: &'a str,
        context: ToolContext<'a>,
        arguments: Value,
    ) -> ToolFuture<'a> {
        Box::pin(async move {
            context
                .service
                .execute_mcp_tool(name, context, arguments)
                .await
        })
    }
}

impl AgentToolPlugin for HooksPlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest {
            id: "builtin.hooks",
            name: "Agent Hooks",
            version: env!("CARGO_PKG_VERSION"),
            kind: "lifecycle",
            description: "Runs configured lifecycle hooks through the shared event pipeline.",
            requires: &["core.events", "core.policy"],
        }
    }
    fn descriptors(&self, _mcp_tools: &[McpToolDefinition]) -> Vec<ToolDescriptor> {
        Vec::new()
    }
    fn supports(&self, _name: &str) -> bool {
        false
    }
    fn execute<'a>(
        &'a self,
        _name: &str,
        _context: ToolContext<'a>,
        _arguments: Value,
    ) -> ToolFuture<'a> {
        Box::pin(async { Err(AppError::NotFound("hook tool".to_owned())) })
    }
}

impl AgentToolPlugin for ModelPlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest {
            id: "builtin.model.openai",
            name: "OpenAI Compatible Model",
            version: env!("CARGO_PKG_VERSION"),
            kind: "model",
            description: "OpenAI-compatible chat completion adapter used by the default loop.",
            requires: &["core.agent-loop", "core.secrets"],
        }
    }
    fn descriptors(&self, _mcp_tools: &[McpToolDefinition]) -> Vec<ToolDescriptor> {
        Vec::new()
    }
    fn supports(&self, _name: &str) -> bool {
        false
    }
    fn execute<'a>(
        &'a self,
        _name: &str,
        _context: ToolContext<'a>,
        _arguments: Value,
    ) -> ToolFuture<'a> {
        Box::pin(async { Err(AppError::NotFound("model tool".to_owned())) })
    }
}

#[cfg(test)]
mod tests {
    use super::PluginRegistry;
    use crate::types::AgentSettings;

    #[test]
    fn default_profile_mounts_all_plugins_and_explicit_selection_is_scoped() {
        let default_plugins = PluginRegistry::for_settings(&AgentSettings::default());
        assert!(default_plugins
            .infos()
            .iter()
            .any(|plugin| plugin.id == "builtin.tools"));
        assert!(default_plugins
            .infos()
            .iter()
            .any(|plugin| plugin.id == "builtin.mcp"));

        let settings = AgentSettings {
            enabled_plugins: vec!["builtin.skills".to_owned()],
            ..AgentSettings::default()
        };
        let scoped = PluginRegistry::for_settings(&settings);
        assert_eq!(scoped.infos().len(), 1);
        assert_eq!(scoped.infos()[0].id, "builtin.skills");
        assert!(scoped
            .descriptors(&[])
            .iter()
            .any(|tool| tool.name == "skill_load"));

        let infos = PluginRegistry::infos_for_settings(&settings);
        assert_eq!(infos.len(), 5);
        assert!(infos
            .iter()
            .any(|plugin| plugin.id == "builtin.skills" && plugin.enabled));
        assert!(infos
            .iter()
            .any(|plugin| plugin.id == "builtin.tools" && !plugin.enabled));
    }
}

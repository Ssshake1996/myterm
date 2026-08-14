use std::sync::Arc;

use serde_json::Value;
use tokio::sync::watch;

use super::{
    mcp::{McpTaskClient, McpToolDefinition},
    plugin::{PluginRegistry, ToolContext},
    service::{AgentEventSink, AgentService},
};
use crate::{types::AgentSettings, AppError};

pub struct AgentRuntime<'a> {
    pub service: &'a AgentService,
    pub plugins: PluginRegistry,
}

impl<'a> AgentRuntime<'a> {
    pub fn new(service: &'a AgentService, settings: &AgentSettings) -> Self {
        Self {
            service,
            plugins: PluginRegistry::for_settings(settings),
        }
    }

    pub fn tool_schemas(&self, mcp_tools: &[McpToolDefinition]) -> Vec<Value> {
        self.plugins
            .descriptors(mcp_tools)
            .into_iter()
            .map(|tool| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema,
                    }
                })
            })
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn execute(
        &self,
        name: &str,
        run_id: &str,
        call_id: &str,
        session_id: Option<&str>,
        settings: &AgentSettings,
        mcp_tools: &[McpToolDefinition],
        mcp_clients: &std::collections::HashMap<String, McpTaskClient>,
        sink: Arc<dyn AgentEventSink>,
        abort: watch::Receiver<bool>,
        arguments: Value,
    ) -> Result<String, AppError> {
        self.plugins
            .execute(
                name,
                ToolContext {
                    service: self.service,
                    run_id,
                    call_id,
                    session_id,
                    settings,
                    mcp_tools,
                    mcp_clients,
                    sink,
                    abort,
                },
                arguments,
            )
            .await
    }
}

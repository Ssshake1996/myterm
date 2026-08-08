use std::time::Duration;

use rmcp::{model::CallToolRequestParams, transport::TokioChildProcess, ServiceExt};
use serde_json::Value;
use tokio::process::Command;

use crate::{
    types::{McpServerConfig, McpToolInfo},
    AppError,
};

#[derive(Clone)]
pub struct McpToolDefinition {
    pub internal_name: String,
    pub server_id: String,
    pub original_name: String,
    pub description: String,
    pub input_schema: Value,
}

pub async fn list_tools(server: &McpServerConfig) -> Result<Vec<McpToolDefinition>, AppError> {
    let client = connect(server).await?;
    let result = tokio::time::timeout(Duration::from_secs(15), client.list_all_tools())
        .await
        .map_err(|_| AppError::Ai(format!("MCP server '{}' timed out", server.name)))?
        .map_err(|error| AppError::Ai(format!("MCP server '{}': {error}", server.name)));
    let _ = client.cancel().await;
    result.map(|tools| {
        tools
            .into_iter()
            .map(|tool| McpToolDefinition {
                internal_name: tool_name(&server.id, &tool.name),
                server_id: server.id.clone(),
                original_name: tool.name.into_owned(),
                description: tool
                    .description
                    .map_or_else(String::new, |value| value.into_owned()),
                input_schema: Value::Object((*tool.input_schema).clone()),
            })
            .collect()
    })
}

pub async fn list_tool_info(server: &McpServerConfig) -> Result<Vec<McpToolInfo>, AppError> {
    Ok(list_tools(server)
        .await?
        .into_iter()
        .map(|tool| McpToolInfo {
            server_id: server.id.clone(),
            server_name: server.name.clone(),
            name: tool.original_name,
            description: tool.description,
        })
        .collect())
}

pub async fn call_tool(
    server: &McpServerConfig,
    tool_name: &str,
    arguments: Value,
) -> Result<String, AppError> {
    let client = connect(server).await?;
    let arguments = arguments.as_object().cloned().ok_or_else(|| {
        AppError::InvalidInput("MCP tool arguments must be a JSON object".to_owned())
    })?;
    let result = tokio::time::timeout(
        Duration::from_secs(60),
        client
            .call_tool(CallToolRequestParams::new(tool_name.to_owned()).with_arguments(arguments)),
    )
    .await
    .map_err(|_| AppError::Ai(format!("MCP tool '{tool_name}' timed out")))?
    .map_err(|error| AppError::Ai(format!("MCP tool '{tool_name}': {error}")));
    let _ = client.cancel().await;
    serde_json::to_string(&result?).map_err(Into::into)
}

async fn connect(
    server: &McpServerConfig,
) -> Result<rmcp::service::RunningService<rmcp::RoleClient, ()>, AppError> {
    if server.command.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "MCP server command is required".to_owned(),
        ));
    }
    let mut command = Command::new(&server.command);
    command.args(&server.args);
    if let Some(cwd) = server
        .cwd
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        command.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        command.creation_flags(0x0800_0000);
    }
    let transport = TokioChildProcess::new(command)
        .map_err(|error| AppError::Ai(format!("unable to start MCP server: {error}")))?;
    tokio::time::timeout(Duration::from_secs(15), ().serve(transport))
        .await
        .map_err(|_| AppError::Ai(format!("MCP server '{}' did not initialize", server.name)))?
        .map_err(|error| AppError::Ai(format!("MCP server '{}': {error}", server.name)))
}

fn tool_name(server_id: &str, name: &str) -> String {
    format!("mcp__{}__{}", sanitize(server_id), sanitize(name))
}

fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::tool_name;

    #[test]
    fn mcp_tool_names_are_model_safe_and_namespaced() {
        assert_eq!(
            tool_name("git server", "status/list"),
            "mcp__git_server__status_list"
        );
    }
}

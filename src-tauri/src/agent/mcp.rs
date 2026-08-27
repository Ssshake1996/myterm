use std::{collections::HashMap, time::Duration};

use http::{HeaderName, HeaderValue};
use rmcp::{
    model::CallToolRequestParams,
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
        TokioChildProcess,
    },
    ServiceExt,
};
use serde_json::Value;
use tokio::process::Command;

use crate::{
    types::{McpServerConfig, McpToolInfo, McpTransportKind},
    AppError,
};

type RunningClient = rmcp::service::RunningService<rmcp::RoleClient, ()>;

/// A task-scoped MCP client backed by one of the supported transports.
///
/// The Agent only talks to this facade. Transport-specific setup and lifecycle
/// details stay inside this module, so adding another MCP transport does not
/// require changes to the Agent loop or tool execution policy.
pub struct McpTaskClient {
    server: McpServerConfig,
    client: RunningClient,
}

impl McpTaskClient {
    pub async fn start(server: &McpServerConfig) -> Result<Self, AppError> {
        let client = connect(server).await?;
        Ok(Self {
            server: server.clone(),
            client,
        })
    }

    pub async fn list_tools(&self) -> Result<Vec<McpToolDefinition>, AppError> {
        let tools = tokio::time::timeout(Duration::from_secs(15), self.client.list_all_tools())
            .await
            .map_err(|_| {
                AppError::Ai(format!(
                    "MCP server '{}' [{}] timed out while listing tools",
                    self.server.name,
                    transport_label(&self.server.transport)
                ))
            })?
            .map_err(|error| {
                AppError::Ai(format!(
                    "MCP server '{}' [{}] failed to list tools: {error}",
                    self.server.name,
                    transport_label(&self.server.transport)
                ))
            })?;
        Ok(tools
            .into_iter()
            .map(|tool| McpToolDefinition {
                internal_name: tool_name(&self.server.id, &tool.name),
                server_id: self.server.id.clone(),
                original_name: tool.name.into_owned(),
                description: tool
                    .description
                    .map_or_else(String::new, |value| value.into_owned()),
                input_schema: Value::Object((*tool.input_schema).clone()),
            })
            .collect())
    }

    pub async fn call_tool(&self, tool_name: &str, arguments: Value) -> Result<String, AppError> {
        let arguments = arguments.as_object().cloned().ok_or_else(|| {
            AppError::InvalidInput("MCP tool arguments must be a JSON object".to_owned())
        })?;
        let result = tokio::time::timeout(
            Duration::from_secs(60),
            self.client.call_tool(
                CallToolRequestParams::new(tool_name.to_owned()).with_arguments(arguments),
            ),
        )
        .await
        .map_err(|_| {
            AppError::Ai(format!(
                "MCP server '{}' [{}] tool '{}' timed out",
                self.server.name,
                transport_label(&self.server.transport),
                tool_name
            ))
        })?
        .map_err(|error| {
            AppError::Ai(format!(
                "MCP server '{}' [{}] tool '{}' failed: {error}",
                self.server.name,
                transport_label(&self.server.transport),
                tool_name
            ))
        })?;
        serde_json::to_string(&result).map_err(Into::into)
    }

    pub async fn close(&mut self) {
        let _ = self.client.close_with_timeout(Duration::from_secs(2)).await;
    }
}

impl Drop for McpTaskClient {
    fn drop(&mut self) {
        self.client.cancellation_token().cancel();
    }
}

#[derive(Clone)]
pub struct McpToolDefinition {
    pub internal_name: String,
    pub server_id: String,
    pub original_name: String,
    pub description: String,
    pub input_schema: Value,
}

pub async fn list_tools(server: &McpServerConfig) -> Result<Vec<McpToolDefinition>, AppError> {
    let mut client = McpTaskClient::start(server).await?;
    let result = client.list_tools().await;
    client.close().await;
    result
}

pub async fn list_tool_info(server: &McpServerConfig) -> Result<Vec<McpToolInfo>, AppError> {
    Ok(list_tools(server)
        .await?
        .into_iter()
        .map(|tool| McpToolInfo {
            server_id: server.id.clone(),
            server_name: server.name.clone(),
            transport: transport_label(&server.transport).to_owned(),
            name: tool.original_name,
            description: tool.description,
            input_schema: tool.input_schema,
        })
        .collect())
}

pub async fn call_tool(
    server: &McpServerConfig,
    tool_name: &str,
    arguments: Value,
) -> Result<String, AppError> {
    let mut client = McpTaskClient::start(server).await?;
    let result = client.call_tool(tool_name, arguments).await;
    client.close().await;
    result
}

async fn connect(server: &McpServerConfig) -> Result<RunningClient, AppError> {
    match server.transport {
        McpTransportKind::Stdio => connect_stdio(server).await,
        McpTransportKind::StreamableHttp => connect_streamable_http(server).await,
    }
}

async fn connect_stdio(server: &McpServerConfig) -> Result<RunningClient, AppError> {
    if server.command.trim().is_empty() {
        return Err(AppError::InvalidInput(format!(
            "MCP server '{}' uses stdio transport but command is empty",
            server.name
        )));
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
    let transport = TokioChildProcess::new(command).map_err(|error| {
        AppError::Ai(format!(
            "MCP server '{}' stdio process failed to start: {error}",
            server.name
        ))
    })?;
    tokio::time::timeout(Duration::from_secs(15), ().serve(transport))
        .await
        .map_err(|_| {
            AppError::Ai(format!(
                "MCP server '{}' stdio initialization timed out",
                server.name
            ))
        })?
        .map_err(|error| {
            AppError::Ai(format!(
                "MCP server '{}' stdio initialization failed: {error}",
                server.name
            ))
        })
}

async fn connect_streamable_http(server: &McpServerConfig) -> Result<RunningClient, AppError> {
    let url = server
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput(format!(
                "MCP server '{}' uses streamable_http transport but url is empty",
                server.name
            ))
        })?;
    let parsed = reqwest::Url::parse(url).map_err(|error| {
        AppError::InvalidInput(format!(
            "MCP server '{}' has invalid streamable_http url '{}': {error}",
            server.name, url
        ))
    })?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(AppError::InvalidInput(format!(
            "MCP server '{}' streamable_http url must use http or https and include a host: {}",
            server.name, parsed
        )));
    }

    let headers = custom_headers(server)?;
    let config = StreamableHttpClientTransportConfig::with_uri(parsed.to_string())
        .custom_headers(headers)
        .reinit_on_expired_session(true);
    let transport = StreamableHttpClientTransport::from_config(config);
    tokio::time::timeout(Duration::from_secs(15), ().serve(transport))
        .await
        .map_err(|_| {
            AppError::Ai(format!(
                "MCP server '{}' streamable_http initialization timed out at {}",
                server.name, parsed
            ))
        })?
        .map_err(|error| {
            AppError::Ai(format!(
                "MCP server '{}' streamable_http initialization failed at {}: {error}",
                server.name, parsed
            ))
        })
}

fn custom_headers(server: &McpServerConfig) -> Result<HashMap<HeaderName, HeaderValue>, AppError> {
    let mut headers = HashMap::new();
    for header in &server.headers {
        let name = header.name.trim();
        if name.is_empty() {
            continue;
        }
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
            AppError::InvalidInput(format!(
                "MCP server '{}' has invalid HTTP header name '{}': {error}",
                server.name, name
            ))
        })?;
        let header_value = HeaderValue::from_str(header.value.trim()).map_err(|error| {
            AppError::InvalidInput(format!(
                "MCP server '{}' has invalid HTTP header '{}': {error}",
                server.name, name
            ))
        })?;
        headers.insert(header_name, header_value);
    }
    Ok(headers)
}

fn transport_label(transport: &McpTransportKind) -> &'static str {
    match transport {
        McpTransportKind::Stdio => "stdio",
        McpTransportKind::StreamableHttp => "streamable_http",
    }
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
    use super::{custom_headers, tool_name};
    use crate::types::{McpHeader, McpServerConfig, McpTransportKind};
    use serde_json::json;

    #[test]
    fn mcp_tool_names_are_model_safe_and_namespaced() {
        assert_eq!(
            tool_name("git server", "status/list"),
            "mcp__git_server__status_list"
        );
    }

    #[test]
    fn streamable_http_headers_accept_bearer_values() {
        let server = McpServerConfig {
            id: "server".to_owned(),
            name: "HTTP MCP".to_owned(),
            transport: McpTransportKind::StreamableHttp,
            command: String::new(),
            args: Vec::new(),
            cwd: None,
            url: Some("https://mcp.example.test/mcp".to_owned()),
            headers: vec![McpHeader {
                name: "Authorization".to_owned(),
                value: "Bearer sk-test".to_owned(),
            }],
            enabled: true,
        };
        let headers = custom_headers(&server).expect("headers should parse");
        assert_eq!(headers.len(), 1);
        assert_eq!(headers.get("authorization").unwrap(), "Bearer sk-test");
    }

    #[test]
    fn streamable_http_headers_reject_invalid_names() {
        let server = McpServerConfig {
            id: "server".to_owned(),
            name: "HTTP MCP".to_owned(),
            transport: McpTransportKind::StreamableHttp,
            command: String::new(),
            args: Vec::new(),
            cwd: None,
            url: Some("https://mcp.example.test/mcp".to_owned()),
            headers: vec![McpHeader {
                name: "not a header".to_owned(),
                value: "value".to_owned(),
            }],
            enabled: true,
        };
        let error = custom_headers(&server).expect_err("invalid header should fail");
        assert!(error.detail().contains("invalid HTTP header name"));
    }

    #[test]
    fn legacy_stdio_config_defaults_transport_specific_fields() {
        let server: McpServerConfig = serde_json::from_value(json!({
            "id": "legacy",
            "name": "Legacy MCP",
            "command": "npx",
            "args": ["-y", "server"],
            "cwd": null,
            "enabled": true
        }))
        .expect("legacy config should remain readable");
        assert!(matches!(server.transport, McpTransportKind::Stdio));
        assert!(server.url.is_none());
        assert!(server.headers.is_empty());
    }
}

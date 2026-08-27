use std::{collections::HashMap, time::Duration};

use http::{HeaderName, HeaderValue};
use rmcp::{
    model::{CallToolRequestParams, CallToolResult},
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
        TokioChildProcess,
    },
    ServiceExt,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::process::Command;

use crate::{
    agent::capability::CapabilityDescriptor,
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

    pub async fn list_tools(&self) -> Result<Vec<CapabilityDescriptor>, AppError> {
        let tools = tokio::time::timeout(Duration::from_secs(15), self.client.list_all_tools())
            .await
            .map_err(|_| AppError::Mcp {
                code: "MCP_LIST_TOOLS_TIMEOUT",
                detail: format!(
                    "MCP server '{}' [{}] timed out while listing tools",
                    self.server.name,
                    transport_label(&self.server.transport)
                ),
            })?
            .map_err(|error| AppError::Mcp {
                code: "MCP_LIST_TOOLS_FAILED",
                detail: format!(
                    "MCP server '{}' [{}] failed to list tools: {error}",
                    self.server.name,
                    transport_label(&self.server.transport)
                ),
            })?;
        Ok(tools
            .into_iter()
            .map(|tool| CapabilityDescriptor {
                id: capability_id(&self.server.id, &tool.name),
                model_name: tool_name(&self.server.id, &tool.name),
                provider_kind: "mcp".to_owned(),
                provider_id: self.server.id.clone(),
                provider_name: self.server.name.clone(),
                transport: transport_label(&self.server.transport).to_owned(),
                original_name: tool.name.into_owned(),
                title: tool.title,
                description: tool
                    .description
                    .map_or_else(String::new, |value| value.into_owned()),
                input_schema: Value::Object((*tool.input_schema).clone()),
                output_schema: tool
                    .output_schema
                    .map(|schema| Value::Object((*schema).clone())),
                annotations: tool
                    .annotations
                    .and_then(|annotations| serde_json::to_value(annotations).ok()),
            })
            .collect())
    }

    pub async fn call_tool(
        &self,
        tool: &CapabilityDescriptor,
        arguments: Value,
    ) -> Result<CallToolResult, AppError> {
        let arguments = arguments.as_object().cloned().ok_or_else(|| {
            AppError::InvalidInput("MCP tool arguments must be a JSON object".to_owned())
        })?;
        validate_schema(
            &tool.input_schema,
            &Value::Object(arguments.clone()),
            &format!("MCP capability '{}' input", tool.id),
        )?;
        let result = tokio::time::timeout(
            Duration::from_secs(60),
            self.client.call_tool(
                CallToolRequestParams::new(tool.original_name.clone()).with_arguments(arguments),
            ),
        )
        .await
        .map_err(|_| AppError::Mcp {
            code: "MCP_TOOL_TIMEOUT",
            detail: format!(
                "MCP server '{}' [{}] tool '{}' timed out",
                self.server.name,
                transport_label(&self.server.transport),
                tool.original_name
            ),
        })?
        .map_err(|error| AppError::Mcp {
            code: "MCP_TOOL_CALL_FAILED",
            detail: format!(
                "MCP server '{}' [{}] tool '{}' failed: {error}",
                self.server.name,
                transport_label(&self.server.transport),
                tool.original_name
            ),
        })?;
        if result.is_error != Some(true) {
            if let Some(output_schema) = tool.output_schema.as_ref() {
                let structured = result.structured_content.as_ref().ok_or_else(|| {
                    AppError::Agent(format!(
                        "MCP capability '{}' declares outputSchema but returned no structuredContent",
                        tool.id
                    ))
                })?;
                validate_schema(
                    output_schema,
                    structured,
                    &format!("MCP capability '{}' output", tool.id),
                )?;
            }
        }
        Ok(result)
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

pub type McpToolDefinition = CapabilityDescriptor;

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
            capability_id: tool.id,
            name: tool.original_name,
            title: tool.title,
            description: tool.description,
            input_schema: tool.input_schema,
            output_schema: tool.output_schema,
            annotations: tool.annotations,
        })
        .collect())
}

pub async fn call_tool(
    server: &McpServerConfig,
    tool_name: &str,
    arguments: Value,
) -> Result<String, AppError> {
    let mut client = McpTaskClient::start(server).await?;
    let tool = client
        .list_tools()
        .await?
        .into_iter()
        .find(|tool| tool.original_name == tool_name)
        .ok_or_else(|| AppError::NotFound(format!("MCP tool '{tool_name}'")))?;
    let result = client
        .call_tool(&tool, arguments)
        .await
        .and_then(|result| serde_json::to_string(&result).map_err(Into::into));
    client.close().await;
    result
}

fn validate_schema(schema: &Value, instance: &Value, label: &str) -> Result<(), AppError> {
    let validator = jsonschema::options()
        .offline()
        .build(schema)
        .map_err(|error| AppError::Agent(format!("{label} schema is invalid: {error}")))?;
    if let Err(error) = validator.validate(instance) {
        return Err(AppError::InvalidInput(format!(
            "{label} does not match its JSON Schema: {error}"
        )));
    }
    Ok(())
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
    let transport = TokioChildProcess::new(command).map_err(|error| AppError::Mcp {
        code: "MCP_STDIO_START_FAILED",
        detail: format!(
            "MCP server '{}' stdio process failed to start: {error}",
            server.name
        ),
    })?;
    tokio::time::timeout(Duration::from_secs(15), ().serve(transport))
        .await
        .map_err(|_| AppError::Mcp {
            code: "MCP_STDIO_INIT_TIMEOUT",
            detail: format!(
                "MCP server '{}' stdio initialization timed out",
                server.name
            ),
        })?
        .map_err(|error| AppError::Mcp {
            code: "MCP_STDIO_INIT_FAILED",
            detail: format!(
                "MCP server '{}' stdio initialization failed: {error}",
                server.name
            ),
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
        .map_err(|_| AppError::Mcp {
            code: "MCP_HTTP_INIT_TIMEOUT",
            detail: format!(
                "MCP server '{}' streamable_http initialization timed out at {}",
                server.name, parsed
            ),
        })?
        .map_err(|error| AppError::Mcp {
            code: "MCP_HTTP_INIT_FAILED",
            detail: format!(
                "MCP server '{}' streamable_http initialization failed at {}: {error}",
                server.name, parsed
            ),
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

pub(crate) fn transport_label(transport: &McpTransportKind) -> &'static str {
    match transport {
        McpTransportKind::Stdio => "stdio",
        McpTransportKind::StreamableHttp => "streamable_http",
    }
}

fn tool_name(server_id: &str, name: &str) -> String {
    const MAX_MODEL_TOOL_NAME_BYTES: usize = 64;
    const HASH_BYTES: usize = 4;
    let base = format!("mcp__{}__{}", sanitize(server_id), sanitize(name));
    let digest = Sha256::digest(format!("{server_id}\0{name}").as_bytes());
    let suffix = digest[..HASH_BYTES]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let prefix_limit = MAX_MODEL_TOOL_NAME_BYTES.saturating_sub(suffix.len() + 2);
    let prefix = &base[..base.len().min(prefix_limit)];
    format!("{prefix}__{suffix}")
}

fn capability_id(server_id: &str, name: &str) -> String {
    format!("mcp:{server_id}:{name}")
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
    use super::{custom_headers, tool_name, validate_schema};
    use crate::types::{McpHeader, McpServerConfig, McpTransportKind};
    use serde_json::json;

    #[test]
    fn mcp_tool_names_are_model_safe_and_namespaced() {
        let name = tool_name("git server", "status/list");
        assert!(name.starts_with("mcp__git_server__status_list__"));
        assert!(name.len() <= 64);
        assert_ne!(
            tool_name("git-server", "status/list"),
            tool_name("git_server", "status/list")
        );
    }

    #[test]
    fn capability_arguments_are_checked_against_the_discovered_schema() {
        let schema = json!({
            "type": "object",
            "required": ["product"],
            "properties": {
                "product": { "type": "string", "minLength": 1 }
            },
            "additionalProperties": false
        });
        validate_schema(&schema, &json!({"product":"array"}), "input").unwrap();
        let error = validate_schema(&schema, &json!({"unknown":true}), "input").unwrap_err();
        assert_eq!(error.code(), "invalid_input");
        assert!(error.detail().contains("does not match its JSON Schema"));
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
        assert_eq!(
            headers
                .get(&http::HeaderName::from_static("authorization"))
                .unwrap(),
            "Bearer sk-test"
        );
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

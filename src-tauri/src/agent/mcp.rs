use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use async_trait::async_trait;
use http::{HeaderName, HeaderValue};
use rmcp::{
    model::{
        CallToolRequestParams, CallToolResult, GetPromptRequestParams, ProgressNotificationParam,
        ReadResourceRequestParams,
    },
    service::NotificationContext,
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
        TokioChildProcess,
    },
    ClientHandler, RoleClient, ServiceExt,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::process::Command;
use tokio::sync::{Mutex, RwLock};

use crate::{
    agent::capability::{
        CapabilityDescriptor, CapabilityInvocationResult, CapabilityProgress,
        CapabilityProgressSink, CapabilityProvider, McpServerDiagnostic,
    },
    types::{McpServerConfig, McpToolInfo, McpTransportKind},
    AppError,
};

type RunningClient = rmcp::service::RunningService<rmcp::RoleClient, McpClientHandler>;

#[derive(Clone, Default)]
struct McpClientHandler {
    progress: Arc<RwLock<Option<CapabilityProgressSink>>>,
}

impl ClientHandler for McpClientHandler {
    async fn on_progress(
        &self,
        params: ProgressNotificationParam,
        _context: NotificationContext<RoleClient>,
    ) {
        if let Some(sink) = self.progress.read().await.clone() {
            sink(CapabilityProgress {
                progress: params.progress,
                total: params.total,
                message: params.message,
            });
        }
    }
}

const MCP_CATALOG_TTL: Duration = Duration::from_secs(5 * 60);
const MCP_IDLE_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_POOLED_MCP_SERVERS: usize = 16;

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
        let client = connect(server, McpClientHandler::default()).await?;
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
        progress: Option<CapabilityProgressSink>,
    ) -> Result<CallToolResult, AppError> {
        let arguments = arguments.as_object().cloned().ok_or_else(|| {
            AppError::InvalidInput("MCP tool arguments must be a JSON object".to_owned())
        })?;
        validate_schema(
            &tool.input_schema,
            &Value::Object(arguments.clone()),
            &format!("MCP capability '{}' input", tool.id),
        )?;
        *self.client.service().progress.write().await = progress;
        let result = tokio::time::timeout(
            Duration::from_secs(60),
            self.client.call_tool(
                CallToolRequestParams::new(tool.original_name.clone()).with_arguments(arguments),
            ),
        )
        .await;
        // Progress callbacks are scoped to one invocation. Clearing this on
        // every exit path prevents a pooled client from publishing a later
        // request's notifications into an earlier Turn.
        *self.client.service().progress.write().await = None;
        let result = result
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

    pub async fn list_resources(&self) -> Result<Value, AppError> {
        let resources =
            tokio::time::timeout(Duration::from_secs(15), self.client.list_all_resources())
                .await
                .map_err(|_| AppError::Mcp {
                    code: "MCP_LIST_RESOURCES_TIMEOUT",
                    detail: format!(
                        "MCP server '{}' timed out while listing resources",
                        self.server.name
                    ),
                })?
                .map_err(|error| AppError::Mcp {
                    code: "MCP_LIST_RESOURCES_FAILED",
                    detail: format!(
                        "MCP server '{}' failed to list resources: {error}",
                        self.server.name
                    ),
                })?;
        Ok(serde_json::to_value(resources)?)
    }

    pub async fn read_resource(&self, uri: &str) -> Result<Value, AppError> {
        let result = tokio::time::timeout(
            Duration::from_secs(60),
            self.client
                .read_resource(ReadResourceRequestParams::new(uri)),
        )
        .await
        .map_err(|_| AppError::Mcp {
            code: "MCP_READ_RESOURCE_TIMEOUT",
            detail: format!(
                "MCP server '{}' timed out while reading resource '{uri}'",
                self.server.name
            ),
        })?
        .map_err(|error| AppError::Mcp {
            code: "MCP_READ_RESOURCE_FAILED",
            detail: format!(
                "MCP server '{}' failed to read resource '{uri}': {error}",
                self.server.name
            ),
        })?;
        Ok(serde_json::to_value(result)?)
    }

    pub async fn list_prompts(&self) -> Result<Value, AppError> {
        let prompts = tokio::time::timeout(Duration::from_secs(15), self.client.list_all_prompts())
            .await
            .map_err(|_| AppError::Mcp {
                code: "MCP_LIST_PROMPTS_TIMEOUT",
                detail: format!(
                    "MCP server '{}' timed out while listing prompts",
                    self.server.name
                ),
            })?
            .map_err(|error| AppError::Mcp {
                code: "MCP_LIST_PROMPTS_FAILED",
                detail: format!(
                    "MCP server '{}' failed to list prompts: {error}",
                    self.server.name
                ),
            })?;
        Ok(serde_json::to_value(prompts)?)
    }

    pub async fn get_prompt(&self, name: &str, arguments: Value) -> Result<Value, AppError> {
        let arguments = arguments.as_object().cloned().ok_or_else(|| {
            AppError::InvalidInput("MCP prompt arguments must be a JSON object".to_owned())
        })?;
        let result = tokio::time::timeout(
            Duration::from_secs(60),
            self.client
                .get_prompt(GetPromptRequestParams::new(name).with_arguments(arguments)),
        )
        .await;
        *self.client.service().progress.write().await = None;
        let result = result
            .map_err(|_| AppError::Mcp {
                code: "MCP_GET_PROMPT_TIMEOUT",
                detail: format!(
                    "MCP server '{}' timed out while getting prompt '{name}'",
                    self.server.name
                ),
            })?
            .map_err(|error| AppError::Mcp {
                code: "MCP_GET_PROMPT_FAILED",
                detail: format!(
                    "MCP server '{}' failed to get prompt '{name}': {error}",
                    self.server.name
                ),
            })?;
        Ok(serde_json::to_value(result)?)
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

struct CachedCatalog {
    loaded_at: Instant,
    capabilities: Vec<CapabilityDescriptor>,
}

pub struct McpCapabilityProvider {
    server: McpServerConfig,
    client: Mutex<Option<McpTaskClient>>,
    catalog: RwLock<Option<CachedCatalog>>,
}

impl McpCapabilityProvider {
    fn new(server: McpServerConfig) -> Self {
        Self {
            server,
            client: Mutex::new(None),
            catalog: RwLock::new(None),
        }
    }

    async fn connect_locked<'a>(
        &'a self,
        slot: &'a mut Option<McpTaskClient>,
    ) -> Result<&'a McpTaskClient, AppError> {
        if slot.is_none() {
            *slot = Some(McpTaskClient::start(&self.server).await?);
        }
        Ok(slot.as_ref().expect("MCP client initialized"))
    }

    async fn reset_locked(&self, slot: &mut Option<McpTaskClient>) {
        if let Some(mut client) = slot.take() {
            client.close().await;
        }
    }

    async fn close(&self) {
        let mut slot = self.client.lock().await;
        self.reset_locked(&mut slot).await;
        *self.catalog.write().await = None;
    }

    async fn list_tools_uncached(&self) -> Result<Vec<CapabilityDescriptor>, AppError> {
        let mut slot = self.client.lock().await;
        let first = self.connect_locked(&mut slot).await?.list_tools().await;
        match first {
            Ok(tools) => Ok(tools),
            Err(first_error) => {
                tracing::warn!(
                    server_id = %self.server.id,
                    error_code = first_error.code(),
                    error = %first_error.detail(),
                    "MCP discovery failed; reconnecting once"
                );
                self.reset_locked(&mut slot).await;
                self.connect_locked(&mut slot)
                    .await?
                    .list_tools()
                    .await
                    .map_err(|retry_error| AppError::Mcp {
                        code: "MCP_RECONNECT_FAILED",
                        detail: format!(
                            "MCP server '{}' discovery failed before and after reconnect. First error: {}. Retry error: {}",
                            self.server.name,
                            first_error.detail(),
                            retry_error.detail()
                        ),
                    })
            }
        }
    }

    async fn read_operation(
        &self,
        operation: &'static str,
        request: impl Fn(
            &McpTaskClient,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Value, AppError>> + Send + '_>,
        >,
    ) -> Result<Value, AppError> {
        let mut slot = self.client.lock().await;
        let first = request(self.connect_locked(&mut slot).await?).await;
        match first {
            Ok(value) => Ok(value),
            Err(first_error) => {
                tracing::warn!(
                    server_id = %self.server.id,
                    operation,
                    error_code = first_error.code(),
                    error = %first_error.detail(),
                    "MCP read operation failed; reconnecting once"
                );
                self.reset_locked(&mut slot).await;
                request(self.connect_locked(&mut slot).await?).await.map_err(|retry_error| {
                    AppError::Mcp {
                        code: "MCP_RECONNECT_FAILED",
                        detail: format!(
                            "MCP server '{}' operation '{}' failed before and after reconnect. First error: {}. Retry error: {}",
                            self.server.name,
                            operation,
                            first_error.detail(),
                            retry_error.detail()
                        ),
                    }
                })
            }
        }
    }
}

#[async_trait]
impl CapabilityProvider for McpCapabilityProvider {
    fn id(&self) -> &str {
        &self.server.id
    }

    fn name(&self) -> &str {
        &self.server.name
    }

    fn kind(&self) -> &str {
        "mcp"
    }

    fn transport(&self) -> &str {
        transport_label(&self.server.transport)
    }

    async fn discover(&self, refresh: bool) -> Result<Vec<CapabilityDescriptor>, AppError> {
        if !refresh {
            let catalog = self.catalog.read().await;
            if let Some(cached) = catalog.as_ref() {
                if cached.loaded_at.elapsed() < MCP_CATALOG_TTL {
                    return Ok(cached.capabilities.clone());
                }
            }
        }
        let capabilities = self.list_tools_uncached().await?;
        *self.catalog.write().await = Some(CachedCatalog {
            loaded_at: Instant::now(),
            capabilities: capabilities.clone(),
        });
        Ok(capabilities)
    }

    async fn invoke(
        &self,
        capability: &CapabilityDescriptor,
        arguments: Value,
        progress: Option<CapabilityProgressSink>,
    ) -> Result<CapabilityInvocationResult, AppError> {
        let mut slot = self.client.lock().await;
        let result = self
            .connect_locked(&mut slot)
            .await?
            .call_tool(capability, arguments, progress)
            .await;
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                // Never replay an arbitrary MCP tool automatically: the
                // request may have reached the server before the transport
                // failed. Reset the pooled connection so the next explicit
                // invocation reconnects cleanly without duplicating effects.
                self.reset_locked(&mut slot).await;
                return Err(error);
            }
        };
        let raw = serde_json::to_value(&result)?;
        Ok(CapabilityInvocationResult {
            structured_content: result.structured_content,
            is_error: result.is_error.unwrap_or(false),
            raw,
        })
    }

    async fn list_resources(&self) -> Result<Value, AppError> {
        self.read_operation("resources/list", |client| {
            Box::pin(async move { client.list_resources().await })
        })
        .await
    }

    async fn read_resource(&self, uri: &str) -> Result<Value, AppError> {
        let uri = uri.to_owned();
        self.read_operation("resources/read", move |client| {
            let uri = uri.clone();
            Box::pin(async move { client.read_resource(&uri).await })
        })
        .await
    }

    async fn list_prompts(&self) -> Result<Value, AppError> {
        self.read_operation("prompts/list", |client| {
            Box::pin(async move { client.list_prompts().await })
        })
        .await
    }

    async fn get_prompt(&self, name: &str, arguments: Value) -> Result<Value, AppError> {
        let name = name.to_owned();
        self.read_operation("prompts/get", move |client| {
            let name = name.clone();
            let arguments = arguments.clone();
            Box::pin(async move { client.get_prompt(&name, arguments).await })
        })
        .await
    }
}

struct PoolEntry {
    fingerprint: String,
    provider: Arc<McpCapabilityProvider>,
    last_used: Instant,
}

#[derive(Default)]
pub struct McpConnectionManager {
    entries: Mutex<HashMap<String, PoolEntry>>,
}

pub struct PreparedMcpProviders {
    pub providers: HashMap<String, Arc<dyn CapabilityProvider>>,
    pub capabilities: Vec<CapabilityDescriptor>,
    pub diagnostics: Vec<McpServerDiagnostic>,
}

impl McpConnectionManager {
    pub async fn prepare(&self, servers: &[McpServerConfig]) -> PreparedMcpProviders {
        let now = Instant::now();
        let mut close_after_unlock = Vec::new();
        let mut selected = Vec::new();
        let mut diagnostics = Vec::new();
        {
            let mut entries = self.entries.lock().await;
            let stale_ids = entries
                .iter()
                .filter_map(|(id, entry)| {
                    (now.duration_since(entry.last_used) >= MCP_IDLE_TTL).then_some(id.clone())
                })
                .collect::<Vec<_>>();
            for id in stale_ids {
                if let Some(entry) = entries.remove(&id) {
                    close_after_unlock.push(entry.provider);
                }
            }
            for server in servers {
                let transport = transport_label(&server.transport).to_owned();
                if !server.enabled {
                    diagnostics.push(McpServerDiagnostic {
                        server_id: server.id.clone(),
                        server_name: server.name.clone(),
                        transport,
                        enabled: false,
                        status: "disabled".to_owned(),
                        tool_count: 0,
                        error_code: None,
                        error_detail: None,
                    });
                    continue;
                }
                let fingerprint = server_fingerprint(server);
                let replace = entries
                    .get(&server.id)
                    .is_some_and(|entry| entry.fingerprint != fingerprint);
                if replace {
                    if let Some(entry) = entries.remove(&server.id) {
                        close_after_unlock.push(entry.provider);
                    }
                }
                let entry = entries
                    .entry(server.id.clone())
                    .or_insert_with(|| PoolEntry {
                        fingerprint: fingerprint.clone(),
                        provider: Arc::new(McpCapabilityProvider::new(server.clone())),
                        last_used: now,
                    });
                entry.last_used = now;
                selected.push((server.clone(), entry.provider.clone()));
            }
            while entries.len() > MAX_POOLED_MCP_SERVERS {
                let Some(oldest) = entries
                    .iter()
                    .min_by_key(|(_, entry)| entry.last_used)
                    .map(|(id, _)| id.clone())
                else {
                    break;
                };
                if let Some(entry) = entries.remove(&oldest) {
                    close_after_unlock.push(entry.provider);
                }
            }
        }
        for provider in close_after_unlock {
            provider.close().await;
        }

        let mut providers: HashMap<String, Arc<dyn CapabilityProvider>> = HashMap::new();
        let mut capabilities = Vec::new();
        for (server, provider) in selected {
            match provider.discover(false).await {
                Ok(tools) => {
                    diagnostics.push(McpServerDiagnostic {
                        server_id: server.id.clone(),
                        server_name: server.name.clone(),
                        transport: transport_label(&server.transport).to_owned(),
                        enabled: true,
                        status: "ready".to_owned(),
                        tool_count: tools.len(),
                        error_code: None,
                        error_detail: None,
                    });
                    capabilities.extend(tools);
                    providers.insert(server.id, provider);
                }
                Err(error) => diagnostics.push(McpServerDiagnostic {
                    server_id: server.id,
                    server_name: server.name,
                    transport: transport_label(&server.transport).to_owned(),
                    enabled: true,
                    status: discovery_failure_status(&error).to_owned(),
                    tool_count: 0,
                    error_code: Some(error.code().to_owned()),
                    error_detail: Some(error.detail()),
                }),
            }
        }
        PreparedMcpProviders {
            providers,
            capabilities,
            diagnostics,
        }
    }

    pub async fn close_all(&self) {
        let providers = {
            let mut entries = self.entries.lock().await;
            entries
                .drain()
                .map(|(_, entry)| entry.provider)
                .collect::<Vec<_>>()
        };
        for provider in providers {
            provider.close().await;
        }
    }
}

fn discovery_failure_status(error: &AppError) -> &'static str {
    match error.code() {
        "invalid_input" | "config" => "configuration_failed",
        "MCP_STDIO_START_FAILED"
        | "MCP_STDIO_INIT_TIMEOUT"
        | "MCP_STDIO_INIT_FAILED"
        | "MCP_HTTP_INIT_TIMEOUT"
        | "MCP_HTTP_INIT_FAILED" => "connection_failed",
        _ => "tool_discovery_failed",
    }
}

fn server_fingerprint(server: &McpServerConfig) -> String {
    let bytes = serde_json::to_vec(server).unwrap_or_default();
    format!("{:x}", Sha256::digest(bytes))
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
        .call_tool(&tool, arguments, None)
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

async fn connect(
    server: &McpServerConfig,
    handler: McpClientHandler,
) -> Result<RunningClient, AppError> {
    match server.transport {
        McpTransportKind::Stdio => connect_stdio(server, handler).await,
        McpTransportKind::StreamableHttp => connect_streamable_http(server, handler).await,
    }
}

async fn connect_stdio(
    server: &McpServerConfig,
    handler: McpClientHandler,
) -> Result<RunningClient, AppError> {
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
    tokio::time::timeout(Duration::from_secs(15), handler.serve(transport))
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

async fn connect_streamable_http(
    server: &McpServerConfig,
    handler: McpClientHandler,
) -> Result<RunningClient, AppError> {
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
    tokio::time::timeout(Duration::from_secs(15), handler.serve(transport))
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
    use super::{custom_headers, discovery_failure_status, tool_name, validate_schema};
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
    fn discovery_diagnostics_distinguish_configuration_connection_and_catalog_failures() {
        assert_eq!(
            discovery_failure_status(&crate::AppError::InvalidInput("bad url".to_owned())),
            "configuration_failed"
        );
        assert_eq!(
            discovery_failure_status(&crate::AppError::Mcp {
                code: "MCP_HTTP_INIT_FAILED",
                detail: "connection refused".to_owned(),
            }),
            "connection_failed"
        );
        assert_eq!(
            discovery_failure_status(&crate::AppError::Mcp {
                code: "MCP_LIST_TOOLS_FAILED",
                detail: "invalid response".to_owned(),
            }),
            "tool_discovery_failed"
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

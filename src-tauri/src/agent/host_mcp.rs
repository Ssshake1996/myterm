use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    extract::State,
    http::{header::AUTHORIZATION, Request, StatusCode},
    middleware::{self, Next},
    response::Response,
    Router,
};
use rmcp::{
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
        ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    RoleServer, ServerHandler,
};
use serde_json::{json, Map, Value};
use tokio::{sync::watch, task::JoinHandle};
use tokio_util::sync::CancellationToken;

use super::{
    capability::{
        CapabilityDescriptor, CapabilityProvider, CapabilityRegistry, McpServerDiagnostic,
    },
    policy::{self, PolicyAction},
    service::{self, AgentEventSink, AgentService},
};
use crate::{types::AgentSettings, AppError};

const MCP_PATH_PREFIX: &str = "/mcp/";
const OMITTED_HOST_TOOLS: &[&str] = &["goal_update", "skill_load", "evidence_read"];

#[derive(Clone)]
pub(crate) struct HostMcpContext {
    pub service: Arc<AgentService>,
    pub run_id: String,
    pub active_session_id: Option<String>,
    pub settings: AgentSettings,
    pub registry: Arc<CapabilityRegistry>,
    pub providers: Arc<HashMap<String, Arc<dyn CapabilityProvider>>>,
    pub diagnostics: Arc<Vec<McpServerDiagnostic>>,
    pub sink: Arc<dyn AgentEventSink>,
    pub continuation_sink: Arc<dyn AgentEventSink>,
    pub abort: watch::Receiver<bool>,
}

pub(crate) struct HostMcpBridge {
    pub url: String,
    pub bearer: String,
    cancellation: CancellationToken,
    server: JoinHandle<()>,
}

impl HostMcpBridge {
    pub async fn start(context: HostMcpContext) -> Result<Self, AppError> {
        let cancellation = CancellationToken::new();
        let bearer = format!("myterm-{}", uuid::Uuid::new_v4().simple());
        let path_token = uuid::Uuid::new_v4().simple().to_string();
        let route = format!("{MCP_PATH_PREFIX}{path_token}");
        let handler = HostMcpHandler::new(context)?;
        let service: StreamableHttpService<HostMcpHandler, LocalSessionManager> =
            StreamableHttpService::new(
                move || Ok(handler.clone()),
                Default::default(),
                StreamableHttpServerConfig::default()
                    .with_sse_keep_alive(None)
                    .with_cancellation_token(cancellation.child_token()),
            );
        let auth = AuthState {
            expected: format!("Bearer {bearer}"),
        };
        let router = Router::new()
            .nest_service(&route, service)
            .route_layer(middleware::from_fn_with_state(auth, require_bearer));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let stop = cancellation.clone();
        let server = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(async move { stop.cancelled_owned().await })
                .await
            {
                tracing::error!(
                    event = "agent_host_mcp_server_failed",
                    error = %error,
                    "myterm Host MCP server stopped unexpectedly"
                );
            }
        });
        tracing::info!(
            event = "agent_host_mcp_started",
            address = %address,
            "myterm Host MCP bridge started"
        );
        Ok(Self {
            url: format!("http://{address}{route}"),
            bearer,
            cancellation,
            server,
        })
    }

    pub async fn close(self) {
        self.cancellation.cancel();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), self.server).await;
    }
}

#[derive(Clone)]
struct AuthState {
    expected: String,
}

async fn require_bearer(
    State(state): State<AuthState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let authorized = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == state.expected);
    if !authorized {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(next.run(request).await)
}

#[derive(Clone)]
struct HostMcpHandler {
    context: HostMcpContext,
    tools: Arc<Vec<Tool>>,
}

impl HostMcpHandler {
    fn new(context: HostMcpContext) -> Result<Self, AppError> {
        let mut tools = service::tool_definitions(context.registry.as_ref(), "")
            .into_iter()
            .map(restrict_host_tool_definition)
            .filter_map(tool_from_capability_definition)
            .filter(|tool| !OMITTED_HOST_TOOLS.contains(&tool.name.as_ref()))
            .collect::<Vec<_>>();
        for capability in context.registry.entries() {
            if tools.iter().any(|tool| tool.name == capability.model_name) {
                continue;
            }
            tools.push(tool_from_capability(capability)?);
        }
        Ok(Self {
            context,
            tools: Arc::new(tools),
        })
    }

    async fn execute(&self, name: &str, arguments: Value) -> Result<String, AppError> {
        match name {
            "mcp_status" => {
                let query = arguments
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let servers = self
                    .context
                    .diagnostics
                    .iter()
                    .filter(|server| server.matches_query(query))
                    .collect::<Vec<_>>();
                Ok(serde_json::to_string(&json!({
                    "query": query,
                    "configuredCount": self.context.diagnostics.len(),
                    "readyCount": self.context.diagnostics.iter().filter(|server| server.status == "ready").count(),
                    "failedCount": self.context.diagnostics.iter().filter(|server| server.error_detail.is_some()).count(),
                    "servers": servers,
                }))?)
            }
            "capability_search" => {
                let query = service::argument_str(&arguments, "query")?;
                let limit = arguments.get("limit").and_then(Value::as_u64).unwrap_or(8) as usize;
                let capabilities = self
                    .context
                    .registry
                    .search(query, limit)
                    .into_iter()
                    .map(CapabilityDescriptor::summary)
                    .collect::<Vec<_>>();
                Ok(serde_json::to_string(&json!({
                    "query": query,
                    "matchCount": capabilities.len(),
                    "capabilities": capabilities,
                }))?)
            }
            "capability_invoke" => {
                let id = service::argument_str(&arguments, "capability_id")?;
                let call_arguments = arguments
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                self.invoke_capability(id, call_arguments).await
            }
            "capability_invoke_batch" => self.invoke_capability_batch(&arguments).await,
            "capability_resource_list" => {
                self.provider_values(
                    arguments.get("provider_id").and_then(Value::as_str),
                    "resources",
                )
                .await
            }
            "capability_resource_read" => {
                let provider = self.provider(service::argument_str(&arguments, "provider_id")?)?;
                let uri = service::argument_str(&arguments, "uri")?;
                Ok(serde_json::to_string(&provider.read_resource(uri).await?)?)
            }
            "capability_prompt_list" => {
                self.provider_values(
                    arguments.get("provider_id").and_then(Value::as_str),
                    "prompts",
                )
                .await
            }
            "capability_prompt_get" => {
                let provider = self.provider(service::argument_str(&arguments, "provider_id")?)?;
                let prompt = service::argument_str(&arguments, "name")?;
                let prompt_arguments = arguments
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                Ok(serde_json::to_string(
                    &provider.get_prompt(prompt, prompt_arguments).await?,
                )?)
            }
            "list_directory"
                if arguments.get("scope").and_then(Value::as_str) != Some("remote") =>
            {
                Err(AppError::InvalidInput(
                    "myterm Host MCP list_directory only accepts scope='remote'; use Harness local file tools for the local computer"
                        .to_owned(),
                ))
            }
            other => {
                if let Some(capability) = self.context.registry.find_by_model_name(other) {
                    return self.invoke_capability(&capability.id, arguments).await;
                }
                self.context
                    .service
                    .execute_builtin_tool(
                        &self.context.run_id,
                        &format!("mcp-{}", uuid::Uuid::new_v4().simple()),
                        other,
                        arguments,
                        self.context.active_session_id.as_deref(),
                        &self.context.settings,
                        self.context.sink.clone(),
                        self.context.continuation_sink.clone(),
                        self.context.abort.clone(),
                    )
                    .await
            }
        }
    }

    async fn invoke_capability(&self, id: &str, arguments: Value) -> Result<String, AppError> {
        let capability = self
            .context
            .registry
            .find_by_id(id)
            .ok_or_else(|| AppError::NotFound(format!("capability '{id}'")))?;
        let provider = self.provider(&capability.provider_id)?;
        let result = provider.invoke(capability, arguments, None).await?;
        let packet = json!({
            "capability": capability.summary(),
            "isError": result.is_error,
            "structuredContent": result.structured_content,
            "raw": result.raw,
        });
        if result.is_error {
            return Err(AppError::Mcp {
                code: "MCP_TOOL_ERROR",
                detail: serde_json::to_string(&packet)?,
            });
        }
        Ok(serde_json::to_string(&packet)?)
    }

    async fn invoke_capability_batch(&self, arguments: &Value) -> Result<String, AppError> {
        let calls = arguments
            .get("calls")
            .and_then(Value::as_array)
            .ok_or_else(|| AppError::InvalidInput("calls must be an array".to_owned()))?;
        let mut results = Vec::with_capacity(calls.len());
        for call in calls.iter().take(8) {
            let id = service::argument_str(call, "capability_id")?;
            let call_arguments = call.get("arguments").cloned().unwrap_or_else(|| json!({}));
            match self.invoke_capability(id, call_arguments).await {
                Ok(value) => results.push(json!({"capabilityId": id, "result": value})),
                Err(error) => results.push(json!({
                    "capabilityId": id,
                    "errorCode": error.code(),
                    "error": error.detail(),
                })),
            }
        }
        Ok(serde_json::to_string(&json!({"results": results}))?)
    }

    async fn provider_values(
        &self,
        provider_id: Option<&str>,
        kind: &str,
    ) -> Result<String, AppError> {
        let providers = match provider_id.filter(|value| !value.trim().is_empty()) {
            Some(id) => vec![self.provider(id)?],
            None => self.context.providers.values().cloned().collect(),
        };
        let mut results = Vec::with_capacity(providers.len());
        for provider in providers {
            let value = match kind {
                "resources" => provider.list_resources().await,
                "prompts" => provider.list_prompts().await,
                _ => unreachable!("known provider collection"),
            };
            results.push(match value {
                Ok(items) => json!({
                    "providerId": provider.id(),
                    "providerName": provider.name(),
                    "status": "success",
                    "items": items,
                }),
                Err(error) => json!({
                    "providerId": provider.id(),
                    "providerName": provider.name(),
                    "status": "error",
                    "errorCode": error.code(),
                    "error": error.detail(),
                }),
            });
        }
        Ok(serde_json::to_string(&json!({
            "kind": kind,
            "providers": results,
        }))?)
    }

    fn provider(&self, id: &str) -> Result<Arc<dyn CapabilityProvider>, AppError> {
        self.context
            .providers
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("capability provider '{id}'")))
    }

    async fn authorize(
        &self,
        call_id: &str,
        name: &str,
        arguments: &Value,
    ) -> Result<(), AppError> {
        let targeted_session_id = arguments
            .get("session_id")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                arguments
                    .get("use_active_session")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    .then_some(self.context.active_session_id.as_deref())
                    .flatten()
            });
        let policy_context = self
            .context
            .service
            .policy_context(targeted_session_id, self.context.settings.permission_mode)?;
        let decision = policy::evaluate_tool(name, arguments, policy_context);
        let mut policy_event = service::event(
            &self.context.run_id,
            "policy",
            Some(decision.reason.clone()),
        );
        policy_event.call_id = Some(call_id.to_owned());
        policy_event.tool_name = Some(name.to_owned());
        policy_event.plugin_id = Some(service::plugin_id_for_tool(name).to_owned());
        policy_event.arguments = Some(serde_json::to_value(&decision)?);
        let _ = self.context.sink.send(policy_event);
        let approved = match decision.action {
            PolicyAction::Allow => true,
            PolicyAction::Deny => false,
            PolicyAction::Ask => {
                let mut abort = self.context.abort.clone();
                self.context
                    .service
                    .wait_for_approval(
                        &self.context.run_id,
                        call_id,
                        name,
                        json!({"toolArguments": arguments, "policy": decision}),
                        self.context.sink.clone(),
                        &mut abort,
                    )
                    .await?
            }
        };
        if approved {
            Ok(())
        } else {
            Err(AppError::Agent(format!(
                "tool '{name}' was denied by the active permission policy"
            )))
        }
    }
}

impl ServerHandler for HostMcpHandler {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new("myterm-host-mcp", env!("CARGO_PKG_VERSION"))
                    .with_title("myterm SSH Host Tools")
                    .with_description("Controlled SSH, CLI, SFTP and external MCP tools"),
            )
            .with_instructions(
                "Local computer operations use Harness local tools. Remote SSH/CLI/SFTP operations must use these myterm tools with an explicit session target when more than one session exists.",
            )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, rmcp::ErrorData> {
        Ok(ListToolsResult::with_all_items((*self.tools).clone()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, rmcp::ErrorData> {
        let name = request.name.into_owned();
        let arguments = Value::Object(request.arguments.unwrap_or_default());
        let call_id = format!("mcp-{}", uuid::Uuid::new_v4().simple());
        let result = match self.authorize(&call_id, &name, &arguments).await {
            Ok(()) => self.execute(&name, arguments).await,
            Err(error) => Err(error),
        };
        Ok(match result {
            Ok(content) => CallToolResult::success(vec![ContentBlock::text(content)]),
            Err(error) => CallToolResult::error(vec![ContentBlock::text(
                json!({
                    "errorCode": error.code(),
                    "error": error.detail(),
                })
                .to_string(),
            )]),
        }
        .into())
    }
}

fn restrict_host_tool_definition(mut value: Value) -> Value {
    let Some(function) = value.get_mut("function").and_then(Value::as_object_mut) else {
        return value;
    };
    if function.get("name").and_then(Value::as_str) != Some("list_directory") {
        return value;
    }
    function.insert(
        "description".to_owned(),
        Value::String(
            "List a remote SSH directory through SFTP. Local computer directories must use Harness local file tools."
                .to_owned(),
        ),
    );
    if let Some(scope) = function
        .get_mut("parameters")
        .and_then(Value::as_object_mut)
        .and_then(|parameters| parameters.get_mut("properties"))
        .and_then(Value::as_object_mut)
        .and_then(|properties| properties.get_mut("scope"))
        .and_then(Value::as_object_mut)
    {
        scope.insert("enum".to_owned(), json!(["remote"]));
    }
    value
}

fn tool_from_capability_definition(value: Value) -> Option<Tool> {
    let function = value.get("function")?;
    let name = function.get("name")?.as_str()?.to_owned();
    let description = function
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let schema = function
        .get("parameters")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(empty_object_schema);
    Some(Tool::new(name, description, Arc::new(schema)))
}

fn tool_from_capability(capability: &CapabilityDescriptor) -> Result<Tool, AppError> {
    let schema = capability
        .input_schema
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::Mcp {
            code: "MCP_TOOL_SCHEMA_INVALID",
            detail: format!(
                "capability '{}' input schema is not a JSON object",
                capability.id
            ),
        })?;
    Ok(Tool::new(
        capability.model_name.clone(),
        format!(
            "{} [provider={}, capabilityId={}]",
            capability.description, capability.provider_name, capability.id
        ),
        Arc::new(schema),
    ))
}

fn empty_object_schema() -> Map<String, Value> {
    json!({"type": "object", "properties": {}})
        .as_object()
        .cloned()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::restrict_host_tool_definition;

    #[test]
    fn host_directory_tool_exposes_only_remote_scope() {
        let definition = restrict_host_tool_definition(json!({
            "function": {
                "name": "list_directory",
                "description": "List local or remote",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "scope": {"type": "string", "enum": ["local", "remote"]}
                    }
                }
            }
        }));
        assert_eq!(
            definition["function"]["parameters"]["properties"]["scope"]["enum"],
            json!(["remote"])
        );
        assert!(definition["function"]["description"]
            .as_str()
            .is_some_and(|description| description.contains("Harness local file tools")));
    }
}

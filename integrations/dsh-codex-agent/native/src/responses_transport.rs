use std::time::Duration;

use async_trait::async_trait;
use reqwest::{
    Client, StatusCode,
    header::{AUTHORIZATION, HeaderValue},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::{
    error::CoreError,
    model_transport::{DeltaSink, ModelTransport},
    types::{
        ChatMessage, MessageRole, ModelRequest, ModelResponse, ProviderContextMode,
        ProviderContextUpdate, TokenUsage, ToolCall,
    },
};

pub struct ResponsesTransport {
    client: Client,
    endpoint: Url,
    authorization: HeaderValue,
    model: String,
    provider_id: String,
}

impl ResponsesTransport {
    pub fn new(
        base_url: &str,
        api_key: String,
        model: String,
        provider_id: String,
        timeout: Duration,
    ) -> Result<Self, CoreError> {
        if api_key.is_empty() {
            return Err(CoreError::Configuration(
                "the injected API key must not be empty".to_owned(),
            ));
        }
        Self::new_with_authorization(
            base_url,
            format!("Bearer {api_key}"),
            model,
            provider_id,
            timeout,
        )
    }

    pub fn new_with_authorization(
        base_url: &str,
        authorization: String,
        model: String,
        provider_id: String,
        timeout: Duration,
    ) -> Result<Self, CoreError> {
        let authorization = HeaderValue::from_str(&authorization).map_err(|error| {
            CoreError::Configuration(format!("invalid Authorization header: {error}"))
        })?;
        let endpoint = responses_url(base_url)?;
        let client = Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|error| CoreError::Configuration(format!("HTTP client: {error}")))?;
        Ok(Self {
            client,
            endpoint,
            authorization,
            model,
            provider_id,
        })
    }

    fn request_body(&self, request: &ModelRequest) -> Result<Value, CoreError> {
        let checkpoint = request
            .provider_contexts
            .iter()
            .find(|context| context.provider_id == self.provider_id);
        let previous_response_id = checkpoint.and_then(|context| context.cursor.as_deref());
        let input = if let Some(context) = checkpoint.filter(|context| context.cursor.is_some()) {
            request
                .sequenced_messages
                .iter()
                .filter(|item| item.seq > context.through_seq)
                .map(|item| &item.message)
                .collect::<Vec<_>>()
        } else {
            request.messages.iter().collect::<Vec<_>>()
        };
        let instructions = if previous_response_id.is_some() {
            request.system_prompt.clone()
        } else {
            input
                .iter()
                .filter(|message| message.role == MessageRole::System)
                .filter_map(|message| message.content.as_deref())
                .collect::<Vec<_>>()
                .join("\n\n")
        };
        let mut body = json!({
            "model": self.model,
            "input": response_input_items(&input),
            "tools": request.tools.iter().map(|tool| json!({
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
                "strict": false,
            })).collect::<Vec<_>>(),
            "store": true,
            "stream": false,
            "context_management": [{
                "type": "compaction",
                "compact_threshold": request.compact_threshold_tokens,
            }],
        });
        let object = body
            .as_object_mut()
            .expect("Responses request must remain an object");
        if !instructions.is_empty() {
            object.insert("instructions".to_owned(), Value::String(instructions));
        }
        if let Some(previous_response_id) = previous_response_id {
            object.insert(
                "previous_response_id".to_owned(),
                Value::String(previous_response_id.to_owned()),
            );
        }
        Ok(body)
    }
}

#[async_trait]
impl ModelTransport for ResponsesTransport {
    async fn stream(
        &self,
        request: ModelRequest,
        cancellation: CancellationToken,
        on_text_delta: Option<DeltaSink>,
    ) -> Result<ModelResponse, CoreError> {
        let body = self.request_body(&request)?;
        let response = tokio::select! {
            _ = cancellation.cancelled() => {
                return Err(CoreError::Cancelled("cancelled before Responses API headers".to_owned()));
            }
            response = self.client
                .post(self.endpoint.clone())
                .header(AUTHORIZATION, self.authorization.clone())
                .json(&body)
                .send() => response.map_err(|error| request_error("responses_send", error))?,
        };
        let status = response.status();
        let payload = response
            .text()
            .await
            .map_err(|error| request_error("responses_body", error))?;
        if !status.is_success() {
            return Err(http_status_error(status, payload));
        }
        let wire: ResponsesWireResponse =
            serde_json::from_str(&payload).map_err(|error| CoreError::Model {
                phase: "responses_decode",
                code: "DECODE".to_owned(),
                status: Some(status.as_u16()),
                detail: error.to_string(),
                response_body: Some(payload.clone()),
            })?;
        if let Some(error) = wire.error {
            return Err(CoreError::Model {
                phase: "responses_error",
                code: error.code.unwrap_or_else(|| "RESPONSES_ERROR".to_owned()),
                status: Some(status.as_u16()),
                detail: error.message,
                response_body: Some(payload),
            });
        }
        let mut text = String::new();
        let mut tool_calls = Vec::new();
        for item in wire.output {
            match item.kind.as_str() {
                "message" => {
                    for content in item.content {
                        if matches!(content.kind.as_str(), "output_text" | "text") {
                            if let Some(value) = content.text {
                                text.push_str(&value);
                            }
                        }
                    }
                }
                "function_call" => {
                    let call_id = item.call_id.or(item.id).unwrap_or_default();
                    let name = item.name.unwrap_or_default();
                    if call_id.is_empty() || name.is_empty() {
                        return Err(CoreError::Model {
                            phase: "responses_decode",
                            code: "INVALID_FUNCTION_CALL".to_owned(),
                            status: Some(status.as_u16()),
                            detail: "Responses function_call is missing call_id or name".to_owned(),
                            response_body: Some(payload),
                        });
                    }
                    tool_calls.push(ToolCall {
                        index: tool_calls.len(),
                        id: call_id,
                        name,
                        arguments: item.arguments.unwrap_or_else(|| "{}".to_owned()),
                    });
                }
                _ => {}
            }
        }
        if text.is_empty() && tool_calls.is_empty() {
            return Err(CoreError::EmptyResponse);
        }
        if let Some(sink) = on_text_delta {
            if !text.is_empty() {
                sink(text.clone());
            }
        }
        let usage = wire.usage.map(|usage| TokenUsage {
            prompt_tokens: usage.input_tokens,
            completion_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
        });
        Ok(ModelResponse {
            text,
            finish_reason: if tool_calls.is_empty() {
                wire.status.unwrap_or_else(|| "stop".to_owned())
            } else {
                "tool_calls".to_owned()
            },
            tool_calls,
            usage,
            provider_context: Some(ProviderContextUpdate {
                provider_id: self.provider_id.clone(),
                mode: ProviderContextMode::Responses,
                cursor: Some(wire.id),
                unsupported: false,
            }),
        })
    }
}

pub fn responses_url(base_url: &str) -> Result<Url, CoreError> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let target = if trimmed.ends_with("/responses") {
        trimmed.to_owned()
    } else if trimmed.ends_with("/v1") {
        format!("{trimmed}/responses")
    } else {
        format!("{trimmed}/v1/responses")
    };
    Url::parse(&target)
        .map_err(|error| CoreError::Configuration(format!("invalid baseUrl {base_url:?}: {error}")))
}

fn response_input_items(messages: &[&ChatMessage]) -> Vec<Value> {
    let mut items = Vec::new();
    for message in messages {
        match message.role {
            MessageRole::System => {}
            MessageRole::User | MessageRole::Assistant => {
                if let Some(content) = message.content.as_deref().filter(|value| !value.is_empty())
                {
                    items.push(json!({
                        "role": if message.role == MessageRole::User { "user" } else { "assistant" },
                        "content": content,
                    }));
                }
                for call in &message.tool_calls {
                    items.push(json!({
                        "type": "function_call",
                        "call_id": call.id,
                        "name": call.name,
                        "arguments": call.arguments,
                    }));
                }
            }
            MessageRole::Tool => {
                if let Some(call_id) = &message.tool_call_id {
                    items.push(json!({
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": message.content.as_deref().unwrap_or_default(),
                    }));
                }
            }
        }
    }
    items
}

fn request_error(phase: &'static str, error: reqwest::Error) -> CoreError {
    let code = if error.is_timeout() {
        "TIMEOUT"
    } else if error.is_connect() {
        "CONNECT"
    } else if error.is_decode() {
        "DECODE"
    } else {
        "HTTP_CLIENT"
    };
    CoreError::Model {
        phase,
        code: code.to_owned(),
        status: error.status().map(|status| status.as_u16()),
        detail: error.to_string(),
        response_body: None,
    }
}

fn http_status_error(status: StatusCode, body: String) -> CoreError {
    CoreError::Model {
        phase: "responses_status",
        code: format!("HTTP_{}", status.as_u16()),
        status: Some(status.as_u16()),
        detail: format!("Responses endpoint returned HTTP {}", status.as_u16()),
        response_body: Some(body),
    }
}

#[derive(Debug, Deserialize)]
struct ResponsesWireResponse {
    id: String,
    status: Option<String>,
    #[serde(default)]
    output: Vec<ResponseOutputItem>,
    usage: Option<ResponsesUsage>,
    error: Option<ResponsesError>,
}

#[derive(Debug, Deserialize)]
struct ResponseOutputItem {
    #[serde(rename = "type")]
    kind: String,
    id: Option<String>,
    call_id: Option<String>,
    name: Option<String>,
    arguments: Option<String>,
    #[serde(default)]
    content: Vec<ResponseContent>,
}

#[derive(Debug, Deserialize)]
struct ResponseContent {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResponsesUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    total_tokens: u64,
}

#[derive(Debug, Deserialize)]
struct ResponsesError {
    message: String,
    code: Option<String>,
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{Json, Router, extract::State, routing::post};

    use super::*;
    use crate::types::{ProviderContext, ProviderContextMode, SequencedMessage, ToolDefinition};

    #[derive(Clone, Default)]
    struct CapturedRequests(Arc<Mutex<Vec<Value>>>);

    async fn responses_handler(
        State(captured): State<CapturedRequests>,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        let mut requests = captured.0.lock().unwrap();
        requests.push(body);
        let number = requests.len();
        Json(json!({
            "id": format!("resp_{number}"),
            "status": "completed",
            "output": [{
                "type": "message",
                "role": "assistant",
                "content": [{ "type": "output_text", "text": format!("answer-{number}") }]
            }],
            "usage": {
                "input_tokens": 5,
                "output_tokens": 2,
                "total_tokens": 7
            }
        }))
    }

    #[test]
    fn builds_responses_endpoint_for_supported_base_shapes() {
        assert_eq!(
            responses_url("https://llm.internal").unwrap().as_str(),
            "https://llm.internal/v1/responses"
        );
        assert_eq!(
            responses_url("https://llm.internal/v1/").unwrap().as_str(),
            "https://llm.internal/v1/responses"
        );
    }

    #[test]
    fn incremental_input_preserves_cli_whitespace() {
        let messages = vec![ChatMessage::text(
            MessageRole::User,
            "补齐命令时必须保留 show 后面的空格",
        )];
        let refs = messages.iter().collect::<Vec<_>>();
        let items = response_input_items(&refs);
        assert_eq!(items[0]["content"], "补齐命令时必须保留 show 后面的空格");
    }

    #[test]
    fn accepts_a_raw_authorization_value_for_api_key_gateways() {
        let transport = ResponsesTransport::new_with_authorization(
            "https://gateway.example/v1",
            "sk-raw-test".to_owned(),
            "model".to_owned(),
            "provider".to_owned(),
            Duration::from_secs(1),
        )
        .unwrap();
        assert_eq!(transport.authorization.to_str().unwrap(), "sk-raw-test");
    }

    #[tokio::test]
    async fn reuses_previous_response_and_sends_only_new_local_messages() {
        let captured = CapturedRequests::default();
        let app = Router::new()
            .route("/v1/responses", post(responses_handler))
            .with_state(captured.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let transport = ResponsesTransport::new(
            &format!("http://{address}"),
            "sk-test".to_owned(),
            "test-model".to_owned(),
            "provider-1".to_owned(),
            Duration::from_secs(5),
        )
        .unwrap();
        let first_message = ChatMessage::text(MessageRole::User, "first");
        let first = transport
            .stream(
                ModelRequest {
                    provider_context_enabled: true,
                    thread_id: "conversation".to_owned(),
                    system_prompt: "system".to_owned(),
                    messages: vec![first_message.clone()],
                    sequenced_messages: vec![SequencedMessage {
                        seq: 0,
                        message: first_message.clone(),
                    }],
                    tools: Vec::<ToolDefinition>::new(),
                    provider_contexts: Vec::new(),
                    compact_threshold_tokens: 96_000,
                },
                CancellationToken::new(),
                None,
            )
            .await
            .unwrap();
        assert_eq!(first.text, "answer-1");
        assert_eq!(
            first
                .provider_context
                .as_ref()
                .and_then(|context| context.cursor.as_deref()),
            Some("resp_1")
        );

        let second_message = ChatMessage::text(MessageRole::User, "second");
        transport
            .stream(
                ModelRequest {
                    provider_context_enabled: true,
                    thread_id: "conversation".to_owned(),
                    system_prompt: "system".to_owned(),
                    messages: vec![first_message.clone(), second_message.clone()],
                    sequenced_messages: vec![
                        SequencedMessage {
                            seq: 0,
                            message: first_message,
                        },
                        SequencedMessage {
                            seq: 1,
                            message: second_message,
                        },
                    ],
                    tools: Vec::new(),
                    provider_contexts: vec![ProviderContext {
                        provider_id: "provider-1".to_owned(),
                        mode: ProviderContextMode::Responses,
                        cursor: Some("resp_1".to_owned()),
                        through_seq: 0,
                        unsupported: false,
                    }],
                    compact_threshold_tokens: 96_000,
                },
                CancellationToken::new(),
                None,
            )
            .await
            .unwrap();

        let requests = captured.0.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[1]["previous_response_id"], "resp_1");
        assert_eq!(requests[1]["input"].as_array().unwrap().len(), 1);
        assert_eq!(requests[1]["input"][0]["content"], "second");
        server.abort();
    }
}

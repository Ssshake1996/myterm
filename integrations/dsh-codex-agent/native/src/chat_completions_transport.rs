use std::{collections::BTreeMap, time::Duration};

use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::{
    Client, StatusCode,
    header::{AUTHORIZATION, HeaderValue},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::{
    chat_completions_sse::SseDecoder,
    error::CoreError,
    model_transport::{DeltaSink, ModelTransport},
    types::{
        ChatCompletionsRequest, ChatMessage, ChatToolDefinition, MessageRole, ModelRequest,
        ModelResponse, StreamOptions, TokenUsage, ToolCall,
    },
};

pub struct ChatCompletionsTransport {
    client: Client,
    endpoint: Url,
    authorization: HeaderValue,
    model: String,
}

impl ChatCompletionsTransport {
    pub fn new(
        base_url: &str,
        api_key: String,
        model: String,
        timeout: Duration,
    ) -> Result<Self, CoreError> {
        if api_key.is_empty() {
            return Err(CoreError::Configuration(
                "the injected API key must not be empty".to_owned(),
            ));
        }
        Self::new_with_authorization(base_url, format!("Bearer {api_key}"), model, timeout)
    }

    pub fn new_with_authorization(
        base_url: &str,
        authorization: String,
        model: String,
        timeout: Duration,
    ) -> Result<Self, CoreError> {
        let authorization = HeaderValue::from_str(&authorization).map_err(|error| {
            CoreError::Configuration(format!("invalid Authorization header: {error}"))
        })?;
        let endpoint = chat_completions_url(base_url)?;
        let client = Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|error| CoreError::Configuration(format!("HTTP client: {error}")))?;
        Ok(Self {
            client,
            endpoint,
            authorization,
            model,
        })
    }

    fn request_body(&self, request: ModelRequest) -> Result<ChatCompletionsRequest, CoreError> {
        let messages = request
            .messages
            .iter()
            .map(message_to_wire)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ChatCompletionsRequest {
            model: self.model.clone(),
            messages,
            tools: request
                .tools
                .into_iter()
                .map(ChatToolDefinition::from)
                .collect(),
            stream: true,
            stream_options: StreamOptions {
                include_usage: true,
            },
        })
    }
}

#[async_trait]
impl ModelTransport for ChatCompletionsTransport {
    async fn stream(
        &self,
        request: ModelRequest,
        cancellation: CancellationToken,
        on_text_delta: Option<DeltaSink>,
    ) -> Result<ModelResponse, CoreError> {
        let body = self.request_body(request)?;
        let response = tokio::select! {
            _ = cancellation.cancelled() => {
                return Err(CoreError::Cancelled("cancelled before model response headers".to_owned()));
            }
            response = self.client
                .post(self.endpoint.clone())
                .header(AUTHORIZATION, self.authorization.clone())
                .json(&body)
                .send() => response.map_err(|error| request_error("send", error))?,
        };

        let status = response.status();
        if !status.is_success() {
            let response_body = response.text().await.unwrap_or_default();
            return Err(http_status_error(status, response_body));
        }

        let mut decoder = SseDecoder::default();
        let mut accumulator = ResponseAccumulator::default();
        let mut stream = response.bytes_stream();
        let mut saw_done = false;
        loop {
            let next = tokio::select! {
                _ = cancellation.cancelled() => {
                    return Err(CoreError::Cancelled("cancelled while reading model stream".to_owned()));
                }
                next = stream.next() => next,
            };
            let Some(chunk) = next else { break };
            let chunk = chunk.map_err(|error| request_error("stream", error))?;
            for payload in decoder.push(&chunk)? {
                if accept_payload(&payload, &mut accumulator, on_text_delta.as_ref())? {
                    saw_done = true;
                }
            }
        }
        for payload in decoder.finish()? {
            if accept_payload(&payload, &mut accumulator, on_text_delta.as_ref())? {
                saw_done = true;
            }
        }
        if !saw_done && accumulator.finish_reason.is_none() {
            return Err(CoreError::MalformedSse(
                "stream ended without [DONE] or finish_reason".to_owned(),
            ));
        }
        accumulator.finish()
    }
}

pub fn chat_completions_url(base_url: &str) -> Result<Url, CoreError> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let target = if trimmed.ends_with("/chat/completions") {
        trimmed.to_owned()
    } else if trimmed.ends_with("/v1") {
        format!("{trimmed}/chat/completions")
    } else {
        format!("{trimmed}/v1/chat/completions")
    };
    Url::parse(&target)
        .map_err(|error| CoreError::Configuration(format!("invalid baseUrl {base_url:?}: {error}")))
}

fn message_to_wire(message: &ChatMessage) -> Result<Value, CoreError> {
    let role = match message.role {
        MessageRole::System => "system",
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
        MessageRole::Tool => "tool",
    };
    let mut value = json!({ "role": role });
    let object = value
        .as_object_mut()
        .expect("json object literal must remain an object");
    if let Some(content) = &message.content {
        object.insert("content".to_owned(), Value::String(content.clone()));
    } else {
        object.insert("content".to_owned(), Value::Null);
    }
    if !message.tool_calls.is_empty() {
        object.insert(
            "tool_calls".to_owned(),
            Value::Array(
                message
                    .tool_calls
                    .iter()
                    .map(|call| {
                        json!({
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": call.arguments,
                            }
                        })
                    })
                    .collect(),
            ),
        );
    }
    if let Some(tool_call_id) = &message.tool_call_id {
        object.insert(
            "tool_call_id".to_owned(),
            Value::String(tool_call_id.clone()),
        );
    }
    Ok(value)
}

fn accept_payload(
    payload: &str,
    accumulator: &mut ResponseAccumulator,
    on_text_delta: Option<&DeltaSink>,
) -> Result<bool, CoreError> {
    if payload == "[DONE]" {
        return Ok(true);
    }
    let chunk: StreamChunk = serde_json::from_str(payload).map_err(|error| {
        CoreError::MalformedSse(format!(
            "invalid Chat Completions event JSON: {error}; payload={payload}"
        ))
    })?;
    if let Some(error) = chunk.error {
        return Err(CoreError::Model {
            phase: "stream_event",
            code: error.code.unwrap_or_else(|| "SSE_ERROR".to_owned()),
            status: None,
            detail: error.message,
            response_body: Some(payload.to_owned()),
        });
    }
    if let Some(usage) = chunk.usage {
        accumulator.usage = Some(usage);
    }
    for choice in chunk.choices {
        if choice.index != 0 {
            continue;
        }
        if let Some(content) = choice.delta.content {
            if let Some(sink) = on_text_delta {
                sink(content.clone());
            }
            accumulator.text.push_str(&content);
        }
        for delta in choice.delta.tool_calls {
            let entry = accumulator.tool_calls.entry(delta.index).or_default();
            if let Some(id) = delta.id {
                append_or_set(&mut entry.id, &id);
            }
            if let Some(function) = delta.function {
                if let Some(name) = function.name {
                    append_or_set(&mut entry.name, &name);
                }
                if let Some(arguments) = function.arguments {
                    entry.arguments.push_str(&arguments);
                }
            }
        }
        if choice.finish_reason.is_some() {
            accumulator.finish_reason = choice.finish_reason;
        }
    }
    Ok(false)
}

fn append_or_set(target: &mut String, fragment: &str) {
    if target.is_empty() || !target.ends_with(fragment) {
        target.push_str(fragment);
    }
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
        phase: "response_status",
        code: format!("HTTP_{}", status.as_u16()),
        status: Some(status.as_u16()),
        detail: format!("model endpoint returned HTTP {}", status.as_u16()),
        response_body: Some(body),
    }
}

#[derive(Debug, Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
    usage: Option<TokenUsage>,
    error: Option<StreamError>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    index: usize,
    #[serde(default)]
    delta: StreamDelta,
    finish_reason: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct StreamDelta {
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<ToolCallDelta>,
}

#[derive(Debug, Deserialize)]
struct ToolCallDelta {
    index: usize,
    id: Option<String>,
    function: Option<FunctionDelta>,
}

#[derive(Debug, Deserialize)]
struct FunctionDelta {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StreamError {
    message: String,
    code: Option<String>,
}

#[derive(Default)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Default)]
struct ResponseAccumulator {
    text: String,
    tool_calls: BTreeMap<usize, ToolCallAccumulator>,
    finish_reason: Option<String>,
    usage: Option<TokenUsage>,
}

impl ResponseAccumulator {
    fn finish(self) -> Result<ModelResponse, CoreError> {
        let tool_calls = self
            .tool_calls
            .into_iter()
            .map(|(index, call)| {
                if call.id.is_empty() || call.name.is_empty() {
                    return Err(CoreError::MalformedSse(format!(
                        "tool call at index {index} is missing id or function name"
                    )));
                }
                Ok(ToolCall {
                    index,
                    id: call.id,
                    name: call.name,
                    arguments: call.arguments,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if self.text.is_empty() && tool_calls.is_empty() {
            return Err(CoreError::EmptyResponse);
        }
        Ok(ModelResponse {
            text: self.text,
            tool_calls,
            finish_reason: self.finish_reason.unwrap_or_else(|| "stop".to_owned()),
            usage: self.usage,
            provider_context: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::types::{ToolCall, ToolDefinition};
    use axum::{
        Router,
        body::Body,
        extract::State,
        http::{HeaderMap, Response},
        routing::post,
    };

    #[test]
    fn builds_endpoint_for_root_v1_and_full_paths() {
        assert_eq!(
            chat_completions_url("https://llm.internal")
                .unwrap()
                .as_str(),
            "https://llm.internal/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://llm.internal/v1/")
                .unwrap()
                .as_str(),
            "https://llm.internal/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://llm.internal/v1/chat/completions")
                .unwrap()
                .as_str(),
            "https://llm.internal/v1/chat/completions"
        );
    }

    #[test]
    fn serializes_multi_turn_tool_messages_in_chat_completions_shape() {
        let messages = vec![
            ChatMessage::text(MessageRole::User, "inspect"),
            ChatMessage {
                role: MessageRole::Assistant,
                content: None,
                tool_calls: vec![ToolCall {
                    index: 0,
                    id: "call-1".to_owned(),
                    name: "read_file".to_owned(),
                    arguments: "{\"path\":\"a\"}".to_owned(),
                }],
                tool_call_id: None,
            },
            ChatMessage {
                role: MessageRole::Tool,
                content: Some("ok".to_owned()),
                tool_calls: Vec::new(),
                tool_call_id: Some("call-1".to_owned()),
            },
        ];
        let body = ChatCompletionsTransport::new(
            "https://llm.internal",
            "secret".to_owned(),
            "model".to_owned(),
            Duration::from_secs(1),
        )
        .unwrap()
        .request_body(ModelRequest {
            provider_context_enabled: false,
            thread_id: "test".to_owned(),
            system_prompt: String::new(),
            messages,
            sequenced_messages: Vec::new(),
            tools: vec![ToolDefinition {
                name: "read_file".to_owned(),
                description: "read".to_owned(),
                parameters: json!({"type":"object"}),
                parallel_safe: true,
            }],
            provider_contexts: Vec::new(),
            compact_threshold_tokens: 96_000,
        })
        .unwrap();
        let value = serde_json::to_value(body).unwrap();
        assert_eq!(value["messages"][1]["tool_calls"][0]["id"], "call-1");
        assert_eq!(value["messages"][2]["tool_call_id"], "call-1");
        assert_eq!(value["tools"][0]["type"], "function");
    }

    #[test]
    fn assembles_incremental_text_and_tool_arguments_in_index_order() {
        let mut accumulator = ResponseAccumulator::default();
        let first = r#"{"choices":[{"index":0,"delta":{"content":"hi","tool_calls":[{"index":1,"id":"call-b","function":{"name":"b","arguments":"{\"x\":"}},{"index":0,"id":"call-a","function":{"name":"a","arguments":"{"}}]},"finish_reason":null}]}"#;
        let second = r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"function":{"arguments":"1}"}},{"index":0,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}"#;
        accept_payload(first, &mut accumulator, None).unwrap();
        accept_payload(second, &mut accumulator, None).unwrap();
        let response = accumulator.finish().unwrap();
        assert_eq!(response.text, "hi");
        assert_eq!(response.tool_calls[0].id, "call-a");
        assert_eq!(response.tool_calls[0].arguments, "{}");
        assert_eq!(response.tool_calls[1].arguments, "{\"x\":1}");
        assert_eq!(response.usage.unwrap().total_tokens, 5);
    }

    #[test]
    fn rejects_empty_response() {
        assert!(matches!(
            ResponseAccumulator::default().finish(),
            Err(CoreError::EmptyResponse)
        ));
    }

    #[test]
    fn accepts_a_raw_authorization_value_for_api_key_gateways() {
        let transport = ChatCompletionsTransport::new_with_authorization(
            "https://gateway.example/v1",
            "sk-raw-test".to_owned(),
            "model".to_owned(),
            Duration::from_secs(1),
        )
        .unwrap();
        assert_eq!(transport.authorization.to_str().unwrap(), "sk-raw-test");
    }

    #[derive(Clone)]
    struct CapturedRequest {
        authorization: Arc<Mutex<Option<String>>>,
        body: Arc<Mutex<Option<Value>>>,
        response_body: String,
        status: StatusCode,
        delay_ms: u64,
    }

    async fn model_handler(
        State(state): State<CapturedRequest>,
        headers: HeaderMap,
        body: String,
    ) -> Response<Body> {
        *state.authorization.lock().unwrap() = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned);
        *state.body.lock().unwrap() = serde_json::from_str(&body).ok();
        if state.delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(state.delay_ms)).await;
        }
        Response::builder()
            .status(state.status)
            .header("content-type", "text/event-stream")
            .body(Body::from(state.response_body))
            .unwrap()
    }

    async fn server(state: CapturedRequest) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new()
                    .route("/v1/chat/completions", post(model_handler))
                    .with_state(state),
            )
            .await
            .unwrap();
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn streams_real_http_text_tools_usage_and_keeps_key_out_of_body() {
        let authorization = Arc::new(Mutex::new(None));
        let request_body = Arc::new(Mutex::new(None));
        let base_url = server(CapturedRequest {
            authorization: authorization.clone(),
            body: request_body.clone(),
            response_body: concat!(
                "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"},\"finish_reason\":null}]}\n\n",
                "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\",\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\"}}]},\"finish_reason\":null}]}\n\n",
                "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"a\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":4,\"total_tokens\":7}}\n\n",
                "data: [DONE]\n\n",
            )
            .to_owned(),
            status: StatusCode::OK,
            delay_ms: 0,
        })
        .await;
        let transport = ChatCompletionsTransport::new(
            &base_url,
            "sk-http-secret".to_owned(),
            "model".to_owned(),
            Duration::from_secs(2),
        )
        .unwrap();
        let deltas = Arc::new(Mutex::new(Vec::new()));
        let sink_values = deltas.clone();
        let response = transport
            .stream(
                ModelRequest {
                    provider_context_enabled: false,
                    thread_id: "test".to_owned(),
                    system_prompt: String::new(),
                    messages: vec![ChatMessage::text(MessageRole::User, "go")],
                    sequenced_messages: Vec::new(),
                    tools: Vec::new(),
                    provider_contexts: Vec::new(),
                    compact_threshold_tokens: 96_000,
                },
                CancellationToken::new(),
                Some(Arc::new(move |delta| {
                    sink_values.lock().unwrap().push(delta)
                })),
            )
            .await
            .unwrap();
        assert_eq!(response.text, "hello");
        assert_eq!(response.tool_calls[0].arguments, "{\"path\":\"a\"}");
        assert_eq!(response.usage.unwrap().total_tokens, 7);
        assert_eq!(&*deltas.lock().unwrap(), &["hel", "lo"]);
        assert_eq!(
            authorization.lock().unwrap().as_deref(),
            Some("Bearer sk-http-secret")
        );
        let body = request_body.lock().unwrap().clone().unwrap();
        assert_eq!(body["stream"], true);
        assert!(!body.to_string().contains("sk-http-secret"));
    }

    #[tokio::test]
    async fn reports_http_status_body_and_timeout_phase_verbatim() {
        let error_url = server(CapturedRequest {
            authorization: Arc::new(Mutex::new(None)),
            body: Arc::new(Mutex::new(None)),
            response_body: "upstream certificate rejected".to_owned(),
            status: StatusCode::BAD_GATEWAY,
            delay_ms: 0,
        })
        .await;
        let transport = ChatCompletionsTransport::new(
            &error_url,
            "secret".to_owned(),
            "model".to_owned(),
            Duration::from_secs(1),
        )
        .unwrap();
        let error = transport
            .stream(
                ModelRequest {
                    provider_context_enabled: false,
                    thread_id: "test".to_owned(),
                    system_prompt: String::new(),
                    messages: vec![ChatMessage::text(MessageRole::User, "go")],
                    sequenced_messages: Vec::new(),
                    tools: Vec::new(),
                    provider_contexts: Vec::new(),
                    compact_threshold_tokens: 96_000,
                },
                CancellationToken::new(),
                None,
            )
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            CoreError::Model {
                phase: "response_status",
                status: Some(502),
                response_body: Some(ref body),
                ..
            } if body == "upstream certificate rejected"
        ));

        let timeout_url = server(CapturedRequest {
            authorization: Arc::new(Mutex::new(None)),
            body: Arc::new(Mutex::new(None)),
            response_body: "data: [DONE]\n\n".to_owned(),
            status: StatusCode::OK,
            delay_ms: 100,
        })
        .await;
        let timeout_transport = ChatCompletionsTransport::new(
            &timeout_url,
            "secret".to_owned(),
            "model".to_owned(),
            Duration::from_millis(10),
        )
        .unwrap();
        let timeout = timeout_transport
            .stream(
                ModelRequest {
                    provider_context_enabled: false,
                    thread_id: "test".to_owned(),
                    system_prompt: String::new(),
                    messages: vec![ChatMessage::text(MessageRole::User, "go")],
                    sequenced_messages: Vec::new(),
                    tools: Vec::new(),
                    provider_contexts: Vec::new(),
                    compact_threshold_tokens: 96_000,
                },
                CancellationToken::new(),
                None,
            )
            .await
            .unwrap_err();
        assert!(matches!(
            timeout,
            CoreError::Model {
                phase: "send",
                ref code,
                ..
            } if code == "TIMEOUT"
        ));
    }
}

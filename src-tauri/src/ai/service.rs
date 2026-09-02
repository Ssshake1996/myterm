use std::{backtrace::Backtrace, sync::Arc, time::Duration};

use reqwest::RequestBuilder;
use serde::Serialize;

use crate::{
    ai::routing::resolve_model_routes,
    config::{ConfigService, CredentialVault, DEFAULT_SYSTEM_PROMPT},
    types::{AiProfile, AiReasoningEffort},
    AppError,
};

const MAX_DIAGNOSTIC_CHARS: usize = 16_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiErrorDiagnostic {
    pub stage: String,
    pub code: String,
    pub summary: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTestResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_details: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_response: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AiErrorDiagnostic>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelTestResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_response: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AiErrorDiagnostic>,
}

pub struct AiService {
    config: Arc<ConfigService>,
    vault: Arc<dyn CredentialVault>,
    client: reqwest::Client,
}

impl AiService {
    pub fn new(
        config: Arc<ConfigService>,
        vault: Arc<dyn CredentialVault>,
    ) -> Result<Self, AppError> {
        let client = reqwest::Client::builder()
            .tls_built_in_native_certs(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|error| AppError::Ai(error.to_string()))?;
        Ok(Self {
            config,
            vault,
            client,
        })
    }

    pub async fn fetch_models(&self, profile_id: &str) -> Result<AiTestResult, AppError> {
        let profile = match self.profile(profile_id) {
            Ok(profile) => profile,
            Err(error) => {
                return Ok(failed_test(
                    "load_profile",
                    error.code(),
                    format!("读取 AI 配置 · {}", error.code()),
                    error.detail(),
                    "",
                ));
            }
        };
        let key = match self.vault.get(&profile.api_key_ref) {
            Ok(Some(value)) if !value.trim().is_empty() => value,
            Ok(_) => {
                return Ok(failed_test(
                    "read_api_key",
                    "api_key_missing",
                    "读取 API Key · api_key_missing",
                    "API Key 未配置：请填写 API Key 并保存配置".to_owned(),
                    "",
                ));
            }
            Err(error) => {
                return Ok(failed_test(
                    "read_api_key",
                    error.code(),
                    format!("读取 API Key · {}", error.code()),
                    error.detail(),
                    "",
                ));
            }
        };
        let models_endpoint = match endpoint(&profile.base_url, "models") {
            Ok(endpoint) => endpoint,
            Err(error) => {
                return Ok(failed_test(
                    "build_models_request",
                    error.code(),
                    format!("构造模型列表请求 · {}", error.code()),
                    error.detail(),
                    &key,
                ));
            }
        };
        let response = with_auth(self.client.get(models_endpoint.clone()), &key)
            .send()
            .await
            .map_err(|error| {
                failed_test(
                    "models_request",
                    transport_error_code(&error),
                    format!("请求模型列表 · {}", transport_error_code(&error)),
                    format_transport_failure(error, &models_endpoint),
                    &key,
                )
            });
        let response = match response {
            Ok(response) => response,
            Err(error) => return Ok(error),
        };
        let status = response.status();
        let body = response.text().await.map_err(|error| {
            failed_test(
                "read_models_response",
                transport_error_code(&error),
                format!("读取模型列表响应 · {}", transport_error_code(&error)),
                format_transport_failure(error, &models_endpoint),
                &key,
            )
        });
        let body = match body {
            Ok(body) => body,
            Err(error) => return Ok(error),
        };
        if !status.is_success() {
            return Ok(AiTestResult {
                ok: false,
                models: None,
                model_details: None,
                raw_response: Some(redact_and_bound(&body, &key)),
                endpoint: Some(models_endpoint.to_string()),
                error: Some(http_failure_diagnostic(
                    "models_request",
                    status,
                    &body,
                    &models_endpoint,
                    &key,
                )),
            });
        }
        let value = match serde_json::from_str::<serde_json::Value>(&body) {
            Ok(value) => value,
            Err(error) => {
                return Ok(failed_test(
                    "parse_models_response",
                    "json_parse",
                    "解析模型列表响应 · json_parse",
                    format!(
                        "JSON parse error: {error}\nResponse body:\n{}",
                        redact_and_bound(&body, &key)
                    ),
                    &key,
                ));
            }
        };
        let Some(models) = value.get("data").and_then(serde_json::Value::as_array) else {
            return Ok(failed_test(
                "validate_models_response",
                "json_schema",
                "校验模型列表响应 · json_schema",
                format!(
                    "JSON validation error: $.data is not an array\nResponse body:\n{}",
                    redact_and_bound(&body, &key)
                ),
                &key,
            ));
        };
        Ok(AiTestResult {
            ok: true,
            models: Some(models.len()),
            model_details: Some(models.clone()),
            raw_response: Some(redact_and_bound(&body, &key)),
            endpoint: Some(models_endpoint.to_string()),
            error: None,
        })
    }

    pub async fn test_connection(&self, profile_id: &str) -> Result<AiTestResult, AppError> {
        self.fetch_models(profile_id).await
    }

    pub async fn test_model(
        &self,
        profile_id: &str,
        model: &str,
        prompt: &str,
    ) -> Result<AiModelTestResult, AppError> {
        let profile = match self.profile(profile_id) {
            Ok(profile) => profile,
            Err(error) => {
                return Ok(failed_model_test(
                    "load_profile",
                    error.code(),
                    format!("读取 AI 配置 · {}", error.code()),
                    error.detail(),
                    "",
                ));
            }
        };
        let selected_route = model.trim();
        let routes = match resolve_model_routes(self.config.as_ref(), self.vault.as_ref(), &profile)
        {
            Ok(routes) => routes,
            Err(error) => {
                return Ok(failed_model_test(
                    "resolve_model_route",
                    error.code(),
                    format!("解析模型 Provider 路由 · {}", error.code()),
                    error.detail(),
                    "",
                ));
            }
        };
        let route = routes
            .iter()
            .find(|candidate| candidate.model.id == selected_route)
            .cloned()
            .or_else(|| {
                // Backward compatibility for callers saved before route ids
                // were introduced.
                routes
                    .into_iter()
                    .find(|candidate| candidate.model.model == selected_route)
            });
        let Some(route) = route else {
            return Ok(failed_model_test(
                "validate_model",
                "model_not_configured",
                "校验测试模型 · model_not_configured",
                format!("模型路由 '{selected_route}' 未在当前 AI 配置中启用"),
                "",
            ));
        };
        let selected_model = route.model.model.as_str();
        let prompt = prompt.trim();
        if prompt.is_empty() {
            return Ok(failed_model_test(
                "validate_prompt",
                "prompt_empty",
                "校验测试提示词 · prompt_empty",
                "测试提示词不能为空".to_owned(),
                "",
            ));
        }
        let max_tokens = route.model.max_output_tokens;
        let key = route.api_key;
        let chat_endpoint = match endpoint(&route.provider.base_url, "chat/completions") {
            Ok(endpoint) => endpoint,
            Err(error) => {
                return Ok(failed_model_test(
                    "build_model_request",
                    error.code(),
                    format!("构造模型测试请求 · {}", error.code()),
                    error.detail(),
                    &key,
                ));
            }
        };
        let system_prompt = if profile.system_prompt.trim().is_empty() {
            DEFAULT_SYSTEM_PROMPT
        } else {
            profile.system_prompt.as_str()
        };
        let (thinking, reasoning_effort) = match route.provider.reasoning_effort {
            AiReasoningEffort::Off => (None, None),
            AiReasoningEffort::Low => (Some(ThinkingRequest { r#type: "enabled" }), Some("low")),
            AiReasoningEffort::High => (Some(ThinkingRequest { r#type: "enabled" }), Some("high")),
            AiReasoningEffort::Max => (Some(ThinkingRequest { r#type: "enabled" }), Some("max")),
        };
        let request = ChatRequest {
            model: selected_model,
            messages: vec![
                RequestMessage {
                    role: "system",
                    content: system_prompt,
                },
                RequestMessage {
                    role: "user",
                    content: prompt,
                },
            ],
            stream: true,
            stream_options: StreamOptions {
                include_usage: true,
            },
            thinking,
            reasoning_effort,
            max_tokens,
        };
        let started = std::time::Instant::now();
        let response = match with_auth(self.client.post(chat_endpoint.clone()), &key)
            .json(&request)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                return Ok(failed_model_test(
                    "model_request",
                    transport_error_code(&error),
                    format!("请求测试模型 · {}", transport_error_code(&error)),
                    format_transport_failure(error, &chat_endpoint),
                    &key,
                ));
            }
        };
        let status = response.status();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        let body = match response.text().await {
            Ok(body) => body,
            Err(error) => {
                return Ok(failed_model_test(
                    "read_model_response",
                    transport_error_code(&error),
                    format!("读取模型测试响应 · {}", transport_error_code(&error)),
                    format_transport_failure(error, &chat_endpoint),
                    &key,
                ));
            }
        };
        if !status.is_success() {
            return Ok(AiModelTestResult {
                ok: false,
                model: Some(selected_model.to_owned()),
                content: None,
                elapsed_ms: Some(started.elapsed().as_millis()),
                raw_response: Some(redact_and_bound(&body, &key)),
                endpoint: Some(chat_endpoint.to_string()),
                error: Some(http_failure_diagnostic_for(
                    "model_request",
                    "请求测试模型",
                    status,
                    &body,
                    &chat_endpoint,
                    &key,
                )),
            });
        }
        if !content_type
            .to_ascii_lowercase()
            .contains("text/event-stream")
        {
            return Ok(failed_model_response_test(
                "validate_model_stream",
                "unexpected_content_type",
                "校验 Harness 流式响应 · unexpected_content_type",
                format!(
                    "Expected content-type text/event-stream, received '{}'.\nEndpoint: {}\nResponse body:\n{}",
                    content_type,
                    chat_endpoint,
                    redact_and_bound(&body, &key)
                ),
                selected_model,
                &chat_endpoint,
                &body,
                started.elapsed().as_millis(),
                &key,
            ));
        }
        let (response_model, content) = match extract_streamed_message(&body) {
            Ok(result) => result,
            Err(error) => {
                return Ok(failed_model_response_test(
                    "parse_model_stream",
                    "sse_parse",
                    "解析 Harness 流式响应 · sse_parse",
                    format!(
                        "{error}\nEndpoint: {}\nResponse body:\n{}",
                        chat_endpoint,
                        redact_and_bound(&body, &key)
                    ),
                    selected_model,
                    &chat_endpoint,
                    &body,
                    started.elapsed().as_millis(),
                    &key,
                ));
            }
        };
        Ok(AiModelTestResult {
            ok: true,
            model: Some(response_model.unwrap_or_else(|| selected_model.to_owned())),
            content: Some(content),
            elapsed_ms: Some(started.elapsed().as_millis()),
            raw_response: Some(redact_and_bound(&body, &key)),
            endpoint: Some(chat_endpoint.to_string()),
            error: None,
        })
    }

    fn profile(&self, profile_id: &str) -> Result<AiProfile, AppError> {
        self.config
            .ai_profile_list()?
            .into_iter()
            .find(|profile| profile.id == profile_id)
            .ok_or_else(|| AppError::NotFound(format!("AI profile '{profile_id}'")))
    }
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<RequestMessage<'a>>,
    stream: bool,
    stream_options: StreamOptions,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<ThinkingRequest<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Serialize)]
struct StreamOptions {
    include_usage: bool,
}

#[derive(Serialize)]
struct ThinkingRequest<'a> {
    r#type: &'a str,
}

#[derive(Serialize)]
struct RequestMessage<'a> {
    role: &'a str,
    content: &'a str,
}

pub(crate) fn endpoint(base_url: &str, path: &str) -> Result<reqwest::Url, AppError> {
    let mut url = reqwest::Url::parse(base_url)
        .map_err(|error| AppError::InvalidInput(format!("invalid DeepSeek base URL: {error}")))?;
    let configured_path = url.path().trim_end_matches('/');
    url.set_path(&format!(
        "{configured_path}/{}",
        path.trim_start_matches('/')
    ));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

pub(crate) fn with_auth(request: RequestBuilder, key: &str) -> RequestBuilder {
    request.bearer_auth(key)
}

pub(crate) fn format_transport_failure(error: reqwest::Error, endpoint: &reqwest::Url) -> String {
    format!(
        "Endpoint: {endpoint}\nTransport error: {}",
        error.without_url()
    )
}

pub(crate) fn format_http_failure(
    status: reqwest::StatusCode,
    body: &str,
    endpoint: &reqwest::Url,
    secret: &str,
) -> String {
    let detail = redact_and_bound(body, secret);
    let detail = if detail.is_empty() {
        "<empty>".to_owned()
    } else {
        detail
    };
    format!("HTTP {status}\nEndpoint: {endpoint}\nResponse body:\n{detail}")
}

fn failed_test(
    stage: &str,
    code: impl Into<String>,
    summary: impl Into<String>,
    detail: String,
    secret: &str,
) -> AiTestResult {
    AiTestResult {
        ok: false,
        models: None,
        model_details: None,
        raw_response: None,
        endpoint: None,
        error: Some(AiErrorDiagnostic {
            stage: stage.to_owned(),
            code: code.into(),
            summary: summary.into(),
            detail: redact_and_bound(&detail, secret),
            stack: Some(redact_and_bound(
                &Backtrace::force_capture().to_string(),
                secret,
            )),
        }),
    }
}

fn failed_model_test(
    stage: &str,
    code: impl Into<String>,
    summary: impl Into<String>,
    detail: String,
    secret: &str,
) -> AiModelTestResult {
    AiModelTestResult {
        ok: false,
        model: None,
        content: None,
        elapsed_ms: None,
        raw_response: None,
        endpoint: None,
        error: Some(AiErrorDiagnostic {
            stage: stage.to_owned(),
            code: code.into(),
            summary: summary.into(),
            detail: redact_and_bound(&detail, secret),
            stack: Some(redact_and_bound(
                &Backtrace::force_capture().to_string(),
                secret,
            )),
        }),
    }
}

#[allow(clippy::too_many_arguments)]
fn failed_model_response_test(
    stage: &str,
    code: impl Into<String>,
    summary: impl Into<String>,
    detail: String,
    model: &str,
    endpoint: &reqwest::Url,
    body: &str,
    elapsed_ms: u128,
    secret: &str,
) -> AiModelTestResult {
    AiModelTestResult {
        ok: false,
        model: Some(model.to_owned()),
        content: None,
        elapsed_ms: Some(elapsed_ms),
        raw_response: Some(redact_and_bound(body, secret)),
        endpoint: Some(endpoint.to_string()),
        error: Some(AiErrorDiagnostic {
            stage: stage.to_owned(),
            code: code.into(),
            summary: summary.into(),
            detail: redact_and_bound(&detail, secret),
            stack: Some(redact_and_bound(
                &Backtrace::force_capture().to_string(),
                secret,
            )),
        }),
    }
}

fn http_failure_diagnostic(
    stage: &str,
    status: reqwest::StatusCode,
    body: &str,
    endpoint: &reqwest::Url,
    secret: &str,
) -> AiErrorDiagnostic {
    http_failure_diagnostic_for(stage, "请求模型列表", status, body, endpoint, secret)
}

fn http_failure_diagnostic_for(
    stage: &str,
    label: &str,
    status: reqwest::StatusCode,
    body: &str,
    endpoint: &reqwest::Url,
    secret: &str,
) -> AiErrorDiagnostic {
    AiErrorDiagnostic {
        stage: stage.to_owned(),
        code: format!("http_{}", status.as_u16()),
        summary: format!("{label} · HTTP {status}"),
        detail: format_http_failure(status, body, endpoint, secret),
        stack: Some(redact_and_bound(
            &Backtrace::force_capture().to_string(),
            secret,
        )),
    }
}

fn extract_streamed_message(body: &str) -> Result<(Option<String>, String), String> {
    let mut model = None;
    let mut content = String::new();
    let mut saw_event = false;
    let mut saw_done = false;
    for line in body.lines() {
        let Some(data) = line.trim().strip_prefix("data:").map(str::trim) else {
            continue;
        };
        if data.is_empty() {
            continue;
        }
        if data == "[DONE]" {
            saw_done = true;
            continue;
        }
        let value: serde_json::Value = serde_json::from_str(data)
            .map_err(|error| format!("SSE JSON parse error: {error}; event: {data}"))?;
        saw_event = true;
        if model.is_none() {
            model = value
                .get("model")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned);
        }
        if let Some(text) = value
            .pointer("/choices/0/delta/content")
            .and_then(serde_json::Value::as_str)
        {
            content.push_str(text);
        }
    }
    if !saw_event {
        return Err("SSE response did not contain a data event".to_owned());
    }
    if !saw_done {
        return Err("SSE stream ended without [DONE]".to_owned());
    }
    if content.is_empty() {
        return Err("SSE response did not contain choices[0].delta.content".to_owned());
    }
    Ok((model, content))
}

fn transport_error_code(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "transport_timeout"
    } else if error.is_connect() {
        "transport_connect"
    } else if error.is_request() {
        "transport_request"
    } else {
        "transport_error"
    }
}

#[cfg(test)]
fn parse_model_count(body: &str, secret: &str) -> Result<usize, String> {
    let value = serde_json::from_str::<serde_json::Value>(body).map_err(|error| {
        format!(
            "JSON parse error: {error}\nResponse body:\n{}",
            redact_and_bound(body, secret)
        )
    })?;
    value
        .get("data")
        .and_then(serde_json::Value::as_array)
        .map(Vec::len)
        .ok_or_else(|| {
            format!(
                "JSON validation error: $.data is not an array\nResponse body:\n{}",
                redact_and_bound(body, secret)
            )
        })
}

pub(crate) fn redact_and_bound(value: &str, secret: &str) -> String {
    let redacted = if secret.is_empty() {
        value.to_owned()
    } else {
        value.replace(secret, "[REDACTED]")
    };
    bound_diagnostic(&redact_api_key(&redacted))
}

fn bound_diagnostic(value: &str) -> String {
    const MARKER: &str = "\n[diagnostic truncated]";
    if value.chars().count() <= MAX_DIAGNOSTIC_CHARS {
        return value.to_owned();
    }
    let keep = MAX_DIAGNOSTIC_CHARS.saturating_sub(MARKER.chars().count());
    let mut bounded = value.chars().take(keep).collect::<String>();
    bounded.push_str(MARKER);
    bounded
}

fn redact_api_key(value: &str) -> String {
    let mut redacted = String::with_capacity(value.len());
    let mut cursor = 0;
    while let Some(offset) = value[cursor..].find("sk-") {
        let start = cursor + offset;
        redacted.push_str(&value[cursor..start]);
        redacted.push_str("sk-***");
        let token = &value[start + 3..];
        let end = token
            .char_indices()
            .find(|(_, character)| {
                !(character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
            })
            .map_or(value.len(), |(index, _)| start + 3 + index);
        cursor = end;
    }
    redacted.push_str(&value[cursor..]);
    redacted
}

#[cfg(test)]
mod tests {
    use super::{
        endpoint, extract_streamed_message, failed_test, format_http_failure, parse_model_count,
        redact_and_bound, redact_api_key, with_auth, MAX_DIAGNOSTIC_CHARS,
    };
    use crate::types::{AiModelConfig, AiModelRole, AiProfile, AiReasoningEffort, AiRoutingConfig};

    #[test]
    fn endpoint_and_diagnostics_are_bounded() -> Result<(), Box<dyn std::error::Error>> {
        assert_eq!(
            endpoint("http://localhost:11434/v1/", "models")?.as_str(),
            "http://localhost:11434/v1/models"
        );
        assert_eq!(
            endpoint("https://api.deepseek.com", "chat/completions")?.as_str(),
            "https://api.deepseek.com/chat/completions"
        );
        assert_eq!(
            redact_and_bound("line one\nline two", ""),
            "line one\nline two"
        );
        assert!(redact_and_bound(&"x".repeat(20_000), "").chars().count() <= MAX_DIAGNOSTIC_CHARS);
        assert_eq!(
            redact_api_key("message: invalid sk-secret-value"),
            "message: invalid sk-***"
        );
        Ok(())
    }

    #[test]
    fn connection_failures_preserve_http_and_response_details() {
        let endpoint = reqwest::Url::parse("https://gateway.example/v1/models").unwrap();
        let unauthorized = format_http_failure(
            reqwest::StatusCode::UNAUTHORIZED,
            "{\n  \"error\": \"invalid api key sk-secret-value\"\n}",
            &endpoint,
            "sk-secret-value",
        );
        assert!(unauthorized.contains("HTTP 401 Unauthorized"));
        assert!(unauthorized.contains("Endpoint: https://gateway.example/v1/models"));
        assert!(unauthorized.contains("Response body:\n{\n  \"error\""));
        assert!(!unauthorized.contains("sk-secret-value"));
        assert!(!unauthorized.contains("认证失败"));
        assert!(format_http_failure(
            reqwest::StatusCode::NOT_FOUND,
            "",
            &reqwest::Url::parse("https://gateway.example/custom/models").unwrap(),
            "sk-test"
        )
        .contains("/custom/models"));
        let invalid = parse_model_count("<html>gateway</html>", "sk-test").unwrap_err();
        assert!(invalid.contains("JSON parse error:"));
        assert!(invalid.contains("Response body:\n<html>gateway</html>"));
    }

    #[test]
    fn structured_test_diagnostic_keeps_stage_code_detail_and_stack() {
        let result = failed_test(
            "models_request",
            "http_401",
            "请求模型列表 · HTTP 401 Unauthorized",
            "HTTP 401 Unauthorized\nResponse body:\ninvalid key sk-secret-value".to_owned(),
            "sk-secret-value",
        );
        let diagnostic = result.error.expect("diagnostic should be present");
        assert_eq!(diagnostic.stage, "models_request");
        assert_eq!(diagnostic.code, "http_401");
        assert_eq!(diagnostic.summary, "请求模型列表 · HTTP 401 Unauthorized");
        assert!(diagnostic.detail.contains("HTTP 401 Unauthorized"));
        assert!(!diagnostic.detail.contains("sk-secret-value"));
        assert!(diagnostic.stack.is_some());
    }

    #[test]
    fn harness_model_test_requires_a_complete_sse_stream() {
        let body = concat!(
            "data: {\"model\":\"model-a\",\"choices\":[{\"delta\":{\"content\":\"he\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"llo\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (model, content) = extract_streamed_message(body).expect("complete stream");
        assert_eq!(model.as_deref(), Some("model-a"));
        assert_eq!(content, "hello");
        assert!(extract_streamed_message("data: {\"choices\":[]}\n\n")
            .unwrap_err()
            .contains("without [DONE]"));
    }

    #[test]
    fn deepseek_requests_always_use_bearer_auth() -> Result<(), Box<dyn std::error::Error>> {
        let profile = AiProfile {
            id: "ai".to_owned(),
            name: "AI".to_owned(),
            base_url: "http://localhost".to_owned(),
            api_key_ref: "key".to_owned(),
            reasoning_effort: AiReasoningEffort::High,
            system_prompt: String::new(),
            models: vec![AiModelConfig {
                id: "primary".to_owned(),
                name: "主模型".to_owned(),
                model: "model".to_owned(),
                context_window: None,
                max_output_tokens: None,
                provider_profile_id: None,
                role: AiModelRole::Primary,
                enabled: true,
            }],
            routing: AiRoutingConfig::default(),
        };
        assert_eq!(profile.reasoning_effort, AiReasoningEffort::High);
        let request =
            with_auth(reqwest::Client::new().get("http://localhost"), "sk-test").build()?;
        assert_eq!(
            request.headers()[reqwest::header::AUTHORIZATION],
            "Bearer sk-test"
        );
        Ok(())
    }
}

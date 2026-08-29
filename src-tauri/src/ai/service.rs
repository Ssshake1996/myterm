use std::{backtrace::Backtrace, sync::Arc, time::Duration};

use reqwest::RequestBuilder;
use serde::{Deserialize, Serialize};
use tokio::sync::{watch, Mutex};

use crate::{
    config::{ConfigService, CredentialVault, DEFAULT_SYSTEM_PROMPT},
    session::manager::SessionManager,
    types::{AiAuthMode, AiMessage, AiProfile, AiRole},
    AppError,
};

const MAX_DIAGNOSTIC_CHARS: usize = 16_000;

pub trait DeltaSink: Send + Sync {
    fn send(&self, delta: &str) -> Result<(), AppError>;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatResult {
    pub finish_reason: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attached_context: Option<String>,
}

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
    sessions: Arc<SessionManager>,
    client: reqwest::Client,
    active: Mutex<Option<watch::Sender<bool>>>,
}

impl AiService {
    pub fn new(
        config: Arc<ConfigService>,
        vault: Arc<dyn CredentialVault>,
        sessions: Arc<SessionManager>,
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
            sessions,
            client,
            active: Mutex::new(None),
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
        let response = with_auth(self.client.get(models_endpoint.clone()), &profile, &key)
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
        let selected_model = model.trim();
        if !profile
            .effective_models()
            .iter()
            .any(|candidate| candidate.model == selected_model)
        {
            return Ok(failed_model_test(
                "validate_model",
                "model_not_configured",
                "校验测试模型 · model_not_configured",
                format!("模型 '{selected_model}' 未在当前 AI 配置中启用"),
                "",
            ));
        }
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
        let key = match self.vault.get(&profile.api_key_ref) {
            Ok(Some(value)) if !value.trim().is_empty() => value,
            Ok(_) => {
                return Ok(failed_model_test(
                    "read_api_key",
                    "api_key_missing",
                    "读取 API Key · api_key_missing",
                    "API Key 未配置：请填写 API Key 并保存配置".to_owned(),
                    "",
                ));
            }
            Err(error) => {
                return Ok(failed_model_test(
                    "read_api_key",
                    error.code(),
                    format!("读取 API Key · {}", error.code()),
                    error.detail(),
                    "",
                ));
            }
        };
        let chat_endpoint = match endpoint(&profile.base_url, "chat/completions") {
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
            stream: false,
        };
        let started = std::time::Instant::now();
        let response = match with_auth(self.client.post(chat_endpoint.clone()), &profile, &key)
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
        let value = match serde_json::from_str::<serde_json::Value>(&body) {
            Ok(value) => value,
            Err(error) => {
                return Ok(failed_model_test(
                    "parse_model_response",
                    "json_parse",
                    "解析模型测试响应 · json_parse",
                    format!(
                        "JSON parse error: {error}\nResponse body:\n{}",
                        redact_and_bound(&body, &key)
                    ),
                    &key,
                ));
            }
        };
        let Some(content) = extract_message_content(&value) else {
            return Ok(failed_model_test(
                "validate_model_response",
                "json_schema",
                "校验模型测试响应 · json_schema",
                format!(
                    "JSON validation error: $.choices[0].message.content is missing\nResponse body:\n{}",
                    redact_and_bound(&body, &key)
                ),
                &key,
            ));
        };
        Ok(AiModelTestResult {
            ok: true,
            model: Some(
                value
                    .get("model")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(selected_model)
                    .to_owned(),
            ),
            content: Some(content),
            elapsed_ms: Some(started.elapsed().as_millis()),
            raw_response: Some(redact_and_bound(&body, &key)),
            endpoint: Some(chat_endpoint.to_string()),
            error: None,
        })
    }

    pub async fn chat(
        &self,
        profile_id: &str,
        messages: Vec<AiMessage>,
        attach_session_id: Option<&str>,
        sink: Arc<dyn DeltaSink>,
    ) -> Result<AiChatResult, AppError> {
        let (abort_tx, abort_rx) = watch::channel(false);
        {
            let mut active = self.active.lock().await;
            if active.is_some() {
                return Err(AppError::Ai(
                    "another AI response is already in progress".to_owned(),
                ));
            }
            *active = Some(abort_tx);
        }
        let result = self
            .chat_inner(profile_id, messages, attach_session_id, sink, abort_rx)
            .await;
        *self.active.lock().await = None;
        result
    }

    pub async fn abort(&self) {
        if let Some(sender) = self.active.lock().await.as_ref() {
            let _ = sender.send(true);
        }
    }

    async fn chat_inner(
        &self,
        profile_id: &str,
        mut messages: Vec<AiMessage>,
        attach_session_id: Option<&str>,
        sink: Arc<dyn DeltaSink>,
        mut abort: watch::Receiver<bool>,
    ) -> Result<AiChatResult, AppError> {
        let profile = self.profile(profile_id)?;
        let attached_context = match attach_session_id {
            Some(session_id) => Some(self.attach_context(&profile, session_id, &mut messages)?),
            None => None,
        };
        let mut request_messages = Vec::with_capacity(messages.len() + 1);
        request_messages.push(AiMessage {
            role: AiRole::System,
            content: if profile.system_prompt.trim().is_empty() {
                DEFAULT_SYSTEM_PROMPT.to_owned()
            } else {
                profile.system_prompt.clone()
            },
        });
        request_messages.extend(messages);
        let key = self
            .vault
            .get(&profile.api_key_ref)?
            .ok_or_else(|| AppError::Ai("API key is not configured".to_owned()))?;
        let started = std::time::Instant::now();
        let chat_endpoint = endpoint(&profile.base_url, "chat/completions")?;
        let candidates = profile.effective_models();
        if candidates.is_empty() {
            return Err(AppError::Ai(
                "没有启用任何 AI 模型，请在配置中添加主模型".to_owned(),
            ));
        }
        let mut failures = Vec::new();
        let mut selected_model = String::new();
        let mut response = None;
        for (index, candidate) in candidates.iter().enumerate() {
            if index > 0 && !profile.routing.fallback_on_error {
                break;
            }
            let request = ChatRequest {
                model: &candidate.model,
                messages: request_messages
                    .iter()
                    .map(|message| RequestMessage {
                        role: match message.role {
                            AiRole::System => "system",
                            AiRole::User => "user",
                            AiRole::Assistant => "assistant",
                        },
                        content: &message.content,
                    })
                    .collect(),
                stream: true,
            };
            let attempt = with_auth(self.client.post(chat_endpoint.clone()), &profile, &key)
                .json(&request)
                .send()
                .await;
            let candidate_response = match attempt {
                Ok(value) => value,
                Err(error) => {
                    failures.push(format!(
                        "{}: {}",
                        candidate.model,
                        format_transport_failure(error, &chat_endpoint)
                    ));
                    continue;
                }
            };
            let status = candidate_response.status();
            if !status.is_success() {
                let body = candidate_response.text().await.map_err(|error| {
                    AppError::Ai(format_transport_failure(error, &chat_endpoint))
                })?;
                failures.push(format!(
                    "{}: {}",
                    candidate.model,
                    format_http_failure(status, &body, &chat_endpoint, &key)
                ));
                continue;
            }
            selected_model = candidate.model.clone();
            response = Some(candidate_response);
            break;
        }
        let mut response = response.ok_or_else(|| {
            AppError::Ai(format!("所有启用模型均请求失败:\n{}", failures.join("\n")))
        })?;
        let mut decoder = SseDecoder::default();
        loop {
            let chunk = tokio::select! {
                changed = abort.changed() => {
                    if changed.is_ok() && *abort.borrow() {
                        tracing::info!(profile_id, model = %selected_model, elapsed_ms = started.elapsed().as_millis(), "AI response aborted");
                        return Ok(AiChatResult { finish_reason: "aborted", attached_context });
                    }
                    continue;
                }
                chunk = response.chunk() => chunk.map_err(|error| AppError::Ai(format_transport_failure(error, &chat_endpoint)))?,
            };
            let Some(chunk) = chunk else {
                break;
            };
            for delta in decoder.feed(&chunk)? {
                sink.send(&delta)?;
            }
            if decoder.done {
                break;
            }
        }
        tracing::info!(profile_id, model = %selected_model, elapsed_ms = started.elapsed().as_millis(), "AI response completed");
        Ok(AiChatResult {
            finish_reason: "stop",
            attached_context,
        })
    }

    fn attach_context(
        &self,
        _profile: &AiProfile,
        session_id: &str,
        messages: &mut [AiMessage],
    ) -> Result<String, AppError> {
        let snapshot = self.sessions.buffer_snapshot(session_id)?;
        let session = self
            .sessions
            .list()?
            .into_iter()
            .find(|session| session.session_id == session_id)
            .ok_or_else(|| AppError::NotFound(format!("session '{session_id}'")))?;
        let profile_name = self
            .config
            .profile_list()?
            .into_iter()
            .find(|candidate| candidate.id == session.profile_id)
            .map_or(session.profile_id, |candidate| candidate.name);
        let context = format!(
            "[Terminal transcript of session \"{profile_name}\" (captured bytes: {})]\n```\n{snapshot}\n```",
            snapshot.len()
        );
        let last_user = messages
            .iter_mut()
            .rev()
            .find(|message| message.role == AiRole::User)
            .ok_or_else(|| AppError::InvalidInput("AI chat requires a user message".to_owned()))?;
        last_user.content = format!("{context}\n\n{}", last_user.content);
        Ok(context)
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
}

#[derive(Serialize)]
struct RequestMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct StreamPayload {
    #[serde(default)]
    choices: Vec<StreamChoice>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
}

#[derive(Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[derive(Default)]
struct SseDecoder {
    pending: Vec<u8>,
    done: bool,
}

impl SseDecoder {
    fn feed(&mut self, chunk: &[u8]) -> Result<Vec<String>, AppError> {
        self.pending.extend_from_slice(chunk);
        let mut deltas = Vec::new();
        while let Some(position) = self.pending.iter().position(|byte| *byte == b'\n') {
            let mut line: Vec<u8> = self.pending.drain(..=position).collect();
            while line
                .last()
                .is_some_and(|byte| *byte == b'\n' || *byte == b'\r')
            {
                line.pop();
            }
            let line = String::from_utf8_lossy(&line);
            let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if data == "[DONE]" {
                self.done = true;
                break;
            }
            if data.is_empty() {
                continue;
            }
            let payload: StreamPayload = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if let Some(content) = payload
                .choices
                .first()
                .and_then(|choice| choice.delta.content.clone())
            {
                deltas.push(content);
            }
        }
        Ok(deltas)
    }
}

pub(crate) fn endpoint(base_url: &str, path: &str) -> Result<reqwest::Url, AppError> {
    let mut url = reqwest::Url::parse(base_url)
        .map_err(|error| AppError::InvalidInput(format!("invalid AI base URL: {error}")))?;
    let configured_path = url.path().trim_end_matches('/');
    let api_root = if configured_path.is_empty() {
        "/v1"
    } else {
        configured_path
    };
    url.set_path(&format!("{api_root}/{}", path.trim_start_matches('/')));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

pub(crate) fn with_auth(request: RequestBuilder, profile: &AiProfile, key: &str) -> RequestBuilder {
    match profile.auth_mode {
        AiAuthMode::Bearer => request.bearer_auth(key),
        AiAuthMode::ApiKey => request.header(reqwest::header::AUTHORIZATION, key),
    }
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

fn extract_message_content(value: &serde_json::Value) -> Option<String> {
    let content = value.pointer("/choices/0/message/content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_owned());
    }
    let parts = content.as_array()?;
    let text = parts
        .iter()
        .filter_map(|part| {
            part.get("text")
                .and_then(serde_json::Value::as_str)
                .or_else(|| {
                    part.pointer("/text/value")
                        .and_then(serde_json::Value::as_str)
                })
        })
        .collect::<Vec<_>>()
        .join("");
    (!text.is_empty()).then_some(text)
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
        endpoint, extract_message_content, failed_test, format_http_failure, parse_model_count,
        redact_and_bound, redact_api_key, with_auth, SseDecoder, MAX_DIAGNOSTIC_CHARS,
    };
    use crate::types::{AiAuthMode, AiModelConfig, AiModelRole, AiProfile, AiRoutingConfig};

    #[test]
    fn parses_split_sse_and_ignores_unknown_lines() -> Result<(), Box<dyn std::error::Error>> {
        let mut decoder = SseDecoder::default();
        let mut deltas =
            decoder.feed(b": keepalive\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"hel")?;
        deltas.extend(decoder.feed(b"lo\"}}]}\n\ndata: {\"unknown\":true}\n")?);
        deltas.extend(decoder.feed(b"data: [DONE]\n\n")?);
        assert_eq!(deltas, vec!["hello"]);
        assert!(decoder.done);
        Ok(())
    }

    #[test]
    fn endpoint_and_diagnostics_are_bounded() -> Result<(), Box<dyn std::error::Error>> {
        assert_eq!(
            endpoint("http://localhost:11434/v1/", "models")?.as_str(),
            "http://localhost:11434/v1/models"
        );
        assert_eq!(
            endpoint("http://localhost:11434", "chat/completions")?.as_str(),
            "http://localhost:11434/v1/chat/completions"
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
    fn extracts_text_from_string_and_structured_chat_content() {
        let plain = serde_json::json!({
            "choices": [{ "message": { "content": "pong" } }]
        });
        assert_eq!(extract_message_content(&plain).as_deref(), Some("pong"));

        let structured = serde_json::json!({
            "choices": [{
                "message": {
                    "content": [
                        { "type": "text", "text": "hello " },
                        { "type": "output_text", "text": { "value": "world" } }
                    ]
                }
            }]
        });
        assert_eq!(
            extract_message_content(&structured).as_deref(),
            Some("hello world")
        );
    }

    #[test]
    fn auth_mode_builds_bearer_or_raw_authorization_header(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut profile = AiProfile {
            id: "ai".to_owned(),
            name: "AI".to_owned(),
            base_url: "http://localhost".to_owned(),
            api_key_ref: "key".to_owned(),
            auth_mode: AiAuthMode::Bearer,
            model: "model".to_owned(),
            system_prompt: String::new(),
            context_lines: 80,
            models: vec![AiModelConfig {
                id: "primary".to_owned(),
                name: "主模型".to_owned(),
                model: "model".to_owned(),
                role: AiModelRole::Primary,
                enabled: true,
                context_window_tokens: None,
                compact_threshold_tokens: None,
            }],
            routing: AiRoutingConfig::default(),
        };
        let request = with_auth(
            reqwest::Client::new().get("http://localhost"),
            &profile,
            "sk-test",
        )
        .build()?;
        assert_eq!(
            request.headers()[reqwest::header::AUTHORIZATION],
            "Bearer sk-test"
        );

        profile.auth_mode = AiAuthMode::ApiKey;
        let request = with_auth(
            reqwest::Client::new().get("http://localhost"),
            &profile,
            "sk-test",
        )
        .build()?;
        assert_eq!(request.headers()[reqwest::header::AUTHORIZATION], "sk-test");
        Ok(())
    }
}

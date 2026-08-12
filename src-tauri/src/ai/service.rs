use std::{sync::Arc, time::Duration};

use reqwest::RequestBuilder;
use serde::{Deserialize, Serialize};
use tokio::sync::{watch, Mutex};

use crate::{
    config::{ConfigService, CredentialVault, DEFAULT_SYSTEM_PROMPT},
    session::manager::SessionManager,
    types::{AiAuthMode, AiMessage, AiProfile, AiRole},
    AppError,
};

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
pub struct AiTestResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
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

    pub async fn test_connection(&self, profile_id: &str) -> Result<AiTestResult, AppError> {
        let profile = self.profile(profile_id)?;
        let key = self.vault.get(&profile.api_key_ref)?.unwrap_or_default();
        let response = with_auth(
            self.client.get(endpoint(&profile.base_url, "models")?),
            &profile,
            &key,
        )
        .send()
        .await
        .map_err(|error| AppError::Ai(error.to_string()))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| AppError::Ai(error.to_string()))?;
        if !status.is_success() {
            return Ok(AiTestResult {
                ok: false,
                models: None,
                error: Some(format!("HTTP {}: {}", status.as_u16(), summarize(&body))),
            });
        }
        let models = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value.get("data")?.as_array().map(Vec::len));
        Ok(AiTestResult {
            ok: true,
            models,
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
        let request = ChatRequest {
            model: &profile.model,
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
        let key = self
            .vault
            .get(&profile.api_key_ref)?
            .ok_or_else(|| AppError::Ai("API key is not configured".to_owned()))?;
        let started = std::time::Instant::now();
        let mut response = with_auth(
            self.client
                .post(endpoint(&profile.base_url, "chat/completions")?),
            &profile,
            &key,
        )
        .json(&request)
        .send()
        .await
        .map_err(|error| AppError::Ai(error.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            let body = response
                .text()
                .await
                .map_err(|error| AppError::Ai(error.to_string()))?;
            return Err(AppError::Ai(format!(
                "HTTP {}: {}",
                status.as_u16(),
                summarize(&body)
            )));
        }
        let mut decoder = SseDecoder::default();
        loop {
            let chunk = tokio::select! {
                changed = abort.changed() => {
                    if changed.is_ok() && *abort.borrow() {
                        tracing::info!(profile_id, model = %profile.model, elapsed_ms = started.elapsed().as_millis(), "AI response aborted");
                        return Ok(AiChatResult { finish_reason: "aborted", attached_context });
                    }
                    continue;
                }
                chunk = response.chunk() => chunk.map_err(|error| AppError::Ai(error.to_string()))?,
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
        tracing::info!(profile_id, model = %profile.model, elapsed_ms = started.elapsed().as_millis(), "AI response completed");
        Ok(AiChatResult {
            finish_reason: "stop",
            attached_context,
        })
    }

    fn attach_context(
        &self,
        profile: &AiProfile,
        session_id: &str,
        messages: &mut [AiMessage],
    ) -> Result<String, AppError> {
        let snapshot = self
            .sessions
            .buffer_lines(session_id, profile.context_lines as usize)?;
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
            "[Terminal output of session \"{profile_name}\" (last {} lines)]\n```\n{snapshot}\n```",
            profile.context_lines
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

pub(crate) fn summarize(body: &str) -> String {
    let clean = body.replace(['\r', '\n'], " ");
    clean.chars().take(512).collect()
}

#[cfg(test)]
mod tests {
    use super::{endpoint, summarize, with_auth, SseDecoder};
    use crate::types::{AiAuthMode, AiProfile};

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
    fn endpoint_and_error_summary_are_bounded() -> Result<(), Box<dyn std::error::Error>> {
        assert_eq!(
            endpoint("http://localhost:11434/v1/", "models")?.as_str(),
            "http://localhost:11434/v1/models"
        );
        assert_eq!(
            endpoint("http://localhost:11434", "chat/completions")?.as_str(),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(summarize("line one\nline two"), "line one line two");
        assert_eq!(summarize(&"x".repeat(600)).len(), 512);
        Ok(())
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

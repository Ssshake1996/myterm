use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoreConfig {
    pub base_url: String,
    pub model: String,
    pub state_dir: String,
    #[serde(default = "default_request_timeout_ms")]
    pub request_timeout_ms: u64,
    #[serde(default = "default_context_window_tokens")]
    pub context_window_tokens: usize,
    #[serde(default = "default_compact_threshold_tokens")]
    pub compact_threshold_tokens: usize,
    #[serde(default = "default_max_steps")]
    pub max_steps: usize,
    #[serde(default)]
    pub system_prompt: String,
}

fn default_request_timeout_ms() -> u64 {
    120_000
}

fn default_context_window_tokens() -> usize {
    128_000
}

fn default_compact_threshold_tokens() -> usize {
    96_000
}

fn default_max_steps() -> usize {
    64
}

impl CoreConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.base_url.trim().is_empty() {
            return Err("baseUrl must not be empty".to_owned());
        }
        if self.model.trim().is_empty() {
            return Err("model must not be empty".to_owned());
        }
        if self.state_dir.trim().is_empty() {
            return Err("stateDir must not be empty".to_owned());
        }
        if self.request_timeout_ms == 0 {
            return Err("requestTimeoutMs must be greater than zero".to_owned());
        }
        if self.compact_threshold_tokens == 0
            || self.compact_threshold_tokens >= self.context_window_tokens
        {
            return Err(
                "compactThresholdTokens must be greater than zero and lower than contextWindowTokens"
                    .to_owned(),
            );
        }
        if self.max_steps == 0 {
            return Err("maxSteps must be greater than zero".to_owned());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ChatMessage {
    pub role: MessageRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

impl ChatMessage {
    pub fn text(role: MessageRole, content: impl Into<String>) -> Self {
        Self {
            role,
            content: Some(content.into()),
            tool_calls: Vec::new(),
            tool_call_id: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ToolCall {
    pub index: usize,
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChatCompletionsRequest {
    pub model: String,
    pub messages: Vec<Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<ChatToolDefinition>,
    pub stream: bool,
    pub stream_options: StreamOptions,
}

#[derive(Clone, Debug)]
pub struct ModelRequest {
    pub messages: Vec<ChatMessage>,
    pub tools: Vec<ToolDefinition>,
}

#[derive(Clone, Debug, Serialize)]
pub struct StreamOptions {
    pub include_usage: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChatToolDefinition {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub function: ToolFunctionDefinition,
}

#[derive(Clone, Debug, Serialize)]
pub struct ToolFunctionDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

impl From<ToolDefinition> for ChatToolDefinition {
    fn from(value: ToolDefinition) -> Self {
        Self {
            kind: "function",
            function: ToolFunctionDefinition {
                name: value.name,
                description: value.description,
                parameters: value.parameters,
            },
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenUsage {
    #[serde(default)]
    pub prompt_tokens: u64,
    #[serde(default)]
    pub completion_tokens: u64,
    #[serde(default)]
    pub total_tokens: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelResponse {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub finish_reason: String,
    pub usage: Option<TokenUsage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvocation {
    pub thread_id: String,
    pub call_id: String,
    pub name: String,
    pub arguments: Value,
    pub target: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecutionResult {
    pub content: String,
    #[serde(default)]
    pub is_error: bool,
    #[serde(default)]
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RuntimeEvent {
    ThreadCreated {
        thread_id: String,
        parent_thread_id: Option<String>,
        role: String,
    },
    TurnStarted {
        thread_id: String,
    },
    TextDelta {
        thread_id: String,
        delta: String,
    },
    ToolRequested {
        thread_id: String,
        call_id: String,
        name: String,
        arguments_summary: String,
    },
    ToolCompleted {
        thread_id: String,
        call_id: String,
        name: String,
        is_error: bool,
    },
    CompactionStarted {
        thread_id: String,
        estimated_tokens: usize,
    },
    CompactionRetrying {
        thread_id: String,
        retry: usize,
        max_retries: usize,
        code: String,
        detail: String,
    },
    CompactionCompleted {
        thread_id: String,
        revision: u64,
    },
    CompactionFailed {
        thread_id: String,
        code: String,
        detail: String,
    },
    SubagentStatus {
        root_thread_id: String,
        thread_id: String,
        status: String,
    },
    TurnCompleted {
        thread_id: String,
        finish_reason: String,
    },
    Error {
        thread_id: String,
        code: String,
        phase: String,
        detail: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnResult {
    pub thread_id: String,
    pub text: String,
    pub finish_reason: String,
    pub usage: Option<TokenUsage>,
    pub steps: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSnapshot {
    pub thread_id: String,
    pub parent_thread_id: Option<String>,
    pub role: String,
    pub status: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub summary_revision: u64,
    pub message_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub parent_thread_id: String,
    pub child_thread_id: String,
    pub status: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub summary_revision: u64,
}

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("configuration error: {0}")]
    Configuration(String),
    #[error("state store error during {operation}: {detail}")]
    Store {
        operation: &'static str,
        detail: String,
    },
    #[error("model request failed during {phase}: {detail}")]
    Model {
        phase: &'static str,
        code: String,
        status: Option<u16>,
        detail: String,
        response_body: Option<String>,
    },
    #[error("SSE stream is malformed: {0}")]
    MalformedSse(String),
    #[error("model returned an empty response")]
    EmptyResponse,
    #[error("compaction failed: {code}: {detail}")]
    CompactionFailed { code: String, detail: String },
    #[error("thread not found: {0}")]
    ThreadNotFound(String),
    #[error("thread is already active: {0}")]
    ThreadBusy(String),
    #[error("runtime is disposed")]
    Disposed,
    #[error("turn cancelled: {0}")]
    Cancelled(String),
    #[error("tool execution failed for {tool}: {detail}")]
    Tool { tool: String, detail: String },
    #[error("subagent failed for {thread_id}: {detail}")]
    Subagent { thread_id: String, detail: String },
    #[error("agent loop exceeded {0} steps")]
    StepLimit(usize),
    #[error("invalid model tool call: {0}")]
    InvalidToolCall(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEnvelope<'a> {
    code: &'a str,
    phase: &'a str,
    message: String,
    status: Option<u16>,
    detail: String,
    response_body: Option<&'a str>,
}

impl CoreError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Configuration(_) => "CONFIGURATION_ERROR",
            Self::Store { .. } => "STORE_ERROR",
            Self::Model { .. } => "MODEL_REQUEST_FAILED",
            Self::MalformedSse(_) => "MALFORMED_SSE",
            Self::EmptyResponse => "EMPTY_RESPONSE",
            Self::CompactionFailed { .. } => "COMPACTION_FAILED",
            Self::ThreadNotFound(_) => "THREAD_NOT_FOUND",
            Self::ThreadBusy(_) => "THREAD_BUSY",
            Self::Disposed => "RUNTIME_DISPOSED",
            Self::Cancelled(_) => "TURN_CANCELLED",
            Self::Tool { .. } => "TOOL_EXECUTION_FAILED",
            Self::Subagent { .. } => "SUBAGENT_FAILED",
            Self::StepLimit(_) => "STEP_LIMIT",
            Self::InvalidToolCall(_) => "INVALID_TOOL_CALL",
        }
    }

    pub fn phase(&self) -> &'static str {
        match self {
            Self::Configuration(_) => "configuration",
            Self::Store { operation, .. } => operation,
            Self::Model { phase, .. } => phase,
            Self::MalformedSse(_) | Self::EmptyResponse => "model_stream",
            Self::CompactionFailed { .. } => "compaction",
            Self::ThreadNotFound(_) | Self::ThreadBusy(_) => "thread",
            Self::Disposed => "lifecycle",
            Self::Cancelled(_) => "turn",
            Self::Tool { .. } | Self::InvalidToolCall(_) => "tool",
            Self::Subagent { .. } => "subagent",
            Self::StepLimit(_) => "agent_loop",
        }
    }

    pub fn diagnostic_code(&self) -> &str {
        match self {
            Self::Model { code, .. } => code,
            _ => self.code(),
        }
    }

    pub fn detail(&self) -> String {
        match self {
            Self::Configuration(detail)
            | Self::MalformedSse(detail)
            | Self::Cancelled(detail)
            | Self::InvalidToolCall(detail) => detail.clone(),
            Self::Store { detail, .. }
            | Self::Model { detail, .. }
            | Self::CompactionFailed { detail, .. }
            | Self::Tool { detail, .. }
            | Self::Subagent { detail, .. } => detail.clone(),
            Self::ThreadNotFound(id) | Self::ThreadBusy(id) => id.clone(),
            Self::Disposed => "runtime is disposed".to_owned(),
            Self::EmptyResponse => "the stream contained no text and no tool calls".to_owned(),
            Self::StepLimit(limit) => format!("maximum step count {limit} was reached"),
        }
    }

    pub fn to_json(&self) -> String {
        let (status, response_body) = match self {
            Self::Model {
                status,
                response_body,
                ..
            } => (*status, response_body.as_deref()),
            _ => (None, None),
        };
        serde_json::to_string(&ErrorEnvelope {
            code: self.diagnostic_code(),
            phase: self.phase(),
            message: self.to_string(),
            status,
            detail: self.detail(),
            response_body,
        })
        .unwrap_or_else(|_| self.to_string())
    }
}

impl From<rusqlite::Error> for CoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Store {
            operation: "sqlite",
            detail: value.to_string(),
        }
    }
}

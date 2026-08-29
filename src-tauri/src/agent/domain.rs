use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::types::AgentPermissionMode;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentTaskState {
    Queued,
    Running,
    WaitingApproval,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentGoalStatus {
    Active,
    Paused,
    WaitingApproval,
    WaitingExternal,
    Blocked,
    BudgetLimited,
    UsageLimited,
    Completed,
    Failed,
    Canceled,
}

impl AgentGoalStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Canceled)
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        if self == next {
            return true;
        }
        if self.is_terminal() {
            return false;
        }
        match next {
            Self::Active => matches!(
                self,
                Self::Paused
                    | Self::WaitingApproval
                    | Self::WaitingExternal
                    | Self::Blocked
                    | Self::BudgetLimited
                    | Self::UsageLimited
            ),
            Self::Paused
            | Self::WaitingApproval
            | Self::WaitingExternal
            | Self::Blocked
            | Self::BudgetLimited
            | Self::UsageLimited
            | Self::Completed
            | Self::Failed
            | Self::Canceled => true,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
            Self::WaitingApproval => "waiting_approval",
            Self::WaitingExternal => "waiting_external",
            Self::Blocked => "blocked",
            Self::BudgetLimited => "budget_limited",
            Self::UsageLimited => "usage_limited",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
        }
    }
}

impl TryFrom<&str> for AgentGoalStatus {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            "waiting_approval" => Ok(Self::WaitingApproval),
            "waiting_external" => Ok(Self::WaitingExternal),
            "blocked" => Ok(Self::Blocked),
            "budget_limited" => Ok(Self::BudgetLimited),
            "usage_limited" => Ok(Self::UsageLimited),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "canceled" => Ok(Self::Canceled),
            _ => Err(format!("unknown goal status '{value}'")),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGoal {
    pub id: String,
    pub conversation_id: String,
    pub objective: String,
    pub status: AgentGoalStatus,
    pub token_budget: Option<u64>,
    pub tokens_used: u64,
    pub continuation_count: u32,
    pub current_turn_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub last_checkpoint: Option<Value>,
    pub last_error: Option<String>,
    pub blocked_reason: Option<String>,
    pub no_progress_count: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentInputMode {
    Steer,
    Queue,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentQueuedInput {
    pub id: String,
    pub conversation_id: String,
    pub goal_id: Option<String>,
    pub content: String,
    pub mode: AgentInputMode,
    pub state: String,
    pub created_at_ms: i64,
    pub consumed_at_ms: Option<i64>,
}

impl AgentTaskState {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Canceled)
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        if self.is_terminal() {
            return false;
        }
        matches!(
            (self, next),
            (Self::Queued, Self::Running | Self::Canceled | Self::Failed)
                | (
                    Self::Running,
                    Self::WaitingApproval | Self::Succeeded | Self::Failed | Self::Canceled
                )
                | (
                    Self::WaitingApproval,
                    Self::Running | Self::Failed | Self::Canceled
                )
        )
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::WaitingApproval => "waiting_approval",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
        }
    }
}

impl TryFrom<&str> for AgentTaskState {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "waiting_approval" => Ok(Self::WaitingApproval),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            "canceled" => Ok(Self::Canceled),
            _ => Err(format!("unknown task state '{value}'")),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversation {
    pub id: String,
    pub title: String,
    pub profile_id: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub turn_count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTask {
    pub id: String,
    pub conversation_id: String,
    pub goal_id: Option<String>,
    pub turn_index: u32,
    pub continuation_index: u32,
    pub profile_id: String,
    pub session_id: Option<String>,
    pub prompt: String,
    pub state: AgentTaskState,
    pub permission_mode: AgentPermissionMode,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub finish_reason: Option<String>,
    pub steps: u8,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    pub id: String,
    pub task_id: String,
    pub tool_name: String,
    pub arguments: Value,
    pub state: String,
    pub result_preview: Option<String>,
    pub is_error: bool,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub task_id: String,
    pub tool_call_id: String,
    pub risk: String,
    pub reason: String,
    pub state: String,
    pub expires_at_ms: i64,
    pub decided_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionJob {
    pub id: String,
    pub task_id: String,
    pub goal_id: Option<String>,
    pub conversation_id: Option<String>,
    pub tool_call_id: String,
    pub state: String,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub artifact_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventEnvelope {
    pub schema_version: u16,
    pub task_id: String,
    pub sequence: u64,
    pub created_at_ms: i64,
    pub event_type: String,
    pub payload: Value,
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            duration.as_millis().min(i64::MAX as u128) as i64
        })
}

#[cfg(test)]
mod tests {
    use super::{AgentGoalStatus, AgentTaskState};

    #[test]
    fn state_machine_allows_only_forward_non_terminal_transitions() {
        assert!(AgentTaskState::Queued.can_transition_to(AgentTaskState::Running));
        assert!(AgentTaskState::Running.can_transition_to(AgentTaskState::WaitingApproval));
        assert!(AgentTaskState::WaitingApproval.can_transition_to(AgentTaskState::Running));
        assert!(AgentTaskState::Running.can_transition_to(AgentTaskState::Succeeded));
        assert!(!AgentTaskState::Queued.can_transition_to(AgentTaskState::Succeeded));
        assert!(!AgentTaskState::Succeeded.can_transition_to(AgentTaskState::Running));
        assert!(!AgentTaskState::Failed.can_transition_to(AgentTaskState::Canceled));
    }

    #[test]
    fn goal_state_machine_supports_pause_resume_and_terminal_guards() {
        assert!(AgentGoalStatus::Active.can_transition_to(AgentGoalStatus::Paused));
        assert!(AgentGoalStatus::Paused.can_transition_to(AgentGoalStatus::Active));
        assert!(AgentGoalStatus::WaitingExternal.can_transition_to(AgentGoalStatus::Active));
        assert!(AgentGoalStatus::Active.can_transition_to(AgentGoalStatus::Completed));
        assert!(!AgentGoalStatus::Completed.can_transition_to(AgentGoalStatus::Active));
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvidence {
    pub id: String,
    pub goal_id: String,
    pub conversation_id: String,
    pub task_id: String,
    pub capability_id: String,
    pub artifact_path: String,
    pub bytes: u64,
    pub created_at_ms: i64,
}

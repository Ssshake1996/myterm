use crate::types::AgentPluginInfo;

pub const MULTI_SSH_COORDINATOR_ID: &str = "multi-ssh-coordinator";

pub fn multi_ssh_plugin_info() -> AgentPluginInfo {
    AgentPluginInfo {
        id: MULTI_SSH_COORDINATOR_ID.to_owned(),
        name: "Multi-SSH Coordinator".to_owned(),
        version: "0.1.0".to_owned(),
        kind: "builtin-plugin".to_owned(),
        description: "通过目标目录、自动连接和显式 session_id 编排多个 SSH 目标的串行协同插件。"
            .to_owned(),
        requires: vec![
            "ssh.operations".to_owned(),
            "session.catalog".to_owned(),
            "policy".to_owned(),
            "audit".to_owned(),
        ],
        enabled: true,
    }
}

pub fn system_prompt() -> &'static str {
    "Built-in Multi-SSH Coordinator Skill (serial and auditable): the UI's active SSH is only a candidate. Use it with use_active_session=true when the user refers to the current terminal, this server, the visible SSH, or output that is visibly under discussion. Do not touch it for general questions, MCP diagnostics, Skills, or unrelated tasks. When a user names a saved server or environment, call session_catalog first. For every target that is not already connected, call session_connect with the exact profile_id or profile_name returned by the catalog. Use the returned session_id explicitly on every later terminal, remote execution, host-facts, runbook, SFTP, and file tool call. Coordinate targets serially by default: finish and verify target A before acting on target B, and carry only structured evidence between targets. If the target is ambiguous, ask instead of inferring from UI focus. Never claim a saved profile is reachable until session_connect succeeds, and stop the workflow when a required target or prerequisite fails. This built-in workflow cannot bypass policy, approval, cancellation, timeout, or audit rules."
}

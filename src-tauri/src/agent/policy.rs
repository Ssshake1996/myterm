use serde::{Deserialize, Serialize};
use serde_json::Value;
use tree_sitter::{Node, Parser};

use crate::types::{AgentPermissionMode, SessionEnvironment};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolEffect {
    Read,
    Execute,
    Write,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyAction {
    Allow,
    Ask,
    Deny,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDecision {
    pub action: PolicyAction,
    pub effect: ToolEffect,
    pub risk: RiskLevel,
    pub reason: String,
    pub commands: Vec<String>,
    pub resources: Vec<String>,
    pub parsed: bool,
}

#[derive(Clone, Copy)]
pub struct PolicyContext {
    pub mode: AgentPermissionMode,
    pub environment: SessionEnvironment,
    pub is_root: bool,
}

pub fn evaluate_tool(name: &str, arguments: &Value, context: PolicyContext) -> PolicyDecision {
    match name {
        "terminal_context" | "session_info" | "session_catalog" | "session_connect"
        | "list_directory" | "file_stat" | "file_read" | "file_search" | "host_facts"
        | "runbook" | "job_status" | "job_output" | "capability_search" | "evidence_read"
        | "skill_load" => decide(Analysis::read("built-in read-only tool"), context),
        "job_cancel" => decide(
            Analysis {
                effect: ToolEffect::Execute,
                risk: RiskLevel::Medium,
                reason: "running background execution will be canceled".to_owned(),
                commands: vec![name.to_owned()],
                resources: arguments
                    .get("job_id")
                    .and_then(Value::as_str)
                    .map(|value| vec![value.to_owned()])
                    .unwrap_or_default(),
                parsed: arguments.get("job_id").and_then(Value::as_str).is_some(),
                hard_deny: false,
            },
            context,
        ),
        "file_write" | "file_patch" => {
            let path = arguments
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default();
            decide(
                Analysis {
                    effect: ToolEffect::Write,
                    risk: if contains_protected_path(path) {
                        RiskLevel::Critical
                    } else {
                        RiskLevel::High
                    },
                    reason: "remote file content will be changed".to_owned(),
                    commands: vec![name.to_owned()],
                    resources: vec![path.to_owned()],
                    parsed: !path.is_empty(),
                    hard_deny: path == "/" || path.starts_with("/boot/"),
                },
                context,
            )
        }
        "remote_exec" | "terminal_send" | "cli_execute" => {
            let command = arguments
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default();
            decide(analyze_bash(command), context)
        }
        "cli_execute_batch" => {
            let commands = arguments
                .get("commands")
                .and_then(Value::as_array)
                .map(|commands| {
                    commands
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            decide(analyze_command_batch(&commands), context)
        }
        _ => decide(
            Analysis {
                effect: ToolEffect::Execute,
                risk: RiskLevel::High,
                reason: "external tool effects are not statically known".to_owned(),
                commands: vec![name.to_owned()],
                resources: Vec::new(),
                parsed: false,
                hard_deny: false,
            },
            context,
        ),
    }
}

fn analyze_command_batch(commands: &[&str]) -> Analysis {
    if commands.is_empty() {
        return unknown("CLI command batch is empty or invalid");
    }
    let mut combined = Analysis::read("read-only command batch");
    for command in commands {
        let current = analyze_bash(command);
        combined.effect = combined.effect.max(current.effect);
        combined.risk = combined.risk.max(current.risk);
        combined.commands.extend(current.commands);
        combined.resources.extend(current.resources);
        combined.parsed &= current.parsed;
        combined.hard_deny |= current.hard_deny;
    }
    combined.commands.sort();
    combined.commands.dedup();
    combined.resources.sort();
    combined.resources.dedup();
    combined.reason = if combined.hard_deny {
        "CLI command batch contains a non-overridable destructive operation".to_owned()
    } else {
        format!("CLI command batch contains {} command(s)", commands.len())
    };
    combined
}

fn decide(analysis: Analysis, context: PolicyContext) -> PolicyDecision {
    let action = if analysis.hard_deny {
        PolicyAction::Deny
    } else {
        match context.mode {
            AgentPermissionMode::ReadOnly => {
                if analysis.effect == ToolEffect::Read && analysis.parsed {
                    PolicyAction::Allow
                } else {
                    PolicyAction::Deny
                }
            }
            AgentPermissionMode::Confirm => {
                if analysis.effect == ToolEffect::Read
                    && analysis.risk == RiskLevel::Low
                    && analysis.parsed
                {
                    PolicyAction::Allow
                } else {
                    PolicyAction::Ask
                }
            }
            AgentPermissionMode::FullAccess => PolicyAction::Allow,
        }
    };
    PolicyDecision {
        action,
        effect: analysis.effect,
        risk: analysis.risk,
        reason: analysis.reason,
        commands: analysis.commands,
        resources: analysis.resources,
        parsed: analysis.parsed,
    }
}

struct Analysis {
    effect: ToolEffect,
    risk: RiskLevel,
    reason: String,
    commands: Vec<String>,
    resources: Vec<String>,
    parsed: bool,
    hard_deny: bool,
}

impl Analysis {
    fn read(reason: &str) -> Self {
        Self {
            effect: ToolEffect::Read,
            risk: RiskLevel::Low,
            reason: reason.to_owned(),
            commands: Vec::new(),
            resources: Vec::new(),
            parsed: true,
            hard_deny: false,
        }
    }
}

fn analyze_bash(source: &str) -> Analysis {
    if source.trim().is_empty() {
        return unknown("empty command");
    }
    let mut parser = Parser::new();
    if parser
        .set_language(&tree_sitter_bash::LANGUAGE.into())
        .is_err()
    {
        return unknown("Bash parser is unavailable");
    }
    let Some(tree) = parser.parse(source, None) else {
        return unknown("Bash parser returned no syntax tree");
    };
    let root = tree.root_node();
    if root.has_error() {
        return unknown("command contains unrecognized Bash syntax");
    }

    let mut analysis = Analysis::read("read-only command");
    collect_nodes(root, source.as_bytes(), &mut analysis);
    if analysis.commands.is_empty() {
        return unknown("no executable command could be identified");
    }
    analysis.commands.sort();
    analysis.commands.dedup();
    analysis.resources.sort();
    analysis.resources.dedup();
    analysis.reason = if analysis.hard_deny {
        "command matches a non-overridable destructive operation".to_owned()
    } else {
        match (analysis.effect, analysis.risk) {
            (ToolEffect::Read, RiskLevel::Low) => "read-only command".to_owned(),
            (ToolEffect::Read, _) => "read command uses dynamic shell evaluation".to_owned(),
            (ToolEffect::Execute, _) => "command changes process or service state".to_owned(),
            (ToolEffect::Write, _) => "command writes system or file state".to_owned(),
        }
    };
    analysis
}

fn collect_nodes(node: Node<'_>, source: &[u8], analysis: &mut Analysis) {
    match node.kind() {
        "command" => analyze_command(node, source, analysis),
        "command_substitution" | "process_substitution" | "subshell" => {
            analysis.risk = analysis.risk.max(RiskLevel::High);
        }
        "file_redirect" | "heredoc_redirect" | "herestring_redirect" => {
            let text = node.utf8_text(source).unwrap_or_default();
            if text.contains('>') {
                analysis.effect = ToolEffect::Write;
                analysis.risk = analysis.risk.max(RiskLevel::High);
            }
        }
        _ => {}
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_nodes(child, source, analysis);
    }
}

fn analyze_command(node: Node<'_>, source: &[u8], analysis: &mut Analysis) {
    let Some(name_node) = node.child_by_field_name("name") else {
        analysis.parsed = false;
        analysis.risk = RiskLevel::High;
        return;
    };
    let raw_name = name_node.utf8_text(source).unwrap_or_default();
    let name = raw_name.rsplit('/').next().unwrap_or(raw_name);
    analysis.commands.push(name.to_owned());
    let text = node.utf8_text(source).unwrap_or_default();
    collect_absolute_resources(text, &mut analysis.resources);

    if is_hard_deny(name, text) {
        analysis.hard_deny = true;
        analysis.effect = ToolEffect::Write;
        analysis.risk = RiskLevel::Critical;
        return;
    }
    let effect = command_effect(name, text);
    analysis.effect = analysis.effect.max(effect);
    analysis.risk = analysis.risk.max(match effect {
        ToolEffect::Read => RiskLevel::Low,
        ToolEffect::Execute => RiskLevel::Medium,
        ToolEffect::Write => RiskLevel::High,
    });
    if contains_protected_path(text) && effect == ToolEffect::Write {
        analysis.risk = RiskLevel::Critical;
    }
}

fn command_effect(name: &str, command: &str) -> ToolEffect {
    const READ_ONLY: &[&str] = &[
        "cat",
        "cut",
        "date",
        "df",
        "du",
        "env",
        "find",
        "free",
        "grep",
        "head",
        "hostname",
        "id",
        "ip",
        "journalctl",
        "ls",
        "lsof",
        "netstat",
        "pgrep",
        "ps",
        "pwd",
        "rg",
        "sed",
        "ss",
        "stat",
        "tail",
        "uname",
        "uptime",
        "wc",
        "who",
        "whoami",
    ];
    if READ_ONLY.contains(&name) && !command.contains('>') {
        return ToolEffect::Read;
    }
    if name == "systemctl"
        && [
            " status ",
            " show ",
            " is-active ",
            " is-enabled ",
            " list-",
        ]
        .iter()
        .any(|token| format!(" {command} ").contains(token))
    {
        return ToolEffect::Read;
    }
    if name == "docker"
        && [" ps", " inspect", " logs", " stats", " version", " info"]
            .iter()
            .any(|token| {
                command
                    .trim_start_matches(name)
                    .trim_start()
                    .starts_with(token.trim())
            })
    {
        return ToolEffect::Read;
    }
    if matches!(name, "cd" | "echo" | "printf" | "test" | "true" | "false")
        && !command.contains('>')
    {
        return ToolEffect::Execute;
    }
    ToolEffect::Write
}

fn is_hard_deny(name: &str, command: &str) -> bool {
    let normalized = command.split_whitespace().collect::<Vec<_>>().join(" ");
    name.starts_with("mkfs")
        || normalized.contains(" mkfs")
        || matches!(name, "reboot" | "poweroff" | "halt" | "shutdown")
        || ["rm -rf /", "rm -fr /", "rm --recursive --force /"]
            .iter()
            .any(|pattern| normalized.contains(pattern))
        || ((name == "dd" || normalized.contains(" dd "))
            && (normalized.contains("of=/dev/") || normalized.contains("of= /dev/")))
        || (name == "userdel" && normalized.ends_with(" root"))
        || normalized.contains(":(){ :|:& };:")
}

fn contains_protected_path(command: &str) -> bool {
    [
        "/etc/shadow",
        "/etc/sudoers",
        "/etc/ssh/sshd_config",
        "/boot/",
        "/root/.ssh/authorized_keys",
    ]
    .iter()
    .any(|path| command.contains(path))
}

fn collect_absolute_resources(command: &str, output: &mut Vec<String>) {
    for token in command.split_whitespace() {
        let token = token.trim_matches(|character: char| {
            matches!(character, '\'' | '"' | ';' | ')' | '(' | ',' | '>' | '<')
        });
        if token.starts_with('/') {
            output.push(token.to_owned());
        }
    }
}

fn unknown(reason: &str) -> Analysis {
    Analysis {
        effect: ToolEffect::Execute,
        risk: RiskLevel::High,
        reason: reason.to_owned(),
        commands: Vec::new(),
        resources: Vec::new(),
        parsed: false,
        hard_deny: false,
    }
}

#[cfg(test)]
mod tests {
    use super::{evaluate_tool, PolicyAction, PolicyContext, RiskLevel, ToolEffect};
    use crate::types::{AgentPermissionMode, SessionEnvironment};
    use serde_json::json;

    fn context(mode: AgentPermissionMode) -> PolicyContext {
        PolicyContext {
            mode,
            environment: SessionEnvironment::Development,
            is_root: false,
        }
    }

    #[test]
    fn read_only_commands_are_allowed_without_confirmation() {
        let decision = evaluate_tool(
            "remote_exec",
            &json!({ "command": "df -h && journalctl -n 20" }),
            context(AgentPermissionMode::Confirm),
        );
        assert_eq!(decision.action, PolicyAction::Allow);
        assert_eq!(decision.effect, ToolEffect::Read);
    }

    #[test]
    fn substitutions_and_writes_are_escalated() {
        let decision = evaluate_tool(
            "remote_exec",
            &json!({ "command": "echo $(id) > /tmp/result" }),
            context(AgentPermissionMode::Confirm),
        );
        assert_eq!(decision.action, PolicyAction::Ask);
        assert!(decision.risk >= RiskLevel::High);
        assert_eq!(decision.effect, ToolEffect::Write);
    }

    #[test]
    fn hard_deny_overrides_full_access() {
        let decision = evaluate_tool(
            "remote_exec",
            &json!({ "command": "sudo rm -rf /" }),
            context(AgentPermissionMode::FullAccess),
        );
        assert_eq!(decision.action, PolicyAction::Deny);
        assert_eq!(decision.risk, RiskLevel::Critical);
    }

    #[test]
    fn full_access_does_not_prompt_for_production_writes() {
        let decision = evaluate_tool(
            "remote_exec",
            &json!({ "command": "systemctl restart nginx" }),
            PolicyContext {
                mode: AgentPermissionMode::FullAccess,
                environment: SessionEnvironment::Production,
                is_root: true,
            },
        );
        assert_eq!(decision.action, PolicyAction::Allow);
    }

    #[test]
    fn invalid_syntax_never_auto_executes() {
        let decision = evaluate_tool(
            "remote_exec",
            &json!({ "command": "echo $(" }),
            context(AgentPermissionMode::FullAccess),
        );
        assert_eq!(decision.action, PolicyAction::Allow);
        assert!(!decision.parsed);
    }
}

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const INLINE_RESULT_BYTES: usize = 8 * 1024;
const MAX_FACTS: usize = 48;
const MAX_EXCERPTS: usize = 24;
const MAX_EXCERPT_BYTES: usize = 2 * 1024;
const MAX_FACT_VALUE_BYTES: usize = 1024;
const MAX_FACT_KEY_BYTES: usize = 128;
const MAX_FACT_PATH_BYTES: usize = 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultCapsule {
    pub version: u8,
    pub result_id: String,
    pub tool: String,
    pub status: String,
    pub is_error: bool,
    pub kind: String,
    pub raw_bytes: usize,
    pub raw_sha256: String,
    pub summary: String,
    pub query: Option<String>,
    pub facts: Vec<ResultFact>,
    pub exact_excerpts: Vec<ResultExcerpt>,
    pub read_required: bool,
    pub read_tool: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultFact {
    pub id: String,
    pub key: String,
    pub value: Value,
    pub source: ResultSource,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultExcerpt {
    pub line_start: usize,
    pub line_end: usize,
    pub text: String,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultSource {
    pub result_id: String,
    pub json_path: Option<String>,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
}

pub(crate) struct ReducedToolResult {
    pub projected_content: String,
    pub capsule: ResultCapsule,
}

pub(crate) fn reduce_tool_result(
    result_id: &str,
    tool: &str,
    arguments: &Value,
    raw: &str,
    status: &str,
    is_error: bool,
    user_intent: &str,
) -> Result<ReducedToolResult, serde_json::Error> {
    let raw_sha256 = sha256(raw.as_bytes());
    let focus = focus_terms(user_intent, arguments);
    let query = query_value(arguments);
    let (kind, summary, facts, exact_excerpts) = match serde_json::from_str::<Value>(raw) {
        Ok(value) => reduce_json(result_id, &value, &focus),
        Err(_) => reduce_text(result_id, raw, &focus),
    };
    // result_read is already a bounded projection of immutable raw evidence. Wrapping its
    // response in another capsule would create an opaque result-read chain.
    let read_required = tool != "result_read" && raw.len() > INLINE_RESULT_BYTES;
    let capsule = ResultCapsule {
        version: 1,
        result_id: result_id.to_owned(),
        tool: tool.to_owned(),
        status: status.to_owned(),
        is_error,
        kind,
        raw_bytes: raw.len(),
        raw_sha256,
        summary,
        query,
        facts,
        exact_excerpts,
        read_required,
        read_tool: "result_read".to_owned(),
    };
    let projected_content = if read_required {
        serde_json::to_string(&capsule)?
    } else {
        raw.to_owned()
    };
    Ok(ReducedToolResult {
        projected_content,
        capsule,
    })
}

fn reduce_json(
    result_id: &str,
    value: &Value,
    focus: &[String],
) -> (String, String, Vec<ResultFact>, Vec<ResultExcerpt>) {
    let kind = match value {
        Value::Object(_) => "json_object",
        Value::Array(_) => "json_array",
        _ => "json_scalar",
    }
    .to_owned();
    let summary = match value {
        Value::Object(map) => format!("JSON object with {} top-level field(s)", map.len()),
        Value::Array(values) => format!("JSON array with {} item(s)", values.len()),
        _ => "JSON scalar result".to_owned(),
    };
    let mut candidates = Vec::new();
    collect_json_facts(value, "$", None, focus, 0, 0, &mut candidates);
    candidates.sort_by(|left, right| right.0.cmp(&left.0).then(left.1.cmp(&right.1)));
    let facts = candidates
        .into_iter()
        .take(MAX_FACTS)
        .enumerate()
        .map(|(index, (_, path, key, value))| ResultFact {
            id: format!("{result_id}:fact-{}", index + 1),
            key,
            value,
            source: ResultSource {
                result_id: result_id.to_owned(),
                json_path: Some(path),
                line_start: None,
                line_end: None,
            },
        })
        .collect();
    (kind, summary, facts, Vec::new())
}

fn collect_json_facts(
    value: &Value,
    path: &str,
    key: Option<&str>,
    focus: &[String],
    depth: usize,
    parent_relevance: usize,
    facts: &mut Vec<(usize, String, String, Value)>,
) {
    match value {
        Value::Object(map) => {
            let object_relevance =
                map.iter()
                    .fold(parent_relevance, |score, (child_key, child)| {
                        let child_key = child_key.to_ascii_lowercase();
                        let child_value = scalar_text(child).to_ascii_lowercase();
                        let key_score = focus
                            .iter()
                            .filter(|term| child_key.contains(term.as_str()))
                            .count()
                            * 20;
                        let value_score = focus
                            .iter()
                            .filter(|term| child_value.contains(term.as_str()))
                            .count()
                            * 80;
                        score.max(key_score.saturating_add(value_score))
                    });
            for (child_key, child) in map {
                let child_path = format!("{path}.{}", json_path_key(child_key));
                collect_json_facts(
                    child,
                    &child_path,
                    Some(child_key),
                    focus,
                    depth + 1,
                    object_relevance,
                    facts,
                );
            }
        }
        Value::Array(values) => {
            for (index, child) in values.iter().enumerate() {
                collect_json_facts(
                    child,
                    &format!("{path}[{index}]"),
                    key,
                    focus,
                    depth + 1,
                    0,
                    facts,
                );
            }
        }
        _ => {
            let key = key.unwrap_or("value");
            let value_text = scalar_text(value);
            let score = fact_score(key, &value_text, focus, depth) + parent_relevance;
            if score > 0
                && key.len() <= MAX_FACT_KEY_BYTES
                && path.len() <= MAX_FACT_PATH_BYTES
                && value_text.len() <= MAX_FACT_VALUE_BYTES
            {
                facts.push((score, path.to_owned(), key.to_owned(), value.clone()));
            }
        }
    }
}

fn reduce_text(
    result_id: &str,
    raw: &str,
    focus: &[String],
) -> (String, String, Vec<ResultFact>, Vec<ResultExcerpt>) {
    let lines = raw.lines().collect::<Vec<_>>();
    let mut severity = BTreeMap::<&'static str, usize>::new();
    let mut facts = Vec::new();
    let mut excerpts = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let lower = line.to_ascii_lowercase();
        let severity_name = error_marker(&lower);
        if let Some(name) = severity_name {
            *severity.entry(name).or_default() += 1;
        }
        if facts.len() < MAX_FACTS {
            if let Some((key, value)) = key_value_line(line) {
                let score = fact_score(key, value, focus, 1);
                if score > 0 {
                    facts.push(ResultFact {
                        id: format!("{result_id}:fact-{}", facts.len() + 1),
                        key: key.to_owned(),
                        value: Value::String(value.to_owned()),
                        source: ResultSource {
                            result_id: result_id.to_owned(),
                            json_path: None,
                            line_start: Some(index + 1),
                            line_end: Some(index + 1),
                        },
                    });
                }
            }
        }
        if excerpts.len() < MAX_EXCERPTS
            && line.len() <= MAX_EXCERPT_BYTES
            && (severity_name.is_some() || line_matches_focus(&lower, focus))
        {
            excerpts.push(ResultExcerpt {
                line_start: index + 1,
                line_end: index + 1,
                text: (*line).to_owned(),
                sha256: sha256(line.as_bytes()),
            });
        }
    }
    for (name, count) in &severity {
        facts.push(ResultFact {
            id: format!("{result_id}:fact-{}", facts.len() + 1),
            key: format!("{name}Count"),
            value: Value::from(*count as u64),
            source: ResultSource {
                result_id: result_id.to_owned(),
                json_path: None,
                line_start: None,
                line_end: None,
            },
        });
    }
    facts.truncate(MAX_FACTS);
    let summary = if severity.is_empty() {
        format!("Text result with {} line(s)", lines.len())
    } else {
        let counts = severity
            .into_iter()
            .map(|(name, count)| format!("{name}={count}"))
            .collect::<Vec<_>>()
            .join(", ");
        format!("Text result with {} line(s); {counts}", lines.len())
    };
    ("text".to_owned(), summary, facts, excerpts)
}

fn query_value(arguments: &Value) -> Option<String> {
    ["query", "command", "pattern", "path", "target"]
        .into_iter()
        .find_map(|key| arguments.get(key).and_then(Value::as_str))
        .map(str::to_owned)
}

fn focus_terms(user_intent: &str, arguments: &Value) -> Vec<String> {
    let mut values = vec![user_intent.to_owned(), arguments.to_string()];
    let mut terms = Vec::new();
    for value in values.drain(..) {
        for term in value
            .split(|character: char| {
                !character.is_alphanumeric() && character != '_' && character != '-'
            })
            .map(str::trim)
            .filter(|term| term.chars().count() >= 2)
        {
            let term = term.to_ascii_lowercase();
            if !terms.contains(&term) {
                terms.push(term);
                if terms.len() == 32 {
                    return terms;
                }
            }
        }
    }
    terms
}

fn fact_score(key: &str, value: &str, focus: &[String], depth: usize) -> usize {
    let key = key.to_ascii_lowercase();
    let value = value.to_ascii_lowercase();
    let mut score = if depth <= 1 { 4 } else { 0 };
    if important_key(&key) {
        score += 30;
    }
    if error_marker(&format!("{key} {value}")).is_some() {
        score += 40;
    }
    for term in focus {
        if key.contains(term) {
            score += 20;
        } else if value.contains(term) {
            score += 8;
        }
    }
    score
}

fn important_key(key: &str) -> bool {
    [
        "status",
        "state",
        "code",
        "error",
        "message",
        "result",
        "success",
        "failed",
        "exitcode",
        "exit_code",
        "count",
        "total",
        "usage",
        "used",
        "available",
        "name",
        "id",
        "path",
        "command",
    ]
    .iter()
    .any(|candidate| key == *candidate || key.ends_with(candidate))
}

fn line_matches_focus(line: &str, focus: &[String]) -> bool {
    focus.iter().any(|term| line.contains(term))
}

fn error_marker(line: &str) -> Option<&'static str> {
    if ["fatal", "critical", "panic", "traceback", "exception"]
        .iter()
        .any(|marker| line.contains(marker))
    {
        Some("critical")
    } else if [
        "error", "failed", "failure", "denied", "错误", "失败", "异常",
    ]
    .iter()
    .any(|marker| line.contains(marker))
    {
        Some("error")
    } else if ["warn", "warning", "timeout", "timed out", "超时"]
        .iter()
        .any(|marker| line.contains(marker))
    {
        Some("warning")
    } else {
        None
    }
}

fn key_value_line(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once('=').or_else(|| line.split_once(':'))?;
    let key = key.trim();
    let value = value.trim();
    (!key.is_empty()
        && key.len() <= 64
        && !value.is_empty()
        && value.len() <= 512
        && !key.chars().any(char::is_whitespace))
    .then_some((key, value))
}

fn scalar_text(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string())
}

fn json_path_key(key: &str) -> String {
    if key
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        key.to_owned()
    } else {
        format!("['{}']", key.replace('\\', "\\\\").replace('\'', "\\'"))
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn large_json_becomes_a_sourced_capsule_without_losing_the_raw_hash() {
        let rows = (0..600)
            .map(|index| {
                json!({
                    "name": format!("fs-{index}"),
                    "usage": if index == 419 { "92%" } else { "11%" },
                    "status": if index == 419 { "warning" } else { "ok" }
                })
            })
            .collect::<Vec<_>>();
        let raw = json!({"filesystems": rows}).to_string();
        let reduced = reduce_tool_result(
            "result-1",
            "mcp__storage__query",
            &json!({"query": "fs-419 usage"}),
            &raw,
            "completed",
            false,
            "检查 fs-419 的空间使用率",
        )
        .unwrap();

        assert!(reduced.projected_content.len() < raw.len());
        assert_eq!(reduced.capsule.raw_sha256, sha256(raw.as_bytes()));
        assert!(reduced.capsule.facts.iter().any(|fact| fact.value == "92%"));
        assert!(reduced.capsule.read_required);
    }

    #[test]
    fn log_reduction_keeps_exact_error_lines_and_counts_signatures() {
        let mut lines = (0..500)
            .map(|index| format!("2026-08-29 INFO request {index} completed"))
            .collect::<Vec<_>>();
        lines.push("2026-08-29 ERROR disk /data is 92% full".to_owned());
        let raw = lines.join("\n");
        let reduced = reduce_tool_result(
            "result-2",
            "remote_exec",
            &json!({"command": "journalctl -u storage"}),
            &raw,
            "completed",
            false,
            "找出 storage 日志中的磁盘错误",
        )
        .unwrap();

        assert!(
            reduced
                .capsule
                .exact_excerpts
                .iter()
                .any(|excerpt| excerpt.text == "2026-08-29 ERROR disk /data is 92% full")
        );
        assert!(
            reduced
                .capsule
                .facts
                .iter()
                .any(|fact| fact.key == "errorCount" && fact.value == 1)
        );
    }

    #[test]
    fn small_results_remain_native_tool_content() {
        let raw = r#"{"status":"ok","usage":"12%"}"#;
        let reduced = reduce_tool_result(
            "result-3",
            "host_facts",
            &json!({}),
            raw,
            "completed",
            false,
            "检查状态",
        )
        .unwrap();
        assert_eq!(reduced.projected_content, raw);
        assert!(!reduced.capsule.read_required);
    }

    #[test]
    fn oversized_json_scalars_do_not_reinflate_a_capsule() {
        let raw = json!({"message": "x".repeat(64 * 1024)}).to_string();
        let reduced = reduce_tool_result(
            "result-large-scalar",
            "mcp__catalog__query",
            &json!({"query": "message"}),
            &raw,
            "completed",
            false,
            "读取 message",
        )
        .unwrap();
        assert!(reduced.projected_content.len() < 4 * 1024);
        assert!(reduced.capsule.facts.is_empty());
        assert!(reduced.capsule.read_required);
    }

    #[test]
    fn result_read_output_is_never_wrapped_in_another_capsule() {
        let raw = json!({"content": "\\\"".repeat(6 * 1024)}).to_string();
        let reduced = reduce_tool_result(
            "result-read",
            "result_read",
            &json!({"result_id": "source"}),
            &raw,
            "completed",
            false,
            "继续读取原始结果",
        )
        .unwrap();
        assert_eq!(reduced.projected_content, raw);
        assert!(!reduced.capsule.read_required);
    }
}

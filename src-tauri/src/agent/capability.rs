use std::{
    cmp::Reverse,
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
};

use async_trait::async_trait;
use serde::Serialize;
use serde_json::{json, Value};

use crate::AppError;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityProgress {
    pub progress: f64,
    pub total: Option<f64>,
    pub message: Option<String>,
}

pub type CapabilityProgressSink = std::sync::Arc<dyn Fn(CapabilityProgress) + Send + Sync>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerDiagnostic {
    pub server_id: String,
    pub server_name: String,
    pub transport: String,
    pub enabled: bool,
    pub status: String,
    pub tool_count: usize,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
}

impl McpServerDiagnostic {
    pub fn matches_query(&self, query: &str) -> bool {
        let query = query.trim().to_ascii_lowercase();
        query.is_empty()
            || [
                self.server_id.as_str(),
                self.server_name.as_str(),
                self.transport.as_str(),
                self.status.as_str(),
                self.error_code.as_deref().unwrap_or_default(),
                self.error_detail.as_deref().unwrap_or_default(),
            ]
            .iter()
            .any(|value| value.to_ascii_lowercase().contains(&query))
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDescriptor {
    pub id: String,
    pub model_name: String,
    pub provider_kind: String,
    pub provider_id: String,
    pub provider_name: String,
    pub transport: String,
    pub original_name: String,
    pub title: Option<String>,
    pub description: String,
    pub input_schema: Value,
    pub output_schema: Option<Value>,
    pub annotations: Option<Value>,
}

#[derive(Clone, Debug)]
pub struct CapabilityInvocationResult {
    pub raw: Value,
    pub structured_content: Option<Value>,
    pub is_error: bool,
}

/// Transport-neutral capability provider contract.
///
/// The Agent loop only depends on this interface. MCP, built-in, or future
/// providers may therefore change their connection lifecycle without adding
/// provider-specific branches to the model-facing execution path.
#[async_trait]
pub trait CapabilityProvider: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn kind(&self) -> &str;
    fn transport(&self) -> &str;

    async fn discover(&self, refresh: bool) -> Result<Vec<CapabilityDescriptor>, AppError>;

    async fn invoke(
        &self,
        capability: &CapabilityDescriptor,
        arguments: Value,
        progress: Option<CapabilityProgressSink>,
    ) -> Result<CapabilityInvocationResult, AppError>;

    async fn list_resources(&self) -> Result<Value, AppError> {
        Err(AppError::NotFound(format!(
            "capability provider '{}' does not expose resources",
            self.id()
        )))
    }

    async fn read_resource(&self, _uri: &str) -> Result<Value, AppError> {
        Err(AppError::NotFound(format!(
            "capability provider '{}' does not expose resources",
            self.id()
        )))
    }

    async fn list_prompts(&self) -> Result<Value, AppError> {
        Err(AppError::NotFound(format!(
            "capability provider '{}' does not expose prompts",
            self.id()
        )))
    }

    async fn get_prompt(&self, _name: &str, _arguments: Value) -> Result<Value, AppError> {
        Err(AppError::NotFound(format!(
            "capability provider '{}' does not expose prompts",
            self.id()
        )))
    }
}

impl CapabilityDescriptor {
    fn schema_size(&self) -> usize {
        serde_json::to_string(&self.input_schema).map_or(0, |value| value.len())
            + self
                .output_schema
                .as_ref()
                .and_then(|schema| serde_json::to_string(schema).ok())
                .map_or(0, |value| value.len())
            + self.description.len()
    }

    fn search_score(&self, query: &str) -> usize {
        let query = query.trim().to_ascii_lowercase();
        if query.is_empty() {
            return 0;
        }
        let name = self.original_name.to_ascii_lowercase();
        let title = self
            .title
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        let description = self.description.to_ascii_lowercase();
        let provider = format!("{} {}", self.provider_id, self.provider_name).to_ascii_lowercase();
        let schema = format!("{} {:?}", self.input_schema, self.output_schema).to_ascii_lowercase();
        let mut score = 0;
        if name == query {
            score += 200;
        }
        if name.contains(&query) {
            score += 80;
        }
        if title.contains(&query) {
            score += 50;
        }
        if description.contains(&query) {
            score += 35;
        }
        for term in search_terms(&query) {
            if name.contains(term) {
                score += 24;
            }
            if title.contains(term) {
                score += 15;
            }
            if description.contains(term) {
                score += 9;
            }
            if schema.contains(term) {
                score += 4;
            }
            if provider.contains(term) {
                score += 2;
            }
        }
        score
    }

    pub fn summary(&self) -> Value {
        json!({
            "capabilityId": self.id,
            "providerKind": self.provider_kind,
            "providerId": self.provider_id,
            "providerName": self.provider_name,
            "transport": self.transport,
            "name": self.original_name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.input_schema,
            "outputSchema": self.output_schema,
            "annotations": self.annotations,
        })
    }
}

#[derive(Clone, Default)]
pub struct CapabilityRegistry {
    entries: Vec<CapabilityDescriptor>,
}

impl CapabilityRegistry {
    pub fn new(entries: Vec<CapabilityDescriptor>) -> Self {
        Self { entries }
    }

    pub fn entries(&self) -> &[CapabilityDescriptor] {
        &self.entries
    }

    pub fn find_by_id(&self, id: &str) -> Option<&CapabilityDescriptor> {
        self.entries.iter().find(|entry| entry.id == id)
    }

    pub fn find_by_model_name(&self, name: &str) -> Option<&CapabilityDescriptor> {
        self.entries.iter().find(|entry| entry.model_name == name)
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<&CapabilityDescriptor> {
        let mut ranked = self
            .entries
            .iter()
            .filter_map(|entry| {
                let score = entry.search_score(query);
                (score > 0).then_some((Reverse(score), entry.id.as_str(), entry))
            })
            .collect::<Vec<_>>();
        ranked.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(right.1)));
        ranked
            .into_iter()
            .take(limit.clamp(1, 20))
            .map(|(_, _, entry)| entry)
            .collect()
    }

    pub fn selected_for_prompt(&self, prompt: &str) -> Vec<&CapabilityDescriptor> {
        const SMALL_CATALOG_TOOLS: usize = 8;
        const SMALL_CATALOG_BYTES: usize = 16 * 1024;
        const SELECTED_TOOLS: usize = 8;
        const SELECTED_SCHEMA_BYTES: usize = 20 * 1024;

        let total = self
            .entries
            .iter()
            .map(CapabilityDescriptor::schema_size)
            .sum::<usize>();
        if self.entries.len() <= SMALL_CATALOG_TOOLS && total <= SMALL_CATALOG_BYTES {
            return self.entries.iter().collect();
        }
        let mut selected = Vec::new();
        let mut bytes: usize = 0;
        for entry in self.search(prompt, self.entries.len().max(1)) {
            let size = entry.schema_size();
            if selected.len() >= SELECTED_TOOLS
                || bytes.saturating_add(size) > SELECTED_SCHEMA_BYTES
            {
                break;
            }
            bytes = bytes.saturating_add(size);
            selected.push(entry);
        }
        selected
    }
}

fn search_terms(query: &str) -> Vec<&str> {
    query
        .split(|character: char| !character.is_alphanumeric() && character != '_')
        .filter(|term| term.chars().count() >= 2)
        .collect()
}

#[derive(Clone)]
pub struct EvidenceRecord {
    pub id: String,
    pub capability_id: String,
    pub artifact_path: PathBuf,
    pub bytes: u64,
}

#[derive(Default)]
pub struct EvidenceLedger {
    records: HashMap<String, EvidenceRecord>,
}

impl EvidenceLedger {
    pub fn insert(&mut self, record: EvidenceRecord) {
        self.records.insert(record.id.clone(), record);
    }

    pub fn contains(&self, id: &str) -> bool {
        self.records.contains_key(id)
    }

    pub fn validate_refs(&self, refs: &[String]) -> Result<(), AppError> {
        if let Some(missing) = refs
            .iter()
            .find(|id| !self.records.contains_key(id.as_str()))
        {
            return Err(AppError::InvalidInput(format!(
                "evidence reference '{missing}' does not exist in the current Agent task"
            )));
        }
        Ok(())
    }

    pub fn read(&self, id: &str, offset: u64, limit: usize) -> Result<Value, AppError> {
        let record = self
            .records
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("evidence '{id}'")))?;
        let mut file = File::open(&record.artifact_path)?;
        let start = offset.min(record.bytes);
        file.seek(SeekFrom::Start(start))?;
        let mut bytes = vec![0_u8; limit.clamp(1, 64 * 1024)];
        let read = file.read(&mut bytes)?;
        bytes.truncate(read);
        Ok(json!({
            "evidenceId": record.id,
            "capabilityId": record.capability_id,
            "offset": start,
            "nextOffset": start.saturating_add(read as u64),
            "totalBytes": record.bytes,
            "eof": start.saturating_add(read as u64) >= record.bytes,
            "content": String::from_utf8_lossy(&bytes),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CapabilityDescriptor, CapabilityRegistry, EvidenceLedger, EvidenceRecord,
        McpServerDiagnostic,
    };
    use serde_json::json;
    use std::fs;

    fn capability(id: &str, name: &str, description: &str) -> CapabilityDescriptor {
        CapabilityDescriptor {
            id: id.to_owned(),
            model_name: format!("mcp__{name}"),
            provider_kind: "mcp".to_owned(),
            provider_id: "docs".to_owned(),
            provider_name: "CLI docs".to_owned(),
            transport: "streamable_http".to_owned(),
            original_name: name.to_owned(),
            title: None,
            description: description.to_owned(),
            input_schema: json!({"type":"object"}),
            output_schema: None,
            annotations: None,
        }
    }

    #[test]
    fn capability_search_uses_individual_query_terms_and_ranking() {
        let registry = CapabilityRegistry::new(vec![
            capability("status", "host_status", "Read host health"),
            capability("cli", "search_cli", "Search product filesystem commands"),
        ]);
        let matches = registry.search("filesystem command", 5);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].id, "cli");
    }

    #[test]
    fn a_small_catalog_is_exposed_without_an_arbitrary_tool_count_switch() {
        let registry = CapabilityRegistry::new(vec![capability(
            "cli",
            "search_cli",
            "Search product commands",
        )]);
        assert_eq!(registry.selected_for_prompt("unrelated task").len(), 1);
    }

    #[test]
    fn evidence_is_task_scoped_and_read_in_bounded_ranges() {
        let path = std::env::temp_dir().join(format!(
            "myterm-evidence-test-{}.json",
            uuid::Uuid::new_v4()
        ));
        fs::write(&path, b"0123456789").unwrap();
        let mut ledger = EvidenceLedger::default();
        ledger.insert(EvidenceRecord {
            id: "ev-1".to_owned(),
            capability_id: "mcp:docs:search".to_owned(),
            artifact_path: path.clone(),
            bytes: 10,
        });

        ledger.validate_refs(&["ev-1".to_owned()]).unwrap();
        assert!(ledger.validate_refs(&["ev-missing".to_owned()]).is_err());
        let first = ledger.read("ev-1", 2, 4).unwrap();
        assert_eq!(first["content"], "2345");
        assert_eq!(first["nextOffset"], 6);
        assert_eq!(first["eof"], false);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn mcp_diagnostics_can_be_filtered_by_exact_provider_errors() {
        let diagnostic = McpServerDiagnostic {
            server_id: "product-docs".to_owned(),
            server_name: "产品命令文档".to_owned(),
            transport: "streamable_http".to_owned(),
            enabled: true,
            status: "connection_failed".to_owned(),
            tool_count: 0,
            error_code: Some("MCP_HTTP_INIT_FAILED".to_owned()),
            error_detail: Some("HTTP 401 Unauthorized".to_owned()),
        };

        assert!(diagnostic.matches_query("product-docs"));
        assert!(diagnostic.matches_query("401"));
        assert!(diagnostic.matches_query("http_init"));
        assert!(!diagnostic.matches_query("stdio"));
    }
}

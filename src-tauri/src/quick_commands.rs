use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{config::ConfigService, types::QuickCommand, AppError};

const MAX_IMPORT_BYTES: usize = 2 * 1024 * 1024;
const NATIVE_FORMAT: &str = "myterm.quick-commands";
const NATIVE_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuickCommandImportStrategy {
    KeepBoth,
    Overwrite,
}

#[derive(Debug, Serialize)]
pub struct QuickCommandImportPreview {
    pub source_format: String,
    pub source_version: String,
    pub total: usize,
    pub importable: usize,
    pub duplicates: usize,
    pub conflicts: usize,
    pub skipped: usize,
    pub groups: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct QuickCommandImportResult {
    pub imported: usize,
    pub replaced: usize,
    pub renamed: usize,
    pub duplicates: usize,
    pub skipped: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct PortableCommand {
    label: String,
    group: String,
    command: String,
    send_newline: bool,
    #[serde(default)]
    sort: u32,
}

#[derive(Debug, Deserialize, Serialize)]
struct NativeFile {
    format: String,
    version: u32,
    exported_at: u64,
    scope: String,
    commands: Vec<PortableCommand>,
}

struct ParsedImport {
    source_format: &'static str,
    source_version: String,
    total: usize,
    skipped: usize,
    commands: Vec<PortableCommand>,
}

pub fn preview(
    config: &ConfigService,
    file_name: &str,
    bytes: &[u8],
) -> Result<QuickCommandImportPreview, AppError> {
    let parsed = parse_import(file_name, bytes)?;
    let existing = config.quick_command_list()?;
    let (duplicates, conflicts) = classify(&existing, &parsed.commands);
    let groups = parsed
        .commands
        .iter()
        .map(|command| command.group.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    Ok(QuickCommandImportPreview {
        source_format: parsed.source_format.to_owned(),
        source_version: parsed.source_version,
        total: parsed.total,
        importable: parsed.commands.len().saturating_sub(duplicates),
        duplicates,
        conflicts,
        skipped: parsed.skipped,
        groups,
    })
}

pub fn apply(
    config: &ConfigService,
    file_name: &str,
    bytes: &[u8],
    strategy: QuickCommandImportStrategy,
) -> Result<QuickCommandImportResult, AppError> {
    let parsed = parse_import(file_name, bytes)?;
    let mut commands = config.quick_command_list()?;
    let mut result = QuickCommandImportResult {
        imported: 0,
        replaced: 0,
        renamed: 0,
        duplicates: 0,
        skipped: parsed.skipped,
    };

    for candidate in parsed.commands {
        let same_name = commands.iter().position(|command| {
            command.group == candidate.group && command.label == candidate.label
        });
        if let Some(index) = same_name {
            let existing = &commands[index];
            if existing.command == candidate.command
                && existing.send_newline == candidate.send_newline
            {
                result.duplicates += 1;
                continue;
            }
            match strategy {
                QuickCommandImportStrategy::Overwrite => {
                    commands[index].command = candidate.command;
                    commands[index].send_newline = candidate.send_newline;
                    result.replaced += 1;
                    continue;
                }
                QuickCommandImportStrategy::KeepBoth => {
                    let label = unique_import_label(&commands, &candidate.group, &candidate.label);
                    append_candidate(&mut commands, candidate, label);
                    result.imported += 1;
                    result.renamed += 1;
                    continue;
                }
            }
        }
        let label = candidate.label.clone();
        append_candidate(&mut commands, candidate, label);
        result.imported += 1;
    }

    config.quick_command_replace_all(commands)?;
    Ok(result)
}

pub fn export(config: &ConfigService, group: Option<&str>) -> Result<String, AppError> {
    let mut commands = config.quick_command_list()?;
    if let Some(group) = group {
        commands.retain(|command| command.group == group);
    }
    commands.sort_by(|left, right| {
        left.group
            .cmp(&right.group)
            .then(left.sort.cmp(&right.sort))
            .then(left.label.cmp(&right.label))
    });
    let exported_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    let file = NativeFile {
        format: NATIVE_FORMAT.to_owned(),
        version: NATIVE_VERSION,
        exported_at,
        scope: group.unwrap_or("all").to_owned(),
        commands: commands
            .into_iter()
            .map(|command| PortableCommand {
                label: command.label,
                group: command.group,
                command: command.command,
                send_newline: command.send_newline,
                sort: command.sort,
            })
            .collect(),
    };
    serde_json::to_string_pretty(&file).map_err(Into::into)
}

fn parse_import(file_name: &str, bytes: &[u8]) -> Result<ParsedImport, AppError> {
    if bytes.is_empty() {
        return Err(AppError::InvalidInput("快捷命令文件为空".to_owned()));
    }
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err(AppError::InvalidInput(
            "快捷命令文件超过 2 MB 限制".to_owned(),
        ));
    }
    let source = decode_text(bytes)?;
    let trimmed = source.trim_start_matches('\u{feff}').trim();
    if trimmed.starts_with('{') {
        parse_native(trimmed)
    } else if file_name.to_ascii_lowercase().ends_with(".qbl")
        || trimmed.contains("[Info]")
        || trimmed.contains("[QuickButton]")
    {
        parse_xshell(file_name, trimmed)
    } else {
        Err(AppError::InvalidInput(
            "无法识别快捷命令格式，仅支持 myterm JSON 和 Xshell QBL".to_owned(),
        ))
    }
}

fn decode_text(bytes: &[u8]) -> Result<String, AppError> {
    if bytes.starts_with(&[0xff, 0xfe]) {
        if !(bytes.len() - 2).is_multiple_of(2) {
            return Err(AppError::InvalidInput(
                "Xshell QBL 的 UTF-16LE 字节长度无效".to_owned(),
            ));
        }
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16(&units)
            .map_err(|_| AppError::InvalidInput("Xshell QBL 的 UTF-16LE 编码无效".to_owned()));
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        if !(bytes.len() - 2).is_multiple_of(2) {
            return Err(AppError::InvalidInput(
                "快捷命令文件的 UTF-16BE 字节长度无效".to_owned(),
            ));
        }
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16(&units)
            .map_err(|_| AppError::InvalidInput("快捷命令文件的 UTF-16BE 编码无效".to_owned()));
    }
    String::from_utf8(bytes.to_vec())
        .map_err(|_| AppError::InvalidInput("快捷命令文件不是有效的 UTF-8/UTF-16 文本".to_owned()))
}

fn parse_native(source: &str) -> Result<ParsedImport, AppError> {
    let file: NativeFile = serde_json::from_str(source)
        .map_err(|error| AppError::InvalidInput(format!("myterm 快捷命令 JSON 无效: {error}")))?;
    if file.format != NATIVE_FORMAT {
        return Err(AppError::InvalidInput(format!(
            "不支持的 JSON 格式标识: {}",
            file.format
        )));
    }
    if file.version != NATIVE_VERSION {
        return Err(AppError::InvalidInput(format!(
            "不支持的 myterm 快捷命令版本: {}",
            file.version
        )));
    }
    let total = file.commands.len();
    let (commands, skipped) = validate_candidates(file.commands)?;
    Ok(ParsedImport {
        source_format: "myterm",
        source_version: file.version.to_string(),
        total,
        skipped,
        commands,
    })
}

fn parse_xshell(file_name: &str, source: &str) -> Result<ParsedImport, AppError> {
    let ini = parse_ini(source);
    let info = ini.get("info");
    let quick = ini
        .get("quickbutton")
        .ok_or_else(|| AppError::InvalidInput("Xshell QBL 缺少 [QuickButton] 命令区".to_owned()))?;
    let version = info
        .and_then(|section| section.get("version"))
        .cloned()
        .unwrap_or_else(|| "legacy".to_owned());
    let count = info
        .and_then(|section| section.get("count"))
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or_else(|| infer_qbl_count(quick));
    if count > 100_000 {
        return Err(AppError::InvalidInput(
            "Xshell QBL 的命令数量异常".to_owned(),
        ));
    }
    let group = file_stem(file_name).unwrap_or_else(|| "Xshell 导入".to_owned());
    let mut candidates = Vec::new();
    let mut skipped = 0;
    for index in 0..count {
        let modern_type = quick.get(&format!("button_{index}_type"));
        let legacy_type = quick.get(&format!("type_{index}"));
        let command_type = modern_type
            .or(legacy_type)
            .and_then(|value| value.parse::<u32>().ok());
        let label = quick
            .get(&format!("button_{index}_name"))
            .or_else(|| quick.get(&format!("label_{index}")))
            .map(|value| value.trim().to_owned())
            .unwrap_or_default();
        let action = quick
            .get(&format!("button_{index}_action"))
            .or_else(|| quick.get(&format!("text_{index}")))
            .cloned()
            .unwrap_or_default();
        let is_send_text = modern_type.is_some_and(|_| command_type == Some(1))
            || (modern_type.is_none() && !action.is_empty() && command_type != Some(0));
        if !is_send_text || label.is_empty() || action.is_empty() {
            skipped += 1;
            continue;
        }
        let legacy_cr = quick
            .get(&format!("cr_{index}"))
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE"));
        let (command, trailing_newline) = decode_xshell_action(&action);
        if command.trim().is_empty() {
            skipped += 1;
            continue;
        }
        candidates.push(PortableCommand {
            label,
            group: group.clone(),
            command,
            send_newline: legacy_cr.unwrap_or(trailing_newline),
            sort: index as u32,
        });
    }
    let (commands, invalid) = validate_candidates(candidates)?;
    Ok(ParsedImport {
        source_format: "xshell_qbl",
        source_version: version,
        total: count,
        skipped: skipped + invalid,
        commands,
    })
}

fn parse_ini(source: &str) -> BTreeMap<String, BTreeMap<String, String>> {
    let mut sections = BTreeMap::<String, BTreeMap<String, String>>::new();
    let mut current = String::new();
    for raw_line in source.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            current = line[1..line.len() - 1].trim().to_ascii_lowercase();
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            sections
                .entry(current.clone())
                .or_default()
                .insert(key.trim().to_ascii_lowercase(), value.to_owned());
        }
    }
    sections
}

fn infer_qbl_count(section: &BTreeMap<String, String>) -> usize {
    section
        .keys()
        .filter_map(|key| {
            let rest = key
                .strip_prefix("button_")
                .or_else(|| key.strip_prefix("type_"))?;
            rest.split('_').next()?.parse::<usize>().ok()
        })
        .max()
        .map_or(0, |index| index + 1)
}

fn decode_xshell_action(action: &str) -> (String, bool) {
    let unescaped = action.replace("\\r", "\r").replace("\\n", "\n");
    let trailing_newline = unescaped.ends_with('\r') || unescaped.ends_with('\n');
    let command = unescaped
        .trim_end_matches(['\r', '\n'])
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    (command, trailing_newline)
}

fn validate_candidates(
    candidates: Vec<PortableCommand>,
) -> Result<(Vec<PortableCommand>, usize), AppError> {
    let mut commands = Vec::new();
    let mut exact = HashSet::new();
    let mut labels = BTreeMap::<(String, String), (String, bool)>::new();
    let mut skipped = 0;
    for mut candidate in candidates {
        candidate.label = candidate.label.trim().to_owned();
        candidate.group = candidate.group.trim().to_owned();
        candidate.command = candidate.command.replace("\r\n", "\n").replace('\r', "\n");
        if candidate.label.is_empty()
            || candidate.group.is_empty()
            || candidate.command.trim().is_empty()
        {
            skipped += 1;
            continue;
        }
        let label_key = (candidate.group.clone(), candidate.label.clone());
        if let Some((command, newline)) = labels.get(&label_key) {
            if command == &candidate.command && *newline == candidate.send_newline {
                skipped += 1;
                continue;
            }
            return Err(AppError::InvalidInput(format!(
                "导入文件在命令集“{}”中包含多个同名但内容不同的“{}”",
                candidate.group, candidate.label
            )));
        }
        let exact_key = (
            candidate.group.clone(),
            candidate.label.clone(),
            candidate.command.clone(),
            candidate.send_newline,
        );
        if !exact.insert(exact_key) {
            skipped += 1;
            continue;
        }
        labels.insert(
            label_key,
            (candidate.command.clone(), candidate.send_newline),
        );
        commands.push(candidate);
    }
    commands.sort_by(|left, right| {
        left.group
            .cmp(&right.group)
            .then(left.sort.cmp(&right.sort))
            .then(left.label.cmp(&right.label))
    });
    Ok((commands, skipped))
}

fn classify(existing: &[QuickCommand], candidates: &[PortableCommand]) -> (usize, usize) {
    let mut duplicates = 0;
    let mut conflicts = 0;
    for candidate in candidates {
        if let Some(command) = existing
            .iter()
            .find(|command| command.group == candidate.group && command.label == candidate.label)
        {
            if command.command == candidate.command
                && command.send_newline == candidate.send_newline
            {
                duplicates += 1;
            } else {
                conflicts += 1;
            }
        }
    }
    (duplicates, conflicts)
}

fn append_candidate(commands: &mut Vec<QuickCommand>, candidate: PortableCommand, label: String) {
    let sort = commands
        .iter()
        .filter(|command| command.group == candidate.group)
        .map(|command| command.sort)
        .max()
        .map_or(0, |value| value.saturating_add(1));
    commands.push(QuickCommand {
        id: uuid::Uuid::new_v4().to_string(),
        label,
        group: candidate.group,
        command: candidate.command,
        send_newline: candidate.send_newline,
        sort,
    });
}

fn unique_import_label(commands: &[QuickCommand], group: &str, label: &str) -> String {
    let first = format!("{label} (导入)");
    if !commands
        .iter()
        .any(|command| command.group == group && command.label == first)
    {
        return first;
    }
    for index in 2..=10_000 {
        let candidate = format!("{label} (导入 {index})");
        if !commands
            .iter()
            .any(|command| command.group == group && command.label == candidate)
        {
            return candidate;
        }
    }
    format!("{label} ({})", uuid::Uuid::new_v4())
}

fn file_stem(file_name: &str) -> Option<String> {
    std::path::Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn utf16le(source: &str) -> Vec<u8> {
        let mut bytes = vec![0xff, 0xfe];
        for unit in source.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes
    }

    fn service() -> Result<(ConfigService, std::path::PathBuf), AppError> {
        let root =
            std::env::temp_dir().join(format!("myterm-command-import-{}", uuid::Uuid::new_v4()));
        Ok((ConfigService::open(root.join("config.json"))?, root))
    }

    #[test]
    fn parses_xshell_82_qbl_and_preserves_execute_mode() -> Result<(), Box<dyn std::error::Error>> {
        let source = "[Info]\r\nVersion=8.2\r\nCount=3\r\nExpanded=1\r\n[QuickButton]\r\nButton_0_Name=查看磁盘\r\nButton_0_Type=1\r\nButton_0_Icon=0\r\nButton_0_Action=df -h\\r\r\nButton_0_Param=\r\nButton_0_Desc=\r\nButton_1_Name=多行检查\r\nButton_1_Type=1\r\nButton_1_Action=cd /srv\\npwd\\r\r\nButton_2_Name=运行脚本\r\nButton_2_Type=2\r\nButton_2_Action=/tmp/check.sh\r\n";
        let parsed = parse_import("生产排查.qbl", &utf16le(source))?;
        assert_eq!(parsed.source_format, "xshell_qbl");
        assert_eq!(parsed.total, 3);
        assert_eq!(parsed.skipped, 1);
        assert_eq!(parsed.commands.len(), 2);
        assert_eq!(parsed.commands[0].group, "生产排查");
        assert_eq!(parsed.commands[0].command, "df -h");
        assert!(parsed.commands[0].send_newline);
        assert_eq!(parsed.commands[1].command, "cd /srv\npwd");
        Ok(())
    }

    #[test]
    fn previews_and_applies_safe_merge_atomically() -> Result<(), Box<dyn std::error::Error>> {
        let (config, root) = service()?;
        let native = NativeFile {
            format: NATIVE_FORMAT.to_owned(),
            version: 1,
            exported_at: 1,
            scope: "all".to_owned(),
            commands: vec![
                PortableCommand {
                    label: "Disk usage".to_owned(),
                    group: "常用".to_owned(),
                    command: "df -h".to_owned(),
                    send_newline: true,
                    sort: 0,
                },
                PortableCommand {
                    label: "Memory".to_owned(),
                    group: "常用".to_owned(),
                    command: "free -m".to_owned(),
                    send_newline: true,
                    sort: 1,
                },
                PortableCommand {
                    label: "健康检查".to_owned(),
                    group: "部署".to_owned(),
                    command: "curl -fsS localhost/health".to_owned(),
                    send_newline: true,
                    sort: 0,
                },
            ],
        };
        let bytes = serde_json::to_vec(&native)?;
        let preview = preview(&config, "commands.json", &bytes)?;
        assert_eq!(preview.duplicates, 1);
        assert_eq!(preview.conflicts, 1);
        assert_eq!(preview.importable, 2);

        let result = apply(
            &config,
            "commands.json",
            &bytes,
            QuickCommandImportStrategy::KeepBoth,
        )?;
        assert_eq!(result.duplicates, 1);
        assert_eq!(result.imported, 2);
        assert_eq!(result.renamed, 1);
        let commands = config.quick_command_list()?;
        assert!(commands
            .iter()
            .any(|command| command.label == "Memory (导入)"));
        assert!(commands.iter().any(|command| command.label == "健康检查"));
        assert!(!config.path().with_extension("json.tmp").exists());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn exports_versioned_json_without_runtime_ids() -> Result<(), Box<dyn std::error::Error>> {
        let (config, root) = service()?;
        let source = export(&config, Some("常用"))?;
        let value: serde_json::Value = serde_json::from_str(&source)?;
        assert_eq!(value["format"], NATIVE_FORMAT);
        assert_eq!(value["version"], 1);
        assert_eq!(value["scope"], "常用");
        assert!(value["commands"]
            .as_array()
            .is_some_and(|items| !items.is_empty()));
        assert!(source.find("\"id\"").is_none());
        if root.exists() {
            fs::remove_dir_all(root)?;
        }
        Ok(())
    }

    #[test]
    fn overwrite_preserves_existing_identity_and_order() -> Result<(), Box<dyn std::error::Error>> {
        let (config, root) = service()?;
        let existing = config
            .quick_command_list()?
            .into_iter()
            .find(|command| command.group == "常用" && command.label == "Memory")
            .ok_or("missing default Memory command")?;
        let native = NativeFile {
            format: NATIVE_FORMAT.to_owned(),
            version: NATIVE_VERSION,
            exported_at: 1,
            scope: "常用".to_owned(),
            commands: vec![PortableCommand {
                label: existing.label.clone(),
                group: existing.group.clone(),
                command: "free -m".to_owned(),
                send_newline: false,
                sort: 99,
            }],
        };

        let result = apply(
            &config,
            "commands.json",
            &serde_json::to_vec(&native)?,
            QuickCommandImportStrategy::Overwrite,
        )?;
        let updated = config
            .quick_command_list()?
            .into_iter()
            .find(|command| command.id == existing.id)
            .ok_or("overwritten command lost its identity")?;
        assert_eq!(result.replaced, 1);
        assert_eq!(updated.sort, existing.sort);
        assert_eq!(updated.command, "free -m");
        assert!(!updated.send_newline);
        fs::remove_dir_all(root)?;
        Ok(())
    }
}

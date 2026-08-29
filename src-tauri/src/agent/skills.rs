use std::{collections::HashMap, fs, path::Path};

use sha2::{Digest, Sha256};

use crate::{types::SkillInfo, AppError};

const MAX_SKILLS: usize = 64;
const MAX_SKILL_BYTES: usize = 64 * 1024;
const MAX_TOTAL_BYTES: usize = 128 * 1024;

#[derive(Clone, Debug)]
pub struct LoadedSkill {
    pub info: SkillInfo,
    pub content: String,
}

pub struct RestoredSkills {
    pub loaded: Vec<LoadedSkill>,
    pub warnings: Vec<String>,
}

pub fn discover(directories: &[String]) -> Result<Vec<SkillInfo>, AppError> {
    let mut skills = Vec::new();
    for directory in directories {
        let root = Path::new(directory);
        if !root.is_dir() {
            continue;
        }
        visit(root, 0, &mut skills)?;
        if skills.len() >= MAX_SKILLS {
            break;
        }
    }
    skills.sort_by(|left, right| left.name.cmp(&right.name).then(left.path.cmp(&right.path)));
    skills.dedup_by(|left, right| left.id == right.id);
    skills.truncate(MAX_SKILLS);
    Ok(skills)
}

pub fn load_enabled(directories: &[String], enabled: &[String]) -> Result<String, AppError> {
    let available: HashMap<_, _> = discover(directories)?
        .into_iter()
        .map(|skill| (skill.id.clone(), skill))
        .collect();
    let mut catalog = Vec::new();
    for id in enabled {
        let Some(skill) = available.get(id) else {
            continue;
        };
        catalog.push(skill.clone());
    }
    if catalog.is_empty() {
        return Ok(String::new());
    }
    Ok(format!(
        "Enabled Skill catalog (metadata only). Call skill_load with an exact enabled id only when its workflow is relevant:\n{}",
        serde_json::to_string(&catalog)?
    ))
}

pub fn load_content(
    directories: &[String],
    enabled: &[String],
    id: &str,
) -> Result<String, AppError> {
    if !enabled.iter().any(|enabled_id| enabled_id == id) {
        return Err(AppError::NotFound(format!("enabled skill '{id}'")));
    }
    let skill = discover(directories)?
        .into_iter()
        .find(|skill| skill.id == id)
        .ok_or_else(|| AppError::NotFound(format!("skill '{id}'")))?;
    let source = fs::read(&skill.path)?;
    let allowed = source.len().min(MAX_SKILL_BYTES).min(MAX_TOTAL_BYTES);
    Ok(String::from_utf8_lossy(&source[..allowed]).into_owned())
}

pub fn load_for_model(
    directories: &[String],
    enabled: &[String],
    id: &str,
) -> Result<LoadedSkill, AppError> {
    if !enabled.iter().any(|enabled_id| enabled_id == id) {
        return Err(AppError::NotFound(format!("enabled skill '{id}'")));
    }
    let info = discover(directories)?
        .into_iter()
        .find(|skill| skill.id == id)
        .ok_or_else(|| AppError::NotFound(format!("skill '{id}'")))?;
    if !info.model_invocable {
        return Err(AppError::InvalidInput(format!(
            "skill '{}' is configured as model_invocable=false and can only be loaded explicitly by the user",
            info.name
        )));
    }
    if !info.platforms.is_empty()
        && !info.platforms.iter().any(|platform| {
            matches!(
                platform.trim().to_ascii_lowercase().as_str(),
                "linux" | "unix" | "ssh" | "all" | "any" | "*"
            )
        })
    {
        return Err(AppError::InvalidInput(format!(
            "skill '{}' does not declare support for Linux/SSH targets (platforms: {})",
            info.name,
            info.platforms.join(", ")
        )));
    }
    let source = fs::read(&info.path)?;
    let allowed = source.len().min(MAX_SKILL_BYTES).min(MAX_TOTAL_BYTES);
    Ok(LoadedSkill {
        info,
        content: String::from_utf8_lossy(&source[..allowed]).into_owned(),
    })
}

pub fn restore_for_model(
    directories: &[String],
    enabled: &[String],
    ids: &[String],
) -> RestoredSkills {
    let mut loaded = Vec::new();
    let mut warnings = Vec::new();
    let mut remaining = MAX_TOTAL_BYTES;
    for id in ids {
        if remaining == 0 {
            warnings.push(format!(
                "active Skill context limit reached before restoring '{id}'"
            ));
            break;
        }
        match load_for_model(directories, enabled, id) {
            Ok(mut skill) => {
                if skill.content.len() > remaining {
                    let mut end = remaining;
                    while end > 0 && !skill.content.is_char_boundary(end) {
                        end -= 1;
                    }
                    skill.content.truncate(end);
                    warnings.push(format!(
                        "active Skill '{}' was bounded to the remaining {} context bytes",
                        skill.info.name, end
                    ));
                }
                remaining = remaining.saturating_sub(skill.content.len());
                loaded.push(skill);
            }
            Err(error) => warnings.push(format!(
                "unable to restore active Skill '{id}': {}",
                error.detail()
            )),
        }
    }
    RestoredSkills { loaded, warnings }
}

pub fn active_context(skills: &[LoadedSkill]) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let sections = skills
        .iter()
        .map(|skill| {
            format!(
                "Active Skill '{}' (id: {}):\n{}",
                skill.info.name, skill.info.id, skill.content
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "The following Skills were explicitly loaded earlier in this persisted Goal. Their metadata constraints remain enforced for this Turn:\n{sections}"
    )
}

pub fn allows_tool(skill: &SkillInfo, tool_name: &str) -> bool {
    if skill.allowed_tools.is_empty() {
        return true;
    }
    skill.allowed_tools.iter().any(|allowed| {
        let allowed = allowed.trim();
        allowed == "*"
            || allowed == tool_name
            || allowed
                .strip_suffix('*')
                .is_some_and(|prefix| tool_name.starts_with(prefix))
    })
}

fn visit(directory: &Path, depth: u8, skills: &mut Vec<SkillInfo>) -> Result<(), AppError> {
    if depth > 3 || skills.len() >= MAX_SKILLS {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            visit(&path, depth + 1, skills)?;
        } else if entry
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case("SKILL.md")
        {
            skills.push(read_info(&path)?);
        }
        if skills.len() >= MAX_SKILLS {
            break;
        }
    }
    Ok(())
}

fn read_info(path: &Path) -> Result<SkillInfo, AppError> {
    let canonical = fs::canonicalize(path)?;
    let source = fs::read_to_string(&canonical)?;
    let metadata = frontmatter(&source);
    let fallback = canonical
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Skill".to_owned());
    let path = canonical.to_string_lossy().into_owned();
    Ok(SkillInfo {
        id: path.clone(),
        name: metadata.name.unwrap_or(fallback),
        description: metadata.description.unwrap_or_default(),
        path,
        content_hash: format!("{:x}", Sha256::digest(source.as_bytes())),
        platforms: metadata.platforms,
        allowed_tools: metadata.allowed_tools,
        risk: metadata.risk.unwrap_or_else(|| "confirm".to_owned()),
        model_invocable: metadata.model_invocable.unwrap_or(true),
        trusted: false,
    })
}

#[derive(Default)]
struct SkillMetadata {
    name: Option<String>,
    description: Option<String>,
    platforms: Vec<String>,
    allowed_tools: Vec<String>,
    risk: Option<String>,
    model_invocable: Option<bool>,
}

fn frontmatter(source: &str) -> SkillMetadata {
    let mut lines = source.lines();
    if lines.next().map(str::trim) != Some("---") {
        return SkillMetadata::default();
    }
    let mut metadata = SkillMetadata::default();
    let mut list_key: Option<String> = None;
    for line in lines {
        let line = line.trim();
        if line == "---" {
            break;
        }
        if let Some(item) = line.strip_prefix('-') {
            let item = unquote(item.trim());
            if !item.is_empty() {
                match list_key.as_deref() {
                    Some("platforms") => metadata.platforms.push(item),
                    Some("allowed_tools") => metadata.allowed_tools.push(item),
                    _ => {}
                }
            }
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        let key = key.trim().replace('-', "_");
        list_key = None;
        match key.as_str() {
            "name" => metadata.name = non_empty(value),
            "description" => metadata.description = non_empty(value),
            "platforms" => {
                metadata.platforms = parse_list(value);
                if value.is_empty() {
                    list_key = Some(key);
                }
            }
            "allowed_tools" => {
                metadata.allowed_tools = parse_list(value);
                if value.is_empty() {
                    list_key = Some(key);
                }
            }
            "risk" => metadata.risk = non_empty(value),
            "model_invocable" => metadata.model_invocable = parse_bool(value),
            "disable_model_invocation" => {
                metadata.model_invocable = parse_bool(value).map(|disabled| !disabled)
            }
            _ => {}
        }
    }
    metadata
}

fn non_empty(value: &str) -> Option<String> {
    let value = unquote(value);
    (!value.is_empty()).then_some(value)
}

fn parse_bool(value: &str) -> Option<bool> {
    match unquote(value).to_ascii_lowercase().as_str() {
        "true" | "yes" | "1" => Some(true),
        "false" | "no" | "0" => Some(false),
        _ => None,
    }
}

fn unquote(value: &str) -> String {
    value.trim().trim_matches(['"', '\'']).to_owned()
}

fn parse_list(value: &str) -> Vec<String> {
    if value.trim().is_empty() {
        return Vec::new();
    }
    value
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(unquote)
        .filter(|value| !value.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{allows_tool, discover, load_enabled, load_for_model};

    #[test]
    fn discovers_and_loads_selected_skill_files() -> Result<(), Box<dyn std::error::Error>> {
        let root = std::env::temp_dir().join(format!("myterm-skills-{}", uuid::Uuid::new_v4()));
        let skill_dir = root.join("linux-triage");
        fs::create_dir_all(&skill_dir)?;
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: Linux Triage\ndescription: Diagnose Linux services\n---\n# Workflow\nRead logs first.",
        )?;

        let directories = vec![root.to_string_lossy().into_owned()];
        let skills = discover(&directories)?;
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "Linux Triage");
        let loaded = load_enabled(&directories, &[skills[0].id.clone()])?;
        assert!(loaded.contains("Linux Triage"));
        assert!(!loaded.contains("Read logs first"));
        let content = super::load_content(&directories, &[skills[0].id.clone()], &skills[0].id)?;
        assert!(content.contains("Read logs first"));

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn parses_common_hyphenated_metadata_and_block_lists() -> Result<(), Box<dyn std::error::Error>>
    {
        let root =
            std::env::temp_dir().join(format!("myterm-skill-metadata-{}", uuid::Uuid::new_v4()));
        let skill_dir = root.join("safe-linux");
        fs::create_dir_all(&skill_dir)?;
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: Safe Linux\nplatforms:\n  - linux\n  - ssh\nallowed-tools:\n  - session_*\n  - terminal_context\nrisk: read-only\nmodel-invocable: yes\n---\n# Workflow\nInspect first.",
        )?;

        let directories = vec![root.to_string_lossy().into_owned()];
        let skill = discover(&directories)?.pop().expect("skill");
        assert_eq!(skill.platforms, ["linux", "ssh"]);
        assert_eq!(skill.risk, "read-only");
        assert!(skill.model_invocable);
        assert!(allows_tool(&skill, "session_catalog"));
        assert!(allows_tool(&skill, "terminal_context"));
        assert!(!allows_tool(&skill, "remote_exec"));
        assert!(load_for_model(&directories, &[skill.id.clone()], &skill.id).is_ok());

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn disable_model_invocation_metadata_is_enforced() -> Result<(), Box<dyn std::error::Error>> {
        let root =
            std::env::temp_dir().join(format!("myterm-skill-user-only-{}", uuid::Uuid::new_v4()));
        let skill_dir = root.join("user-only");
        fs::create_dir_all(&skill_dir)?;
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: User Only\ndisable-model-invocation: true\n---\n# Workflow",
        )?;

        let directories = vec![root.to_string_lossy().into_owned()];
        let skill = discover(&directories)?.pop().expect("skill");
        assert!(!skill.model_invocable);
        assert!(load_for_model(&directories, &[skill.id.clone()], &skill.id).is_err());

        fs::remove_dir_all(root)?;
        Ok(())
    }
}

use std::{collections::HashMap, fs, path::Path};

use sha2::{Digest, Sha256};

use crate::{types::SkillInfo, AppError};

const MAX_SKILLS: usize = 64;
const MAX_SKILL_BYTES: usize = 64 * 1024;
const MAX_TOTAL_BYTES: usize = 128 * 1024;

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
    for line in lines {
        let line = line.trim();
        if line == "---" {
            break;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "name" => metadata.name = Some(unquote(value)),
            "description" => metadata.description = Some(unquote(value)),
            "platforms" => metadata.platforms = parse_list(value),
            "allowed_tools" => metadata.allowed_tools = parse_list(value),
            "risk" => metadata.risk = Some(unquote(value)),
            "model_invocable" => metadata.model_invocable = value.parse().ok(),
            _ => {}
        }
    }
    metadata
}

fn unquote(value: &str) -> String {
    value.trim().trim_matches(['"', '\'']).to_owned()
}

fn parse_list(value: &str) -> Vec<String> {
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

    use super::{discover, load_enabled};

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
}

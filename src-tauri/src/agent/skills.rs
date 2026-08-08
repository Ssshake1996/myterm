use std::{collections::HashMap, fs, path::Path};

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
        .map(|skill| (skill.id, skill.path))
        .collect();
    let mut total = 0;
    let mut sections = Vec::new();
    for id in enabled {
        let Some(path) = available.get(id) else {
            continue;
        };
        let source = fs::read(path)?;
        let allowed = source
            .len()
            .min(MAX_SKILL_BYTES)
            .min(MAX_TOTAL_BYTES - total);
        if allowed == 0 {
            break;
        }
        total += allowed;
        sections.push(format!(
            "<skill path=\"{}\">\n{}\n</skill>",
            path,
            String::from_utf8_lossy(&source[..allowed])
        ));
    }
    Ok(sections.join("\n\n"))
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
    let (header_name, header_description) = frontmatter(&source);
    let fallback = canonical
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Skill".to_owned());
    let path = canonical.to_string_lossy().into_owned();
    Ok(SkillInfo {
        id: path.clone(),
        name: header_name.unwrap_or(fallback),
        description: header_description.unwrap_or_default(),
        path,
    })
}

fn frontmatter(source: &str) -> (Option<String>, Option<String>) {
    let mut lines = source.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let mut name = None;
    let mut description = None;
    for line in lines {
        let line = line.trim();
        if line == "---" {
            break;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim().trim_matches(['"', '\'']).to_owned();
        match key.trim() {
            "name" => name = Some(value),
            "description" => description = Some(value),
            _ => {}
        }
    }
    (name, description)
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
        assert!(loaded.contains("Read logs first"));

        fs::remove_dir_all(root)?;
        Ok(())
    }
}

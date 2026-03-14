use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::{
    models::{Channel, SourceKind},
    service::{ServiceError, ServiceResult},
};

const MANIFEST_FILE: &str = "bronzeforge.addon.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BronzeForgeManifest {
    pub schema_version: u8,
    pub addon_id: Option<String>,
    pub display_name: Option<String>,
    pub install_folder: Option<String>,
    pub version: Option<String>,
    pub default_channel: Option<Channel>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    #[serde(default)]
    pub saved_variables: Vec<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub channels: BTreeMap<String, ManifestChannelSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestChannelSpec {
    pub kind: SourceKind,
    pub path: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LocalAddonMetadata {
    pub addon_id: String,
    pub display_name: String,
    pub install_folder: String,
    pub version: String,
    pub default_channel: Channel,
    pub dependencies: Vec<String>,
    pub conflicts: Vec<String>,
    pub saved_variables: Vec<String>,
    pub notes: Option<String>,
    pub toc_file: String,
}

pub fn read_manifest_file(path: &Path) -> ServiceResult<BronzeForgeManifest> {
    let content = fs::read_to_string(path)?;
    let manifest: BronzeForgeManifest = serde_json::from_str(&content)?;
    if manifest.schema_version == 0 {
        return Err(ServiceError::Message(
            "Manifest schemaVersion must be at least 1".to_string(),
        ));
    }
    Ok(manifest)
}

pub fn load_local_metadata(
    path: &Path,
    channel_hint: Channel,
) -> ServiceResult<LocalAddonMetadata> {
    let root = normalize_addon_root(path)?;
    let toc_file = find_toc_file(&root)?;
    let toc_name = toc_file
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ServiceError::Message("Invalid TOC file name".to_string()))?
        .to_string();

    let manifest_path = root.join(MANIFEST_FILE);
    let manifest = manifest_path
        .exists()
        .then(|| read_manifest_file(&manifest_path))
        .transpose()?;
    let toc_meta = parse_toc_file(&toc_file)?;

    let install_folder = manifest
        .as_ref()
        .and_then(|item| item.install_folder.clone())
        .unwrap_or_else(|| {
            root.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("addon")
                .to_string()
        });

    let display_name = manifest
        .as_ref()
        .and_then(|item| item.display_name.clone())
        .or_else(|| toc_meta.title.clone())
        .unwrap_or_else(|| install_folder.clone());

    let version = manifest
        .as_ref()
        .and_then(|item| item.version.clone())
        .or(toc_meta.version)
        .unwrap_or_else(|| "0.1.0-local".to_string());

    let addon_id = manifest
        .as_ref()
        .and_then(|item| item.addon_id.clone())
        .unwrap_or_else(|| slugify(&install_folder));

    Ok(LocalAddonMetadata {
        addon_id,
        display_name,
        install_folder,
        version,
        default_channel: manifest
            .as_ref()
            .and_then(|item| item.default_channel)
            .unwrap_or(channel_hint),
        dependencies: manifest
            .as_ref()
            .map(|item| item.dependencies.clone())
            .unwrap_or_default(),
        conflicts: manifest
            .as_ref()
            .map(|item| item.conflicts.clone())
            .unwrap_or_default(),
        saved_variables: manifest
            .as_ref()
            .map(|item| item.saved_variables.clone())
            .unwrap_or_default(),
        notes: manifest.and_then(|item| item.notes),
        toc_file: toc_name,
    })
}

pub fn normalize_addon_root(path: &Path) -> ServiceResult<PathBuf> {
    if !path.exists() {
        return Err(ServiceError::Message(format!(
            "Addon source does not exist: {}",
            path.display()
        )));
    }

    if path.is_file() {
        return Err(ServiceError::Message(format!(
            "Expected a folder for addon source, got file: {}",
            path.display()
        )));
    }

    if contains_toc(path)? {
        return Ok(path.to_path_buf());
    }

    let mut candidates = Vec::new();
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.path().is_dir() && contains_toc(&entry.path())? {
            candidates.push(entry.path());
        }
    }

    if candidates.len() == 1 {
        return Ok(candidates.remove(0));
    }

    Err(ServiceError::Message(format!(
        "Could not determine addon root for {}. Expected a folder with a .toc file.",
        path.display()
    )))
}

pub fn slugify(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            output.push(character.to_ascii_lowercase());
        } else if (character.is_ascii_whitespace() || character == '-' || character == '_')
            && !output.ends_with('-')
        {
            output.push('-');
        }
    }
    output.trim_matches('-').to_string()
}

fn contains_toc(path: &Path) -> ServiceResult<bool> {
    Ok(fs::read_dir(path)?
        .filter_map(Result::ok)
        .any(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("toc")))
}

fn find_toc_file(root: &Path) -> ServiceResult<PathBuf> {
    fs::read_dir(root)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.extension().and_then(|value| value.to_str()) == Some("toc"))
        .ok_or_else(|| ServiceError::Message(format!("Missing .toc file in {}", root.display())))
}

#[derive(Default)]
struct TocMetadata {
    title: Option<String>,
    version: Option<String>,
}

fn parse_toc_file(path: &Path) -> ServiceResult<TocMetadata> {
    let content = fs::read_to_string(path)?;
    let mut metadata = TocMetadata::default();
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if let Some(value) = line.strip_prefix("## Title:") {
            metadata.title = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("## Version:") {
            metadata.version = Some(value.trim().to_string());
        }
    }
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::{load_local_metadata, normalize_addon_root, slugify};
    use crate::models::Channel;
    use std::{fs, path::Path};

    fn write_addon(base: &Path, folder_name: &str, toc_name: &str) {
        let addon_dir = base.join(folder_name);
        fs::create_dir_all(&addon_dir).unwrap();
        fs::write(
            addon_dir.join(toc_name),
            "## Title: BronzeForge Test\n## Version: 1.2.3\n",
        )
        .unwrap();
    }

    #[test]
    fn slugify_keeps_a_stable_identifier() {
        assert_eq!(slugify("Bronze Forge_Test"), "bronze-forge-test");
    }

    #[test]
    fn normalize_addon_root_accepts_nested_folder() {
        let temp = tempfile::tempdir().unwrap();
        write_addon(temp.path(), "ExampleAddon", "ExampleAddon.toc");
        let resolved = normalize_addon_root(temp.path()).unwrap();
        assert!(resolved.ends_with("ExampleAddon"));
    }

    #[test]
    fn metadata_infers_from_toc_when_manifest_missing() {
        let temp = tempfile::tempdir().unwrap();
        write_addon(temp.path(), "BronzeForgeUI", "BronzeForgeUI.toc");
        let metadata = load_local_metadata(temp.path(), Channel::Stable).unwrap();
        assert_eq!(metadata.display_name, "BronzeForge Test");
        assert_eq!(metadata.version, "1.2.3");
        assert_eq!(metadata.install_folder, "BronzeForgeUI");
    }
}

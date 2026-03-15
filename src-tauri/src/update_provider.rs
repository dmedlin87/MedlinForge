use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

use reqwest::blocking::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use crate::{
    models::{Channel, RemoteProductType, Settings, UpdateChannel},
    service::{ServiceError, ServiceResult},
};

const DEFAULT_CATALOG_BASE_URL: &str = env!("BRONZEFORGE_UPDATE_MANIFEST_BASE_URL");
const DEFAULT_PUBLISHER: &str = env!("BRONZEFORGE_UPDATE_PUBLISHER");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCatalog {
    pub schema_version: u8,
    pub publisher: String,
    pub generated_at: String,
    pub channel: UpdateChannel,
    pub products: BTreeMap<String, RemoteManifestProduct>,
    pub packs: BTreeMap<String, RemoteManifestPack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteManifestProduct {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub product_type: RemoteProductType,
    pub channel: UpdateChannel,
    pub latest_version: String,
    pub published_at: String,
    pub release_url: String,
    pub package_url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub min_manager_version: Option<String>,
    pub platform: Option<String>,
    pub install_kind: Option<String>,
    pub changelog: Option<String>,
    pub repository: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteManifestPack {
    pub pack_id: String,
    pub name: String,
    pub description: String,
    pub default_channel: Channel,
    pub recovery_label: Option<String>,
    pub recovery_description: Option<String>,
    pub members: Vec<RemoteManifestPackMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteManifestPackMember {
    pub product_id: String,
    pub required: bool,
}

pub struct UpdateProvider {
    client: Client,
}

impl UpdateProvider {
    pub fn new() -> ServiceResult<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("BronzeForge-Manager")
            .build()
            .map_err(|error| ServiceError::Message(error.to_string()))?;
        Ok(Self { client })
    }

    pub fn resolve_catalog_url(&self, settings: &Settings) -> ServiceResult<String> {
        let base = settings
            .update_manifest_override
            .as_ref()
            .filter(|value| settings.dev_mode_enabled && !value.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| DEFAULT_CATALOG_BASE_URL.to_string());
        let normalized_base = if base.ends_with('/') {
            base
        } else {
            format!("{base}/")
        };

        let base_url = Url::parse(normalized_base.trim()).map_err(|error| {
            ServiceError::Message(format!("Invalid update catalog base URL: {error}"))
        })?;
        if base_url.scheme() != "https"
            && !(settings.dev_mode_enabled && base_url.scheme() == "http")
        {
            return Err(ServiceError::Message(
                "Update catalog base URL must use HTTPS unless dev mode override is enabled"
                    .to_string(),
            ));
        }

        Ok(base_url
            .join(&format!("{}.json", settings.update_channel.as_str()))
            .map_err(|error| ServiceError::Message(format!("Invalid update catalog URL: {error}")))?
            .to_string())
    }

    pub fn fetch_catalog(&self, settings: &Settings) -> ServiceResult<(String, UpdateCatalog)> {
        let catalog_url = self.resolve_catalog_url(settings)?;
        let response = self.client.get(&catalog_url).send().map_err(|error| {
            ServiceError::Message(format!("Failed to fetch update catalog: {error}"))
        })?;
        if !response.status().is_success() {
            return Err(ServiceError::Message(format!(
                "Failed to fetch update catalog: HTTP {}",
                response.status()
            )));
        }
        let body = response.text().map_err(|error| {
            ServiceError::Message(format!("Failed to read update catalog: {error}"))
        })?;
        let catalog: UpdateCatalog = serde_json::from_str(&body)?;
        self.validate_catalog(&catalog_url, &catalog, settings.dev_mode_enabled)?;
        Ok((catalog_url, catalog))
    }

    pub fn download_verified_asset(
        &self,
        settings: &Settings,
        product: &RemoteManifestProduct,
        target_path: &Path,
    ) -> ServiceResult<PathBuf> {
        self.validate_product(product, settings.dev_mode_enabled)?;
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut response = self
            .client
            .get(&product.package_url)
            .send()
            .map_err(|error| {
                ServiceError::Message(format!("Failed to download {}: {error}", product.id))
            })?;
        if !response.status().is_success() {
            return Err(ServiceError::Message(format!(
                "Failed to download {}: HTTP {}",
                product.id,
                response.status()
            )));
        }

        let mut file = fs::File::create(target_path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 8192];
        loop {
            let read = response.read(&mut buffer).map_err(|error| {
                ServiceError::Message(format!("Failed to read {}: {error}", product.id))
            })?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            std::io::Write::write_all(&mut file, &buffer[..read])?;
        }

        let digest = format!("{:x}", hasher.finalize());
        if digest != product.sha256 {
            let _ = fs::remove_file(target_path);
            return Err(ServiceError::Message(format!(
                "Checksum verification failed for {}",
                product.id
            )));
        }
        Ok(target_path.to_path_buf())
    }

    pub fn is_remote_newer(remote_version: &str, current_version: Option<&str>) -> bool {
        let Some(current_version) = current_version else {
            return true;
        };
        match (
            parse_version(remote_version),
            parse_version(current_version),
        ) {
            (Some(remote), Some(current)) => remote > current,
            _ => normalize_version(remote_version) != normalize_version(current_version),
        }
    }

    pub fn manager_version_satisfies(minimum_version: Option<&str>) -> bool {
        let Some(minimum_version) = minimum_version else {
            return true;
        };
        match (
            parse_version(env!("CARGO_PKG_VERSION")),
            parse_version(minimum_version),
        ) {
            (Some(current), Some(minimum)) => current >= minimum,
            _ => normalize_version(env!("CARGO_PKG_VERSION")) >= normalize_version(minimum_version),
        }
    }

    fn validate_catalog(
        &self,
        catalog_url: &str,
        catalog: &UpdateCatalog,
        allow_http_override: bool,
    ) -> ServiceResult<()> {
        validate_url(catalog_url, allow_http_override)?;
        if catalog.schema_version != 2 {
            return Err(ServiceError::Message(format!(
                "Unsupported update catalog schemaVersion {}",
                catalog.schema_version
            )));
        }
        if catalog.publisher != DEFAULT_PUBLISHER {
            return Err(ServiceError::Message(format!(
                "Unexpected catalog publisher '{}'",
                catalog.publisher
            )));
        }
        for (product_id, product) in &catalog.products {
            if product.id != *product_id {
                return Err(ServiceError::Message(format!(
                    "Catalog product key '{}' does not match payload id '{}'",
                    product_id, product.id
                )));
            }
            if product.channel != catalog.channel {
                return Err(ServiceError::Message(format!(
                    "Catalog product '{}' channel does not match catalog channel",
                    product.id
                )));
            }
            self.validate_product(product, allow_http_override)?;
        }
        for (pack_id, pack) in &catalog.packs {
            if pack.pack_id != *pack_id {
                return Err(ServiceError::Message(format!(
                    "Catalog pack key '{}' does not match payload id '{}'",
                    pack_id, pack.pack_id
                )));
            }
            self.validate_pack(pack, &catalog.products)?;
        }
        Ok(())
    }

    fn validate_pack(
        &self,
        pack: &RemoteManifestPack,
        products: &BTreeMap<String, RemoteManifestProduct>,
    ) -> ServiceResult<()> {
        if pack.name.trim().is_empty() {
            return Err(ServiceError::Message(format!(
                "Pack '{}' is missing a name",
                pack.pack_id
            )));
        }
        if pack.description.trim().is_empty() {
            return Err(ServiceError::Message(format!(
                "Pack '{}' is missing a description",
                pack.pack_id
            )));
        }
        if pack.members.is_empty() {
            return Err(ServiceError::Message(format!(
                "Pack '{}' has no members",
                pack.pack_id
            )));
        }
        for member in &pack.members {
            let product = products.get(&member.product_id).ok_or_else(|| {
                ServiceError::Message(format!(
                    "Pack '{}' references unknown product '{}'",
                    pack.pack_id, member.product_id
                ))
            })?;
            if product.product_type != RemoteProductType::Addon {
                return Err(ServiceError::Message(format!(
                    "Pack '{}' can only reference addon products",
                    pack.pack_id
                )));
            }
        }
        Ok(())
    }

    fn validate_product(
        &self,
        product: &RemoteManifestProduct,
        allow_http_override: bool,
    ) -> ServiceResult<()> {
        validate_url(&product.package_url, allow_http_override)?;
        validate_url(&product.release_url, allow_http_override)?;

        if !product
            .sha256
            .chars()
            .all(|value| value.is_ascii_hexdigit())
            || product.sha256.len() != 64
        {
            return Err(ServiceError::Message(format!(
                "Product '{}' checksum is invalid",
                product.id
            )));
        }
        if parse_version(&product.latest_version).is_none()
            && !looks_like_semver(&product.latest_version)
        {
            return Err(ServiceError::Message(format!(
                "Product '{}' version '{}' is invalid",
                product.id, product.latest_version
            )));
        }

        if let Some(repository) = product.repository.as_ref() {
            validate_github_asset_url(&product.package_url, repository)?;
            validate_github_asset_url(&product.release_url, repository)?;
        } else {
            validate_github_host(&product.package_url)?;
            validate_github_host(&product.release_url)?;
        }
        Ok(())
    }
}

fn validate_url(value: &str, allow_http_override: bool) -> ServiceResult<()> {
    let parsed = Url::parse(value)
        .map_err(|error| ServiceError::Message(format!("Invalid URL '{value}': {error}")))?;
    if parsed.scheme() != "https" && !(allow_http_override && parsed.scheme() == "http") {
        return Err(ServiceError::Message(format!(
            "URL '{value}' must use HTTPS"
        )));
    }
    Ok(())
}

fn validate_github_host(value: &str) -> ServiceResult<()> {
    let parsed = Url::parse(value)
        .map_err(|error| ServiceError::Message(format!("Invalid URL '{value}': {error}")))?;
    let host = parsed.host_str().unwrap_or_default();
    if host != "github.com" {
        return Err(ServiceError::Message(format!(
            "URL '{value}' must point to github.com"
        )));
    }
    Ok(())
}

fn validate_github_asset_url(value: &str, repository: &str) -> ServiceResult<()> {
    validate_github_host(value)?;
    let parsed = Url::parse(value)
        .map_err(|error| ServiceError::Message(format!("Invalid URL '{value}': {error}")))?;
    let path = parsed.path().trim_start_matches('/');
    if !path.starts_with(&format!("{repository}/releases/")) {
        return Err(ServiceError::Message(format!(
            "URL '{value}' does not match repository '{repository}'"
        )));
    }
    Ok(())
}

fn normalize_version(value: &str) -> String {
    value.trim().trim_start_matches('v').to_ascii_lowercase()
}

fn parse_version(value: &str) -> Option<Version> {
    Version::parse(value.trim().trim_start_matches('v')).ok()
}

fn looks_like_semver(value: &str) -> bool {
    let normalized = value.trim().trim_start_matches('v');
    let mut components = normalized.splitn(2, '-');
    let main = components.next().unwrap_or_default();
    let mut parts = main.split('.');
    matches!(
        (parts.next(), parts.next(), parts.next(), parts.next()),
        (Some(major), Some(minor), Some(patch), None)
            if major.parse::<u64>().is_ok()
                && minor.parse::<u64>().is_ok()
                && patch.parse::<u64>().is_ok()
    )
}

#[cfg(test)]
mod tests {
    use super::{
        RemoteManifestPack, RemoteManifestPackMember, RemoteManifestProduct, UpdateCatalog,
        UpdateProvider,
    };
    use crate::models::{Channel, RemoteProductType, UpdateChannel};
    use std::collections::BTreeMap;

    fn product(version: &str) -> RemoteManifestProduct {
        RemoteManifestProduct {
            id: "bronzeforge-manager".to_string(),
            name: "BronzeForge Manager".to_string(),
            product_type: RemoteProductType::Manager,
            channel: UpdateChannel::Stable,
            latest_version: version.to_string(),
            published_at: "2026-03-14T16:00:00Z".to_string(),
            release_url: "https://github.com/dmedlin87/MedlinForge/releases/tag/v1.2.3".to_string(),
            package_url:
                "https://github.com/dmedlin87/MedlinForge/releases/download/v1.2.3/asset.exe"
                    .to_string(),
            sha256: "a".repeat(64),
            size_bytes: 1234,
            min_manager_version: None,
            platform: Some("windows-x64".to_string()),
            install_kind: Some("nsis-installer".to_string()),
            changelog: None,
            repository: Some("dmedlin87/MedlinForge".to_string()),
        }
    }

    #[test]
    fn remote_version_comparison_prefers_semver() {
        assert!(UpdateProvider::is_remote_newer("1.2.4", Some("1.2.3")));
        assert!(!UpdateProvider::is_remote_newer("1.2.3", Some("1.2.3")));
        assert!(UpdateProvider::is_remote_newer(
            "1.3.0-beta.1",
            Some("1.2.9")
        ));
    }

    #[test]
    fn manager_minimum_version_defaults_to_supported() {
        assert!(UpdateProvider::manager_version_satisfies(None));
    }

    #[test]
    fn validates_repository_bound_github_urls() {
        let provider = UpdateProvider::new().unwrap();
        provider.validate_product(&product("1.2.3"), false).unwrap();
    }

    #[test]
    fn validates_pack_members_against_products() {
        let provider = UpdateProvider::new().unwrap();
        let mut products = BTreeMap::new();
        products.insert(
            "bronzeforge-ui".to_string(),
            RemoteManifestProduct {
                id: "bronzeforge-ui".to_string(),
                name: "BronzeForge UI".to_string(),
                product_type: RemoteProductType::Addon,
                channel: UpdateChannel::Stable,
                latest_version: "1.0.0".to_string(),
                published_at: "2026-03-14T16:00:00Z".to_string(),
                release_url: "https://github.com/dmedlin87/BronzeForgeUI/releases/tag/v1.0.0"
                    .to_string(),
                package_url:
                    "https://github.com/dmedlin87/BronzeForgeUI/releases/download/v1.0.0/BronzeForgeUI.zip"
                        .to_string(),
                sha256: "b".repeat(64),
                size_bytes: 2048,
                min_manager_version: None,
                platform: Some("windows-any".to_string()),
                install_kind: Some("addon-folder-zip".to_string()),
                changelog: None,
                repository: Some("dmedlin87/BronzeForgeUI".to_string()),
            },
        );
        let pack = RemoteManifestPack {
            pack_id: "bronzeforge-default".to_string(),
            name: "BronzeForge Pack".to_string(),
            description: "Curated pack".to_string(),
            default_channel: Channel::Stable,
            recovery_label: None,
            recovery_description: None,
            members: vec![RemoteManifestPackMember {
                product_id: "bronzeforge-ui".to_string(),
                required: true,
            }],
        };
        provider.validate_pack(&pack, &products).unwrap();
    }

    #[test]
    fn rejects_catalog_with_invalid_schema() {
        let provider = UpdateProvider::new().unwrap();
        let catalog = UpdateCatalog {
            schema_version: 1,
            publisher: "dmedlin87".to_string(),
            generated_at: "2026-03-14T16:00:00Z".to_string(),
            channel: UpdateChannel::Stable,
            products: BTreeMap::new(),
            packs: BTreeMap::new(),
        };
        assert!(
            provider
                .validate_catalog(
                    "https://dmedlin87.github.io/MedlinForge/catalog/stable.json",
                    &catalog,
                    false
                )
                .is_err()
        );
    }
}

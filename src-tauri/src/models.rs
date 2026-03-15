use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Channel {
    Stable,
    Beta,
    LocalDev,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
            Self::LocalDev => "localDev",
        }
    }
}

impl std::fmt::Display for Channel {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::str::FromStr for Channel {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "stable" | "Stable" => Ok(Self::Stable),
            "beta" | "Beta" => Ok(Self::Beta),
            "localDev" | "local-dev" | "LocalDev" | "Local Dev" => Ok(Self::LocalDev),
            _ => Err(format!("Unsupported channel '{value}'")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateChannel {
    Stable,
    Beta,
}

impl UpdateChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
        }
    }
}

impl std::fmt::Display for UpdateChannel {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::str::FromStr for UpdateChannel {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "stable" | "Stable" => Ok(Self::Stable),
            "beta" | "Beta" => Ok(Self::Beta),
            _ => Err(format!("Unsupported update channel '{value}'")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RemoteProductType {
    Manager,
    Addon,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    LocalFolder,
    ZipFile,
    Manifest,
}

impl SourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LocalFolder => "local-folder",
            Self::ZipFile => "zip-file",
            Self::Manifest => "manifest",
        }
    }
}

impl std::fmt::Display for SourceKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::str::FromStr for SourceKind {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "local-folder" | "localFolder" => Ok(Self::LocalFolder),
            "zip-file" | "zipFile" | "zip" => Ok(Self::ZipFile),
            "manifest" => Ok(Self::Manifest),
            _ => Err(format!("Unsupported source kind '{value}'")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Blocker,
    Warning,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SnapshotType {
    Preflight,
    Recovery,
    Manual,
}

impl SnapshotType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Preflight => "preflight",
            Self::Recovery => "recovery",
            Self::Manual => "manual",
        }
    }
}

impl std::str::FromStr for SnapshotType {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "preflight" => Ok(Self::Preflight),
            "recovery" => Ok(Self::Recovery),
            "manual" => Ok(Self::Manual),
            _ => Err(format!("Unsupported snapshot type '{value}'")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeType {
    Install,
    Update,
    Reinstall,
    Remove,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub ascension_root_path: Option<String>,
    pub addons_path: Option<String>,
    pub saved_variables_path: Option<String>,
    pub backup_retention_count: i64,
    pub auto_backup_enabled: bool,
    pub default_profile_id: Option<String>,
    pub dev_mode_enabled: bool,
    pub maintainer_mode_enabled: bool,
    pub onboarding_completed: bool,
    pub selected_pack_id: Option<String>,
    pub game_executable_path: Option<String>,
    pub update_channel: UpdateChannel,
    pub last_update_check_at: Option<DateTime<Utc>>,
    pub last_update_error: Option<String>,
    pub update_manifest_override: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ascension_root_path: None,
            addons_path: None,
            saved_variables_path: None,
            backup_retention_count: 20,
            auto_backup_enabled: true,
            default_profile_id: None,
            dev_mode_enabled: false,
            maintainer_mode_enabled: false,
            onboarding_completed: false,
            selected_pack_id: None,
            game_executable_path: None,
            update_channel: UpdateChannel::Stable,
            last_update_check_at: None,
            last_update_error: None,
            update_manifest_override: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub id: String,
    pub source_kind: SourceKind,
    pub location: String,
    pub channel_hint: Option<Channel>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionSummary {
    pub id: String,
    pub channel: Channel,
    pub version: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonRecord {
    pub id: String,
    pub display_name: String,
    pub install_folder: String,
    pub default_channel: Channel,
    pub notes: Option<String>,
    pub dependencies: Vec<String>,
    pub conflicts: Vec<String>,
    pub saved_variables: Vec<String>,
    pub is_core: bool,
    pub current_version: Option<String>,
    pub current_channel: Option<Channel>,
    pub enabled_in_active_profile: bool,
    pub health: String,
    pub latest_revisions: Vec<RevisionSummary>,
    pub sources: Vec<SourceSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSelection {
    pub addon_id: String,
    pub enabled: bool,
    pub channel_override: Option<Channel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRecord {
    pub id: String,
    pub name: String,
    pub notes: Option<String>,
    pub is_active: bool,
    pub last_used_at: Option<DateTime<Utc>>,
    pub selections: Vec<ProfileSelection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub snapshot_type: SnapshotType,
    pub related_profile_id: Option<String>,
    pub notes: Option<String>,
    pub pinned: bool,
    pub size_bytes: u64,
    pub addon_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationLogEntry {
    pub id: String,
    pub operation: String,
    pub status: String,
    pub message: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOperationSummary {
    pub id: String,
    pub operation: String,
    pub started_at: DateTime<Utc>,
    pub snapshot_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveFolderState {
    pub name: String,
    pub managed: bool,
    pub addon_id: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub code: String,
    pub severity: Severity,
    pub message: String,
    pub addon_id: Option<String>,
    pub folder_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePreviewItem {
    pub addon_id: String,
    pub display_name: String,
    pub target_folder: String,
    pub change_type: ChangeType,
    pub source_version: Option<String>,
    pub channel: Option<Channel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedVariableChange {
    pub file_name: String,
    pub change_type: ChangeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePreview {
    pub profile_id: String,
    pub items: Vec<ChangePreviewItem>,
    pub saved_variables: Vec<SavedVariableChange>,
    pub blockers: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResponse {
    pub ok: bool,
    pub applied: bool,
    pub operation_id: Option<String>,
    pub snapshot_id: Option<String>,
    pub message: String,
    pub preview: ChangePreview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectPathCandidate {
    pub label: String,
    pub confidence: String,
    pub ascension_root_path: String,
    pub addons_path: String,
    pub saved_variables_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectPathsResponse {
    pub candidates: Vec<DetectPathCandidate>,
    pub settings: Settings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStateResponse {
    pub settings: Settings,
    pub addons: Vec<AddonRecord>,
    pub profiles: Vec<ProfileRecord>,
    pub snapshots: Vec<SnapshotSummary>,
    pub logs: Vec<OperationLogEntry>,
    pub unmanaged: Vec<LiveFolderState>,
    pub issues: Vec<ValidationIssue>,
    pub active_profile_id: Option<String>,
    pub interrupted_operation: Option<PendingOperationSummary>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LauncherSetupStatus {
    SetupRequired,
    ReadyToInstall,
    Ready,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PackStatus {
    ReadyToInstall,
    Syncing,
    UpToDate,
    UpdateAvailable,
    RecoveryNeeded,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LauncherActionState {
    Idle,
    Running,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherPackMember {
    pub addon_id: String,
    pub display_name: String,
    pub install_folder: String,
    pub required: bool,
    pub installed: bool,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CuratedPackSummary {
    pub pack_id: String,
    pub name: String,
    pub description: String,
    pub default_channel: Channel,
    pub recovery_label: Option<String>,
    pub recovery_description: Option<String>,
    pub installed_count: usize,
    pub total_count: usize,
    pub members: Vec<LauncherPackMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherPathHealth {
    pub configured: bool,
    pub ascension_root_path: Option<String>,
    pub addons_path: Option<String>,
    pub saved_variables_path: Option<String>,
    pub game_executable_path: Option<String>,
    pub detected_candidates: Vec<DetectPathCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherStateResponse {
    pub settings: Settings,
    pub setup_status: LauncherSetupStatus,
    pub pack_status: PackStatus,
    pub action_state: LauncherActionState,
    pub pack: Option<CuratedPackSummary>,
    pub path_health: LauncherPathHealth,
    pub updates_available: usize,
    pub last_successful_sync_at: Option<DateTime<Utc>>,
    pub last_known_good_snapshot: Option<SnapshotSummary>,
    pub recovery_snapshots: Vec<SnapshotSummary>,
    pub unmanaged_collisions: Vec<LiveFolderState>,
    pub interrupted_operation: Option<PendingOperationSummary>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsRequest {
    pub ascension_root_path: Option<String>,
    pub addons_path: Option<String>,
    pub saved_variables_path: Option<String>,
    pub backup_retention_count: Option<i64>,
    pub auto_backup_enabled: Option<bool>,
    pub default_profile_id: Option<String>,
    pub dev_mode_enabled: Option<bool>,
    pub maintainer_mode_enabled: Option<bool>,
    pub onboarding_completed: Option<bool>,
    pub selected_pack_id: Option<String>,
    pub game_executable_path: Option<String>,
    pub update_channel: Option<UpdateChannel>,
    pub update_manifest_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInitialSetupRequest {
    pub ascension_root_path: Option<String>,
    pub addons_path: Option<String>,
    pub saved_variables_path: Option<String>,
    pub game_executable_path: Option<String>,
    pub selected_pack_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreLastKnownGoodRequest {
    pub preview_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMaintainerModeRequest {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterSourceRequest {
    pub source_kind: SourceKind,
    pub path: String,
    pub channel: Option<Channel>,
    pub core: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshSourceRequest {
    pub source_id: String,
    pub channel: Option<Channel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportZipRequest {
    pub path: String,
    pub channel: Option<Channel>,
    pub core: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSelectionInput {
    pub addon_id: String,
    pub enabled: bool,
    pub channel_override: Option<Channel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProfileRequest {
    pub profile_id: Option<String>,
    pub name: String,
    pub notes: Option<String>,
    #[serde(default)]
    pub selections: Vec<ProfileSelectionInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateProfileRequest {
    pub profile_id: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchProfileRequest {
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProfileRequest {
    pub profile_id: String,
    pub preview_only: Option<bool>,
    pub safe_mode: Option<bool>,
    pub isolate_addon_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallAddonRequest {
    pub addon_id: String,
    pub profile_id: Option<String>,
    pub preview_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeChannelRequest {
    pub addon_id: String,
    pub profile_id: Option<String>,
    pub channel: Channel,
    pub preview_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSnapshotRequest {
    pub snapshot_id: String,
    pub preview_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageRevisionRequest {
    pub revision_id: Option<String>,
    pub addon_id: Option<String>,
    pub channel: Option<Channel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteRevisionRequest {
    pub revision_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRemoteAddonUpdateRequest {
    pub addon_id: String,
    pub profile_id: Option<String>,
    pub preview_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallManagerUpdateRequest {
    pub product_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProductUpdate {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub product_type: RemoteProductType,
    pub channel: UpdateChannel,
    pub current_version: Option<String>,
    pub latest_version: String,
    pub available: bool,
    pub status: String,
    pub published_at: String,
    pub release_url: String,
    pub package_url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub install_kind: Option<String>,
    pub changelog: Option<String>,
    pub min_manager_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerUpdateStatus {
    pub id: String,
    pub current_version: String,
    pub latest_version: String,
    pub available: bool,
    pub status: String,
    pub release_url: String,
    pub package_url: String,
    pub changelog: Option<String>,
    pub published_at: String,
    pub downloaded_installer_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResponse {
    pub channel: UpdateChannel,
    pub checked_at: Option<DateTime<Utc>>,
    pub manifest_generated_at: Option<String>,
    pub manifest_url: Option<String>,
    pub stale: bool,
    pub error_message: Option<String>,
    pub manager: Option<ManagerUpdateStatus>,
    pub addons: Vec<RemoteProductUpdate>,
}

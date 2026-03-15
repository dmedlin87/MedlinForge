use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use thiserror::Error;
use url::Url;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::{
    manifest::{load_local_metadata, normalize_addon_root, read_manifest_file},
    models::{
        AddonRecord, ApplyRemoteAddonUpdateRequest, ChangeChannelRequest, ChangePreview,
        ChangePreviewItem, ChangeType, Channel, CreateProfileRequest, CuratedPackSummary,
        DetectPathCandidate, DetectPathsResponse, DuplicateProfileRequest, ImportZipRequest,
        InstallAddonRequest, InstallManagerUpdateRequest, LauncherActionState, LauncherPackMember,
        LauncherPathHealth, LauncherSetupStatus, LauncherStateResponse, LiveFolderState,
        ManagerUpdateStatus, OperationLogEntry, OperationResponse, PackStatus,
        PackageRevisionRequest, PendingOperationSummary, ProfileRecord, ProfileSelection,
        ProfileSelectionInput, PromoteRevisionRequest, RefreshSourceRequest, RegisterSourceRequest,
        RemoteProductType, RemoteProductUpdate, RestoreLastKnownGoodRequest,
        RestoreSnapshotRequest, RevisionSummary, RunInitialSetupRequest, SaveSettingsRequest,
        ScanStateResponse, SetMaintainerModeRequest, Settings, Severity, SnapshotSummary,
        SnapshotType, SourceKind, SourceSummary, SwitchProfileRequest, SyncProfileRequest,
        UpdateChannel, UpdateCheckResponse, ValidationIssue,
    },
    update_provider::{RemoteManifestPack, RemoteManifestProduct, UpdateCatalog, UpdateProvider},
};

pub type ServiceResult<T> = Result<T, ServiceError>;

#[derive(Debug, Error)]
pub enum ServiceError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Walkdir(#[from] walkdir::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

#[derive(Debug, Clone)]
struct Directories {
    cache: PathBuf,
    staging: PathBuf,
    snapshots: PathBuf,
    exports: PathBuf,
    db: PathBuf,
}

#[derive(Debug, Clone)]
struct AddonRow {
    id: String,
    display_name: String,
    install_folder: String,
    default_channel: Channel,
    notes: Option<String>,
    dependencies: Vec<String>,
    conflicts: Vec<String>,
    saved_variables: Vec<String>,
    is_core: bool,
}

#[derive(Debug, Clone)]
struct SourceRow {
    id: String,
    addon_id: String,
    source_kind: SourceKind,
    location: String,
    channel_hint: Option<Channel>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct RevisionRow {
    id: String,
    addon_id: String,
    source_id: Option<String>,
    channel: Channel,
    version: String,
    cache_path: String,
    checksum: String,
    metadata_json: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct RemoteProductCacheRow {
    product_id: String,
    channel: UpdateChannel,
    payload_json: String,
}

#[derive(Debug, Clone)]
struct RemotePackCacheRow {
    pack_id: String,
    payload_json: String,
}

#[derive(Debug, Clone)]
struct ProfileRow {
    id: String,
    name: String,
    notes: Option<String>,
    last_used_at: Option<DateTime<Utc>>,
    is_active: bool,
}

#[derive(Debug, Clone)]
struct SnapshotItemRow {
    addon_id: Option<String>,
    relative_path: String,
    item_type: String,
}

#[derive(Debug, Clone)]
struct InstallPlan {
    addon: AddonRow,
    channel: Channel,
    version: Option<String>,
    source_path: PathBuf,
    target_path: PathBuf,
    change_type: ChangeType,
}

#[derive(Debug, Clone)]
struct RemovalPlan {
    addon: AddonRow,
    target_path: PathBuf,
}

#[derive(Debug, Clone)]
struct ProfilePreview {
    profile_id: String,
    installs: Vec<InstallPlan>,
    removals: Vec<RemovalPlan>,
    blockers: Vec<ValidationIssue>,
    warnings: Vec<ValidationIssue>,
    saved_variables: Vec<String>,
}

pub struct ManagerService {
    connection: Connection,
    directories: Directories,
    app_handle: Option<AppHandle>,
    update_provider: UpdateProvider,
}

impl ManagerService {
    pub fn new(app_handle: &AppHandle) -> ServiceResult<Self> {
        let base = app_handle.path().app_data_dir().map_err(|_| {
            ServiceError::Message("Could not resolve app data directory".to_string())
        })?;
        Self::from_base_dir(base, Some(app_handle.clone()))
    }

    #[cfg(test)]
    pub fn for_test(base: PathBuf) -> ServiceResult<Self> {
        Self::from_base_dir(base, None)
    }

    fn from_base_dir(base: PathBuf, app_handle: Option<AppHandle>) -> ServiceResult<Self> {
        let directories = Directories {
            cache: base.join("cache"),
            staging: base.join("staging"),
            snapshots: base.join("snapshots"),
            exports: base.join("exports"),
            db: base.join("db").join("bronze_forge.sqlite"),
        };
        fs::create_dir_all(&directories.cache)?;
        fs::create_dir_all(&directories.staging)?;
        fs::create_dir_all(&directories.snapshots)?;
        fs::create_dir_all(&directories.exports)?;
        if let Some(parent) = directories.db.parent() {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(&directories.db)?;
        let mut service = Self {
            connection,
            directories,
            app_handle,
            update_provider: UpdateProvider::new()?,
        };
        service.run_migrations()?;
        service.ensure_defaults()?;
        Ok(service)
    }

    pub fn detect_paths(&mut self) -> ServiceResult<DetectPathsResponse> {
        let settings = self.load_settings()?;
        let mut roots = vec![
            PathBuf::from(r"C:\Ascension"),
            PathBuf::from(r"C:\Games"),
            PathBuf::from(r"D:\Games"),
            PathBuf::from(r"C:\Program Files"),
            PathBuf::from(r"C:\Program Files (x86)"),
        ];
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            roots.push(PathBuf::from(&local_app_data));
            roots.push(PathBuf::from(&local_app_data).join("Programs"));
        }
        if let Ok(app_data) = std::env::var("APPDATA") {
            roots.push(PathBuf::from(app_data));
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let user = PathBuf::from(&user_profile);
            roots.push(user.join("Games"));
            roots.push(user.join("Desktop"));
            roots.push(user.join("Downloads"));
        }
        if let Ok(program_data) = std::env::var("PROGRAMDATA") {
            roots.push(PathBuf::from(program_data));
        }
        // Check all fixed drive letters for common game folders
        for letter in b'D'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            let drive_path = PathBuf::from(&drive);
            if drive_path.exists() {
                roots.push(drive_path.join("Games"));
                roots.push(drive_path.join("Ascension"));
            }
        }

        let candidates = detect_path_candidates(&roots)?;

        Ok(DetectPathsResponse {
            candidates,
            settings,
        })
    }

    pub fn get_launcher_state(&mut self) -> ServiceResult<LauncherStateResponse> {
        let settings = self.load_settings()?;
        let detected_paths = self.detect_paths()?.candidates;
        let live_unmanaged = if let Some(addons_path) = settings.addons_path.as_ref() {
            self.list_unmanaged_in_path(Path::new(addons_path))?
        } else {
            Vec::new()
        };
        let interrupted_operation = self.load_unfinished_operation()?;

        let (catalog, error_message) = match self.fetch_or_load_cached_catalog(&settings) {
            Ok((catalog, _, _, error_message)) => (Some(catalog), error_message),
            Err(error) => (None, Some(error.to_string())),
        };

        let pack = if let Some(catalog) = catalog.as_ref() {
            self.resolve_selected_pack(&settings, catalog)?
        } else {
            self.load_cached_selected_pack(&settings)?
        };
        let pack_summary = if let (Some(catalog), Some(pack)) = (catalog.as_ref(), pack.as_ref()) {
            Some(self.build_pack_summary(&settings, pack, &catalog.products)?)
        } else {
            None
        };

        let last_known_good_snapshot = if let Some(pack) = pack.as_ref() {
            self.latest_recovery_snapshot_for_profile(&pack_profile_id(&pack.pack_id))?
        } else {
            self.latest_recovery_snapshot()?
        };
        let last_successful_sync_at = last_known_good_snapshot
            .as_ref()
            .map(|snapshot| snapshot.created_at);
        let recovery_snapshots = self
            .load_snapshots()?
            .into_iter()
            .take(8)
            .collect::<Vec<_>>();

        let setup_configured = settings.ascension_root_path.is_some()
            && settings.addons_path.is_some()
            && settings.saved_variables_path.is_some();
        let setup_status = if !setup_configured {
            LauncherSetupStatus::SetupRequired
        } else if pack_summary
            .as_ref()
            .map(|summary| summary.installed_count == 0)
            .unwrap_or(true)
        {
            LauncherSetupStatus::ReadyToInstall
        } else {
            LauncherSetupStatus::Ready
        };

        let pack_status = if interrupted_operation.is_some() {
            PackStatus::RecoveryNeeded
        } else if !setup_configured {
            PackStatus::ReadyToInstall
        } else if error_message.is_some() && pack_summary.is_none() {
            PackStatus::Error
        } else if let Some(summary) = pack_summary.as_ref() {
            let updates_available = summary
                .members
                .iter()
                .filter(|member| member.update_available)
                .count();
            let pack_profile_id = pack_profile_id(&summary.pack_id);
            let preview = if self.load_profile(&pack_profile_id).is_ok() {
                self.preview_profile_sync(&pack_profile_id, false, None)
                    .ok()
            } else {
                None
            };
            if let Some(preview) = preview {
                if !preview.blockers.is_empty() {
                    PackStatus::Error
                } else if (!preview.installs.is_empty() || !preview.removals.is_empty())
                    && updates_available > 0
                {
                    PackStatus::UpdateAvailable
                } else if !preview.installs.is_empty() || !preview.removals.is_empty() {
                    PackStatus::ReadyToInstall
                } else if updates_available > 0 {
                    PackStatus::UpdateAvailable
                } else {
                    PackStatus::UpToDate
                }
            } else if summary.installed_count == 0 {
                PackStatus::ReadyToInstall
            } else if updates_available > 0 {
                PackStatus::UpdateAvailable
            } else {
                PackStatus::ReadyToInstall
            }
        } else {
            PackStatus::Error
        };

        let game_executable_path = self
            .resolve_game_executable_path(&settings)
            .map(|path| path.to_string_lossy().to_string());
        let path_health = LauncherPathHealth {
            configured: setup_configured,
            ascension_root_path: settings.ascension_root_path.clone(),
            addons_path: settings.addons_path.clone(),
            saved_variables_path: settings.saved_variables_path.clone(),
            game_executable_path,
            detected_candidates: detected_paths,
        };
        let unmanaged_collisions = if let Some(summary) = pack_summary.as_ref() {
            let known_folders = summary
                .members
                .iter()
                .map(|member| member.install_folder.clone())
                .collect::<HashSet<_>>();
            let matching = live_unmanaged
                .iter()
                .filter(|folder| known_folders.contains(&folder.name))
                .cloned()
                .collect::<Vec<_>>();
            if matching.is_empty() {
                live_unmanaged
            } else {
                matching
            }
        } else {
            live_unmanaged
        };
        let updates_available = pack_summary
            .as_ref()
            .map(|summary| {
                summary
                    .members
                    .iter()
                    .filter(|member| member.update_available)
                    .count()
            })
            .unwrap_or(0);

        Ok(LauncherStateResponse {
            settings,
            setup_status,
            pack_status,
            action_state: if !setup_configured {
                LauncherActionState::Blocked
            } else {
                LauncherActionState::Idle
            },
            pack: pack_summary,
            path_health,
            updates_available,
            last_successful_sync_at,
            last_known_good_snapshot,
            recovery_snapshots,
            unmanaged_collisions,
            interrupted_operation,
            error_message,
        })
    }

    pub fn run_initial_setup(
        &mut self,
        request: RunInitialSetupRequest,
    ) -> ServiceResult<LauncherStateResponse> {
        let settings = self.load_settings()?;
        let detected = self.detect_paths()?.candidates;
        let resolved_root = request
            .ascension_root_path
            .or_else(|| settings.ascension_root_path.clone())
            .or_else(|| {
                if detected.len() == 1 {
                    Some(detected[0].ascension_root_path.clone())
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                ServiceError::Message(format!(
                    "Could not resolve Ascension install path. {} candidate(s) detected. \
                     Please select or provide an install path.",
                    detected.len(),
                ))
            })?;
        let resolved_addons = request
            .addons_path
            .or_else(|| settings.addons_path.clone())
            .or_else(|| {
                detected
                    .iter()
                    .find(|candidate| candidate.ascension_root_path == resolved_root)
                    .map(|candidate| candidate.addons_path.clone())
            })
            .unwrap_or_else(|| {
                r"C:\Program Files\Ascension Launcher\resources\client\Interface\AddOns"
                    .to_string()
            });
        let resolved_saved_variables = request
            .saved_variables_path
            .or_else(|| settings.saved_variables_path.clone())
            .or_else(|| {
                detected
                    .iter()
                    .find(|candidate| candidate.ascension_root_path == resolved_root)
                    .map(|candidate| candidate.saved_variables_path.clone())
            })
            .unwrap_or_else(|| {
                Path::new(&resolved_root)
                    .join("WTF")
                    .join("Account")
                    .join("SavedVariables")
                    .to_string_lossy()
                    .to_string()
            });
        let resolved_game_executable = request
            .game_executable_path
            .map(PathBuf::from)
            .or_else(|| detect_game_executable(Path::new(&resolved_root)))
            .map(|path| path.to_string_lossy().to_string());
        let selected_pack_id = request
            .selected_pack_id
            .or_else(|| settings.selected_pack_id.clone());
        let _ = self.save_settings(SaveSettingsRequest {
            ascension_root_path: Some(resolved_root),
            addons_path: Some(resolved_addons),
            saved_variables_path: Some(resolved_saved_variables),
            backup_retention_count: None,
            auto_backup_enabled: None,
            default_profile_id: None,
            dev_mode_enabled: Some(false),
            maintainer_mode_enabled: None,
            onboarding_completed: Some(true),
            selected_pack_id,
            game_executable_path: resolved_game_executable,
            update_channel: None,
            update_manifest_override: None,
        })?;
        self.get_launcher_state()
    }

    pub fn sync_curated_pack(&mut self) -> ServiceResult<LauncherStateResponse> {
        let settings = self.load_settings()?;
        if settings.addons_path.is_none() || settings.saved_variables_path.is_none() {
            return Err(ServiceError::Message(
                "Complete setup before syncing the curated pack".to_string(),
            ));
        }
        let (catalog, _, _, _) = self.fetch_or_load_cached_catalog(&settings)?;
        let pack = self
            .resolve_selected_pack(&settings, &catalog)?
            .ok_or_else(|| ServiceError::Message("No curated pack is available".to_string()))?;
        let channel = update_channel_to_channel(settings.update_channel);

        for member in &pack.members {
            let product = catalog.products.get(&member.product_id).ok_or_else(|| {
                ServiceError::Message(format!(
                    "Curated pack member '{}' is missing from the catalog",
                    member.product_id
                ))
            })?;
            if !UpdateProvider::manager_version_satisfies(product.min_manager_version.as_deref()) {
                return Err(ServiceError::Message(format!(
                    "{} requires BronzeForge Manager {} or newer",
                    product.name,
                    product.min_manager_version.clone().unwrap_or_default()
                )));
            }
            let current_version = self
                .latest_revision_for_channel(&member.product_id, channel)?
                .map(|revision| revision.version);
            let needs_download = current_version.is_none()
                || UpdateProvider::is_remote_newer(
                    &product.latest_version,
                    current_version.as_deref(),
                );
            if !needs_download {
                continue;
            }
            let download_path = self.directories.staging.join("pack-sync").join(format!(
                "{}-{}-{}.zip",
                product.id,
                settings.update_channel.as_str(),
                sanitize_version(&product.latest_version)
            ));
            self.update_provider
                .download_verified_asset(&settings, product, &download_path)?;
            let core = self
                .load_addon(&member.product_id)
                .map(|addon| addon.is_core)
                .unwrap_or(member.required);
            self.import_zip(ImportZipRequest {
                path: download_path.to_string_lossy().to_string(),
                channel: Some(channel),
                core: Some(core || member.required),
            })?;
        }

        let profile_id = self.ensure_pack_profile(&pack)?;
        let response = self
            .sync_profile(SyncProfileRequest {
                profile_id: profile_id.clone(),
                preview_only: Some(false),
                safe_mode: Some(false),
                isolate_addon_id: None,
            })
            .map_err(|error| match &error {
                ServiceError::Io(io_error)
                    if io_error.kind() == std::io::ErrorKind::PermissionDenied =>
                {
                    let addons_path = settings
                        .addons_path
                        .clone()
                        .unwrap_or_else(|| "<not configured>".to_string());
                    ServiceError::Message(addons_permission_denied_message(
                        &addons_path,
                        "write to",
                    ))
                }
                _ => error,
            })?;
        if !response.ok || !response.applied {
            let blocker_message = response
                .preview
                .blockers
                .first()
                .map(|issue| issue.message.clone())
                .unwrap_or_else(|| response.message.clone());
            return Err(ServiceError::Message(blocker_message));
        }
        self.switch_profile(SwitchProfileRequest { profile_id })?;
        self.get_launcher_state()
    }

    pub fn restore_last_known_good(
        &mut self,
        request: RestoreLastKnownGoodRequest,
    ) -> ServiceResult<OperationResponse> {
        let settings = self.load_settings()?;
        let snapshot = if let Some(pack_id) = settings.selected_pack_id.clone() {
            self.latest_recovery_snapshot_for_profile(&pack_profile_id(&pack_id))?
        } else {
            self.latest_recovery_snapshot()?
        }
        .ok_or_else(|| ServiceError::Message("No recovery snapshot is available".to_string()))?;
        self.restore_snapshot(RestoreSnapshotRequest {
            snapshot_id: snapshot.id,
            preview_only: request.preview_only,
        })
    }

    pub fn set_maintainer_mode(
        &mut self,
        request: SetMaintainerModeRequest,
    ) -> ServiceResult<LauncherStateResponse> {
        let _ = self.save_settings(SaveSettingsRequest {
            ascension_root_path: None,
            addons_path: None,
            saved_variables_path: None,
            backup_retention_count: None,
            auto_backup_enabled: None,
            default_profile_id: None,
            dev_mode_enabled: Some(request.enabled),
            maintainer_mode_enabled: Some(request.enabled),
            onboarding_completed: None,
            selected_pack_id: None,
            game_executable_path: None,
            update_channel: None,
            update_manifest_override: None,
        })?;
        self.get_launcher_state()
    }

    pub fn launch_game(&mut self) -> ServiceResult<String> {
        let settings = self.load_settings()?;
        let executable = self
            .resolve_game_executable_path(&settings)
            .ok_or_else(|| {
                ServiceError::Message("Could not resolve a game executable".to_string())
            })?;
        let mut command = Command::new(&executable);
        if let Some(root) = settings.ascension_root_path.as_ref() {
            command.current_dir(root);
        }
        command
            .spawn()
            .map_err(|error| ServiceError::Message(format!("Failed to launch game: {error}")))?;
        Ok(executable.to_string_lossy().to_string())
    }

    pub fn open_addons_folder(&mut self) -> ServiceResult<String> {
        let settings = self.load_settings()?;
        let addons_path = settings.addons_path.ok_or_else(|| {
            ServiceError::Message("Configure the AddOns path before opening it".to_string())
        })?;
        Command::new("explorer")
            .arg(&addons_path)
            .spawn()
            .map_err(|error| {
                ServiceError::Message(format!("Failed to open AddOns folder: {error}"))
            })?;
        Ok(addons_path)
    }

    pub fn save_settings(
        &mut self,
        request: SaveSettingsRequest,
    ) -> ServiceResult<ScanStateResponse> {
        let current = self.load_settings()?;
        let dev_mode_enabled = request.dev_mode_enabled.unwrap_or(current.dev_mode_enabled);
        let maintainer_mode_enabled = request
            .maintainer_mode_enabled
            .unwrap_or(current.maintainer_mode_enabled);
        let root = request
            .ascension_root_path
            .or(current.ascension_root_path)
            .map(normalize_display_path);
        let addons = request
            .addons_path
            .or(current.addons_path)
            .map(normalize_display_path)
            .or_else(|| {
                root.as_ref().map(|value| {
                    PathBuf::from(value)
                        .join("Interface")
                        .join("AddOns")
                        .to_string_lossy()
                        .to_string()
                })
            });
        let saved_variables = request
            .saved_variables_path
            .or(current.saved_variables_path)
            .map(normalize_display_path)
            .or_else(|| {
                root.as_ref().map(|value| {
                    PathBuf::from(value)
                        .join("WTF")
                        .join("Account")
                        .join("SavedVariables")
                        .to_string_lossy()
                        .to_string()
                })
            });
        if let Some(addons_path) = addons.as_ref() {
            ensure_addons_path_writable(addons_path)?;
        }
        // SavedVariables folder is created by the game on first run;
        // best-effort creation here — do not block setup on failure.
        if let Some(saved_path) = saved_variables.as_ref() {
            let _ = fs::create_dir_all(saved_path);
        }
        let requested_manifest_override = request
            .update_manifest_override
            .as_ref()
            .map(|value| value.trim().to_string());
        let update_manifest_override = if dev_mode_enabled {
            match requested_manifest_override {
                Some(value) if value.is_empty() => None,
                Some(value) => Some(value),
                None => current.update_manifest_override,
            }
        } else {
            None
        };
        self.connection.execute(
            "INSERT INTO settings (id, ascension_root_path, addons_path, saved_variables_path, backup_retention_count, auto_backup_enabled, default_profile_id, dev_mode_enabled, maintainer_mode_enabled, onboarding_completed, selected_pack_id, game_executable_path, update_channel, update_manifest_override, last_update_check_at, last_update_error, updated_at)
             VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(id) DO UPDATE SET
               ascension_root_path = excluded.ascension_root_path,
               addons_path = excluded.addons_path,
               saved_variables_path = excluded.saved_variables_path,
               backup_retention_count = excluded.backup_retention_count,
               auto_backup_enabled = excluded.auto_backup_enabled,
               default_profile_id = excluded.default_profile_id,
               dev_mode_enabled = excluded.dev_mode_enabled,
               maintainer_mode_enabled = excluded.maintainer_mode_enabled,
               onboarding_completed = excluded.onboarding_completed,
               selected_pack_id = excluded.selected_pack_id,
               game_executable_path = excluded.game_executable_path,
               update_channel = excluded.update_channel,
               update_manifest_override = excluded.update_manifest_override,
               last_update_check_at = excluded.last_update_check_at,
               last_update_error = excluded.last_update_error,
               updated_at = excluded.updated_at",
            params![
                root,
                addons,
                saved_variables,
                request.backup_retention_count.unwrap_or(current.backup_retention_count),
                request.auto_backup_enabled.unwrap_or(current.auto_backup_enabled) as i64,
                request.default_profile_id.or(current.default_profile_id),
                dev_mode_enabled as i64,
                maintainer_mode_enabled as i64,
                request
                    .onboarding_completed
                    .unwrap_or(current.onboarding_completed) as i64,
                request.selected_pack_id.or(current.selected_pack_id),
                request
                    .game_executable_path
                    .or(current.game_executable_path)
                    .map(normalize_display_path),
                request
                    .update_channel
                    .unwrap_or(current.update_channel)
                    .to_string(),
                update_manifest_override,
                current.last_update_check_at.map(|value| value.to_rfc3339()),
                current.last_update_error,
                now_string()
            ],
        )?;
        self.scan_live_state()
    }

    pub fn register_source(
        &mut self,
        request: RegisterSourceRequest,
    ) -> ServiceResult<ScanStateResponse> {
        match request.source_kind {
            SourceKind::LocalFolder => {
                self.import_folder_source(
                    Path::new(&request.path),
                    request.channel.unwrap_or(Channel::Stable),
                    request.core.unwrap_or(false),
                    SourceKind::LocalFolder,
                    &request.path,
                    None,
                )?;
            }
            SourceKind::Manifest => {
                self.import_manifest_source(
                    Path::new(&request.path),
                    request.core.unwrap_or(false),
                )?;
            }
            SourceKind::ZipFile => {
                self.import_zip(ImportZipRequest {
                    path: request.path,
                    channel: request.channel,
                    core: request.core,
                })?;
                return self.scan_live_state();
            }
        }
        self.scan_live_state()
    }

    pub fn refresh_source(
        &mut self,
        request: RefreshSourceRequest,
    ) -> ServiceResult<ScanStateResponse> {
        let source = self.load_source(&request.source_id)?;
        let addon = self.load_addon(&source.addon_id)?;
        match source.source_kind {
            SourceKind::LocalFolder => {
                self.import_folder_source(
                    Path::new(&source.location),
                    request
                        .channel
                        .or(source.channel_hint)
                        .unwrap_or(Channel::Stable),
                    addon.is_core,
                    SourceKind::LocalFolder,
                    &source.location,
                    Some(source.id),
                )?;
            }
            SourceKind::Manifest => {
                self.import_manifest_source(Path::new(&source.location), addon.is_core)?
            }
            SourceKind::ZipFile => {
                self.import_zip(ImportZipRequest {
                    path: source.location,
                    channel: request.channel.or(source.channel_hint),
                    core: Some(addon.is_core),
                })?;
            }
        }
        self.scan_live_state()
    }

    pub fn import_zip(&mut self, request: ImportZipRequest) -> ServiceResult<ScanStateResponse> {
        let archive_path = Path::new(&request.path);
        if !archive_path.exists() {
            return Err(ServiceError::Message(format!(
                "Zip package not found: {}",
                archive_path.display()
            )));
        }
        let extraction_dir = self
            .directories
            .staging
            .join(format!("zip-{}", Uuid::new_v4()));
        fs::create_dir_all(&extraction_dir)?;
        let file = fs::File::open(archive_path)?;
        let mut archive = ZipArchive::new(file)?;
        archive.extract(&extraction_dir)?;
        let root = normalize_addon_root(&extraction_dir)?;
        self.import_folder_source(
            &root,
            request.channel.unwrap_or(Channel::Stable),
            request.core.unwrap_or(false),
            SourceKind::ZipFile,
            &request.path,
            None,
        )?;
        self.scan_live_state()
    }

    pub fn create_or_update_profile(
        &mut self,
        request: CreateProfileRequest,
    ) -> ServiceResult<ScanStateResponse> {
        let profile_id = request
            .profile_id
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = now_string();
        self.connection.execute(
            "INSERT INTO profiles (id, name, notes, last_used_at, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, COALESCE((SELECT last_used_at FROM profiles WHERE id = ?1), NULL), COALESCE((SELECT is_active FROM profiles WHERE id = ?1), 0), COALESCE((SELECT created_at FROM profiles WHERE id = ?1), ?4), ?4)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, notes = excluded.notes, updated_at = excluded.updated_at",
            params![profile_id, request.name.trim(), request.notes, now],
        )?;
        self.connection.execute(
            "DELETE FROM profile_addons WHERE profile_id = ?1",
            params![profile_id],
        )?;
        let known = self.load_addons()?;
        let provided = request
            .selections
            .into_iter()
            .map(|selection| (selection.addon_id.clone(), selection))
            .collect::<HashMap<_, _>>();
        for addon in known {
            let selection = provided
                .get(&addon.id)
                .cloned()
                .unwrap_or(ProfileSelectionInput {
                    addon_id: addon.id.clone(),
                    enabled: false,
                    channel_override: None,
                });
            self.connection.execute(
                "INSERT INTO profile_addons (profile_id, addon_id, enabled, channel_override) VALUES (?1, ?2, ?3, ?4)",
                params![profile_id, addon.id, selection.enabled as i64, selection.channel_override.map(|value| value.to_string())],
            )?;
        }
        self.scan_live_state()
    }

    pub fn duplicate_profile(
        &mut self,
        request: DuplicateProfileRequest,
    ) -> ServiceResult<ScanStateResponse> {
        let original = self.load_profile(&request.profile_id)?;
        let selections = self.load_profile_selections(&original.id)?;
        self.create_or_update_profile(CreateProfileRequest {
            profile_id: None,
            name: request
                .name
                .unwrap_or_else(|| format!("{} Copy", original.name)),
            notes: original.notes,
            selections: selections
                .into_iter()
                .map(|selection| ProfileSelectionInput {
                    addon_id: selection.addon_id,
                    enabled: selection.enabled,
                    channel_override: selection.channel_override,
                })
                .collect(),
        })
    }

    pub fn switch_profile(
        &mut self,
        request: SwitchProfileRequest,
    ) -> ServiceResult<ScanStateResponse> {
        self.connection
            .execute("UPDATE profiles SET is_active = 0", params![])?;
        self.connection.execute(
            "UPDATE profiles SET is_active = 1, last_used_at = ?2 WHERE id = ?1",
            params![request.profile_id, now_string()],
        )?;
        self.connection.execute(
            "UPDATE settings SET default_profile_id = ?1, updated_at = ?2 WHERE id = 1",
            params![request.profile_id, now_string()],
        )?;
        self.scan_live_state()
    }

    pub fn sync_profile(
        &mut self,
        request: SyncProfileRequest,
    ) -> ServiceResult<OperationResponse> {
        let preview = self.preview_profile_sync(
            &request.profile_id,
            request.safe_mode.unwrap_or(false),
            request.isolate_addon_id.clone(),
        )?;
        self.execute_preview_operation(
            preview,
            request.preview_only.unwrap_or(false),
            "syncProfile",
            json!({
                "profileId": request.profile_id,
                "safeMode": request.safe_mode.unwrap_or(false),
                "isolateAddonId": request.isolate_addon_id
            }),
            format!("Preflight backup for {}", request.profile_id),
            format!("Last known good for {}", request.profile_id),
            "Profile sync completed successfully",
            "Profile sync completed",
            None,
        )
    }

    pub fn install_addon(
        &mut self,
        request: InstallAddonRequest,
    ) -> ServiceResult<OperationResponse> {
        self.preview_profile_action(
            request.profile_id,
            &request.addon_id,
            true,
            None,
            request.preview_only.unwrap_or(false),
            "installAddon",
            "Addon installed successfully",
            "Addon installed",
        )
    }

    pub fn update_addon(
        &mut self,
        request: InstallAddonRequest,
    ) -> ServiceResult<OperationResponse> {
        self.install_addon(request)
    }

    pub fn change_channel(
        &mut self,
        request: ChangeChannelRequest,
    ) -> ServiceResult<OperationResponse> {
        self.preview_profile_action(
            request.profile_id,
            &request.addon_id,
            true,
            Some(request.channel),
            request.preview_only.unwrap_or(false),
            "changeChannel",
            &format!("Addon channel changed to {}", request.channel),
            "Addon channel updated",
        )
    }

    pub fn uninstall_addon(
        &mut self,
        request: InstallAddonRequest,
    ) -> ServiceResult<OperationResponse> {
        self.preview_profile_action(
            request.profile_id,
            &request.addon_id,
            false,
            None,
            request.preview_only.unwrap_or(false),
            "uninstallAddon",
            "Addon removed successfully",
            "Addon removed",
        )
    }

    fn preview_profile_action(
        &mut self,
        profile_id: Option<String>,
        addon_id: &str,
        enabled: bool,
        channel_override: Option<Channel>,
        preview_only: bool,
        operation: &str,
        success_log: &str,
        success_message: &str,
    ) -> ServiceResult<OperationResponse> {
        let profile_id = profile_id
            .or_else(|| self.active_profile_id().ok().flatten())
            .ok_or_else(|| ServiceError::Message("No active profile available".to_string()))?;
        let selections = self.load_profile_selections(&profile_id)?;
        let next_selections =
            apply_selection_override(selections, addon_id, enabled, channel_override);
        let preview = self.preview_profile_sync_with_selections(
            &profile_id,
            next_selections.clone(),
            false,
            None,
        )?;
        self.execute_preview_operation(
            preview,
            preview_only,
            operation,
            json!({
                "profileId": profile_id,
                "addonId": addon_id,
                "enabled": enabled,
                "channelOverride": channel_override.map(|value| value.to_string())
            }),
            format!("Preflight backup for {operation}"),
            format!("Last known good for {operation}"),
            success_log,
            success_message,
            Some((profile_id, next_selections)),
        )
    }

    fn execute_preview_operation(
        &mut self,
        preview: ProfilePreview,
        preview_only: bool,
        operation: &str,
        payload: serde_json::Value,
        preflight_note: String,
        recovery_note: String,
        success_log: &str,
        success_message: &str,
        persist_profile: Option<(String, Vec<ProfileSelection>)>,
    ) -> ServiceResult<OperationResponse> {
        let body = to_change_preview(&preview);
        if preview_only || !preview.blockers.is_empty() {
            return Ok(OperationResponse {
                ok: preview.blockers.is_empty(),
                applied: false,
                operation_id: None,
                snapshot_id: None,
                message: if preview.blockers.is_empty() {
                    "Preview generated".to_string()
                } else {
                    "Preview contains blockers".to_string()
                },
                preview: body,
            });
        }

        let addons_path = self
            .load_settings()?
            .addons_path
            .ok_or_else(|| ServiceError::Message("AddOns path is required".to_string()))?;
        ensure_addons_path_writable(&addons_path)?;

        let snapshot_id = self.create_snapshot_for_preview(
            SnapshotType::Preflight,
            &preview,
            Some(preflight_note),
        )?;
        let operation_id = Uuid::new_v4().to_string();
        self.record_unfinished_operation(
            &operation_id,
            operation,
            &payload,
            Some(snapshot_id.clone()),
        )?;

        if let Err(error) = self.apply_preview(&preview) {
            let _ = self.restore_snapshot_internal(&snapshot_id);
            self.clear_unfinished_operation(&operation_id)?;
            self.insert_log(operation, "failed", &format!("{operation} failed: {error}"))?;
            return Err(error);
        }

        if let Some((profile_id, selections)) = persist_profile {
            self.replace_profile_selections(&profile_id, &selections)?;
        }

        self.clear_unfinished_operation(&operation_id)?;
        let recovery_snapshot_id = self.create_snapshot_for_preview(
            SnapshotType::Recovery,
            &preview,
            Some(recovery_note),
        )?;
        self.insert_log(operation, "success", success_log)?;
        self.prune_snapshots()?;

        Ok(OperationResponse {
            ok: true,
            applied: true,
            operation_id: Some(operation_id),
            snapshot_id: Some(recovery_snapshot_id),
            message: success_message.to_string(),
            preview: body,
        })
    }

    pub fn list_snapshots(&mut self) -> ServiceResult<Vec<SnapshotSummary>> {
        self.load_snapshots()
    }

    pub fn restore_snapshot(
        &mut self,
        request: RestoreSnapshotRequest,
    ) -> ServiceResult<OperationResponse> {
        let snapshot = self.load_snapshot_summary(&request.snapshot_id)?;
        let items = self.load_snapshot_items(&request.snapshot_id)?;
        let preview = ChangePreview {
            profile_id: snapshot.related_profile_id.clone().unwrap_or_default(),
            items: items
                .iter()
                .filter(|item| item.item_type == "addonFolder")
                .map(|item| ChangePreviewItem {
                    addon_id: item
                        .addon_id
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string()),
                    display_name: item.relative_path.clone(),
                    target_folder: item.relative_path.clone(),
                    change_type: ChangeType::Install,
                    source_version: None,
                    channel: None,
                })
                .collect(),
            saved_variables: items
                .iter()
                .filter(|item| item.item_type == "savedVariable")
                .map(|item| crate::models::SavedVariableChange {
                    file_name: item.relative_path.clone(),
                    change_type: ChangeType::Update,
                })
                .collect(),
            blockers: Vec::new(),
            warnings: Vec::new(),
        };
        if request.preview_only.unwrap_or(false) {
            return Ok(OperationResponse {
                ok: true,
                applied: false,
                operation_id: None,
                snapshot_id: Some(request.snapshot_id),
                message: "Restore preview generated".to_string(),
                preview,
            });
        }
        let active_profile = self
            .active_profile_id()?
            .or(snapshot.related_profile_id.clone())
            .unwrap_or_default();
        let live_preview = self.preview_profile_sync(&active_profile, false, None)?;
        let pre_restore_snapshot = self.create_snapshot_for_preview(
            SnapshotType::Preflight,
            &live_preview,
            Some("Pre-restore snapshot".to_string()),
        )?;
        let addons_path = self
            .load_settings()?
            .addons_path
            .clone()
            .unwrap_or_else(|| "<not configured>".to_string());
        self.restore_snapshot_internal(&request.snapshot_id)
            .map_err(|error| match &error {
                ServiceError::Io(io_error)
                    if io_error.kind() == std::io::ErrorKind::PermissionDenied =>
                {
                    ServiceError::Message(addons_permission_denied_message(
                        &addons_path,
                        "restore",
                    ))
                }
                _ => error,
            })?;
        self.insert_log(
            "restoreSnapshot",
            "success",
            "Snapshot restored successfully",
        )?;
        Ok(OperationResponse {
            ok: true,
            applied: true,
            operation_id: Some(Uuid::new_v4().to_string()),
            snapshot_id: Some(pre_restore_snapshot),
            message: "Snapshot restored".to_string(),
            preview,
        })
    }

    pub fn package_revision(&mut self, request: PackageRevisionRequest) -> ServiceResult<String> {
        let revision = if let Some(revision_id) = request.revision_id {
            self.load_revision(&revision_id)?
        } else {
            let addon_id = request.addon_id.ok_or_else(|| {
                ServiceError::Message("addonId or revisionId is required".to_string())
            })?;
            self.latest_revision_for_channel(&addon_id, request.channel.unwrap_or(Channel::Stable))?
                .ok_or_else(|| ServiceError::Message("No matching revision found".to_string()))?
        };
        let source_path = PathBuf::from(&revision.cache_path);
        if !source_path.exists() {
            return Err(ServiceError::Message(format!(
                "Revision path is missing: {}",
                source_path.display()
            )));
        }
        let export_path = self.directories.exports.join(format!(
            "{}-{}-{}.zip",
            revision.addon_id,
            revision.channel.as_str(),
            revision.version.replace(' ', "-")
        ));
        let file = fs::File::create(&export_path)?;
        let mut writer = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip_directory(&mut writer, &source_path, &source_path, options)?;
        writer.finish()?;
        Ok(export_path.to_string_lossy().to_string())
    }

    pub fn promote_revision(
        &mut self,
        request: PromoteRevisionRequest,
    ) -> ServiceResult<ScanStateResponse> {
        let revision = self.load_revision(&request.revision_id)?;
        self.connection.execute(
            "INSERT INTO revisions (id, addon_id, source_id, channel, version, cache_path, checksum, metadata_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                Uuid::new_v4().to_string(),
                revision.addon_id,
                revision.source_id,
                Channel::Stable.to_string(),
                revision.version,
                revision.cache_path,
                revision.checksum,
                revision.metadata_json,
                now_string()
            ],
        )?;
        self.insert_log("promoteRevision", "success", "Revision promoted to Stable")?;
        self.scan_live_state()
    }

    pub fn list_unmanaged(&mut self) -> ServiceResult<Vec<LiveFolderState>> {
        let settings = self.load_settings()?;
        let addons_path = settings.addons_path.ok_or_else(|| {
            ServiceError::Message("Configure the AddOns path before scanning".to_string())
        })?;
        self.list_unmanaged_in_path(Path::new(&addons_path))
    }

    pub fn check_updates(&mut self) -> ServiceResult<UpdateCheckResponse> {
        let settings = self.load_settings()?;
        let (catalog, stale, manifest_url, error_message) =
            self.fetch_or_load_cached_catalog(&settings)?;
        let manifest_generated_at = Some(catalog.generated_at.clone());
        let remote_products = catalog.products.into_values().collect::<Vec<_>>();

        let settings = self.load_settings()?;
        let addons = self.load_addons()?;
        let addon_map = addons
            .into_iter()
            .map(|addon| (addon.id.clone(), addon))
            .collect::<HashMap<_, _>>();

        let manager = remote_products
            .iter()
            .find(|product| product.product_type == RemoteProductType::Manager)
            .map(|product| self.to_manager_update_status(product, None))
            .transpose()?;

        let mut addon_updates = remote_products
            .iter()
            .filter(|product| product.product_type == RemoteProductType::Addon)
            .filter_map(|product| addon_map.get(&product.id).map(|addon| (product, addon)))
            .map(|(product, addon)| self.to_remote_addon_update(&settings, addon, product))
            .collect::<ServiceResult<Vec<_>>>()?;
        addon_updates.sort_by(|left, right| left.name.cmp(&right.name));

        Ok(UpdateCheckResponse {
            channel: settings.update_channel,
            checked_at: settings.last_update_check_at,
            manifest_generated_at,
            manifest_url,
            stale,
            error_message,
            manager,
            addons: addon_updates,
        })
    }

    pub fn apply_remote_addon_update(
        &mut self,
        request: ApplyRemoteAddonUpdateRequest,
    ) -> ServiceResult<OperationResponse> {
        let _ = self.check_updates()?;
        let settings = self.load_settings()?;
        let product = self
            .load_cached_remote_product(&request.addon_id, settings.update_channel)?
            .ok_or_else(|| {
                ServiceError::Message(format!(
                    "No cached remote update found for '{}'",
                    request.addon_id
                ))
            })?;
        if product.product_type != RemoteProductType::Addon {
            return Err(ServiceError::Message(format!(
                "Product '{}' is not an addon",
                product.id
            )));
        }
        if !UpdateProvider::manager_version_satisfies(product.min_manager_version.as_deref()) {
            return Err(ServiceError::Message(format!(
                "{} requires BronzeForge Manager {} or newer",
                product.name,
                product.min_manager_version.unwrap_or_default()
            )));
        }
        let addon = self.load_addon(&product.id)?;
        let download_path = self
            .directories
            .staging
            .join("remote-downloads")
            .join(format!(
                "{}-{}{}.zip",
                product.id,
                settings.update_channel.as_str(),
                sanitize_version(&product.latest_version)
            ));
        self.update_provider
            .download_verified_asset(&settings, &product, &download_path)?;
        self.import_zip(ImportZipRequest {
            path: download_path.to_string_lossy().to_string(),
            channel: Some(update_channel_to_channel(settings.update_channel)),
            core: Some(addon.is_core),
        })?;
        self.insert_log(
            "downloadRemoteAddonUpdate",
            "success",
            &format!(
                "Downloaded remote {} update {}",
                product.name, product.latest_version
            ),
        )?;
        self.update_addon(InstallAddonRequest {
            addon_id: request.addon_id,
            profile_id: request.profile_id,
            preview_only: request.preview_only,
        })
    }

    pub fn install_manager_update(
        &mut self,
        request: InstallManagerUpdateRequest,
    ) -> ServiceResult<ManagerUpdateStatus> {
        let _ = self.check_updates()?;
        let settings = self.load_settings()?;
        let product_id = request
            .product_id
            .unwrap_or_else(|| "bronzeforge-manager".to_string());
        let product = self
            .load_cached_remote_product(&product_id, settings.update_channel)?
            .ok_or_else(|| {
                ServiceError::Message(format!(
                    "No cached manager update found for '{}'",
                    product_id
                ))
            })?;
        if product.product_type != RemoteProductType::Manager {
            return Err(ServiceError::Message(format!(
                "Product '{}' is not the desktop manager",
                product.id
            )));
        }
        let status = self.to_manager_update_status(&product, None)?;
        if !status.available {
            return Err(ServiceError::Message(
                "BronzeForge Manager is already up to date".to_string(),
            ));
        }

        let installer_name = Url::parse(&product.package_url)
            .ok()
            .and_then(|url| {
                url.path_segments()
                    .and_then(|mut segments| segments.next_back().map(str::to_string))
            })
            .unwrap_or_else(|| "bronzeforge-manager-installer.exe".to_string());
        let installer_path = self
            .directories
            .staging
            .join("manager-updates")
            .join(installer_name);
        let installer_path =
            self.update_provider
                .download_verified_asset(&settings, &product, &installer_path)?;
        Command::new(&installer_path).spawn().map_err(|error| {
            ServiceError::Message(format!("Failed to launch installer: {error}"))
        })?;
        self.insert_log(
            "installManagerUpdate",
            "success",
            &format!(
                "Launched BronzeForge Manager installer {}",
                product.latest_version
            ),
        )?;

        if let Some(app_handle) = self.app_handle.clone() {
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(500));
                app_handle.exit(0);
            });
        }

        self.to_manager_update_status(&product, Some(installer_path.to_string_lossy().to_string()))
    }

    pub fn scan_live_state(&mut self) -> ServiceResult<ScanStateResponse> {
        let settings = self.load_settings()?;
        let addons = self.load_addons()?;
        let sources = self.load_sources()?;
        let revisions = self.load_revisions()?;
        let profiles = self.load_profiles()?;
        let selections_by_profile = self.load_all_profile_selections()?;
        let active_profile_id = profiles
            .iter()
            .find(|profile| profile.is_active)
            .map(|profile| profile.id.clone());
        let active_selections = active_profile_id
            .as_ref()
            .and_then(|id| selections_by_profile.get(id))
            .cloned()
            .unwrap_or_default();
        let live_folders = if let Some(addons_path) = settings.addons_path.as_ref() {
            self.scan_live_addons(Path::new(addons_path))?
        } else {
            Vec::new()
        };
        let mut issues = Vec::new();
        if settings.addons_path.is_none() {
            issues.push(issue(
                "missing_addons_path",
                Severity::Blocker,
                "Configure an AddOns path before BronzeForge can materialize a profile.",
                None,
                None,
            ));
        }
        if let Some(active_profile) = active_profile_id.clone() {
            let preview = self.preview_profile_sync(&active_profile, false, None)?;
            issues.extend(preview.blockers.clone());
            issues.extend(preview.warnings.clone());
        }
        let unmanaged = live_folders
            .iter()
            .filter(|folder| !folder.managed)
            .cloned()
            .collect::<Vec<_>>();
        let addon_records = addons
            .into_iter()
            .map(|addon| {
                let latest_revisions = revisions
                    .iter()
                    .filter(|revision| revision.addon_id == addon.id)
                    .map(|revision| RevisionSummary {
                        id: revision.id.clone(),
                        channel: revision.channel,
                        version: revision.version.clone(),
                        created_at: revision.created_at,
                    })
                    .collect::<Vec<_>>();
                let source_rows = sources
                    .iter()
                    .filter(|source| source.addon_id == addon.id)
                    .map(|source| SourceSummary {
                        id: source.id.clone(),
                        source_kind: source.source_kind,
                        location: source.location.clone(),
                        channel_hint: source.channel_hint,
                        updated_at: source.updated_at,
                    })
                    .collect::<Vec<_>>();
                let selection = active_selections
                    .iter()
                    .find(|selection| selection.addon_id == addon.id);
                let current_channel = selection
                    .and_then(|item| item.channel_override)
                    .or(Some(addon.default_channel));
                let current_version = current_channel.and_then(|channel| {
                    latest_revisions
                        .iter()
                        .find(|revision| revision.channel == channel)
                        .map(|revision| revision.version.clone())
                });
                let installed = live_folders
                    .iter()
                    .any(|folder| folder.addon_id.as_deref() == Some(addon.id.as_str()));
                let health = if issues.iter().any(|entry| {
                    entry.addon_id.as_deref() == Some(addon.id.as_str())
                        && entry.severity == Severity::Blocker
                }) {
                    "Broken".to_string()
                } else if issues
                    .iter()
                    .any(|entry| entry.addon_id.as_deref() == Some(addon.id.as_str()))
                {
                    "Warning".to_string()
                } else if current_version.is_some() && !installed {
                    "Backup Recommended".to_string()
                } else {
                    "Ready".to_string()
                };
                AddonRecord {
                    id: addon.id,
                    display_name: addon.display_name,
                    install_folder: addon.install_folder,
                    default_channel: addon.default_channel,
                    notes: addon.notes,
                    dependencies: addon.dependencies,
                    conflicts: addon.conflicts,
                    saved_variables: addon.saved_variables,
                    is_core: addon.is_core,
                    current_version,
                    current_channel,
                    enabled_in_active_profile: selection.map(|item| item.enabled).unwrap_or(false),
                    health,
                    latest_revisions,
                    sources: source_rows,
                }
            })
            .collect::<Vec<_>>();
        let profiles = profiles
            .into_iter()
            .map(|profile| ProfileRecord {
                id: profile.id.clone(),
                name: profile.name,
                notes: profile.notes,
                is_active: profile.is_active,
                last_used_at: profile.last_used_at,
                selections: selections_by_profile
                    .get(&profile.id)
                    .cloned()
                    .unwrap_or_default(),
            })
            .collect::<Vec<_>>();
        Ok(ScanStateResponse {
            settings,
            addons: addon_records,
            profiles,
            snapshots: self.load_snapshots()?,
            logs: self.load_logs()?,
            unmanaged,
            issues,
            active_profile_id,
            interrupted_operation: self.load_unfinished_operation()?,
        })
    }

    fn run_migrations(&mut self) -> ServiceResult<()> {
        self.connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS schema_migrations (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              applied_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              ascension_root_path TEXT,
              addons_path TEXT,
              saved_variables_path TEXT,
              backup_retention_count INTEGER NOT NULL DEFAULT 20,
              auto_backup_enabled INTEGER NOT NULL DEFAULT 1,
              default_profile_id TEXT,
              dev_mode_enabled INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS addons (
              id TEXT PRIMARY KEY,
              display_name TEXT NOT NULL,
              install_folder TEXT NOT NULL UNIQUE,
              default_channel TEXT NOT NULL,
              notes TEXT,
              dependencies_json TEXT NOT NULL DEFAULT '[]',
              conflicts_json TEXT NOT NULL DEFAULT '[]',
              saved_variables_json TEXT NOT NULL DEFAULT '[]',
              is_core INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sources (
              id TEXT PRIMARY KEY,
              addon_id TEXT NOT NULL,
              source_kind TEXT NOT NULL,
              location TEXT NOT NULL,
              channel_hint TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS revisions (
              id TEXT PRIMARY KEY,
              addon_id TEXT NOT NULL,
              source_id TEXT,
              channel TEXT NOT NULL,
              version TEXT NOT NULL,
              cache_path TEXT NOT NULL,
              checksum TEXT NOT NULL,
              metadata_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS profiles (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              notes TEXT,
              last_used_at TEXT,
              is_active INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS profile_addons (
              profile_id TEXT NOT NULL,
              addon_id TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 0,
              channel_override TEXT,
              PRIMARY KEY (profile_id, addon_id)
            );
            CREATE TABLE IF NOT EXISTS snapshots (
              id TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              snapshot_type TEXT NOT NULL,
              related_profile_id TEXT,
              notes TEXT,
              pinned INTEGER NOT NULL DEFAULT 0,
              backup_path TEXT NOT NULL,
              size_bytes INTEGER NOT NULL DEFAULT 0,
              addon_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS snapshot_items (
              id TEXT PRIMARY KEY,
              snapshot_id TEXT NOT NULL,
              addon_id TEXT,
              relative_path TEXT NOT NULL,
              item_type TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS operation_logs (
              id TEXT PRIMARY KEY,
              operation TEXT NOT NULL,
              status TEXT NOT NULL,
              message TEXT NOT NULL,
              details_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS unfinished_operations (
              id TEXT PRIMARY KEY,
              operation TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              snapshot_id TEXT,
              started_at TEXT NOT NULL
            );",
        )?;
        self.apply_migration(
            1,
            "update_delivery_v1",
            &[
                "ALTER TABLE settings ADD COLUMN update_channel TEXT NOT NULL DEFAULT 'stable'",
                "ALTER TABLE settings ADD COLUMN last_update_check_at TEXT",
                "ALTER TABLE settings ADD COLUMN last_update_error TEXT",
                "ALTER TABLE settings ADD COLUMN update_manifest_override TEXT",
                "CREATE TABLE IF NOT EXISTS remote_products (
                  product_id TEXT NOT NULL,
                  channel TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  checked_at TEXT NOT NULL,
                  PRIMARY KEY (product_id, channel)
                )",
            ],
        )?;
        self.apply_migration(
            2,
            "launcher_reset_v2",
            &[
                "ALTER TABLE settings ADD COLUMN maintainer_mode_enabled INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE settings ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE settings ADD COLUMN selected_pack_id TEXT",
                "ALTER TABLE settings ADD COLUMN game_executable_path TEXT",
                "CREATE TABLE IF NOT EXISTS remote_packs (
                  pack_id TEXT NOT NULL,
                  channel TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  checked_at TEXT NOT NULL,
                  PRIMARY KEY (pack_id, channel)
                )",
            ],
        )?;
        Ok(())
    }

    fn apply_migration(&mut self, id: i64, name: &str, statements: &[&str]) -> ServiceResult<()> {
        let applied = self.connection.query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )? > 0;
        if applied {
            return Ok(());
        }
        for statement in statements {
            match self.connection.execute(statement, params![]) {
                Ok(_) => {}
                Err(rusqlite::Error::SqliteFailure(_, Some(message)))
                    if message.contains("duplicate column name")
                        || message.contains("already exists") => {}
                Err(error) => return Err(ServiceError::from(error)),
            }
        }
        self.connection.execute(
            "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?1, ?2, ?3)",
            params![id, name, now_string()],
        )?;
        Ok(())
    }

    fn ensure_defaults(&mut self) -> ServiceResult<()> {
        let settings_count =
            self.connection
                .query_row("SELECT COUNT(*) FROM settings", params![], |row| {
                    row.get::<_, i64>(0)
                })?;
        if settings_count == 0 {
            self.connection.execute(
                "INSERT INTO settings (id, backup_retention_count, auto_backup_enabled, dev_mode_enabled, maintainer_mode_enabled, onboarding_completed, updated_at) VALUES (1, 20, 1, 0, 0, 0, ?1)",
                params![now_string()],
            )?;
        }
        let profile_count =
            self.connection
                .query_row("SELECT COUNT(*) FROM profiles", params![], |row| {
                    row.get::<_, i64>(0)
                })?;
        if profile_count == 0 {
            for (name, active) in [
                ("Main", true),
                ("Leveling", false),
                ("PvP", false),
                ("Raid", false),
                ("Dev Cleanroom", false),
            ] {
                let id = Uuid::new_v4().to_string();
                let now = now_string();
                self.connection.execute(
                    "INSERT INTO profiles (id, name, notes, last_used_at, is_active, created_at, updated_at) VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?4)",
                    params![id, name, active as i64, now],
                )?;
                if active {
                    self.connection.execute(
                        "UPDATE settings SET default_profile_id = ?1, updated_at = ?2 WHERE id = 1",
                        params![id, now_string()],
                    )?;
                }
            }
        }
        Ok(())
    }

    fn import_manifest_source(&mut self, manifest_path: &Path, core: bool) -> ServiceResult<()> {
        let manifest = read_manifest_file(manifest_path)?;
        let source_id = Uuid::new_v4().to_string();
        let addon_id = manifest.addon_id.clone().unwrap_or_else(|| {
            manifest
                .install_folder
                .clone()
                .unwrap_or_else(|| "addon".to_string())
                .to_lowercase()
        });
        let display_name = manifest
            .display_name
            .clone()
            .unwrap_or_else(|| addon_id.clone());
        let install_folder = manifest
            .install_folder
            .clone()
            .unwrap_or_else(|| display_name.replace(' ', ""));
        let default_channel = manifest.default_channel.unwrap_or(Channel::Stable);
        self.upsert_addon(
            &addon_id,
            &display_name,
            &install_folder,
            default_channel,
            manifest.notes.clone(),
            manifest.dependencies.clone(),
            manifest.conflicts.clone(),
            manifest.saved_variables.clone(),
            core,
        )?;
        self.connection.execute(
            "INSERT OR REPLACE INTO sources (id, addon_id, source_kind, location, channel_hint, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?5)",
            params![source_id, addon_id, SourceKind::Manifest.to_string(), manifest_path.to_string_lossy().to_string(), now_string()],
        )?;
        for (channel_name, channel_spec) in manifest.channels {
            let channel = channel_name.parse::<Channel>().unwrap_or(Channel::Stable);
            let resolved_path = resolve_relative_path(manifest_path, &channel_spec.path);
            match channel_spec.kind {
                SourceKind::LocalFolder => {
                    self.import_folder_source(
                        &resolved_path,
                        channel,
                        core,
                        SourceKind::LocalFolder,
                        &resolved_path.to_string_lossy(),
                        Some(source_id.clone()),
                    )?;
                    if let Some(version) = channel_spec.version {
                        self.touch_latest_revision_version(&addon_id, channel, &version)?;
                    }
                }
                SourceKind::ZipFile => {
                    self.import_zip(ImportZipRequest {
                        path: resolved_path.to_string_lossy().to_string(),
                        channel: Some(channel),
                        core: Some(core),
                    })?;
                }
                SourceKind::Manifest => {}
            }
        }
        Ok(())
    }

    fn import_folder_source(
        &mut self,
        folder_path: &Path,
        channel: Channel,
        core: bool,
        source_kind: SourceKind,
        source_location: &str,
        source_id_override: Option<String>,
    ) -> ServiceResult<(String, String)> {
        let metadata = load_local_metadata(folder_path, channel)?;
        self.upsert_addon(
            &metadata.addon_id,
            &metadata.display_name,
            &metadata.install_folder,
            metadata.default_channel,
            metadata.notes.clone(),
            metadata.dependencies.clone(),
            metadata.conflicts.clone(),
            metadata.saved_variables.clone(),
            core,
        )?;
        let source_id = source_id_override.unwrap_or_else(|| Uuid::new_v4().to_string());
        self.connection.execute(
            "INSERT OR REPLACE INTO sources (id, addon_id, source_kind, location, channel_hint, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT created_at FROM sources WHERE id = ?1), ?6), ?6)",
            params![source_id, metadata.addon_id, source_kind.to_string(), source_location, channel.to_string(), now_string()],
        )?;
        let revision_id = Uuid::new_v4().to_string();
        let cache_root = self.directories.cache.join("revisions").join(&revision_id);
        fs::create_dir_all(&cache_root)?;
        let source_root = normalize_addon_root(folder_path)?;
        let cache_target = cache_root.join(&metadata.install_folder);
        if channel == Channel::LocalDev {
            let checksum = compute_checksum(&source_root)?;
            self.connection.execute(
                "INSERT INTO revisions (id, addon_id, source_id, channel, version, cache_path, checksum, metadata_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![revision_id, metadata.addon_id, source_id, channel.to_string(), metadata.version, source_root.to_string_lossy().to_string(), checksum, json!({ "tocFile": metadata.toc_file }).to_string(), now_string()],
            )?;
        } else {
            copy_dir_all(&source_root, &cache_target)?;
            let checksum = compute_checksum(&cache_target)?;
            self.connection.execute(
                "INSERT INTO revisions (id, addon_id, source_id, channel, version, cache_path, checksum, metadata_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![revision_id, metadata.addon_id, source_id, channel.to_string(), metadata.version, cache_target.to_string_lossy().to_string(), checksum, json!({ "tocFile": metadata.toc_file }).to_string(), now_string()],
            )?;
        }
        self.ensure_addon_in_profiles(&metadata.addon_id)?;
        self.insert_log(
            "registerSource",
            "success",
            &format!(
                "Imported {} on {} channel",
                metadata.display_name,
                channel.as_str()
            ),
        )?;
        Ok((source_id, metadata.addon_id))
    }

    fn touch_latest_revision_version(
        &mut self,
        addon_id: &str,
        channel: Channel,
        version: &str,
    ) -> ServiceResult<()> {
        if let Some(revision) = self.latest_revision_for_channel(addon_id, channel)? {
            self.connection.execute(
                "UPDATE revisions SET version = ?2 WHERE id = ?1",
                params![revision.id, version],
            )?;
        }
        Ok(())
    }

    fn preview_profile_sync(
        &mut self,
        profile_id: &str,
        safe_mode: bool,
        isolate_addon_id: Option<String>,
    ) -> ServiceResult<ProfilePreview> {
        let selections = self.load_profile_selections(profile_id)?;
        self.preview_profile_sync_with_selections(
            profile_id,
            selections,
            safe_mode,
            isolate_addon_id,
        )
    }

    fn preview_profile_sync_with_selections(
        &mut self,
        profile_id: &str,
        selections: Vec<ProfileSelection>,
        safe_mode: bool,
        isolate_addon_id: Option<String>,
    ) -> ServiceResult<ProfilePreview> {
        let settings = self.load_settings()?;
        let addons_path = settings.addons_path.clone();
        let saved_variables_path = settings.saved_variables_path.clone();
        let profile = self.load_profile(profile_id)?;
        let addon_map = self
            .load_addons()?
            .into_iter()
            .map(|addon| (addon.id.clone(), addon))
            .collect::<HashMap<_, _>>();
        let mut blockers = Vec::new();
        let mut warnings = Vec::new();
        let mut installs = Vec::new();
        let mut saved_variables = HashSet::new();
        let live_folders = if let Some(addons_path) = addons_path.as_ref() {
            self.scan_live_addons(Path::new(addons_path))?
        } else {
            blockers.push(issue(
                "missing_addons_path",
                Severity::Blocker,
                "Set the AddOns path before syncing a profile.",
                None,
                None,
            ));
            Vec::new()
        };
        let enabled = selections
            .into_iter()
            .filter(|selection| selection.enabled)
            .collect::<Vec<_>>();
        let mut desired_ids = enabled
            .iter()
            .map(|selection| selection.addon_id.clone())
            .collect::<HashSet<_>>();
        if safe_mode {
            desired_ids = desired_ids
                .into_iter()
                .filter(|addon_id| {
                    addon_map
                        .get(addon_id)
                        .map(|addon| addon.is_core)
                        .unwrap_or(false)
                })
                .collect();
        }
        if let Some(isolate_id) = isolate_addon_id.as_ref() {
            desired_ids.clear();
            desired_ids.insert(isolate_id.clone());
            if let Some(addon) = addon_map.get(isolate_id) {
                for dependency in &addon.dependencies {
                    desired_ids.insert(dependency.clone());
                }
            }
        }
        let mut desired_folders = HashSet::new();
        for selection in enabled {
            if !desired_ids.contains(&selection.addon_id) {
                continue;
            }
            let Some(addon) = addon_map.get(&selection.addon_id).cloned() else {
                blockers.push(issue(
                    "missing_addon",
                    Severity::Blocker,
                    &format!("Profile references unknown addon '{}'", selection.addon_id),
                    Some(selection.addon_id),
                    None,
                ));
                continue;
            };
            for dependency in &addon.dependencies {
                if !desired_ids.contains(dependency) {
                    blockers.push(issue(
                        "missing_dependency",
                        Severity::Blocker,
                        &format!(
                            "{} requires dependency '{}'",
                            addon.display_name, dependency
                        ),
                        Some(addon.id.clone()),
                        Some(addon.install_folder.clone()),
                    ));
                }
            }
            for conflict in &addon.conflicts {
                if desired_ids.contains(conflict) {
                    warnings.push(issue(
                        "declared_conflict",
                        Severity::Warning,
                        &format!("{} conflicts with '{}'", addon.display_name, conflict),
                        Some(addon.id.clone()),
                        Some(addon.install_folder.clone()),
                    ));
                }
            }
            if !desired_folders.insert(addon.install_folder.clone()) {
                blockers.push(issue(
                    "duplicate_install_folder",
                    Severity::Blocker,
                    &format!("Duplicate managed folder '{}'", addon.install_folder),
                    Some(addon.id.clone()),
                    Some(addon.install_folder.clone()),
                ));
            }
            let channel = selection.channel_override.unwrap_or(addon.default_channel);
            let Some(revision) = self.latest_revision_for_channel(&addon.id, channel)? else {
                blockers.push(issue(
                    "missing_revision",
                    Severity::Blocker,
                    &format!(
                        "{} has no revision available on {}",
                        addon.display_name,
                        channel.as_str()
                    ),
                    Some(addon.id.clone()),
                    Some(addon.install_folder.clone()),
                ));
                continue;
            };
            let source_path = PathBuf::from(&revision.cache_path);
            if !source_path.exists() {
                warnings.push(issue(
                    "stale_source_reference",
                    Severity::Warning,
                    &format!(
                        "{} references a missing source path {}",
                        addon.display_name,
                        source_path.display()
                    ),
                    Some(addon.id.clone()),
                    Some(addon.install_folder.clone()),
                ));
                continue;
            }
            if normalize_addon_root(&source_path).is_err() {
                blockers.push(issue(
                    "invalid_layout",
                    Severity::Blocker,
                    &format!(
                        "{} is missing a valid TOC or folder layout",
                        addon.display_name
                    ),
                    Some(addon.id.clone()),
                    Some(addon.install_folder.clone()),
                ));
                continue;
            }
            let Some(addons_path) = addons_path.as_ref() else {
                continue;
            };
            let target_path = Path::new(addons_path).join(&addon.install_folder);
            if let Some(live) = live_folders
                .iter()
                .find(|folder| folder.name == addon.install_folder && !folder.managed)
            {
                blockers.push(issue(
                    "unmanaged_collision",
                    Severity::Blocker,
                    &format!(
                        "{} would overwrite unmanaged folder '{}'",
                        addon.display_name, live.name
                    ),
                    Some(addon.id.clone()),
                    Some(addon.install_folder.clone()),
                ));
                continue;
            }
            let change_type = if !target_path.exists() {
                ChangeType::Install
            } else if compute_checksum(&target_path)? != revision.checksum {
                ChangeType::Update
            } else {
                continue;
            };
            installs.push(InstallPlan {
                addon,
                channel,
                version: Some(revision.version),
                source_path,
                target_path,
                change_type,
            });
        }
        let desired_folders = desired_ids
            .iter()
            .filter_map(|addon_id| addon_map.get(addon_id))
            .map(|addon| addon.install_folder.clone())
            .collect::<HashSet<_>>();
        let removals = addons_path
            .as_ref()
            .map(|addons_path| {
                live_folders
                    .iter()
                    .filter_map(|folder| {
                        if folder.managed && !desired_folders.contains(&folder.name) {
                            folder
                                .addon_id
                                .as_ref()
                                .and_then(|addon_id| addon_map.get(addon_id))
                                .map(|addon| RemovalPlan {
                                    addon: addon.clone(),
                                    target_path: Path::new(addons_path).join(&addon.install_folder),
                                })
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        match saved_variables_path {
            Some(path) if Path::new(&path).exists() => {
                for install in &installs {
                    for file_name in &install.addon.saved_variables {
                        saved_variables.insert(file_name.clone());
                    }
                }
            }
            Some(_) => warnings.push(issue(
                "saved_variables_path_missing",
                Severity::Warning,
                "SavedVariables path is missing; addon snapshots will exclude configuration state.",
                None,
                None,
            )),
            None => warnings.push(issue(
                "saved_variables_unconfigured",
                Severity::Warning,
                "SavedVariables path is not configured; only addon folders will be snapshotted.",
                None,
                None,
            )),
        }
        Ok(ProfilePreview {
            profile_id: profile.id,
            installs,
            removals,
            blockers,
            warnings,
            saved_variables: saved_variables.into_iter().collect(),
        })
    }

    fn apply_preview(&mut self, preview: &ProfilePreview) -> ServiceResult<()> {
        let settings = self.load_settings()?;
        let _addons_path = settings
            .addons_path
            .ok_or_else(|| ServiceError::Message("AddOns path is required".to_string()))?;
        let staging_root = self
            .directories
            .staging
            .join(format!("apply-{}", Uuid::new_v4()));
        let replaced_root = staging_root.join("replaced");
        let removed_root = staging_root.join("removed");
        fs::create_dir_all(&replaced_root)?;
        fs::create_dir_all(&removed_root)?;
        for plan in &preview.installs {
            let normalized_source = normalize_addon_root(&plan.source_path)?;
            let staged_target = staging_root.join(&plan.addon.install_folder);
            if staged_target.exists() {
                fs::remove_dir_all(&staged_target)?;
            }
            copy_dir_all(&normalized_source, &staged_target)?;
            if plan.target_path.exists() {
                let replaced_target = replaced_root.join(&plan.addon.install_folder);
                if replaced_target.exists() {
                    fs::remove_dir_all(&replaced_target)?;
                }
                move_dir(&plan.target_path, &replaced_target)?;
            }
            move_dir(&staged_target, &plan.target_path)?;
        }
        for removal in &preview.removals {
            if removal.target_path.exists() {
                let removed_target = removed_root.join(&removal.addon.install_folder);
                if removed_target.exists() {
                    fs::remove_dir_all(&removed_target)?;
                }
                move_dir(&removal.target_path, &removed_target)?;
            }
        }
        if let Some(saved_root) = settings.saved_variables_path {
            fs::create_dir_all(&saved_root)?;
            for variable in &preview.saved_variables {
                let path = Path::new(&saved_root).join(variable);
                if !path.exists() {
                    fs::write(path, b"-- BronzeForge managed SavedVariables placeholder\n")?;
                }
            }
        }
        Ok(())
    }

    fn create_snapshot_for_preview(
        &mut self,
        snapshot_type: SnapshotType,
        preview: &ProfilePreview,
        notes: Option<String>,
    ) -> ServiceResult<String> {
        let settings = self.load_settings()?;
        let snapshot_id = Uuid::new_v4().to_string();
        let snapshot_root = self.directories.snapshots.join(&snapshot_id);
        fs::create_dir_all(snapshot_root.join("addons"))?;
        fs::create_dir_all(snapshot_root.join("savedVariables"))?;
        let mut item_count = 0usize;
        let mut total_size = 0u64;
        for install in &preview.installs {
            if install.target_path.exists() {
                let destination = snapshot_root
                    .join("addons")
                    .join(&install.addon.install_folder);
                copy_dir_all(&install.target_path, &destination)?;
                total_size += dir_size(&destination)?;
                item_count += 1;
                self.connection.execute(
                    "INSERT INTO snapshot_items (id, snapshot_id, addon_id, relative_path, item_type) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![Uuid::new_v4().to_string(), snapshot_id, install.addon.id, format!("addons\\{}", install.addon.install_folder), "addonFolder"],
                )?;
            }
        }
        for removal in &preview.removals {
            if removal.target_path.exists() {
                let destination = snapshot_root
                    .join("addons")
                    .join(&removal.addon.install_folder);
                copy_dir_all(&removal.target_path, &destination)?;
                total_size += dir_size(&destination)?;
                item_count += 1;
                self.connection.execute(
                    "INSERT INTO snapshot_items (id, snapshot_id, addon_id, relative_path, item_type) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![Uuid::new_v4().to_string(), snapshot_id, removal.addon.id, format!("addons\\{}", removal.addon.install_folder), "addonFolder"],
                )?;
            }
        }
        if let Some(saved_root) = settings.saved_variables_path.as_ref() {
            for variable in &preview.saved_variables {
                let source = Path::new(saved_root).join(variable);
                if source.exists() {
                    let destination = snapshot_root.join("savedVariables").join(variable);
                    if let Some(parent) = destination.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::copy(&source, &destination)?;
                    total_size += destination.metadata()?.len();
                    item_count += 1;
                    self.connection.execute(
                        "INSERT INTO snapshot_items (id, snapshot_id, addon_id, relative_path, item_type) VALUES (?1, ?2, NULL, ?3, ?4)",
                        params![Uuid::new_v4().to_string(), snapshot_id, format!("savedVariables\\{}", variable), "savedVariable"],
                    )?;
                }
            }
        }
        self.connection.execute(
            "INSERT INTO snapshots (id, created_at, snapshot_type, related_profile_id, notes, pinned, backup_path, size_bytes, addon_count)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8)",
            params![snapshot_id, now_string(), snapshot_type.as_str(), preview.profile_id, notes, snapshot_root.to_string_lossy().to_string(), total_size as i64, item_count as i64],
        )?;
        Ok(snapshot_id)
    }

    fn restore_snapshot_internal(&mut self, snapshot_id: &str) -> ServiceResult<()> {
        let snapshot = self.load_snapshot_summary(snapshot_id)?;
        let settings = self.load_settings()?;
        let addons_path = settings.addons_path.ok_or_else(|| {
            ServiceError::Message("Configure the AddOns path before restore".to_string())
        })?;
        ensure_addons_path_writable(&addons_path)?;
        let snapshot_root = PathBuf::from(self.load_snapshot_path(snapshot_id)?);
        for addon in self.load_addons()? {
            let live_path = Path::new(&addons_path).join(&addon.install_folder);
            if live_path.exists() {
                fs::remove_dir_all(&live_path)?;
            }
        }
        let addon_snapshot_root = snapshot_root.join("addons");
        if addon_snapshot_root.exists() {
            for entry in fs::read_dir(&addon_snapshot_root)? {
                let entry = entry?;
                if entry.path().is_dir() {
                    copy_dir_all(
                        &entry.path(),
                        &Path::new(&addons_path).join(entry.file_name()),
                    )?;
                }
            }
        }
        if let Some(saved_root) = settings.saved_variables_path {
            let saved_snapshot_root = snapshot_root.join("savedVariables");
            if saved_snapshot_root.exists() {
                for entry in WalkDir::new(&saved_snapshot_root)
                    .min_depth(1)
                    .into_iter()
                    .flatten()
                {
                    if entry.path().is_file() {
                        let relative = entry
                            .path()
                            .strip_prefix(&saved_snapshot_root)
                            .map_err(|error| ServiceError::Message(error.to_string()))?;
                        let target = Path::new(&saved_root).join(relative);
                        if let Some(parent) = target.parent() {
                            fs::create_dir_all(parent)?;
                        }
                        fs::copy(entry.path(), target)?;
                    }
                }
            }
        }
        if let Some(profile_id) = snapshot.related_profile_id {
            self.switch_profile(SwitchProfileRequest { profile_id })?;
        }
        Ok(())
    }

    fn prune_snapshots(&mut self) -> ServiceResult<()> {
        let limit = self.load_settings()?.backup_retention_count.max(1) as usize;
        let snapshots = self.load_snapshots()?;
        let mut unpinned = snapshots
            .into_iter()
            .filter(|snapshot| !snapshot.pinned)
            .collect::<Vec<_>>();
        let to_remove = unpinned.len().saturating_sub(limit);
        if to_remove == 0 {
            return Ok(());
        }
        unpinned.sort_by_key(|snapshot| snapshot.created_at);
        for snapshot in unpinned.into_iter().take(to_remove) {
            let path = self.load_snapshot_path(&snapshot.id)?;
            if Path::new(&path).exists() {
                fs::remove_dir_all(&path)?;
            }
            self.connection.execute(
                "DELETE FROM snapshot_items WHERE snapshot_id = ?1",
                params![snapshot.id],
            )?;
            self.connection
                .execute("DELETE FROM snapshots WHERE id = ?1", params![snapshot.id])?;
        }
        Ok(())
    }

    fn record_unfinished_operation(
        &mut self,
        id: &str,
        operation: &str,
        payload: &serde_json::Value,
        snapshot_id: Option<String>,
    ) -> ServiceResult<()> {
        self.connection.execute(
            "INSERT INTO unfinished_operations (id, operation, payload_json, snapshot_id, started_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, operation, payload.to_string(), snapshot_id, now_string()],
        )?;
        Ok(())
    }

    fn clear_unfinished_operation(&mut self, id: &str) -> ServiceResult<()> {
        self.connection.execute(
            "DELETE FROM unfinished_operations WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    fn insert_log(&mut self, operation: &str, status: &str, message: &str) -> ServiceResult<()> {
        self.connection.execute(
            "INSERT INTO operation_logs (id, operation, status, message, details_json, created_at) VALUES (?1, ?2, ?3, ?4, '{}', ?5)",
            params![Uuid::new_v4().to_string(), operation, status, message, now_string()],
        )?;
        Ok(())
    }

    fn ensure_addon_in_profiles(&mut self, addon_id: &str) -> ServiceResult<()> {
        for profile in self.load_profiles()? {
            let exists = self.connection.query_row(
                "SELECT COUNT(*) FROM profile_addons WHERE profile_id = ?1 AND addon_id = ?2",
                params![profile.id, addon_id],
                |row| row.get::<_, i64>(0),
            )?;
            if exists == 0 {
                self.connection.execute(
                    "INSERT INTO profile_addons (profile_id, addon_id, enabled, channel_override) VALUES (?1, ?2, ?3, NULL)",
                    params![profile.id, addon_id, profile.is_active as i64],
                )?;
            }
        }
        Ok(())
    }

    fn upsert_addon(
        &mut self,
        addon_id: &str,
        display_name: &str,
        install_folder: &str,
        default_channel: Channel,
        notes: Option<String>,
        dependencies: Vec<String>,
        conflicts: Vec<String>,
        saved_variables: Vec<String>,
        core: bool,
    ) -> ServiceResult<()> {
        let now = now_string();
        self.connection.execute(
            "INSERT INTO addons (id, display_name, install_folder, default_channel, notes, dependencies_json, conflicts_json, saved_variables_json, is_core, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
             ON CONFLICT(id) DO UPDATE SET
               display_name = excluded.display_name,
               install_folder = excluded.install_folder,
               default_channel = excluded.default_channel,
               notes = excluded.notes,
               dependencies_json = excluded.dependencies_json,
               conflicts_json = excluded.conflicts_json,
               saved_variables_json = excluded.saved_variables_json,
               is_core = excluded.is_core,
               updated_at = excluded.updated_at",
            params![addon_id, display_name, install_folder, default_channel.to_string(), notes, serde_json::to_string(&dependencies)?, serde_json::to_string(&conflicts)?, serde_json::to_string(&saved_variables)?, core as i64, now],
        )?;
        Ok(())
    }

    fn replace_profile_selections(
        &mut self,
        profile_id: &str,
        selections: &[ProfileSelection],
    ) -> ServiceResult<()> {
        self.connection.execute(
            "DELETE FROM profile_addons WHERE profile_id = ?1",
            params![profile_id],
        )?;
        for selection in selections {
            self.connection.execute(
                "INSERT INTO profile_addons (profile_id, addon_id, enabled, channel_override)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    profile_id,
                    &selection.addon_id,
                    selection.enabled as i64,
                    selection.channel_override.map(|value| value.to_string())
                ],
            )?;
        }
        Ok(())
    }

    fn fetch_or_load_cached_catalog(
        &mut self,
        settings: &Settings,
    ) -> ServiceResult<(UpdateCatalog, bool, Option<String>, Option<String>)> {
        match self.update_provider.fetch_catalog(settings) {
            Ok((catalog_url, catalog)) => {
                let products = catalog.products.values().cloned().collect::<Vec<_>>();
                let packs = catalog.packs.values().cloned().collect::<Vec<_>>();
                self.cache_remote_products(catalog.channel, &products)?;
                self.cache_remote_packs(catalog.channel, &packs)?;
                self.record_update_check(Some(now_string()), None)?;
                Ok((catalog, false, Some(catalog_url), None))
            }
            Err(error) => {
                self.record_update_check(
                    settings
                        .last_update_check_at
                        .map(|value| value.to_rfc3339()),
                    Some(error.to_string()),
                )?;
                let products = self.load_cached_remote_products(settings.update_channel)?;
                let packs = self.load_cached_remote_packs(settings.update_channel)?;
                if products.is_empty() || packs.is_empty() {
                    return Err(error);
                }
                Ok((
                    UpdateCatalog {
                        schema_version: 2,
                        publisher: env!("BRONZEFORGE_UPDATE_PUBLISHER").to_string(),
                        generated_at: settings
                            .last_update_check_at
                            .map(|value| value.to_rfc3339())
                            .unwrap_or_else(now_string),
                        channel: settings.update_channel,
                        products: products
                            .into_iter()
                            .map(|product| (product.id.clone(), product))
                            .collect(),
                        packs: packs
                            .into_iter()
                            .map(|pack| (pack.pack_id.clone(), pack))
                            .collect(),
                    },
                    true,
                    None,
                    Some(match settings.last_update_check_at {
                        Some(checked_at) => {
                            let hours = (Utc::now() - checked_at).num_hours();
                            format!("{error} (catalog last fetched {hours}h ago)")
                        }
                        None => format!("{error} (catalog has never been fetched)"),
                    }),
                ))
            }
        }
    }

    fn resolve_selected_pack(
        &self,
        settings: &Settings,
        catalog: &UpdateCatalog,
    ) -> ServiceResult<Option<RemoteManifestPack>> {
        if let Some(pack_id) = settings.selected_pack_id.as_ref() {
            if let Some(pack) = catalog.packs.get(pack_id) {
                return Ok(Some(pack.clone()));
            }
        }
        Ok(catalog.packs.values().next().cloned())
    }

    fn load_cached_selected_pack(
        &self,
        settings: &Settings,
    ) -> ServiceResult<Option<RemoteManifestPack>> {
        if let Some(pack_id) = settings.selected_pack_id.as_ref() {
            if let Some(pack) = self.load_cached_remote_pack(pack_id, settings.update_channel)? {
                return Ok(Some(pack));
            }
        }
        Ok(self
            .load_cached_remote_packs(settings.update_channel)?
            .into_iter()
            .next())
    }

    fn build_pack_summary(
        &self,
        settings: &Settings,
        pack: &RemoteManifestPack,
        products: &std::collections::BTreeMap<String, RemoteManifestProduct>,
    ) -> ServiceResult<CuratedPackSummary> {
        let channel = update_channel_to_channel(settings.update_channel);
        let mut members = Vec::new();
        for member in &pack.members {
            let product = products.get(&member.product_id).ok_or_else(|| {
                ServiceError::Message(format!(
                    "Pack '{}' is missing product '{}'",
                    pack.pack_id, member.product_id
                ))
            })?;
            let addon = self.load_addon(&member.product_id).ok();
            let current_version = self
                .latest_revision_for_channel(&member.product_id, channel)?
                .map(|revision| revision.version);
            let install_folder = addon
                .as_ref()
                .map(|entry| entry.install_folder.clone())
                .unwrap_or_else(|| product.name.replace(' ', ""));
            let display_name = addon
                .as_ref()
                .map(|entry| entry.display_name.clone())
                .unwrap_or_else(|| product.name.clone());
            let update_available = UpdateProvider::is_remote_newer(
                &product.latest_version,
                current_version.as_deref(),
            );
            members.push(LauncherPackMember {
                addon_id: member.product_id.clone(),
                display_name,
                install_folder,
                required: member.required,
                installed: current_version.is_some(),
                current_version,
                latest_version: Some(product.latest_version.clone()),
                update_available,
            });
        }
        let installed_count = members.iter().filter(|member| member.installed).count();
        Ok(CuratedPackSummary {
            pack_id: pack.pack_id.clone(),
            name: pack.name.clone(),
            description: pack.description.clone(),
            default_channel: pack.default_channel,
            recovery_label: pack.recovery_label.clone(),
            recovery_description: pack.recovery_description.clone(),
            installed_count,
            total_count: members.len(),
            members,
        })
    }

    fn latest_recovery_snapshot_for_profile(
        &self,
        profile_id: &str,
    ) -> ServiceResult<Option<SnapshotSummary>> {
        Ok(self.load_snapshots()?.into_iter().find(|snapshot| {
            snapshot.snapshot_type == SnapshotType::Recovery
                && snapshot.related_profile_id.as_deref() == Some(profile_id)
        }))
    }

    fn latest_recovery_snapshot(&self) -> ServiceResult<Option<SnapshotSummary>> {
        Ok(self
            .load_snapshots()?
            .into_iter()
            .find(|snapshot| snapshot.snapshot_type == SnapshotType::Recovery))
    }

    fn resolve_game_executable_path(&self, settings: &Settings) -> Option<PathBuf> {
        settings
            .game_executable_path
            .as_ref()
            .map(PathBuf::from)
            .filter(|path| path.exists())
            .or_else(|| {
                settings
                    .ascension_root_path
                    .as_ref()
                    .and_then(|root| detect_game_executable(Path::new(root)))
            })
    }

    fn ensure_pack_profile(&mut self, pack: &RemoteManifestPack) -> ServiceResult<String> {
        let profile_id = pack_profile_id(&pack.pack_id);
        let addon_ids = pack
            .members
            .iter()
            .map(|member| member.product_id.clone())
            .collect::<HashSet<_>>();
        let selections = self
            .load_addons()?
            .into_iter()
            .map(|addon| ProfileSelectionInput {
                addon_id: addon.id.clone(),
                enabled: addon_ids.contains(&addon.id),
                channel_override: None,
            })
            .collect::<Vec<_>>();
        self.create_or_update_profile(CreateProfileRequest {
            profile_id: Some(profile_id.clone()),
            name: format!("{} Pack", pack.name),
            notes: Some(pack.description.clone()),
            selections,
        })?;
        Ok(profile_id)
    }

    fn load_settings(&self) -> ServiceResult<Settings> {
        Ok(self.connection.query_row(
            "SELECT ascension_root_path, addons_path, saved_variables_path, backup_retention_count, auto_backup_enabled, default_profile_id, dev_mode_enabled, maintainer_mode_enabled, onboarding_completed, selected_pack_id, game_executable_path, update_channel, last_update_check_at, last_update_error, update_manifest_override FROM settings WHERE id = 1",
            params![],
            |row| {
                Ok(Settings {
                    ascension_root_path: row.get(0)?,
                    addons_path: row.get(1)?,
                    saved_variables_path: row.get(2)?,
                    backup_retention_count: row.get(3)?,
                    auto_backup_enabled: row.get::<_, i64>(4)? != 0,
                    default_profile_id: row.get(5)?,
                    dev_mode_enabled: row.get::<_, i64>(6)? != 0,
                    maintainer_mode_enabled: row.get::<_, i64>(7)? != 0,
                    onboarding_completed: row.get::<_, i64>(8)? != 0,
                    selected_pack_id: row.get(9)?,
                    game_executable_path: row.get(10)?,
                    update_channel: row
                        .get::<_, String>(11)?
                        .parse::<UpdateChannel>()
                        .map_err(string_to_sql_error)?,
                    last_update_check_at: row
                        .get::<_, Option<String>>(12)?
                        .map(|value| parse_timestamp(&value).map_err(string_to_sql_error))
                        .transpose()?,
                    last_update_error: row.get(13)?,
                    update_manifest_override: row.get(14)?,
                })
            },
        )?)
    }

    fn record_update_check(
        &self,
        checked_at: Option<String>,
        error_message: Option<String>,
    ) -> ServiceResult<()> {
        self.connection.execute(
            "UPDATE settings
             SET last_update_check_at = COALESCE(?1, last_update_check_at),
                 last_update_error = ?2,
                 updated_at = ?3
             WHERE id = 1",
            params![checked_at, error_message, now_string()],
        )?;
        Ok(())
    }

    fn cache_remote_products(
        &mut self,
        channel: UpdateChannel,
        products: &[RemoteManifestProduct],
    ) -> ServiceResult<()> {
        self.connection.execute(
            "DELETE FROM remote_products WHERE channel = ?1",
            params![channel.to_string()],
        )?;
        for product in products {
            self.connection.execute(
                "INSERT INTO remote_products (product_id, channel, payload_json, checked_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    &product.id,
                    channel.to_string(),
                    serde_json::to_string(product)?,
                    now_string()
                ],
            )?;
        }
        Ok(())
    }

    fn cache_remote_packs(
        &mut self,
        channel: UpdateChannel,
        packs: &[RemoteManifestPack],
    ) -> ServiceResult<()> {
        self.connection.execute(
            "DELETE FROM remote_packs WHERE channel = ?1",
            params![channel.to_string()],
        )?;
        for pack in packs {
            self.connection.execute(
                "INSERT INTO remote_packs (pack_id, channel, payload_json, checked_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    &pack.pack_id,
                    channel.to_string(),
                    serde_json::to_string(pack)?,
                    now_string()
                ],
            )?;
        }
        Ok(())
    }

    fn load_cached_remote_products(
        &self,
        channel: UpdateChannel,
    ) -> ServiceResult<Vec<RemoteManifestProduct>> {
        let mut statement = self.connection.prepare(
            "SELECT product_id, channel, payload_json
             FROM remote_products
             WHERE channel = ?1
             ORDER BY product_id COLLATE NOCASE",
        )?;
        let rows = statement.query_map(params![channel.to_string()], |row| {
            Ok(RemoteProductCacheRow {
                product_id: row.get(0)?,
                channel: row
                    .get::<_, String>(1)?
                    .parse::<UpdateChannel>()
                    .map_err(string_to_sql_error)?,
                payload_json: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ServiceError::from)?
            .into_iter()
            .map(|row| {
                let product = serde_json::from_str::<RemoteManifestProduct>(&row.payload_json)?;
                if product.id != row.product_id || product.channel != row.channel {
                    return Err(ServiceError::Message(format!(
                        "Cached remote product '{}' is inconsistent",
                        row.product_id
                    )));
                }
                Ok(product)
            })
            .collect()
    }

    fn load_cached_remote_packs(
        &self,
        channel: UpdateChannel,
    ) -> ServiceResult<Vec<RemoteManifestPack>> {
        let mut statement = self.connection.prepare(
            "SELECT pack_id, payload_json
             FROM remote_packs
             WHERE channel = ?1
             ORDER BY pack_id COLLATE NOCASE",
        )?;
        let rows = statement.query_map(params![channel.to_string()], |row| {
            Ok(RemotePackCacheRow {
                pack_id: row.get(0)?,
                payload_json: row.get(1)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ServiceError::from)?
            .into_iter()
            .map(|row| {
                let pack = serde_json::from_str::<RemoteManifestPack>(&row.payload_json)?;
                if pack.pack_id != row.pack_id {
                    return Err(ServiceError::Message(format!(
                        "Cached remote pack '{}' is inconsistent",
                        row.pack_id
                    )));
                }
                Ok(pack)
            })
            .collect()
    }

    fn load_cached_remote_product(
        &self,
        product_id: &str,
        channel: UpdateChannel,
    ) -> ServiceResult<Option<RemoteManifestProduct>> {
        Ok(self
            .load_cached_remote_products(channel)?
            .into_iter()
            .find(|product| product.id == product_id))
    }

    fn load_cached_remote_pack(
        &self,
        pack_id: &str,
        channel: UpdateChannel,
    ) -> ServiceResult<Option<RemoteManifestPack>> {
        Ok(self
            .load_cached_remote_packs(channel)?
            .into_iter()
            .find(|pack| pack.pack_id == pack_id))
    }

    fn to_manager_update_status(
        &self,
        product: &RemoteManifestProduct,
        downloaded_installer_path: Option<String>,
    ) -> ServiceResult<ManagerUpdateStatus> {
        Ok(ManagerUpdateStatus {
            id: product.id.clone(),
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            latest_version: product.latest_version.clone(),
            available: UpdateProvider::is_remote_newer(
                &product.latest_version,
                Some(env!("CARGO_PKG_VERSION")),
            ),
            status: if UpdateProvider::is_remote_newer(
                &product.latest_version,
                Some(env!("CARGO_PKG_VERSION")),
            ) {
                "available".to_string()
            } else {
                "up-to-date".to_string()
            },
            release_url: product.release_url.clone(),
            package_url: product.package_url.clone(),
            changelog: product.changelog.clone(),
            published_at: product.published_at.clone(),
            downloaded_installer_path,
        })
    }

    fn to_remote_addon_update(
        &self,
        settings: &Settings,
        addon: &AddonRow,
        product: &RemoteManifestProduct,
    ) -> ServiceResult<RemoteProductUpdate> {
        let current_version = self
            .latest_revision_for_channel(
                &addon.id,
                update_channel_to_channel(settings.update_channel),
            )?
            .map(|revision| revision.version);
        let min_manager_satisfied =
            UpdateProvider::manager_version_satisfies(product.min_manager_version.as_deref());
        let available = min_manager_satisfied
            && UpdateProvider::is_remote_newer(&product.latest_version, current_version.as_deref());
        let status = if !min_manager_satisfied {
            "requires-manager-update"
        } else if available {
            "available"
        } else {
            "up-to-date"
        };
        Ok(RemoteProductUpdate {
            id: product.id.clone(),
            name: product.name.clone(),
            product_type: product.product_type,
            channel: product.channel,
            current_version,
            latest_version: product.latest_version.clone(),
            available,
            status: status.to_string(),
            published_at: product.published_at.clone(),
            release_url: product.release_url.clone(),
            package_url: product.package_url.clone(),
            sha256: product.sha256.clone(),
            size_bytes: product.size_bytes,
            install_kind: product.install_kind.clone(),
            changelog: product.changelog.clone(),
            min_manager_version: product.min_manager_version.clone(),
        })
    }

    fn load_addons(&self) -> ServiceResult<Vec<AddonRow>> {
        let mut statement = self.connection.prepare("SELECT id, display_name, install_folder, default_channel, notes, dependencies_json, conflicts_json, saved_variables_json, is_core FROM addons ORDER BY display_name COLLATE NOCASE")?;
        let rows = statement.query_map(params![], |row| {
            Ok(AddonRow {
                id: row.get(0)?,
                display_name: row.get(1)?,
                install_folder: row.get(2)?,
                default_channel: row
                    .get::<_, String>(3)?
                    .parse::<Channel>()
                    .map_err(string_to_sql_error)?,
                notes: row.get(4)?,
                dependencies: serde_json::from_str::<Vec<String>>(&row.get::<_, String>(5)?)
                    .map_err(string_to_sql_error)?,
                conflicts: serde_json::from_str::<Vec<String>>(&row.get::<_, String>(6)?)
                    .map_err(string_to_sql_error)?,
                saved_variables: serde_json::from_str::<Vec<String>>(&row.get::<_, String>(7)?)
                    .map_err(string_to_sql_error)?,
                is_core: row.get::<_, i64>(8)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ServiceError::from)
    }

    fn load_addon(&self, addon_id: &str) -> ServiceResult<AddonRow> {
        self.load_addons()?
            .into_iter()
            .find(|addon| addon.id == addon_id)
            .ok_or_else(|| ServiceError::Message(format!("Unknown addon '{addon_id}'")))
    }

    fn load_sources(&self) -> ServiceResult<Vec<SourceRow>> {
        let mut statement = self.connection.prepare(
            "SELECT id, addon_id, source_kind, location, channel_hint, updated_at FROM sources",
        )?;
        let rows = statement.query_map(params![], |row| {
            Ok(SourceRow {
                id: row.get(0)?,
                addon_id: row.get(1)?,
                source_kind: row
                    .get::<_, String>(2)?
                    .parse::<SourceKind>()
                    .map_err(string_to_sql_error)?,
                location: row.get(3)?,
                channel_hint: row
                    .get::<_, Option<String>>(4)?
                    .map(|value| value.parse::<Channel>().map_err(string_to_sql_error))
                    .transpose()?,
                updated_at: parse_timestamp(&row.get::<_, String>(5)?)
                    .map_err(string_to_sql_error)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ServiceError::from)
    }

    fn load_source(&self, source_id: &str) -> ServiceResult<SourceRow> {
        self.load_sources()?
            .into_iter()
            .find(|source| source.id == source_id)
            .ok_or_else(|| ServiceError::Message(format!("Unknown source '{source_id}'")))
    }

    fn load_revisions(&self) -> ServiceResult<Vec<RevisionRow>> {
        let mut statement = self.connection.prepare("SELECT id, addon_id, source_id, channel, version, cache_path, checksum, metadata_json, created_at FROM revisions ORDER BY created_at DESC")?;
        let rows = statement.query_map(params![], |row| {
            Ok(RevisionRow {
                id: row.get(0)?,
                addon_id: row.get(1)?,
                source_id: row.get(2)?,
                channel: row
                    .get::<_, String>(3)?
                    .parse::<Channel>()
                    .map_err(string_to_sql_error)?,
                version: row.get(4)?,
                cache_path: row.get(5)?,
                checksum: row.get(6)?,
                metadata_json: row.get(7)?,
                created_at: parse_timestamp(&row.get::<_, String>(8)?)
                    .map_err(string_to_sql_error)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ServiceError::from)
    }

    fn load_revision(&self, revision_id: &str) -> ServiceResult<RevisionRow> {
        self.load_revisions()?
            .into_iter()
            .find(|revision| revision.id == revision_id)
            .ok_or_else(|| ServiceError::Message(format!("Unknown revision '{revision_id}'")))
    }

    fn latest_revision_for_channel(
        &self,
        addon_id: &str,
        channel: Channel,
    ) -> ServiceResult<Option<RevisionRow>> {
        Ok(self
            .load_revisions()?
            .into_iter()
            .find(|revision| revision.addon_id == addon_id && revision.channel == channel))
    }

    fn load_profiles(&self) -> ServiceResult<Vec<ProfileRow>> {
        let mut statement = self.connection.prepare("SELECT id, name, notes, last_used_at, is_active FROM profiles ORDER BY name COLLATE NOCASE")?;
        let rows = statement.query_map(params![], |row| {
            Ok(ProfileRow {
                id: row.get(0)?,
                name: row.get(1)?,
                notes: row.get(2)?,
                last_used_at: row
                    .get::<_, Option<String>>(3)?
                    .map(|value| parse_timestamp(&value).map_err(string_to_sql_error))
                    .transpose()?,
                is_active: row.get::<_, i64>(4)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ServiceError::from)
    }

    fn load_profile(&self, profile_id: &str) -> ServiceResult<ProfileRow> {
        self.load_profiles()?
            .into_iter()
            .find(|profile| profile.id == profile_id)
            .ok_or_else(|| ServiceError::Message(format!("Unknown profile '{profile_id}'")))
    }

    fn active_profile_id(&self) -> ServiceResult<Option<String>> {
        Ok(self
            .load_profiles()?
            .into_iter()
            .find(|profile| profile.is_active)
            .map(|profile| profile.id))
    }

    fn load_profile_selections(&self, profile_id: &str) -> ServiceResult<Vec<ProfileSelection>> {
        let mut statement = self.connection.prepare(
            "SELECT addon_id, enabled, channel_override FROM profile_addons WHERE profile_id = ?1",
        )?;
        let rows = statement.query_map(params![profile_id], |row| {
            Ok(ProfileSelection {
                addon_id: row.get(0)?,
                enabled: row.get::<_, i64>(1)? != 0,
                channel_override: row
                    .get::<_, Option<String>>(2)?
                    .map(|value| value.parse::<Channel>().map_err(string_to_sql_error))
                    .transpose()?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ServiceError::from)
    }

    fn load_all_profile_selections(&self) -> ServiceResult<HashMap<String, Vec<ProfileSelection>>> {
        let mut all = HashMap::new();
        for profile in self.load_profiles()? {
            all.insert(
                profile.id.clone(),
                self.load_profile_selections(&profile.id)?,
            );
        }
        Ok(all)
    }

    fn load_snapshots(&self) -> ServiceResult<Vec<SnapshotSummary>> {
        let mut statement = self.connection.prepare("SELECT id, created_at, snapshot_type, related_profile_id, notes, pinned, size_bytes, addon_count FROM snapshots ORDER BY created_at DESC")?;
        let rows = statement.query_map(params![], |row| {
            Ok(SnapshotSummary {
                id: row.get(0)?,
                created_at: parse_timestamp(&row.get::<_, String>(1)?)
                    .map_err(string_to_sql_error)?,
                snapshot_type: row
                    .get::<_, String>(2)?
                    .parse::<SnapshotType>()
                    .map_err(string_to_sql_error)?,
                related_profile_id: row.get(3)?,
                notes: row.get(4)?,
                pinned: row.get::<_, i64>(5)? != 0,
                size_bytes: row.get::<_, i64>(6)? as u64,
                addon_count: row.get::<_, i64>(7)? as usize,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ServiceError::from)
    }

    fn load_snapshot_summary(&self, snapshot_id: &str) -> ServiceResult<SnapshotSummary> {
        self.load_snapshots()?
            .into_iter()
            .find(|snapshot| snapshot.id == snapshot_id)
            .ok_or_else(|| ServiceError::Message(format!("Unknown snapshot '{snapshot_id}'")))
    }

    fn load_snapshot_path(&self, snapshot_id: &str) -> ServiceResult<String> {
        self.connection
            .query_row(
                "SELECT backup_path FROM snapshots WHERE id = ?1",
                params![snapshot_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| ServiceError::Message(format!("Unknown snapshot '{snapshot_id}'")))
    }

    fn load_snapshot_items(&self, snapshot_id: &str) -> ServiceResult<Vec<SnapshotItemRow>> {
        let mut statement = self.connection.prepare(
            "SELECT addon_id, relative_path, item_type FROM snapshot_items WHERE snapshot_id = ?1",
        )?;
        let rows = statement.query_map(params![snapshot_id], |row| {
            Ok(SnapshotItemRow {
                addon_id: row.get(0)?,
                relative_path: row.get(1)?,
                item_type: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ServiceError::from)
    }

    fn load_logs(&self) -> ServiceResult<Vec<OperationLogEntry>> {
        let mut statement = self.connection.prepare("SELECT id, operation, status, message, created_at FROM operation_logs ORDER BY created_at DESC LIMIT 25")?;
        let rows = statement.query_map(params![], |row| {
            Ok(OperationLogEntry {
                id: row.get(0)?,
                operation: row.get(1)?,
                status: row.get(2)?,
                message: row.get(3)?,
                created_at: parse_timestamp(&row.get::<_, String>(4)?)
                    .map_err(string_to_sql_error)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ServiceError::from)
    }

    fn load_unfinished_operation(&self) -> ServiceResult<Option<PendingOperationSummary>> {
        self.connection
            .query_row(
                "SELECT id, operation, started_at, snapshot_id FROM unfinished_operations ORDER BY started_at DESC LIMIT 1",
                params![],
                |row| {
                    Ok(PendingOperationSummary {
                        id: row.get(0)?,
                        operation: row.get(1)?,
                        started_at: parse_timestamp(&row.get::<_, String>(2)?).map_err(string_to_sql_error)?,
                        snapshot_id: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(ServiceError::from)
    }

    fn scan_live_addons(&self, addons_root: &Path) -> ServiceResult<Vec<LiveFolderState>> {
        if !addons_root.exists() {
            return Ok(Vec::new());
        }
        let managed = self
            .load_addons()?
            .into_iter()
            .map(|addon| (addon.install_folder.clone(), addon.id))
            .collect::<HashMap<_, _>>();
        let mut folders = Vec::new();
        for entry in fs::read_dir(addons_root)? {
            let entry = entry?;
            if !entry.path().is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let addon_id = managed.get(&name).cloned();
            folders.push(LiveFolderState {
                name,
                managed: addon_id.is_some(),
                addon_id,
                path: entry.path().to_string_lossy().to_string(),
            });
        }
        Ok(folders)
    }

    fn list_unmanaged_in_path(&self, addons_root: &Path) -> ServiceResult<Vec<LiveFolderState>> {
        Ok(self
            .scan_live_addons(addons_root)?
            .into_iter()
            .filter(|folder| !folder.managed)
            .collect())
    }
}

fn to_change_preview(preview: &ProfilePreview) -> ChangePreview {
    ChangePreview {
        profile_id: preview.profile_id.clone(),
        items: preview
            .installs
            .iter()
            .map(|install| ChangePreviewItem {
                addon_id: install.addon.id.clone(),
                display_name: install.addon.display_name.clone(),
                target_folder: install.addon.install_folder.clone(),
                change_type: install.change_type,
                source_version: install.version.clone(),
                channel: Some(install.channel),
            })
            .chain(preview.removals.iter().map(|removal| ChangePreviewItem {
                addon_id: removal.addon.id.clone(),
                display_name: removal.addon.display_name.clone(),
                target_folder: removal.addon.install_folder.clone(),
                change_type: ChangeType::Remove,
                source_version: None,
                channel: None,
            }))
            .collect(),
        saved_variables: preview
            .saved_variables
            .iter()
            .map(|file_name| crate::models::SavedVariableChange {
                file_name: file_name.clone(),
                change_type: ChangeType::Update,
            })
            .collect(),
        blockers: preview.blockers.clone(),
        warnings: preview.warnings.clone(),
    }
}

fn issue(
    code: &str,
    severity: Severity,
    message: &str,
    addon_id: Option<String>,
    folder_name: Option<String>,
) -> ValidationIssue {
    ValidationIssue {
        code: code.to_string(),
        severity,
        message: message.to_string(),
        addon_id,
        folder_name,
    }
}

fn resolve_relative_path(base: &Path, candidate: &str) -> PathBuf {
    let candidate_path = PathBuf::from(candidate);
    if candidate_path.is_absolute() {
        candidate_path
    } else {
        base.parent().unwrap_or(base).join(candidate)
    }
}

fn update_channel_to_channel(channel: UpdateChannel) -> Channel {
    match channel {
        UpdateChannel::Stable => Channel::Stable,
        UpdateChannel::Beta => Channel::Beta,
    }
}

fn sanitize_version(value: &str) -> String {
    format!(
        "-{}",
        value.replace(|character: char| !character.is_ascii_alphanumeric(), "-")
    )
}

fn pack_profile_id(pack_id: &str) -> String {
    format!("pack::{pack_id}")
}

fn apply_selection_override(
    mut selections: Vec<ProfileSelection>,
    addon_id: &str,
    enabled: bool,
    channel_override: Option<Channel>,
) -> Vec<ProfileSelection> {
    if let Some(selection) = selections
        .iter_mut()
        .find(|selection| selection.addon_id == addon_id)
    {
        selection.enabled = enabled;
        selection.channel_override = channel_override;
        return selections;
    }
    selections.push(ProfileSelection {
        addon_id: addon_id.to_string(),
        enabled,
        channel_override,
    });
    selections
}

fn detect_game_executable(root: &Path) -> Option<PathBuf> {
    [
        "Wow.exe",
        "Wow-64.exe",
        "Project Ascension.exe",
        "Ascension.exe",
        "Launcher.exe",
        "Ascension Launcher.exe",
    ]
    .iter()
    .map(|name| root.join(name))
    .find(|path| path.exists())
}

fn detect_path_candidates(roots: &[PathBuf]) -> ServiceResult<Vec<DetectPathCandidate>> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    for root in roots {
        if !root.exists() {
            continue;
        }

        // Check if this root itself is a game folder
        let direct_addons = root.join("Interface").join("AddOns");
        push_detect_candidate(&mut candidates, &mut seen, &direct_addons);

        for addons_path in [
            root.join("Ascension Launcher")
                .join("resources")
                .join("client")
                .join("Interface")
                .join("AddOns"),
        ] {
            push_detect_candidate(&mut candidates, &mut seen, &addons_path);
        }

        let launcher_root = if path_name_eq(root, "Ascension Launcher") {
            root.to_path_buf()
        } else {
            root.join("Ascension Launcher")
        };
        let resources_path = launcher_root.join("resources");

        if resources_path.exists() {
            for addons_path in find_launcher_addon_dirs(&resources_path)? {
                push_detect_candidate(&mut candidates, &mut seen, &addons_path);
            }
        }
    }

    Ok(candidates)
}

fn find_launcher_addon_dirs(resources_path: &Path) -> ServiceResult<Vec<PathBuf>> {
    let mut addon_dirs = Vec::new();

    for entry in WalkDir::new(resources_path).min_depth(3).max_depth(3) {
        let entry = entry?;
        if !entry.file_type().is_dir() {
            continue;
        }

        let path = entry.path();
        if !path_name_eq(path, "AddOns") {
            continue;
        }

        let Some(parent) = path.parent() else {
            continue;
        };
        if !path_name_eq(parent, "Interface") {
            continue;
        }

        addon_dirs.push(path.to_path_buf());
    }

    Ok(addon_dirs)
}

fn push_detect_candidate(
    candidates: &mut Vec<DetectPathCandidate>,
    seen: &mut HashSet<String>,
    addons_path: &Path,
) {
    if !addons_path.exists() {
        return;
    }

    let key = addons_path.to_string_lossy().to_string();
    if !seen.insert(key) {
        return;
    }

    let ascension_root = addons_path
        .parent()
        .and_then(Path::parent)
        .unwrap_or(addons_path)
        .to_path_buf();
    let saved_variables = ascension_root
        .join("WTF")
        .join("Account")
        .join("SavedVariables");

    candidates.push(DetectPathCandidate {
        label: ascension_root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Detected install")
            .to_string(),
        confidence: if saved_variables.exists() {
            "high".to_string()
        } else {
            "medium".to_string()
        },
        ascension_root_path: ascension_root.to_string_lossy().to_string(),
        addons_path: addons_path.to_string_lossy().to_string(),
        saved_variables_path: saved_variables.to_string_lossy().to_string(),
    });
}

fn path_name_eq(path: &Path, expected: &str) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

fn normalize_display_path(value: String) -> String {
    value.trim().trim_matches('"').to_string()
}

fn now_string() -> String {
    Utc::now().to_rfc3339()
}

fn parse_timestamp(value: &str) -> ServiceResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&Utc))
        .map_err(|error| ServiceError::Message(error.to_string()))
}

fn string_to_sql_error(error: impl ToString) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            error.to_string(),
        )),
    )
}

fn compute_checksum(path: &Path) -> ServiceResult<String> {
    let mut hasher = Sha256::new();
    for entry in WalkDir::new(path).sort_by_file_name() {
        let entry = entry?;
        if entry.path().is_file() {
            let relative = entry
                .path()
                .strip_prefix(path)
                .map_err(|error| ServiceError::Message(error.to_string()))?;
            hasher.update(relative.to_string_lossy().as_bytes());
            let mut file = fs::File::open(entry.path())?;
            let mut buffer = [0_u8; 8192];
            loop {
                let read = file.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn copy_dir_all(source: &Path, destination: &Path) -> ServiceResult<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn ensure_addons_path_writable(addons_path: &str) -> ServiceResult<()> {
    match probe_addons_writable(addons_path) {
        Ok(()) => return Ok(()),
        Err(first_error) => {
            if !is_windows_protected_install_path(Path::new(addons_path)) {
                return Err(first_error);
            }
            // The path is under Program Files — attempt a one-time elevated
            // permission grant so future operations work without admin rights.
            if let Err(fix_error) = elevate_addons_permissions(addons_path) {
                // If the user declined UAC or it failed, report the original error
                // with context about the fix attempt.
                return Err(ServiceError::Message(format!(
                    "Cannot write to AddOns folder at '{}': permission denied. \
                     An automatic permission fix was attempted but failed ({}). \
                     To fix manually, run an elevated terminal and execute: \
                     icacls \"{}\" /grant *S-1-5-32-545:(OI)(CI)M /T",
                    addons_path, fix_error, addons_path
                )));
            }
            // Retry after the elevated fix.
            probe_addons_writable(addons_path)
        }
    }
}

fn probe_addons_writable(addons_path: &str) -> ServiceResult<()> {
    let addons_root = Path::new(addons_path);
    fs::create_dir_all(addons_root)
        .map_err(|error| map_addons_path_error(addons_path, "create", error))?;

    let probe_path = addons_root.join(format!(".bronze-forge-write-test-{}", Uuid::new_v4()));
    fs::write(&probe_path, b"probe")
        .map_err(|error| map_addons_path_error(addons_path, "write to", error))?;

    match fs::remove_file(&probe_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ServiceError::Io(error)),
    }
}

/// Spawn an elevated process that grants the Users group modify access to the
/// AddOns directory tree. On Windows this uses `ShellExecuteW` with the "runas"
/// verb, which triggers a single UAC consent prompt. On non-Windows this is a
/// no-op (Program Files paths don't exist there).
fn elevate_addons_permissions(addons_path: &str) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = addons_path;
        return Err("elevated permission fix is only available on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        fn to_wide(s: &str) -> Vec<u16> {
            OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
        }

        // Grant the built-in Users group (S-1-5-32-545) Modify access,
        // inheritable to child objects, recursively.
        let params = format!(
            "/c icacls \"{}\" /grant *S-1-5-32-545:(OI)(CI)M /T",
            addons_path
        );

        let verb = to_wide("runas");
        let file = to_wide("cmd.exe");
        let parameters = to_wide(&params);

        // SAFETY: calling ShellExecuteW with valid wide-string pointers and a
        // null hwnd; the OS handles the UAC prompt.
        let result = unsafe {
            winapi_shell_execute(
                std::ptr::null_mut(),
                verb.as_ptr(),
                file.as_ptr(),
                parameters.as_ptr(),
                std::ptr::null(),
                0, // SW_HIDE
            )
        };
        // ShellExecuteW returns an HINSTANCE > 32 on success.
        if (result as usize) <= 32 {
            return Err(format!("ShellExecuteW returned {}", result as usize));
        }
        // Give the elevated process time to complete.
        std::thread::sleep(Duration::from_secs(3));
        Ok(())
    }
}

#[cfg(target_os = "windows")]
unsafe fn winapi_shell_execute(
    hwnd: *mut std::ffi::c_void,
    verb: *const u16,
    file: *const u16,
    parameters: *const u16,
    directory: *const u16,
    show_cmd: i32,
) -> *mut std::ffi::c_void {
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut std::ffi::c_void,
            lpOperation: *const u16,
            lpFile: *const u16,
            lpParameters: *const u16,
            lpDirectory: *const u16,
            nShowCmd: i32,
        ) -> *mut std::ffi::c_void;
    }
    unsafe { ShellExecuteW(hwnd, verb, file, parameters, directory, show_cmd) }
}

fn map_addons_path_error(
    addons_path: &str,
    action: &str,
    error: std::io::Error,
) -> ServiceError {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        return ServiceError::Message(addons_permission_denied_message(addons_path, action));
    }

    ServiceError::Message(format!(
        "Could not {} AddOns folder at '{}': {}",
        action, addons_path, error
    ))
}

fn addons_permission_denied_message(addons_path: &str, action: &str) -> String {
    format!(
        "Cannot {} AddOns folder at '{}': permission denied. \
         Close the game and launcher, then try again.",
        action, addons_path
    )
}

fn is_windows_protected_install_path(path: &Path) -> bool {
    let candidate = normalize_windows_path_for_comparison(path);
    windows_protected_roots().into_iter().any(|root| {
        let root = normalize_windows_path_for_comparison(&root);
        candidate == root || candidate.starts_with(&(root + "\\"))
    })
}

fn windows_protected_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(value) = std::env::var_os(key) {
            roots.push(PathBuf::from(value));
        }
    }
    if roots.is_empty() {
        roots.push(PathBuf::from(r"C:\Program Files"));
        roots.push(PathBuf::from(r"C:\Program Files (x86)"));
    }
    roots
}

fn normalize_windows_path_for_comparison(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

/// Move a directory, falling back to copy+delete when rename fails
/// (e.g. across volumes or NTFS security boundaries like Program Files).
fn move_dir(source: &Path, destination: &Path) -> ServiceResult<()> {
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(e)
            if e.raw_os_error() == Some(17) // Windows ERROR_NOT_SAME_DEVICE / Linux EXDEV
                || e.raw_os_error() == Some(18) // macOS EXDEV
                || e.kind() == std::io::ErrorKind::PermissionDenied =>
        {
            copy_dir_all(source, destination)?;
            fs::remove_dir_all(source)?;
            Ok(())
        }
        Err(e) => Err(ServiceError::Io(e)),
    }
}

fn dir_size(path: &Path) -> ServiceResult<u64> {
    let mut total = 0;
    for entry in WalkDir::new(path) {
        let entry = entry?;
        if entry.path().is_file() {
            total += entry.metadata()?.len();
        }
    }
    Ok(total)
}

fn zip_directory(
    writer: &mut ZipWriter<fs::File>,
    current: &Path,
    root: &Path,
    options: SimpleFileOptions,
) -> ServiceResult<()> {
    for entry in WalkDir::new(current).min_depth(1) {
        let entry = entry?;
        let path = entry.path();
        let name = path
            .strip_prefix(root)
            .map_err(|error| ServiceError::Message(error.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        if path.is_dir() {
            writer.add_directory(name, options)?;
        } else {
            writer.start_file(name, options)?;
            let mut file = fs::File::open(path)?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)?;
            writer.write_all(&buffer)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ManagerService, detect_path_candidates, is_windows_protected_install_path,
    };
    use crate::models::{
        Channel, CreateProfileRequest, InstallAddonRequest, ProfileSelectionInput,
        RegisterSourceRequest, SaveSettingsRequest, SourceKind, SyncProfileRequest,
    };
    use std::{fs, path::Path};

    fn make_addon(base: &Path, folder: &str, title: &str, version: &str) -> std::path::PathBuf {
        let addon_root = base.join(folder);
        fs::create_dir_all(&addon_root).unwrap();
        fs::write(
            addon_root.join(format!("{folder}.toc")),
            format!("## Title: {title}\n## Version: {version}\n"),
        )
        .unwrap();
        addon_root
    }

    #[test]
    fn register_source_creates_default_profile_membership() {
        let temp = tempfile::tempdir().unwrap();
        let addon_root = make_addon(temp.path(), "BronzeForgeUI", "BronzeForge UI", "1.0.0");
        let mut service = ManagerService::for_test(temp.path().join("app")).unwrap();
        service
            .save_settings(SaveSettingsRequest {
                ascension_root_path: None,
                addons_path: Some(temp.path().join("live").to_string_lossy().to_string()),
                saved_variables_path: Some(
                    temp.path()
                        .join("WTF")
                        .join("Account")
                        .join("SavedVariables")
                        .to_string_lossy()
                        .to_string(),
                ),
                backup_retention_count: None,
                auto_backup_enabled: None,
                default_profile_id: None,
                dev_mode_enabled: None,
                maintainer_mode_enabled: None,
                onboarding_completed: None,
                selected_pack_id: None,
                game_executable_path: None,
                update_channel: None,
                update_manifest_override: None,
            })
            .unwrap();
        service
            .register_source(RegisterSourceRequest {
                source_kind: SourceKind::LocalFolder,
                path: addon_root.to_string_lossy().to_string(),
                channel: Some(Channel::Stable),
                core: Some(true),
            })
            .unwrap();
        let state = service.scan_live_state().unwrap();
        assert_eq!(state.addons.len(), 1);
        assert!(state.profiles.iter().any(|profile| {
            profile.is_active
                && profile
                    .selections
                    .iter()
                    .any(|selection| selection.addon_id == state.addons[0].id && selection.enabled)
        }));
    }

    #[test]
    fn preview_sync_flags_missing_dependency() {
        let temp = tempfile::tempdir().unwrap();
        let addon_root = make_addon(temp.path(), "BronzeForgeUI", "BronzeForge UI", "1.0.0");
        fs::write(addon_root.join("bronzeforge.addon.json"), r#"{"schemaVersion":1,"addonId":"bronze-ui","displayName":"BronzeForge UI","installFolder":"BronzeForgeUI","version":"1.0.0","dependencies":["missing-addon"]}"#).unwrap();
        let mut service = ManagerService::for_test(temp.path().join("app")).unwrap();
        service
            .save_settings(SaveSettingsRequest {
                ascension_root_path: None,
                addons_path: Some(temp.path().join("live").to_string_lossy().to_string()),
                saved_variables_path: Some(
                    temp.path()
                        .join("WTF")
                        .join("Account")
                        .join("SavedVariables")
                        .to_string_lossy()
                        .to_string(),
                ),
                backup_retention_count: None,
                auto_backup_enabled: None,
                default_profile_id: None,
                dev_mode_enabled: None,
                maintainer_mode_enabled: None,
                onboarding_completed: None,
                selected_pack_id: None,
                game_executable_path: None,
                update_channel: None,
                update_manifest_override: None,
            })
            .unwrap();
        service
            .register_source(RegisterSourceRequest {
                source_kind: SourceKind::LocalFolder,
                path: addon_root.to_string_lossy().to_string(),
                channel: Some(Channel::Stable),
                core: Some(true),
            })
            .unwrap();
        let active_profile_id = service
            .scan_live_state()
            .unwrap()
            .active_profile_id
            .unwrap();
        let preview = service
            .sync_profile(SyncProfileRequest {
                profile_id: active_profile_id,
                preview_only: Some(true),
                safe_mode: Some(false),
                isolate_addon_id: None,
            })
            .unwrap();
        assert!(!preview.ok);
        assert!(
            preview
                .preview
                .blockers
                .iter()
                .any(|issue| issue.code == "missing_dependency")
        );
    }

    #[test]
    fn preview_only_install_does_not_mutate_profile_selection() {
        let temp = tempfile::tempdir().unwrap();
        let addon_root = make_addon(temp.path(), "BronzeForgeUI", "BronzeForge UI", "1.0.0");
        let mut service = ManagerService::for_test(temp.path().join("app")).unwrap();
        service
            .save_settings(SaveSettingsRequest {
                ascension_root_path: None,
                addons_path: Some(temp.path().join("live").to_string_lossy().to_string()),
                saved_variables_path: Some(
                    temp.path()
                        .join("WTF")
                        .join("Account")
                        .join("SavedVariables")
                        .to_string_lossy()
                        .to_string(),
                ),
                backup_retention_count: None,
                auto_backup_enabled: None,
                default_profile_id: None,
                dev_mode_enabled: None,
                maintainer_mode_enabled: None,
                onboarding_completed: None,
                selected_pack_id: None,
                game_executable_path: None,
                update_channel: None,
                update_manifest_override: None,
            })
            .unwrap();
        service
            .register_source(RegisterSourceRequest {
                source_kind: SourceKind::LocalFolder,
                path: addon_root.to_string_lossy().to_string(),
                channel: Some(Channel::Stable),
                core: Some(true),
            })
            .unwrap();

        let addon_id = service.scan_live_state().unwrap().addons[0].id.clone();
        let profile_id = "preview-profile".to_string();
        service
            .create_or_update_profile(CreateProfileRequest {
                profile_id: Some(profile_id.clone()),
                name: "Preview Profile".to_string(),
                notes: None,
                selections: vec![ProfileSelectionInput {
                    addon_id: addon_id.clone(),
                    enabled: false,
                    channel_override: None,
                }],
            })
            .unwrap();

        service
            .install_addon(InstallAddonRequest {
                addon_id: addon_id.clone(),
                profile_id: Some(profile_id.clone()),
                preview_only: Some(true),
            })
            .unwrap();

        let state = service.scan_live_state().unwrap();
        let profile = state
            .profiles
            .into_iter()
            .find(|entry| entry.id == profile_id)
            .unwrap();
        let selection = profile
            .selections
            .into_iter()
            .find(|entry| entry.addon_id == addon_id)
            .unwrap();
        assert!(!selection.enabled);
    }

    #[test]
    fn detect_paths_finds_launcher_resource_clients() {
        let temp = tempfile::tempdir().unwrap();
        let launcher = temp
            .path()
            .join("Program Files")
            .join("Ascension Launcher")
            .join("resources");

        for client in ["client", "epoch_live"] {
            let root = launcher.join(client);
            fs::create_dir_all(root.join("Interface").join("AddOns")).unwrap();
            fs::create_dir_all(root.join("WTF").join("Account").join("SavedVariables")).unwrap();
        }

        let candidates = detect_path_candidates(&[temp.path().join("Program Files")]).unwrap();

        assert_eq!(candidates.len(), 2);
        assert!(candidates.iter().any(|candidate| {
            candidate.label == "client"
                && candidate.addons_path.ends_with("client\\Interface\\AddOns")
        }));
        assert!(candidates.iter().any(|candidate| {
            candidate.label == "epoch_live"
                && candidate.confidence == "high"
                && candidate
                    .saved_variables_path
                    .ends_with("epoch_live\\WTF\\Account\\SavedVariables")
        }));
    }

    #[test]
    fn protected_addons_paths_get_admin_guidance() {
        let path = Path::new(r"C:\Program Files\Ascension Launcher\resources\client\Interface\AddOns");

        assert!(is_windows_protected_install_path(path));
    }

    // --- Pure helper unit tests ---

    #[test]
    fn sanitize_version_replaces_non_alphanumeric_with_dashes() {
        use super::sanitize_version;
        assert_eq!(sanitize_version("1.2.3"), "-1-2-3");
        assert_eq!(sanitize_version("1.0.0-beta"), "-1-0-0-beta");
        assert_eq!(sanitize_version("abc123"), "-abc123");
        assert_eq!(sanitize_version(""), "-");
    }

    #[test]
    fn pack_profile_id_prefixes_with_pack_namespace() {
        use super::pack_profile_id;
        assert_eq!(pack_profile_id("bronzebeard"), "pack::bronzebeard");
        assert_eq!(pack_profile_id(""), "pack::");
    }

    #[test]
    fn normalize_display_path_trims_whitespace_and_quotes() {
        use super::normalize_display_path;
        assert_eq!(normalize_display_path("  C:/Game  ".to_string()), "C:/Game");
        assert_eq!(
            normalize_display_path(r#""C:\Program Files\Game""#.to_string()),
            r"C:\Program Files\Game"
        );
        assert_eq!(
            normalize_display_path("C:/Game".to_string()),
            "C:/Game"
        );
    }

    #[test]
    fn apply_selection_override_updates_existing_selection() {
        use super::apply_selection_override;
        use crate::models::ProfileSelection;
        let selections = vec![ProfileSelection {
            addon_id: "addon-a".to_string(),
            enabled: false,
            channel_override: None,
        }];
        let result = apply_selection_override(selections, "addon-a", true, None);
        assert_eq!(result.len(), 1);
        assert!(result[0].enabled);
    }

    #[test]
    fn apply_selection_override_appends_when_addon_not_present() {
        use super::apply_selection_override;
        use crate::models::ProfileSelection;
        let selections = vec![ProfileSelection {
            addon_id: "addon-a".to_string(),
            enabled: true,
            channel_override: None,
        }];
        let result = apply_selection_override(selections, "addon-b", false, None);
        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|s| s.addon_id == "addon-b" && !s.enabled));
    }
}

mod manifest;
mod models;
mod service;
mod update_provider;

use std::sync::{Arc, Mutex};

use models::{
    ApplyRemoteAddonUpdateRequest, ChangeChannelRequest, CreateProfileRequest, DetectPathsResponse,
    DuplicateProfileRequest, ImportZipRequest, InstallAddonRequest, InstallManagerUpdateRequest,
    LauncherStateResponse, ManagerUpdateStatus, OperationResponse, PackageRevisionRequest,
    PromoteRevisionRequest, RefreshSourceRequest, RegisterSourceRequest,
    RestoreLastKnownGoodRequest, RestoreSnapshotRequest, RunInitialSetupRequest,
    SaveSettingsRequest, ScanStateResponse, SetMaintainerModeRequest, SnapshotSummary,
    SwitchProfileRequest, SyncProfileRequest, UpdateCheckResponse,
};
use service::ManagerService;
use tauri::{Manager, State};

struct AppState {
    service: Arc<Mutex<ManagerService>>,
}

impl AppState {
    fn with_service<T, F>(&self, action: F) -> Result<T, String>
    where
        F: FnOnce(&mut ManagerService) -> service::ServiceResult<T>,
    {
        let mut guard = self
            .service
            .lock()
            .map_err(|_| "BronzeForge manager state is poisoned".to_string())?;
        action(&mut guard).map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn detect_paths(state: State<'_, AppState>) -> Result<DetectPathsResponse, String> {
    state.with_service(|service| service.detect_paths())
}

#[tauri::command]
fn save_settings(
    state: State<'_, AppState>,
    request: SaveSettingsRequest,
) -> Result<ScanStateResponse, String> {
    state.with_service(|service| service.save_settings(request))
}

#[tauri::command]
fn get_launcher_state(state: State<'_, AppState>) -> Result<LauncherStateResponse, String> {
    state.with_service(|service| service.get_launcher_state())
}

#[tauri::command]
fn run_initial_setup(
    state: State<'_, AppState>,
    request: RunInitialSetupRequest,
) -> Result<LauncherStateResponse, String> {
    state.with_service(|service| service.run_initial_setup(request))
}

#[tauri::command]
fn sync_curated_pack(state: State<'_, AppState>) -> Result<LauncherStateResponse, String> {
    state.with_service(|service| service.sync_curated_pack())
}

#[tauri::command]
fn restore_last_known_good(
    state: State<'_, AppState>,
    request: RestoreLastKnownGoodRequest,
) -> Result<OperationResponse, String> {
    state.with_service(|service| service.restore_last_known_good(request))
}

#[tauri::command]
fn launch_game(state: State<'_, AppState>) -> Result<String, String> {
    state.with_service(|service| service.launch_game())
}

#[tauri::command]
fn open_addons_folder(state: State<'_, AppState>) -> Result<String, String> {
    state.with_service(|service| service.open_addons_folder())
}

#[tauri::command]
fn set_maintainer_mode(
    state: State<'_, AppState>,
    request: SetMaintainerModeRequest,
) -> Result<LauncherStateResponse, String> {
    state.with_service(|service| service.set_maintainer_mode(request))
}

#[tauri::command]
fn scan_live_state(state: State<'_, AppState>) -> Result<ScanStateResponse, String> {
    state.with_service(|service| service.scan_live_state())
}

#[tauri::command]
fn register_source(
    state: State<'_, AppState>,
    request: RegisterSourceRequest,
) -> Result<ScanStateResponse, String> {
    state.with_service(|service| service.register_source(request))
}

#[tauri::command]
fn refresh_source(
    state: State<'_, AppState>,
    request: RefreshSourceRequest,
) -> Result<ScanStateResponse, String> {
    state.with_service(|service| service.refresh_source(request))
}

#[tauri::command]
fn import_zip(
    state: State<'_, AppState>,
    request: ImportZipRequest,
) -> Result<ScanStateResponse, String> {
    state.with_service(|service| service.import_zip(request))
}

#[tauri::command]
fn create_profile(
    state: State<'_, AppState>,
    request: CreateProfileRequest,
) -> Result<ScanStateResponse, String> {
    state.with_service(|service| service.create_or_update_profile(request))
}

#[tauri::command]
fn duplicate_profile(
    state: State<'_, AppState>,
    request: DuplicateProfileRequest,
) -> Result<ScanStateResponse, String> {
    state.with_service(|service| service.duplicate_profile(request))
}

#[tauri::command]
fn switch_profile(
    state: State<'_, AppState>,
    request: SwitchProfileRequest,
) -> Result<ScanStateResponse, String> {
    state.with_service(|service| service.switch_profile(request))
}

#[tauri::command]
fn sync_profile(
    state: State<'_, AppState>,
    request: SyncProfileRequest,
) -> Result<OperationResponse, String> {
    state.with_service(|service| service.sync_profile(request))
}

#[tauri::command]
fn install_addon(
    state: State<'_, AppState>,
    request: InstallAddonRequest,
) -> Result<OperationResponse, String> {
    state.with_service(|service| service.install_addon(request))
}

#[tauri::command]
fn update_addon(
    state: State<'_, AppState>,
    request: InstallAddonRequest,
) -> Result<OperationResponse, String> {
    state.with_service(|service| service.update_addon(request))
}

#[tauri::command]
fn change_channel(
    state: State<'_, AppState>,
    request: ChangeChannelRequest,
) -> Result<OperationResponse, String> {
    state.with_service(|service| service.change_channel(request))
}

#[tauri::command]
fn uninstall_addon(
    state: State<'_, AppState>,
    request: InstallAddonRequest,
) -> Result<OperationResponse, String> {
    state.with_service(|service| service.uninstall_addon(request))
}

#[tauri::command]
fn list_snapshots(state: State<'_, AppState>) -> Result<Vec<SnapshotSummary>, String> {
    state.with_service(|service| service.list_snapshots())
}

#[tauri::command]
fn restore_snapshot(
    state: State<'_, AppState>,
    request: RestoreSnapshotRequest,
) -> Result<OperationResponse, String> {
    state.with_service(|service| service.restore_snapshot(request))
}

#[tauri::command]
fn package_revision(
    state: State<'_, AppState>,
    request: PackageRevisionRequest,
) -> Result<String, String> {
    state.with_service(|service| service.package_revision(request))
}

#[tauri::command]
fn promote_revision(
    state: State<'_, AppState>,
    request: PromoteRevisionRequest,
) -> Result<ScanStateResponse, String> {
    state.with_service(|service| service.promote_revision(request))
}

#[tauri::command]
fn list_unmanaged(state: State<'_, AppState>) -> Result<Vec<models::LiveFolderState>, String> {
    state.with_service(|service| service.list_unmanaged())
}

#[tauri::command]
fn check_updates(state: State<'_, AppState>) -> Result<UpdateCheckResponse, String> {
    state.with_service(|service| service.check_updates())
}

#[tauri::command]
fn apply_remote_addon_update(
    state: State<'_, AppState>,
    request: ApplyRemoteAddonUpdateRequest,
) -> Result<OperationResponse, String> {
    state.with_service(|service| service.apply_remote_addon_update(request))
}

#[tauri::command]
fn install_manager_update(
    state: State<'_, AppState>,
    request: InstallManagerUpdateRequest,
) -> Result<ManagerUpdateStatus, String> {
    state.with_service(|service| service.install_manager_update(request))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let service = ManagerService::new(app.handle())?;
            app.manage(AppState {
                service: Arc::new(Mutex::new(service)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_paths,
            save_settings,
            get_launcher_state,
            run_initial_setup,
            sync_curated_pack,
            restore_last_known_good,
            launch_game,
            open_addons_folder,
            set_maintainer_mode,
            scan_live_state,
            register_source,
            refresh_source,
            import_zip,
            create_profile,
            duplicate_profile,
            switch_profile,
            sync_profile,
            install_addon,
            update_addon,
            change_channel,
            uninstall_addon,
            list_snapshots,
            restore_snapshot,
            package_revision,
            promote_revision,
            list_unmanaged,
            check_updates,
            apply_remote_addon_update,
            install_manager_update
        ])
        .run(tauri::generate_context!())
        .expect("failed to run BronzeForge Manager");
}

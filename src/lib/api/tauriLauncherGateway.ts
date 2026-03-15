import { invoke } from '@tauri-apps/api/core'

import type { LauncherGateway } from './launcherGateway'
import type {
  CreateProfileRequest,
  DetectPathsResponse,
  LauncherStateResponse,
  OperationResponse,
  RegisterSourceRequest,
  RestoreLastKnownGoodRequest,
  RunInitialSetupRequest,
  SaveSettingsRequest,
  ScanStateResponse,
  SetMaintainerModeRequest,
  SnapshotSummary,
  UpdateCheckResponse,
} from '../../types'

export class TauriLauncherGateway implements LauncherGateway {
  detectPaths(): Promise<DetectPathsResponse> {
    return invoke('detect_paths')
  }

  getLauncherState(): Promise<LauncherStateResponse> {
    return invoke('get_launcher_state')
  }

  runInitialSetup(request: RunInitialSetupRequest): Promise<LauncherStateResponse> {
    return invoke('run_initial_setup', { request })
  }

  syncCuratedPack(): Promise<LauncherStateResponse> {
    return invoke('sync_curated_pack')
  }

  restoreLastKnownGood(request: RestoreLastKnownGoodRequest = {}): Promise<OperationResponse> {
    return invoke('restore_last_known_good', { request })
  }

  launchGame(): Promise<string> {
    return invoke('launch_game')
  }

  openAddonsFolder(): Promise<string> {
    return invoke('open_addons_folder')
  }

  setMaintainerMode(request: SetMaintainerModeRequest): Promise<LauncherStateResponse> {
    return invoke('set_maintainer_mode', { request })
  }

  saveSettings(request: SaveSettingsRequest): Promise<ScanStateResponse> {
    return invoke('save_settings', { request })
  }

  scanLiveState(): Promise<ScanStateResponse> {
    return invoke('scan_live_state')
  }

  registerSource(request: RegisterSourceRequest): Promise<ScanStateResponse> {
    return invoke('register_source', { request })
  }

  createProfile(request: CreateProfileRequest): Promise<ScanStateResponse> {
    return invoke('create_profile', { request })
  }

  duplicateProfile(request: { profileId: string }): Promise<ScanStateResponse> {
    return invoke('duplicate_profile', { request })
  }

  switchProfile(request: { profileId: string }): Promise<ScanStateResponse> {
    return invoke('switch_profile', { request })
  }

  listSnapshots(): Promise<SnapshotSummary[]> {
    return invoke('list_snapshots')
  }

  checkUpdates(): Promise<UpdateCheckResponse> {
    return invoke('check_updates')
  }
}

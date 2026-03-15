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

// Tauri rejects invoke() with a raw string from Rust. Normalise to Error so
// callers can rely on instanceof Error checks throughout the app.
async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (caught) {
    const message = typeof caught === 'string' ? caught : caught instanceof Error ? caught.message : String(caught)
    throw new Error(message)
  }
}

export class TauriLauncherGateway implements LauncherGateway {
  detectPaths(): Promise<DetectPathsResponse> {
    return tauriInvoke('detect_paths')
  }

  getLauncherState(): Promise<LauncherStateResponse> {
    return tauriInvoke('get_launcher_state')
  }

  runInitialSetup(request: RunInitialSetupRequest): Promise<LauncherStateResponse> {
    return tauriInvoke('run_initial_setup', { request })
  }

  syncCuratedPack(): Promise<LauncherStateResponse> {
    return tauriInvoke('sync_curated_pack')
  }

  restoreLastKnownGood(request: RestoreLastKnownGoodRequest = {}): Promise<OperationResponse> {
    return tauriInvoke('restore_last_known_good', { request })
  }

  launchGame(): Promise<string> {
    return tauriInvoke('launch_game')
  }

  openAddonsFolder(): Promise<string> {
    return tauriInvoke('open_addons_folder')
  }

  setMaintainerMode(request: SetMaintainerModeRequest): Promise<LauncherStateResponse> {
    return tauriInvoke('set_maintainer_mode', { request })
  }

  saveSettings(request: SaveSettingsRequest): Promise<ScanStateResponse> {
    return tauriInvoke('save_settings', { request })
  }

  scanLiveState(): Promise<ScanStateResponse> {
    return tauriInvoke('scan_live_state')
  }

  registerSource(request: RegisterSourceRequest): Promise<ScanStateResponse> {
    return tauriInvoke('register_source', { request })
  }

  createProfile(request: CreateProfileRequest): Promise<ScanStateResponse> {
    return tauriInvoke('create_profile', { request })
  }

  duplicateProfile(request: { profileId: string }): Promise<ScanStateResponse> {
    return tauriInvoke('duplicate_profile', { request })
  }

  switchProfile(request: { profileId: string }): Promise<ScanStateResponse> {
    return tauriInvoke('switch_profile', { request })
  }

  listSnapshots(): Promise<SnapshotSummary[]> {
    return tauriInvoke('list_snapshots')
  }

  checkUpdates(): Promise<UpdateCheckResponse> {
    return tauriInvoke('check_updates')
  }
}

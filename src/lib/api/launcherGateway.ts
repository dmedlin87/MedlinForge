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

export interface LauncherGateway {
  detectPaths(): Promise<DetectPathsResponse>
  getLauncherState(): Promise<LauncherStateResponse>
  runInitialSetup(request: RunInitialSetupRequest): Promise<LauncherStateResponse>
  syncCuratedPack(): Promise<LauncherStateResponse>
  restoreLastKnownGood(request?: RestoreLastKnownGoodRequest): Promise<OperationResponse>
  launchGame(): Promise<string>
  openAddonsFolder(): Promise<string>
  setMaintainerMode(request: SetMaintainerModeRequest): Promise<LauncherStateResponse>
  saveSettings(request: SaveSettingsRequest): Promise<ScanStateResponse>
  scanLiveState(): Promise<ScanStateResponse>
  registerSource(request: RegisterSourceRequest): Promise<ScanStateResponse>
  createProfile(request: CreateProfileRequest): Promise<ScanStateResponse>
  duplicateProfile(request: { profileId: string }): Promise<ScanStateResponse>
  switchProfile(request: { profileId: string }): Promise<ScanStateResponse>
  listSnapshots(): Promise<SnapshotSummary[]>
  checkUpdates(): Promise<UpdateCheckResponse>
}

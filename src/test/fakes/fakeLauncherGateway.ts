import type { LauncherGateway } from '../../lib/api/launcherGateway'
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
  Settings,
  SnapshotSummary,
  UpdateCheckResponse,
} from '../../types'

function makeDefaultSettings(): Settings {
  return {
    ascensionRootPath: 'C:\\Games\\Ascension',
    addonsPath: 'C:\\Games\\Ascension\\Interface\\AddOns',
    savedVariablesPath: 'C:\\Games\\Ascension\\WTF\\Account\\SavedVariables',
    backupRetentionCount: 5,
    autoBackupEnabled: true,
    defaultProfileId: null,
    devModeEnabled: false,
    maintainerModeEnabled: false,
    onboardingCompleted: true,
    selectedPackId: 'bronzeforge-default',
    gameExecutablePath: null,
    updateChannel: 'stable',
    lastUpdateCheckAt: null,
    lastUpdateError: null,
    updateManifestOverride: null,
  }
}

function makeDefaultLauncherState(): LauncherStateResponse {
  return {
    settings: makeDefaultSettings(),
    setupStatus: 'ready',
    packStatus: 'up_to_date',
    actionState: 'idle',
    pack: null,
    pathHealth: {
      configured: true,
      ascensionRootPath: 'C:\\Games\\Ascension',
      addonsPath: 'C:\\Games\\Ascension\\Interface\\AddOns',
      savedVariablesPath: 'C:\\Games\\Ascension\\WTF\\Account\\SavedVariables',
      gameExecutablePath: null,
      detectedCandidates: [],
    },
    updatesAvailable: 0,
    lastSuccessfulSyncAt: null,
    lastKnownGoodSnapshot: null,
    recoverySnapshots: [],
    unmanagedCollisions: [],
    interruptedOperation: null,
    errorMessage: null,
  }
}

function makeDefaultScanState(): ScanStateResponse {
  return {
    settings: makeDefaultSettings(),
    addons: [],
    profiles: [],
    snapshots: [],
    logs: [],
    unmanaged: [],
    issues: [],
    activeProfileId: null,
    interruptedOperation: null,
  }
}

function makeDefaultOperationResponse(): OperationResponse {
  return {
    ok: true,
    applied: false,
    operationId: null,
    snapshotId: null,
    message: 'Preview generated.',
    preview: {
      profileId: '',
      items: [],
      savedVariables: [],
      blockers: [],
      warnings: [],
    },
  }
}

/**
 * Injectable test fake for LauncherGateway.
 *
 * Set the public state properties before calling the method under test.
 * All write operations return the current state without mutating it, so
 * tests control state transitions explicitly.
 *
 * @example
 * const gateway = new FakeLauncherGateway()
 * gateway.launcherState = { ...gateway.launcherState, packStatus: 'update_available' }
 * // pass gateway to the controller under test
 */
export class FakeLauncherGateway implements LauncherGateway {
  launcherState: LauncherStateResponse = makeDefaultLauncherState()
  scanState: ScanStateResponse = makeDefaultScanState()
  operationResult: OperationResponse = makeDefaultOperationResponse()

  async detectPaths(): Promise<DetectPathsResponse> {
    return { candidates: [], settings: this.scanState.settings }
  }

  async getLauncherState(): Promise<LauncherStateResponse> {
    return this.launcherState
  }

  async runInitialSetup(_request: RunInitialSetupRequest): Promise<LauncherStateResponse> {
    return this.launcherState
  }

  async syncCuratedPack(): Promise<LauncherStateResponse> {
    return this.launcherState
  }

  async restoreLastKnownGood(_request?: RestoreLastKnownGoodRequest): Promise<OperationResponse> {
    return this.operationResult
  }

  async launchGame(): Promise<string> {
    return this.launcherState.settings.gameExecutablePath ?? ''
  }

  async openAddonsFolder(): Promise<string> {
    return this.launcherState.settings.addonsPath ?? ''
  }

  async setMaintainerMode(_request: SetMaintainerModeRequest): Promise<LauncherStateResponse> {
    return this.launcherState
  }

  async saveSettings(_request: SaveSettingsRequest): Promise<ScanStateResponse> {
    return this.scanState
  }

  async scanLiveState(): Promise<ScanStateResponse> {
    return this.scanState
  }

  async registerSource(_request: RegisterSourceRequest): Promise<ScanStateResponse> {
    return this.scanState
  }

  async createProfile(_request: CreateProfileRequest): Promise<ScanStateResponse> {
    return this.scanState
  }

  async duplicateProfile(_request: { profileId: string }): Promise<ScanStateResponse> {
    return this.scanState
  }

  async switchProfile(_request: { profileId: string }): Promise<ScanStateResponse> {
    return this.scanState
  }

  async listSnapshots(): Promise<SnapshotSummary[]> {
    return this.scanState.snapshots
  }

  async checkUpdates(): Promise<UpdateCheckResponse> {
    return {
      channel: 'stable',
      checkedAt: null,
      manifestGeneratedAt: null,
      manifestUrl: null,
      stale: false,
      errorMessage: null,
      manager: null,
      addons: [],
    }
  }
}

export type Channel = 'stable' | 'beta' | 'localDev'
export type UpdateChannel = 'stable' | 'beta'
export type SourceKind = 'local-folder' | 'zip-file' | 'manifest'
export type Severity = 'blocker' | 'warning'
export type ChangeType = 'install' | 'update' | 'reinstall' | 'remove'
export type RemoteProductType = 'manager' | 'addon'
export type LauncherSetupStatus = 'setup_required' | 'ready_to_install' | 'ready'
export type PackStatus = 'ready_to_install' | 'syncing' | 'up_to_date' | 'update_available' | 'recovery_needed' | 'error'
export type LauncherActionState = 'idle' | 'running' | 'blocked'

export interface Settings {
  ascensionRootPath: string | null
  addonsPath: string | null
  savedVariablesPath: string | null
  backupRetentionCount: number
  autoBackupEnabled: boolean
  defaultProfileId: string | null
  devModeEnabled: boolean
  maintainerModeEnabled: boolean
  onboardingCompleted: boolean
  selectedPackId: string | null
  gameExecutablePath: string | null
  updateChannel: UpdateChannel
  lastUpdateCheckAt: string | null
  lastUpdateError: string | null
  updateManifestOverride: string | null
}

export interface SourceSummary {
  id: string
  sourceKind: SourceKind
  location: string
  channelHint: Channel | null
  updatedAt: string
}

export interface RevisionSummary {
  id: string
  channel: Channel
  version: string
  createdAt: string
}

export interface AddonRecord {
  id: string
  displayName: string
  installFolder: string
  defaultChannel: Channel
  notes: string | null
  dependencies: string[]
  conflicts: string[]
  savedVariables: string[]
  isCore: boolean
  currentVersion: string | null
  currentChannel: Channel | null
  enabledInActiveProfile: boolean
  health: string
  latestRevisions: RevisionSummary[]
  sources: SourceSummary[]
}

export interface ProfileSelection {
  addonId: string
  enabled: boolean
  channelOverride: Channel | null
}

export interface ProfileRecord {
  id: string
  name: string
  notes: string | null
  isActive: boolean
  lastUsedAt: string | null
  selections: ProfileSelection[]
}

export interface SnapshotSummary {
  id: string
  createdAt: string
  snapshotType: string
  relatedProfileId: string | null
  notes: string | null
  pinned: boolean
  sizeBytes: number
  addonCount: number
}

export interface OperationLogEntry {
  id: string
  operation: string
  status: string
  message: string
  createdAt: string
}

export interface PendingOperationSummary {
  id: string
  operation: string
  startedAt: string
  snapshotId: string | null
}

export interface LiveFolderState {
  name: string
  managed: boolean
  addonId: string | null
  path: string
}

export interface ValidationIssue {
  code: string
  severity: Severity
  message: string
  addonId: string | null
  folderName: string | null
}

export interface ChangePreviewItem {
  addonId: string
  displayName: string
  targetFolder: string
  changeType: ChangeType
  sourceVersion: string | null
  channel: Channel | null
}

export interface SavedVariableChange {
  fileName: string
  changeType: ChangeType
}

export interface ChangePreview {
  profileId: string
  items: ChangePreviewItem[]
  savedVariables: SavedVariableChange[]
  blockers: ValidationIssue[]
  warnings: ValidationIssue[]
}

export interface OperationResponse {
  ok: boolean
  applied: boolean
  operationId: string | null
  snapshotId: string | null
  message: string
  preview: ChangePreview
}

export interface DetectPathCandidate {
  label: string
  confidence: string
  ascensionRootPath: string
  addonsPath: string
  savedVariablesPath: string
}

export interface DetectPathsResponse {
  candidates: DetectPathCandidate[]
  settings: Settings
}

export interface ScanStateResponse {
  settings: Settings
  addons: AddonRecord[]
  profiles: ProfileRecord[]
  snapshots: SnapshotSummary[]
  logs: OperationLogEntry[]
  unmanaged: LiveFolderState[]
  issues: ValidationIssue[]
  activeProfileId: string | null
  interruptedOperation: PendingOperationSummary | null
}

export interface LauncherPackMember {
  addonId: string
  displayName: string
  installFolder: string
  required: boolean
  installed: boolean
  currentVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
}

export interface CuratedPackSummary {
  packId: string
  name: string
  description: string
  defaultChannel: Channel
  recoveryLabel: string | null
  recoveryDescription: string | null
  installedCount: number
  totalCount: number
  members: LauncherPackMember[]
}

export interface LauncherPathHealth {
  configured: boolean
  ascensionRootPath: string | null
  addonsPath: string | null
  savedVariablesPath: string | null
  gameExecutablePath: string | null
  detectedCandidates: DetectPathCandidate[]
}

export interface LauncherStateResponse {
  settings: Settings
  setupStatus: LauncherSetupStatus
  packStatus: PackStatus
  actionState: LauncherActionState
  pack: CuratedPackSummary | null
  pathHealth: LauncherPathHealth
  updatesAvailable: number
  lastSuccessfulSyncAt: string | null
  lastKnownGoodSnapshot: SnapshotSummary | null
  recoverySnapshots: SnapshotSummary[]
  unmanagedCollisions: LiveFolderState[]
  interruptedOperation: PendingOperationSummary | null
  errorMessage: string | null
}

export interface SaveSettingsRequest {
  ascensionRootPath?: string | null
  addonsPath?: string | null
  savedVariablesPath?: string | null
  backupRetentionCount?: number | null
  autoBackupEnabled?: boolean | null
  defaultProfileId?: string | null
  devModeEnabled?: boolean | null
  maintainerModeEnabled?: boolean | null
  onboardingCompleted?: boolean | null
  selectedPackId?: string | null
  gameExecutablePath?: string | null
  updateChannel?: UpdateChannel | null
  updateManifestOverride?: string | null
}

export interface RunInitialSetupRequest {
  ascensionRootPath?: string | null
  addonsPath?: string | null
  savedVariablesPath?: string | null
  gameExecutablePath?: string | null
  selectedPackId?: string | null
}

export interface RestoreLastKnownGoodRequest {
  previewOnly?: boolean | null
}

export interface SetMaintainerModeRequest {
  enabled: boolean
}

export interface RegisterSourceRequest {
  sourceKind: SourceKind
  path: string
  channel?: Channel | null
  core?: boolean | null
}

export interface CreateProfileRequest {
  profileId?: string | null
  name: string
  notes?: string | null
  selections: ProfileSelection[]
}

export interface SyncProfileRequest {
  profileId: string
  previewOnly?: boolean | null
  safeMode?: boolean | null
  isolateAddonId?: string | null
}

export interface InstallAddonRequest {
  addonId: string
  profileId?: string | null
  previewOnly?: boolean | null
}

export interface ApplyRemoteAddonUpdateRequest {
  addonId: string
  profileId?: string | null
  previewOnly?: boolean | null
}

export interface RemoteProductUpdate {
  id: string
  name: string
  type: RemoteProductType
  channel: UpdateChannel
  currentVersion: string | null
  latestVersion: string
  available: boolean
  status: string
  publishedAt: string
  releaseUrl: string
  packageUrl: string
  sha256: string
  sizeBytes: number
  installKind: string | null
  changelog: string | null
  minManagerVersion: string | null
}

export interface ManagerUpdateStatus {
  id: string
  currentVersion: string
  latestVersion: string
  available: boolean
  status: string
  releaseUrl: string
  packageUrl: string
  changelog: string | null
  publishedAt: string
  downloadedInstallerPath: string | null
}

export interface UpdateCheckResponse {
  channel: UpdateChannel
  checkedAt: string | null
  manifestGeneratedAt: string | null
  manifestUrl: string | null
  stale: boolean
  errorMessage: string | null
  manager: ManagerUpdateStatus | null
  addons: RemoteProductUpdate[]
}

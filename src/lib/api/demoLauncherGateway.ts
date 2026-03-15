import type { LauncherGateway } from './launcherGateway'
import type {
  AddonRecord,
  CreateProfileRequest,
  CuratedPackSummary,
  DetectPathCandidate,
  DetectPathsResponse,
  LauncherActionState,
  LauncherPackMember,
  LauncherPathHealth,
  LauncherSetupStatus,
  LauncherStateResponse,
  LiveFolderState,
  ManagerUpdateStatus,
  OperationLogEntry,
  OperationResponse,
  PackStatus,
  PendingOperationSummary,
  ProfileRecord,
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

const PACK_ID = 'bronzeforge-default'
const PACK_NAME = 'BronzeForge Pack'
const PACK_DESCRIPTION = 'Curated Bronzebeard launcher pack for one-click install and sync.'

export type DemoScenario =
  | 'single-setup'
  | 'multiple-setup'
  | 'manual-setup'
  | 'installable-pack'
  | 'up-to-date-pack'
  | 'update-available-pack'
  | 'recovery-needed'
  | 'maintainer-mode'

interface DemoAddonState extends AddonRecord {
  latestVersion: string
}

interface DemoStore {
  settings: Settings
  detectedCandidates: DetectPathCandidate[]
  addons: DemoAddonState[]
  profiles: ProfileRecord[]
  snapshots: SnapshotSummary[]
  logs: OperationLogEntry[]
  unmanaged: LiveFolderState[]
  activeProfileId: string | null
  interruptedOperation: PendingOperationSummary | null
  managerUpdate: ManagerUpdateStatus | null
}

function iso(hoursAgo = 0): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
}

function baseSettings(): Settings {
  return {
    ascensionRootPath: 'C:\\Program Files\\Ascension Launcher\\resources\\client',
    addonsPath: 'C:\\Program Files\\Ascension Launcher\\resources\\client\\Interface\\AddOns',
    savedVariablesPath:
      'C:\\Program Files\\Ascension Launcher\\resources\\client\\WTF\\Account\\SavedVariables',
    backupRetentionCount: 20,
    autoBackupEnabled: true,
    defaultProfileId: 'profile-pack',
    devModeEnabled: false,
    maintainerModeEnabled: false,
    onboardingCompleted: true,
    selectedPackId: PACK_ID,
    gameExecutablePath: 'C:\\Games\\Ascension\\Wow.exe',
    updateChannel: 'stable',
    lastUpdateCheckAt: iso(1),
    lastUpdateError: null,
    updateManifestOverride: null,
  }
}

function makeAddon(
  id: string,
  displayName: string,
  installFolder: string,
  currentVersion: string | null,
  latestVersion: string,
  isCore = true,
): DemoAddonState {
  return {
    id,
    displayName,
    installFolder,
    defaultChannel: 'stable',
    notes: `${displayName} is part of the curated BronzeForge pack.`,
    dependencies: [],
    conflicts: [],
    savedVariables: [`${installFolder}.lua`],
    isCore,
    currentVersion,
    latestVersion,
    currentChannel: currentVersion ? 'stable' : null,
    enabledInActiveProfile: Boolean(currentVersion),
    health: currentVersion ? 'Ready' : 'Not installed',
    latestRevisions: currentVersion
      ? [{ id: `rev-${id}`, channel: 'stable', version: currentVersion, createdAt: iso(2) }]
      : [],
    sources: currentVersion
      ? [
          {
            id: `source-${id}`,
            sourceKind: 'manifest',
            location: `C:\\packs\\${installFolder}\\bronzeforge.addon.json`,
            channelHint: 'stable',
            updatedAt: iso(2),
          },
        ]
      : [],
  }
}

function makeProfiles(addons: DemoAddonState[]): ProfileRecord[] {
  return [
    {
      id: 'profile-pack',
      name: 'BronzeForge Pack',
      notes: 'Managed pack profile.',
      isActive: true,
      lastUsedAt: iso(1),
      selections: addons.map((addon) => ({
        addonId: addon.id,
        enabled: addon.isCore,
        channelOverride: null,
      })),
    },
    {
      id: 'profile-brother',
      name: 'Brother',
      notes: 'Personal profile copy.',
      isActive: false,
      lastUsedAt: null,
      selections: addons.map((addon) => ({
        addonId: addon.id,
        enabled: addon.isCore,
        channelOverride: null,
      })),
    },
  ]
}

function makeSnapshots(addonCount: number): SnapshotSummary[] {
  return [
    {
      id: 'snap-last-good',
      createdAt: iso(3),
      snapshotType: 'recovery',
      relatedProfileId: 'profile-pack',
      notes: 'Last known good BronzeForge pack sync.',
      pinned: false,
      sizeBytes: 1024 * 384,
      addonCount,
    },
    {
      id: 'snap-preflight',
      createdAt: iso(12),
      snapshotType: 'preflight',
      relatedProfileId: 'profile-pack',
      notes: 'Pre-update backup.',
      pinned: false,
      sizeBytes: 1024 * 256,
      addonCount,
    },
  ]
}

function makeCandidates(count: number): DetectPathCandidate[] {
  return Array.from({ length: count }, (_, index) => {
    const root =
      index === 0
        ? 'C:\\Program Files\\Ascension Launcher\\resources\\client'
        : `D:\\Program Files\\Ascension Launcher-${index + 1}\\resources\\client`
    return {
      label: index === 0 ? 'Primary Ascension Install' : `Ascension Install ${index + 1}`,
      confidence: 'high',
      ascensionRootPath: root,
      addonsPath: `${root}\\Interface\\AddOns`,
      savedVariablesPath: `${root}\\WTF\\Account\\SavedVariables`,
    }
  })
}

function makeUninstalledAddons(): DemoAddonState[] {
  return [
    makeAddon('bronzeforge-ui', 'BronzeForge UI', 'BronzeForgeUI', null, '1.5.0'),
    makeAddon('bronze-bars', 'Bronze Bars', 'BronzeBars', null, '0.9.7'),
  ]
}

function clearSetupPaths(settings: Settings): void {
  settings.ascensionRootPath = null
  settings.addonsPath = null
  settings.savedVariablesPath = null
  settings.gameExecutablePath = null
  settings.onboardingCompleted = false
}

function createDemoStore(scenario: DemoScenario): DemoStore {
  const settings = baseSettings()
  let addons: DemoAddonState[] = [
    makeAddon('bronzeforge-ui', 'BronzeForge UI', 'BronzeForgeUI', '1.4.2', '1.5.0'),
    makeAddon('bronze-bars', 'Bronze Bars', 'BronzeBars', '0.9.5', '0.9.7'),
  ]
  let detectedCandidates = makeCandidates(1)
  let unmanaged: LiveFolderState[] = []
  let interruptedOperation: PendingOperationSummary | null = null

  if (scenario === 'up-to-date-pack' || scenario === 'maintainer-mode') {
    addons = [
      makeAddon('bronzeforge-ui', 'BronzeForge UI', 'BronzeForgeUI', '1.5.0', '1.5.0'),
      makeAddon('bronze-bars', 'Bronze Bars', 'BronzeBars', '0.9.7', '0.9.7'),
    ]
  }

  if (scenario === 'installable-pack') {
    addons = makeUninstalledAddons()
  }

  if (scenario === 'single-setup') {
    clearSetupPaths(settings)
    addons = makeUninstalledAddons()
  }

  if (scenario === 'multiple-setup') {
    clearSetupPaths(settings)
    detectedCandidates = makeCandidates(2)
    addons = makeUninstalledAddons()
  }

  if (scenario === 'manual-setup') {
    clearSetupPaths(settings)
    detectedCandidates = []
    addons = makeUninstalledAddons()
  }

  if (scenario === 'recovery-needed') {
    interruptedOperation = {
      id: 'op-interrupted',
      operation: 'syncCuratedPack',
      startedAt: iso(0.1),
      snapshotId: 'snap-last-good',
    }
    unmanaged = [
      {
        name: 'BronzeBars',
        managed: false,
        addonId: null,
        path: `${settings.addonsPath}\\BronzeBars`,
      },
    ]
  }

  if (scenario === 'maintainer-mode') {
    settings.maintainerModeEnabled = true
    settings.devModeEnabled = true
  }

  const profiles = makeProfiles(addons)
  const snapshots = makeSnapshots(addons.filter((addon) => addon.currentVersion).length || 2)
  const logs: OperationLogEntry[] = [
    {
      id: 'log-last-sync',
      operation: 'syncCuratedPack',
      status: 'success',
      message: 'BronzeForge pack synced successfully.',
      createdAt: iso(3),
    },
  ]

  return {
    settings,
    detectedCandidates,
    addons,
    profiles,
    snapshots,
    logs,
    unmanaged,
    activeProfileId: 'profile-pack',
    interruptedOperation,
    managerUpdate: {
      id: 'bronzeforge-manager',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      available: true,
      status: 'available',
      releaseUrl: 'https://github.com/dmedlin87/MedlinForge/releases/tag/v0.2.0',
      packageUrl:
        'https://github.com/dmedlin87/MedlinForge/releases/download/v0.2.0/bronzeforge-manager-windows-x64-installer.exe',
      changelog: 'https://github.com/dmedlin87/MedlinForge/releases/tag/v0.2.0',
      publishedAt: iso(6),
      downloadedInstallerPath: null,
    },
  }
}

function buildPackMembers(store: DemoStore): LauncherPackMember[] {
  return store.addons.map((addon) => ({
    addonId: addon.id,
    displayName: addon.displayName,
    installFolder: addon.installFolder,
    required: addon.isCore,
    installed: Boolean(addon.currentVersion),
    currentVersion: addon.currentVersion,
    latestVersion: addon.latestVersion,
    updateAvailable: Boolean(
      addon.latestVersion && addon.currentVersion !== addon.latestVersion,
    ),
  }))
}

function buildPackSummary(store: DemoStore): CuratedPackSummary {
  const members = buildPackMembers(store)
  return {
    packId: PACK_ID,
    name: PACK_NAME,
    description: PACK_DESCRIPTION,
    defaultChannel: 'stable',
    recoveryLabel: 'Restore last known good',
    recoveryDescription:
      'Revert the pack to the most recent working state if a test build breaks the UI.',
    installedCount: members.filter((m) => m.installed).length,
    totalCount: members.length,
    members,
  }
}

function buildPathHealth(store: DemoStore): LauncherPathHealth {
  return {
    configured: Boolean(
      store.settings.ascensionRootPath &&
        store.settings.addonsPath &&
        store.settings.savedVariablesPath,
    ),
    ascensionRootPath: store.settings.ascensionRootPath,
    addonsPath: store.settings.addonsPath,
    savedVariablesPath: store.settings.savedVariablesPath,
    gameExecutablePath: store.settings.gameExecutablePath,
    detectedCandidates: structuredClone(store.detectedCandidates),
  }
}

function buildLauncherStatus(store: DemoStore): {
  setupStatus: LauncherSetupStatus
  packStatus: PackStatus
  actionState: LauncherActionState
  pack: CuratedPackSummary
  pathHealth: LauncherPathHealth
} {
  const pathHealth = buildPathHealth(store)
  const pack = buildPackSummary(store)
  if (!pathHealth.configured) {
    return { setupStatus: 'setup_required', packStatus: 'ready_to_install', actionState: 'blocked', pack, pathHealth }
  }
  if (store.interruptedOperation) {
    return {
      setupStatus: pack.installedCount === 0 ? 'ready_to_install' : 'ready',
      packStatus: 'recovery_needed',
      actionState: 'blocked',
      pack,
      pathHealth,
    }
  }
  if (pack.installedCount === 0) {
    return { setupStatus: 'ready_to_install', packStatus: 'ready_to_install', actionState: 'idle', pack, pathHealth }
  }
  if (pack.members.some((m) => m.updateAvailable)) {
    return { setupStatus: 'ready', packStatus: 'update_available', actionState: 'idle', pack, pathHealth }
  }
  return { setupStatus: 'ready', packStatus: 'up_to_date', actionState: 'idle', pack, pathHealth }
}

function buildLauncherState(store: DemoStore): LauncherStateResponse {
  const { setupStatus, packStatus, actionState, pack, pathHealth } = buildLauncherStatus(store)
  return {
    settings: structuredClone(store.settings),
    setupStatus,
    packStatus,
    actionState,
    pack,
    pathHealth,
    updatesAvailable: pack.members.filter((m) => m.updateAvailable).length,
    lastSuccessfulSyncAt:
      store.snapshots.find((s) => s.snapshotType === 'recovery')?.createdAt ?? null,
    lastKnownGoodSnapshot: store.snapshots.find((s) => s.snapshotType === 'recovery') ?? null,
    recoverySnapshots: structuredClone(store.snapshots),
    unmanagedCollisions: structuredClone(store.unmanaged),
    interruptedOperation: structuredClone(store.interruptedOperation),
    errorMessage: store.interruptedOperation
      ? 'A previous pack sync did not complete cleanly.'
      : null,
  }
}

function buildScanState(store: DemoStore): ScanStateResponse {
  return {
    settings: structuredClone(store.settings),
    addons: structuredClone(store.addons),
    profiles: structuredClone(store.profiles),
    snapshots: structuredClone(store.snapshots),
    logs: structuredClone(store.logs),
    unmanaged: structuredClone(store.unmanaged),
    issues: [],
    activeProfileId: store.activeProfileId,
    interruptedOperation: structuredClone(store.interruptedOperation),
  }
}

function buildUpdateState(store: DemoStore): UpdateCheckResponse {
  return {
    channel: store.settings.updateChannel,
    checkedAt: iso(0.5),
    manifestGeneratedAt: iso(0.5),
    manifestUrl: 'https://dmedlin87.github.io/MedlinForge/catalog/stable.json',
    stale: false,
    errorMessage: null,
    manager: structuredClone(store.managerUpdate),
    addons: store.addons.map((addon) => {
      const slug = addon.displayName.replace(/\s+/g, '')
      return {
      id: addon.id,
      name: addon.displayName,
      type: 'addon' as const,
      channel: store.settings.updateChannel,
      currentVersion: addon.currentVersion,
      latestVersion: addon.latestVersion,
      available: addon.currentVersion !== addon.latestVersion,
      status: addon.currentVersion === addon.latestVersion ? 'up-to-date' : 'available',
      publishedAt: iso(6),
      releaseUrl: `https://github.com/dmedlin87/${slug}/releases/latest`,
      packageUrl: `https://github.com/dmedlin87/${slug}/releases/download/v${addon.latestVersion}/${addon.installFolder}.zip`,
      sha256: 'a'.repeat(64),
      sizeBytes: 456789,
      installKind: 'addon-folder-zip',
      changelog: null,
      minManagerVersion: null,
    }
    }),
  }
}

function recoveryPreview(store: DemoStore, message: string, applied: boolean): OperationResponse {
  const lastGood = store.snapshots.find((s) => s.snapshotType === 'recovery')
  return {
    ok: true,
    applied,
    operationId: applied ? crypto.randomUUID() : null,
    snapshotId: lastGood?.id ?? null,
    message,
    preview: {
      profileId: 'profile-pack',
      items: store.addons.map((addon) => ({
        addonId: addon.id,
        displayName: addon.displayName,
        targetFolder: addon.installFolder,
        changeType: 'update',
        sourceVersion: addon.currentVersion,
        channel: 'stable',
      })),
      savedVariables: store.addons.map((addon) => ({
        fileName: `${addon.installFolder}.lua`,
        changeType: 'update' as const,
      })),
      blockers: [],
      warnings: [],
    },
  }
}

export class DemoLauncherGateway implements LauncherGateway {
  private store: DemoStore

  constructor(scenario: DemoScenario = 'update-available-pack') {
    this.store = createDemoStore(scenario)
  }

  resetScenario(scenario: DemoScenario = 'update-available-pack'): void {
    this.store = createDemoStore(scenario)
  }

  async detectPaths(): Promise<DetectPathsResponse> {
    return {
      candidates: structuredClone(this.store.detectedCandidates),
      settings: structuredClone(this.store.settings),
    }
  }

  async getLauncherState(): Promise<LauncherStateResponse> {
    return buildLauncherState(this.store)
  }

  async runInitialSetup(request: RunInitialSetupRequest): Promise<LauncherStateResponse> {
    const selectedCandidate =
      this.store.detectedCandidates.find(
        (c) =>
          c.ascensionRootPath === request.ascensionRootPath ||
          c.addonsPath === request.addonsPath,
      ) ?? (this.store.detectedCandidates.length === 1 ? this.store.detectedCandidates[0] : undefined)

    if (
      !request.ascensionRootPath &&
      !selectedCandidate &&
      this.store.detectedCandidates.length > 1
    ) {
      throw new Error(
        'Multiple installs were detected. Pick the Ascension folder you want BronzeForge to manage.',
      )
    }

    this.store.settings = {
      ...this.store.settings,
      ascensionRootPath:
        request.ascensionRootPath ??
        selectedCandidate?.ascensionRootPath ??
        this.store.settings.ascensionRootPath,
      addonsPath:
        request.addonsPath ??
        selectedCandidate?.addonsPath ??
        this.store.settings.addonsPath,
      savedVariablesPath:
        request.savedVariablesPath ??
        selectedCandidate?.savedVariablesPath ??
        this.store.settings.savedVariablesPath,
      gameExecutablePath:
        request.gameExecutablePath ??
        this.store.settings.gameExecutablePath ??
        'C:\\Games\\Ascension\\Wow.exe',
      onboardingCompleted: true,
      selectedPackId: request.selectedPackId ?? this.store.settings.selectedPackId,
    }
    return buildLauncherState(this.store)
  }

  async syncCuratedPack(): Promise<LauncherStateResponse> {
    this.store.addons = this.store.addons.map((addon) => ({
      ...addon,
      currentVersion: addon.latestVersion,
      currentChannel: 'stable' as const,
      enabledInActiveProfile: true,
      health: 'Ready',
      latestRevisions: [
        {
          id: `rev-${addon.id}-${addon.latestVersion}`,
          channel: 'stable' as const,
          version: addon.latestVersion,
          createdAt: iso(0),
        },
      ],
      sources: addon.sources.length
        ? addon.sources
        : [
            {
              id: `source-${addon.id}`,
              sourceKind: 'manifest' as const,
              location: `C:\\packs\\${addon.installFolder}\\bronzeforge.addon.json`,
              channelHint: 'stable' as const,
              updatedAt: iso(0),
            },
          ],
    }))
    this.store.interruptedOperation = null
    this.store.unmanaged = []
    this.store.snapshots = [
      {
        id: crypto.randomUUID(),
        createdAt: iso(0),
        snapshotType: 'recovery',
        relatedProfileId: 'profile-pack',
        notes: 'Last known good BronzeForge pack sync.',
        pinned: false,
        sizeBytes: 1024 * 512,
        addonCount: this.store.addons.length,
      },
      ...this.store.snapshots,
    ]
    this.store.logs = [
      {
        id: crypto.randomUUID(),
        operation: 'syncCuratedPack',
        status: 'success',
        message: 'BronzeForge pack synced successfully.',
        createdAt: iso(0),
      },
      ...this.store.logs,
    ]
    return buildLauncherState(this.store)
  }

  async restoreLastKnownGood(
    request: RestoreLastKnownGoodRequest = {},
  ): Promise<OperationResponse> {
    if (!request.previewOnly) {
      this.store.interruptedOperation = null
      this.store.unmanaged = []
    }
    return recoveryPreview(
      this.store,
      request.previewOnly
        ? 'Restore preview generated.'
        : 'Restored last known good pack snapshot.',
      !request.previewOnly,
    )
  }

  async launchGame(): Promise<string> {
    return this.store.settings.gameExecutablePath ?? 'C:\\Games\\Ascension\\Wow.exe'
  }

  async openAddonsFolder(): Promise<string> {
    return (
      this.store.settings.addonsPath ??
      'C:\\Program Files\\Ascension Launcher\\resources\\client\\Interface\\AddOns'
    )
  }

  async setMaintainerMode(request: SetMaintainerModeRequest): Promise<LauncherStateResponse> {
    this.store.settings = {
      ...this.store.settings,
      maintainerModeEnabled: request.enabled,
      devModeEnabled: request.enabled,
    }
    return buildLauncherState(this.store)
  }

  async saveSettings(request: SaveSettingsRequest): Promise<ScanStateResponse> {
    this.store.settings = {
      ...this.store.settings,
      ...(Object.fromEntries(
        Object.entries(request).filter(([, value]) => value != null),
      ) as Partial<Settings>),
    }
    return buildScanState(this.store)
  }

  async scanLiveState(): Promise<ScanStateResponse> {
    return buildScanState(this.store)
  }

  async registerSource(request: RegisterSourceRequest): Promise<ScanStateResponse> {
    const id =
      request.path
        .split(/[\\/]/)
        .pop()
        ?.replace(/\W+/g, '-')
        .toLowerCase() ?? `addon-${this.store.addons.length + 1}`
    const displayName = id
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (v) => v.toUpperCase())
    this.store.addons = [
      ...this.store.addons,
      {
        ...makeAddon(id, displayName, displayName.replace(/\s+/g, ''), '0.1.0-local', '0.1.0-local', Boolean(request.core)),
        defaultChannel: request.channel ?? 'stable',
        currentChannel: request.channel ?? 'stable',
        sources: [
          {
            id: crypto.randomUUID(),
            sourceKind: request.sourceKind,
            location: request.path,
            channelHint: request.channel ?? 'stable',
            updatedAt: iso(0),
          },
        ],
      },
    ]
    this.store.profiles = makeProfiles(this.store.addons)
    return buildScanState(this.store)
  }

  async createProfile(request: CreateProfileRequest): Promise<ScanStateResponse> {
    const id = request.profileId ?? crypto.randomUUID()
    const next: ProfileRecord = {
      id,
      name: request.name,
      notes: request.notes ?? null,
      isActive: false,
      lastUsedAt: null,
      selections: request.selections,
    }
    this.store.profiles = this.store.profiles.some((p) => p.id === id)
      ? this.store.profiles.map((p) => (p.id === id ? next : p))
      : [...this.store.profiles, next]
    return buildScanState(this.store)
  }

  async duplicateProfile(request: { profileId: string }): Promise<ScanStateResponse> {
    const source = this.store.profiles.find((p) => p.id === request.profileId)
    if (source) {
      this.store.profiles = [
        ...this.store.profiles,
        { ...source, id: crypto.randomUUID(), name: `${source.name} Copy`, isActive: false },
      ]
    }
    return buildScanState(this.store)
  }

  async switchProfile(request: { profileId: string }): Promise<ScanStateResponse> {
    this.store.activeProfileId = request.profileId
    this.store.profiles = this.store.profiles.map((p) => ({
      ...p,
      isActive: p.id === request.profileId,
      lastUsedAt: p.id === request.profileId ? iso(0) : p.lastUsedAt,
    }))
    return buildScanState(this.store)
  }

  async listSnapshots(): Promise<SnapshotSummary[]> {
    return structuredClone(this.store.snapshots)
  }

  async checkUpdates(): Promise<UpdateCheckResponse> {
    return buildUpdateState(this.store)
  }
}

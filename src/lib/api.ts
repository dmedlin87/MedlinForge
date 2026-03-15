import { invoke } from '@tauri-apps/api/core'

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
  SnapshotSummary,
  UpdateCheckResponse,
} from '../types'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const PACK_ID = 'bronzeforge-default'
const PACK_NAME = 'BronzeForge Pack'
const PACK_DESCRIPTION = 'Curated Bronzebeard launcher pack for one-click install and sync.'

type DemoScenario =
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
  settings: ScanStateResponse['settings']
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function iso(hoursAgo = 0): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
}

function baseSettings(): ScanStateResponse['settings'] {
  return {
    ascensionRootPath: 'C:\\Program Files\\Ascension Launcher\\resources\\client',
    addonsPath: 'C:\\Program Files\\Ascension Launcher\\resources\\client\\Interface\\AddOns',
    savedVariablesPath: 'C:\\Program Files\\Ascension Launcher\\resources\\client\\WTF\\Account\\SavedVariables',
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
      ? [{ id: `source-${id}`, sourceKind: 'manifest', location: `C:\\packs\\${installFolder}\\bronzeforge.addon.json`, channelHint: 'stable', updatedAt: iso(2) }]
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
    const root = index === 0
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
    addons = [
      makeAddon('bronzeforge-ui', 'BronzeForge UI', 'BronzeForgeUI', null, '1.5.0'),
      makeAddon('bronze-bars', 'Bronze Bars', 'BronzeBars', null, '0.9.7'),
    ]
  }

  if (scenario === 'single-setup') {
    settings.ascensionRootPath = null
    settings.addonsPath = null
    settings.savedVariablesPath = null
    settings.gameExecutablePath = null
    settings.onboardingCompleted = false
    addons = [
      makeAddon('bronzeforge-ui', 'BronzeForge UI', 'BronzeForgeUI', null, '1.5.0'),
      makeAddon('bronze-bars', 'Bronze Bars', 'BronzeBars', null, '0.9.7'),
    ]
  }

  if (scenario === 'multiple-setup') {
    settings.ascensionRootPath = null
    settings.addonsPath = null
    settings.savedVariablesPath = null
    settings.gameExecutablePath = null
    settings.onboardingCompleted = false
    detectedCandidates = makeCandidates(2)
    addons = [
      makeAddon('bronzeforge-ui', 'BronzeForge UI', 'BronzeForgeUI', null, '1.5.0'),
      makeAddon('bronze-bars', 'Bronze Bars', 'BronzeBars', null, '0.9.7'),
    ]
  }

  if (scenario === 'manual-setup') {
    settings.ascensionRootPath = null
    settings.addonsPath = null
    settings.savedVariablesPath = null
    settings.gameExecutablePath = null
    settings.onboardingCompleted = false
    detectedCandidates = []
    addons = [
      makeAddon('bronzeforge-ui', 'BronzeForge UI', 'BronzeForgeUI', null, '1.5.0'),
      makeAddon('bronze-bars', 'Bronze Bars', 'BronzeBars', null, '0.9.7'),
    ]
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
      packageUrl: 'https://github.com/dmedlin87/MedlinForge/releases/download/v0.2.0/bronzeforge-manager-windows-x64-installer.exe',
      changelog: 'https://github.com/dmedlin87/MedlinForge/releases/tag/v0.2.0',
      publishedAt: iso(6),
      downloadedInstallerPath: null,
    },
  }
}

let demoStore = createDemoStore('update-available-pack')

function buildPackMembers(store: DemoStore): LauncherPackMember[] {
  return store.addons.map((addon) => ({
    addonId: addon.id,
    displayName: addon.displayName,
    installFolder: addon.installFolder,
    required: addon.isCore,
    installed: Boolean(addon.currentVersion),
    currentVersion: addon.currentVersion,
    latestVersion: addon.latestVersion,
    updateAvailable: Boolean(addon.latestVersion && addon.currentVersion !== addon.latestVersion),
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
    recoveryDescription: 'Revert the pack to the most recent working state if a test build breaks the UI.',
    installedCount: members.filter((member) => member.installed).length,
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
    detectedCandidates: clone(store.detectedCandidates),
  }
}

function buildLauncherStatus(store: DemoStore): {
  setupStatus: LauncherSetupStatus
  packStatus: PackStatus
  actionState: LauncherActionState
} {
  const pathHealth = buildPathHealth(store)
  const pack = buildPackSummary(store)
  if (!pathHealth.configured) {
    return {
      setupStatus: 'setup_required',
      packStatus: 'ready_to_install',
      actionState: 'blocked',
    }
  }
  if (store.interruptedOperation) {
    return {
      setupStatus: pack.installedCount === 0 ? 'ready_to_install' : 'ready',
      packStatus: 'recovery_needed',
      actionState: 'blocked',
    }
  }
  if (pack.installedCount === 0) {
    return {
      setupStatus: 'ready_to_install',
      packStatus: 'ready_to_install',
      actionState: 'idle',
    }
  }
  if (pack.members.some((member) => member.updateAvailable)) {
    return {
      setupStatus: 'ready',
      packStatus: 'update_available',
      actionState: 'idle',
    }
  }
  return {
    setupStatus: 'ready',
    packStatus: 'up_to_date',
    actionState: 'idle',
  }
}

function buildLauncherState(store: DemoStore): LauncherStateResponse {
  const { setupStatus, packStatus, actionState } = buildLauncherStatus(store)
  return {
    settings: clone(store.settings),
    setupStatus,
    packStatus,
    actionState,
    pack: buildPackSummary(store),
    pathHealth: buildPathHealth(store),
    updatesAvailable: buildPackSummary(store).members.filter((member) => member.updateAvailable).length,
    lastSuccessfulSyncAt: store.snapshots.find((snapshot) => snapshot.snapshotType === 'recovery')?.createdAt ?? null,
    lastKnownGoodSnapshot: store.snapshots.find((snapshot) => snapshot.snapshotType === 'recovery') ?? null,
    recoverySnapshots: clone(store.snapshots),
    unmanagedCollisions: clone(store.unmanaged),
    interruptedOperation: clone(store.interruptedOperation),
    errorMessage: store.interruptedOperation ? 'A previous pack sync did not complete cleanly.' : null,
  }
}

function buildScanState(store: DemoStore): ScanStateResponse {
  return {
    settings: clone(store.settings),
    addons: clone(store.addons),
    profiles: clone(store.profiles),
    snapshots: clone(store.snapshots),
    logs: clone(store.logs),
    unmanaged: clone(store.unmanaged),
    issues: [],
    activeProfileId: store.activeProfileId,
    interruptedOperation: clone(store.interruptedOperation),
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
    manager: clone(store.managerUpdate),
    addons: store.addons.map((addon) => ({
      id: addon.id,
      name: addon.displayName,
      type: 'addon',
      channel: store.settings.updateChannel,
      currentVersion: addon.currentVersion,
      latestVersion: addon.latestVersion,
      available: addon.currentVersion !== addon.latestVersion,
      status: addon.currentVersion === addon.latestVersion ? 'up-to-date' : 'available',
      publishedAt: iso(6),
      releaseUrl: `https://github.com/dmedlin87/${addon.displayName.replace(/\s+/g, '')}/releases/latest`,
      packageUrl: `https://github.com/dmedlin87/${addon.displayName.replace(/\s+/g, '')}/releases/download/v${addon.latestVersion}/${addon.installFolder}.zip`,
      sha256: 'a'.repeat(64),
      sizeBytes: 456789,
      installKind: 'addon-folder-zip',
      changelog: null,
      minManagerVersion: null,
    })),
  }
}

function recoveryPreview(message: string, applied: boolean): OperationResponse {
  const lastGood = demoStore.snapshots.find((snapshot) => snapshot.snapshotType === 'recovery')
  return {
    ok: true,
    applied,
    operationId: applied ? crypto.randomUUID() : null,
    snapshotId: lastGood?.id ?? null,
    message,
    preview: {
      profileId: 'profile-pack',
      items: demoStore.addons.map((addon) => ({
        addonId: addon.id,
        displayName: addon.displayName,
        targetFolder: addon.installFolder,
        changeType: 'update',
        sourceVersion: addon.currentVersion,
        channel: 'stable',
      })),
      savedVariables: demoStore.addons.map((addon) => ({
        fileName: `${addon.installFolder}.lua`,
        changeType: 'update',
      })),
      blockers: [],
      warnings: [],
    },
  }
}

async function invokeOrDemo<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    return invoke<T>(command, payload)
  }

  switch (command) {
    case 'detect_paths':
      return {
        candidates: clone(demoStore.detectedCandidates),
        settings: clone(demoStore.settings),
      } as T
    case 'get_launcher_state':
      return buildLauncherState(demoStore) as T
    case 'run_initial_setup': {
      const request = (payload?.request ?? {}) as RunInitialSetupRequest
      const selectedCandidate =
        demoStore.detectedCandidates.find(
          (candidate) =>
            candidate.ascensionRootPath === request.ascensionRootPath ||
            candidate.addonsPath === request.addonsPath,
        ) ?? demoStore.detectedCandidates[0]

      if (!request.ascensionRootPath && !selectedCandidate && demoStore.detectedCandidates.length > 1) {
        throw new Error('Multiple installs were detected. Pick the Ascension folder you want BronzeForge to manage.')
      }

      demoStore.settings = {
        ...demoStore.settings,
        ascensionRootPath: request.ascensionRootPath ?? selectedCandidate?.ascensionRootPath ?? demoStore.settings.ascensionRootPath,
        addonsPath: request.addonsPath ?? selectedCandidate?.addonsPath ?? demoStore.settings.addonsPath,
        savedVariablesPath:
          request.savedVariablesPath ?? selectedCandidate?.savedVariablesPath ?? demoStore.settings.savedVariablesPath,
        gameExecutablePath: request.gameExecutablePath ?? demoStore.settings.gameExecutablePath ?? 'C:\\Games\\Ascension\\Wow.exe',
        onboardingCompleted: true,
        selectedPackId: request.selectedPackId ?? demoStore.settings.selectedPackId,
      }
      return buildLauncherState(demoStore) as T
    }
    case 'sync_curated_pack': {
      demoStore.addons = demoStore.addons.map((addon) => ({
        ...addon,
        currentVersion: addon.latestVersion,
        currentChannel: 'stable',
        enabledInActiveProfile: true,
        health: 'Ready',
        latestRevisions: [{ id: `rev-${addon.id}-${addon.latestVersion}`, channel: 'stable', version: addon.latestVersion, createdAt: iso(0) }],
        sources: addon.sources.length
          ? addon.sources
          : [{ id: `source-${addon.id}`, sourceKind: 'manifest', location: `C:\\packs\\${addon.installFolder}\\bronzeforge.addon.json`, channelHint: 'stable', updatedAt: iso(0) }],
      }))
      demoStore.interruptedOperation = null
      demoStore.unmanaged = []
      demoStore.snapshots = [
        {
          id: crypto.randomUUID(),
          createdAt: iso(0),
          snapshotType: 'recovery',
          relatedProfileId: 'profile-pack',
          notes: 'Last known good BronzeForge pack sync.',
          pinned: false,
          sizeBytes: 1024 * 512,
          addonCount: demoStore.addons.length,
        },
        ...demoStore.snapshots,
      ]
      demoStore.logs = [
        {
          id: crypto.randomUUID(),
          operation: 'syncCuratedPack',
          status: 'success',
          message: 'BronzeForge pack synced successfully.',
          createdAt: iso(0),
        },
        ...demoStore.logs,
      ]
      return buildLauncherState(demoStore) as T
    }
    case 'restore_last_known_good': {
      const request = (payload?.request ?? {}) as RestoreLastKnownGoodRequest
      if (!request.previewOnly) {
        demoStore.interruptedOperation = null
        demoStore.unmanaged = []
      }
      return recoveryPreview(
        request.previewOnly ? 'Restore preview generated.' : 'Restored last known good pack snapshot.',
        !request.previewOnly,
      ) as T
    }
    case 'launch_game':
      return (demoStore.settings.gameExecutablePath ?? 'C:\\Games\\Ascension\\Wow.exe') as T
    case 'open_addons_folder':
      return (demoStore.settings.addonsPath ?? 'C:\\Program Files\\Ascension Launcher\\resources\\client\\Interface\\AddOns') as T
    case 'set_maintainer_mode': {
      const request = (payload?.request ?? {}) as SetMaintainerModeRequest
      demoStore.settings = {
        ...demoStore.settings,
        maintainerModeEnabled: request.enabled,
        devModeEnabled: request.enabled,
      }
      return buildLauncherState(demoStore) as T
    }
    case 'save_settings': {
      const request = (payload?.request ?? {}) as SaveSettingsRequest
      demoStore.settings = {
        ...demoStore.settings,
        ...Object.fromEntries(
          Object.entries(request).filter(([, value]) => value !== undefined),
        ),
      }
      return buildScanState(demoStore) as T
    }
    case 'scan_live_state':
      return buildScanState(demoStore) as T
    case 'register_source': {
      const request = (payload?.request ?? {}) as RegisterSourceRequest
      const id = request.path.split(/[\\/]/).pop()?.replace(/\W+/g, '-').toLowerCase() || `addon-${demoStore.addons.length + 1}`
      const displayName = id.replace(/-/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase())
      demoStore.addons = [
        ...demoStore.addons,
        {
          ...makeAddon(id, displayName, displayName.replace(/\s+/g, ''), '0.1.0-local', '0.1.0-local', Boolean(request.core)),
          defaultChannel: request.channel ?? 'stable',
          currentChannel: request.channel ?? 'stable',
          sources: [{ id: crypto.randomUUID(), sourceKind: request.sourceKind, location: request.path, channelHint: request.channel ?? 'stable', updatedAt: iso(0) }],
        },
      ]
      demoStore.profiles = makeProfiles(demoStore.addons)
      return buildScanState(demoStore) as T
    }
    case 'create_profile': {
      const request = (payload?.request ?? {}) as CreateProfileRequest
      const id = request.profileId ?? crypto.randomUUID()
      const nextProfile: ProfileRecord = {
        id,
        name: request.name,
        notes: request.notes ?? null,
        isActive: false,
        lastUsedAt: null,
        selections: request.selections,
      }
      demoStore.profiles = demoStore.profiles.some((profile) => profile.id === id)
        ? demoStore.profiles.map((profile) => (profile.id === id ? nextProfile : profile))
        : [...demoStore.profiles, nextProfile]
      return buildScanState(demoStore) as T
    }
    case 'duplicate_profile': {
      const profileId = (payload?.request as { profileId: string })?.profileId
      const source = demoStore.profiles.find((profile) => profile.id === profileId)
      if (source) {
        demoStore.profiles = [
          ...demoStore.profiles,
          {
            ...source,
            id: crypto.randomUUID(),
            name: `${source.name} Copy`,
            isActive: false,
          },
        ]
      }
      return buildScanState(demoStore) as T
    }
    case 'switch_profile': {
      const profileId = (payload?.request as { profileId: string })?.profileId
      demoStore.activeProfileId = profileId
      demoStore.profiles = demoStore.profiles.map((profile) => ({
        ...profile,
        isActive: profile.id === profileId,
        lastUsedAt: profile.id === profileId ? iso(0) : profile.lastUsedAt,
      }))
      return buildScanState(demoStore) as T
    }
    case 'list_snapshots':
      return clone(demoStore.snapshots) as T
    case 'check_updates':
      return buildUpdateState(demoStore) as T
    default:
      return buildScanState(demoStore) as T
  }
}

export function __resetDemoApiState(scenario: DemoScenario = 'update-available-pack') {
  demoStore = createDemoStore(scenario)
}

export const api = {
  detectPaths: () => invokeOrDemo<DetectPathsResponse>('detect_paths'),
  getLauncherState: () => invokeOrDemo<LauncherStateResponse>('get_launcher_state'),
  runInitialSetup: (request: RunInitialSetupRequest) =>
    invokeOrDemo<LauncherStateResponse>('run_initial_setup', { request }),
  syncCuratedPack: () => invokeOrDemo<LauncherStateResponse>('sync_curated_pack'),
  restoreLastKnownGood: (request: RestoreLastKnownGoodRequest = {}) =>
    invokeOrDemo<OperationResponse>('restore_last_known_good', { request }),
  launchGame: () => invokeOrDemo<string>('launch_game'),
  openAddonsFolder: () => invokeOrDemo<string>('open_addons_folder'),
  setMaintainerMode: (request: SetMaintainerModeRequest) =>
    invokeOrDemo<LauncherStateResponse>('set_maintainer_mode', { request }),
  saveSettings: (request: SaveSettingsRequest) =>
    invokeOrDemo<ScanStateResponse>('save_settings', { request }),
  scanLiveState: () => invokeOrDemo<ScanStateResponse>('scan_live_state'),
  registerSource: (request: RegisterSourceRequest) =>
    invokeOrDemo<ScanStateResponse>('register_source', { request }),
  createProfile: (request: CreateProfileRequest) =>
    invokeOrDemo<ScanStateResponse>('create_profile', { request }),
  duplicateProfile: (request: { profileId: string }) =>
    invokeOrDemo<ScanStateResponse>('duplicate_profile', { request }),
  switchProfile: (request: { profileId: string }) =>
    invokeOrDemo<ScanStateResponse>('switch_profile', { request }),
  listSnapshots: () => invokeOrDemo<SnapshotSummary[]>('list_snapshots'),
  checkUpdates: () => invokeOrDemo<UpdateCheckResponse>('check_updates'),
}

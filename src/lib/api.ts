import { invoke } from '@tauri-apps/api/core'

import type {
  Channel,
  ChangePreviewItem,
  CreateProfileRequest,
  DetectPathsResponse,
  ManagerUpdateStatus,
  OperationResponse,
  ProfileRecord,
  RegisterSourceRequest,
  SaveSettingsRequest,
  ScanStateResponse,
  SnapshotSummary,
  SyncProfileRequest,
  UpdateCheckResponse,
} from '../types'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let demoState: ScanStateResponse = {
  settings: {
    ascensionRootPath: 'C:\\Games\\Ascension',
    addonsPath: 'C:\\Games\\Ascension\\Interface\\AddOns',
    savedVariablesPath: 'C:\\Games\\Ascension\\WTF\\Account\\SavedVariables',
    backupRetentionCount: 20,
    autoBackupEnabled: true,
    defaultProfileId: 'profile-main',
    devModeEnabled: true,
    updateChannel: 'stable',
    lastUpdateCheckAt: new Date().toISOString(),
    lastUpdateError: null,
    updateManifestOverride: null,
  },
  addons: [
    {
      id: 'bronzeforge-ui',
      displayName: 'BronzeForge UI',
      installFolder: 'BronzeForgeUI',
      defaultChannel: 'stable',
      notes: 'Primary Bronzebeard HUD pack.',
      dependencies: [],
      conflicts: [],
      savedVariables: ['BronzeForgeUI.lua'],
      isCore: true,
      currentVersion: '1.4.2',
      currentChannel: 'stable',
      enabledInActiveProfile: true,
      health: 'Ready',
      latestRevisions: [
        { id: 'rev-ui-stable', channel: 'stable', version: '1.4.2', createdAt: new Date().toISOString() },
        { id: 'rev-ui-beta', channel: 'beta', version: '1.5.0-beta.2', createdAt: new Date().toISOString() },
      ],
      sources: [
        {
          id: 'source-ui',
          sourceKind: 'local-folder',
          location: 'C:\\dev\\BronzeForgeUI',
          channelHint: 'localDev',
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    {
      id: 'bronze-bars',
      displayName: 'Bronze Bars',
      installFolder: 'BronzeBars',
      defaultChannel: 'stable',
      notes: 'Unit frame and hotbar skinning.',
      dependencies: ['bronzeforge-ui'],
      conflicts: [],
      savedVariables: ['BronzeBars.lua'],
      isCore: true,
      currentVersion: '0.9.7',
      currentChannel: 'stable',
      enabledInActiveProfile: true,
      health: 'Ready',
      latestRevisions: [{ id: 'rev-bars', channel: 'stable', version: '0.9.7', createdAt: new Date().toISOString() }],
      sources: [{ id: 'source-bars', sourceKind: 'manifest', location: 'C:\\packs\\BronzeBars\\bronzeforge.addon.json', channelHint: 'stable', updatedAt: new Date().toISOString() }],
    },
  ],
  profiles: [
    {
      id: 'profile-main',
      name: 'Main',
      notes: 'Daily stable setup.',
      isActive: true,
      lastUsedAt: new Date().toISOString(),
      selections: [
        { addonId: 'bronzeforge-ui', enabled: true, channelOverride: null },
        { addonId: 'bronze-bars', enabled: true, channelOverride: null },
      ],
    },
    {
      id: 'profile-dev',
      name: 'Dev Cleanroom',
      notes: 'Local dev channel only.',
      isActive: false,
      lastUsedAt: null,
      selections: [
        { addonId: 'bronzeforge-ui', enabled: true, channelOverride: 'localDev' },
        { addonId: 'bronze-bars', enabled: false, channelOverride: null },
      ],
    },
  ],
  snapshots: [
    {
      id: 'snap-lkg',
      createdAt: new Date().toISOString(),
      snapshotType: 'recovery',
      relatedProfileId: 'profile-main',
      notes: 'Last known good sync.',
      pinned: false,
      sizeBytes: 1024 * 512,
      addonCount: 2,
    },
  ],
  logs: [
    {
      id: 'log-1',
      operation: 'syncProfile',
      status: 'success',
      message: 'Profile sync completed successfully',
      createdAt: new Date().toISOString(),
    },
  ],
  unmanaged: [
    {
      name: 'QuestieLegacy',
      managed: false,
      addonId: null,
      path: 'C:\\Games\\Ascension\\Interface\\AddOns\\QuestieLegacy',
    },
  ],
  issues: [],
  activeProfileId: 'profile-main',
  interruptedOperation: null,
}

let demoUpdates: UpdateCheckResponse = {
  channel: 'stable',
  checkedAt: new Date().toISOString(),
  manifestGeneratedAt: new Date().toISOString(),
  manifestUrl: 'https://dmedlin87.github.io/MedlinForge/manifest/stable.json',
  stale: false,
  errorMessage: null,
  manager: {
    id: 'bronzeforge-manager',
    currentVersion: '0.1.0',
    latestVersion: '0.2.0',
    available: true,
    status: 'available',
    releaseUrl: 'https://github.com/dmedlin87/MedlinForge/releases/tag/v0.2.0',
    packageUrl: 'https://github.com/dmedlin87/MedlinForge/releases/download/v0.2.0/bronzeforge-manager-windows-x64-installer.exe',
    changelog: 'https://github.com/dmedlin87/MedlinForge/releases/tag/v0.2.0',
    publishedAt: new Date().toISOString(),
    downloadedInstallerPath: null,
  },
  addons: [
    {
      id: 'bronzeforge-ui',
      name: 'BronzeForge UI',
      type: 'addon',
      channel: 'stable',
      currentVersion: '1.4.2',
      latestVersion: '1.5.0',
      available: true,
      status: 'available',
      publishedAt: new Date().toISOString(),
      releaseUrl: 'https://github.com/dmedlin87/BronzeForgeUI/releases/tag/v1.5.0',
      packageUrl: 'https://github.com/dmedlin87/BronzeForgeUI/releases/download/v1.5.0/BronzeForgeUI.zip',
      sha256: 'a'.repeat(64),
      sizeBytes: 456789,
      installKind: 'addon-folder-zip',
      changelog: 'https://github.com/dmedlin87/BronzeForgeUI/releases/tag/v1.5.0',
      minManagerVersion: null,
    },
  ],
}

function getActiveProfile(): ProfileRecord {
  return demoState.profiles.find((profile) => profile.id === demoState.activeProfileId) ?? demoState.profiles[0]
}

function syncPreview(profileId: string, safeMode = false, isolateAddonId?: string | null): OperationResponse {
  const profile = demoState.profiles.find((entry) => entry.id === profileId) ?? getActiveProfile()
  const enabledSelections = profile.selections.filter((selection) => selection.enabled)
  const effectiveSelections = enabledSelections.filter((selection) => {
    if (isolateAddonId) return selection.addonId === isolateAddonId
    if (!safeMode) return true
    return demoState.addons.find((addon) => addon.id === selection.addonId)?.isCore
  })
  const items = effectiveSelections
    .map((selection): ChangePreviewItem | null => {
      const addon = demoState.addons.find((entry) => entry.id === selection.addonId)
      if (!addon) return null
      return {
        addonId: addon.id,
        displayName: addon.displayName,
        targetFolder: addon.installFolder,
        changeType: addon.enabledInActiveProfile ? 'update' : 'install',
        sourceVersion: addon.currentVersion,
        channel: (selection.channelOverride ?? addon.defaultChannel) as Channel,
      }
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))

  return {
    ok: true,
    applied: false,
    operationId: null,
    snapshotId: null,
    message: 'Preview generated',
    preview: {
      profileId,
      items,
      savedVariables: effectiveSelections
        .flatMap((selection) => demoState.addons.find((addon) => addon.id === selection.addonId)?.savedVariables ?? [])
        .map((fileName) => ({ fileName, changeType: 'update' })),
      blockers: [],
      warnings: demoState.unmanaged.length
        ? [{ code: 'unmanaged_present', severity: 'warning', message: 'Unmanaged addons are present in the live AddOns folder.', addonId: null, folderName: null }]
        : [],
    },
  }
}

async function invokeOrDemo<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    return invoke<T>(command, payload)
  }

  switch (command) {
    case 'scan_live_state':
      return clone(demoState) as T
    case 'detect_paths':
      return {
        candidates: [
          {
            label: 'Demo Ascension Install',
            confidence: 'high',
            ascensionRootPath: demoState.settings.ascensionRootPath ?? '',
            addonsPath: demoState.settings.addonsPath ?? '',
            savedVariablesPath: demoState.settings.savedVariablesPath ?? '',
          },
        ],
        settings: clone(demoState.settings),
      } as T
    case 'save_settings': {
      demoState = {
        ...demoState,
        settings: {
          ...demoState.settings,
          ...Object.fromEntries(
            Object.entries((payload?.request ?? {}) as SaveSettingsRequest).filter(([, value]) => value !== null),
          ),
        },
      }
      if ((payload?.request as SaveSettingsRequest)?.updateChannel) {
        demoUpdates = { ...demoUpdates, channel: (payload?.request as SaveSettingsRequest).updateChannel ?? demoUpdates.channel }
      }
      return clone(demoState) as T
    }
    case 'register_source': {
      const request = (payload?.request ?? {}) as RegisterSourceRequest
      const addonId = request.path.split(/[\\/]/).pop()?.replace(/\W+/g, '-').toLowerCase() || `addon-${demoState.addons.length + 1}`
      const displayName = addonId.replace(/-/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase())
      const addon = {
        id: addonId,
        displayName,
        installFolder: displayName.replace(/\s+/g, ''),
        defaultChannel: request.channel ?? 'stable',
        notes: 'Demo registration via browser fallback.',
        dependencies: [],
        conflicts: [],
        savedVariables: [`${displayName.replace(/\s+/g, '')}.lua`],
        isCore: Boolean(request.core),
        currentVersion: '0.1.0-local',
        currentChannel: request.channel ?? 'stable',
        enabledInActiveProfile: true,
        health: 'Ready',
        latestRevisions: [{ id: crypto.randomUUID(), channel: request.channel ?? 'stable', version: '0.1.0-local', createdAt: new Date().toISOString() }],
        sources: [{ id: crypto.randomUUID(), sourceKind: request.sourceKind, location: request.path, channelHint: request.channel ?? 'stable', updatedAt: new Date().toISOString() }],
      }
      demoState = {
        ...demoState,
        addons: [...demoState.addons, addon],
        profiles: demoState.profiles.map((profile) => ({
          ...profile,
          selections: [
            ...profile.selections,
            {
              addonId,
              enabled: profile.isActive,
              channelOverride: null,
            },
          ],
        })),
      }
      return clone(demoState) as T
    }
    case 'create_profile': {
      const request = (payload?.request ?? {}) as CreateProfileRequest
      const id = request.profileId ?? crypto.randomUUID()
      const existing = demoState.profiles.find((profile) => profile.id === id)
      const nextProfile = {
        id,
        name: request.name,
        notes: request.notes ?? null,
        isActive: existing?.isActive ?? false,
        lastUsedAt: existing?.lastUsedAt ?? null,
        selections: request.selections,
      }
      demoState = {
        ...demoState,
        profiles: existing
          ? demoState.profiles.map((profile) => (profile.id === id ? nextProfile : profile))
          : [...demoState.profiles, nextProfile],
      }
      return clone(demoState) as T
    }
    case 'duplicate_profile': {
      const profile = demoState.profiles.find((entry) => entry.id === (payload?.request as { profileId: string })?.profileId)
      if (!profile) return clone(demoState) as T
      const copy = {
        ...profile,
        id: crypto.randomUUID(),
        name: `${profile.name} Copy`,
        isActive: false,
      }
      demoState = { ...demoState, profiles: [...demoState.profiles, copy] }
      return clone(demoState) as T
    }
    case 'switch_profile': {
      const profileId = (payload?.request as { profileId: string })?.profileId
      demoState = {
        ...demoState,
        activeProfileId: profileId,
        profiles: demoState.profiles.map((profile) => ({
          ...profile,
          isActive: profile.id === profileId,
          lastUsedAt: profile.id === profileId ? new Date().toISOString() : profile.lastUsedAt,
        })),
      }
      return clone(demoState) as T
    }
    case 'sync_profile': {
      const request = (payload?.request ?? {}) as SyncProfileRequest
      const preview = syncPreview(request.profileId, request.safeMode ?? false, request.isolateAddonId ?? null)
      if (!request.previewOnly) {
        const activeProfile = demoState.profiles.find((profile) => profile.id === request.profileId)
        demoState = {
          ...demoState,
          activeProfileId: request.profileId,
          profiles: demoState.profiles.map((profile) => ({ ...profile, isActive: profile.id === request.profileId })),
          addons: demoState.addons.map((addon) => {
            const selection = activeProfile?.selections.find((entry) => entry.addonId === addon.id)
            return {
              ...addon,
              enabledInActiveProfile: Boolean(selection?.enabled),
              currentChannel: (selection?.channelOverride ?? addon.defaultChannel) as Channel,
            }
          }),
          snapshots: [
            {
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
              snapshotType: 'recovery',
              relatedProfileId: request.profileId,
              notes: 'Browser fallback sync snapshot.',
              pinned: false,
              sizeBytes: 1024 * 256,
              addonCount: preview.preview.items.length,
            },
            ...demoState.snapshots,
          ],
          logs: [
            {
              id: crypto.randomUUID(),
              operation: 'syncProfile',
              status: 'success',
              message: 'Browser fallback sync applied',
              createdAt: new Date().toISOString(),
            },
            ...demoState.logs,
          ],
        }
        return { ...preview, ok: true, applied: true, operationId: crypto.randomUUID(), snapshotId: demoState.snapshots[0]?.id ?? null, message: 'Sync applied' } as T
      }
      return preview as T
    }
    case 'restore_snapshot': {
      const preview = syncPreview(getActiveProfile().id)
      return { ...preview, applied: Boolean((payload?.request as { previewOnly?: boolean })?.previewOnly) === false, message: 'Snapshot restore ready' } as T
    }
    case 'list_snapshots':
      return clone(demoState.snapshots) as T
    case 'package_revision':
      return 'C:\\Users\\demo\\AppData\\Roaming\\BronzeForge\\exports\\demo.zip' as T
    case 'promote_revision':
      return clone(demoState) as T
    case 'check_updates':
      demoState = {
        ...demoState,
        settings: {
          ...demoState.settings,
          lastUpdateCheckAt: new Date().toISOString(),
          lastUpdateError: null,
        },
      }
      demoUpdates = {
        ...demoUpdates,
        channel: demoState.settings.updateChannel,
        checkedAt: demoState.settings.lastUpdateCheckAt,
        manifestGeneratedAt: new Date().toISOString(),
      }
      return clone(demoUpdates) as T
    case 'apply_remote_addon_update': {
      const request = (payload?.request ?? {}) as { addonId: string; previewOnly?: boolean | null }
      const target = demoUpdates.addons.find((addon) => addon.id === request.addonId)
      if (target) {
        demoState = {
          ...demoState,
          addons: demoState.addons.map((addon) =>
            addon.id === target.id
              ? { ...addon, currentVersion: target.latestVersion, currentChannel: target.channel }
              : addon,
          ),
        }
        demoUpdates = {
          ...demoUpdates,
          addons: demoUpdates.addons.map((addon) =>
            addon.id === target.id
              ? { ...addon, currentVersion: addon.latestVersion, available: false, status: 'up-to-date' }
              : addon,
          ),
        }
      }
      return {
        ...syncPreview(demoState.activeProfileId ?? 'profile-main'),
        applied: !request.previewOnly,
        message: request.previewOnly ? 'Remote addon update preview generated' : 'Remote addon update applied',
      } as T
    }
    case 'install_manager_update': {
      const manager = demoUpdates.manager
      if (!manager) return null as T
      demoUpdates = {
        ...demoUpdates,
        manager: {
          ...manager,
          currentVersion: manager.latestVersion,
          available: false,
          status: 'up-to-date',
          downloadedInstallerPath: 'C:\\Users\\demo\\AppData\\Roaming\\BronzeForge\\staging\\manager-updates\\bronzeforge-manager-windows-x64-installer.exe',
        },
      }
      return clone(demoUpdates.manager) as T
    }
    default:
      return clone(demoState) as T
  }
}

export const api = {
  detectPaths: () => invokeOrDemo<DetectPathsResponse>('detect_paths'),
  saveSettings: (request: SaveSettingsRequest) => invokeOrDemo<ScanStateResponse>('save_settings', { request }),
  scanLiveState: () => invokeOrDemo<ScanStateResponse>('scan_live_state'),
  registerSource: (request: RegisterSourceRequest) => invokeOrDemo<ScanStateResponse>('register_source', { request }),
  refreshSource: (request: { sourceId: string; channel?: Channel | null }) => invokeOrDemo<ScanStateResponse>('refresh_source', { request }),
  importZip: (request: RegisterSourceRequest) => invokeOrDemo<ScanStateResponse>('import_zip', { request }),
  createProfile: (request: CreateProfileRequest) => invokeOrDemo<ScanStateResponse>('create_profile', { request }),
  duplicateProfile: (request: { profileId: string; name?: string | null }) => invokeOrDemo<ScanStateResponse>('duplicate_profile', { request }),
  switchProfile: (request: { profileId: string }) => invokeOrDemo<ScanStateResponse>('switch_profile', { request }),
  syncProfile: (request: SyncProfileRequest) => invokeOrDemo<OperationResponse>('sync_profile', { request }),
  installAddon: (request: { addonId: string; profileId?: string | null; previewOnly?: boolean | null }) => invokeOrDemo<OperationResponse>('install_addon', { request }),
  updateAddon: (request: { addonId: string; profileId?: string | null; previewOnly?: boolean | null }) => invokeOrDemo<OperationResponse>('update_addon', { request }),
  changeChannel: (request: { addonId: string; profileId?: string | null; channel: Channel; previewOnly?: boolean | null }) => invokeOrDemo<OperationResponse>('change_channel', { request }),
  uninstallAddon: (request: { addonId: string; profileId?: string | null; previewOnly?: boolean | null }) => invokeOrDemo<OperationResponse>('uninstall_addon', { request }),
  listSnapshots: () => invokeOrDemo<SnapshotSummary[]>('list_snapshots'),
  restoreSnapshot: (request: { snapshotId: string; previewOnly?: boolean | null }) => invokeOrDemo<OperationResponse>('restore_snapshot', { request }),
  packageRevision: (request: { revisionId?: string | null; addonId?: string | null; channel?: Channel | null }) => invokeOrDemo<string>('package_revision', { request }),
  promoteRevision: (request: { revisionId: string }) => invokeOrDemo<ScanStateResponse>('promote_revision', { request }),
  listUnmanaged: () => invokeOrDemo<ScanStateResponse['unmanaged']>('list_unmanaged'),
  checkUpdates: () => invokeOrDemo<UpdateCheckResponse>('check_updates'),
  applyRemoteAddonUpdate: (request: { addonId: string; profileId?: string | null; previewOnly?: boolean | null }) =>
    invokeOrDemo<OperationResponse>('apply_remote_addon_update', { request }),
  installManagerUpdate: (request?: { productId?: string | null }) =>
    invokeOrDemo<ManagerUpdateStatus>('install_manager_update', { request }),
}

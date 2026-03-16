import { describe, expect, it } from 'vitest'
import type { LauncherStateResponse } from '../../../types'
import type { LauncherPackMember, SnapshotSummary } from '../../../types'
import {
  canAdoptPackMember,
  canAutoSetup,
  canLaunchGame,
  canOpenAddonsFolder,
  descriptionForPackMember,
  findAdoptablePackMemberFolder,
  getPrimaryAction,
  isProtectedAddonsPermissionError,
  labelForPackMember,
  labelForPrimary,
  labelForStatus,
  requiresCandidateSelection,
  showSetupCard,
  toneForPackMember,
  toneForSnapshot,
  toneForStatus,
} from './launcherLogic'

function makeLauncher(overrides: Partial<LauncherStateResponse> = {}): LauncherStateResponse {
  return {
    setupStatus: 'ready',
    packStatus: 'up_to_date',
    actionState: 'idle',
    pack: null,
    pathHealth: { configured: true, detectedCandidates: [], addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null },
    updatesAvailable: 0,
    lastSuccessfulSyncAt: null,
    lastKnownGoodSnapshot: null,
    recoverySnapshots: [],
    unmanagedCollisions: [],
    interruptedOperation: null,
    errorMessage: null,
    settings: {
      ascensionRootPath: null,
      addonsPath: null,
      savedVariablesPath: null,
      backupRetentionCount: 5,
      autoBackupEnabled: true,
      defaultProfileId: null,
      devModeEnabled: false,
      maintainerModeEnabled: false,
      onboardingCompleted: true,
      selectedPackId: null,
      gameExecutablePath: null,
      updateChannel: 'stable',
      lastUpdateCheckAt: null,
      lastUpdateError: null,
      updateManifestOverride: null,
    },
    ...overrides,
  }
}

function makeCandidate(ascensionRootPath: string) {
  return { label: 'Test', ascensionRootPath, addonsPath: null, savedVariablesPath: null }
}

describe('canAutoSetup', () => {
  it('returns true when conditions are met', () => {
    const launcher = makeLauncher({
      setupStatus: 'setup_required',
      pathHealth: { configured: false, detectedCandidates: [makeCandidate('C:/Game')], addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null },
      settings: { ...makeLauncher().settings, onboardingCompleted: false },
    })
    expect(canAutoSetup(launcher, false)).toBe(true)
  })

  it('returns false when autoSetupAttempted is true', () => {
    const launcher = makeLauncher({
      setupStatus: 'setup_required',
      pathHealth: { configured: false, detectedCandidates: [makeCandidate('C:/Game')], addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null },
      settings: { ...makeLauncher().settings, onboardingCompleted: false },
    })
    expect(canAutoSetup(launcher, true)).toBe(false)
  })

  it('returns false when setup is not required', () => {
    const launcher = makeLauncher({
      setupStatus: 'ready',
      pathHealth: { configured: false, detectedCandidates: [makeCandidate('C:/Game')], addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null },
      settings: { ...makeLauncher().settings, onboardingCompleted: false },
    })
    expect(canAutoSetup(launcher, false)).toBe(false)
  })

  it('returns false when onboarding is already completed', () => {
    const launcher = makeLauncher({
      setupStatus: 'setup_required',
      pathHealth: { configured: false, detectedCandidates: [makeCandidate('C:/Game')], addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null },
      settings: { ...makeLauncher().settings, onboardingCompleted: true },
    })
    expect(canAutoSetup(launcher, false)).toBe(false)
  })

  it('returns false when there are zero candidates', () => {
    const launcher = makeLauncher({
      setupStatus: 'setup_required',
      settings: { ...makeLauncher().settings, onboardingCompleted: false },
    })
    expect(canAutoSetup(launcher, false)).toBe(false)
  })

  it('returns false when there are multiple candidates', () => {
    const launcher = makeLauncher({
      setupStatus: 'setup_required',
      pathHealth: {
        configured: false,
        detectedCandidates: [makeCandidate('C:/Game1'), makeCandidate('C:/Game2')],
        addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null,
      },
      settings: { ...makeLauncher().settings, onboardingCompleted: false },
    })
    expect(canAutoSetup(launcher, false)).toBe(false)
  })
})

describe('canLaunchGame', () => {
  it('returns false when gameExecutablePath is null', () => {
    expect(canLaunchGame(makeLauncher())).toBe(false)
  })

  it('returns true when gameExecutablePath is set', () => {
    expect(canLaunchGame(makeLauncher({ pathHealth: { configured: true, detectedCandidates: [], addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: 'C:/Game/wow.exe' } }))).toBe(true)
  })
})

describe('canOpenAddonsFolder', () => {
  it('returns false when addonsPath is null', () => {
    expect(canOpenAddonsFolder(makeLauncher())).toBe(false)
  })

  it('returns true when addonsPath is set', () => {
    expect(canOpenAddonsFolder(makeLauncher({ pathHealth: { configured: true, detectedCandidates: [], addonsPath: 'C:/Game/AddOns', savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null } }))).toBe(true)
  })
})

describe('showSetupCard', () => {
  it('returns true when setup is required', () => {
    expect(showSetupCard(makeLauncher({ setupStatus: 'setup_required' }))).toBe(true)
  })

  it('returns false when setup is not required', () => {
    expect(showSetupCard(makeLauncher({ setupStatus: 'ready' }))).toBe(false)
  })
})

describe('requiresCandidateSelection', () => {
  it('returns false when there is only one candidate', () => {
    const launcher = makeLauncher({ pathHealth: { configured: false, detectedCandidates: [makeCandidate('C:/Game')], addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null } })
    expect(requiresCandidateSelection(launcher, null)).toBe(false)
  })

  it('returns false when there are no candidates', () => {
    expect(requiresCandidateSelection(makeLauncher(), null)).toBe(false)
  })

  it('returns true when multiple candidates and none selected', () => {
    const launcher = makeLauncher({ pathHealth: { configured: false, detectedCandidates: [makeCandidate('C:/Game1'), makeCandidate('C:/Game2')], addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null } })
    expect(requiresCandidateSelection(launcher, null)).toBe(true)
  })

  it('returns false when multiple candidates and one is selected', () => {
    const launcher = makeLauncher({ pathHealth: { configured: false, detectedCandidates: [makeCandidate('C:/Game1'), makeCandidate('C:/Game2')], addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null } })
    expect(requiresCandidateSelection(launcher, 'C:/Game1')).toBe(false)
  })

  it('returns true when selected path does not match any candidate', () => {
    const launcher = makeLauncher({ pathHealth: { configured: false, detectedCandidates: [makeCandidate('C:/Game1'), makeCandidate('C:/Game2')], addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null } })
    expect(requiresCandidateSelection(launcher, 'C:/Stale')).toBe(true)
  })
})

describe('getPrimaryAction', () => {
  it('returns setup when setup is required', () => {
    expect(getPrimaryAction(makeLauncher({ setupStatus: 'setup_required' }))).toBe('setup')
  })

  it('returns recovery when pack status is recovery_needed', () => {
    expect(getPrimaryAction(makeLauncher({ packStatus: 'recovery_needed' }))).toBe('recovery')
  })

  it('setup takes precedence over recovery_needed', () => {
    expect(getPrimaryAction(makeLauncher({ setupStatus: 'setup_required', packStatus: 'recovery_needed' }))).toBe('setup')
  })

  it('returns sync for all other states', () => {
    for (const packStatus of ['ready_to_install', 'syncing', 'up_to_date', 'update_available', 'error'] as const) {
      expect(getPrimaryAction(makeLauncher({ packStatus }))).toBe('sync')
    }
  })
})

describe('labelForPrimary', () => {
  it('returns Complete Setup for setup action', () => {
    expect(labelForPrimary('setup', 'up_to_date')).toBe('Complete Setup')
  })

  it('returns Open Recovery for recovery action', () => {
    expect(labelForPrimary('recovery', 'recovery_needed')).toBe('Open Recovery')
  })

  it('returns Sync Pack Updates when update is available', () => {
    expect(labelForPrimary('sync', 'update_available')).toBe('Sync Pack Updates')
  })

  it('returns Resync Pack when pack is up to date', () => {
    expect(labelForPrimary('sync', 'up_to_date')).toBe('Resync Pack')
  })

  it('returns Install Pack for all other sync states', () => {
    for (const packStatus of ['ready_to_install', 'syncing', 'error', 'recovery_needed'] as const) {
      expect(labelForPrimary('sync', packStatus)).toBe('Install Pack')
    }
  })
})

describe('labelForStatus', () => {
  it('maps each status to its display label', () => {
    expect(labelForStatus('up_to_date')).toBe('Up To Date')
    expect(labelForStatus('update_available')).toBe('Update Available')
    expect(labelForStatus('recovery_needed')).toBe('Recovery Needed')
    expect(labelForStatus('error')).toBe('Blocked')
    expect(labelForStatus('syncing')).toBe('Syncing')
    expect(labelForStatus('ready_to_install')).toBe('Ready To Install')
  })
})

describe('toneForStatus', () => {
  it('returns success for up_to_date', () => {
    expect(toneForStatus('up_to_date')).toBe('success')
  })

  it('returns warning for update_available', () => {
    expect(toneForStatus('update_available')).toBe('warning')
  })

  it('returns danger for recovery_needed', () => {
    expect(toneForStatus('recovery_needed')).toBe('danger')
  })

  it('returns danger for error', () => {
    expect(toneForStatus('error')).toBe('danger')
  })

  it('returns muted for all other states', () => {
    for (const packStatus of ['ready_to_install', 'syncing'] as const) {
      expect(toneForStatus(packStatus)).toBe('muted')
    }
  })
})

function makeMember(overrides: Partial<LauncherPackMember> = {}): LauncherPackMember {
  return {
    addonId: 'addon-1',
    displayName: 'Test Addon',
    installFolder: 'TestAddon',
    required: true,
    installed: false,
    currentVersion: null,
    latestVersion: '1.0.0',
    updateAvailable: false,
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<SnapshotSummary> = {}): SnapshotSummary {
  return {
    id: 'snap-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    snapshotType: 'preflight',
    relatedProfileId: null,
    notes: null,
    pinned: false,
    sizeBytes: 1024,
    addonCount: 3,
    ...overrides,
  }
}

describe('toneForPackMember', () => {
  it('returns warning when update is available', () => {
    expect(toneForPackMember(makeMember({ installed: true, updateAvailable: true }))).toBe('warning')
  })

  it('returns success when installed and no update', () => {
    expect(toneForPackMember(makeMember({ installed: true, updateAvailable: false }))).toBe('success')
  })

  it('returns muted when not installed', () => {
    expect(toneForPackMember(makeMember({ installed: false, updateAvailable: false }))).toBe('muted')
  })

  it('updateAvailable takes precedence over installed', () => {
    expect(toneForPackMember(makeMember({ installed: true, updateAvailable: true }))).toBe('warning')
  })
})

describe('labelForPackMember', () => {
  it('returns Update ready when update is available', () => {
    expect(labelForPackMember(makeMember({ installed: true, updateAvailable: true }))).toBe('Update ready')
  })

  it('returns Installed when installed and no update', () => {
    expect(labelForPackMember(makeMember({ installed: true, updateAvailable: false }))).toBe('Installed')
  })

  it('returns Waiting when not installed', () => {
    expect(labelForPackMember(makeMember({ installed: false, updateAvailable: false }))).toBe('Waiting')
  })

  it('updateAvailable takes precedence over installed', () => {
    expect(labelForPackMember(makeMember({ installed: true, updateAvailable: true }))).toBe('Update ready')
  })
})

describe('descriptionForPackMember', () => {
  it('returns version string when installed', () => {
    expect(descriptionForPackMember(makeMember({ installed: true, currentVersion: '2.3.1' }))).toBe('Installed 2.3.1')
  })

  it('returns not installed message when currentVersion is null', () => {
    expect(descriptionForPackMember(makeMember({ currentVersion: null }))).toBe('Not installed yet')
  })

  it('returns unknown version message when installed without version metadata', () => {
    expect(descriptionForPackMember(makeMember({ installed: true, currentVersion: null }))).toBe('Installed (version unknown)')
  })
})

describe('findAdoptablePackMemberFolder', () => {
  it('returns unmanaged folder with matching install folder', () => {
    const launcher = makeLauncher({
      unmanagedCollisions: [
        { name: 'DingTimer', managed: false, addonId: null, path: 'C:/Game/AddOns/DingTimer' },
      ],
    })

    expect(findAdoptablePackMemberFolder(launcher, makeMember({ installFolder: 'DingTimer' }))).toEqual(
      { name: 'DingTimer', managed: false, addonId: null, path: 'C:/Game/AddOns/DingTimer' },
    )
  })

  it('matches folder names case-insensitively', () => {
    const launcher = makeLauncher({
      unmanagedCollisions: [
        { name: 'DingTimer', managed: false, addonId: null, path: 'C:/Game/AddOns/DingTimer' },
      ],
    })

    expect(findAdoptablePackMemberFolder(launcher, makeMember({ installFolder: 'dingtimer' }))).not.toBeNull()
  })

  it('returns null when addon is already installed', () => {
    const launcher = makeLauncher({
      unmanagedCollisions: [
        { name: 'DingTimer', managed: false, addonId: null, path: 'C:/Game/AddOns/DingTimer' },
      ],
    })

    expect(findAdoptablePackMemberFolder(launcher, makeMember({ installFolder: 'DingTimer', installed: true }))).toBeNull()
  })
})

describe('canAdoptPackMember', () => {
  it('returns true when unmanaged live folder exists for the member', () => {
    const launcher = makeLauncher({
      unmanagedCollisions: [
        { name: 'DingTimer', managed: false, addonId: null, path: 'C:/Game/AddOns/DingTimer' },
      ],
    })

    expect(canAdoptPackMember(launcher, makeMember({ installFolder: 'DingTimer' }))).toBe(true)
  })

  it('returns false when no matching unmanaged folder exists', () => {
    expect(canAdoptPackMember(makeLauncher(), makeMember({ installFolder: 'DingTimer' }))).toBe(false)
  })
})

describe('toneForSnapshot', () => {
  it('returns success for recovery snapshot type', () => {
    expect(toneForSnapshot(makeSnapshot({ snapshotType: 'recovery' }))).toBe('success')
  })

  it('returns muted for non-recovery snapshot types', () => {
    expect(toneForSnapshot(makeSnapshot({ snapshotType: 'preflight' }))).toBe('muted')
    expect(toneForSnapshot(makeSnapshot({ snapshotType: 'manual' }))).toBe('muted')
  })
})

describe('isProtectedAddonsPermissionError', () => {
  it('returns false for null', () => {
    expect(isProtectedAddonsPermissionError(null)).toBe(false)
  })

  it('returns false for unrelated error messages', () => {
    expect(isProtectedAddonsPermissionError('Sync failed: permission denied.')).toBe(false)
    expect(isProtectedAddonsPermissionError('Network error')).toBe(false)
    expect(isProtectedAddonsPermissionError('')).toBe(false)
  })

  it('returns true for the real backend protected location message', () => {
    expect(
      isProtectedAddonsPermissionError(
        "Sync failed: Cannot write to AddOns folder at 'C:\\Program Files\\Ascension Launcher\\resources\\client\\Interface\\AddOns': permission denied. This folder is in a protected location. Try running BronzeForge Manager as administrator, or reinstall Ascension Launcher to a folder outside Program Files (e.g. C:\\Games\\Ascension).",
      ),
    ).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(
      isProtectedAddonsPermissionError(
        'SYNC FAILED: CANNOT WRITE TO ADDONS FOLDER. IN A PROTECTED LOCATION. RUN AS ADMINISTRATOR.',
      ),
    ).toBe(true)
  })

  it('requires all three substrings to match', () => {
    // missing "administrator"
    expect(isProtectedAddonsPermissionError('addons folder in a protected location')).toBe(false)
    // missing "in a protected location"
    expect(isProtectedAddonsPermissionError('addons folder administrator')).toBe(false)
    // missing "addons folder"
    expect(isProtectedAddonsPermissionError('in a protected location administrator')).toBe(false)
  })
})

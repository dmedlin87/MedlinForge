import { describe, expect, it } from 'vitest'
import type { LauncherStateResponse } from '../../../types'
import {
  getPrimaryAction,
  isProtectedAddonsPermissionError,
  labelForPrimary,
  labelForStatus,
  toneForStatus,
} from './launcherLogic'

function makeLauncher(overrides: Partial<LauncherStateResponse> = {}): LauncherStateResponse {
  return {
    setupStatus: 'ready',
    packStatus: 'up_to_date',
    actionState: 'idle',
    pack: null,
    pathHealth: { detectedCandidates: [], addonsPath: null, savedVariablesPath: null, ascensionRootPath: null, gameExecutablePath: null },
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

describe('isProtectedAddonsPermissionError', () => {
  it('returns false for null', () => {
    expect(isProtectedAddonsPermissionError(null)).toBe(false)
  })

  it('returns false for unrelated error messages', () => {
    expect(isProtectedAddonsPermissionError('Sync failed: permission denied.')).toBe(false)
    expect(isProtectedAddonsPermissionError('Network error')).toBe(false)
    expect(isProtectedAddonsPermissionError('')).toBe(false)
  })

  it('returns true for the protected install location message', () => {
    expect(
      isProtectedAddonsPermissionError(
        "Sync failed: Cannot write to AddOns folder at 'C:\\Program Files\\Ascension Launcher\\resources\\client\\Interface\\AddOns': Windows denied access to a protected install location. If Ascension is installed under Program Files, run BronzeForge as Administrator or move the game to a user-writable folder. If the game or launcher is open, close them and try again.",
      ),
    ).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(
      isProtectedAddonsPermissionError(
        'SYNC FAILED: CANNOT WRITE TO ADDONS FOLDER. PROTECTED INSTALL LOCATION. RUN AS ADMINISTRATOR.',
      ),
    ).toBe(true)
  })

  it('requires all three substrings to match', () => {
    // missing "administrator"
    expect(isProtectedAddonsPermissionError('addons folder protected install location')).toBe(false)
    // missing "protected install location"
    expect(isProtectedAddonsPermissionError('addons folder administrator')).toBe(false)
    // missing "addons folder"
    expect(isProtectedAddonsPermissionError('protected install location administrator')).toBe(false)
  })
})

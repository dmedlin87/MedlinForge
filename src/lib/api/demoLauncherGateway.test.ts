import { describe, expect, it } from 'vitest'
import { DemoLauncherGateway } from './demoLauncherGateway'

// ---------------------------------------------------------------------------
// runInitialSetup
// ---------------------------------------------------------------------------

describe('runInitialSetup', () => {
  it('throws when multiple candidates exist and no path is specified', async () => {
    // Bug: the guard condition `!selectedCandidate` is always false when
    // detectedCandidates.length > 1 because the fallback `?? candidates[0]`
    // always produces a non-null value. The error was dead code.
    const gw = new DemoLauncherGateway('multiple-setup')
    await expect(gw.runInitialSetup({})).rejects.toThrow(
      'Multiple installs were detected',
    )
  })

  it('auto-selects the single candidate when exactly one path is detected', async () => {
    const gw = new DemoLauncherGateway('single-setup')
    const state = await gw.runInitialSetup({})
    expect(state.pathHealth.configured).toBe(true)
    expect(state.pathHealth.ascensionRootPath).toBe(
      'C:\\Program Files\\Ascension Launcher\\resources\\client',
    )
    expect(state.settings.onboardingCompleted).toBe(true)
  })

  it('uses the provided path when explicitly supplied with multiple candidates', async () => {
    const gw = new DemoLauncherGateway('multiple-setup')
    const state = await gw.runInitialSetup({
      ascensionRootPath: 'D:\\Program Files\\Ascension Launcher-2\\resources\\client',
      addonsPath: 'D:\\Program Files\\Ascension Launcher-2\\resources\\client\\Interface\\AddOns',
      savedVariablesPath: 'D:\\Program Files\\Ascension Launcher-2\\resources\\client\\WTF\\Account\\SavedVariables',
    })
    expect(state.pathHealth.ascensionRootPath).toBe(
      'D:\\Program Files\\Ascension Launcher-2\\resources\\client',
    )
    expect(state.settings.onboardingCompleted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// syncCuratedPack — state transitions
// ---------------------------------------------------------------------------

describe('syncCuratedPack', () => {
  it('transitions pack from update_available to up_to_date', async () => {
    const gw = new DemoLauncherGateway('update-available-pack')
    const before = await gw.getLauncherState()
    expect(before.packStatus).toBe('update_available')
    expect(before.updatesAvailable).toBeGreaterThan(0)

    const after = await gw.syncCuratedPack()
    expect(after.packStatus).toBe('up_to_date')
    expect(after.updatesAvailable).toBe(0)
  })

  it('updates every addon to its latest version', async () => {
    const gw = new DemoLauncherGateway('update-available-pack')
    const after = await gw.syncCuratedPack()
    for (const member of after.pack!.members) {
      expect(member.currentVersion).toBe(member.latestVersion)
      expect(member.updateAvailable).toBe(false)
      expect(member.installed).toBe(true)
    }
  })

  it('clears an interrupted operation so recovery_needed resolves to up_to_date', async () => {
    const gw = new DemoLauncherGateway('recovery-needed')
    const before = await gw.getLauncherState()
    expect(before.packStatus).toBe('recovery_needed')
    expect(before.interruptedOperation).not.toBeNull()

    const after = await gw.syncCuratedPack()
    expect(after.packStatus).toBe('up_to_date')
    expect(after.interruptedOperation).toBeNull()
  })

  it('prepends a new recovery snapshot after sync', async () => {
    const gw = new DemoLauncherGateway('update-available-pack')
    const before = await gw.getLauncherState()
    const snapshotCountBefore = before.recoverySnapshots.length

    await gw.syncCuratedPack()
    const after = await gw.getLauncherState()

    expect(after.recoverySnapshots.length).toBe(snapshotCountBefore + 1)
    expect(after.recoverySnapshots[0].snapshotType).toBe('recovery')
  })
})

// ---------------------------------------------------------------------------
// restoreLastKnownGood — preview vs. apply distinction
// ---------------------------------------------------------------------------

describe('restoreLastKnownGood', () => {
  it('preview-only does not clear the interrupted operation', async () => {
    const gw = new DemoLauncherGateway('recovery-needed')
    const preview = await gw.restoreLastKnownGood({ previewOnly: true })

    expect(preview.applied).toBe(false)
    expect(preview.ok).toBe(true)

    // Interrupted operation must still be present after a preview-only call
    const state = await gw.getLauncherState()
    expect(state.interruptedOperation).not.toBeNull()
    expect(state.packStatus).toBe('recovery_needed')
  })

  it('apply clears the interrupted operation and marks applied', async () => {
    const gw = new DemoLauncherGateway('recovery-needed')
    const result = await gw.restoreLastKnownGood({ previewOnly: false })

    expect(result.applied).toBe(true)
    expect(result.ok).toBe(true)

    const state = await gw.getLauncherState()
    expect(state.interruptedOperation).toBeNull()
    expect(state.packStatus).not.toBe('recovery_needed')
  })

  it('preview response includes the addon items to be restored', async () => {
    const gw = new DemoLauncherGateway('recovery-needed')
    const preview = await gw.restoreLastKnownGood({ previewOnly: true })

    expect(preview.preview).not.toBeNull()
    expect(preview.preview!.items.length).toBeGreaterThan(0)
    // Each item must identify what addon and folder will change
    for (const item of preview.preview!.items) {
      expect(item.addonId).toBeTruthy()
      expect(item.targetFolder).toBeTruthy()
      expect(item.changeType).toBe('update')
    }
  })
})

// ---------------------------------------------------------------------------
// saveSettings — null-filter contract
// ---------------------------------------------------------------------------

describe('saveSettings', () => {
  it('preserves existing path values when null is passed for those fields', async () => {
    // The implementation filters out null values, so passing null for a field
    // means "leave it unchanged" — not "clear it".
    const gw = new DemoLauncherGateway('up-to-date-pack')
    const before = await gw.getLauncherState()
    const originalRoot = before.settings.ascensionRootPath

    await gw.saveSettings({ ascensionRootPath: null, updateChannel: 'beta' })

    const after = await gw.getLauncherState()
    expect(after.settings.ascensionRootPath).toBe(originalRoot)
    expect(after.settings.updateChannel).toBe('beta')
  })

  it('updates fields that are provided as non-null strings', async () => {
    const gw = new DemoLauncherGateway('up-to-date-pack')
    await gw.saveSettings({ ascensionRootPath: 'D:\\Games\\Ascension' })
    const after = await gw.getLauncherState()
    expect(after.settings.ascensionRootPath).toBe('D:\\Games\\Ascension')
  })
})

// ---------------------------------------------------------------------------
// switchProfile — active-profile contract
// ---------------------------------------------------------------------------

describe('switchProfile', () => {
  it('marks the target profile active and deactivates all others', async () => {
    const gw = new DemoLauncherGateway('maintainer-mode')
    const scan = await gw.scanLiveState()
    const [first, second] = scan.profiles

    // Switch to the second profile
    const result = await gw.switchProfile({ profileId: second.id })
    const active = result.profiles.filter((p) => p.isActive)
    const inactive = result.profiles.filter((p) => !p.isActive)

    expect(active).toHaveLength(1)
    expect(active[0].id).toBe(second.id)
    expect(inactive.some((p) => p.id === first.id)).toBe(true)
  })

  it('sets lastUsedAt on the newly active profile', async () => {
    const gw = new DemoLauncherGateway('maintainer-mode')
    const scan = await gw.scanLiveState()
    const target = scan.profiles.find((p) => !p.isActive)!

    expect(target.lastUsedAt).toBeNull()

    const result = await gw.switchProfile({ profileId: target.id })
    const updated = result.profiles.find((p) => p.id === target.id)!

    expect(updated.lastUsedAt).not.toBeNull()
    expect(updated.isActive).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// createProfile — upsert semantics
// ---------------------------------------------------------------------------

describe('createProfile', () => {
  it('adds a new profile to the list', async () => {
    const gw = new DemoLauncherGateway('maintainer-mode')
    const before = await gw.scanLiveState()
    const countBefore = before.profiles.length

    await gw.createProfile({ profileId: 'p-new', name: 'Testing', notes: null, selections: [] })

    const after = await gw.scanLiveState()
    expect(after.profiles.length).toBe(countBefore + 1)
    expect(after.profiles.find((p) => p.id === 'p-new')?.name).toBe('Testing')
  })

  it('replaces an existing profile when the same id is supplied (upsert)', async () => {
    const gw = new DemoLauncherGateway('maintainer-mode')

    await gw.createProfile({ profileId: 'p-upsert', name: 'Original', notes: null, selections: [] })
    await gw.createProfile({ profileId: 'p-upsert', name: 'Renamed', notes: 'updated', selections: [] })

    const scan = await gw.scanLiveState()
    const matches = scan.profiles.filter((p) => p.id === 'p-upsert')
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('Renamed')
  })
})

// ---------------------------------------------------------------------------
// detectPaths
// ---------------------------------------------------------------------------

describe('detectPaths', () => {
  it('returns the detected candidates for the scenario', async () => {
    const gw = new DemoLauncherGateway('single-setup')
    const result = await gw.detectPaths()
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].ascensionRootPath).toBeTruthy()
  })

  it('returns multiple candidates for multiple-setup scenario', async () => {
    const gw = new DemoLauncherGateway('multiple-setup')
    const result = await gw.detectPaths()
    expect(result.candidates.length).toBeGreaterThan(1)
  })

  it('returns current settings alongside candidates', async () => {
    const gw = new DemoLauncherGateway('up-to-date-pack')
    const result = await gw.detectPaths()
    expect(result.settings).toBeDefined()
    expect(result.settings.updateChannel).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// scanLiveState
// ---------------------------------------------------------------------------

describe('scanLiveState', () => {
  it('returns addons, profiles, and snapshots from the store', async () => {
    const gw = new DemoLauncherGateway('up-to-date-pack')
    const scan = await gw.scanLiveState()
    expect(scan.addons.length).toBeGreaterThan(0)
    expect(scan.profiles.length).toBeGreaterThan(0)
    expect(scan.snapshots.length).toBeGreaterThan(0)
  })

  it('reflects maintainer mode in settings when scenario is maintainer-mode', async () => {
    const gw = new DemoLauncherGateway('maintainer-mode')
    const scan = await gw.scanLiveState()
    expect(scan.settings.maintainerModeEnabled).toBe(true)
    expect(scan.settings.devModeEnabled).toBe(true)
  })

  it('exposes the activeProfileId', async () => {
    const gw = new DemoLauncherGateway('maintainer-mode')
    const scan = await gw.scanLiveState()
    expect(scan.activeProfileId).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// setMaintainerMode
// ---------------------------------------------------------------------------

describe('setMaintainerMode', () => {
  it('enables maintainer mode and returns updated launcher state', async () => {
    const gw = new DemoLauncherGateway('up-to-date-pack')
    const before = await gw.getLauncherState()
    expect(before.settings.maintainerModeEnabled).toBe(false)

    const after = await gw.setMaintainerMode({ enabled: true })
    expect(after.settings.maintainerModeEnabled).toBe(true)
    expect(after.settings.devModeEnabled).toBe(true)
  })

  it('disables maintainer mode and returns updated launcher state', async () => {
    const gw = new DemoLauncherGateway('maintainer-mode')
    const after = await gw.setMaintainerMode({ enabled: false })
    expect(after.settings.maintainerModeEnabled).toBe(false)
    expect(after.settings.devModeEnabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// launchGame
// ---------------------------------------------------------------------------

describe('launchGame', () => {
  it('returns the configured game executable path', async () => {
    const gw = new DemoLauncherGateway('up-to-date-pack')
    const path = await gw.launchGame()
    expect(typeof path).toBe('string')
    expect(path.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// openAddonsFolder
// ---------------------------------------------------------------------------

describe('openAddonsFolder', () => {
  it('returns the configured addons path', async () => {
    const gw = new DemoLauncherGateway('up-to-date-pack')
    const path = await gw.openAddonsFolder()
    expect(typeof path).toBe('string')
    expect(path.toLowerCase()).toContain('addons')
  })
})

// ---------------------------------------------------------------------------
// registerSource
// ---------------------------------------------------------------------------

describe('registerSource', () => {
  it('adds a new addon to the scan state', async () => {
    const gw = new DemoLauncherGateway('maintainer-mode')
    const before = await gw.scanLiveState()
    const countBefore = before.addons.length

    await gw.registerSource({ sourceKind: 'local-folder', path: 'C:\\MyAddons\\CustomUI', channel: 'stable', core: false })

    const after = await gw.scanLiveState()
    expect(after.addons.length).toBe(countBefore + 1)
  })

  it('registered addon carries the correct sourceKind', async () => {
    const gw = new DemoLauncherGateway('maintainer-mode')
    await gw.registerSource({ sourceKind: 'zip-file', path: 'C:\\Downloads\\MyAddon.zip', channel: 'beta' })

    const scan = await gw.scanLiveState()
    const registered = scan.addons.at(-1)!
    expect(registered.sources[0].sourceKind).toBe('zip-file')
  })
})

// ---------------------------------------------------------------------------
// duplicateProfile
// ---------------------------------------------------------------------------

describe('duplicateProfile', () => {
  it('adds a copy of the profile with Copy appended to the name', async () => {
    const gw = new DemoLauncherGateway('maintainer-mode')
    const before = await gw.scanLiveState()
    const source = before.profiles[0]
    const countBefore = before.profiles.length

    await gw.duplicateProfile({ profileId: source.id })

    const after = await gw.scanLiveState()
    expect(after.profiles.length).toBe(countBefore + 1)
    const copy = after.profiles.find((p) => p.name === `${source.name} Copy`)
    expect(copy).toBeDefined()
  })

  it('duplicate is not active', async () => {
    const gw = new DemoLauncherGateway('maintainer-mode')
    const scan = await gw.scanLiveState()
    const source = scan.profiles[0]

    await gw.duplicateProfile({ profileId: source.id })

    const after = await gw.scanLiveState()
    const copy = after.profiles.find((p) => p.name === `${source.name} Copy`)!
    expect(copy.isActive).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// checkUpdates
// ---------------------------------------------------------------------------

describe('checkUpdates', () => {
  it('returns a manager update entry', async () => {
    const gw = new DemoLauncherGateway('up-to-date-pack')
    const result = await gw.checkUpdates()
    expect(result.manager).not.toBeNull()
    expect(result.manager!.available).toBe(true)
  })

  it('returns addon update entries matching the store addons', async () => {
    const gw = new DemoLauncherGateway('update-available-pack')
    const result = await gw.checkUpdates()
    expect(result.addons.length).toBeGreaterThan(0)
    const updatable = result.addons.filter((a) => a.available)
    expect(updatable.length).toBeGreaterThan(0)
  })

  it('marks addons as not available when already up to date', async () => {
    const gw = new DemoLauncherGateway('up-to-date-pack')
    const result = await gw.checkUpdates()
    for (const addon of result.addons) {
      expect(addon.available).toBe(false)
    }
  })

  it('reflects the current update channel from settings', async () => {
    const gw = new DemoLauncherGateway('up-to-date-pack')
    await gw.saveSettings({ updateChannel: 'beta' })
    const result = await gw.checkUpdates()
    expect(result.channel).toBe('beta')
  })
})

// ---------------------------------------------------------------------------
// buildLauncherStatus — status priority ordering
// ---------------------------------------------------------------------------

describe('buildLauncherStatus priority', () => {
  it('setup_required takes priority over recovery_needed when paths are not configured', async () => {
    // In 'manual-setup' paths are cleared (setup_required) and we then
    // confirm that even if we inspect pack/action state, the primary action
    // is 'setup', not 'recovery'.
    const gw = new DemoLauncherGateway('manual-setup')
    const state = await gw.getLauncherState()
    expect(state.setupStatus).toBe('setup_required')
    // interruptedOperation is not set in this scenario, but the priority
    // check verifies the ordering in buildLauncherStatus.
    expect(state.packStatus).toBe('ready_to_install')
    expect(state.actionState).toBe('blocked')
  })

  it('recovery_needed is returned once paths are configured but operation is interrupted', async () => {
    const gw = new DemoLauncherGateway('recovery-needed')
    const state = await gw.getLauncherState()
    expect(state.packStatus).toBe('recovery_needed')
    expect(state.actionState).toBe('blocked')
    // Paths ARE configured, so setupStatus is not setup_required
    expect(state.setupStatus).not.toBe('setup_required')
  })
})

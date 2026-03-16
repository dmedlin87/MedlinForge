import type { LauncherPackMember, LauncherStateResponse, SnapshotSummary } from '../../../types'

export function canAutoSetup(launcher: LauncherStateResponse, autoSetupAttempted: boolean): boolean {
  return (
    launcher.setupStatus === 'setup_required' &&
    !launcher.settings.onboardingCompleted &&
    launcher.pathHealth.detectedCandidates.length === 1 &&
    !autoSetupAttempted
  )
}

export function canLaunchGame(launcher: LauncherStateResponse): boolean {
  return launcher.pathHealth.gameExecutablePath !== null
}

export function canOpenAddonsFolder(launcher: LauncherStateResponse): boolean {
  return launcher.pathHealth.addonsPath !== null
}

export function showSetupCard(launcher: LauncherStateResponse): boolean {
  return launcher.setupStatus === 'setup_required'
}

export function requiresCandidateSelection(launcher: LauncherStateResponse, selectedPath: string | null): boolean {
  const { detectedCandidates } = launcher.pathHealth
  if (detectedCandidates.length <= 1) return false
  return !detectedCandidates.some((c) => c.ascensionRootPath === selectedPath)
}

export function getPrimaryAction(launcher: LauncherStateResponse): 'setup' | 'recovery' | 'sync' {
  if (launcher.setupStatus === 'setup_required') return 'setup'
  if (launcher.packStatus === 'recovery_needed') return 'recovery'
  return 'sync'
}

export function labelForPrimary(primary: string, packStatus: LauncherStateResponse['packStatus']): string {
  if (primary === 'setup') return 'Complete Setup'
  if (primary === 'recovery') return 'Open Recovery'
  return packStatus === 'update_available' ? 'Sync Pack Updates' : packStatus === 'up_to_date' ? 'Resync Pack' : 'Install Pack'
}

export function labelForStatus(status: LauncherStateResponse['packStatus']): string {
  return status === 'up_to_date' ? 'Up To Date' : status === 'update_available' ? 'Update Available' : status === 'recovery_needed' ? 'Recovery Needed' : status === 'error' ? 'Blocked' : status === 'syncing' ? 'Syncing' : 'Ready To Install'
}

export function toneForStatus(status: LauncherStateResponse['packStatus']): 'success' | 'warning' | 'danger' | 'muted' {
  return status === 'up_to_date' ? 'success' : status === 'update_available' ? 'warning' : status === 'recovery_needed' || status === 'error' ? 'danger' : 'muted'
}

export function toneForPackMember(member: LauncherPackMember): 'warning' | 'success' | 'muted' {
  return member.updateAvailable ? 'warning' : member.installed ? 'success' : 'muted'
}

export function labelForPackMember(member: LauncherPackMember): string {
  return member.updateAvailable ? 'Update ready' : member.installed ? 'Installed' : 'Waiting'
}

export function descriptionForPackMember(member: LauncherPackMember): string {
  return member.currentVersion ? `Installed ${member.currentVersion}` : 'Not installed yet'
}

export function toneForSnapshot(snapshot: SnapshotSummary): 'success' | 'muted' {
  return snapshot.snapshotType === 'recovery' ? 'success' : 'muted'
}

export function isProtectedAddonsPermissionError(message: string | null): boolean {
  const normalized = message?.toLowerCase()
  return Boolean(
    normalized
    && normalized.includes('addons folder')
    && normalized.includes('in a protected location')
    && normalized.includes('administrator'),
  )
}

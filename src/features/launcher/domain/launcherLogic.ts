import type { LauncherStateResponse } from '../../../types'

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

export function isProtectedAddonsPermissionError(message: string | null): boolean {
  const normalized = message?.toLowerCase()
  return Boolean(
    normalized
    && normalized.includes('addons folder')
    && normalized.includes('protected install location')
    && normalized.includes('administrator'),
  )
}

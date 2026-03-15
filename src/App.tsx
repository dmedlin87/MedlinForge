import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Boxes,
  FolderOpen,
  Loader2,
  Play,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react'
import clsx from 'clsx'

import { api } from './lib/api'
import { formatBytes, formatWhen } from './lib/format'
import {
  canAutoSetup,
  canLaunchGame,
  canOpenAddonsFolder,
  getPrimaryAction,
  isProtectedAddonsPermissionError,
  labelForPrimary,
  labelForStatus,
  requiresCandidateSelection,
  showSetupCard,
  toneForStatus,
} from './features/launcher/domain/launcherLogic'
import type {
  Channel,
  DetectPathCandidate,
  LauncherStateResponse,
  OperationResponse,
  SaveSettingsRequest,
  ScanStateResponse,
} from './types'

type Screen = 'home' | 'recovery' | 'settings' | 'addons' | 'profiles' | 'developer'

const playerScreens: Array<{ id: Screen; label: string; icon: typeof Boxes }> = [
  { id: 'home', label: 'Home', icon: Boxes },
  { id: 'recovery', label: 'Recovery', icon: RotateCcw },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

const maintainerScreens: Array<{ id: Screen; label: string; icon: typeof Boxes }> = [
  { id: 'addons', label: 'Addons', icon: ShieldCheck },
  { id: 'profiles', label: 'Profiles', icon: Users },
  { id: 'developer', label: 'Developer', icon: Wrench },
]

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [launcher, setLauncher] = useState<LauncherStateResponse | null>(null)
  const [advanced, setAdvanced] = useState<ScanStateResponse | null>(null)
  const [restorePreview, setRestorePreview] = useState<OperationResponse | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<SaveSettingsRequest>({
    ascensionRootPath: '',
    addonsPath: '',
    savedVariablesPath: '',
    gameExecutablePath: '',
    updateChannel: 'stable',
  })
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [newProfileName, setNewProfileName] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [sourceKind, setSourceKind] = useState<'manifest' | 'local-folder' | 'zip-file'>('manifest')
  const [sourceChannel, setSourceChannel] = useState<Channel>('stable')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [autoSetupAttempted, setAutoSetupAttempted] = useState(false)
  const [autoSetupFailed, setAutoSetupFailed] = useState(false)
  const setupInProgress = useRef(false)

  const maintainerMode = launcher?.settings.maintainerModeEnabled ?? false
  const screens = maintainerMode ? [...playerScreens, ...maintainerScreens] : playerScreens
  const showProtectedAddonsRecovery = isProtectedAddonsPermissionError(error)

  const changeScreen = useCallback((next: Screen) => {
    setScreen((current) => {
      if (current === 'recovery' && next !== 'recovery') setRestorePreview(null)
      return next
    })
  }, [])

  const refresh = useCallback(async (showSpinner = false) => {
    try {
      if (showSpinner) setLoading(true)
      setError(null)
      const next = await api.getLauncherState()
      setLauncher(next)
      setSettingsDraft({
        ascensionRootPath: next.settings.ascensionRootPath ?? '',
        addonsPath: next.settings.addonsPath ?? '',
        savedVariablesPath: next.settings.savedVariablesPath ?? '',
        gameExecutablePath: next.settings.gameExecutablePath ?? '',
        maintainerModeEnabled: next.settings.maintainerModeEnabled,
        updateChannel: next.settings.updateChannel,
      })
      if (next.settings.maintainerModeEnabled) {
        setAdvanced(await api.scanLiveState())
      } else {
        setAdvanced(null)
        setScreen((current) =>
          playerScreens.some((entry) => entry.id === current) ? current : 'home',
        )
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load BronzeForge launcher state.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await refresh(true)
    })()
  }, [refresh])

  const completeSetup = useCallback(async (candidate?: DetectPathCandidate) => {
    if (setupInProgress.current) return
    setupInProgress.current = true
    try {
      const next = await run(
        'setup',
        () =>
          api.runInitialSetup({
            ascensionRootPath: candidate?.ascensionRootPath ?? settingsDraft.ascensionRootPath ?? null,
            addonsPath: candidate?.addonsPath ?? settingsDraft.addonsPath ?? null,
            savedVariablesPath: candidate?.savedVariablesPath ?? settingsDraft.savedVariablesPath ?? null,
            gameExecutablePath: settingsDraft.gameExecutablePath ?? null,
          }),
        'Launcher setup saved.',
      )
      if (next) {
        setLauncher(next)
        setAutoSetupFailed(false)
      } else {
        setAutoSetupFailed(true)
      }
    } finally {
      setupInProgress.current = false
    }
  }, [settingsDraft])

  useEffect(() => {
    if (launcher && canAutoSetup(launcher, autoSetupAttempted)) {
      setAutoSetupAttempted(true)
      void completeSetup(launcher.pathHealth.detectedCandidates[0])
    }
  }, [launcher, autoSetupAttempted, completeSetup])

  async function run<T>(label: string, action: () => Promise<T>, success?: string) {
    try {
      setWorking(label)
      setError(null)
      setNotice(null)
      const result = await action()
      if (success) setNotice(success)
      return result
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : `${label} failed.`
      setError(`${label.charAt(0).toUpperCase() + label.slice(1)} failed: ${message}`)
      return null
    } finally {
      setWorking(null)
    }
  }

  async function syncPack() {
    const next = await run('sync', () => api.syncCuratedPack(), 'Pack synced.')
    if (next) await refresh()
  }

  async function previewRestore() {
    const response = await run('restore preview', () => api.restoreLastKnownGood({ previewOnly: true }))
    if (response) setRestorePreview(response)
  }

  async function applyRestore() {
    const response = await run('restore', () => api.restoreLastKnownGood({ previewOnly: false }), 'Recovered pack snapshot.')
    if (response) {
      setRestorePreview(null)
      await refresh()
    }
  }

  async function saveSettings() {
    const response = await run(
      'settings',
      () =>
        api.saveSettings({
          ascensionRootPath: settingsDraft.ascensionRootPath || null,
          addonsPath: settingsDraft.addonsPath || null,
          savedVariablesPath: settingsDraft.savedVariablesPath || null,
          gameExecutablePath: settingsDraft.gameExecutablePath || null,
          updateChannel: settingsDraft.updateChannel ?? 'stable',
        }),
      'Settings saved.',
    )
    if (response) await refresh()
  }

  async function toggleMaintainerMode(enabled: boolean) {
    const next = await run('maintainer mode', () => api.setMaintainerMode({ enabled }), enabled ? 'Maintainer mode enabled.' : 'Maintainer mode disabled.')
    if (next) await refresh()
  }

  if (loading && !launcher) return <Frame screens={screens} screen={screen} onScreen={changeScreen}><State icon={Loader2} title="Loading BronzeForge" body="Pulling launcher state." spin /></Frame>
  if (!launcher) return <Frame screens={screens} screen={screen} onScreen={changeScreen}><State icon={AlertTriangle} title="Launcher unavailable" body={error ?? 'BronzeForge could not load.'} /></Frame>

  const pack = launcher.pack
  const primary = getPrimaryAction(launcher)

  return (
    <Frame screens={screens} screen={screen} onScreen={changeScreen}>
      <div className="space-y-6">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {showProtectedAddonsRecovery ? (
          <Banner tone="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>BronzeForge needs elevated access for this AddOns location. Run BronzeForge as Administrator, or update the AddOns path to a user-writable install in Settings.</p>
              <div className="flex flex-wrap gap-3">
                <button className="button-secondary" disabled={working !== null} onClick={() => changeScreen('settings')}>
                  Review Paths
                </button>
                {canOpenAddonsFolder(launcher) ? (
                  <button className="button-secondary" disabled={working !== null} onClick={() => void run('open addons folder', () => api.openAddonsFolder())}>
                    <FolderOpen className="size-4" />
                    Open AddOns Folder
                  </button>
                ) : null}
              </div>
            </div>
          </Banner>
        ) : null}
        {notice ? <Banner tone="success">{notice}</Banner> : null}

        {screen === 'home' ? (
          <div className="space-y-6">
            <Card title={pack?.name ?? 'BronzeForge Pack'} subtitle={pack?.description ?? 'Curated pack status'} accent>
              <div className="flex flex-wrap gap-3">
                <Pill tone={toneForStatus(launcher.packStatus)}>{labelForStatus(launcher.packStatus)}</Pill>
                <Pill tone="muted">{launcher.updatesAvailable} updates queued</Pill>
                <Pill tone="muted">Last sync {formatWhen(launcher.lastSuccessfulSyncAt)}</Pill>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button className="button-primary" onClick={() => {
                  if (primary === 'setup') {
                    const candidate = launcher.pathHealth.detectedCandidates.find((entry) => entry.ascensionRootPath === selectedCandidate)
                    if (requiresCandidateSelection(launcher, selectedCandidate)) {
                      setError('Select an install before continuing setup.')
                      return
                    }
                    void completeSetup(candidate)
                  } else if (primary === 'recovery') {
                    changeScreen('recovery')
                  } else {
                    void syncPack()
                  }
                }} disabled={working !== null}>
                  {working ? <Loader2 className="size-4 animate-spin" /> : null}
                  {labelForPrimary(primary, launcher.packStatus)}
                </button>
                {canOpenAddonsFolder(launcher) ? (
                  <button className="button-secondary" disabled={working !== null} onClick={() => void run('open addons folder', () => api.openAddonsFolder())}>
                    <FolderOpen className="size-4" />
                    Open AddOns Folder
                  </button>
                ) : null}
                {canLaunchGame(launcher) ? (
                  <button className="button-secondary" disabled={working !== null} onClick={() => void run('launch game', () => api.launchGame())}>
                    <Play className="size-4" />
                    Launch Game
                  </button>
                ) : null}
              </div>
            </Card>

            {showSetupCard(launcher) ? (
              <Card title="Setup" subtitle={launcher.pathHealth.detectedCandidates.length ? 'BronzeForge found install candidates.' : 'No install was detected automatically.'}>
                {launcher.pathHealth.detectedCandidates.length ? (
                  <div className="grid gap-3">
                    {launcher.pathHealth.detectedCandidates.map((candidate) => (
                      <button key={candidate.ascensionRootPath} className={clsx('rounded-3xl border p-4 text-left', selectedCandidate === candidate.ascensionRootPath ? 'border-[#d9b88d] bg-[#d9b88d]/10' : 'border-white/10 bg-black/20')} onClick={() => setSelectedCandidate(candidate.ascensionRootPath)}>
                        <p className="text-sm font-semibold text-[#f8eee2]">{candidate.label}</p>
                        <p className="text-xs text-[#d0c0ae]">{candidate.ascensionRootPath}</p>
                      </button>
                    ))}
                    {launcher.pathHealth.detectedCandidates.length > 1 ? <p className="text-sm text-[#d0c0ae]">Select an install, then use Complete Setup.</p> : null}
                    {autoSetupFailed ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-sm text-[#e8a87c]">Auto-setup did not succeed. You can retry or configure paths manually in Settings.</p>
                        <button className="button-secondary" disabled={working !== null} onClick={() => {
                          const candidate = launcher.pathHealth.detectedCandidates.find((entry) => entry.ascensionRootPath === selectedCandidate) ?? launcher.pathHealth.detectedCandidates[0]
                          void completeSetup(candidate)
                        }}>Retry Setup</button>
                        <button className="button-secondary" disabled={working !== null} onClick={() => changeScreen('settings')}>Open Settings</button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <p className="text-sm text-[#d0c0ae]">BronzeForge searched common locations but could not find an Ascension installation. Enter the paths manually in Settings, or install Ascension and retry.</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <button className="button-primary" onClick={() => changeScreen('settings')}>Open Settings</button>
                      <button className="button-secondary" disabled={working !== null} onClick={() => void refresh(true)}>Re-scan</button>
                    </div>
                  </div>
                )}
              </Card>
            ) : null}

            <Card title="Pack Breakdown" subtitle="What the launcher will keep in sync.">
              <div className="grid gap-3 md:grid-cols-2">
                {(pack?.members ?? []).map((member) => (
                  <div key={member.addonId} className="rounded-3xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[#f8eee2]">{member.displayName}</p>
                        <p className="text-xs text-[#d0c0ae]">{member.currentVersion ? `Installed ${member.currentVersion}` : 'Not installed yet'}</p>
                      </div>
                      <Pill tone={member.updateAvailable ? 'warning' : member.installed ? 'success' : 'muted'}>
                        {member.updateAvailable ? 'Update ready' : member.installed ? 'Installed' : 'Waiting'}
                      </Pill>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}

        {screen === 'recovery' ? (
          <div className="space-y-6">
            <Card title={pack?.recoveryLabel ?? 'Restore last known good'} subtitle={pack?.recoveryDescription ?? 'Roll back to the latest working pack snapshot.'}>
              <div className="flex flex-wrap items-center gap-3">
                <button className="button-primary" disabled={working !== null} onClick={() => void previewRestore()}>Preview Restore</button>
                <p className="text-sm text-[#d0c0ae]">Last known good: {formatWhen(launcher.lastKnownGoodSnapshot?.createdAt ?? null)}</p>
              </div>
            </Card>
            {restorePreview ? (
              <Card title="Restore Preview" subtitle="Folders and settings that will be restored.">
                <div className="grid gap-3 md:grid-cols-2">
                  {restorePreview.preview.items.map((item) => (
                    <div key={`${item.addonId}-${item.targetFolder}`} className="rounded-3xl border border-white/10 bg-black/20 p-4">
                      <p className="text-sm font-semibold text-[#f8eee2]">{item.displayName}</p>
                      <p className="text-xs text-[#d0c0ae]">{item.targetFolder}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex gap-3">
                  <button className="button-primary" disabled={working !== null} onClick={() => void applyRestore()}>Restore Last Known Good</button>
                  <button className="button-secondary" disabled={working !== null} onClick={() => setRestorePreview(null)}>Cancel</button>
                </div>
              </Card>
            ) : null}
            <Card title="Snapshots" subtitle="Recent recovery points.">
              <div className="space-y-3">
                {launcher.recoverySnapshots.map((snapshot) => (
                  <div key={snapshot.id} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-black/20 p-4">
                    <div>
                      <p className="text-sm font-semibold text-[#f8eee2]">{snapshot.notes ?? snapshot.snapshotType}</p>
                      <p className="text-xs text-[#d0c0ae]">{formatWhen(snapshot.createdAt)} · {formatBytes(snapshot.sizeBytes)} · {snapshot.addonCount} items</p>
                    </div>
                    <Pill tone={snapshot.snapshotType === 'recovery' ? 'success' : 'muted'}>{snapshot.snapshotType}</Pill>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}

        {screen === 'settings' ? (
          <div className="space-y-6">
            <Card title="Player Setup" subtitle="Keep the launcher paths obvious and minimal.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Ascension Root" value={settingsDraft.ascensionRootPath ?? ''} onChange={(value) => setSettingsDraft((current) => ({ ...current, ascensionRootPath: value }))} />
                <Field label="AddOns Folder" value={settingsDraft.addonsPath ?? ''} onChange={(value) => setSettingsDraft((current) => ({ ...current, addonsPath: value }))} />
                <Field label="SavedVariables Folder" value={settingsDraft.savedVariablesPath ?? ''} onChange={(value) => setSettingsDraft((current) => ({ ...current, savedVariablesPath: value }))} />
                <Field label="Game Executable" value={settingsDraft.gameExecutablePath ?? ''} onChange={(value) => setSettingsDraft((current) => ({ ...current, gameExecutablePath: value }))} />
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button className="button-primary" disabled={working !== null} onClick={() => void saveSettings()}>Save Settings</button>
                <button className={maintainerMode ? 'button-secondary' : 'button-primary'} disabled={working !== null} onClick={() => void toggleMaintainerMode(!maintainerMode)}>
                  {maintainerMode ? 'Disable Maintainer Mode' : 'Enable Maintainer Mode'}
                </button>
              </div>
            </Card>
          </div>
        ) : null}

        {screen === 'addons' && maintainerMode ? <ListCard title="Managed Addons" items={(advanced?.addons ?? []).map((addon) => ({ id: addon.id, label: `${addon.displayName} · ${addon.currentVersion ?? 'not installed'}` }))} /> : null}
        {screen === 'profiles' && maintainerMode ? (
          <div className="space-y-6">
            <Card title="Profiles" subtitle="Advanced-only profile tooling.">
              <div className="space-y-3">
                {(advanced?.profiles ?? []).map((profile) => (
                  <div key={profile.id} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-black/20 p-4">
                    <div>
                      <p className="text-sm font-semibold text-[#f8eee2]">{profile.name}</p>
                      <p className="text-xs text-[#d0c0ae]">Last used {formatWhen(profile.lastUsedAt)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="button-secondary" disabled={working !== null} onClick={async () => { const result = await run('switch profile', () => api.switchProfile({ profileId: profile.id }), 'Profile switched.'); if (result) setAdvanced(result) }}>Switch</button>
                      <button className="button-secondary" disabled={working !== null} onClick={async () => { const result = await run('duplicate profile', () => api.duplicateProfile({ profileId: profile.id }), 'Profile duplicated.'); if (result) setAdvanced(result) }}>Duplicate</button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Create Profile" subtitle="Only use this when pack branching is intentional.">
              <div className="flex flex-wrap gap-3">
                <Field label="Profile Name" value={newProfileName} onChange={setNewProfileName} />
                <button className="button-primary" disabled={working !== null} onClick={async () => { const result = await run('create profile', () => api.createProfile({ name: newProfileName, notes: 'Curated BronzeForge profile.', selections: (advanced?.addons ?? []).map((addon) => ({ addonId: addon.id, enabled: addon.isCore, channelOverride: null })) }), 'Profile created.'); if (result) { setAdvanced(result); setNewProfileName('') } }}>Create Profile</button>
              </div>
            </Card>
          </div>
        ) : null}
        {screen === 'developer' && maintainerMode ? (
          <Card title="Register Source" subtitle="Bring local folders, zips, or manifests into the registry.">
            <div className="grid gap-4 md:grid-cols-3">
              <SelectField label="Source Kind" value={sourceKind} onChange={(value) => setSourceKind(value as 'manifest' | 'local-folder' | 'zip-file')} options={[['manifest', 'Manifest'], ['local-folder', 'Local Folder'], ['zip-file', 'Zip File']]} />
              <SelectField label="Channel" value={sourceChannel} onChange={(value) => setSourceChannel(value as Channel)} options={[['stable', 'Stable'], ['beta', 'Beta']]} />
              <Field label="Source Path" value={sourcePath} onChange={setSourcePath} />
            </div>
            <div className="mt-5">
              <button className="button-primary" disabled={working !== null} onClick={async () => { const result = await run('register source', () => api.registerSource({ sourceKind, path: sourcePath, channel: sourceChannel, core: false }), 'Source registered.'); if (result) setAdvanced(result) }}>Register Source</button>
            </div>
          </Card>
        ) : null}
      </div>
    </Frame>
  )
}

function Frame({ children, screens, screen, onScreen }: { children: ReactNode; screens: Array<{ id: Screen; label: string; icon: typeof Boxes }>; screen: Screen; onScreen: (screen: Screen) => void }) {
  return <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(214,170,109,0.2),_transparent_34%),linear-gradient(160deg,_#120d0a,_#22140f_44%,_#0b0908)] text-[#f8eee2]"><div className="mx-auto flex min-h-screen w-full max-w-[1560px] flex-col gap-6 px-4 py-4 lg:flex-row lg:px-6"><aside className="w-full rounded-[2rem] border border-white/10 bg-black/30 p-3 backdrop-blur lg:max-w-[280px]"><div className="mb-6 rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5"><p className="text-xs uppercase tracking-[0.28em] text-[#d9b88d]">BronzeForge</p><h1 className="mt-2 text-2xl font-semibold text-[#fff6e8]">Curated Pack Launcher</h1><p className="mt-2 text-sm text-[#cfbea9]">Install, sync, recover, and launch with one happy path.</p></div><nav className="space-y-2">{screens.map((entry) => { const Icon = entry.icon; return <button key={entry.id} className={clsx('flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition', screen === entry.id ? 'bg-[#d9b88d] text-[#1d120c]' : 'bg-white/5 text-[#f3e7d7] hover:bg-white/10')} onClick={() => onScreen(entry.id)}><Icon className="size-4" />{entry.label}</button> })}</nav></aside><main className="flex-1 rounded-[2rem] border border-white/10 bg-black/20 p-5 backdrop-blur lg:p-7">{children}</main></div></div>
}

function Card({ children, title, subtitle, accent = false }: { children: ReactNode; title: string; subtitle: string; accent?: boolean }) {
  return <section className={clsx('rounded-[2rem] border p-5 lg:p-6', accent ? 'border-[#d9b88d]/20 bg-[linear-gradient(145deg,_rgba(217,184,141,0.16),_rgba(0,0,0,0.2))]' : 'border-white/10 bg-white/[0.04]')}><div className="mb-5"><p className="text-xs uppercase tracking-[0.24em] text-[#d9b88d]">{title}</p><h2 className="mt-2 text-2xl font-semibold text-[#fff6e8]">{subtitle}</h2></div>{children}</section>
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="flex min-w-[220px] flex-1 flex-col gap-2 text-sm text-[#d0c0ae]">{label}<input className="input" value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="flex flex-col gap-2 text-sm text-[#d0c0ae]">{label}<select className="input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>
}

function ListCard({ title, items }: { title: string; items: Array<{ id: string; label: string }> }) {
  return <Card title={title} subtitle="Advanced visibility only.">{items.length ? <div className="space-y-3">{items.map((item) => <div key={item.id} className="rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-[#f8eee2]">{item.label}</div>)}</div> : <p className="text-sm text-[#d0c0ae]">Nothing loaded.</p>}</Card>
}

function Banner({ tone, children }: { tone: 'success' | 'error'; children: ReactNode }) {
  return <div className={clsx('rounded-3xl border px-4 py-3 text-sm', tone === 'success' ? 'border-emerald-400/20 bg-emerald-950/60 text-emerald-100' : 'border-rose-400/20 bg-rose-950/60 text-rose-100')}>{children}</div>
}

function State({ icon: Icon, title, body, spin = false }: { icon: typeof AlertTriangle; title: string; body: string; spin?: boolean }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center"><Icon className={clsx('size-10 text-[#d9b88d]', spin && 'animate-spin')} /><div><h2 className="text-2xl font-semibold text-[#fff6e8]">{title}</h2><p className="mt-2 text-sm text-[#d0c0ae]">{body}</p></div></div>
}

function Pill({ tone, children }: { tone: 'success' | 'warning' | 'muted' | 'danger'; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold', tone === 'success' && 'bg-emerald-500/15 text-emerald-100', tone === 'warning' && 'bg-amber-500/15 text-amber-100', tone === 'danger' && 'bg-rose-500/15 text-rose-100', tone === 'muted' && 'bg-white/10 text-[#e9dcc9]')}>{children}</span>
}

export default App

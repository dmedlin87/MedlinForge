import { startTransition, useCallback, useDeferredValue, useEffect, useRef, useState, type Dispatch, type PropsWithChildren, type SetStateAction } from 'react'
import { AlertTriangle, ArrowRightLeft, Boxes, Check, Inbox, Loader2, Menu, RotateCcw, Settings as SettingsIcon, ShieldCheck, Wrench, X } from 'lucide-react'
import clsx from 'clsx'

import { api } from './lib/api'
import { formatBytes, formatWhen } from './lib/format'
import type {
  AddonRecord,
  Channel,
  CreateProfileRequest,
  DetectPathCandidate,
  OperationResponse,
  ProfileSelection,
  RegisterSourceRequest,
  RemoteProductUpdate,
  SaveSettingsRequest,
  ScanStateResponse,
  UpdateChannel,
  UpdateCheckResponse,
} from './types'

type Screen = 'dashboard' | 'addons' | 'profiles' | 'recovery' | 'settings' | 'developer'

interface PendingOperation {
  title: string
  applyLabel: string
  response: OperationResponse
  apply: () => Promise<void>
}

interface Toast {
  id: string
  message: string
  tone: 'success' | 'error'
}

const screens: Array<{ id: Screen; label: string; icon: typeof Boxes; description: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Boxes, description: 'Overview and quick actions' },
  { id: 'addons', label: 'Addons', icon: ShieldCheck, description: 'Manage installed addons' },
  { id: 'profiles', label: 'Profiles', icon: ArrowRightLeft, description: 'Addon profile sets' },
  { id: 'recovery', label: 'Recovery', icon: RotateCcw, description: 'Snapshots and restore points' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, description: 'Paths and preferences' },
  { id: 'developer', label: 'Developer', icon: Wrench, description: 'Source registration and packaging' },
]

function App() {
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [state, setState] = useState<ScanStateResponse | null>(null)
  const [updates, setUpdates] = useState<UpdateCheckResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null)
  const [applying, setApplying] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<SaveSettingsRequest>({})
  const [sourceDraft, setSourceDraft] = useState<RegisterSourceRequest>({ sourceKind: 'local-folder', path: '', channel: 'stable', core: false })
  const [detectedPaths, setDetectedPaths] = useState<DetectPathCandidate[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')
  const [profileNotes, setProfileNotes] = useState('')
  const [profileSelections, setProfileSelections] = useState<ProfileSelection[]>([])
  const [addonSearch, setAddonSearch] = useState('')
  const [exportPath, setExportPath] = useState<string | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [preflightOpen, setPreflightOpen] = useState(false)
  const deferredSearch = useDeferredValue(addonSearch)

  const addToast = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4000)
  }, [])

  const filteredAddons = (state?.addons ?? []).filter((addon) => {
    const query = deferredSearch.trim().toLowerCase()
    if (!query) return true
    return addon.displayName.toLowerCase().includes(query) || addon.installFolder.toLowerCase().includes(query) || addon.health.toLowerCase().includes(query)
  })
  const selectedProfile = state?.profiles.find((profile) => profile.id === selectedProfileId) ?? null
  const updateByAddonId = new Map((updates?.addons ?? []).map((item) => [item.id, item]))

  function applyState(next: ScanStateResponse, preferredProfileId?: string | null) {
    startTransition(() => {
      setState(next)
    })
    setSettingsDraft({
      ascensionRootPath: next.settings.ascensionRootPath,
      addonsPath: next.settings.addonsPath,
      savedVariablesPath: next.settings.savedVariablesPath,
      backupRetentionCount: next.settings.backupRetentionCount,
      autoBackupEnabled: next.settings.autoBackupEnabled,
      devModeEnabled: next.settings.devModeEnabled,
      defaultProfileId: next.settings.defaultProfileId,
      updateChannel: next.settings.updateChannel,
      updateManifestOverride: next.settings.updateManifestOverride,
    })
    const resolvedProfileId =
      (preferredProfileId && next.profiles.some((profile) => profile.id === preferredProfileId) ? preferredProfileId : null) ??
      next.activeProfileId ??
      next.profiles[0]?.id ??
      null
    setSelectedProfileId(resolvedProfileId)
    const profile = next.profiles.find((entry) => entry.id === resolvedProfileId)
    if (profile) {
      setProfileName(profile.name)
      setProfileNotes(profile.notes ?? '')
      setProfileSelections(profile.selections)
    }
  }

  const refresh = async (includeUpdates = false) => {
    try {
      setError(null)
      const next = await api.scanLiveState()
      applyState(next, selectedProfileId)
      if (includeUpdates) {
        await refreshUpdates()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load BronzeForge state.')
    }
  }

  async function refreshUpdates() {
    setUpdateBusy(true)
    try {
      const next = await api.checkUpdates()
      setUpdates(next)
    } catch (caught) {
      setUpdates((current) => ({
        channel: settingsDraft.updateChannel ?? current?.channel ?? 'stable',
        checkedAt: current?.checkedAt ?? null,
        manifestGeneratedAt: current?.manifestGeneratedAt ?? null,
        manifestUrl: current?.manifestUrl ?? null,
        stale: true,
        errorMessage: caught instanceof Error ? caught.message : 'Failed to check for updates.',
        manager: current?.manager ?? null,
        addons: current?.addons ?? [],
      }))
    } finally {
      setUpdateBusy(false)
    }
  }

  function selectProfile(profileId: string) {
    setSelectedProfileId(profileId)
    const profile = state?.profiles.find((entry) => entry.id === profileId)
    if (profile) {
      setProfileName(profile.name)
      setProfileNotes(profile.notes ?? '')
      setProfileSelections(profile.selections)
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          setError(null)
          setLoading(true)
          const [next, updateState] = await Promise.all([api.scanLiveState(), api.checkUpdates()])
          applyState(next, null)
          setUpdates(updateState)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Failed to load BronzeForge state.')
        } finally {
          setLoading(false)
        }
      })()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [])

  // Close preflight drawer on Escape
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && preflightOpen) setPreflightOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [preflightOpen])

  async function preview(title: string, applyLabel: string, loadPreview: () => Promise<OperationResponse>, apply: () => Promise<void>) {
    const response = await loadPreview()
    setPendingOperation({ title, applyLabel, response, apply })
    setPreflightOpen(true)
  }

  async function previewSync(profileId: string, safeMode = false, isolateAddonId: string | null = null, switchAfter = false) {
    await preview(
      safeMode ? 'Safe mode preview' : isolateAddonId ? 'Isolated addon preview' : 'Profile sync preview',
      safeMode ? 'Apply safe mode' : 'Apply sync',
      () => api.syncProfile({ profileId, previewOnly: true, safeMode, isolateAddonId }),
      async () => {
        await api.syncProfile({ profileId, previewOnly: false, safeMode, isolateAddonId })
        if (switchAfter) await api.switchProfile({ profileId })
        setPendingOperation(null)
        setPreflightOpen(false)
        addToast(safeMode ? 'Safe mode applied successfully.' : 'Profile sync completed.')
        await refresh()
      },
    )
  }

  async function previewInstall(addonId: string) {
    if (!state?.activeProfileId) return
    await preview(
      'Install preview',
      'Install addon',
      () => api.installAddon({ addonId, profileId: state.activeProfileId, previewOnly: true }),
      async () => {
        await api.installAddon({ addonId, profileId: state.activeProfileId, previewOnly: false })
        setPendingOperation(null)
        setPreflightOpen(false)
        addToast('Addon installed successfully.')
        await refresh()
      },
    )
  }

  async function previewChannel(addonId: string, channel: Channel) {
    if (!state?.activeProfileId) return
    await preview(
      'Channel switch preview',
      `Switch to ${channel}`,
      () => api.changeChannel({ addonId, profileId: state.activeProfileId, channel, previewOnly: true }),
      async () => {
        await api.changeChannel({ addonId, profileId: state.activeProfileId, channel, previewOnly: false })
        setPendingOperation(null)
        setPreflightOpen(false)
        addToast(`Switched to ${channel} channel.`)
        await refresh()
      },
    )
  }

  async function previewRemove(addonId: string) {
    if (!state?.activeProfileId) return
    await preview(
      'Removal preview',
      'Remove addon',
      () => api.uninstallAddon({ addonId, profileId: state.activeProfileId, previewOnly: true }),
      async () => {
        await api.uninstallAddon({ addonId, profileId: state.activeProfileId, previewOnly: false })
        setPendingOperation(null)
        setPreflightOpen(false)
        addToast('Addon removed.')
        await refresh()
      },
    )
  }

  async function previewRestore(snapshotId: string) {
    await preview(
      'Restore preview',
      'Restore snapshot',
      () => api.restoreSnapshot({ snapshotId, previewOnly: true }),
      async () => {
        await api.restoreSnapshot({ snapshotId, previewOnly: false })
        setPendingOperation(null)
        setPreflightOpen(false)
        addToast('Snapshot restored successfully.')
        await refresh()
      },
    )
  }

  async function saveSettings() {
    applyState(await api.saveSettings(settingsDraft), selectedProfileId)
    await refreshUpdates()
    addToast('Settings saved.')
    addToast('Settings saved.')
  }

  async function detectPaths() {
    const response = await api.detectPaths()
    setDetectedPaths(response.candidates)
    addToast(`Found ${response.candidates.length} install${response.candidates.length === 1 ? '' : 's'}.`)
  }

  async function registerSource() {
    if (!sourceDraft.path.trim()) return
    applyState(await api.registerSource(sourceDraft), selectedProfileId)
    setSourceDraft((current) => ({ ...current, path: '' }))
    addToast('Source registered.')
  }

  async function saveProfile(profileId?: string | null) {
    if (!profileName.trim()) return
    const payload: CreateProfileRequest = { profileId, name: profileName.trim(), notes: profileNotes, selections: profileSelections }
    applyState(await api.createProfile(payload), profileId ?? selectedProfileId)
    addToast(profileId ? 'Profile saved.' : 'Profile created.')
  }

  async function duplicateProfile(profileId: string) {
    applyState(await api.duplicateProfile({ profileId }), selectedProfileId)
    addToast('Profile duplicated.')
  }

  function updateSelection(addonId: string, patch: Partial<ProfileSelection>) {
    setProfileSelections((current) => current.map((selection) => (selection.addonId === addonId ? { ...selection, ...patch } : selection)))
  }

  async function packageAddon(addon: AddonRecord) {
    setExportPath(await api.packageRevision({ addonId: addon.id, channel: addon.currentChannel ?? addon.defaultChannel }))
    addToast('Package exported.')
  }

  async function promoteBeta(addon: AddonRecord) {
    const beta = addon.latestRevisions.find((revision) => revision.channel === 'beta')
    if (!beta) return
    applyState(await api.promoteRevision({ revisionId: beta.id }), selectedProfileId)
    await refreshUpdates()
    addToast('Beta promoted to stable.')
  }

  async function previewRemoteAddonUpdate(addonId: string) {
    if (!state?.activeProfileId) return
    await preview(
      'Remote update preview',
      'Download and apply',
      () => api.applyRemoteAddonUpdate({ addonId, profileId: state.activeProfileId, previewOnly: true }),
      async () => {
        await api.applyRemoteAddonUpdate({ addonId, profileId: state.activeProfileId, previewOnly: false })
        setPendingOperation(null)
        setPreflightOpen(false)
        addToast('Remote addon update applied.')
        await refresh(true)
      },
    )
  }

  async function installManagerUpdate() {
    try {
      setError(null)
      const next = await api.installManagerUpdate()
      setUpdates((current) => (current ? { ...current, manager: next } : current))
      addToast('Manager update installed.')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to install BronzeForge Manager update.'
      setError(message)
      addToast(message, 'error')
    }
  }

  function navigateTo(target: Screen) {
    setScreen(target)
    setMobileNavOpen(false)
  }

  const hasActiveProfile = Boolean(state?.activeProfileId)
  const hasSnapshots = Boolean(state?.snapshots?.length)

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(212,159,99,0.25),_transparent_34%),linear-gradient(140deg,_#130f0c,_#231811_48%,_#0f0b09)] text-[#f8eee2]">
      {/* Toast notifications */}
      <div className="fixed right-4 top-4 z-50 space-y-2" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <div key={toast.id} className={clsx('flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium shadow-lg animate-in fade-in slide-in-from-right', toast.tone === 'success' ? 'border border-emerald-400/20 bg-emerald-900/90 text-emerald-100' : 'border border-rose-400/20 bg-rose-900/90 text-rose-100')}>
            {toast.tone === 'success' ? <Check className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
            {toast.message}
          </div>
        ))}
      </div>

      {/* Mobile nav toggle */}
      <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-white/10 bg-black/40 px-4 py-3 backdrop-blur lg:hidden">
        <button
          className="rounded-xl border border-white/10 bg-white/5 p-2 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bronze-300"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileNavOpen}
        >
          {mobileNavOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
        <span className="text-sm font-semibold text-bronze-50">{screens.find((s) => s.id === screen)?.label ?? 'Dashboard'}</span>
        {pendingOperation && (
          <button className="ml-auto rounded-xl border border-bronze-400/30 bg-bronze-400/10 px-3 py-1.5 text-xs font-semibold text-bronze-200 transition hover:bg-bronze-400/20" onClick={() => setPreflightOpen(true)}>
            Preflight ready
          </button>
        )}
      </div>

      {/* Mobile nav drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
          <nav className="absolute left-0 top-0 h-full w-[280px] border-r border-white/10 bg-slateforge-950 p-4 shadow-2xl" aria-label="Main navigation">
            <p className="text-xs uppercase tracking-[0.3em] text-bronze-100/55">BronzeForge</p>
            <p className="mt-2 font-display text-2xl text-bronze-50">Manager</p>
            <div className="mt-6 space-y-1">
              {screens.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={clsx('flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-bronze-300', screen === id ? 'bg-bronze-400/18 text-bronze-50' : 'text-bronze-100/70 hover:bg-white/5 hover:text-bronze-50')}
                  onClick={() => navigateTo(id)}
                  aria-current={screen === id ? 'page' : undefined}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  <span className="text-sm font-semibold">{label}</span>
                </button>
              ))}
            </div>
          </nav>
        </div>
      )}

      <div className="mx-auto flex min-h-screen max-w-[1560px] gap-5 px-4 py-5">
        <aside className="hidden w-[240px] shrink-0 rounded-[28px] border border-white/10 bg-white/5 p-4 shadow-forge backdrop-blur lg:block" aria-label="Sidebar">
          <p className="text-xs uppercase tracking-[0.3em] text-bronze-100/55">BronzeForge</p>
          <h1 className="mt-2 font-display text-3xl text-bronze-50">Manager</h1>
          <p className="mt-3 text-sm text-bronze-100/65">Addon management, profiles, and rollback for Bronzebeard packs.</p>
          <nav className="mt-6 space-y-1" aria-label="Main navigation">
            {screens.map(({ id, label, icon: Icon, description }) => (
              <button
                key={id}
                className={clsx('flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-bronze-300', screen === id ? 'bg-bronze-400/18 text-bronze-50' : 'text-bronze-100/70 hover:bg-white/5 hover:text-bronze-50')}
                onClick={() => setScreen(id)}
                aria-current={screen === id ? 'page' : undefined}
                title={description}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="text-sm font-semibold">{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 space-y-6" aria-label="Main content">
          {/* Loading state */}
          {loading && !state && (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <Loader2 className="mx-auto size-8 animate-spin text-bronze-300" aria-hidden="true" />
                <p className="mt-4 text-sm text-bronze-100/60">Loading BronzeForge state&hellip;</p>
              </div>
            </div>
          )}

          {/* Main content when loaded */}
          {state && (
            <>
              <section className="grid gap-4 xl:grid-cols-[2.15fr_1fr]">
                <Panel title="Control center" subtitle="Preview every file operation before the manager touches your AddOns folder.">
                  <div className="grid gap-4 md:grid-cols-3">
                    <Metric label="Managed addons" value={String(state.addons.length)} />
                    <Metric label="Profiles" value={String(state.profiles.length)} />
                    <Metric label="Updates available" value={String((updates?.addons.filter((item) => item.available).length ?? 0) + (updates?.manager?.available ? 1 : 0))} />
                  </div>
                </Panel>
                <Panel title="Quick actions" subtitle="Common operations with safe previews.">
                  <div className="grid gap-3">
                    <button className="button-primary" disabled={!hasActiveProfile} onClick={() => state.activeProfileId && void previewSync(state.activeProfileId)}>
                      Sync active profile
                    </button>
                    <button className="button-secondary" disabled={!hasSnapshots} onClick={() => state.snapshots[0] && void previewRestore(state.snapshots[0].id)}>
                      Restore last snapshot
                    </button>
                    <button className="button-secondary" disabled={!hasActiveProfile} onClick={() => state.activeProfileId && void previewSync(state.activeProfileId, true)}>
                      Enter safe mode
                    </button>
                    <button className="button-secondary" disabled={updateBusy} onClick={() => void refreshUpdates()}>
                      {updateBusy ? 'Checking updates...' : 'Check updates'}
                    </button>
                  </div>
                </Panel>
              </section>

              {error && (
                <div className="flex items-start gap-3 rounded-3xl border border-rose-400/30 bg-rose-400/10 px-5 py-4 text-sm text-rose-100" role="alert">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">Something went wrong</p>
                    <p className="mt-1 text-rose-100/80">{error}</p>
                  </div>
                </div>
              )}

              {screen === 'dashboard' && <Dashboard state={state} updates={updates} updateBusy={updateBusy} onRefreshUpdates={() => void refreshUpdates()} onInstallManagerUpdate={() => void installManagerUpdate()} />}
              {screen === 'addons' && <AddonsPanel addons={filteredAddons} allAddonsCount={state.addons.length} updates={updateByAddonId} search={addonSearch} setSearch={setAddonSearch} onInstall={previewInstall} onRemoteUpdate={previewRemoteAddonUpdate} onChannel={previewChannel} onRemove={previewRemove} onIsolate={(addonId) => state.activeProfileId && void previewSync(state.activeProfileId, false, addonId)} />}
              {screen === 'profiles' && <ProfilesPanel state={state} selectedProfileId={selectedProfileId} setSelectedProfileId={selectProfile} profileName={profileName} setProfileName={setProfileName} profileNotes={profileNotes} setProfileNotes={setProfileNotes} profileSelections={profileSelections} updateSelection={updateSelection} onSave={() => void saveProfile(selectedProfile?.id)} onCreate={() => void saveProfile(null)} onDuplicate={(profileId) => void duplicateProfile(profileId)} onPreviewSwitch={(profileId) => void previewSync(profileId, false, null, true)} />}
              {screen === 'recovery' && <RecoveryPanel snapshots={state.snapshots} onRestore={previewRestore} />}
              {screen === 'settings' && <SettingsPanel draft={settingsDraft} updates={updates} setDraft={setSettingsDraft} detectedPaths={detectedPaths} onDetect={() => void detectPaths()} onSave={() => void saveSettings()} />}
              {screen === 'developer' && <DeveloperPanel state={state} draft={sourceDraft} setDraft={setSourceDraft} onRegister={() => void registerSource()} onPackage={(addon) => void packageAddon(addon)} onPromote={(addon) => void promoteBeta(addon)} exportPath={exportPath} />}
            </>
          )}
        </main>

        {/* Desktop preflight sidebar */}
        <aside className="hidden w-[360px] shrink-0 xl:block" aria-label="Preflight panel">
          <Panel title="Preflight" subtitle="Review the full impact before applying any operation.">
            {pendingOperation ? (
              <PreviewCard pendingOperation={pendingOperation} applying={applying} onApply={async () => {
                setApplying(true)
                try { await pendingOperation.apply() } finally { setApplying(false) }
              }} onDismiss={() => { setPendingOperation(null); setPreflightOpen(false) }} />
            ) : (
              <Empty icon="inbox" label="No operation queued" detail="Preview a sync, restore, or channel change to see what will happen before applying." />
            )}
          </Panel>
        </aside>
      </div>

      {/* Mobile/tablet preflight drawer */}
      {preflightOpen && pendingOperation && (
        <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-label="Preflight preview">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPreflightOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-slateforge-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-bronze-100/50">Preflight</h2>
              <button className="rounded-xl p-2 text-bronze-100/60 transition hover:bg-white/10 hover:text-bronze-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bronze-300" onClick={() => setPreflightOpen(false)} aria-label="Close preflight">
                <X className="size-5" />
              </button>
            </div>
            <PreviewCard pendingOperation={pendingOperation} applying={applying} onApply={async () => {
              setApplying(true)
              try { await pendingOperation.apply() } finally { setApplying(false) }
            }} onDismiss={() => { setPendingOperation(null); setPreflightOpen(false) }} />
          </div>
        </div>
      )}
    </div>
  )
}

function Dashboard({
  state,
  updates,
  updateBusy,
  onRefreshUpdates,
  onInstallManagerUpdate,
}: {
  state: ScanStateResponse
  updates: UpdateCheckResponse | null
  updateBusy: boolean
  onRefreshUpdates: () => void
  onInstallManagerUpdate: () => void
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
      <Panel title="Update status" subtitle="GitHub manifest health, manager release visibility, and owned addon updates.">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-bronze-50">BronzeForge Manager</p>
                <p className="mt-1 text-sm text-bronze-100/60">
                  {updates?.manager ? `${updates.manager.currentVersion} -> ${updates.manager.latestVersion}` : 'No remote manager release cached'}
                </p>
              </div>
              <StatusPill
                label={updates?.manager?.status ?? 'unknown'}
                tone={updates?.manager?.available ? 'warn' : 'ok'}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className="button-secondary" disabled={updateBusy} onClick={onRefreshUpdates}>
                {updateBusy ? 'Checking updates...' : 'Refresh manifest'}
              </button>
              <button className="button-primary disabled:cursor-not-allowed disabled:opacity-40" disabled={!updates?.manager?.available} onClick={onInstallManagerUpdate}>
                Install manager update
              </button>
            </div>
            <p className="mt-3 text-xs text-bronze-100/45">
              Last check: {formatWhen(updates?.checkedAt ?? state?.settings.lastUpdateCheckAt ?? null)}
            </p>
            {updates?.errorMessage ? (
              <p className="mt-2 text-sm text-amber-100">
                {updates.stale ? 'Using cached results.' : 'Update check failed.'} {updates.errorMessage}
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {(updates?.addons ?? []).slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-bronze-50">{item.name}</p>
                  <StatusPill label={item.status} tone={item.available ? 'warn' : 'ok'} />
                </div>
                <p className="mt-2 text-sm text-bronze-100/60">
                  {item.currentVersion ?? 'No local revision'} -&gt; {item.latestVersion}
                </p>
              </div>
            ))}
            {!(updates?.addons ?? []).length ? (
              <Empty label="No owned addon updates cached." detail="Run a manifest refresh to pull the current stable or beta channel." compact />
            ) : null}
          </div>
        </div>
      </Panel>
      <Panel title="Issues" subtitle="Current blockers and warnings from the active profile plan.">
        <div className="space-y-3">
          {state.issues.length ? state.issues.map((issue) => <IssueCard key={`${issue.code}-${issue.message}`} message={issue.message} severity={issue.severity} />) : <Empty icon="check" label="All clear" detail="No blockers or warnings in the active sync plan." compact />}
        </div>
      </Panel>
      <Panel title="Recent activity" subtitle="Recent operations recorded by BronzeForge.">
        <div className="space-y-3">
          {state.logs.length ? state.logs.slice(0, 6).map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="font-semibold text-bronze-50">{entry.operation}</p>
                <StatusPill label={entry.status} tone={entry.status === 'success' ? 'ok' : 'warn'} />
              </div>
              <p className="mt-2 text-sm text-bronze-100/60">{entry.message}</p>
            </div>
          )) : <Empty icon="inbox" label="No activity yet" detail="Operations will appear here after your first sync." compact />}
        </div>
      </Panel>
    </div>
  )
}

function AddonsPanel({
  addons,
  updates,
  allAddonsCount,
  search,
  setSearch,
  onInstall,
  onRemoteUpdate,
  onChannel,
  onRemove,
  onIsolate,
}: {
  addons: AddonRecord[]
  allAddonsCount: number
  updates: Map<string, RemoteProductUpdate>
  search: string
  setSearch: (value: string) => void
  onInstall: (addonId: string) => void
  onRemoteUpdate: (addonId: string) => void
  onChannel: (addonId: string, channel: Channel) => void
  onRemove: (addonId: string) => void
  onIsolate: (addonId: string) => void
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  return (
    <Panel title="Managed addons" subtitle="Search, install, update, or change channels for registered addons.">
      <div className="relative mb-4">
        <input
          ref={searchRef}
          className="input"
          placeholder="Search by name, folder, or status&hellip;"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search addons"
        />
        {search && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-bronze-100/40 transition hover:text-bronze-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bronze-300"
            onClick={() => {
              setSearch('')
              searchRef.current?.focus()
            }}
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {search && <p className="mb-3 text-xs text-bronze-100/50">Showing {addons.length} of {allAddonsCount} addons</p>}
      <div className="space-y-3" role="list" aria-label="Addon list">
        {addons.length ? addons.map((addon) => {
          const remoteUpdate = updates.get(addon.id)
          return (
          <div key={addon.id} className="rounded-2xl border border-white/10 bg-white/5 p-4" role="listitem">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-bronze-50">{addon.displayName}</p>
                <p className="mt-1 text-sm text-bronze-100/60">
                  <span className="font-mono text-xs">{addon.installFolder}</span>
                  <span className="mx-1.5 text-bronze-100/30">&middot;</span>
                  {addon.currentVersion ?? 'Unresolved'}
                  <span className="mx-1.5 text-bronze-100/30">&middot;</span>
                  {addon.currentChannel ?? addon.defaultChannel}
                </p>
                {remoteUpdate ? (
                  <p className="mt-2 text-sm text-bronze-100/55">
                    Remote {remoteUpdate.channel}: {remoteUpdate.currentVersion ?? 'none'} -&gt; {remoteUpdate.latestVersion}
                  </p>
                ) : null}
              </div>
              <StatusPill label={remoteUpdate?.available ? 'update available' : addon.health} tone={remoteUpdate?.available ? 'warn' : addon.health === 'Ready' ? 'ok' : 'warn'} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <TinyButton label={addon.enabledInActiveProfile ? 'Update' : 'Install'} onClick={() => onInstall(addon.id)} />
              <TinyButton label="Remote update" disabled={!remoteUpdate?.available} onClick={() => onRemoteUpdate(addon.id)} />
              <TinyButton label="Beta channel" onClick={() => onChannel(addon.id, 'beta')} />
              <TinyButton label="Local dev" onClick={() => onChannel(addon.id, 'localDev')} />
              <TinyButton label="Isolate test" onClick={() => onIsolate(addon.id)} />
              <span className="mx-1 hidden h-4 w-px bg-white/10 sm:inline-block" aria-hidden="true" />
              <TinyButton label="Remove" tone="danger" onClick={() => onRemove(addon.id)} />
            </div>
          </div>
        )}) : (
          <Empty icon="inbox" label={search ? 'No matching addons' : 'No addons registered'} detail={search ? 'Try a different search term.' : 'Register addon sources in the Developer tab to get started.'} compact />
        )}
      </div>
    </Panel>
  )
}

function ProfilesPanel({ state, selectedProfileId, setSelectedProfileId, profileName, setProfileName, profileNotes, setProfileNotes, profileSelections, updateSelection, onSave, onCreate, onDuplicate, onPreviewSwitch }: { state: ScanStateResponse; selectedProfileId: string | null; setSelectedProfileId: (value: string) => void; profileName: string; setProfileName: (value: string) => void; profileNotes: string; setProfileNotes: (value: string) => void; profileSelections: ProfileSelection[]; updateSelection: (addonId: string, patch: Partial<ProfileSelection>) => void; onSave: () => void; onCreate: () => void; onDuplicate: (profileId: string) => void; onPreviewSwitch: (profileId: string) => void }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
      <Panel title="Profiles" subtitle="Named addon sets with per-addon channel overrides.">
        <div className="space-y-2" role="listbox" aria-label="Profile list">
          {state.profiles.map((profile) => (
            <button
              key={profile.id}
              className={clsx('w-full rounded-2xl border px-4 py-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-bronze-300', selectedProfileId === profile.id ? 'border-bronze-300/30 bg-bronze-300/10' : 'border-white/10 bg-white/5 hover:bg-white/10')}
              onClick={() => setSelectedProfileId(profile.id)}
              role="option"
              aria-selected={selectedProfileId === profile.id}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-bronze-50">{profile.name}</p>
                  <p className="mt-1 text-sm text-bronze-100/60">{profile.notes || 'No description'}</p>
                </div>
                {profile.isActive && <StatusPill label="Active" tone="ok" />}
              </div>
            </button>
          ))}
        </div>
        <div className="mt-4">
          <button className="button-secondary w-full" onClick={onCreate}>+ New profile</button>
        </div>
      </Panel>
      <Panel title="Profile editor" subtitle={selectedProfileId ? 'Edit addon selections, then preview the switch.' : 'Select a profile to edit.'}>
        {selectedProfileId ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Profile name"><input className="input" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="e.g. Raid night setup" /></Field>
              <Field label="Description"><input className="input" value={profileNotes} onChange={(event) => setProfileNotes(event.target.value)} placeholder="Optional notes about this profile" /></Field>
            </div>
            <div className="mt-5 space-y-3">
              {state.addons.map((addon) => {
                const selection = profileSelections.find((entry) => entry.addonId === addon.id)
                return (
                  <div key={addon.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div>
                      <p className="font-semibold text-bronze-50">{addon.displayName}</p>
                      <p className="mt-1 text-xs text-bronze-100/50">{addon.installFolder}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-bronze-100/70">
                        <input type="checkbox" className="accent-bronze-400" checked={Boolean(selection?.enabled)} onChange={(event) => updateSelection(addon.id, { enabled: event.target.checked })} />
                        Enabled
                      </label>
                      <select className="input !w-auto !py-2" value={selection?.channelOverride ?? ''} onChange={(event) => updateSelection(addon.id, { channelOverride: (event.target.value || null) as Channel | null })} aria-label={`Channel for ${addon.displayName}`}>
                        <option value="">Default channel</option>
                        <option value="stable">Stable</option>
                        <option value="beta">Beta</option>
                        <option value="localDev">Local Dev</option>
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button className="button-primary" onClick={onSave}>Save changes</button>
              <button className="button-secondary" onClick={() => onPreviewSwitch(selectedProfileId)}>Preview &amp; switch</button>
              <button className="button-secondary" onClick={() => onDuplicate(selectedProfileId)}>Duplicate</button>
            </div>
          </>
        ) : (
          <Empty icon="inbox" label="No profile selected" detail="Choose a profile from the list to view and edit its addon selections." />
        )}
      </Panel>
    </div>
  )
}

function RecoveryPanel({ snapshots, onRestore }: { snapshots: ScanStateResponse['snapshots']; onRestore: (snapshotId: string) => void }) {
  return (
    <Panel title="Recovery" subtitle="Restore points created before each operation. Click to preview before restoring.">
      <div className="space-y-3" role="list" aria-label="Snapshot list">
        {snapshots.length ? snapshots.map((snapshot) => (
          <div key={snapshot.id} className="rounded-2xl border border-white/10 bg-white/5 p-4" role="listitem">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-bronze-50">{snapshot.notes || snapshot.snapshotType}</p>
                <p className="mt-1 text-sm text-bronze-100/60">
                  {formatWhen(snapshot.createdAt)}
                  <span className="mx-1.5 text-bronze-100/30">&middot;</span>
                  {formatBytes(snapshot.sizeBytes)}
                  <span className="mx-1.5 text-bronze-100/30">&middot;</span>
                  {snapshot.addonCount} {snapshot.addonCount === 1 ? 'addon' : 'addons'}
                </p>
              </div>
              <button className="button-secondary" onClick={() => onRestore(snapshot.id)}>Preview restore</button>
            </div>
          </div>
        )) : (
          <Empty icon="inbox" label="No snapshots yet" detail="BronzeForge creates restore points automatically before each sync operation." />
        )}
      </div>
    </Panel>
  )
}

function SettingsPanel({
  draft,
  updates,
  setDraft,
  detectedPaths,
  onDetect,
  onSave,
}: {
  draft: SaveSettingsRequest
  updates: UpdateCheckResponse | null
  setDraft: Dispatch<SetStateAction<SaveSettingsRequest>>
  detectedPaths: DetectPathCandidate[]
  onDetect: () => void
  onSave: () => void
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <Panel title="Path configuration" subtitle="Set the paths to your Ascension install. Use auto-detection for fastest setup.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Ascension root" hint="Top-level game install folder"><input className="input font-mono text-xs" value={draft.ascensionRootPath ?? ''} onChange={(event) => setDraft((current) => ({ ...current, ascensionRootPath: event.target.value }))} placeholder="C:\Games\Ascension" /></Field>
          <Field label="AddOns path" hint="Interface\AddOns folder"><input className="input font-mono text-xs" value={draft.addonsPath ?? ''} onChange={(event) => setDraft((current) => ({ ...current, addonsPath: event.target.value }))} placeholder="C:\Games\Ascension\Interface\AddOns" /></Field>
          <Field label="SavedVariables path" hint="WTF\Account\SavedVariables folder"><input className="input font-mono text-xs" value={draft.savedVariablesPath ?? ''} onChange={(event) => setDraft((current) => ({ ...current, savedVariablesPath: event.target.value }))} placeholder="C:\Games\Ascension\WTF\Account\SavedVariables" /></Field>
          <Field label="Backup retention" hint="Number of snapshots to keep"><input className="input" type="number" min={1} max={100} value={draft.backupRetentionCount ?? 20} onChange={(event) => setDraft((current) => ({ ...current, backupRetentionCount: Number(event.target.value) }))} /></Field>
          <Field label="Update channel" hint="Which release channel BronzeForge should track"><select className="input !py-2" value={draft.updateChannel ?? 'stable'} onChange={(event) => setDraft((current) => ({ ...current, updateChannel: event.target.value as UpdateChannel }))}><option value="stable">Stable</option><option value="beta">Beta</option></select></Field>
          <Field label="Last update check" hint="Latest remote manifest check"><div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-bronze-100/70">{formatWhen(updates?.checkedAt ?? null)}</div></Field>
          {draft.devModeEnabled ? <Field label="Manifest override" hint="Optional custom manifest URL for development"><input className="input font-mono text-xs" value={draft.updateManifestOverride ?? ''} onChange={(event) => setDraft((current) => ({ ...current, updateManifestOverride: event.target.value }))} placeholder="https://localhost:3000/manifest" /></Field> : null}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="button-primary" onClick={onSave}>Save settings</button>
          <button className="button-secondary" onClick={onDetect}>Auto-detect paths</button>
        </div>
        {updates?.errorMessage ? <p className="mt-4 text-sm text-amber-100">{updates.errorMessage}</p> : null}
      </Panel>
      <Panel title="Detected installs" subtitle="Click a result to fill in the paths above.">
        <div className="space-y-3">
          {detectedPaths.length ? detectedPaths.map((candidate) => (
            <button key={candidate.addonsPath} className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bronze-300" onClick={() => setDraft((current) => ({ ...current, ascensionRootPath: candidate.ascensionRootPath, addonsPath: candidate.addonsPath, savedVariablesPath: candidate.savedVariablesPath }))}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-bronze-50">{candidate.label}</p>
                <StatusPill label={candidate.confidence} tone="ok" />
              </div>
              <p className="mt-2 font-mono text-xs text-bronze-100/45">{candidate.addonsPath}</p>
            </button>
          )) : <Empty icon="inbox" label="No paths detected" detail="Click &ldquo;Auto-detect paths&rdquo; to scan common install locations." compact />}
        </div>
      </Panel>
    </div>
  )
}

function DeveloperPanel({ state, draft, setDraft, onRegister, onPackage, onPromote, exportPath }: { state: ScanStateResponse; draft: RegisterSourceRequest; setDraft: Dispatch<SetStateAction<RegisterSourceRequest>>; onRegister: () => void; onPackage: (addon: AddonRecord) => void; onPromote: (addon: AddonRecord) => void; exportPath: string | null }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <Panel title="Register source" subtitle="Add local folders, zip files, or manifests to the BronzeForge registry.">
        <div className="grid gap-4">
          <Field label="Source path" hint="Full path to the addon folder, zip, or manifest"><input className="input font-mono text-xs" value={draft.path} onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))} placeholder="C:\dev\MyAddon" /></Field>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Source type">
              <select className="input !py-2" value={draft.sourceKind} onChange={(event) => setDraft((current) => ({ ...current, sourceKind: event.target.value as RegisterSourceRequest['sourceKind'] }))}>
                <option value="local-folder">Local folder</option>
                <option value="zip-file">Zip package</option>
                <option value="manifest">Manifest file</option>
              </select>
            </Field>
            <Field label="Channel">
              <select className="input !py-2" value={draft.channel ?? 'stable'} onChange={(event) => setDraft((current) => ({ ...current, channel: event.target.value as Channel }))}>
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
                <option value="localDev">Local Dev</option>
              </select>
            </Field>
            <Field label="Core addon">
              <label className="flex h-full items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-bronze-100/70 transition hover:bg-black/30">
                <input type="checkbox" className="accent-bronze-400" checked={Boolean(draft.core)} onChange={(event) => setDraft((current) => ({ ...current, core: event.target.checked }))} />
                Include in safe mode
              </label>
            </Field>
          </div>
          <button className="button-primary" disabled={!draft.path.trim()} onClick={onRegister}>Register source</button>
        </div>
      </Panel>
      <Panel title="Package &amp; promote" subtitle="Export addon zips or promote beta revisions to stable.">
        <div className="space-y-3">
          {state.addons.length ? state.addons.map((addon) => (
            <div key={addon.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-bronze-50">{addon.displayName}</p>
                  <p className="mt-1 text-sm text-bronze-100/60">{addon.currentVersion ?? 'Unresolved'} &middot; {addon.currentChannel ?? addon.defaultChannel}</p>
                </div>
                <div className="flex gap-2">
                  <button className="button-secondary" onClick={() => onPackage(addon)}>Export zip</button>
                  <button className="button-secondary disabled:cursor-not-allowed disabled:opacity-40" disabled={!addon.latestRevisions.some((revision) => revision.channel === 'beta')} onClick={() => onPromote(addon)} title={addon.latestRevisions.some((revision) => revision.channel === 'beta') ? 'Promote the latest beta to stable' : 'No beta revision available'}>Promote beta</button>
                </div>
              </div>
            </div>
          )) : <Empty icon="inbox" label="No addons registered" detail="Register a source above to see addons here." compact />}
          {exportPath && (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" role="status">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              Exported to: <span className="font-mono text-xs">{exportPath}</span>
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}

function Panel({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle: string }>) {
  return (
    <section className="rounded-[30px] border border-white/10 bg-black/25 p-5 shadow-forge">
      <div className="mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-bronze-100/50">{title}</h2>
        <p className="mt-2 text-sm text-bronze-100/65">{subtitle}</p>
      </div>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="text-bronze-100/65">{label}</span>
      {children}
      {hint && <span className="text-xs text-bronze-100/40">{hint}</span>}
    </label>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-[11px] uppercase tracking-[0.2em] text-bronze-100/45">{label}</p>
      <p className="mt-2 font-display text-3xl text-bronze-50">{value}</p>
    </div>
  )
}

function PreviewCard({ pendingOperation, applying, onApply, onDismiss }: { pendingOperation: PendingOperation; applying: boolean; onApply: () => void; onDismiss: () => void }) {
  const hasBlockers = Boolean(pendingOperation.response.preview.blockers.length)
  const isDestructive = pendingOperation.response.preview.items.some((item) => item.changeType === 'remove')
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold text-bronze-50">{pendingOperation.title}</p>
          <StatusPill label={hasBlockers ? 'Blocked' : 'Ready'} tone={hasBlockers ? 'danger' : 'ok'} />
        </div>
        <p className="mt-2 text-sm text-bronze-100/60">{pendingOperation.response.message}</p>
      </div>
      {pendingOperation.response.preview.items.length > 0 && (
        <div role="list" aria-label="Changes">
          {pendingOperation.response.preview.items.map((item) => (
            <div key={`${item.addonId}-${item.changeType}`} className="rounded-2xl border border-white/10 bg-black/20 p-4 mb-2" role="listitem">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-bronze-50">{item.displayName}</p>
                  <p className="mt-1 font-mono text-xs text-bronze-100/50">{item.targetFolder}</p>
                </div>
                <StatusPill label={item.changeType} tone={item.changeType === 'remove' ? 'danger' : 'ok'} />
              </div>
            </div>
          ))}
        </div>
      )}
      {pendingOperation.response.preview.warnings.map((warning) => <IssueCard key={`${warning.code}-${warning.message}`} message={warning.message} severity={warning.severity} />)}
      {pendingOperation.response.preview.blockers.map((blocker) => <IssueCard key={`${blocker.code}-${blocker.message}`} message={blocker.message} severity={blocker.severity} />)}
      <div className="flex gap-3">
        <button
          className={clsx('button-primary disabled:cursor-not-allowed disabled:opacity-40', isDestructive && !hasBlockers && 'bg-rose-500 hover:bg-rose-400')}
          disabled={hasBlockers || applying}
          onClick={onApply}
        >
          {applying ? <Loader2 className="inline size-4 animate-spin mr-2" aria-hidden="true" /> : null}
          {applying ? 'Applying\u2026' : pendingOperation.applyLabel}
        </button>
        <button className="button-secondary" onClick={onDismiss} disabled={applying}>Cancel</button>
      </div>
    </div>
  )
}

function IssueCard({ message, severity }: { message: string; severity: 'blocker' | 'warning' }) {
  return (
    <div className={clsx('rounded-2xl border px-4 py-3', severity === 'blocker' ? 'border-rose-400/20 bg-rose-400/5' : 'border-white/10 bg-white/5')}>
      <div className="flex items-start gap-3">
        <AlertTriangle className={clsx('mt-0.5 size-4 shrink-0', severity === 'blocker' ? 'text-rose-300' : 'text-amber-300')} aria-hidden="true" />
        <div>
          <StatusPill label={severity} tone={severity === 'blocker' ? 'danger' : 'warn'} />
          <p className="mt-2 text-sm text-bronze-100/70">{message}</p>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'danger' }) {
  return <span className={clsx('inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]', tone === 'ok' && 'bg-emerald-300/15 text-emerald-100', tone === 'warn' && 'bg-amber-300/15 text-amber-100', tone === 'danger' && 'bg-rose-300/15 text-rose-100')}>{label}</span>
}

function Empty({ label, detail, compact = false, icon = 'inbox' }: { label: string; detail: string; compact?: boolean; icon?: 'inbox' | 'check' | 'warning' }) {
  const IconComponent = icon === 'check' ? Check : icon === 'warning' ? AlertTriangle : Inbox
  const bgColor = icon === 'check' ? 'bg-emerald-400/10 text-emerald-200' : 'bg-bronze-400/10 text-bronze-100'
  return (
    <div className={clsx('rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-center', compact ? 'px-4 py-5' : 'px-6 py-10')}>
      <div className={clsx('mx-auto grid size-12 place-items-center rounded-2xl', bgColor)}>
        <IconComponent className="size-5" aria-hidden="true" />
      </div>
      <p className="mt-4 font-semibold text-bronze-50">{label}</p>
      <p className="mt-2 text-sm text-bronze-100/55">{detail}</p>
    </div>
  )
}

function TinyButton({ label, onClick, tone = 'default', disabled = false }: { label: string; onClick: () => void; tone?: 'default' | 'danger'; disabled?: boolean }) {
  return (
    <button
      className={clsx('rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-bronze-300', tone === 'danger' ? 'bg-rose-300/12 text-rose-100 hover:bg-rose-300/20' : 'bg-white/10 text-bronze-100 hover:bg-white/15', disabled && 'cursor-not-allowed opacity-40')}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export default App

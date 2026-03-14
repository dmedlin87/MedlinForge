import { startTransition, useDeferredValue, useEffect, useState, type Dispatch, type PropsWithChildren, type SetStateAction } from 'react'
import { AlertTriangle, ArrowRightLeft, Boxes, RotateCcw, Settings as SettingsIcon, ShieldCheck, Wrench } from 'lucide-react'
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

const screens: Array<{ id: Screen; label: string; icon: typeof Boxes }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Boxes },
  { id: 'addons', label: 'Addons', icon: ShieldCheck },
  { id: 'profiles', label: 'Profiles', icon: ArrowRightLeft },
  { id: 'recovery', label: 'Recovery', icon: RotateCcw },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'developer', label: 'Developer', icon: Wrench },
]

function App() {
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [state, setState] = useState<ScanStateResponse | null>(null)
  const [updates, setUpdates] = useState<UpdateCheckResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<SaveSettingsRequest>({})
  const [sourceDraft, setSourceDraft] = useState<RegisterSourceRequest>({ sourceKind: 'local-folder', path: '', channel: 'stable', core: false })
  const [detectedPaths, setDetectedPaths] = useState<DetectPathCandidate[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')
  const [profileNotes, setProfileNotes] = useState('')
  const [profileSelections, setProfileSelections] = useState<ProfileSelection[]>([])
  const [addonSearch, setAddonSearch] = useState('')
  const [exportPath, setExportPath] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(addonSearch)

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
          const [next, updateState] = await Promise.all([api.scanLiveState(), api.checkUpdates()])
          applyState(next, null)
          setUpdates(updateState)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Failed to load BronzeForge state.')
        }
      })()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [])

  async function preview(title: string, applyLabel: string, loadPreview: () => Promise<OperationResponse>, apply: () => Promise<void>) {
    const response = await loadPreview()
    setPendingOperation({ title, applyLabel, response, apply })
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
        await refresh(false)
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
        await refresh(false)
      },
    )
  }

  async function previewChannel(addonId: string, channel: Channel) {
    if (!state?.activeProfileId) return
    await preview(
      'Channel preview',
      `Switch to ${channel}`,
      () => api.changeChannel({ addonId, profileId: state.activeProfileId, channel, previewOnly: true }),
      async () => {
        await api.changeChannel({ addonId, profileId: state.activeProfileId, channel, previewOnly: false })
        setPendingOperation(null)
        await refresh(false)
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
        await refresh(false)
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
        await refresh(false)
      },
    )
  }

  async function saveSettings() {
    applyState(await api.saveSettings(settingsDraft), selectedProfileId)
    await refreshUpdates()
  }

  async function detectPaths() {
    const response = await api.detectPaths()
    setDetectedPaths(response.candidates)
  }

  async function registerSource() {
    if (!sourceDraft.path.trim()) return
    applyState(await api.registerSource(sourceDraft), selectedProfileId)
    setSourceDraft((current) => ({ ...current, path: '' }))
  }

  async function saveProfile(profileId?: string | null) {
    if (!profileName.trim()) return
    const payload: CreateProfileRequest = { profileId, name: profileName.trim(), notes: profileNotes, selections: profileSelections }
    applyState(await api.createProfile(payload), profileId ?? selectedProfileId)
  }

  async function duplicateProfile(profileId: string) {
    applyState(await api.duplicateProfile({ profileId }), selectedProfileId)
  }

  function updateSelection(addonId: string, patch: Partial<ProfileSelection>) {
    setProfileSelections((current) => current.map((selection) => (selection.addonId === addonId ? { ...selection, ...patch } : selection)))
  }

  async function packageAddon(addon: AddonRecord) {
    setExportPath(await api.packageRevision({ addonId: addon.id, channel: addon.currentChannel ?? addon.defaultChannel }))
  }

  async function promoteBeta(addon: AddonRecord) {
    const beta = addon.latestRevisions.find((revision) => revision.channel === 'beta')
    if (!beta) return
    applyState(await api.promoteRevision({ revisionId: beta.id }), selectedProfileId)
    await refreshUpdates()
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
        await refresh(true)
      },
    )
  }

  async function installManagerUpdate() {
    try {
      setError(null)
      const next = await api.installManagerUpdate()
      setUpdates((current) => current ? { ...current, manager: next } : current)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to install BronzeForge Manager update.')
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(212,159,99,0.25),_transparent_34%),linear-gradient(140deg,_#130f0c,_#231811_48%,_#0f0b09)] text-[#f8eee2]">
      <div className="mx-auto flex min-h-screen max-w-[1560px] gap-5 px-4 py-5">
        <aside className="hidden w-[240px] shrink-0 rounded-[28px] border border-white/10 bg-white/5 p-4 shadow-forge backdrop-blur lg:block">
          <p className="text-xs uppercase tracking-[0.3em] text-bronze-100/55">BronzeForge</p>
          <h1 className="mt-2 font-display text-3xl text-bronze-50">Manager</h1>
          <p className="mt-3 text-sm text-bronze-100/65">Profile materialization, rollback, and dev-channel switching for Bronzebeard addon packs.</p>
          <nav className="mt-6 space-y-2">
            {screens.map(({ id, label, icon: Icon }) => (
              <button key={id} className={clsx('flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition', screen === id ? 'bg-bronze-400/18 text-bronze-50' : 'text-bronze-100/70 hover:bg-white/5 hover:text-bronze-50')} onClick={() => setScreen(id)}>
                <Icon className="size-5" />
                <span className="text-sm font-semibold">{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 space-y-6">
          <section className="grid gap-4 xl:grid-cols-[2.15fr_1fr]">
            <Panel title="BronzeForge control center" subtitle="Preview every file operation before the manager touches your AddOns folder.">
              <div className="grid gap-4 md:grid-cols-3">
                <Metric label="Managed addons" value={String(state?.addons.length ?? 0)} />
                <Metric label="Profiles" value={String(state?.profiles.length ?? 0)} />
                <Metric label="Updates available" value={String((updates?.addons.filter((item) => item.available).length ?? 0) + (updates?.manager?.available ? 1 : 0))} />
              </div>
            </Panel>
            <Panel title="Quick actions" subtitle="Safe defaults with rollback close at hand.">
              <div className="grid gap-3">
                <button className="button-primary" onClick={() => state?.activeProfileId && void previewSync(state.activeProfileId)}>Sync active profile</button>
                <button className="button-secondary" onClick={() => state?.snapshots[0] && void previewRestore(state.snapshots[0].id)}>Restore last known good</button>
                <button className="button-secondary" onClick={() => state?.activeProfileId && void previewSync(state.activeProfileId, true)}>Prepare safe mode</button>
                <button className="button-secondary" disabled={updateBusy} onClick={() => void refreshUpdates()}>{updateBusy ? 'Checking updates...' : 'Check updates'}</button>
              </div>
            </Panel>
          </section>

          {error ? <div className="rounded-3xl border border-rose-400/30 bg-rose-400/10 px-5 py-4 text-sm text-rose-100">{error}</div> : null}

          {screen === 'dashboard' ? <Dashboard state={state} updates={updates} updateBusy={updateBusy} onRefreshUpdates={() => void refreshUpdates()} onInstallManagerUpdate={() => void installManagerUpdate()} /> : null}
          {screen === 'addons' ? <AddonsPanel addons={filteredAddons} updates={updateByAddonId} search={addonSearch} setSearch={setAddonSearch} onInstall={previewInstall} onRemoteUpdate={previewRemoteAddonUpdate} onChannel={previewChannel} onRemove={previewRemove} onIsolate={(addonId) => state?.activeProfileId && void previewSync(state.activeProfileId, false, addonId)} /> : null}
          {screen === 'profiles' ? <ProfilesPanel state={state} selectedProfileId={selectedProfileId} setSelectedProfileId={selectProfile} profileName={profileName} setProfileName={setProfileName} profileNotes={profileNotes} setProfileNotes={setProfileNotes} profileSelections={profileSelections} updateSelection={updateSelection} onSave={() => void saveProfile(selectedProfile?.id)} onCreate={() => void saveProfile(null)} onDuplicate={(profileId) => void duplicateProfile(profileId)} onPreviewSwitch={(profileId) => void previewSync(profileId, false, null, true)} /> : null}
          {screen === 'recovery' ? <RecoveryPanel snapshots={state?.snapshots ?? []} onRestore={previewRestore} /> : null}
          {screen === 'settings' ? <SettingsPanel draft={settingsDraft} updates={updates} setDraft={setSettingsDraft} detectedPaths={detectedPaths} onDetect={() => void detectPaths()} onSave={() => void saveSettings()} /> : null}
          {screen === 'developer' ? <DeveloperPanel state={state} draft={sourceDraft} setDraft={setSourceDraft} onRegister={() => void registerSource()} onPackage={(addon) => void packageAddon(addon)} onPromote={(addon) => void promoteBeta(addon)} exportPath={exportPath} /> : null}
        </main>

        <aside className="hidden w-[360px] shrink-0 xl:block">
          <Panel title="Preflight" subtitle="BronzeForge shows the impact first, then applies it.">
            {pendingOperation ? <PreviewCard pendingOperation={pendingOperation} onDismiss={() => setPendingOperation(null)} /> : <Empty label="No action queued." detail="Preview a sync, restore, or channel change to see the exact operation summary." />}
          </Panel>
        </aside>
      </div>
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
  state: ScanStateResponse | null
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
          {(state?.issues ?? []).length ? state?.issues.map((issue) => <IssueCard key={`${issue.code}-${issue.message}`} message={issue.message} severity={issue.severity} />) : <Empty label="No blockers right now." detail="The active BronzeForge sync plan is clear." compact />}
        </div>
      </Panel>
      <Panel title="Recent activity" subtitle="The last few mutating operations BronzeForge recorded.">
        <div className="space-y-3">
          {(state?.logs ?? []).slice(0, 6).map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="font-semibold text-bronze-50">{entry.operation}</p>
                <StatusPill label={entry.status} tone={entry.status === 'success' ? 'ok' : 'warn'} />
              </div>
              <p className="mt-2 text-sm text-bronze-100/60">{entry.message}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function AddonsPanel({
  addons,
  updates,
  search,
  setSearch,
  onInstall,
  onRemoteUpdate,
  onChannel,
  onRemove,
  onIsolate,
}: {
  addons: AddonRecord[]
  updates: Map<string, RemoteProductUpdate>
  search: string
  setSearch: (value: string) => void
  onInstall: (addonId: string) => void
  onRemoteUpdate: (addonId: string) => void
  onChannel: (addonId: string, channel: Channel) => void
  onRemove: (addonId: string) => void
  onIsolate: (addonId: string) => void
}) {
  return (
    <Panel title="Managed addons" subtitle="Search the registry and preview install or channel operations.">
      <input className="input mb-4" placeholder="Search addons or statuses" value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="space-y-3">
        {addons.map((addon) => {
          const remoteUpdate = updates.get(addon.id)
          return (
          <div key={addon.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-bronze-50">{addon.displayName}</p>
                <p className="mt-1 text-sm text-bronze-100/60">{addon.installFolder} • {addon.currentVersion ?? 'Unresolved'} • {addon.currentChannel ?? addon.defaultChannel}</p>
                {remoteUpdate ? (
                  <p className="mt-2 text-sm text-bronze-100/55">
                    Remote {remoteUpdate.channel}: {remoteUpdate.currentVersion ?? 'none'} -&gt; {remoteUpdate.latestVersion}
                  </p>
                ) : null}
              </div>
              <StatusPill label={remoteUpdate?.available ? 'update available' : addon.health} tone={remoteUpdate?.available ? 'warn' : addon.health === 'Ready' ? 'ok' : 'warn'} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <TinyButton label={addon.enabledInActiveProfile ? 'Update' : 'Install'} onClick={() => onInstall(addon.id)} />
              <TinyButton label="Remote update" disabled={!remoteUpdate?.available} onClick={() => onRemoteUpdate(addon.id)} />
              <TinyButton label="Beta" onClick={() => onChannel(addon.id, 'beta')} />
              <TinyButton label="Local Dev" onClick={() => onChannel(addon.id, 'localDev')} />
              <TinyButton label="Isolate" onClick={() => onIsolate(addon.id)} />
              <TinyButton label="Remove" tone="danger" onClick={() => onRemove(addon.id)} />
            </div>
          </div>
        )})}
      </div>
    </Panel>
  )
}

function ProfilesPanel({ state, selectedProfileId, setSelectedProfileId, profileName, setProfileName, profileNotes, setProfileNotes, profileSelections, updateSelection, onSave, onCreate, onDuplicate, onPreviewSwitch }: { state: ScanStateResponse | null; selectedProfileId: string | null; setSelectedProfileId: (value: string) => void; profileName: string; setProfileName: (value: string) => void; profileNotes: string; setProfileNotes: (value: string) => void; profileSelections: ProfileSelection[]; updateSelection: (addonId: string, patch: Partial<ProfileSelection>) => void; onSave: () => void; onCreate: () => void; onDuplicate: (profileId: string) => void; onPreviewSwitch: (profileId: string) => void }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
      <Panel title="Profile list" subtitle="Named addon sets with channel overrides.">
        <div className="space-y-3">
          {(state?.profiles ?? []).map((profile) => (
            <button key={profile.id} className={clsx('w-full rounded-2xl border px-4 py-4 text-left transition', selectedProfileId === profile.id ? 'border-bronze-300/30 bg-bronze-300/10' : 'border-white/10 bg-white/5 hover:bg-white/10')} onClick={() => setSelectedProfileId(profile.id)}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-bronze-50">{profile.name}</p>
                  <p className="mt-1 text-sm text-bronze-100/60">{profile.notes || 'No notes'}</p>
                </div>
                {profile.isActive ? <StatusPill label="Active" tone="ok" /> : null}
              </div>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Profile editor" subtitle="Save changes, then preview the switch before applying it.">
        {selectedProfileId ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Profile name"><input className="input" value={profileName} onChange={(event) => setProfileName(event.target.value)} /></Field>
              <Field label="Notes"><input className="input" value={profileNotes} onChange={(event) => setProfileNotes(event.target.value)} /></Field>
            </div>
            <div className="mt-5 space-y-3">
              {(state?.addons ?? []).map((addon) => {
                const selection = profileSelections.find((entry) => entry.addonId === addon.id)
                return (
                  <div key={addon.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div>
                      <p className="font-semibold text-bronze-50">{addon.displayName}</p>
                      <p className="mt-1 text-xs text-bronze-100/50">{addon.installFolder}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-bronze-100/70">
                        <input type="checkbox" checked={Boolean(selection?.enabled)} onChange={(event) => updateSelection(addon.id, { enabled: event.target.checked })} />
                        Enabled
                      </label>
                      <select className="input !w-auto !py-2" value={selection?.channelOverride ?? ''} onChange={(event) => updateSelection(addon.id, { channelOverride: (event.target.value || null) as Channel | null })}>
                        <option value="">Default</option>
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
              <button className="button-primary" onClick={onSave}>Save profile</button>
              <button className="button-secondary" onClick={() => onPreviewSwitch(selectedProfileId)}>Preview switch</button>
              <button className="button-secondary" onClick={() => onDuplicate(selectedProfileId)}>Duplicate</button>
            </div>
          </>
        ) : (
          <Empty label="No profile selected." detail="Choose a profile to edit its addon membership." />
        )}
        <div className="mt-6 border-t border-white/10 pt-5">
          <button className="button-secondary" onClick={onCreate}>Create new profile from current editor</button>
        </div>
      </Panel>
    </div>
  )
}

function RecoveryPanel({ snapshots, onRestore }: { snapshots: ScanStateResponse['snapshots']; onRestore: (snapshotId: string) => void }) {
  return (
    <Panel title="Recovery" subtitle="Restore points and last-known-good snapshots.">
      <div className="space-y-3">
        {snapshots.map((snapshot) => (
          <div key={snapshot.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-bronze-50">{snapshot.notes || snapshot.snapshotType}</p>
                <p className="mt-1 text-sm text-bronze-100/60">{formatWhen(snapshot.createdAt)} • {formatBytes(snapshot.sizeBytes)} • {snapshot.addonCount} items</p>
              </div>
              <button className="button-secondary" onClick={() => onRestore(snapshot.id)}>Preview restore</button>
            </div>
          </div>
        ))}
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
      <Panel title="Path configuration" subtitle="Use detection when possible, then pin exact AddOns and SavedVariables paths.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Ascension root"><input className="input" value={draft.ascensionRootPath ?? ''} onChange={(event) => setDraft((current) => ({ ...current, ascensionRootPath: event.target.value }))} /></Field>
          <Field label="AddOns path"><input className="input" value={draft.addonsPath ?? ''} onChange={(event) => setDraft((current) => ({ ...current, addonsPath: event.target.value }))} /></Field>
          <Field label="SavedVariables path"><input className="input" value={draft.savedVariablesPath ?? ''} onChange={(event) => setDraft((current) => ({ ...current, savedVariablesPath: event.target.value }))} /></Field>
          <Field label="Retention"><input className="input" type="number" value={draft.backupRetentionCount ?? 20} onChange={(event) => setDraft((current) => ({ ...current, backupRetentionCount: Number(event.target.value) }))} /></Field>
          <Field label="Update channel">
            <select className="input !py-2" value={draft.updateChannel ?? 'stable'} onChange={(event) => setDraft((current) => ({ ...current, updateChannel: event.target.value as UpdateChannel }))}>
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
            </select>
          </Field>
          <Field label="Last update check">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-bronze-100/70">
              {formatWhen(updates?.checkedAt ?? null)}
            </div>
          </Field>
          {draft.devModeEnabled ? (
            <Field label="Manifest override">
              <input className="input" value={draft.updateManifestOverride ?? ''} onChange={(event) => setDraft((current) => ({ ...current, updateManifestOverride: event.target.value }))} placeholder="https://localhost:3000/manifest" />
            </Field>
          ) : null}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="button-primary" onClick={onSave}>Save settings</button>
          <button className="button-secondary" onClick={onDetect}>Detect common installs</button>
        </div>
        {updates?.errorMessage ? <p className="mt-4 text-sm text-amber-100">{updates.errorMessage}</p> : null}
      </Panel>
      <Panel title="Detected installs" subtitle="Apply a candidate to the draft settings with one click.">
        <div className="space-y-3">
          {detectedPaths.length ? detectedPaths.map((candidate) => (
            <button key={candidate.addonsPath} className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10" onClick={() => setDraft((current) => ({ ...current, ascensionRootPath: candidate.ascensionRootPath, addonsPath: candidate.addonsPath, savedVariablesPath: candidate.savedVariablesPath }))}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-bronze-50">{candidate.label}</p>
                <StatusPill label={candidate.confidence} tone="ok" />
              </div>
              <p className="mt-2 text-xs text-bronze-100/45">{candidate.addonsPath}</p>
            </button>
          )) : <Empty label="No detections yet." detail="Run detection to scan the usual Windows install paths." compact />}
        </div>
      </Panel>
    </div>
  )
}

function DeveloperPanel({ state, draft, setDraft, onRegister, onPackage, onPromote, exportPath }: { state: ScanStateResponse | null; draft: RegisterSourceRequest; setDraft: Dispatch<SetStateAction<RegisterSourceRequest>>; onRegister: () => void; onPackage: (addon: AddonRecord) => void; onPromote: (addon: AddonRecord) => void; exportPath: string | null }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <Panel title="Source registration" subtitle="Local folder, zip, and manifest registration into the BronzeForge cache.">
        <div className="grid gap-4">
          <Field label="Source path"><input className="input" value={draft.path} onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))} /></Field>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Kind">
              <select className="input !py-2" value={draft.sourceKind} onChange={(event) => setDraft((current) => ({ ...current, sourceKind: event.target.value as RegisterSourceRequest['sourceKind'] }))}>
                <option value="local-folder">Local folder</option>
                <option value="zip-file">Zip package</option>
                <option value="manifest">Manifest</option>
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
              <label className="flex h-full items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-bronze-100/70">
                <input type="checkbox" checked={Boolean(draft.core)} onChange={(event) => setDraft((current) => ({ ...current, core: event.target.checked }))} />
                Safe-mode core
              </label>
            </Field>
          </div>
          <button className="button-primary" onClick={onRegister}>Register source</button>
        </div>
      </Panel>
      <Panel title="Package and promote" subtitle="Package revisions to zip or manually promote Beta into Stable.">
        <div className="space-y-3">
          {(state?.addons ?? []).map((addon) => (
            <div key={addon.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-bronze-50">{addon.displayName}</p>
                  <p className="mt-1 text-sm text-bronze-100/60">{addon.currentVersion ?? 'Unresolved'} • {addon.currentChannel ?? addon.defaultChannel}</p>
                </div>
                <div className="flex gap-2">
                  <button className="button-secondary" onClick={() => onPackage(addon)}>Package zip</button>
                  <button className="button-secondary" disabled={!addon.latestRevisions.some((revision) => revision.channel === 'beta')} onClick={() => onPromote(addon)}>Promote beta</button>
                </div>
              </div>
            </div>
          ))}
          {exportPath ? <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">Last package export: {exportPath}</div> : null}
        </div>
      </Panel>
    </div>
  )
}

function Panel({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle: string }>) {
  return (
    <section className="rounded-[30px] border border-white/10 bg-black/25 p-5 shadow-forge">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.28em] text-bronze-100/50">{title}</p>
        <p className="mt-2 text-sm text-bronze-100/65">{subtitle}</p>
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: PropsWithChildren<{ label: string }>) {
  return <label className="grid gap-2 text-sm"><span className="text-bronze-100/65">{label}</span>{children}</label>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-[11px] uppercase tracking-[0.2em] text-bronze-100/45">{label}</p><p className="mt-2 font-display text-3xl text-bronze-50">{value}</p></div>
}

function PreviewCard({ pendingOperation, onDismiss }: { pendingOperation: PendingOperation; onDismiss: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold text-bronze-50">{pendingOperation.title}</p>
          <StatusPill label={pendingOperation.response.preview.blockers.length ? 'Blocked' : 'Ready'} tone={pendingOperation.response.preview.blockers.length ? 'danger' : 'ok'} />
        </div>
        <p className="mt-2 text-sm text-bronze-100/60">{pendingOperation.response.message}</p>
      </div>
      {pendingOperation.response.preview.items.map((item) => (
        <div key={`${item.addonId}-${item.changeType}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-bronze-50">{item.displayName}</p>
              <p className="mt-1 text-sm text-bronze-100/60">{item.targetFolder}</p>
            </div>
            <StatusPill label={item.changeType} tone={item.changeType === 'remove' ? 'danger' : 'ok'} />
          </div>
        </div>
      ))}
      {pendingOperation.response.preview.warnings.map((warning) => <IssueCard key={`${warning.code}-${warning.message}`} message={warning.message} severity={warning.severity} />)}
      {pendingOperation.response.preview.blockers.map((blocker) => <IssueCard key={`${blocker.code}-${blocker.message}`} message={blocker.message} severity={blocker.severity} />)}
      <div className="flex gap-3">
        <button className="button-primary disabled:cursor-not-allowed disabled:opacity-40" disabled={Boolean(pendingOperation.response.preview.blockers.length)} onClick={() => void pendingOperation.apply()}>{pendingOperation.applyLabel}</button>
        <button className="button-secondary" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  )
}

function IssueCard({ message, severity }: { message: string; severity: 'blocker' | 'warning' }) {
  return <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-4 text-amber-100" /><div><StatusPill label={severity} tone={severity === 'blocker' ? 'danger' : 'warn'} /><p className="mt-2 text-sm text-bronze-100/70">{message}</p></div></div></div>
}

function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'danger' }) {
  return <span className={clsx('inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]', tone === 'ok' && 'bg-emerald-300/15 text-emerald-100', tone === 'warn' && 'bg-amber-300/15 text-amber-100', tone === 'danger' && 'bg-rose-300/15 text-rose-100')}>{label}</span>
}

function Empty({ label, detail, compact = false }: { label: string; detail: string; compact?: boolean }) {
  return <div className={clsx('rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-center', compact ? 'px-4 py-5' : 'px-6 py-10')}><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-bronze-400/10 text-bronze-100"><AlertTriangle className="size-5" /></div><p className="mt-4 font-semibold text-bronze-50">{label}</p><p className="mt-2 text-sm text-bronze-100/55">{detail}</p></div>
}

function TinyButton({ label, onClick, tone = 'default', disabled = false }: { label: string; onClick: () => void; tone?: 'default' | 'danger'; disabled?: boolean }) {
  return <button className={clsx('rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition', tone === 'danger' ? 'bg-rose-300/12 text-rose-100 hover:bg-rose-300/20' : 'bg-white/10 text-bronze-100 hover:bg-white/15', disabled && 'cursor-not-allowed opacity-40')} disabled={disabled} onClick={onClick}>{label}</button>
}

export default App

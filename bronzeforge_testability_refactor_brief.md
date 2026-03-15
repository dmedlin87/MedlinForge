# BronzeForge Testability Refactor Brief

## Goal

Refactor BronzeForge for **maximal testing ability** without changing user-facing behavior. The target outcome is an app where most important behavior can be tested through:

- pure unit tests
- controller/reducer tests
- narrow adapter contract tests
- focused component tests
- a small number of smoke/integration tests

This refactor should improve confidence, speed up bug isolation, and reduce the need to test through the full UI or full Tauri stack for every behavior.

---

## What this brief is based on

This plan merges the strongest parts of two reviews into one practical approach.

Both reviews agreed on the three main architectural problems:

1. **`src/App.tsx` is too smart**
   - UI rendering, async orchestration, screen routing, transient state, helper logic, and setup flows are mixed together.
2. **`src/lib/api.ts` mixes production transport and demo/test behavior**
   - the real Tauri bridge and demo state machine are coupled in one module.
3. **`src-tauri/src/service.rs` is too large and side-effect-heavy**
   - business rules, filesystem work, DB access, HTTP/update logic, snapshot logic, path detection, and process launching are tightly coupled.

This brief keeps the best concrete recommendations from both reviews while tightening the architecture so it does not turn into “same complexity, new folders.”

---

## Guiding principle

**Make decisions pure. Make side effects injectable. Make UI dumb.**

In practice:

- move decision logic into pure functions and reducers
- move orchestration into a controller/hook
- move external access behind small ports/adapters
- keep screen components presentational
- test preview/planning logic separately from apply/execution logic

---

## Desired end state

### Frontend

- `App.tsx` becomes a thin shell
- business/state orchestration lives in a `useLauncherController` hook
- transition-heavy state is driven by a reducer
- existing pure helpers are extracted into standalone modules
- Tauri access is hidden behind a `LauncherGateway` interface
- demo/test behavior lives in a separate fake implementation
- each screen is isolated and testable with fixture props

### Backend

- `service.rs` is split by concern
- preview/apply logic is centered around a pure sync-planning layer
- DB, filesystem, HTTP, time, and process launching use small injected ports
- pure helper logic is directly unit-tested
- integration tests remain, but most behavior no longer depends on full-stack execution

---

## Refactor strategy overview

### Phase 1 — Extract the cheapest pure wins first

Start with the logic that is already effectively pure but trapped inside large files.

#### Frontend targets

Move these kinds of functions out of `src/App.tsx` into a standalone module such as:

```text
src/features/launcher/domain/launcherLogic.ts
```

Examples:

- `getPrimaryAction`
- `labelForPrimary`
- `labelForStatus`
- `toneForStatus`
- `isProtectedAddonsPermissionError`
- setup eligibility rules
- CTA visibility logic
- recovery/banner state mapping
- “can save / can sync / can restore” guards

Also add direct tests for `src/lib/format.ts`.

#### Backend targets

Extract or expose directly testable helpers from `src-tauri/src/service.rs`, including logic like:

- selection override behavior
- display-path normalization
- protected-install-path checks
- version sanitization/comparison helpers
- pack/profile id helpers
- preview/change transformation helpers
- executable/path detection helpers

**Acceptance criteria for Phase 1**

- no user-facing behavior changes
- at least one new pure test file on both frontend and backend
- helper logic no longer requires rendering React or initializing full services to test

---

### Phase 2 — Create the frontend transport seam

Introduce a gateway/client interface so the app no longer depends directly on one mixed transport module.

### Interface

```ts
export interface LauncherGateway {
  detectPaths(): Promise<DetectPathsResponse>
  getLauncherState(): Promise<LauncherStateResponse>
  runInitialSetup(request: RunInitialSetupRequest): Promise<LauncherStateResponse>
  syncCuratedPack(): Promise<LauncherStateResponse>
  restoreLastKnownGood(request?: RestoreLastKnownGoodRequest): Promise<OperationResponse>
  launchGame(): Promise<string>
  openAddonsFolder(): Promise<string>
  setMaintainerMode(request: SetMaintainerModeRequest): Promise<LauncherStateResponse>
  saveSettings(request: SaveSettingsRequest): Promise<ScanStateResponse>
  scanLiveState(): Promise<ScanStateResponse>
  registerSource(request: RegisterSourceRequest): Promise<ScanStateResponse>
  createProfile(request: CreateProfileRequest): Promise<ScanStateResponse>
  duplicateProfile(request: { profileId: string }): Promise<ScanStateResponse>
  switchProfile(request: { profileId: string }): Promise<ScanStateResponse>
}
```

### Split `src/lib/api.ts` into

```text
src/lib/api/
  launcherGateway.ts
  tauriLauncherGateway.ts
  demoLauncherGateway.ts
```

#### Rules

- `tauriLauncherGateway.ts` should be a thin production adapter only
- `demoLauncherGateway.ts` should contain the scenario-driven fake/demo behavior
- app code should depend on the interface, not the concrete implementation
- tests should inject the fake directly instead of relying on hidden demo branching

**Acceptance criteria for Phase 2**

- production and demo/test behavior are no longer mixed in one file
- no tests depend on implicit `isTauri` branching
- fake gateway can be configured directly per test scenario

---

### Phase 3 — Replace `App.tsx` orchestration with a controller + reducer

Do **not** simply move all existing `useState` calls into a hook and stop there.

That is better than the current state, but it risks becoming “`App.tsx` in disguise.”

Instead, create:

```text
src/features/launcher/controller/
  useLauncherController.ts
  launcherReducer.ts
  launcherActions.ts
  launcherEffects.ts
```

### Responsibilities

#### `useLauncherController`

Owns:

- bootstrap/refresh
- async action execution
- notice/error handling
- settings draft hydration
- maintainer mode operations
- setup and retry orchestration
- dispatching reducer events

#### `launcherReducer`

Owns transition-heavy state, for example:

- current screen
- current launcher state
- advanced/scan state
- restore preview state
- settings draft
- selected candidates
- working action
- notices/errors
- auto-setup attempted/failed flags

### Suggested event model

Use explicit event names such as:

- `BOOTSTRAP_STARTED`
- `BOOTSTRAP_SUCCEEDED`
- `BOOTSTRAP_FAILED`
- `SCREEN_CHANGED`
- `SETTINGS_CHANGED`
- `ACTION_STARTED`
- `ACTION_SUCCEEDED`
- `ACTION_FAILED`
- `RESTORE_PREVIEW_OPENED`
- `RESTORE_PREVIEW_CLOSED`
- `NOTICE_CLEARED`
- `ERROR_CLEARED`

This makes transition logic cheap to test with no DOM.

**Acceptance criteria for Phase 3**

- `App.tsx` is reduced to a thin shell
- controller logic is testable without rendering every screen
- reducer tests cover important transition cases directly
- setup/refresh/action flows no longer require full app rendering to validate

---

### Phase 4 — Split screens into presentational components

Break the current screen rendering branches out of `App.tsx`.

### Suggested structure

```text
src/features/launcher/
  screens/
    HomeScreen.tsx
    RecoveryScreen.tsx
    SettingsScreen.tsx
    AddonsScreen.tsx
    ProfilesScreen.tsx
    DeveloperScreen.tsx
  components/
    Banner.tsx
    StatusPill.tsx
    Field.tsx
    Panel.tsx
    ConfirmDialog.tsx
```

### Rules

- screens receive data and callbacks via props
- screens should not own business orchestration
- reusable visual pieces should be extracted only when clearly shared
- avoid abstraction for its own sake

**Acceptance criteria for Phase 4**

- each screen can be rendered in isolation with fixture props
- component tests can assert specific screen behavior without app bootstrap machinery
- screen files are easier to reason about than a giant conditional render block

---

### Phase 5 — Extract backend sync planning into a pure domain layer

This is the most important backend move.

The backend needs a dedicated pure planning layer for preview/apply logic.

### Introduce a pure sync plan

```rust
pub struct SyncPlan {
    pub addon_changes: Vec<AddonChange>,
    pub saved_variable_changes: Vec<SavedVariableChange>,
    pub blockers: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
}
```

And a pure builder such as:

```rust
fn build_sync_plan(input: SyncPlanInput) -> SyncPlan
```

### Why this matters

Right now preview and apply behavior are too entangled with service execution.

A sync-plan layer lets you:

- generate previews without touching the real filesystem/network path
- validate decisions with direct unit tests
- ensure preview and apply share the same underlying decision engine
- catch regression bugs in pack/profile change logic much earlier

### Rule

- **preview should return the plan**
- **apply should execute the same plan**

This eliminates duplicated decision logic and massively improves testability.

**Acceptance criteria for Phase 5**

- preview logic can be tested as a pure function
- apply logic consumes a plan rather than recomputing scattered decisions
- plan output covers changes, warnings, and blockers in one predictable structure

---

### Phase 6 — Break `service.rs` into focused modules

Do not rewrite everything at once. Split by concern after the planning seam exists.

### Suggested structure

```text
src-tauri/src/
  application/
    launcher_service.rs
    profile_service.rs
    recovery_service.rs
    update_service.rs
  domain/
    launcher_state.rs
    settings.rs
    profiles.rs
    recovery.rs
    sync_plan.rs
    path_detection.rs
    permissions.rs
    versions.rs
  infrastructure/
    db/
      settings_repo.rs
      profile_repo.rs
      addon_repo.rs
      snapshot_repo.rs
    fs/
      addon_fs.rs
      snapshot_fs.rs
      path_scanner.rs
      permission_probe.rs
    network/
      catalog_client.rs
    os/
      process_launcher.rs
    time/
      clock.rs
  commands/
    launcher_commands.rs
```

### Important constraint

Do **not** replace one god object with giant umbrella traits like one mega `StorageLayer` or one mega `FileSystem` unless absolutely necessary.

Prefer smaller ports such as:

- `SettingsRepo`
- `ProfileRepo`
- `SnapshotRepo`
- `CatalogClient`
- `Clock`
- `ProcessLauncher`
- `AddonFilesystem`
- `SnapshotFilesystem`

Smaller ports are easier to fake, easier to evolve, and less likely to become new dumping grounds.

**Acceptance criteria for Phase 6**

- `service.rs` shrinks materially
- responsibilities are separated by domain/application/infrastructure concern
- tests can target modules directly instead of going through one giant orchestrator

---

### Phase 7 — Add narrow adapters for side effects

External dependencies should be injected through small, explicit interfaces.

### Recommended injected ports

#### Time

```rust
pub trait Clock {
    fn now_iso(&self) -> String;
}
```

#### Network/catalog

```rust
pub trait CatalogClient {
    fn fetch_catalog(&self, settings: &Settings) -> ServiceResult<(String, UpdateCatalog)>;
}
```

#### Snapshot operations

```rust
pub trait SnapshotStore {
    fn create_snapshot(&self, input: SnapshotInput) -> ServiceResult<SnapshotSummary>;
    fn restore_snapshot(&self, snapshot_id: &str) -> ServiceResult<()>;
}
```

#### Process launching

```rust
pub trait ProcessLauncher {
    fn launch(&self, executable: &std::path::Path) -> ServiceResult<()>;
}
```

Use temp-dir integration tests for heavy filesystem workflows first. Only build elaborate in-memory filesystem fakes if a real need emerges.

**Acceptance criteria for Phase 7**

- network, time, process launching, and heavy FS actions no longer require real external side effects in most tests
- narrow adapter contracts are independently testable
- test setup is simpler than full service construction

---

## Recommended file layout after initial refactor

```text
src/
  app/
    AppShell.tsx
  features/
    launcher/
      controller/
        useLauncherController.ts
        launcherReducer.ts
        launcherActions.ts
      domain/
        launcherLogic.ts
        launcherSelectors.ts
        launcherViewModel.ts
      screens/
        HomeScreen.tsx
        RecoveryScreen.tsx
        SettingsScreen.tsx
        AddonsScreen.tsx
        ProfilesScreen.tsx
        DeveloperScreen.tsx
      components/
        Banner.tsx
        StatusPill.tsx
        Field.tsx
        Panel.tsx
  lib/
    api/
      launcherGateway.ts
      tauriLauncherGateway.ts
      demoLauncherGateway.ts
    format.ts
  test/
    factories/
      launcherStateFactory.ts
      scanStateFactory.ts
    fakes/
      fakeLauncherGateway.ts
```

```text
src-tauri/src/
  application/
    launcher_service.rs
    profile_service.rs
    recovery_service.rs
    update_service.rs
  domain/
    sync_plan.rs
    launcher_state.rs
    settings.rs
    profiles.rs
    permissions.rs
    versions.rs
    path_detection.rs
  infrastructure/
    db/
      settings_repo.rs
      profile_repo.rs
      addon_repo.rs
      snapshot_repo.rs
    fs/
      addon_fs.rs
      snapshot_fs.rs
      path_scanner.rs
    network/
      catalog_client.rs
    os/
      process_launcher.rs
    time/
      clock.rs
  commands/
    launcher_commands.rs
```

---

## Testing strategy after refactor

Use a deliberate testing pyramid.

### 1. Pure unit tests — majority

Highest ROI.

#### Frontend

- launcher logic helpers
- selectors
- reducer transitions
- guard/visibility rules
- formatting functions

#### Backend

- sync-plan builder
- path detection logic
- permission mapping
- version logic
- profile resolution rules
- snapshot retention/pruning logic
- preview transformation helpers

### 2. Controller/hook tests

Test `useLauncherController` with a fake gateway.

Examples:

- bootstrap success/failure
- auto-setup eligibility and retry behavior
- maintainer mode toggling
- settings save flows
- recovery preview open/close behavior
- action error mapping

### 3. Adapter contract tests

Examples:

- fake gateway vs real gateway response-shape parity
- repository contract tests
- catalog client contract tests
- snapshot adapter contract behavior

### 4. Component tests

Test screens with fixture props.

Examples:

- correct button states
- correct banners/warnings
- recovery UI visibility
- settings form rendering
- profile list actions

### 5. Integration/smoke tests — few only

Keep only a small set of high-value flows.

Examples:

- app bootstraps
- initial setup completes
- curated pack sync path works
- recovery preview/apply path works
- game launch/open-folder plumbing works

---

## Priority order

Use this exact sequence unless strong evidence suggests otherwise.

### Priority 1

- extract pure frontend helpers
- add tests for `format.ts`
- expose/extract backend pure helpers

### Priority 2

- introduce `LauncherGateway`
- split real and demo clients

### Priority 3

- create `useLauncherController`
- add reducer/event model for transition-heavy state

### Priority 4

- split screens into presentational components

### Priority 5

- extract `SyncPlan` and pure backend planning logic

### Priority 6

- split `service.rs` by concern
- introduce narrow injected ports

### Priority 7

- expand test suite using the new seams
- keep end-to-end coverage lean

---

## What not to do

### Do not

- rewrite the whole app in one pass
- replace one giant file with many giant abstractions
- move all `useState` into a hook and call the job done
- build a complex fake filesystem before extracting pure logic
- over-invest in full-app UI tests before the seams exist
- introduce heavyweight architecture patterns just for appearances

### Do instead

- carve out pure logic first
- create narrow seams
- reduce integration burden incrementally
- let test pain guide the next extraction

---

## Definition of success

This refactor is successful when:

- most decision logic is testable without rendering the whole app
- most backend behavior is testable without real network/process launching
- preview/apply logic shares one decision engine
- demo/test behavior is cleanly separated from production transport
- `App.tsx` and `service.rs` are no longer primary complexity sinks
- adding a new test no longer feels like booting the whole product

---

## Suggested Codex execution brief

Refactor BronzeForge for maximal testability without changing user-facing behavior.

Work in phases. Start by extracting already-pure frontend and backend helpers into directly testable modules. Then introduce a `LauncherGateway` interface and split `src/lib/api.ts` into separate production and demo/fake implementations. Next, replace `App.tsx` orchestration with a `useLauncherController` built around an explicit reducer/event model for transition-heavy state. After that, split the current UI branches into presentational screen components that receive data and callbacks via props.

On the Rust side, do not begin with a giant rewrite. First extract a pure `SyncPlan`-style planning layer so preview and apply behavior share one decision engine. Then progressively split `service.rs` by concern and introduce narrow injected ports for DB, filesystem, catalog/network, time, and process launch behavior.

Favor pure tests, reducer/controller tests, and narrow adapter tests. Keep full integration tests limited to a few critical flows. Avoid abstraction theater, giant umbrella traits, and high-risk all-at-once rewrites.

---

## Optional implementation checkpoints

### Checkpoint A

- helper extraction complete
- helper tests added
- no behavior changes

### Checkpoint B

- gateway split complete
- fake/demo implementation injectable
- existing tests still pass

### Checkpoint C

- controller + reducer complete
- `App.tsx` greatly simplified
- controller transition tests added

### Checkpoint D

- screen split complete
- focused component tests added

### Checkpoint E

- pure sync plan extracted
- backend planning tests added

### Checkpoint F

- `service.rs` materially reduced
- narrow ports introduced
- smoke tests still green

---

## Final recommendation

The best hybrid plan is:

1. keep the concrete `ApiClient`/gateway split idea
2. keep the `useLauncher` extraction idea, but upgrade it into a controller + reducer
3. keep the pure-helper extraction idea
4. add a pure backend sync-planning layer as the main backend seam
5. prefer narrow injected ports over giant umbrella traits
6. use a testing pyramid intentionally instead of expanding full-app tests first

That combination gives BronzeForge the highest confidence-per-line of refactor effort.

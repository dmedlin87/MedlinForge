# BronzeForge Manager — Claude Project Instructions

## Project overview

BronzeForge Manager is a Windows-first Tauri v2 desktop app that manages addon suites for Project Ascension Bronzebeard. It is written in React + TypeScript (frontend) and Rust (backend service).

- `src/` — React/TypeScript UI
- `src-tauri/src/` — Rust service layer
- `docs/` — Product brief, release checklist, distribution guide
- `products/catalog.json` — Update catalog metadata
- `scripts/` — Manifest builder and tooling
- `bronzeforge_testability_refactor_brief.md` — Architectural refactor plan (canonical reference)

## Commands

```
npm run tag-addon-release      # Tag a new addon release
npm run dev                    # Vite dev server on http://localhost:1420
npm run tauri:dev              # Desktop shell against dev server
npm run build                  # TypeScript check + production frontend build
npm run tauri:build            # Package Windows NSIS installer
npm run test                   # Vitest
npm run lint                   # ESLint
npm run doctor:windows         # Verify Windows builder prerequisites
npm run build:update-manifests # Generate site/manifest/{stable,beta}.json
npm run test:update-manifests  # Validate manifest builder
```

## Architecture — current state (pre-refactor)

> **Refactor in progress**: Phase 1 (pure helpers) and Phase 2 (gateway split) are partially
> complete. `src/features/launcher/domain/launcherLogic.ts` and all four gateway files exist.
> `src/lib/api.ts` still exists — treat it as legacy until fully replaced.

Three primary complexity sinks that the refactor brief targets:

| File | Lines | Problem |
|---|---|---|
| `src/App.tsx` | ~526 | UI, async orchestration, routing, state, and helpers are mixed |
| `src/lib/api.ts` | ~700 | Production Tauri transport and demo/test state machine are coupled |
| `src-tauri/src/service.rs` | ~4000 | Business rules, FS, DB, HTTP, snapshots, and process launch are tightly coupled |

## Architecture — refactor target

**Guiding principle: Make decisions pure. Make side effects injectable. Make UI dumb.**

The full refactor plan lives in `bronzeforge_testability_refactor_brief.md`. Follow it unless there is a strong reason not to. The phases are:

### Phase 1 — Extract pure helpers (Priority 1)
- Frontend: move pure functions from `App.tsx` → `src/features/launcher/domain/launcherLogic.ts`
  - `getPrimaryAction`, `labelForPrimary`, `labelForStatus`, `toneForStatus`, `isProtectedAddonsPermissionError`, setup eligibility, CTA visibility, recovery/banner mapping, can-save/sync/restore guards
- Frontend: add tests for `src/lib/format.ts`
- Backend: expose/extract pure helpers from `service.rs` (selection overrides, display-path normalization, protected-path checks, version helpers, pack/profile id helpers, preview transformations, path detection)

### Phase 2 — Frontend transport seam (Priority 2)
Split `src/lib/api.ts` into:
- `src/lib/api/launcherGateway.ts` — interface definition
- `src/lib/api/tauriLauncherGateway.ts` — production Tauri adapter only
- `src/lib/api/demoLauncherGateway.ts` — demo/fake scenario behavior
- `src/test/fakes/fakeLauncherGateway.ts` — test injectable

### Phase 3 — Controller + reducer (Priority 3)
Replace `App.tsx` orchestration with:
- `src/features/launcher/controller/useLauncherController.ts`
- `src/features/launcher/controller/launcherReducer.ts`
- `src/features/launcher/controller/launcherActions.ts`

### Phase 4 — Presentational screens (Priority 4)
Split UI branches into `src/features/launcher/screens/` (HomeScreen, RecoveryScreen, SettingsScreen, AddonsScreen, ProfilesScreen, DeveloperScreen).

### Phase 5 — Pure backend sync plan (Priority 5)
Extract `build_sync_plan(input) -> SyncPlan` into `src-tauri/src/domain/sync_plan.rs`. Preview returns the plan; apply executes the same plan.

### Phase 6 — Split service.rs (Priority 6)
Break into `application/`, `domain/`, `infrastructure/`, `commands/` modules. Prefer narrow ports (`SettingsRepo`, `ProfileRepo`, `Clock`, `ProcessLauncher`, etc.) over mega-traits.

### Phase 7 — Expand test suite (Priority 7)
Pure unit tests, reducer/controller tests, adapter contract tests, focused component tests, minimal integration tests.

## Target file layout

```
src/
  app/AppShell.tsx
  features/launcher/
    controller/  useLauncherController.ts  launcherReducer.ts  launcherActions.ts
    domain/      launcherLogic.ts  launcherSelectors.ts  launcherViewModel.ts
    screens/     HomeScreen.tsx  RecoveryScreen.tsx  SettingsScreen.tsx
                 AddonsScreen.tsx  ProfilesScreen.tsx  DeveloperScreen.tsx
    components/  Banner.tsx  StatusPill.tsx  Field.tsx  Panel.tsx
  lib/
    api/  launcherGateway.ts  tauriLauncherGateway.ts  demoLauncherGateway.ts
    format.ts
  test/
    factories/  launcherStateFactory.ts  scanStateFactory.ts
    fakes/      fakeLauncherGateway.ts

src-tauri/src/
  application/  launcher_service.rs  profile_service.rs  recovery_service.rs  update_service.rs
  domain/       sync_plan.rs  launcher_state.rs  settings.rs  profiles.rs  permissions.rs  versions.rs  path_detection.rs
  infrastructure/
    db/    settings_repo.rs  profile_repo.rs  addon_repo.rs  snapshot_repo.rs
    fs/    addon_fs.rs  snapshot_fs.rs  path_scanner.rs
    network/  catalog_client.rs
    os/    process_launcher.rs
    time/  clock.rs
  commands/  launcher_commands.rs
```

## Testing strategy

Use a deliberate testing pyramid:
1. **Pure unit tests** (majority) — helpers, selectors, reducer, format, sync plan, path/version/permission logic
2. **Controller/hook tests** — `useLauncherController` with fake gateway
3. **Adapter contract tests** — fake vs real gateway shape parity, repo contracts
4. **Component tests** — screens with fixture props
5. **Integration/smoke tests** — few, only critical flows (bootstrap, setup, sync, recovery, launch)

## What not to do

- Do not rewrite everything in one pass
- Do not move all `useState` into a hook and call it done (that is `App.tsx` in disguise)
- Do not build complex fake filesystems before extracting pure logic
- Do not introduce giant umbrella traits (one mega `StorageLayer`, etc.)
- Do not add tests that go through the full UI stack for behavior already covered by pure tests
- Do not add abstraction for hypothetical future requirements

## Build and distribution

- End users get a packaged Windows NSIS installer — no Node/Rust/VS Build Tools required on user machines
- Builder machine needs: Node.js, Rust toolchain, Tauri CLI, Visual Studio Build Tools with C++ workload
- Run `npm run doctor:windows` before `tauri:dev` or `tauri:build`
- Output: `src-tauri/target/release/bundle/nsis/`
- Update manifests: `site/manifest/stable.json` and `site/manifest/beta.json` built from GitHub releases

## Key docs

- `bronzeforge_testability_refactor_brief.md` — refactor strategy and acceptance criteria per phase
- `docs/bronzeforge_manager_prd.md` — original product brief
- `docs/distribution.md` — packaging and handoff guide
- `docs/release_handoff_checklist.md` — release checklist
- `docs/addon_release_contract.md` — addon repo release contract

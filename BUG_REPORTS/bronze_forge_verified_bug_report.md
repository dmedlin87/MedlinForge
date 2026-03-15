# BronzeForge Verified Bug Report

## Scope

This document merges and verifies two prior reviews against the actual codebase, with emphasis on concrete, user-facing bugs that Codex can fix directly.

Primary files reviewed:

- `src/App.tsx`
- `src/types.ts`
- `src/lib/api.ts`
- `src-tauri/src/service.rs`

## Executive Summary

The biggest real problem is state desynchronization between `launcher` and `advanced` in `src/App.tsx`. Several buttons mutate backend state, but the UI only updates one branch of state or none at all. That creates the “finicky” feel: actions succeed, success banners appear, but the visible data stays stale or empty.

The most important fixes are:

1. Centralize post-mutation refresh behavior.
2. Hydrate `advanced` immediately when maintainer mode is enabled.
3. Disable all mutating and side-effect buttons while `working !== null`.
4. Clear transient UI state like `restorePreview` when it becomes stale.

---

## Confirmed Bugs

### 1) Enabling Maintainer Mode does not populate advanced state

**Severity:** High  
**Files:** `src/App.tsx`

#### What happens

- Turning on Maintainer Mode makes the Addons / Profiles / Developer nav items appear.
- But those screens can render with empty data immediately after toggle.

#### Why

- `refresh()` correctly hydrates `advanced` when maintainer mode is enabled at `src/App.tsx:81-82`.
- `toggleMaintainerMode()` does not do that. It only updates `launcher` at `src/App.tsx:181-183`.
- So `maintainerMode` becomes `true`, the extra screens appear, but `advanced` may still be `null`.

#### User-facing impact

- Addons can show `Nothing loaded.`
- Profiles can render incomplete or empty.
- Developer state can be stale.
- Follow-on risk: the Create Profile action derives selections from `(advanced?.addons ?? [])`, so a profile can be created with empty selections if the user clicks through before `advanced` is refreshed.

#### Fix direction

- After `api.setMaintainerMode(...)`, either call `await refresh()` or immediately call `api.scanLiveState()` and `setAdvanced(...)` when enabling.
- When disabling maintainer mode, also clear `advanced` and normalize `screen` the same way `refresh()` already does.

---

### 2) Maintainer actions succeed but the maintainer UI does not update

**Severity:** High  
**Files:** `src/App.tsx`, `src/lib/api.ts`, `src-tauri/src/service.rs`

#### Affected actions

- `Switch` profile at `src/App.tsx:349`
- `Duplicate` profile at `src/App.tsx:350`
- `Create Profile` at `src/App.tsx:359`
- `Register Source` at `src/App.tsx:372`

 What happens

- The app shows success notices like `Profile switched.` or `Source registered.`
- But the visible maintainer screens do not reflect the change.

#### Why

- These handlers call `run(...)`, but they ignore the returned `ScanStateResponse`.
- The API layer returns updated scan state for all of these actions:
  - `create_profile` -> `ScanStateResponse`
  - `duplicate_profile` -> `ScanStateResponse`
  - `switch_profile` -> `ScanStateResponse`
  - `register_source` -> `ScanStateResponse`
- The backend/service also returns updated scan state for the corresponding operations.
- The frontend never applies that returned state to `advanced`, and it does not call `refresh()` afterward.

#### User-facing impact

- Action feels like a no-op.
- Success banner can be misleading.
- User may repeat the action and create duplicates or extra unintended state changes.

#### Fix direction

- For every action above, either:
  - assign the return value to `setAdvanced(response)`, or
  - call `await refresh()` after success.
- Prefer a shared helper for “mutation that affects advanced state.”

---

### 3) Sync Pack updates Home state but leaves maintainer state stale

**Severity:** High  
**Files:** `src/App.tsx`

**What happens**

- Home updates after a sync.
- Addons / Profiles / Developer can still show pre-sync data.

### Why

- `syncPack()` only does `setLauncher(next)` at `src/App.tsx:147-149`.
- It never refreshes `advanced`.

**User-facing impact**

- Home and maintainer screens disagree about installed versions and current state.
- This is another state-desync bug.

**Fix direction**

- After sync success, call `await refresh()` instead of only `setLauncher(next)`.
- Or update both `launcher` and `advanced` in one post-sync flow.

---

### 4) Restore preview persists after it becomes stale

**Severity:** Medium  
**Files:** `src/App.tsx`

**What happens**

- After `Preview Restore`, the preview remains visible even if the user leaves Recovery and comes back later.
- It also survives unrelated state changes unless an actual restore is applied or the user presses `Cancel`.

**Why**

- `restorePreview` is set at `src/App.tsx:152-155`.
- It is only cleared in two places:
  - after successful restore at `src/App.tsx:159-161`
  - manual cancel at `src/App.tsx:298`
- It is not cleared on screen change or general refresh.

**User-facing impact**

- User can see an outdated preview and mistake it for the current restore plan.

**Fix direction**

- Clear `restorePreview` whenever the screen changes away from `recovery`, or clear it at the start of `refresh()`.
- Also consider disabling restore actions while a restore operation is in flight.

---

### 5) Buttons remain clickable during in-flight work

**Severity:** Medium  
**Files:** `src/App.tsx`

**What happens**

- Only the main Home primary button is disabled during work (`disabled={working !== null}` at `src/App.tsx:220`).
- Many other buttons remain active while a mutation or side effect is already running.

**Confirmed examples**

- Home:
  - `Open AddOns Folder` at `src/App.tsx:224`
  - `Launch Game` at `src/App.tsx:229`
- Recovery:
  - `Preview Restore` at `src/App.tsx:282`
  - `Restore Last Known Good` at `src/App.tsx:297`
  - `Cancel` at `src/App.tsx:298`
- Settings:
  - `Save Settings` at `src/App.tsx:328`
  - `Enable/Disable Maintainer Mode` at `src/App.tsx:329`
- Profiles:
  - `Switch` at `src/App.tsx:349`
  - `Duplicate` at `src/App.tsx:350`
  - `Create Profile` at `src/App.tsx:359`
- Developer:
  - `Register Source` at `src/App.tsx:372`

**User-facing impact**

- Double-submits
- overlapping state changes
- repeated launches / folder opens
- inconsistent notices and harder-to-reproduce bugs

**Fix direction**

- Standardize button disabling with `disabled={working !== null}` for all action buttons.
- Consider a helper component or shared prop pattern so this does not regress.

---

### 6) Open AddOns Folder is exposed even when setup is incomplete

**Severity:** Medium  
**Files:** `src/App.tsx`, `src-tauri/src/service.rs`

**What happens**

- The Home screen always renders `Open AddOns Folder` at `src/App.tsx:224-227`.
- But the backend requires a configured AddOns path.

**Why**

- Backend logic at `src-tauri/src/service.rs:609-615` returns an error if `settings.addons_path` is not set.

**User-facing impact**

- On fresh or incomplete setup, the UI presents a button that is known to fail.

**Fix direction**

- Hide or disable `Open AddOns Folder` unless `launcher.pathHealth.addonsPath` is available.
- Optionally show a tooltip or inline hint explaining why it is disabled.

---

### 7) New profile input is seeded with `Brother` and does not reset

**Severity:** Low  
**Files:** `src/App.tsx`

**What happens**

- The create-profile input starts with `Brother` at `src/App.tsx:54`.
- After profile creation, the field is not cleared.

**Why this is worth fixing**

- It looks like leftover developer/demo data rather than intentional product behavior.
- It increases the chance of accidental duplicate profile names.

**Fix direction**

- Initialize with `''`.
- After successful profile creation, clear the field or set a neutral placeholder.

---

### 8) Addons list uses display strings as React keys

**Severity:** Low  
**Files:** `src/App.tsx`

**What happens**

- `ListCard` renders with `key={item}` at `src/App.tsx:397-398`.
- The Addons screen passes formatted display strings like `${addon.displayName} · ${addon.currentVersion ?? 'not installed'}` at `src/App.tsx:337`.

**Why this is a bug risk**

- Duplicate display strings can create React key collisions.
- That can cause warnings or misrendering if two rows share the same label/version string.

**Fix direction**

- Pass structured addon data into the list and key by `addon.id`.

---

## Findings Reviewed but Not Carried Forward as Concrete Bugs

### A) `saveSettings()` omits `maintainerModeEnabled`

**Status:** Not carried forward as a concrete bug.

**Why**

- Frontend `saveSettings()` does omit `maintainerModeEnabled` from the request.
- But maintainer mode is actually persisted through the dedicated `toggleMaintainerMode()` flow.
- Backend `save_settings` preserves the current `maintainer_mode_enabled` value when that field is omitted.
- So this is more of a code-shape inconsistency than a demonstrated user-facing bug.

### B) Auto-setup retry logic is brittle

**Status:** Not carried forward as a concrete bug.

**Why**

- The effect only auto-runs in a narrow condition, which is true.
- But the user is not stuck: when no install is detected, the UI explicitly offers manual setup via Settings at `src/App.tsx:250-252`.
- The primary setup flow can also still be triggered manually.
- This is a possible UX improvement, but not a confirmed broken path.

### C) `Channel` includes `localDev` while the select only offers `stable` / `beta`

**Status:** Low-confidence mismatch, not carried forward as a concrete user-facing bug.

**Why**

- The type mismatch exists in `src/types.ts` and `src/App.tsx`.
- But the current UI never hydrates `sourceChannel` from backend data, so the user cannot naturally land in a broken `localDev` selected state from the current flow.

---

## Root Cause Pattern

A lot of the instability comes from the same architectural issue:

- `launcher` drives the player-facing screens.
- `advanced` drives the maintainer screens.
- Mutations update one of those, both of those, or neither, depending on the handler.

That split makes it easy for the UI to drift into contradictory states.

---

## Recommended Fix Strategy

### 1) Create a single post-mutation refresh pattern

For any action that can affect launcher state, maintainer state, or both:

- perform the mutation
- clear stale transient state as needed
- call `await refresh()`

This is the safest and least fragile fix.

### 2) Treat `advanced` as invalid whenever launcher mode/state changes materially

At minimum:

- hydrating maintainer mode should populate `advanced`
- disabling maintainer mode should clear `advanced`
- sync should refresh `advanced`
- restore/apply flows should clear stale preview state

### 3) Lock the UI while work is running

Apply a consistent disabled/loading treatment to every action button, not just the main primary CTA.

---

## Suggested Regression Tests

Add tests for these exact flows in `src/App.test.tsx`:

1. Enable Maintainer Mode -> open Addons -> managed addons are present immediately.
2. Maintainer mode enabled -> Switch profile -> UI reflects active profile change.
3. Create profile -> new profile appears without manual refresh.
4. Register source -> addon appears in Addons view without manual refresh.
5. Sync pack while maintainer mode is enabled -> Addons view updates to latest versions.
6. Preview restore -> navigate away -> return -> stale preview is cleared.
7. While `working !== null`, all action buttons are disabled.
8. On incomplete setup, `Open AddOns Folder` is hidden or disabled.

---

## Priority Order for Codex

1. Fix maintainer-mode hydration and all advanced-state stale-update paths.
2. Normalize all mutating actions to `await refresh()`.
3. Disable all action buttons during `working`.
4. Clear stale restore preview state.
5. Clean up low-severity UX/React issues (`Brother` default, list keys).

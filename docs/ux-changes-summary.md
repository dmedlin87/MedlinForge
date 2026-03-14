# BronzeForge Manager — UX Changes Summary

**Date:** 2026-03-14

---

## Changes by File

### `src/App.tsx`

1. **Loading state** — Added `loading` boolean state and centered spinner UI shown while initial `scanLiveState()` call is pending. Prevents blank screen flash.

2. **Toast notification system** — New `Toast` interface and `addToast` callback. Toasts appear in bottom-right corner with slide-in animation, auto-dismiss after 4s. Success (green) and error (red) tones. Called after every mutating operation (sync, profile switch, source register, profile create, etc.).

3. **Mobile responsive navigation** — Added `mobileNavOpen` state, sticky top bar with hamburger button (`Menu` icon), slide-out drawer overlay with backdrop. Drawer contains same nav items as desktop sidebar. Closes on selection, X button, or backdrop click.

4. **Preflight mobile drawer** — Added `preflightOpen` state. On screens below `xl:`, preflight panel renders as a bottom sheet drawer with backdrop. Escape key dismisses it. Triggered by any preview action.

5. **Accessibility improvements**:
   - `aria-current="page"` on active navigation buttons
   - `aria-label` on icon-only buttons (hamburger, close, toast dismiss)
   - `aria-hidden="true"` on decorative icons
   - `role="status"` and `aria-live="polite"` on toast container
   - Screen-reader-only `<h1>` for app title

6. **Heading hierarchy** — `Panel` component title changed from `<p>` to `<h2>` for proper document structure.

7. **Destructive apply button** — Apply button in preflight panel turns red (`bg-red-600 hover:bg-red-500`) when operation includes uninstall/remove items.

8. **Applying state** — Added `applying` boolean. Apply button shows `Loader2` spinner and "Applying…" text while operation executes. Prevents double-submit.

9. **Disabled quick action buttons** — Dashboard quick actions get `disabled` attribute when no addons/profiles exist or other preconditions aren't met.

10. **Empty state icons** — `Empty` component now accepts `icon` prop (`inbox` | `check` | `warning`). Neutral empty states use `Inbox`, success states use `Check`, only warnings use `AlertTriangle`.

11. **Field hints** — `Field` component now accepts optional `hint` prop, rendering helper text below inputs in muted style.

12. **Search enhancements** — Addon search shows result count ("N addons" / "N of M addons"). Clear button (X icon) appears when search has text.

13. **Copy improvements**:
    - "Dismiss" → "Cancel" on preflight panel
    - Clearer button labels throughout
    - Better empty-state messages
    - Added placeholder text to all form inputs

14. **Monospace font** — Path fields and target folder names use `font-mono` for clarity.

15. **Profile creation placement** — "+ New profile" button moved into the profile list panel for better discoverability.

### `src/index.css`

1. **Focus-visible outlines** — Added `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze-300/60` to `.input` class.

2. **Button disabled states** — Added `disabled:cursor-not-allowed disabled:opacity-40` to `.button-primary` and `.button-secondary`.

3. **Button focus outlines** — Added `focus-visible:outline` styles to both button classes.

4. **Toast animation** — New `@keyframes slide-in-from-right` and `.animate-in` class for toast slide-in effect.

5. **Reduced motion** — `@media (prefers-reduced-motion: reduce)` query disables animations and reduces transition durations for users who prefer reduced motion.

### `src/App.test.tsx`

1. **Updated assertion** — Changed `/BronzeForge control center/i` to `/Control center/i` to match shortened panel title.

---

## New Dependencies

None. All changes use existing dependencies (`lucide-react`, `clsx`, React, Tailwind CSS).

---

## Breaking Changes

None. All changes are additive. Existing Tauri IPC commands are unchanged. Demo mode continues to work identically.

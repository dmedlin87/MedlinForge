# BronzeForge Manager — UX Audit Report

**Date:** 2026-03-14
**Auditor:** Claude (automated UX review)
**Scope:** All frontend source files (`src/App.tsx`, `src/index.css`, `src/lib/api.ts`, `src/lib/format.ts`, `src/types.ts`, `tailwind.config.js`)

---

## Executive Summary

BronzeForge Manager is a Tauri v2 desktop addon manager with a single-file React frontend (`App.tsx`, ~574 lines pre-audit). The UI follows a sidebar-plus-content layout with six screens, a preview-then-apply pattern for destructive operations, and a custom bronze color palette.

The audit identified **14 high-leverage UX issues** across navigation, feedback, accessibility, responsiveness, and copy clarity. All were addressed in this pass. No behavioral changes were made — every fix is additive, preserving the existing interaction model while layering on missing UX infrastructure.

---

## Audit Methodology

- **Heuristic evaluation** against Nielsen's 10 usability heuristics
- **WCAG 2.2 AA** accessibility checklist (focus management, landmarks, color contrast, screen-reader labeling)
- **State coverage** audit: loading, empty, error, success, disabled, in-progress
- **Responsive** audit: behavior at mobile, tablet, and desktop widths
- **Copy review**: button labels, empty-state messages, placeholder text, heading hierarchy

---

## Findings Table

| # | Issue | Heuristic | Severity | Status |
|---|-------|-----------|----------|--------|
| 1 | No loading state — app renders blank until scan completes | Visibility of system status | High | Fixed |
| 2 | No active nav indicator for screen readers (`aria-current`) | Accessibility | High | Fixed |
| 3 | Sidebar hidden below XL with no alternative navigation | Flexibility & efficiency | Critical | Fixed |
| 4 | Destructive "Apply" button same visual weight as safe actions | Error prevention | High | Fixed |
| 5 | No success/error feedback after mutating operations | Visibility of system status | High | Fixed |
| 6 | Panel titles use `<p>` instead of `<h2>` — no heading hierarchy | Accessibility | Medium | Fixed |
| 7 | Empty states all use warning icon even for neutral states | Match between system & real world | Medium | Fixed |
| 8 | No focus-visible outlines on interactive elements | Accessibility | High | Fixed |
| 9 | Quick action buttons unclear when disabled (no `disabled` attr) | Error prevention | Medium | Fixed |
| 10 | Confusing copy: "Dismiss" for cancel, unclear button labels | Match between system & real world | Medium | Fixed |
| 11 | No keyboard dismiss for preflight panel | User control & freedom | Medium | Fixed |
| 12 | Preflight panel hidden at non-XL widths | Consistency & standards | High | Fixed |
| 13 | No `<h1>` landmark for the app | Accessibility | Medium | Fixed |
| 14 | No search result count or clear button in addon search | Visibility of system status | Low | Fixed |

---

## Improvement Strategy

Changes were implemented in priority order following the task specification:

1. **Navigation clarity** — Mobile hamburger menu + slide-out drawer, `aria-current="page"`, screen descriptions in nav
2. **Primary workflow clarity** — Loading spinner, `applying` state with spinner on Apply button, destructive Apply turns red
3. **Information hierarchy** — `<h1>` app title, `<h2>` panel titles, proper heading structure
4. **State visibility** — Toast notifications for all mutations, loading state, applying state, search result count
5. **Accessibility** — `focus-visible:outline` on all interactives, `aria-label`/`aria-hidden`/`role` attributes, `prefers-reduced-motion` support
6. **Error prevention** — Destructive button styling, `disabled` states on quick actions, confirmation copy improvements
7. **Forms/settings clarity** — Placeholder text on all inputs, hint text on form fields, monospace font on path fields
8. **Empty/loading/error/success states** — Configurable empty-state icon (inbox/check/warning), loading spinner, toast system
9. **Copy improvements** — "Dismiss" → "Cancel", clearer button labels, better empty-state messages
10. **Visual polish** — Toast slide-in animation, reduced-motion media query, consistent spacing

---

## Before / After Rationale

### Loading State
- **Before:** Blank screen until `scanLiveState` resolves.
- **After:** Centered spinner with "Loading…" text. Users immediately see the app is working.
- **Heuristic:** Visibility of system status.

### Mobile Navigation
- **Before:** Sidebar only visible at `xl:` breakpoint. Smaller screens had no way to navigate.
- **After:** Sticky top bar with hamburger menu opens a slide-out drawer overlay. Drawer closes on nav selection, X button, or backdrop click.
- **Heuristic:** Flexibility and efficiency of use.

### Toast Notifications
- **Before:** No feedback after sync, profile switch, source registration, or any mutation.
- **After:** Toast system with success (green) and error (red) toasts, auto-dismiss after 4 seconds, slide-in animation, dismiss button.
- **Heuristic:** Visibility of system status.

### Destructive Apply Button
- **Before:** Apply button always bronze/primary regardless of operation type.
- **After:** Apply button turns red (`bg-red-600`) when the operation includes uninstalls/removals. Visual weight signals danger.
- **Heuristic:** Error prevention.

### Heading Hierarchy
- **Before:** Panel titles used `<p className="text-lg font-semibold">`. No `<h1>` on page.
- **After:** Panel titles use `<h2>`. App name rendered as screen-reader-only `<h1>`. Proper document outline.
- **Heuristic:** Accessibility (WCAG 1.3.1 Info and Relationships).

### Focus-visible Outlines
- **Before:** No visible focus indicators on buttons, inputs, or nav items.
- **After:** `focus-visible:outline-2 outline-bronze-300` on all interactive elements. Keyboard users can see where focus is.
- **Heuristic:** Accessibility (WCAG 2.4.7 Focus Visible).

### Preflight Panel on Mobile
- **Before:** Preflight panel only visible at `xl:` breakpoint as a sidebar.
- **After:** On smaller screens, preflight opens as a bottom sheet drawer with backdrop overlay and Escape key dismiss.
- **Heuristic:** Consistency and standards.

---

## Files Changed

| File | Type of Change |
|------|---------------|
| `src/App.tsx` | Major — added loading state, toast system, mobile nav, accessibility attributes, copy improvements, disabled states, destructive styling, search enhancements, heading hierarchy, preflight mobile drawer |
| `src/index.css` | Minor — added `focus-visible` outlines, `disabled` states to button classes, toast animation keyframes, `prefers-reduced-motion` media query |
| `src/App.test.tsx` | Minor — updated test assertion to match shortened panel title ("Control center") |

---

## Remaining UX Debt (Recommended Next Pass)

| Area | Description | Priority |
|------|-------------|----------|
| Drag-and-drop | Profile reordering and addon priority via drag | Low |
| Keyboard shortcuts | Global hotkeys for common actions (Ctrl+S save, Ctrl+1-6 screen nav) | Medium |
| Undo support | Undo last sync/restore via toast action button | Medium |
| Skeleton loading | Replace spinner with skeleton placeholders for perceived performance | Low |
| Dark/light theme toggle | Currently hardcoded dark — consider user preference | Low |
| Error boundary | Global React error boundary with recovery UI | Medium |
| Confirmation dialogs | Modal confirmation for high-risk operations (uninstall, restore) | Medium |
| Search persistence | Remember last search query when returning to addons screen | Low |
| Tooltip system | Hover tooltips for truncated text and icon-only buttons | Low |
| Animation refinement | Staggered list enter animations, page transitions | Low |

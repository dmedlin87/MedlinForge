# BronzeForge Manager

Windows-first desktop addon manager for Project Ascension Bronzebeard addon suites.

## What is in this repo

- `src/`: React + TypeScript control surface with Dashboard, Addons, Profiles, Recovery, Settings, and Developer screens
- `src-tauri/`: Tauri v2 shell and Rust service layer for registry, profiles, revisions, snapshots, sync previews, and restore flows
- `docs/bronzeforge_manager_prd.md`: original product brief used to shape the implementation

## Core behavior

- Local-first sources only in v1: local folders, zip imports, and local manifest packages
- Profile sync previews before apply, with snapshot-first mutation flows
- Managed/unmanaged AddOns boundary: unmanaged folders are surfaced but not auto-adopted or deleted
- Recovery snapshots plus last-known-good snapshot creation after successful sync
- Developer utilities for packaging revisions and promoting Beta to Stable

## Scripts

- `npm run dev`: Vite dev server on `http://localhost:1420`
- `npm run tauri:dev`: run the desktop shell against the Vite dev server
- `npm run build`: TypeScript check plus production frontend build
- `npm run test`: Vitest UI smoke coverage
- `npm run lint`: ESLint

## Native toolchain note

The frontend is verified in this workspace with `lint`, `test`, and `build`.

The Rust/Tauri backend code is present, but native compilation currently requires the Microsoft C++ build tools on this machine because the Rust MSVC linker dependency (`link.exe`) is missing. Once Visual Studio Build Tools with C++ are installed, run:

```powershell
$env:Path="$env:USERPROFILE\.cargo\bin;$env:Path"
cd src-tauri
cargo check
```

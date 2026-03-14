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
- GitHub-based update delivery for owned products: GitHub Pages manifests, GitHub Releases assets, and checksum-verified downloads in the desktop app

## Update Publishing

- Product metadata lives in [`products/catalog.json`](/Users/dmedl/Projects/MedlinForge/products/catalog.json)
- The manifest builder lives in [`scripts/build-update-manifests.mjs`](/Users/dmedl/Projects/MedlinForge/scripts/build-update-manifests.mjs)
- GitHub Pages publication is defined in [`.github/workflows/publish-update-manifests.yml`](/Users/dmedl/Projects/MedlinForge/.github/workflows/publish-update-manifests.yml)
- The manager release workflow is defined in [`.github/workflows/manager-release.yml`](/Users/dmedl/Projects/MedlinForge/.github/workflows/manager-release.yml)
- Owned addon repos should follow [`docs/addon_release_contract.md`](/Users/dmedl/Projects/MedlinForge/docs/addon_release_contract.md)

## Distribution Target

BronzeForge Manager should ship to end users as a simple Windows install, not as a development environment setup.

- End users should install and run the app without Node.js, npm, Rust, Cargo, or Visual Studio Build Tools
- The intended handoff is a packaged Windows installer or app bundle produced by the maintainer
- If a runtime prerequisite is needed, it should be limited to standard Windows components such as WebView2 and handled by installer guidance rather than manual developer steps
- Developer toolchain requirements in this repo apply only to building and packaging the app

## Scripts

- `npm run dev`: Vite dev server on `http://localhost:1420`
- `npm run doctor:windows`: verify Windows builder prerequisites before running Tauri
- `npm run tauri:dev`: run the desktop shell against the Vite dev server
- `npm run build`: TypeScript check plus production frontend build
- `npm run build:update-manifests`: generate `site/manifest/stable.json` and `site/manifest/beta.json` from GitHub releases
- `npm run tauri:build`: produce a packaged Windows installer build
- `npm run test`: Vitest UI smoke coverage
- `npm run test:update-manifests`: validate the manifest builder against release-selection and schema edge cases
- `npm run lint`: ESLint

## Builder Vs End User Requirements

### Builder machine

Needed only on the machine that develops or packages the app:

- Node.js and npm
- Rust toolchain
- Tauri CLI available as the `tauri` command
- Microsoft Visual Studio Build Tools with the Visual C++ toolchain so `link.exe` is available
- Tauri packaging prerequisites required by Windows builds

The repo scripts now prepend the default Cargo location on Windows automatically when Rust is installed under `%USERPROFILE%\.cargo\bin`. The Windows doctor also verifies that the Visual Studio C++ build tools are installed, so you can validate the machine from a normal PowerShell session. If your Rust install lives somewhere else, make sure `cargo` is on `PATH`.

Install Visual Studio Build Tools with these Windows components:

- Desktop development with C++ workload
- MSVC v143 VS 2022 C++ x64/x86 build tools
- Windows 11 SDK or Windows 10 SDK

Before running `npm run tauri:dev` or `npm run tauri:build`, you can verify the builder machine with:

```powershell
npm run doctor:windows
```

Manual shell fix if you still need it:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
```

### End-user machine

The intended end-user experience is:

- download the packaged Windows installer
- run the installer
- launch BronzeForge Manager

End users should not need:

- Node.js
- npm
- Rust or Cargo
- Visual Studio Build Tools
- command-line setup steps

The only likely runtime prerequisite is Microsoft Edge WebView2, which is commonly already present on Windows 10 and 11 systems.

## Packaging For Distribution

The Tauri config is set to build an NSIS Windows installer for distribution.

Maintainer packaging flow:

```powershell
npm install
npm run doctor:windows
npm run tauri:build
```

Expected output location after a successful package build:

- `src-tauri/target/release/bundle/nsis/`

Recommended handoff to a trusted Windows user:

- send the generated installer executable
- tell them they may need WebView2 if their machine does not already have it
- if Windows SmartScreen appears, explain that this is expected for an unsigned personal build

For a fuller builder and handoff checklist, see `docs/distribution.md` and `docs/release_handoff_checklist.md`.

## Native toolchain note

The frontend is verified in this workspace with `lint`, `test`, and `build`.

The Rust/Tauri backend code is present, but native compilation currently requires the Microsoft C++ build tools on this machine because the Rust MSVC linker dependency (`link.exe`) is missing. This requirement is for the maintainer machine only, not for end users of a packaged build. Once Visual Studio Build Tools with C++ are installed, run:

```powershell
$env:Path="$env:USERPROFILE\.cargo\bin;$env:Path"
cd src-tauri
cargo check
```

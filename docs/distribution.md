# Distribution Guide

This project is intended to be distributed to end users as a simple Windows installer.

## Goal

The maintainer builds and packages BronzeForge Manager. End users install and run it without setting up a development environment.

## Builder Requirements

The builder machine needs:

- Node.js and npm
- Rust toolchain
- Tauri CLI available as the `tauri` command
- Microsoft Visual Studio Build Tools with the C++ toolchain so `link.exe` is available

Optional but commonly needed:

- Microsoft Edge WebView2 runtime for local validation on a clean Windows machine

Recommended Visual Studio Build Tools selection:

- Desktop development with C++ workload
- MSVC v143 VS 2022 C++ x64/x86 build tools
- Windows 11 SDK or Windows 10 SDK

The repo `tauri:dev`, `tauri:build`, and `doctor:windows` scripts automatically prepend `%USERPROFILE%\.cargo\bin` on Windows when Rust is installed there. The Windows doctor also verifies that the Visual Studio C++ build tools are installed, so you can validate the machine from a normal PowerShell session. If Rust is installed elsewhere, prepend Cargo to `PATH` manually:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
```

Before attempting a local Tauri build, run the builder preflight check:

```powershell
npm run doctor:windows
```

This verifies Node.js, npm, Cargo, Rust, the Tauri CLI, and whether `link.exe` is visible in the current shell.

## Build And Package

From the repository root:

```powershell
npm install
npm run doctor:windows
npm run tauri:build
```

This should produce an NSIS installer under:

- `src-tauri/target/release/bundle/nsis/`

## End User Experience

The end user should only need to:

1. download the packaged installer executable
2. run the installer
3. launch BronzeForge Manager from the Start menu or desktop shortcut

End users should not need to install or use:

- Node.js
- npm
- Rust
- Cargo
- Visual Studio Build Tools
- a terminal

## Expected Handoff Notes

When sending the app to a trusted Windows user, include these notes:

- this is a packaged desktop app, not a source checkout
- if prompted for WebView2, install it and rerun the app
- if SmartScreen warns about an unrecognized app, that is expected for an unsigned personal build

## Recommended Verification Before Sharing

Before giving the installer to another person:

1. run the packaged app on your own machine outside the dev environment
2. verify first-launch setup, addon path detection, and one install or sync flow
3. confirm the installer can be removed cleanly from Windows Apps settings
4. if possible, test once on a second Windows machine that does not have your dev toolchain installed

For a share-ready checklist and the message to send with the installer, see `docs/release_handoff_checklist.md`.

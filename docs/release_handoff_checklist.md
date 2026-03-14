# Release And Handoff Checklist

Use this checklist before sending BronzeForge Manager to a nontechnical Windows user.

## Builder Checklist

1. confirm Rust is installed
2. confirm the `tauri` command works
3. confirm Visual Studio Build Tools includes Desktop development with C++
4. run `npm install`
5. run `npm run test`
6. run `npm run build`
7. run `npm run tauri:build`
8. locate the generated installer under `src-tauri/target/release/bundle/nsis/`

## Pre-Share Verification

1. install the generated installer on your own machine as if you were an end user
2. verify the app launches outside the dev environment
3. verify first-launch behavior and addon path setup
4. run at least one addon install, sync, or restore flow
5. uninstall once from Windows Apps settings and confirm removal behaves normally
6. if possible, test on a second Windows machine without your dev toolchain installed

## What To Send The User

Send:

- the NSIS installer executable
- a short note that this is the packaged app, not source code

Suggested message:

```text
Run the installer, then launch BronzeForge Manager normally from Windows. You do not need Node, Rust, Visual Studio, or any command-line setup. If Windows asks about WebView2, install it and rerun the app. If SmartScreen warns that the app is unrecognized, that is expected for an unsigned personal build.
```

## User First-Launch Expectations

The user should only need to:

1. run the installer
2. open BronzeForge Manager
3. point the app at the Ascension AddOns folder if prompted
4. use the normal UI to install or sync addons

The user should not need to:

- open a terminal
- install Node.js or npm
- install Rust or Cargo
- install Visual Studio Build Tools
- clone the repository

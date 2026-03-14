# PRD — BronzeForge Manager

A desktop add-on manager for Project Ascension Bronzebeard add-ons

## 1. Product Overview

### Product Name

BronzeForge Manager

### One-Line Summary

A Windows-first desktop app for installing, updating, organizing, testing, backing up, and rolling back custom Bronzebeard add-ons and their settings.

### Product Vision

Make managing your Bronzebeard add-ons feel as safe and easy as using a modern mod manager, while also supporting your developer workflow for building and testing new addon versions.

## 2. Problem

Managing custom Ascension/Bronzebeard add-ons by hand is fragile.

Today, the workflow often involves:

- copying folders manually
- overwriting working builds with experimental ones
- losing good SavedVariables states
- forgetting dependencies or load order expectations
- breaking a stable UI setup while testing a single addon
- struggling to return to a known-good setup quickly

The official launcher can help with addon distribution at a general level, but it does not solve your specific problem: managing your own evolving addon suite, profiles, release channels, and recovery flow.

## 3. Users

### Primary User

You, the developer and main operator:

- building custom Bronzebeard addons
- switching between stable and dev builds
- wanting profile-based setups
- needing fast rollback when something breaks

### Secondary Users

Small trusted group:

- brother
- friends
- testers
- guildmates

### Future Users

Broader Ascension players who want curated addon packs for Bronzebeard.

## 4. Goals

### Primary Goals

- install and update your addon suite quickly
- protect working setups with backups and rollback
- support multiple playstyle profiles
- support stable, beta, and local-dev channels
- improve dev/test workflow for addon iteration

### Success Metrics

- full addon pack install in under 30 seconds
- rollback to last-known-good state in under 10 seconds
- profile switch with no manual file edits
- fewer broken UI incidents after experimental changes
- one-click movement between stable and dev builds

## 5. Non-Goals for MVP

Not in v1:

- public addon marketplace
- cloud account system
- mobile app
- full third-party addon catalog scraping
- deep in-game integration
- auto-debugging WoW errors from live logs
- replacing the Ascension launcher entirely

## 6. Product Positioning

BronzeForge Manager is:

- **not** a generic WoW addon manager
- **not** a CurseForge clone
- **not** a replacement launcher

It **is**:

- a personal addon ecosystem manager
- a profile switcher
- a backup and restore system
- a release channel manager
- a safer dev/test deployment tool

## 7. Core Use Cases

### Use Case 1: Install My Addon Suite

User opens app, selects a profile or bundle, clicks Install/Sync, and all required managed addons are copied into the correct Ascension addon folder.

### Use Case 2: Test a New Version Safely

User switches one addon from Stable to Beta or Local Dev, creates a restore point automatically, tests in game, and can instantly revert.

### Use Case 3: Recover From a Broken UI State

User opens Recovery, sees the last successful state, and restores addons plus SavedVariables snapshot.

### Use Case 4: Maintain Different Play Modes

User switches between Leveling, PvP, Raid, and Dev profiles without manually renaming folders or toggling many settings.

## 8. MVP Scope

### Included in MVP

- detect or configure Ascension addon path
- register managed addons
- install, update, reinstall, uninstall managed addons
- create and switch profiles
- backup and restore managed addon files
- backup and restore managed SavedVariables
- stable / beta / local-dev channels
- dependency validation
- conflict warnings
- last-known-good restore
- basic activity log

### Excluded From MVP

- online addon browsing marketplace
- auto-pulling all releases from public repositories
- multi-user sync
- per-character config intelligence
- advanced diff viewer
- crash log parsing

## 9. Feature Requirements

### 9.1 Addon Registry

The app must maintain a catalog of managed addons.

Each addon record should contain:

- unique id
- display name
- folder name
- version
- source type
- source location
- channel
- dependency list
- conflict list
- status
- install timestamp
- notes
- compatibility label

Supported source types in MVP:

- local folder
- zip package
- local manifest-defined package

Future source types:

- GitHub release
- remote manifest URL

### 9.2 Install / Update Flow

User can:

- install a single addon
- install all missing addons in a profile
- update one addon
- update all addons
- reinstall addon cleanly
- uninstall addon without touching unmanaged folders

System behavior:

- validate target path
- create backup before write
- install via staging folder then atomic replace where possible
- validate expected files after install
- record action in log

### 9.3 Profile System

User can:

- create profile
- rename profile
- duplicate profile
- delete profile
- switch active profile
- choose which addons are enabled in a profile
- override addon channel per profile

Starter profiles:

- Main
- Leveling
- PvP
- Raid
- Dev Cleanroom

Profile data should include:

- enabled addons
- per-addon channel override
- optional SavedVariables snapshot link
- last used date
- notes

### 9.4 Backup and Restore

The app must create restore points automatically before:

- install
- update
- uninstall
- profile switch
- bulk sync

Backup types:

- addon files only
- SavedVariables only
- full managed state snapshot

Restore actions:

- restore one addon
- restore profile state
- restore last-known-good
- restore specific timestamp snapshot

Retention:

- keep most recent N backups
- allow pinning important restore points
- surface storage size

### 9.5 Channels

Each addon may exist on one of three channels:

- Stable
- Beta
- Local Dev

Rules:

- Stable is default for normal profiles
- Beta may be opt-in per addon or per profile
- Local Dev can point to a local working directory
- switching channels always creates a restore point first

### 9.6 Validation

System should warn, not blindly proceed, when:

- dependency missing
- folder structure invalid
- TOC missing
- duplicate addon folder detected
- target path unavailable
- version conflict detected
- managed addon collides with unmanaged folder
- SavedVariables schema mismatch suspected

### 9.7 Recovery Tools

Recovery screen must support:

- restore last-known-good
- safe mode preparation
- disable all non-core managed addons
- isolate a single addon for testing
- compare current state vs previous snapshot

### 9.8 Developer Workflow Tools

For MVP, dev tools should be light but useful:

- add local addon source
- mark version/channel
- package a release zip
- promote Beta to Stable manually
- clone a profile into Dev Cleanroom

Phase 2 dev tools:

- auto package from repo
- release notes
- push build to testers
- GitHub release publishing

## 10. UX Requirements

### 10.1 UX Principles

- safe by default
- rollback always obvious
- minimal jargon for routine actions
- advanced detail visible when needed
- never hide which files will change

### 10.2 Main Screens

#### Dashboard

Shows:

- current active profile
- install health status
- last backup time
- addons with updates available
- quick actions:
  - Sync Profile
  - Restore Last Known Good
  - Switch Profile
  - Open AddOns Folder

#### Addons Screen

Shows list of managed addons with:

- name
- version
- channel
- enabled state
- source type
- dependency/conflict badge
- install health
- actions:
  - install
  - update
  - reinstall
  - uninstall
  - change channel

#### Profiles Screen

Shows:

- profiles list
- active profile
- addon membership per profile
- duplicate/edit/delete controls
- switch action

#### Recovery Screen

Shows:

- restore points
- diff summary
- pinned snapshots
- quick restore options
- safe mode actions

#### Developer Screen

Shows:

- local source registration
- package/export tools
- release promotion tools
- manifest editor later

### 10.3 Status Language

Use simple statuses:

- Ready
- Warning
- Broken
- Update Available
- Backup Recommended
- Restorable

## 11. Functional Requirements

### 11.1 Path Handling

The app must:

- let user select Ascension installation path manually
- auto-detect common install locations when possible
- verify Interface/AddOns path exists or can be created
- store path in local config

### 11.2 Managed vs Unmanaged Safety

The app must:

- track managed files
- avoid deleting unmanaged folders by default
- clearly label unmanaged addons found in the directory
- offer adopt-into-management later, not automatically

### 11.3 File Integrity

The app must:

- validate expected addon files exist after install
- detect incomplete installs
- protect against partial overwrite on failure
- rollback automatically if install fails mid-process

### 11.4 Logging

The app must log:

- installs
- updates
- removals
- profile changes
- restore actions
- validation errors
- file operation failures

### 11.5 Local Configuration

The app must persist:

- application settings
- addon registry
- profiles
- restore point metadata
- source paths
- UI preferences

## 12. Non-Functional Requirements

### Performance

- cold start under 2 seconds on normal desktop hardware
- common actions feel instant or near-instant
- update-all should not freeze UI

### Reliability

- backup before destructive action
- failed install should never silently corrupt state
- app should survive interruption during file operation gracefully

### Security

- no arbitrary script execution in MVP
- local file operations only
- checksum support for imported packages if available

### Maintainability

- clear service boundaries
- testable file operation layer
- manifest-driven addon metadata
- minimal hardcoded addon logic

## 13. Proposed Desktop Architecture

### 13.1 Recommended Stack

Best fit:

- **Tauri**
- **React**
- **TypeScript**
- **Tailwind**
- local JSON or SQLite persistence

Why this stack:

- lightweight desktop footprint
- fast enough for local file management
- clean modern UI
- easier than a heavy Electron app for this scope
- good match for your general frontend/product style

### 13.2 High-Level Modules

- UI shell
- path/config service
- addon registry service
- profile service
- install/update service
- backup/restore service
- validation service
- logging service

### 13.3 Suggested Folder Structure

- `app/ui`
- `app/features/addons`
- `app/features/profiles`
- `app/features/recovery`
- `app/features/settings`
- `core/services`
- `core/models`
- `core/persistence`
- `core/fileops`
- `core/validation`

## 14. Data Model

### 14.1 Addon Entity

Fields:

- id
- name
- folderName
- version
- channel
- sourceType
- sourcePath
- manifestPath
- dependencies
- conflicts
- tags
- installStatus
- lastInstalledAt
- compatibilityStatus

### 14.2 Profile Entity

Fields:

- id
- name
- addonSelections
- channelOverrides
- snapshotId
- lastUsedAt
- notes

### 14.3 Snapshot Entity

Fields:

- id
- createdAt
- type
- relatedProfileId
- relatedAddonIds
- backupPath
- pinned
- notes

### 14.4 App Settings Entity

Fields:

- ascensionRootPath
- addonsPath
- savedVariablesPath
- backupRetentionCount
- autoBackupEnabled
- defaultProfileId
- devModeEnabled

## 15. Manifest Concept

Each managed addon should eventually have a small manifest that tells BronzeForge what it is and how to manage it.

Example fields:

- addon id
- display name
- current version
- install folder
- dependencies
- conflicts
- default channel
- compatible realms or notes
- package source

This keeps the system deterministic and reduces magic.

## 16. Edge Cases

The MVP should explicitly handle:

- addon folder already exists but differs from managed version
- user manually changed files outside app
- SavedVariables missing
- install path moved
- duplicate folder names from old copies
- Beta build installed into Stable profile
- addon removed from source but still referenced in profile
- restore point exists but file path no longer valid

## 17. Milestones

### Milestone 1 — Foundation

Build:

- app shell
- settings/path selection
- local persistence
- addon registry CRUD
- basic addon list UI

Definition of done:

- user can register addon sources and save settings

### Milestone 2 — Install Engine

Build:

- install/update/reinstall/uninstall
- staging and validation
- managed/unmanaged separation
- action logs

Definition of done:

- user can safely manage addon files from the app

### Milestone 3 — Profiles

Build:

- profiles CRUD
- profile switching
- addon enable/disable mapping
- channel overrides

Definition of done:

- user can switch between named setups cleanly

### Milestone 4 — Backup and Recovery

Build:

- automatic restore points
- restore UI
- last-known-good state
- safe mode helpers

Definition of done:

- user can break a setup and recover quickly

### Milestone 5 — Dev Workflow

Build:

- local-dev channel
- package zip export
- promote beta to stable
- dev cleanroom profile

Definition of done:

- app supports your addon development cycle, not just usage

## 18. Acceptance Criteria for MVP

The MVP is done when the user can:

- configure Ascension addon path
- register at least 3 addons
- create at least 3 profiles
- install a profile in one action
- switch one addon between Stable and Beta
- automatically create restore points before changes
- restore last-known-good after a bad install
- uninstall a managed addon without harming unmanaged files

## 19. Risks and Mitigations

### Risk: File Corruption During Install

Mitigation: staging folder, backup-first, validation, rollback

### Risk: Unmanaged Addons Get Touched Accidentally

Mitigation: explicit managed/unmanaged boundary

### Risk: Scope Grows Into Public Platform

Mitigation: keep MVP personal-first

### Risk: SavedVariables Restore Is Messy

Mitigation: start with managed-addon-only SavedVariables scope

### Risk: Path Detection Is Unreliable

Mitigation: manual override always available

## 20. Recommended v1 Build Order

This is the order I would actually build it in:

1. Settings + path config
2. Addon registry
3. Install/update engine
4. Backups
5. Profiles
6. Recovery UI
7. Stable/Beta/Local Dev channels
8. Dev tooling extras

## 21. Final Recommendation

The best version of this product is not an addon manager for all of Ascension.

The best version is a polished personal control center for your Bronzebeard addon suite, with strong safety, profiles, backups, and dev/testing channels.

That is focused, useful, and very buildable.

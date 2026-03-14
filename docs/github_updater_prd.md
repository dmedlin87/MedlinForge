# PRD — GitHub-Based Update Delivery for BronzeForge Manager

## 1. Product Overview

### Product Name

## BronzeForge Update Service

### One-Line Summary

A GitHub-based publishing and update-delivery system for BronzeForge Manager and the user’s own Bronzebeard add-ons, using GitHub Pages for update manifests, GitHub Releases for packages, and GitHub Actions for automated publishing.

### Product Vision

Create a simple, free, low-maintenance update pipeline that lets the user publish new versions of their own add-ons and desktop manager, then lets BronzeForge Manager detect and install those updates safely.

## 2. Problem

The user wants BronzeForge Manager to update only the add-ons and apps they create. They need a hosting and publishing system that is:

- free or effectively free for a small personal ecosystem
- easy to automate
- easy to maintain
- reliable for version checks and package downloads
- simple enough to avoid running a traditional backend server

A generic cloud server is more operational overhead than this update system requires. The real need is a lightweight release pipeline with:

- a hosted manifest
- downloadable package files
- automated release publishing
- versioned channels
- integrity checks

## 3. Users

### Primary User

The developer/publisher:

- builds BronzeForge Manager
- builds personal Bronzebeard add-ons
- uploads new versions
- wants update delivery with minimal infrastructure

### Secondary User

Trusted testers or small private circle:

- installs BronzeForge Manager
- receives stable or beta updates
- uses only the publisher’s add-ons

## 4. Goals

### Primary Goals

- publish updates for BronzeForge Manager and owned add-ons only
- avoid running or maintaining a custom backend server
- keep operating cost at zero on GitHub Free where possible
- support stable and beta release channels
- let the client app check for updates using a simple hosted manifest
- ensure update packages can be downloaded reliably over HTTPS
- automate packaging and publishing from GitHub Actions

### Success Metrics

- a new release can be published in one tagged GitHub workflow run
- BronzeForge Manager can check for updates with a single manifest request
- users can download update packages directly from GitHub-hosted URLs
- the system supports rollback to prior versions
- publishing flow requires no manual server deployment steps

## 5. Non-Goals

Not in v1:

- updating third-party add-ons
- public marketplace or community submissions
- per-user entitlements or account login
- telemetry backend
- phased rollout by percentage
- real-time push notifications
- private package distribution without paid/private GitHub hosting tiers
- complex API services or databases

## 6. Product Positioning

This system is not a general-purpose software-update backend.

It is:

- a publisher-controlled update pipeline
- a static-manifest distribution system
- a GitHub-native release workflow
- a low-ops alternative to running a custom server

## 7. Core Use Cases

### Use Case 1: Publish a New Add-on Release

The developer tags a new version in GitHub. A workflow packages the addon, uploads the zip to GitHub Releases, updates the manifest, and publishes the new manifest to GitHub Pages.

### Use Case 2: Publish a New Manager Release

The developer tags a new BronzeForge Manager release. The workflow uploads the desktop package to GitHub Releases, updates the manager entry in the manifest, and republishes the manifest.

### Use Case 3: Client Checks for Updates

BronzeForge Manager fetches the hosted manifest, compares installed versions against the latest published versions, and displays update availability.

### Use Case 4: Client Downloads and Installs Updates

If an update is available, BronzeForge Manager downloads the package from the GitHub Release asset URL, verifies integrity, and installs the update.

### Use Case 5: Channel Selection

The publisher maintains separate stable and beta manifests or channel entries, and the client follows the chosen channel.

## 8. Solution Overview

The system will use three GitHub services:

### GitHub Pages

Hosts one or more static manifest files over HTTPS.

### GitHub Releases

Stores downloadable versioned package assets such as:

- BronzeForge Manager desktop release packages
- add-on zip packages
- optional changelog or metadata artifacts

### GitHub Actions

Automates:

- packaging
- checksum generation
- release asset upload
- manifest generation
- Pages publication

## 9. Scope

### Included in MVP

- GitHub repository structure for publisher-controlled update hosting
- manifest schema for manager and add-ons
- GitHub Actions workflow for packaging and publishing
- stable channel support
- optional beta channel support
- SHA-256 checksums for package validation
- version comparison by the client
- package download URLs sourced from GitHub Releases
- static changelog links

### Excluded from MVP

- private authenticated package delivery
- delta/patch update packages
- binary diff delivery
- rollout targeting
- CDN abstraction beyond GitHub-hosted URLs
- self-healing release pipelines across multiple repos

## 10. Architecture

## 10.1 Recommended Repository Strategy

### Option A — Single Publisher Repo

One repo contains:

- Pages manifest source
- release workflow definitions
- package metadata
- generated manifests
- release history

This is the simplest MVP path.

### Option B — Split Repos

Separate repos for:

- BronzeForge Manager
- each addon source repo
- one manifest/release-index repo

This is cleaner long-term but more complex initially.

### MVP Recommendation

Start with either:

- one dedicated release repo, or
- one manager repo that also publishes manifests for owned add-ons

Keep the model publisher-controlled and simple.

## 10.2 Delivery Flow

1. Developer updates addon or manager version.
2. Developer creates a Git tag or release.
3. GitHub Actions packages the release artifact.
4. GitHub Actions computes SHA-256 checksums.
5. GitHub Actions uploads package files to GitHub Releases.
6. GitHub Actions regenerates channel manifest files.
7. GitHub Actions publishes the manifest to GitHub Pages.
8. BronzeForge Manager fetches the manifest on startup or manual refresh.
9. BronzeForge Manager compares installed versions against manifest versions.
10. BronzeForge Manager downloads matching release assets and installs them.

## 10.3 Update Channels

Supported channels:

- Stable
- Beta

Optional future channels:

- Alpha
- Dev

Recommended MVP behavior:

- users default to Stable
- Beta is opt-in per product or globally
- manifests are channel-specific or channel-keyed inside one manifest

## 11. Functional Requirements

## 11.1 Manifest Hosting

The system must:

- publish a machine-readable manifest over HTTPS
- host the manifest on GitHub Pages
- allow the client to fetch the manifest without authentication
- support versioned manifest schema evolution

## 11.2 Package Hosting

The system must:

- host release packages as GitHub Release assets
- provide stable URLs through release assets
- support manager packages and addon packages
- support multiple products under one publisher namespace

## 11.3 Publishing Automation

The system must:

- package builds automatically in GitHub Actions
- upload release assets automatically
- generate checksums automatically
- generate or update manifest files automatically
- publish manifest updates automatically

## 11.4 Client Update Check

BronzeForge Manager must:

- fetch the configured channel manifest
- compare installed version to available version
- show update availability by product
- ignore products not owned by the publisher or not installed locally

## 11.5 Client Download and Install

BronzeForge Manager must:

- download release assets over HTTPS
- verify SHA-256 before install
- install only owned/publisher-managed packages
- support rollback to previous installed version when possible

## 11.6 Product Filtering

The system must support an allowlist of publisher-owned products.

BronzeForge Manager must not behave like a universal addon updater. It should only surface and update:

- BronzeForge Manager itself
- owned add-ons explicitly listed in the manifest

## 11.7 Changelog Support

The system should:

- include changelog text or changelog URLs in the manifest
- allow the client to display concise release notes

## 12. Manifest Specification

## 12.1 Manifest Requirements

The manifest should be:

- static JSON
- small enough to fetch quickly
- versioned with a schema version field
- organized by channel and product

## 12.2 Recommended Top-Level Fields

- schemaVersion
- publisher
- generatedAt
- channel
- products

## 12.3 Product Entry Fields

Each product entry should include:

- id
- name
- type
- channel
- latestVersion
- publishedAt
- releaseUrl
- packageUrl
- sha256
- sizeBytes
- minManagerVersion if needed
- platform if needed
- installKind
- changelog

## 12.4 Product Types

Supported product types:

- manager
- addon

## 12.5 Example Product IDs

- bronzeforge-manager
- addon-questshare
- addon-pestiq-helper
- addon-example

## 13. Example Manifest Shape

```json
{
  "schemaVersion": 1,
  "publisher": "dmedlin87",
  "generatedAt": "2026-03-14T16:00:00Z",
  "channel": "stable",
  "products": {
    "bronzeforge-manager": {
      "id": "bronzeforge-manager",
      "name": "BronzeForge Manager",
      "type": "manager",
      "latestVersion": "1.2.3",
      "publishedAt": "2026-03-14T15:55:00Z",
      "packageUrl": "https://github.com/example/releases/download/v1.2.3/bronzeforge-manager-win-x64.zip",
      "sha256": "<sha256>",
      "sizeBytes": 12345678,
      "changelog": "https://github.com/example/releases/tag/v1.2.3"
    },
    "addon-questshare": {
      "id": "addon-questshare",
      "name": "QuestShare",
      "type": "addon",
      "latestVersion": "0.9.0",
      "publishedAt": "2026-03-14T15:55:00Z",
      "packageUrl": "https://github.com/example/releases/download/v0.9.0/QuestShare.zip",
      "sha256": "<sha256>",
      "sizeBytes": 456789,
      "installKind": "addon-folder-zip",
      "changelog": "https://github.com/example/releases/tag/v0.9.0"
    }
  }
}
```

## 14. Repository and File Layout

## 14.1 Recommended Layout

- `.github/workflows/`
- `manifests/`
- `packages/` optional staging area
- `products/` optional metadata source
- `docs/` or Pages publishing folder

## 14.2 Pages Output

Recommended published files:

- `/manifest/stable.json`
- `/manifest/beta.json`
- `/manifest/index.json` optional

## 14.3 Metadata Source Files

Optional product metadata files can define:

- product id
- package naming rules
- channel membership
- display name
- product type
- install kind

## 15. GitHub Actions Requirements

## 15.1 Release Workflow

A release workflow must:

- trigger on tag push or published release
- build or collect the package artifact
- compute SHA-256
- upload the asset to GitHub Releases
- update manifest data
- publish manifest to Pages

## 15.2 Pages Publish Workflow

The Pages workflow must:

- deploy static JSON manifests
- keep published files deterministic
- validate JSON before publish

## 15.3 Validation Workflow

The repository should include validation that checks:

- JSON schema correctness
- package file existence
- checksum generation success
- duplicate product ids
- invalid version strings

## 16. UX Requirements in BronzeForge Manager

BronzeForge Manager should expose:

- current channel
- last update check time
- products with updates available
- version currently installed
- version available remotely
- changelog access
- update status messages
- checksum verification result
- install success or rollback result

## 17. Security and Integrity Requirements

The system must:

- use HTTPS endpoints only
- verify SHA-256 before install
- reject installs if checksum validation fails
- reject unknown product ids
- reject package URLs outside allowed host rules if configured
- avoid executing arbitrary scripts from manifests

Recommended trust model:

- trust only manifests published from the user’s configured GitHub Pages base URL
- trust only release asset URLs for the configured publisher or repository set

## 18. Operational Requirements

The publishing system should:

- require no dedicated server maintenance
- require no database administration
- allow manual rollback by republishing an older manifest or release
- allow old releases to remain downloadable
- keep release history human-auditable in GitHub

## 19. Risks and Mitigations

### Risk: GitHub Pages on GitHub Free requires a public repo

Mitigation: accept public manifests for MVP, or upgrade later if private Pages hosting becomes necessary.

### Risk: Client polls GitHub API too often

Mitigation: fetch only the static manifest from Pages for routine update checks; avoid direct REST polling for normal update logic.

### Risk: Broken manifest publishes incorrect URLs or checksums

Mitigation: validate manifest generation in CI before publish.

### Risk: Release asset renamed or missing

Mitigation: enforce predictable artifact naming in workflow and validate asset URLs before manifest publish.

### Risk: Publisher wants more backend logic later

Mitigation: keep client update logic abstracted behind a provider interface so a different host can be added later.

## 20. Acceptance Criteria

The MVP is complete when:

- a GitHub tag can trigger packaging and release publication
- a stable manifest is published to GitHub Pages
- BronzeForge Manager can fetch that manifest successfully
- BronzeForge Manager can detect an update for itself
- BronzeForge Manager can detect updates for listed owned add-ons
- BronzeForge Manager can download a release asset from GitHub Releases
- BronzeForge Manager can verify checksum before install
- BronzeForge Manager can ignore unknown or unsupported products
- release notes can be surfaced from the manifest or release link

## 21. Recommended MVP Decisions

- Use GitHub Pages for manifests
- Use GitHub Releases for all downloadable packages
- Use GitHub Actions for packaging and publication
- Start with Stable and Beta only
- Use static JSON manifests
- Use SHA-256 integrity validation
- Keep the updater publisher-scoped, not universal
- Prefer one simple release repo or tightly controlled repo set for v1

## 22. Final Recommendation

For the first version, the GitHub-based design should be intentionally simple:

- static manifest on GitHub Pages
- versioned assets on GitHub Releases
- automated publish via GitHub Actions
- BronzeForge Manager as a client that checks only your own products

This gives the project a zero-server, low-maintenance, free-first update architecture that fits the actual scope of the product.

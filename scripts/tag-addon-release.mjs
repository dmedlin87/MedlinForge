#!/usr/bin/env node
/**
 * tag-addon-release.mjs
 *
 * Pulls latest main and creates a semver tag in one or more addon repos,
 * triggering their GitHub Actions release workflow.
 *
 * Usage:
 *   node scripts/tag-addon-release.mjs <repo-path> <version> [repo-path2 version2 ...]
 *
 * Examples:
 *   node scripts/tag-addon-release.mjs ../DingTimer 1.0.0
 *   node scripts/tag-addon-release.mjs ../DingTimer 1.0.0 ../quest-share 1.0.0
 *   node scripts/tag-addon-release.mjs ../DingTimer 1.1.0-beta.1
 */

import { execSync } from 'node:child_process'
import path from 'node:path'
import { existsSync } from 'node:fs'
import process from 'node:process'

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

function run(cmd, cwd) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim()
}

function fail(msg) {
  process.stderr.write(`\nERROR: ${msg}\n`)
  process.exit(1)
}

function tagRepo(repoPath, version) {
  const tag = `v${version}`
  const abs = path.resolve(repoPath)

  if (!existsSync(abs)) fail(`Repo path not found: ${abs}`)

  process.stdout.write(`\n── ${path.basename(abs)} @ ${tag} ──\n`)

  // Verify it's a git repo
  try {
    run('git rev-parse --git-dir', abs)
  } catch {
    fail(`Not a git repository: ${abs}`)
  }

  // Check for uncommitted changes
  const status = run('git status --porcelain', abs)
  if (status) {
    fail(`Uncommitted changes in ${abs}. Commit or stash first:\n${status}`)
  }

  // Pull latest main
  const branch = run('git rev-parse --abbrev-ref HEAD', abs)
  if (branch !== 'main') fail(`Not on main branch (current: ${branch}). Switch to main first.`)

  process.stdout.write(`  Pulling latest main...\n`)
  run('git pull --ff-only origin main', abs)

  // Check tag doesn't already exist
  const existing = run('git tag --list', abs).split('\n')
  if (existing.includes(tag)) fail(`Tag ${tag} already exists in ${abs}`)

  // Create and push tag
  process.stdout.write(`  Creating tag ${tag}...\n`)
  run(`git tag ${tag}`, abs)

  process.stdout.write(`  Pushing tag ${tag}...\n`)
  run(`git push origin ${tag}`, abs)

  const sha = run(`git rev-parse --short ${tag}`, abs)
  process.stdout.write(`  ✓ Tagged ${sha} as ${tag} — release workflow triggered.\n`)
}

// Parse args: pairs of <repo-path> <version>
const args = process.argv.slice(2)

if (args.length === 0 || args.length % 2 !== 0) {
  process.stderr.write(
    'Usage: node scripts/tag-addon-release.mjs <repo-path> <version> [repo-path2 version2 ...]\n' +
    '\nExamples:\n' +
    '  node scripts/tag-addon-release.mjs ../DingTimer 1.0.0\n' +
    '  node scripts/tag-addon-release.mjs ../DingTimer 1.0.0 ../quest-share 1.0.0\n' +
    '  node scripts/tag-addon-release.mjs ../DingTimer 1.1.0-beta.1 ../quest-share 1.1.0-beta.1\n'
  )
  process.exit(1)
}

for (let i = 0; i < args.length; i += 2) {
  const repoPath = args[i]
  const version = args[i + 1]

  if (!SEMVER_RE.test(version)) {
    fail(`Invalid version "${version}". Must be semver like 1.0.0 or 1.1.0-beta.1 (no leading "v")`)
  }

  tagRepo(repoPath, version)
}

process.stdout.write('\nDone. Watch the Actions tab on each repo for the release workflow.\n')

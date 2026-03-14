import test from 'node:test'
import assert from 'node:assert/strict'

import { buildManifests } from './build-update-manifests.mjs'

function makeCatalog(overrides = {}) {
  return {
    publisher: 'dmedlin87',
    pagesBaseUrl: 'https://dmedlin87.github.io/MedlinForge',
    products: [
      {
        id: 'bronzeforge-manager',
        name: 'BronzeForge Manager',
        type: 'manager',
        repository: 'dmedlin87/MedlinForge',
        channels: ['stable', 'beta'],
        assetName: 'bronzeforge-manager-windows-x64-installer.exe',
        installKind: 'nsis-installer',
        platform: 'windows-x64',
      },
    ],
    ...overrides,
  }
}

function makeRelease({ tag, prerelease }) {
  return {
    tag_name: tag,
    prerelease,
    draft: false,
    created_at: '2026-03-14T16:00:00Z',
    published_at: '2026-03-14T16:05:00Z',
    html_url: `https://github.com/dmedlin87/MedlinForge/releases/tag/${tag}`,
    assets: [
      {
        name: 'bronzeforge-manager-windows-x64-installer.exe',
        browser_download_url: `https://github.com/dmedlin87/MedlinForge/releases/download/${tag}/bronzeforge-manager-windows-x64-installer.exe`,
        size: 1234,
      },
    ],
  }
}

test('buildManifests emits stable and beta manifests', () => {
  const manifests = buildManifests({
    catalog: makeCatalog(),
    releaseIndex: {
      'dmedlin87/MedlinForge': [
        makeRelease({ tag: 'v1.2.3', prerelease: false }),
        makeRelease({ tag: 'v1.3.0-beta.1', prerelease: true }),
      ],
    },
    assetDigests: {
      'https://github.com/dmedlin87/MedlinForge/releases/download/v1.2.3/bronzeforge-manager-windows-x64-installer.exe': {
        sha256: 'a'.repeat(64),
        sizeBytes: 1234,
      },
      'https://github.com/dmedlin87/MedlinForge/releases/download/v1.3.0-beta.1/bronzeforge-manager-windows-x64-installer.exe': {
        sha256: 'b'.repeat(64),
        sizeBytes: 1234,
      },
    },
    generatedAt: '2026-03-14T16:10:00Z',
  })

  assert.equal(manifests.stable.channel, 'stable')
  assert.equal(manifests.stable.products['bronzeforge-manager'].latestVersion, '1.2.3')
  assert.equal(manifests.beta.products['bronzeforge-manager'].latestVersion, '1.3.0-beta.1')
})

test('buildManifests rejects duplicate product ids', () => {
  assert.throws(() => {
    buildManifests({
      catalog: makeCatalog({
        products: [
          ...makeCatalog().products,
          { ...makeCatalog().products[0] },
        ],
      }),
      releaseIndex: {},
      assetDigests: {},
      generatedAt: '2026-03-14T16:10:00Z',
    })
  }, /Duplicate product id/)
})

test('buildManifests rejects missing release assets', () => {
  assert.throws(() => {
    buildManifests({
      catalog: makeCatalog(),
      releaseIndex: {
        'dmedlin87/MedlinForge': [
          {
            ...makeRelease({ tag: 'v1.2.3', prerelease: false }),
            assets: [],
          },
          makeRelease({ tag: 'v1.3.0-beta.1', prerelease: true }),
        ],
      },
      assetDigests: {
        'https://github.com/dmedlin87/MedlinForge/releases/download/v1.3.0-beta.1/bronzeforge-manager-windows-x64-installer.exe': {
          sha256: 'b'.repeat(64),
          sizeBytes: 1234,
        },
      },
      generatedAt: '2026-03-14T16:10:00Z',
    })
  }, /missing the expected asset/)
})

test('buildManifests rejects invalid version tags', () => {
  assert.throws(() => {
    buildManifests({
      catalog: makeCatalog(),
      releaseIndex: {
        'dmedlin87/MedlinForge': [
          makeRelease({ tag: 'release-final', prerelease: false }),
          makeRelease({ tag: 'v1.3.0-beta.1', prerelease: true }),
        ],
      },
      assetDigests: {
        'https://github.com/dmedlin87/MedlinForge/releases/download/release-final/bronzeforge-manager-windows-x64-installer.exe': {
          sha256: 'a'.repeat(64),
          sizeBytes: 1234,
        },
        'https://github.com/dmedlin87/MedlinForge/releases/download/v1.3.0-beta.1/bronzeforge-manager-windows-x64-installer.exe': {
          sha256: 'b'.repeat(64),
          sizeBytes: 1234,
        },
      },
      generatedAt: '2026-03-14T16:10:00Z',
    })
  }, /Unsupported release tag version/)
})

test('buildManifests rejects bad URLs', () => {
  const badRelease = makeRelease({ tag: 'v1.2.3', prerelease: false })
  badRelease.assets[0].browser_download_url = 'http://example.com/file.exe'
  assert.throws(() => {
    buildManifests({
      catalog: makeCatalog(),
      releaseIndex: {
        'dmedlin87/MedlinForge': [
          badRelease,
          makeRelease({ tag: 'v1.3.0-beta.1', prerelease: true }),
        ],
      },
      assetDigests: {
        'http://example.com/file.exe': {
          sha256: 'a'.repeat(64),
          sizeBytes: 1234,
        },
        'https://github.com/dmedlin87/MedlinForge/releases/download/v1.3.0-beta.1/bronzeforge-manager-windows-x64-installer.exe': {
          sha256: 'b'.repeat(64),
          sizeBytes: 1234,
        },
      },
      generatedAt: '2026-03-14T16:10:00Z',
    })
  }, /must use https/)
})

test('buildManifests is deterministic for identical inputs', () => {
  const input = {
    catalog: makeCatalog(),
    releaseIndex: {
      'dmedlin87/MedlinForge': [
        makeRelease({ tag: 'v1.2.3', prerelease: false }),
        makeRelease({ tag: 'v1.3.0-beta.1', prerelease: true }),
      ],
    },
    assetDigests: {
      'https://github.com/dmedlin87/MedlinForge/releases/download/v1.2.3/bronzeforge-manager-windows-x64-installer.exe': {
        sha256: 'a'.repeat(64),
        sizeBytes: 1234,
      },
      'https://github.com/dmedlin87/MedlinForge/releases/download/v1.3.0-beta.1/bronzeforge-manager-windows-x64-installer.exe': {
        sha256: 'b'.repeat(64),
        sizeBytes: 1234,
      },
    },
    generatedAt: '2026-03-14T16:10:00Z',
  }
  assert.equal(JSON.stringify(buildManifests(input)), JSON.stringify(buildManifests(input)))
})

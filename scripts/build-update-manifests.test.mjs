import test from 'node:test'
import assert from 'node:assert/strict'

import { buildManifests } from './build-update-manifests.mjs'

function makeCatalog(overrides = {}) {
  return {
    publisher: 'dmedlin87',
    pagesBaseUrl: 'https://dmedlin87.github.io/MedlinForge/catalog',
    packs: [
      {
        packId: 'bronzeforge-default',
        name: 'BronzeForge Pack',
        description: 'Curated launcher pack',
        defaultChannel: 'stable',
        recoveryLabel: 'Restore last known good',
        recoveryDescription: 'Revert to the most recent working pack state.',
        members: [
          { productId: 'bronzeforge-ui', required: true },
          { productId: 'bronze-bars', required: true },
        ],
      },
    ],
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
      {
        id: 'bronzeforge-ui',
        name: 'BronzeForge UI',
        type: 'addon',
        repository: 'dmedlin87/BronzeForgeUI',
        channels: ['stable', 'beta'],
        assetName: 'BronzeForgeUI.zip',
        installKind: 'addon-folder-zip',
        platform: 'windows-any',
      },
      {
        id: 'bronze-bars',
        name: 'Bronze Bars',
        type: 'addon',
        repository: 'dmedlin87/BronzeBars',
        channels: ['stable'],
        assetName: 'BronzeBars.zip',
        installKind: 'addon-folder-zip',
        platform: 'windows-any',
      },
    ],
    ...overrides,
  }
}

function makeRelease({ repository, tag, prerelease, assetName }) {
  return {
    tag_name: tag,
    prerelease,
    draft: false,
    created_at: '2026-03-14T16:00:00Z',
    published_at: '2026-03-14T16:05:00Z',
    html_url: `https://github.com/${repository}/releases/tag/${tag}`,
    assets: [
      {
        name: assetName,
        browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${assetName}`,
        size: 1234,
      },
    ],
  }
}

test('buildManifests emits stable and beta catalogs with curated pack data', () => {
  const manifests = buildManifests({
    catalog: makeCatalog(),
    releaseIndex: {
      'dmedlin87/MedlinForge': [
        makeRelease({ repository: 'dmedlin87/MedlinForge', tag: 'v1.2.3', prerelease: false, assetName: 'bronzeforge-manager-windows-x64-installer.exe' }),
        makeRelease({ repository: 'dmedlin87/MedlinForge', tag: 'v1.3.0-beta.1', prerelease: true, assetName: 'bronzeforge-manager-windows-x64-installer.exe' }),
      ],
      'dmedlin87/BronzeForgeUI': [
        makeRelease({ repository: 'dmedlin87/BronzeForgeUI', tag: 'v1.4.2', prerelease: false, assetName: 'BronzeForgeUI.zip' }),
        makeRelease({ repository: 'dmedlin87/BronzeForgeUI', tag: 'v1.5.0-beta.1', prerelease: true, assetName: 'BronzeForgeUI.zip' }),
      ],
      'dmedlin87/BronzeBars': [
        makeRelease({ repository: 'dmedlin87/BronzeBars', tag: 'v0.9.7', prerelease: false, assetName: 'BronzeBars.zip' }),
      ],
    },
    assetDigests: {
      'https://github.com/dmedlin87/MedlinForge/releases/download/v1.2.3/bronzeforge-manager-windows-x64-installer.exe': { sha256: 'a'.repeat(64), sizeBytes: 1234 },
      'https://github.com/dmedlin87/MedlinForge/releases/download/v1.3.0-beta.1/bronzeforge-manager-windows-x64-installer.exe': { sha256: 'b'.repeat(64), sizeBytes: 1234 },
      'https://github.com/dmedlin87/BronzeForgeUI/releases/download/v1.4.2/BronzeForgeUI.zip': { sha256: 'c'.repeat(64), sizeBytes: 4321 },
      'https://github.com/dmedlin87/BronzeForgeUI/releases/download/v1.5.0-beta.1/BronzeForgeUI.zip': { sha256: 'd'.repeat(64), sizeBytes: 4321 },
      'https://github.com/dmedlin87/BronzeBars/releases/download/v0.9.7/BronzeBars.zip': { sha256: 'e'.repeat(64), sizeBytes: 2468 },
    },
    generatedAt: '2026-03-14T16:10:00Z',
  })

  assert.equal(manifests.stable.schemaVersion, 2)
  assert.equal(manifests.stable.products['bronzeforge-manager'].latestVersion, '1.2.3')
  assert.equal(manifests.beta.products['bronzeforge-ui'].latestVersion, '1.5.0-beta.1')
  assert.equal(manifests.stable.packs['bronzeforge-default'].members.length, 2)
  assert.equal(manifests.beta.packs['bronzeforge-default'].members.length, 1)
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

test('buildManifests rejects packs with unknown members', () => {
  assert.throws(() => {
    buildManifests({
      catalog: makeCatalog({
        packs: [
          {
            packId: 'broken-pack',
            name: 'Broken Pack',
            description: 'Broken',
            defaultChannel: 'stable',
            members: [{ productId: 'missing-addon', required: true }],
          },
        ],
      }),
      releaseIndex: {},
      assetDigests: {},
      generatedAt: '2026-03-14T16:10:00Z',
    })
  }, /references unknown product/)
})

test('buildManifests rejects missing release assets', () => {
  assert.throws(() => {
    buildManifests({
      catalog: makeCatalog(),
      releaseIndex: {
        'dmedlin87/MedlinForge': [
          {
            ...makeRelease({ repository: 'dmedlin87/MedlinForge', tag: 'v1.2.3', prerelease: false, assetName: 'bronzeforge-manager-windows-x64-installer.exe' }),
            assets: [],
          },
        ],
        'dmedlin87/BronzeForgeUI': [
          makeRelease({ repository: 'dmedlin87/BronzeForgeUI', tag: 'v1.4.2', prerelease: false, assetName: 'BronzeForgeUI.zip' }),
        ],
        'dmedlin87/BronzeBars': [
          makeRelease({ repository: 'dmedlin87/BronzeBars', tag: 'v0.9.7', prerelease: false, assetName: 'BronzeBars.zip' }),
        ],
      },
      assetDigests: {
        'https://github.com/dmedlin87/BronzeForgeUI/releases/download/v1.4.2/BronzeForgeUI.zip': { sha256: 'c'.repeat(64), sizeBytes: 4321 },
        'https://github.com/dmedlin87/BronzeBars/releases/download/v0.9.7/BronzeBars.zip': { sha256: 'e'.repeat(64), sizeBytes: 2468 },
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
          makeRelease({ repository: 'dmedlin87/MedlinForge', tag: 'release-final', prerelease: false, assetName: 'bronzeforge-manager-windows-x64-installer.exe' }),
        ],
        'dmedlin87/BronzeForgeUI': [
          makeRelease({ repository: 'dmedlin87/BronzeForgeUI', tag: 'v1.4.2', prerelease: false, assetName: 'BronzeForgeUI.zip' }),
        ],
        'dmedlin87/BronzeBars': [
          makeRelease({ repository: 'dmedlin87/BronzeBars', tag: 'v0.9.7', prerelease: false, assetName: 'BronzeBars.zip' }),
        ],
      },
      assetDigests: {
        'https://github.com/dmedlin87/MedlinForge/releases/download/release-final/bronzeforge-manager-windows-x64-installer.exe': { sha256: 'a'.repeat(64), sizeBytes: 1234 },
        'https://github.com/dmedlin87/BronzeForgeUI/releases/download/v1.4.2/BronzeForgeUI.zip': { sha256: 'c'.repeat(64), sizeBytes: 4321 },
        'https://github.com/dmedlin87/BronzeBars/releases/download/v0.9.7/BronzeBars.zip': { sha256: 'e'.repeat(64), sizeBytes: 2468 },
      },
      generatedAt: '2026-03-14T16:10:00Z',
    })
  }, /Unsupported release tag version/)
})

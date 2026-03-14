import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const CHANNELS = ['stable', 'beta']
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_CATALOG_PATH = path.resolve(__dirname, '../products/catalog.json')
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '../site')

function fail(message) {
  throw new Error(message)
}

function ensureHttpsUrl(value, label) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    fail(`${label} must be a valid URL`)
  }
  if (parsed.protocol !== 'https:') {
    fail(`${label} must use https`)
  }
  return parsed
}

function normalizeVersion(tagName) {
  const version = String(tagName).trim().replace(/^v/i, '')
  if (!VERSION_RE.test(version)) {
    fail(`Unsupported release tag version '${tagName}'`)
  }
  return version
}

function sortEntriesByKey(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') fail('Catalog must be an object')
  if (typeof catalog.publisher !== 'string' || !catalog.publisher.trim()) {
    fail('Catalog publisher is required')
  }
  ensureHttpsUrl(catalog.pagesBaseUrl, 'Catalog pagesBaseUrl')
  if (!Array.isArray(catalog.products) || catalog.products.length === 0) {
    fail('Catalog products must contain at least one product')
  }

  const seen = new Set()
  for (const product of catalog.products) {
    if (typeof product.id !== 'string' || !product.id.trim()) fail('Product id is required')
    if (seen.has(product.id)) fail(`Duplicate product id '${product.id}'`)
    seen.add(product.id)

    if (!['manager', 'addon'].includes(product.type)) {
      fail(`Unsupported product type '${product.type}' for '${product.id}'`)
    }
    if (typeof product.name !== 'string' || !product.name.trim()) {
      fail(`Product '${product.id}' is missing a name`)
    }
    if (typeof product.repository !== 'string' || !/^[^/]+\/[^/]+$/.test(product.repository)) {
      fail(`Product '${product.id}' repository must be in owner/repo form`)
    }
    if (!Array.isArray(product.channels) || product.channels.length === 0) {
      fail(`Product '${product.id}' must define at least one channel`)
    }
    for (const channel of product.channels) {
      if (!CHANNELS.includes(channel)) fail(`Unsupported channel '${channel}' for '${product.id}'`)
    }
    if (!product.assetName && !product.assetPattern) {
      fail(`Product '${product.id}' must define assetName or assetPattern`)
    }
    if (product.assetName && product.assetPattern) {
      fail(`Product '${product.id}' cannot define both assetName and assetPattern`)
    }
    if (typeof product.installKind !== 'string' || !product.installKind.trim()) {
      fail(`Product '${product.id}' is missing installKind`)
    }
    if (product.assetPattern) {
      try {
        new RegExp(product.assetPattern)
      } catch (error) {
        fail(`Product '${product.id}' assetPattern is invalid: ${error.message}`)
      }
    }
  }
}

function selectRelease(releases, channel) {
  const candidates = releases.filter((release) => !release.draft && Boolean(release.prerelease) === (channel === 'beta'))
  if (!candidates.length) return null
  return [...candidates].sort((left, right) => {
    return new Date(right.published_at ?? right.created_at ?? 0).getTime() - new Date(left.published_at ?? left.created_at ?? 0).getTime()
  })[0]
}

function selectAsset(product, release) {
  const matcher = product.assetName
    ? (asset) => asset.name === product.assetName
    : (asset) => new RegExp(product.assetPattern).test(asset.name)

  const matches = release.assets.filter(matcher)
  if (matches.length === 0) {
    fail(`Release '${release.tag_name}' for '${product.id}' is missing the expected asset`)
  }
  if (matches.length > 1) {
    fail(`Release '${release.tag_name}' for '${product.id}' matched multiple assets`)
  }
  return matches[0]
}

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1) fail('Manifest schemaVersion must be 1')
  if (!CHANNELS.includes(manifest.channel)) fail(`Unsupported manifest channel '${manifest.channel}'`)
  ensureHttpsUrl(`https://${manifest.publisher}.github.io`, 'Manifest publisher derived host')
  for (const [productId, product] of Object.entries(manifest.products)) {
    if (productId !== product.id) fail(`Manifest product key '${productId}' must match product id '${product.id}'`)
    if (product.channel !== manifest.channel) fail(`Product '${product.id}' channel does not match manifest channel`)
    ensureHttpsUrl(product.packageUrl, `Product '${product.id}' packageUrl`)
    ensureHttpsUrl(product.releaseUrl, `Product '${product.id}' releaseUrl`)
    if (typeof product.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(product.sha256)) {
      fail(`Product '${product.id}' sha256 must be a lowercase SHA-256 hex digest`)
    }
    if (!VERSION_RE.test(product.latestVersion)) {
      fail(`Product '${product.id}' latestVersion '${product.latestVersion}' is invalid`)
    }
  }
}

export function buildManifests({ catalog, releaseIndex, assetDigests, generatedAt }) {
  validateCatalog(catalog)
  const manifests = {}

  for (const channel of CHANNELS) {
    const products = {}
    for (const product of [...catalog.products].sort((left, right) => left.id.localeCompare(right.id))) {
      if (!product.channels.includes(channel)) continue
      const releases = releaseIndex[product.repository] ?? []
      const release = selectRelease(releases, channel)
      if (!release) fail(`No ${channel} release found for '${product.id}' in ${product.repository}`)
      const asset = selectAsset(product, release)
      const digest = assetDigests[asset.browser_download_url]
      if (!digest) fail(`Missing asset digest for '${asset.browser_download_url}'`)
      if (!digest.sha256 || !digest.sizeBytes) {
        fail(`Asset digest for '${asset.browser_download_url}' is incomplete`)
      }

      const latestVersion = normalizeVersion(release.tag_name)
      products[product.id] = {
        id: product.id,
        name: product.name,
        type: product.type,
        channel,
        latestVersion,
        publishedAt: release.published_at ?? release.created_at,
        releaseUrl: release.html_url,
        packageUrl: asset.browser_download_url,
        sha256: digest.sha256,
        sizeBytes: digest.sizeBytes,
        minManagerVersion: product.minManagerVersion ?? null,
        platform: product.platform ?? null,
        installKind: product.installKind,
        changelog: release.html_url,
        repository: product.repository,
      }
    }

    const manifest = {
      schemaVersion: 1,
      publisher: catalog.publisher,
      generatedAt,
      channel,
      products: sortEntriesByKey(products),
    }
    validateManifest(manifest)
    manifests[channel] = manifest
  }

  return manifests
}

async function fetchJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: token ? `Bearer ${token}` : undefined,
      'User-Agent': 'BronzeForge-Manifest-Builder',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    const authHint = response.status === 404 ? ' (repo missing or a token is required for a private repository)' : ''
    fail(`GitHub API request failed for ${url}: ${response.status} ${response.statusText}${authHint}`)
  }
  return response.json()
}

async function fetchAssetDigest(url, fetchImpl) {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'BronzeForge-Manifest-Builder',
    },
  })
  if (!response.ok) {
    fail(`Asset download failed for ${url}: ${response.status} ${response.statusText}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  }
}

export async function buildManifestsFromGitHub({
  catalog,
  generatedAt = new Date().toISOString(),
  token = process.env.GITHUB_TOKEN ?? '',
  fetchImpl = fetch,
}) {
  const releaseIndex = {}
  const assetDigests = {}
  const repositories = [...new Set(catalog.products.map((product) => product.repository))].sort()

  for (const repository of repositories) {
    releaseIndex[repository] = await fetchJson(
      `https://api.github.com/repos/${repository}/releases?per_page=25`,
      token,
      fetchImpl,
    )
  }

  for (const product of catalog.products) {
    for (const channel of product.channels) {
      const release = selectRelease(releaseIndex[product.repository], channel)
      if (!release) continue
      const asset = selectAsset(product, release)
      if (!assetDigests[asset.browser_download_url]) {
        assetDigests[asset.browser_download_url] = await fetchAssetDigest(asset.browser_download_url, fetchImpl)
      }
    }
  }

  return buildManifests({
    catalog,
    releaseIndex,
    assetDigests,
    generatedAt,
  })
}

export async function writeManifests(outputDir, manifests) {
  const manifestDir = path.join(outputDir, 'manifest')
  await mkdir(manifestDir, { recursive: true })

  for (const channel of CHANNELS) {
    const target = path.join(manifestDir, `${channel}.json`)
    await writeFile(target, `${JSON.stringify(manifests[channel], null, 2)}\n`, 'utf8')
  }

  await writeFile(
    path.join(manifestDir, 'index.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      manifests: CHANNELS.map((channel) => ({ channel, path: `/manifest/${channel}.json` })),
    }, null, 2)}\n`,
    'utf8',
  )
}

async function main() {
  const catalogPath = process.env.UPDATE_CATALOG_PATH ?? DEFAULT_CATALOG_PATH
  const outputDir = process.env.UPDATE_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR
  const generatedAt = process.env.UPDATE_GENERATED_AT ?? new Date().toISOString()
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  const manifests = await buildManifestsFromGitHub({ catalog, generatedAt })
  await writeManifests(outputDir, manifests)
  process.stdout.write(`Wrote update manifests to ${outputDir}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}

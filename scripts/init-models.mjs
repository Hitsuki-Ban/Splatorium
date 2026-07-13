import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { Readable } from 'node:stream'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'

export async function loadModelManifest(manifestPath) {
  const raw = await readFile(manifestPath, 'utf8')
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch (error) {
    throw new Error(`model manifest must be JSON: ${error.message}`)
  }
  validateManifest(manifest)
  return manifest
}

export async function downloadModels({
  manifestPath,
  comfyRoot,
  dryRun = false,
  assumeYes = false,
  fetchImpl = fetch,
  log = console.log,
}) {
  if (!manifestPath) {
    throw new Error('--manifest is required')
  }
  if (!comfyRoot) {
    throw new Error('--comfy-root is required')
  }

  const manifest = await loadModelManifest(manifestPath)
  printPlan(manifest, log)

  if (dryRun) {
    return manifest.files.map((file) => ({ targetPath: file.targetPath, status: 'planned' }))
  }

  await assertComfyRoot(comfyRoot)

  if (!assumeYes) {
    const answer = await promptForConfirmation()
    if (answer !== 'download') {
      throw new Error('model initialization canceled')
    }
  }

  const results = []
  for (const file of manifest.files) {
    const targetPath = resolveTargetPath(comfyRoot, file.targetPath)
    const status = await downloadOne(file, targetPath, fetchImpl, log)
    results.push({ targetPath: file.targetPath, status })
  }
  return results
}

async function downloadOne(file, targetPath, fetchImpl, log) {
  const existing = await fileStats(targetPath)
  if (existing) {
    const existingHash = await hashFile(targetPath)
    if (existing.size === file.size && existingHash === file.sha256) {
      log(`OK existing: ${file.targetPath}`)
      return 'skipped'
    }
    throw new Error(
      `existing file mismatch: ${targetPath}\nexpected size=${file.size} sha256=${file.sha256}\nactual size=${existing.size} sha256=${existingHash}`,
    )
  }

  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.download`
  await rm(tempPath, { force: true })

  try {
    log(`Downloading: ${file.sourceUrl}`)
    const downloaded = await downloadToFile(file.sourceUrl, tempPath, fetchImpl)
    if (downloaded.size !== file.size) {
      throw new Error(
        `size mismatch for ${file.targetPath}: expected ${file.size}, got ${downloaded.size}`,
      )
    }
    if (downloaded.sha256 !== file.sha256) {
      throw new Error(
        `SHA-256 mismatch for ${file.targetPath}: expected ${file.sha256}, got ${downloaded.sha256}`,
      )
    }
    await rename(tempPath, targetPath)
    log(`Placed: ${file.targetPath}`)
    return 'downloaded'
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

async function downloadToFile(sourceUrl, targetPath, fetchImpl) {
  const response = await fetchImpl(sourceUrl)
  if (!response.ok) {
    throw new Error(`download failed (${response.status}) for ${sourceUrl}`)
  }
  if (!response.body) {
    throw new Error(`download response has no body: ${sourceUrl}`)
  }

  const hash = createHash('sha256')
  let size = 0
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      size += chunk.byteLength
      callback(null, chunk)
    },
  })

  await pipeline(Readable.fromWeb(response.body), hasher, createWriteStream(targetPath))
  return { size, sha256: hash.digest('hex') }
}

function printPlan(manifest, log) {
  log(`Model source: ${manifest.sourceRepository.name}`)
  log(`Revision: ${manifest.sourceRepository.revision}`)
  log('')
  for (const file of manifest.files) {
    log(`- ${file.role}`)
    log(`  source: ${file.sourceUrl}`)
    log(`  target: ${file.targetPath}`)
    log(`  size: ${file.size}`)
    log(`  sha256: ${file.sha256}`)
    log(`  license: ${file.licenseNote}`)
  }
}

async function promptForConfirmation() {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (
      await readline.question('\nType "download" to fetch and place these files: ')
    ).trim()
  } finally {
    readline.close()
  }
}

function validateManifest(value) {
  if (!isRecord(value)) {
    throw new Error('model manifest must be an object')
  }
  if (value.schemaVersion !== 1) {
    throw new Error('model manifest schemaVersion must be 1')
  }
  if (!isRecord(value.sourceRepository)) {
    throw new Error('model manifest sourceRepository is required')
  }
  for (const field of ['name', 'url', 'revision', 'license']) {
    if (typeof value.sourceRepository[field] !== 'string' || value.sourceRepository[field].length === 0) {
      throw new Error(`model manifest sourceRepository.${field} must be a non-empty string`)
    }
  }
  if (!Array.isArray(value.files) || value.files.length === 0) {
    throw new Error('model manifest files must be a non-empty array')
  }
  for (const [index, file] of value.files.entries()) {
    validateManifestFile(file, index)
  }
}

function validateManifestFile(file, index) {
  if (!isRecord(file)) {
    throw new Error(`model manifest files[${index}] must be an object`)
  }
  for (const field of ['role', 'sourceFile', 'sourceUrl', 'targetPath', 'sha256', 'licenseNote']) {
    if (typeof file[field] !== 'string' || file[field].length === 0) {
      throw new Error(`model manifest files[${index}].${field} must be a non-empty string`)
    }
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error(`model manifest files[${index}].size must be a positive safe integer`)
  }
  if (!/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[^/]+\/.+/.test(file.sourceUrl)) {
    throw new Error(`model manifest files[${index}].sourceUrl must be an explicit Hugging Face URL`)
  }
  if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new Error(`model manifest files[${index}].sha256 must be a lowercase SHA-256 hex digest`)
  }
  validateTargetPath(file.targetPath, index)
}

function validateTargetPath(targetPath, index) {
  if (targetPath.includes('\0') || targetPath.includes('\\')) {
    throw new Error(`model manifest files[${index}].targetPath must use slash-separated relative paths`)
  }
  if (targetPath.startsWith('/')) {
    throw new Error(`model manifest files[${index}].targetPath must stay under ComfyUI`)
  }
  if (targetPath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(
      `model manifest files[${index}].targetPath must not contain parent or current directory segments`,
    )
  }
  if (!targetPath.startsWith('models/')) {
    throw new Error(`model manifest files[${index}].targetPath must start with models/`)
  }
}

export function resolveTargetPath(comfyRoot, targetPath) {
  const root = resolve(comfyRoot)
  const target = resolve(root, targetPath)
  const inside = relative(root, target)
  if (inside === '..' || inside.startsWith('..\\') || inside.startsWith('../') || isAbsolute(inside)) {
    throw new Error(`target path escapes ComfyUI root: ${targetPath}`)
  }
  return target
}

export async function fileStats(path) {
  try {
    const stats = await stat(path)
    return stats.isFile() ? stats : undefined
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined
    }
    throw error
  }
}

export async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export async function assertComfyRoot(comfyRoot) {
  const mainPy = join(resolve(comfyRoot), 'main.py')
  try {
    await access(mainPy, constants.R_OK)
  } catch {
    throw new Error(`ComfyUI root is not valid: ${comfyRoot} (missing main.py)`)
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null
}

function isMissingFileError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    assumeYes: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg === '--yes') {
      args.assumeYes = true
    } else if (arg === '--manifest') {
      args.manifestPath = readOptionValue(argv, (index += 1), arg)
    } else if (arg === '--comfy-root') {
      args.comfyRoot = readOptionValue(argv, (index += 1), arg)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return args
}

function readOptionValue(argv, index, option) {
  const value = argv[index]
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`)
  }
  return value
}

async function assertReadable(path, label) {
  try {
    await access(path, constants.R_OK)
  } catch {
    throw new Error(`${label} is not readable: ${path}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.manifestPath) {
    await assertReadable(args.manifestPath, 'manifest')
  }
  const results = await downloadModels(args)
  for (const result of results) {
    console.log(`${result.status}: ${result.targetPath}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

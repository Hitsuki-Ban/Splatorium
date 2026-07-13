import { copyFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  assertComfyRoot,
  fileStats,
  hashFile,
  loadModelManifest,
  resolveTargetPath,
} from './init-models.mjs'

export async function importModels({
  manifestPath,
  incomingDir,
  comfyRoot,
  checkOnly = false,
  log = console.log,
}) {
  if (!manifestPath) {
    throw new Error('--manifest is required')
  }
  if (!incomingDir) {
    throw new Error('--incoming-dir is required')
  }
  if (!comfyRoot) {
    throw new Error('--comfy-root is required')
  }

  const manifest = await loadModelManifest(manifestPath)
  printPlan(manifest, incomingDir, log)
  await assertComfyRoot(comfyRoot)

  const results = []
  for (const file of manifest.files) {
    const incomingPath = resolveIncomingPath(incomingDir, file.sourceFile)
    const targetPath = resolveTargetPath(comfyRoot, file.targetPath)
    const status = await importOne({ file, incomingPath, targetPath, checkOnly, log })
    results.push({ targetPath: file.targetPath, status })
  }
  return results
}

async function importOne({ file, incomingPath, targetPath, checkOnly, log }) {
  const existing = await fileStats(targetPath)
  if (existing) {
    const existingHash = await hashFile(targetPath)
    if (existing.size === file.size && existingHash === file.sha256) {
      log(`OK existing: ${file.targetPath}`)
      return 'skipped'
    }
    throw new Error(
      formatModelError('existing target model mismatch', file, targetPath, {
        actualSize: existing.size,
        actualSha256: existingHash,
      }),
    )
  }

  const incoming = await fileStats(incomingPath)
  if (!incoming) {
    throw new Error(formatModelError('missing incoming model file', file, targetPath))
  }

  const incomingHash = await hashFile(incomingPath)
  if (incoming.size !== file.size || incomingHash !== file.sha256) {
    throw new Error(
      formatModelError('incoming model mismatch', file, targetPath, {
        actualSize: incoming.size,
        actualSha256: incomingHash,
      }),
    )
  }

  if (checkOnly) {
    log(`OK incoming: ${file.sourceFile}`)
    return 'verified'
  }

  await mkdir(dirname(targetPath), { recursive: true })
  await copyFile(incomingPath, targetPath)
  log(`Imported: ${file.sourceFile} -> ${file.targetPath}`)
  return 'imported'
}

function printPlan(manifest, incomingDir, log) {
  log(`Model source: ${manifest.sourceRepository.name}`)
  log(`Revision: ${manifest.sourceRepository.revision}`)
  log(`Incoming directory: ${incomingDir}`)
  log('')
  for (const file of manifest.files) {
    log(`- ${file.role}`)
    log(`  required file: ${file.sourceFile}`)
    log(`  source: ${file.sourceUrl}`)
    log(`  target: ${file.targetPath}`)
    log(`  size: ${file.size}`)
    log(`  sha256: ${file.sha256}`)
    log(`  license: ${file.licenseNote}`)
  }
}

function formatModelError(message, file, targetPath, actual = {}) {
  const lines = [
    `${message}:`,
    `  required file: ${file.sourceFile}`,
    `  source: ${file.sourceUrl}`,
    `  target: ${targetPath}`,
    `  expected size: ${file.size}`,
    `  expected sha256: ${file.sha256}`,
  ]
  if (actual.actualSize !== undefined) {
    lines.push(`  actual size: ${actual.actualSize}`)
  }
  if (actual.actualSha256 !== undefined) {
    lines.push(`  actual sha256: ${actual.actualSha256}`)
  }
  return lines.join('\n')
}

function resolveIncomingPath(incomingDir, sourceFile) {
  validateIncomingPath(sourceFile)
  const root = resolve(incomingDir)
  const source = resolve(root, sourceFile)
  const inside = relative(root, source)
  if (inside === '..' || inside.startsWith('..\\') || inside.startsWith('../') || isAbsolute(inside)) {
    throw new Error(`incoming path escapes incoming directory: ${sourceFile}`)
  }
  return source
}

function validateIncomingPath(sourceFile) {
  if (sourceFile.includes('\0') || sourceFile.includes('\\')) {
    throw new Error(`sourceFile must use slash-separated relative paths: ${sourceFile}`)
  }
  if (sourceFile.startsWith('/')) {
    throw new Error(`sourceFile must stay under incoming directory: ${sourceFile}`)
  }
  if (sourceFile.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`sourceFile must not contain parent or current directory segments: ${sourceFile}`)
  }
}

function parseArgs(argv) {
  const args = {
    checkOnly: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') {
      args.checkOnly = true
    } else if (arg === '--manifest') {
      args.manifestPath = readOptionValue(argv, (index += 1), arg)
    } else if (arg === '--incoming-dir') {
      args.incomingDir = readOptionValue(argv, (index += 1), arg)
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

async function main() {
  const results = await importModels(parseArgs(process.argv.slice(2)))
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

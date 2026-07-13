import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { ZipArchive } from 'archiver'
import unzipper from 'unzipper'

export const REQUIRED_PORTABLE_PATHS = [
  'README.md',
  'LICENSE',
  'NOTICE',
  'third-party-licenses.md',
  'docs/user-guide.md',
  'docs/user-guide.ja.md',
  'app/node/README.txt',
  'comfy/ComfyUI_windows_portable/README.txt',
  'comfy/models.md',
  'app/server/dist/index.js',
  'app/server/public/index.html',
  'run-profile.bat',
  'scripts/launch-comfy-profile.mjs',
  'comfy/workflows/image-to-splat.json',
  'comfy/workflows/image-to-splat-intel-xpu-fast.json',
  'app/server/node_modules/@hono/node-server/package.json',
  'app/server/node_modules/@splatorium/shared/package.json',
  'app/server/node_modules/better-sqlite3/package.json',
  'app/server/node_modules/hono/package.json',
  'app/server/node_modules/ws/package.json',
]

export async function createPortableArchive(sourceDir, archivePath) {
  await validatePortableTree(sourceDir)
  await mkdir(dirname(archivePath), { recursive: true })
  await rm(archivePath, { force: true })

  const output = createWriteStream(archivePath)
  const archive = new ZipArchive({ zlib: { level: 9 } })
  const completed = new Promise((resolve, reject) => {
    output.once('close', resolve)
    output.once('error', reject)
    archive.once('error', reject)
    archive.once('warning', reject)
  })

  archive.pipe(output)
  archive.directory(sourceDir, false)
  await archive.finalize()
  await completed
}

export async function extractAndVerifyPortableArchive(archivePath, targetDir) {
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  const archive = await unzipper.Open.file(archivePath)
  await archive.extract({ path: targetDir })
  await validatePortableTree(targetDir)
}

export async function validatePortableTree(rootDir) {
  const unsupportedEntry = await findUnsupportedEntry(rootDir)
  if (unsupportedEntry) {
    throw new Error(
      `Portable artifact must contain regular files and directories only: ${relative(rootDir, unsupportedEntry)}`,
    )
  }

  const missing = []
  for (const requiredPath of REQUIRED_PORTABLE_PATHS) {
    try {
      const requiredStat = await stat(join(rootDir, requiredPath))
      if (!requiredStat.isFile()) {
        missing.push(requiredPath)
      }
    } catch {
      missing.push(requiredPath)
    }
  }
  if (missing.length > 0) {
    throw new Error(`Portable artifact is missing required files:\n${missing.join('\n')}`)
  }
}

export async function sha256File(path) {
  await access(path)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function findUnsupportedEntry(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(rootDir, entry.name)
    if (entry.isSymbolicLink()) {
      return path
    }
    if (entry.isDirectory()) {
      const nested = await findUnsupportedEntry(path)
      if (nested) {
        return nested
      }
      continue
    }
    if (!entry.isFile()) {
      return path
    }
  }
  return undefined
}

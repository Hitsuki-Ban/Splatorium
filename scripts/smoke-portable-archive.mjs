import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractAndVerifyPortableArchive } from './portable-archive.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const archivePath = join(repoRoot, 'dist', 'portable', 'SplatoriumPortable.zip')
const extractRoot = await mkdtemp(join(tmpdir(), 'splatorium-portable-archive-'))

try {
  await extractAndVerifyPortableArchive(archivePath, extractRoot)
  await runNode([
    join(repoRoot, 'scripts', 'smoke-built-server.mjs'),
    '--entry',
    join(extractRoot, 'app', 'server', 'dist', 'index.js'),
    '--web-dir',
    join(extractRoot, 'app', 'server', 'public'),
    '--workflow',
    join(extractRoot, 'comfy', 'workflows', 'image-to-splat.json'),
  ])
  await runNode([
    join(repoRoot, 'scripts', 'smoke-built-server.mjs'),
    '--entry',
    join(extractRoot, 'app', 'server', 'dist', 'index.js'),
    '--web-dir',
    join(extractRoot, 'app', 'server', 'public'),
    '--workflow',
    join(extractRoot, 'comfy', 'workflows', 'image-to-splat-intel-xpu-fast.json'),
  ])
  console.log(`Portable archive smoke passed: ${archivePath}`)
} finally {
  await rm(extractRoot, { recursive: true, force: true })
}

async function runNode(args) {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', resolveExit)
  })
  if (exitCode !== 0) {
    throw new Error(`Extracted portable server smoke failed with exit code ${exitCode ?? 'unknown'}`)
  }
}

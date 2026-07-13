import assert from 'node:assert/strict'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { ZipArchive } from 'archiver'

import {
  REQUIRED_PORTABLE_PATHS,
  createPortableArchive,
  extractAndVerifyPortableArchive,
} from './portable-archive.mjs'

test('portable archive preserves and verifies every required file', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'splatorium-portable-test-'))
  try {
    const source = join(fixture, 'source')
    const archive = join(fixture, 'portable.zip')
    const extracted = join(fixture, 'extracted')
    await writeRequiredFixture(source)

    await createPortableArchive(source, archive)
    await extractAndVerifyPortableArchive(archive, extracted)

    for (const requiredPath of REQUIRED_PORTABLE_PATHS) {
      assert.equal(await readFixture(join(extracted, requiredPath)), requiredPath)
    }
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('portable archive verification rejects an archive with empty dependency directories', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'splatorium-portable-test-'))
  try {
    const source = join(fixture, 'source')
    const archive = join(fixture, 'broken.zip')
    const extracted = join(fixture, 'extracted')
    await writeRequiredFixture(source)
    const missingPackage = join(
      source,
      'app/server/node_modules/@hono/node-server/package.json',
    )
    await rm(missingPackage)
    await writeRawArchive(source, archive)

    await assert.rejects(
      extractAndVerifyPortableArchive(archive, extracted),
      /@hono\/node-server\/package\.json/,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('portable archive creation rejects links instead of relying on ZIP link handling', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'splatorium-portable-test-'))
  try {
    const source = join(fixture, 'source')
    const linkedDirectory = join(fixture, 'linked-directory')
    await writeRequiredFixture(source)
    await mkdir(linkedDirectory)
    await symlink(
      linkedDirectory,
      join(source, 'linked-directory'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    await assert.rejects(
      createPortableArchive(source, join(fixture, 'portable.zip')),
      /regular files and directories only: linked-directory/,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

async function writeRequiredFixture(root) {
  for (const requiredPath of REQUIRED_PORTABLE_PATHS) {
    const target = join(root, requiredPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, requiredPath)
  }
}

async function readFixture(path) {
  return readFile(path, 'utf8')
}

async function writeRawArchive(source, target) {
  const output = createWriteStream(target)
  const archive = new ZipArchive()
  const completed = new Promise((resolve, reject) => {
    output.once('close', resolve)
    output.once('error', reject)
    archive.once('error', reject)
  })
  archive.pipe(output)
  archive.directory(source, false)
  await archive.finalize()
  await completed
}

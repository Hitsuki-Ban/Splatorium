import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createPortableArchive,
  extractAndVerifyPortableArchive,
  sha256File,
} from './portable-archive.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const portableRoot = join(repoRoot, 'dist', 'portable', 'SplatoriumPortable')
const portableArchive = join(repoRoot, 'dist', 'portable', 'SplatoriumPortable.zip')
const serverTarget = join(portableRoot, 'app', 'server')
const deployTarget = relative(repoRoot, serverTarget)

await assertExists(
  join(repoRoot, 'apps', 'server', 'dist', 'index.js'),
  'server dist is missing. Run corepack pnpm build before build:portable-app.',
)
await assertExists(
  join(repoRoot, 'apps', 'web', 'dist', 'index.html'),
  'web dist is missing. Run corepack pnpm build before build:portable-app.',
)

await rm(portableRoot, { recursive: true, force: true })
await rm(portableArchive, { force: true })
await mkdir(portableRoot, { recursive: true })

runPnpm([
  '--config.inject-workspace-packages=true',
  '--config.node-linker=hoisted',
  '--filter',
  '@splatorium/server',
  'deploy',
  '--prod',
  deployTarget,
])

await Promise.all([
  rm(join(serverTarget, 'pnpm-lock.yaml'), { force: true }),
  rm(join(serverTarget, 'node_modules', '.modules.yaml'), { force: true }),
  rm(join(serverTarget, 'node_modules', '.pnpm-workspace-state-v1.json'), { force: true }),
  rm(join(serverTarget, 'node_modules', '.bin'), { recursive: true, force: true }),
  rm(join(serverTarget, 'node_modules', '.pnpm'), { recursive: true, force: true }),
])
await cp(join(repoRoot, 'apps', 'server', 'package.json'), join(serverTarget, 'package.json'))
await cp(join(repoRoot, 'apps', 'server', 'dist'), join(serverTarget, 'dist'), {
  recursive: true,
  force: true,
})
await cp(join(repoRoot, 'apps', 'web', 'dist'), join(serverTarget, 'public'), {
  recursive: true,
})
await cp(join(repoRoot, 'comfy', 'workflows'), join(portableRoot, 'comfy', 'workflows'), {
  recursive: true,
})
await cp(join(repoRoot, 'comfy', 'models.json'), join(portableRoot, 'comfy', 'models.json'))
await cp(join(repoRoot, 'comfy', 'models.md'), join(portableRoot, 'comfy', 'models.md'))
await mkdir(join(portableRoot, 'scripts'), { recursive: true })
await cp(join(repoRoot, 'scripts', 'init-models.mjs'), join(portableRoot, 'scripts', 'init-models.mjs'))
await cp(join(repoRoot, 'scripts', 'import-models.mjs'), join(portableRoot, 'scripts', 'import-models.mjs'))
await cp(
  join(repoRoot, 'scripts', 'launch-comfy-profile.mjs'),
  join(portableRoot, 'scripts', 'launch-comfy-profile.mjs'),
)
await cp(join(repoRoot, 'scripts', 'templates', 'portable-run.bat'), join(portableRoot, 'run.bat'))
await cp(
  join(repoRoot, 'scripts', 'templates', 'portable-run-profile.bat'),
  join(portableRoot, 'run-profile.bat'),
)
await cp(
  join(repoRoot, 'scripts', 'templates', 'portable-setup-models.bat'),
  join(portableRoot, 'setup-models.bat'),
)
await cp(
  join(repoRoot, 'scripts', 'templates', 'portable-import-models.bat'),
  join(portableRoot, 'import-models.bat'),
)

await mkdir(join(portableRoot, 'app', 'node'), { recursive: true })
await mkdir(join(portableRoot, 'comfy', 'ComfyUI_windows_portable'), { recursive: true })
await mkdir(join(portableRoot, 'models', 'incoming'), { recursive: true })
await mkdir(join(portableRoot, 'data'), { recursive: true })
await mkdir(join(portableRoot, 'docs'), { recursive: true })

await cp(
  join(repoRoot, 'scripts', 'templates', 'portable-readme.ja.md'),
  join(portableRoot, 'README.md'),
)
await cp(join(repoRoot, 'docs', 'user-guide.md'), join(portableRoot, 'docs', 'user-guide.md'))
await cp(
  join(repoRoot, 'docs', 'user-guide.ja.md'),
  join(portableRoot, 'docs', 'user-guide.ja.md'),
)
await cp(join(repoRoot, 'LICENSE'), join(portableRoot, 'LICENSE'))
await cp(join(repoRoot, 'NOTICE'), join(portableRoot, 'NOTICE'))
await cp(join(repoRoot, 'third-party-licenses.md'), join(portableRoot, 'third-party-licenses.md'))
await cp(join(repoRoot, 'licenses'), join(portableRoot, 'licenses'), {
  recursive: true,
})
await writeFile(
  join(portableRoot, 'app', 'node', 'README.txt'),
  [
    'Splatorium Portable - Node.js runtime requirement',
    '',
    `This package was built with Node.js ${process.version} for ${process.platform}-${process.arch}.`,
    `Place node.exe from the Windows Node.js ${process.versions.node.split('.')[0]}.x distribution in this directory.`,
    'A different Node.js major version cannot start this package.',
    '',
  ].join('\r\n'),
)
await writeFile(
  join(portableRoot, 'comfy', 'ComfyUI_windows_portable', 'README.txt'),
  'Place the extracted ComfyUI Windows Portable runtime in this directory before running run.bat.\r\n',
)

await createPortableArchive(portableRoot, portableArchive)
const verificationRoot = await mkdtemp(join(tmpdir(), 'splatorium-portable-build-'))
try {
  await extractAndVerifyPortableArchive(portableArchive, verificationRoot)
} finally {
  await rm(verificationRoot, { recursive: true, force: true })
}

console.log(`Portable app artifact: ${portableRoot}`)
console.log(`Portable app archive: ${portableArchive}`)
console.log(`Portable app archive SHA-256: ${await sha256File(portableArchive)}`)

function runPnpm(args) {
  const pnpmScript = process.env.npm_execpath
  if (!pnpmScript) {
    throw new Error('npm_execpath is missing. Run this script through pnpm (pnpm build:portable-app).')
  }

  // npm_execpath は corepack 経由だと JS エントリ、WinGet 等のネイティブ pnpm.exe だと
  // 実行ファイルそのものになる。後者を node に渡すと SyntaxError になるため直接実行する
  const isJsEntry = /\.(c|m)?js$/i.test(pnpmScript)
  const [command, commandArgs] = isJsEntry
    ? [process.execPath, [pnpmScript, ...args]]
    : [pnpmScript, args]
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: /\.(cmd|bat)$/i.test(pnpmScript),
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function assertExists(path, message) {
  try {
    await access(path, constants.F_OK)
  } catch {
    throw new Error(message)
  }
}

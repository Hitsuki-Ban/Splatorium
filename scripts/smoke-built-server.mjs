import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const options = parseOptions(process.argv.slice(2))
const entry = resolveRequiredPath(options, '--entry')
const webDir = resolveRequiredPath(options, '--web-dir')
const workflow = resolveRequiredPath(options, '--workflow')

await Promise.all([
  assertExists(entry, `Server entry is missing: ${entry}`),
  assertExists(join(webDir, 'index.html'), `Web entry is missing: ${join(webDir, 'index.html')}`),
  assertExists(workflow, `Workflow is missing: ${workflow}`),
])

const dataDir = await mkdtemp(join(tmpdir(), 'splatorium-smoke-'))
const port = await reserveAvailablePort()
const child = spawn(process.execPath, [entry], {
  cwd: dirname(entry),
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    SPLATORIUM_DATA_DIR: dataDir,
    SPLATORIUM_WEB_DIR: webDir,
    IMAGE_TO_SPLAT_WORKFLOW_PATH: workflow,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (chunk) => {
  output += chunk
})
child.stderr.on('data', (chunk) => {
  output += chunk
})

try {
  const health = await waitForResponse(`http://127.0.0.1:${port}/api/health`, child)
  if (health.status !== 200) {
    throw new Error(`Health endpoint returned ${health.status}`)
  }
  const healthBody = await health.json()
  if (healthBody.status !== 'ok') {
    throw new Error(`Health endpoint returned an unexpected body: ${JSON.stringify(healthBody)}`)
  }

  const web = await fetch(`http://127.0.0.1:${port}/`)
  if (web.status !== 200 || !web.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`Static web entry returned ${web.status} ${web.headers.get('content-type') ?? ''}`)
  }

  console.log(`Built server smoke passed: ${entry}`)
} finally {
  await stopChild(child)
  await rm(dataDir, { recursive: true, force: true })
}

function parseOptions(args) {
  if (args.length === 0 || args.length % 2 !== 0) {
    throw new Error('Usage: smoke-built-server.mjs --entry <path> --web-dir <path> --workflow <path>')
  }

  const parsed = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!['--entry', '--web-dir', '--workflow'].includes(name) || !value || parsed.has(name)) {
      throw new Error(`Invalid smoke option: ${name ?? ''}`)
    }
    parsed.set(name, value)
  }
  return parsed
}

function resolveRequiredPath(options, name) {
  const value = options.get(name)
  if (!value) {
    throw new Error(`Missing required smoke option: ${name}`)
  }
  return resolve(repoRoot, value)
}

async function assertExists(path, message) {
  try {
    await access(path, constants.F_OK)
  } catch {
    throw new Error(message)
  }
}

async function reserveAvailablePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not reserve a smoke-test port')
  }
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())))
  return address.port
}

async function waitForResponse(url, childProcess) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (childProcess.exitCode !== null) {
      throw new Error(`Server exited before becoming healthy (code ${childProcess.exitCode})\n${output}`)
    }
    try {
      return await fetch(url)
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
  }
  throw new Error(`Timed out waiting for ${url}\n${output}`)
}

async function stopChild(childProcess) {
  if (childProcess.exitCode !== null) {
    return
  }
  const exitPromise = new Promise((resolveExit) => childProcess.once('exit', resolveExit))
  childProcess.kill('SIGTERM')
  await Promise.race([
    exitPromise,
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ])
  if (childProcess.exitCode === null) {
    childProcess.kill('SIGKILL')
    await exitPromise
  }
}

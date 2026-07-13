import { spawn, spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const INTEL_XPU_HIGHVRAM_PROFILE = 'intel-xpu-highvram'
export const INTEL_XPU_FAST_PROFILE = 'intel-xpu-fast'
export const MINIMUM_XPU_MEMORY_BYTES = 16 * 1024 ** 3

const PROFILE_SETTINGS = Object.freeze({
  [INTEL_XPU_HIGHVRAM_PROFILE]: Object.freeze({
    comfyArgs: Object.freeze(['--highvram']),
    workflowFile: 'image-to-splat.json',
    expectedSteps: 20,
  }),
  [INTEL_XPU_FAST_PROFILE]: Object.freeze({
    comfyArgs: Object.freeze(['--highvram']),
    workflowFile: 'image-to-splat-intel-xpu-fast.json',
    expectedSteps: 15,
  }),
})

const XPU_PREFLIGHT = String.raw`
import sys

try:
    import torch
    if not torch.xpu.is_available():
        raise RuntimeError("torch.xpu is not available")
    properties = torch.xpu.get_device_properties(0)
    name = str(properties.name)
    total_memory = int(properties.total_memory)
    if "intel" not in name.lower():
        raise RuntimeError(f"device 0 is not an Intel XPU: {name}")
    minimum = ${MINIMUM_XPU_MEMORY_BYTES}
    if total_memory < minimum:
        raise RuntimeError(
            f"Intel XPU reports {total_memory} bytes; profile requires at least {minimum} bytes"
        )
    print(f"Intel XPU preflight passed: {name}, {total_memory} bytes")
except Exception as error:
    print(f"Intel XPU profile preflight failed: {error}", file=sys.stderr)
    sys.exit(2)
`

export function parseProfileArgs(args) {
  if (args.length === 0) {
    throw new Error(
      `Missing profile. Usage: run-profile.bat <${INTEL_XPU_HIGHVRAM_PROFILE}|${INTEL_XPU_FAST_PROFILE}>`,
    )
  }
  if (args.length !== 1) {
    throw new Error('The profile launcher accepts exactly one profile name and no additional arguments.')
  }
  const profile = args[0]
  if (!Object.hasOwn(PROFILE_SETTINGS, profile)) {
    throw new Error(`Unknown portable profile: ${profile}`)
  }
  return profile
}

export async function prepareProfileLaunch({
  args,
  portableRoot,
  spawnSyncImpl = spawnSync,
  accessImpl = access,
  readFileImpl = readFile,
}) {
  const profile = parseProfileArgs(args)
  const settings = PROFILE_SETTINGS[profile]
  const root = resolve(portableRoot)
  const node = join(root, 'app', 'node', 'node.exe')
  const server = join(root, 'app', 'server', 'dist', 'index.js')
  const publicDir = join(root, 'app', 'server', 'public')
  const workflow = join(root, 'comfy', 'workflows', settings.workflowFile)
  const manifest = join(root, 'comfy', 'models.json')
  const comfyRoot = join(root, 'comfy', 'ComfyUI_windows_portable')
  const python = join(comfyRoot, 'python_embeded', 'python.exe')
  const comfyUiRoot = join(comfyRoot, 'ComfyUI')
  const comfyMain = join(comfyUiRoot, 'main.py')
  const dataDir = join(root, 'data')

  await Promise.all([
    requirePath(accessImpl, node, 'bundled Node runtime'),
    requirePath(accessImpl, server, 'Splatorium server entrypoint'),
    requirePath(accessImpl, join(publicDir, 'index.html'), 'Splatorium web static files'),
    requirePath(accessImpl, workflow, 'ComfyUI workflow'),
    requirePath(accessImpl, manifest, 'model manifest'),
    requirePath(accessImpl, python, 'ComfyUI portable Python'),
    requirePath(accessImpl, comfyMain, 'ComfyUI entrypoint'),
  ])
  await validateProfileWorkflow({
    profile,
    workflow,
    expectedSteps: settings.expectedSteps,
    readFileImpl,
  })

  const preflight = spawnSyncImpl(python, ['-c', XPU_PREFLIGHT], {
    cwd: comfyUiRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (preflight.error) {
    throw new Error(`Intel XPU preflight could not start: ${preflight.error.message}`)
  }
  if (preflight.status !== 0) {
    const detail = String(preflight.stderr || preflight.stdout || '').trim()
    throw new Error(detail || `Intel XPU preflight exited with code ${preflight.status}`)
  }
  if (preflight.stdout) {
    process.stdout.write(preflight.stdout)
  }

  return {
    profile,
    comfy: {
      command: python,
      args: [
        comfyMain,
        '--listen',
        '127.0.0.1',
        '--port',
        '8189',
        '--disable-auto-launch',
        ...settings.comfyArgs,
      ],
      options: { cwd: comfyUiRoot, stdio: 'inherit', shell: false },
    },
    server: {
      command: node,
      args: [server],
      options: {
        cwd: join(root, 'app', 'server'),
        env: {
          ...process.env,
          HOST: '0.0.0.0',
          PORT: '8787',
          COMFYUI_URL: 'http://127.0.0.1:8189',
          SPLATORIUM_DATA_DIR: dataDir,
          SPLATORIUM_WEB_DIR: publicDir,
          IMAGE_TO_SPLAT_WORKFLOW_PATH: workflow,
          SPLATORIUM_MODEL_MANIFEST: manifest,
          COMFYUI_ROOT: comfyUiRoot,
        },
        stdio: 'inherit',
        shell: false,
      },
    },
  }
}

export async function runPortableProfile(options) {
  const spawnImpl = options.spawnImpl ?? spawn
  const launch = await prepareProfileLaunch(options)
  const comfy = spawnImpl(launch.comfy.command, launch.comfy.args, launch.comfy.options)
  const server = spawnImpl(launch.server.command, launch.server.args, launch.server.options)

  return await supervise(comfy, server)
}

async function validateProfileWorkflow({ profile, workflow, expectedSteps, readFileImpl }) {
  let parsed
  try {
    parsed = JSON.parse(await readFileImpl(workflow, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid ${profile} workflow JSON: ${detail}`)
  }

  const sampler = parsed?.['9']
  if (sampler?.class_type !== 'KSampler') {
    throw new Error(`Invalid ${profile} workflow: node 9 must be KSampler`)
  }
  if (sampler.inputs?.steps !== expectedSteps) {
    throw new Error(
      `Invalid ${profile} workflow: node 9 steps must be the number ${expectedSteps}`,
    )
  }
}

async function requirePath(accessImpl, path, label) {
  try {
    await accessImpl(path, constants.F_OK)
  } catch {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

function supervise(comfy, server) {
  return new Promise((resolveRun, rejectRun) => {
    let settled = false
    const finish = (error, code = 0) => {
      if (settled) return
      settled = true
      if (comfy.exitCode === null) comfy.kill('SIGTERM')
      if (server.exitCode === null) server.kill('SIGTERM')
      if (error) rejectRun(error)
      else resolveRun(code)
    }

    comfy.once('error', (error) => finish(new Error(`ComfyUI failed to start: ${error.message}`)))
    server.once('error', (error) => finish(new Error(`Splatorium server failed to start: ${error.message}`)))
    comfy.once('exit', (code, signal) => {
      finish(new Error(`ComfyUI exited while the profile was active (code ${code}, signal ${signal ?? 'none'}).`))
    })
    server.once('exit', (code, signal) => {
      if (signal) finish(null, 0)
      else if (code === 0) finish(null, 0)
      else finish(new Error(`Splatorium server exited with code ${code}.`))
    })
  })
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const portableRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  try {
    const code = await runPortableProfile({ args: process.argv.slice(2), portableRoot })
    process.exitCode = code
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

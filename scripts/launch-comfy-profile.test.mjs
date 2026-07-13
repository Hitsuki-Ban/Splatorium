import { EventEmitter } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  INTEL_XPU_FAST_PROFILE,
  INTEL_XPU_HIGHVRAM_PROFILE,
  MINIMUM_XPU_MEMORY_BYTES,
  parseProfileArgs,
  prepareProfileLaunch,
  runPortableProfile,
} from './launch-comfy-profile.mjs'

const portableRoot = resolve('X:/SplatoriumPortable')

describe('portable profile launcher', () => {
  it('rejects missing, unknown, duplicated, and additional arguments', () => {
    assert.equal(parseProfileArgs([INTEL_XPU_HIGHVRAM_PROFILE]), INTEL_XPU_HIGHVRAM_PROFILE)
    assert.equal(parseProfileArgs([INTEL_XPU_FAST_PROFILE]), INTEL_XPU_FAST_PROFILE)
    assert.throws(() => parseProfileArgs([]), /Missing profile/)
    assert.throws(() => parseProfileArgs(['unknown']), /Unknown portable profile/)
    assert.throws(
      () => parseProfileArgs([INTEL_XPU_HIGHVRAM_PROFILE, INTEL_XPU_HIGHVRAM_PROFILE]),
      /exactly one profile name/,
    )
    assert.throws(
      () => parseProfileArgs([INTEL_XPU_HIGHVRAM_PROFILE, '--gpu-only']),
      /exactly one profile name/,
    )
  })

  it('runs the embedded-Python preflight before returning fixed high-VRAM launch arguments', async () => {
    const preflights = []
    const launch = await prepareProfileLaunch({
      args: [INTEL_XPU_HIGHVRAM_PROFILE],
      portableRoot,
      accessImpl: async () => {},
      readFileImpl: async () => workflowJson(20),
      spawnSyncImpl(command, args, options) {
        preflights.push({ command, args, options })
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    assert.equal(preflights.length, 1)
    assert.match(preflights[0].command, /python_embeded[\\/]python\.exe$/)
    assert.equal(preflights[0].args[0], '-c')
    assert.match(preflights[0].args[1], /torch\.xpu\.is_available/)
    assert.match(preflights[0].args[1], /not an Intel XPU/)
    assert.match(preflights[0].args[1], new RegExp(String(MINIMUM_XPU_MEMORY_BYTES)))
    assert.equal(preflights[0].options.shell, false)
    assert.deepEqual(launch.comfy.args.slice(-1), ['--highvram'])
    assert.equal(launch.comfy.args.includes('--gpu-only'), false)
    assert.equal(launch.comfy.options.shell, false)
    assert.equal(launch.server.options.shell, false)
    assert.match(launch.server.options.env.IMAGE_TO_SPLAT_WORKFLOW_PATH, /image-to-splat\.json$/)
  })

  it('maps the fast profile to the fixed 15-step workflow without changing ComfyUI flags', async () => {
    const launch = await prepareProfileLaunch({
      args: [INTEL_XPU_FAST_PROFILE],
      portableRoot,
      accessImpl: async () => {},
      readFileImpl: async () => workflowJson(15),
      spawnSyncImpl: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    assert.deepEqual(launch.comfy.args.slice(-1), ['--highvram'])
    assert.match(
      launch.server.options.env.IMAGE_TO_SPLAT_WORKFLOW_PATH,
      /image-to-splat-intel-xpu-fast\.json$/,
    )
  })

  it('rejects malformed or drifted profile workflows before the XPU preflight', async () => {
    let preflightCalled = false
    const prepare = (contents) => prepareProfileLaunch({
      args: [INTEL_XPU_FAST_PROFILE],
      portableRoot,
      accessImpl: async () => {},
      readFileImpl: async () => contents,
      spawnSyncImpl: () => {
        preflightCalled = true
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    await assert.rejects(prepare('{'), /Invalid intel-xpu-fast workflow JSON/)
    await assert.rejects(prepare(workflowJson(20)), /steps must be the number 15/)
    await assert.rejects(prepare(workflowJson('15')), /steps must be the number 15/)
    await assert.rejects(prepare(workflowJson(15, 'NotKSampler')), /node 9 must be KSampler/)
    assert.equal(preflightCalled, false)
  })

  it('fails before starting either service when the XPU preflight fails', async () => {
    const services = []
    await assert.rejects(
      runPortableProfile({
        args: [INTEL_XPU_HIGHVRAM_PROFILE],
        portableRoot,
        accessImpl: async () => {},
        readFileImpl: async () => workflowJson(20),
        spawnSyncImpl: () => ({ status: 2, stdout: '', stderr: 'torch.xpu is not available\n' }),
        spawnImpl(...args) {
          services.push(args)
          return new FakeChild()
        },
      }),
      /torch\.xpu is not available/,
    )
    assert.equal(services.length, 0)
  })

  it('spawns only the fixed ComfyUI and server commands with shell disabled', async () => {
    const services = []
    const children = []
    const run = runPortableProfile({
      args: [INTEL_XPU_HIGHVRAM_PROFILE],
      portableRoot,
      accessImpl: async () => {},
      readFileImpl: async () => workflowJson(20),
      spawnSyncImpl: () => ({ status: 0, stdout: '', stderr: '' }),
      spawnImpl(command, args, options) {
        services.push({ command, args, options })
        const child = new FakeChild()
        children.push(child)
        return child
      },
    })

    await new Promise((resolveWait) => setImmediate(resolveWait))
    assert.equal(services.length, 2)
    assert.deepEqual(services[0].args.slice(-1), ['--highvram'])
    assert.deepEqual(services[1].args.length, 1)
    assert.equal(services[0].options.shell, false)
    assert.equal(services[1].options.shell, false)
    children[1].exitCode = 0
    children[1].emit('exit', 0, null)
    assert.equal(await run, 0)
  })

  it('keeps the default run.bat separate and packages the strict helper', async () => {
    const [defaultRun, profileRun, buildScript, defaultWorkflowText, fastWorkflowText] = await Promise.all([
      readFile(new URL('./templates/portable-run.bat', import.meta.url), 'utf8'),
      readFile(new URL('./templates/portable-run-profile.bat', import.meta.url), 'utf8'),
      readFile(new URL('./build-portable-app.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../comfy/workflows/image-to-splat.json', import.meta.url), 'utf8'),
      readFile(new URL('../comfy/workflows/image-to-splat-intel-xpu-fast.json', import.meta.url), 'utf8'),
    ])

    assert.doesNotMatch(defaultRun, /highvram|launch-comfy-profile|run-profile/i)
    assert.match(defaultRun, /start "Splatorium ComfyUI"/)
    assert.doesNotMatch(profileRun, /%\*/)
    assert.match(profileRun, /intel-xpu-highvram/)
    assert.match(profileRun, /intel-xpu-fast/)
    assert.match(profileRun, /"%NODE%" "%HELPER%" "%PROFILE%"/)
    assert.match(buildScript, /launch-comfy-profile\.mjs/)
    assert.match(buildScript, /portable-run-profile\.bat/)
    // The package builder copies only its declared runtime and documentation inputs.
    assert.doesNotMatch(buildScript, /docs[\/\'", ]*report/)

    const defaultWorkflow = JSON.parse(defaultWorkflowText)
    const fastWorkflow = JSON.parse(fastWorkflowText)
    assert.equal(defaultWorkflow['9'].inputs.steps, 20)
    assert.equal(fastWorkflow['9'].inputs.steps, 15)
    defaultWorkflow['9'].inputs.steps = 15
    assert.deepEqual(fastWorkflow, defaultWorkflow)
  })

  it('rejects an unknown batch profile even when PROFILE is inherited', { skip: process.platform !== 'win32' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'splatorium-profile-bat-'))
    try {
      await mkdir(join(root, 'app', 'node'), { recursive: true })
      await mkdir(join(root, 'scripts'), { recursive: true })
      await copyFile(process.execPath, join(root, 'app', 'node', 'node.exe'))
      await copyFile(
        new URL('./templates/portable-run-profile.bat', import.meta.url),
        join(root, 'run-profile.bat'),
      )
      await writeFile(
        join(root, 'scripts', 'launch-comfy-profile.mjs'),
        'console.log(`launched:${process.argv[2]}`)\n',
      )

      const result = spawnSync(
        process.env.ComSpec ?? 'cmd.exe',
        ['/d', '/s', '/c', 'run-profile.bat', 'unknown-profile'],
        {
          cwd: root,
          env: { ...process.env, PROFILE: INTEL_XPU_FAST_PROFILE },
          encoding: 'utf8',
        },
      )
      assert.equal(result.status, 1)
      assert.match(result.stdout, /Unknown portable profile/)
      assert.doesNotMatch(result.stdout, /launched:/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function workflowJson(steps, classType = 'KSampler') {
  return JSON.stringify({ '9': { class_type: classType, inputs: { steps } } })
}

class FakeChild extends EventEmitter {
  exitCode = null

  kill() {
    this.exitCode = 0
    return true
  }
}

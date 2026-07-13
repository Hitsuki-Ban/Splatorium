import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { importModels } from './import-models.mjs'

describe('import-models', () => {
  let tmp

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'splat-model-import-'))
  })

  afterEach(async () => {
    if (tmp) {
      await rm(tmp, { recursive: true, force: true })
      tmp = undefined
    }
  })

  it('copies only the exact incoming manifest path after size and SHA-256 verification', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      sha256: sha256(body),
      size: body.byteLength,
    })
    const incomingDir = join(tmp, 'incoming')
    await mkdir(join(incomingDir, 'diffusion_models'), { recursive: true })
    await writeFile(join(incomingDir, 'diffusion_models', 'model.safetensors'), body)
    const comfyRoot = await createComfyRoot()

    const result = await importModels({
      manifestPath,
      incomingDir,
      comfyRoot,
      log: () => {},
    })

    assert.deepEqual(result, [{ targetPath: 'models/diffusion_models/model.safetensors', status: 'imported' }])
    assert.equal(
      await readFile(join(comfyRoot, 'models', 'diffusion_models', 'model.safetensors'), 'utf8'),
      'model-bytes',
    )
  })

  it('fails fast on a missing incoming file with source, target, and expected hash', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      sha256: sha256(body),
      size: body.byteLength,
    })

    await assert.rejects(
      importModels({
        manifestPath,
        incomingDir: join(tmp, 'incoming'),
        comfyRoot: await createComfyRoot(),
        log: () => {},
      }),
      /missing incoming model file:[\s\S]*required file: diffusion_models\/model\.safetensors[\s\S]*source: https:\/\/huggingface\.co\/Test\/Model\/resolve\/test-revision\/diffusion_models\/model\.safetensors[\s\S]*target: .*models.*diffusion_models.*model\.safetensors[\s\S]*expected sha256: [a-f0-9]{64}/,
    )
  })

  it('checks incoming files without copying them when checkOnly is true', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      sha256: sha256(body),
      size: body.byteLength,
    })
    const incomingDir = join(tmp, 'incoming')
    await mkdir(join(incomingDir, 'diffusion_models'), { recursive: true })
    await writeFile(join(incomingDir, 'diffusion_models', 'model.safetensors'), body)
    const comfyRoot = await createComfyRoot()

    const result = await importModels({
      manifestPath,
      incomingDir,
      comfyRoot,
      checkOnly: true,
      log: () => {},
    })

    assert.deepEqual(result, [{ targetPath: 'models/diffusion_models/model.safetensors', status: 'verified' }])
    await assert.rejects(readFile(join(comfyRoot, 'models', 'diffusion_models', 'model.safetensors')))
  })

  it('fails fast on SHA-256 mismatch without placing the target file', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      sha256: sha256(Buffer.from('different-bytes')),
      size: body.byteLength,
    })
    const incomingDir = join(tmp, 'incoming')
    await mkdir(join(incomingDir, 'diffusion_models'), { recursive: true })
    await writeFile(join(incomingDir, 'diffusion_models', 'model.safetensors'), body)
    const comfyRoot = await createComfyRoot()

    await assert.rejects(
      importModels({
        manifestPath,
        incomingDir,
        comfyRoot,
        log: () => {},
      }),
      /incoming model mismatch:[\s\S]*required file: diffusion_models\/model\.safetensors[\s\S]*expected sha256: [a-f0-9]{64}[\s\S]*actual sha256: [a-f0-9]{64}/,
    )
    await assert.rejects(readFile(join(comfyRoot, 'models', 'diffusion_models', 'model.safetensors')))
  })

  it('skips an already imported target when the existing file matches the manifest', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      sha256: sha256(body),
      size: body.byteLength,
    })
    const incomingDir = join(tmp, 'incoming')
    await mkdir(join(incomingDir, 'diffusion_models'), { recursive: true })
    await writeFile(join(incomingDir, 'diffusion_models', 'model.safetensors'), body)
    const comfyRoot = await createComfyRoot()
    await mkdir(join(comfyRoot, 'models', 'diffusion_models'), { recursive: true })
    await writeFile(join(comfyRoot, 'models', 'diffusion_models', 'model.safetensors'), body)

    const result = await importModels({
      manifestPath,
      incomingDir,
      comfyRoot,
      log: () => {},
    })

    assert.deepEqual(result, [{ targetPath: 'models/diffusion_models/model.safetensors', status: 'skipped' }])
  })

  async function writeManifest({
    sourceUrl = 'https://huggingface.co/Test/Model/resolve/test-revision/diffusion_models/model.safetensors',
    sourceFile = 'diffusion_models/model.safetensors',
    targetPath = 'models/diffusion_models/model.safetensors',
    sha256,
    size,
  }) {
    const manifest = {
      schemaVersion: 1,
      sourceRepository: {
        name: 'Test/Model',
        url: 'https://huggingface.co/Test/Model',
        revision: 'test-revision',
        license: 'test',
      },
      files: [
        {
          role: 'Test model',
          sourceFile,
          sourceUrl,
          targetPath,
          size,
          sha256,
          licenseNote: 'Test license',
        },
      ],
    }
    const path = join(tmp, 'models.json')
    await mkdir(tmp, { recursive: true })
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
    return path
  }

  async function createComfyRoot() {
    const comfyRoot = join(tmp, 'ComfyUI')
    await mkdir(comfyRoot, { recursive: true })
    await writeFile(join(comfyRoot, 'main.py'), '# test ComfyUI entrypoint\n')
    return comfyRoot
  }
})

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

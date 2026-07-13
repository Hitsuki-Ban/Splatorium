import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { downloadModels, loadModelManifest } from './init-models.mjs'

describe('init-models', () => {
  let tmp

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'splat-model-init-'))
  })

  afterEach(async () => {
    if (tmp) {
      await rm(tmp, { recursive: true, force: true })
      tmp = undefined
    }
  })

  it('loads and validates a structured model manifest', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      sha256: sha256(body),
      size: body.byteLength,
    })

    const manifest = await loadModelManifest(manifestPath)

    assert.equal(manifest.files.length, 1)
    assert.equal(manifest.files[0].targetPath, 'models/diffusion_models/model.safetensors')
  })

  it('dry-runs without downloading files', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      sha256: sha256(body),
      size: body.byteLength,
    })
    const comfyRoot = join(tmp, 'ComfyUI')
    const fetchImpl = async () => {
      throw new Error('dry-run must not fetch')
    }

    const result = await downloadModels({
      manifestPath,
      comfyRoot,
      dryRun: true,
      assumeYes: false,
      fetchImpl,
      log: () => {},
    })

    assert.deepEqual(result, [{ targetPath: 'models/diffusion_models/model.safetensors', status: 'planned' }])
    await assert.rejects(readFile(join(comfyRoot, 'models', 'diffusion_models', 'model.safetensors')))
  })

  it('downloads a file, verifies SHA-256, and places it under ComfyUI models', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      sha256: sha256(body),
      size: body.byteLength,
    })
    const comfyRoot = await createComfyRoot()

    const result = await downloadModels({
      manifestPath,
      comfyRoot,
      dryRun: false,
      assumeYes: true,
      fetchImpl: createFetch(body),
      log: () => {},
    })

    assert.deepEqual(result, [{ targetPath: 'models/diffusion_models/model.safetensors', status: 'downloaded' }])
    assert.equal(
      await readFile(join(comfyRoot, 'models', 'diffusion_models', 'model.safetensors'), 'utf8'),
      'model-bytes',
    )
  })

  it('fails fast on SHA-256 mismatch without placing the target file', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      sha256: sha256(Buffer.from('different-bytes')),
      size: body.byteLength,
    })
    const comfyRoot = await createComfyRoot()

    await assert.rejects(
      downloadModels({
        manifestPath,
        comfyRoot,
        dryRun: false,
        assumeYes: true,
        fetchImpl: createFetch(body),
        log: () => {},
      }),
      /SHA-256 mismatch/,
    )
    await assert.rejects(readFile(join(comfyRoot, 'models', 'diffusion_models', 'model.safetensors')))
  })

  it('fails fast when non-dry-run uses a non-ComfyUI root', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      sha256: sha256(body),
      size: body.byteLength,
    })

    await assert.rejects(
      downloadModels({
        manifestPath,
        comfyRoot: join(tmp, 'not-comfy'),
        dryRun: false,
        assumeYes: true,
        fetchImpl: createFetch(body),
        log: () => {},
      }),
      /ComfyUI root is not valid/,
    )
  })

  it('rejects manifests with non-Hugging Face source URLs', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      sourceUrl: 'http://127.0.0.1:8787/model.safetensors',
      sha256: sha256(body),
      size: body.byteLength,
    })

    await assert.rejects(loadModelManifest(manifestPath), /sourceUrl must be an explicit Hugging Face URL/)
  })

  it('rejects parent path segments in target paths', async () => {
    const body = Buffer.from('model-bytes')
    const manifestPath = await writeManifest({
      targetPath: 'models/foo/..',
      sha256: sha256(body),
      size: body.byteLength,
    })

    await assert.rejects(loadModelManifest(manifestPath), /targetPath must not contain parent or current directory segments/)
  })

  async function writeManifest({
    sourceUrl = 'https://huggingface.co/Test/Model/resolve/test-revision/model.safetensors',
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
          sourceFile: 'model.safetensors',
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

function createFetch(body) {
  return async () =>
    new Response(body, {
      status: 200,
      headers: {
        'Content-Length': String(body.byteLength),
      },
    })
}

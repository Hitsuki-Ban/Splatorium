import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createModelPreflight } from './model-preflight.js'

describe('createModelPreflight', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'splat-model-preflight-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('passes when every manifest target file is readable under the ComfyUI root', async () => {
    const manifestPath = await writeManifest()
    const comfyRoot = join(tmp, 'ComfyUI')
    await mkdir(join(comfyRoot, 'models', 'diffusion_models'), { recursive: true })
    await writeFile(join(comfyRoot, 'models', 'diffusion_models', 'model.safetensors'), 'model-bytes')

    await expect(
      createModelPreflight({ manifestPath, comfyUiRoot: comfyRoot }).assertReady(),
    ).resolves.toBeUndefined()
  })

  it('fails fast with the source file, source URL, target, and expected hash when a model is missing', async () => {
    const manifestPath = await writeManifest()
    const comfyRoot = join(tmp, 'ComfyUI')

    await expect(
      createModelPreflight({ manifestPath, comfyUiRoot: comfyRoot }).assertReady(),
    ).rejects.toThrow(
      /Missing required model files:[\s\S]*source file: diffusion_models\/model\.safetensors[\s\S]*source: https:\/\/huggingface\.co\/Test\/Model\/resolve\/test-revision\/diffusion_models\/model\.safetensors[\s\S]*target: .*ComfyUI.*models.*diffusion_models.*model\.safetensors[\s\S]*expected sha256: [a-f0-9]{64}/,
    )
  })

  async function writeManifest() {
    const body = Buffer.from('model-bytes')
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
          sourceFile: 'diffusion_models/model.safetensors',
          sourceUrl:
            'https://huggingface.co/Test/Model/resolve/test-revision/diffusion_models/model.safetensors',
          targetPath: 'models/diffusion_models/model.safetensors',
          size: body.byteLength,
          sha256: createHash('sha256').update(body).digest('hex'),
          licenseNote: 'Test license',
        },
      ],
    }
    const path = join(tmp, 'models.json')
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
    return path
  }
})

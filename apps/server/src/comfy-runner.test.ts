import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Asset, Job } from '@splatorium/shared'
import { createGeneratedAssetName, createImageToSplatRunner } from './comfy-runner.js'
import { createSqliteStore, type WorkbenchStore } from './store.js'
import type { ApiWorkflow } from './workflow.js'

describe('createImageToSplatRunner', () => {
  let dataDir: string
  let store: WorkbenchStore

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'splatorium-runner-'))
    store = createSqliteStore({ dataDir })
    await mkdir(join(dataDir, 'assets', 'asset-image'), { recursive: true })
    await writeFile(join(dataDir, 'assets', 'asset-image', 'source.png'), new Uint8Array([1, 2, 3]))
    const imageAsset: Asset = {
      id: 'asset-image',
      kind: 'image',
      name: 'ユーザーが変更した名前',
      tags: [],
      files: { main: { path: 'source.png', size: 3, mime: 'image/png' } },
      createdAt: '2026-07-09T00:00:00.000Z',
    }
    store.saveAsset(imageAsset)
  })

  afterEach(async () => {
    store.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('runs ComfyUI and registers the downloaded SPZ as a splat asset', async () => {
    const promptSubmissions: ApiWorkflow[] = []
    const runner = createImageToSplatRunner({
      dataDir,
      store,
      baseWorkflow: createBaseWorkflow(),
      comfyClient: {
        uploadImage: async (filePath, fileName) => {
          expect(filePath).toBe(join(dataDir, 'assets', 'asset-image', 'source.png'))
          expect(fileName).toBe('ユーザーが変更した名前')
          return { name: 'source.png' }
        },
        queuePrompt: async (workflow) => {
          promptSubmissions.push(workflow)
          return { promptId: 'prompt-1' }
        },
        waitForCompletion: async () => {
          const current = store.getAsset('asset-image')
          if (!current) throw new Error('test image asset disappeared')
          store.saveAsset({ ...current, name: '完了直前の名前.png' })
          return [
            { filename: 'splatbench_00001_.spz', subfolder: 'splatorium/job-1', type: 'output' },
          ]
        },
        downloadOutput: async () => new Uint8Array([4, 5, 6, 7]),
      },
      createId: createIdSequence(['asset-splat']),
      now: createClock(['2026-07-09T00:00:01.000Z', '2026-07-09T00:00:04.000Z']),
    })
    const job: Job = {
      id: 'job-1',
      pipeline: 'image-to-splat',
      status: 'running',
      progress: 1,
      params: { numGaussians: 262144, seed: 99 },
      inputAssetIds: ['asset-image'],
      outputAssetIds: [],
      createdAt: '2026-07-09T00:00:00.000Z',
      startedAt: '2026-07-09T00:00:01.000Z',
    }

    const result = await runner(job, { updateJob: () => job })

    expect(promptSubmissions).toHaveLength(1)
    expect(promptSubmissions[0]['1'].inputs.image).toBe('source.png')
    expect(promptSubmissions[0]['9'].inputs.seed).toBe(99)
    expect(promptSubmissions[0]['11'].inputs.seed).toBe(99)
    expect(promptSubmissions[0]['11'].inputs.num_gaussians).toBe(262144)
    expect(promptSubmissions[0]['13'].inputs.filename_prefix).toBe('splatorium/job-1')
    expect(result).toEqual({
      outputAssetIds: ['asset-splat'],
      metrics: { comfyPromptId: 'prompt-1', durationMs: 3000, outputBytes: 4 },
    })

    const splatAsset = store.getAsset('asset-splat')
    expect(splatAsset).toEqual({
      id: 'asset-splat',
      kind: 'splat',
      name: '完了直前の名前',
      tags: [],
      sourceJobId: 'job-1',
      files: {
        main: { path: 'splatbench_00001_.spz', size: 4, mime: 'model/vnd.spz' },
        source: { path: 'source.png', size: 3, mime: 'image/png' },
      },
      createdAt: '2026-07-09T00:00:04.000Z',
    })
    expect([...(await readFile(join(dataDir, 'assets', 'asset-splat', 'splatbench_00001_.spz')))]).toEqual([
      4, 5, 6, 7,
    ])
  })

  it('numbers repeated generations without renaming existing assets', async () => {
    const legacyAsset: Asset = {
      id: 'legacy-splat',
      kind: 'splat',
      name: 'legacy-job_00001_.spz',
      tags: [],
      files: { main: { path: 'legacy-job_00001_.spz', size: 1, mime: 'model/vnd.spz' } },
      createdAt: '2026-07-08T00:00:00.000Z',
    }
    store.saveAsset(legacyAsset)
    const runner = createImageToSplatRunner({
      dataDir,
      store,
      baseWorkflow: createBaseWorkflow(),
      comfyClient: {
        uploadImage: async () => ({ name: 'source.png' }),
        queuePrompt: async (_workflow, clientId) => ({ promptId: `prompt-${clientId}` }),
        waitForCompletion: async () => [
          { filename: 'splatbench_00001_.spz', type: 'output' },
        ],
        downloadOutput: async () => new Uint8Array([4, 5, 6, 7]),
      },
      createId: createIdSequence(['asset-first', 'asset-second']),
      now: createClock([
        '2026-07-09T00:00:01.000Z',
        '2026-07-09T00:00:02.000Z',
        '2026-07-09T00:00:03.000Z',
        '2026-07-09T00:00:04.000Z',
      ]),
    })

    const firstJob = makeJob('job-first')
    const secondJob = makeJob('job-second')
    await runner(firstJob, { updateJob: (update) => ({ ...firstJob, ...update }) })
    await runner(secondJob, { updateJob: (update) => ({ ...secondJob, ...update }) })

    expect(store.getAsset('asset-first')?.name).toBe('ユーザーが変更した名前')
    expect(store.getAsset('asset-second')?.name).toBe('ユーザーが変更した名前 2')
    expect(store.getAsset('legacy-splat')).toEqual(legacyAsset)
    expect(store.getAsset('asset-second')?.files.main.path).toBe('splatbench_00001_.spz')
  })

  it('runs model preflight before uploading the input image', async () => {
    let uploadCalled = false
    const runner = createImageToSplatRunner({
      dataDir,
      store,
      baseWorkflow: createBaseWorkflow(),
      comfyClient: {
        uploadImage: async () => {
          uploadCalled = true
          throw new Error('upload must not run when model preflight fails')
        },
        queuePrompt: async () => ({ promptId: 'prompt-1' }),
        waitForCompletion: async () => [],
        downloadOutput: async () => new Uint8Array(),
      },
      modelPreflight: {
        assertReady: async () => {
          throw new Error(
            'Missing required model files:\n- source file: diffusion_models/model.safetensors\n  target: C:\\ComfyUI\\models\\diffusion_models\\model.safetensors',
          )
        },
      },
    })
    const job: Job = {
      id: 'job-1',
      pipeline: 'image-to-splat',
      status: 'running',
      progress: 1,
      params: { numGaussians: 262144, seed: 99 },
      inputAssetIds: ['asset-image'],
      outputAssetIds: [],
      createdAt: '2026-07-09T00:00:00.000Z',
      startedAt: '2026-07-09T00:00:01.000Z',
    }

    await expect(runner(job, { updateJob: () => job })).rejects.toThrow(/Missing required model files/)
    expect(uploadCalled).toBe(false)
  })
})

describe('createGeneratedAssetName', () => {
  it('uses the image display name and removes its extension and literal Comfy suffix', () => {
    expect(createGeneratedAssetName('マナポーション_00001_.png', [])).toBe('マナポーション')
    expect(createGeneratedAssetName('マナ/ポーション.png', [])).toBe('マナ/ポーション')
    expect(createGeneratedAssetName('マナ\\ポーション.png', [])).toBe('マナ\\ポーション')
    expect(createGeneratedAssetName('.reference', [])).toBe('.reference')
  })

  it('selects the first free exact name and stays within the asset name limit', () => {
    expect(createGeneratedAssetName('source.png', [{ name: 'source' }, { name: 'source 2' }]))
      .toBe('source 3')
    const longName = 'x'.repeat(255)
    const numbered = createGeneratedAssetName(`${longName}.png`, [{ name: longName }])
    expect(numbered).toHaveLength(255)
    expect(numbered.endsWith(' 2')).toBe(true)
  })
})

function createBaseWorkflow(): ApiWorkflow {
  return {
    '1': { class_type: 'LoadImage', inputs: { image: 'old.png' } },
    '9': { class_type: 'KSampler', inputs: { seed: 1 } },
    '11': { class_type: 'VAEDecodeTripoSplat', inputs: { seed: 1, num_gaussians: 65536 } },
    '13': { class_type: 'SaveGLB', inputs: { filename_prefix: 'old/prefix' } },
  }
}

function makeJob(id: string): Job {
  return {
    id,
    pipeline: 'image-to-splat',
    status: 'running',
    progress: 1,
    params: { numGaussians: 262144, seed: 99 },
    inputAssetIds: ['asset-image'],
    outputAssetIds: [],
    createdAt: '2026-07-09T00:00:00.000Z',
    startedAt: '2026-07-09T00:00:01.000Z',
  }
}

function createIdSequence(ids: string[]): () => string {
  let index = 0
  return () => {
    const id = ids[index]
    index += 1
    if (!id) {
      throw new Error('test id sequence exhausted')
    }
    return id
  }
}

function createClock(values: string[]): () => string {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? '2026-07-09T00:00:00.000Z'
}

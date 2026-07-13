import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Asset, Job } from '@splatorium/shared'
import { createSqliteStore } from './store.js'

describe('createSqliteStore', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'splatorium-store-'))
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('persists assets and jobs in the data directory database', () => {
    const store = createSqliteStore({ dataDir })
    const imageAsset: Asset = {
      id: 'asset-image',
      kind: 'image',
      name: 'source.png',
      tags: [],
      files: {
        main: { path: 'source.png', size: 5, mime: 'image/png' },
      },
      createdAt: '2026-07-09T00:00:00.000Z',
    }
    const job: Job = {
      id: 'job-1',
      pipeline: 'image-to-splat',
      status: 'queued',
      progress: 0,
      params: { numGaussians: 65536, seed: 123 },
      inputAssetIds: ['asset-image'],
      outputAssetIds: [],
      createdAt: '2026-07-09T00:00:01.000Z',
    }

    store.saveAsset(imageAsset)
    store.saveJob(job)

    expect(store.getAsset('asset-image')).toEqual(imageAsset)
    expect(store.listAssets()).toEqual([imageAsset])
    expect(store.getJob('job-1')).toEqual(job)
    expect(store.listJobs()).toEqual([job])

    const splatAsset: Asset = {
      id: 'asset-splat',
      kind: 'splat',
      name: 'job-1.spz',
      tags: [],
      sourceJobId: 'job-1',
      files: {
        main: { path: 'job-1.spz', size: 2048, mime: 'model/vnd.spz' },
        source: { path: 'source.png', size: 5, mime: 'image/png' },
      },
      createdAt: '2026-07-09T00:00:02.000Z',
    }
    const finishedJob: Job = {
      ...job,
      status: 'succeeded',
      progress: 100,
      outputAssetIds: ['asset-splat'],
      startedAt: '2026-07-09T00:00:01.500Z',
      finishedAt: '2026-07-09T00:00:03.000Z',
      metrics: { durationMs: 1500, outputBytes: 2048 },
    }

    store.saveAsset(splatAsset)
    store.saveJob(finishedJob)

    expect(store.getJob('job-1')).toEqual(finishedJob)
    expect(store.listJobs()).toEqual([finishedJob])
    expect(store.listAssets()).toEqual([imageAsset, splatAsset])

    expect(store.deleteAsset('asset-image')).toBe(true)
    expect(store.deleteAsset('asset-image')).toBe(false)
    expect(store.getAsset('asset-image')).toBeUndefined()
    expect(store.listAssets()).toEqual([splatAsset])
    expect(store.getJob('job-1')).toEqual(finishedJob)
    store.close()
  })

  it('lists jobs in stable descending order and applies status and limit together', () => {
    const store = createSqliteStore({ dataDir })
    const jobs: Job[] = [
      makeJob('job-b', '2026-07-09T00:00:00.000Z'),
      { ...makeJob('job-c', '2026-07-09T00:00:01.000Z'), status: 'succeeded' },
      makeJob('job-a', '2026-07-09T00:00:00.000Z'),
      { ...makeJob('job-d', '2026-07-09T00:00:02.000Z'), status: 'running' },
    ]
    for (const job of jobs) store.saveJob(job)

    expect(store.listJobs().map(({ id }) => id)).toEqual(['job-d', 'job-c', 'job-b', 'job-a'])
    expect(
      store.listJobs({ statuses: ['queued', 'running'], limit: 2 }).map(({ id }) => id),
    ).toEqual(['job-d', 'job-b'])
    store.close()
  })
})

function makeJob(id: string, createdAt: string): Job {
  return {
    id,
    pipeline: 'image-to-splat',
    status: 'queued',
    progress: 0,
    inputAssetIds: ['asset-image'],
    outputAssetIds: [],
    createdAt,
  }
}

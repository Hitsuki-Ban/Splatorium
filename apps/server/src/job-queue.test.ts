import { describe, expect, it } from 'vitest'
import type { Job } from '@splatorium/shared'
import { JobQueue } from './job-queue.js'
import type { WorkbenchStore } from './store.js'

describe('JobQueue', () => {
  it('runs jobs serially and persists successful completion', async () => {
    const savedJobs = new Map<string, Job>()
    const events: string[] = []
    const store = createMemoryStore(savedJobs)
    const queue = new JobQueue({
      store,
      now: createClock([
        '2026-07-09T00:00:00.000Z',
        '2026-07-09T00:00:01.000Z',
        '2026-07-09T00:00:02.000Z',
        '2026-07-09T00:00:03.000Z',
      ]),
      runJob: async (job) => {
        events.push(`start:${job.id}`)
        await Promise.resolve()
        events.push(`finish:${job.id}`)
        return {
          outputAssetIds: [`${job.id}-splat`],
          metrics: { durationMs: 1000, outputBytes: 2048 },
        }
      },
    })

    queue.enqueue(createJob('job-1'))
    queue.enqueue(createJob('job-2'))
    await queue.waitForIdle()

    expect(events).toEqual(['start:job-1', 'finish:job-1', 'start:job-2', 'finish:job-2'])
    expect(savedJobs.get('job-1')).toMatchObject({
      status: 'succeeded',
      progress: 100,
      startedAt: '2026-07-09T00:00:00.000Z',
      finishedAt: '2026-07-09T00:00:01.000Z',
      outputAssetIds: ['job-1-splat'],
      metrics: { durationMs: 1000, outputBytes: 2048 },
    })
    expect(savedJobs.get('job-2')).toMatchObject({
      status: 'succeeded',
      progress: 100,
      startedAt: '2026-07-09T00:00:02.000Z',
      finishedAt: '2026-07-09T00:00:03.000Z',
      outputAssetIds: ['job-2-splat'],
    })
  })

  it('marks failed jobs and continues the queue', async () => {
    const savedJobs = new Map<string, Job>()
    const store = createMemoryStore(savedJobs)
    const queue = new JobQueue({
      store,
      now: createClock([
        '2026-07-09T00:00:00.000Z',
        '2026-07-09T00:00:01.000Z',
        '2026-07-09T00:00:02.000Z',
        '2026-07-09T00:00:03.000Z',
      ]),
      runJob: async (job) => {
        if (job.id === 'job-1') {
          throw new Error('ComfyUI is not reachable')
        }
        return { outputAssetIds: ['asset-ok'], metrics: { durationMs: 1000 } }
      },
    })

    queue.enqueue(createJob('job-1'))
    queue.enqueue(createJob('job-2'))
    await queue.waitForIdle()

    expect(savedJobs.get('job-1')).toMatchObject({
      status: 'failed',
      progress: 100,
      error: 'ComfyUI is not reachable',
      finishedAt: '2026-07-09T00:00:01.000Z',
    })
    expect(savedJobs.get('job-2')).toMatchObject({
      status: 'succeeded',
      outputAssetIds: ['asset-ok'],
      finishedAt: '2026-07-09T00:00:03.000Z',
    })
  })
})

function createJob(id: string): Job {
  return {
    id,
    pipeline: 'image-to-splat',
    status: 'queued',
    progress: 0,
    params: { numGaussians: 65536, seed: 1 },
    inputAssetIds: ['input'],
    outputAssetIds: [],
    createdAt: '2026-07-09T00:00:00.000Z',
  }
}

function createClock(values: string[]): () => string {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? '2026-07-09T00:00:00.000Z'
}

function createMemoryStore(savedJobs: Map<string, Job>): WorkbenchStore {
  return {
    saveAsset() {},
    getAsset() {
      return undefined
    },
    listAssets() {
      return []
    },
    deleteAsset() {
      return false
    },
    saveJob(job) {
      savedJobs.set(job.id, structuredClone(job))
    },
    getJob(id) {
      return savedJobs.get(id)
    },
    listJobs() {
      return [...savedJobs.values()]
    },
    close() {},
  }
}

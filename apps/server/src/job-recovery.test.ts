import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Job } from '@splatorium/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JobQueue } from './job-queue.js'
import { RESTART_INTERRUPTION_MESSAGE, recoverInterruptedJobs } from './job-recovery.js'
import { createSqliteStore, type WorkbenchStore } from './store.js'

describe('recoverInterruptedJobs', () => {
  let dataDir: string
  let store: WorkbenchStore

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'splatorium-recovery-'))
    store = createSqliteStore({ dataDir })
  })

  afterEach(async () => {
    store.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('requeues queued jobs by creation time and fails interrupted running jobs before start', async () => {
    const queuedLater = createJob('queued-later', 'queued', '2026-07-09T00:00:02.000Z')
    const running = {
      ...createJob('running', 'running', '2026-07-09T00:00:01.000Z'),
      progress: 65,
      startedAt: '2026-07-09T00:00:01.500Z',
      metrics: { comfyPromptId: 'prompt-1' },
    } satisfies Job
    const queuedFirst = createJob('queued-first', 'queued', '2026-07-09T00:00:00.000Z')
    const succeeded = {
      ...createJob('succeeded', 'succeeded', '2026-07-08T00:00:00.000Z'),
      progress: 100,
      finishedAt: '2026-07-08T00:01:00.000Z',
    } satisfies Job
    for (const job of [queuedLater, running, queuedFirst, succeeded]) store.saveJob(job)
    store.close()
    store = createSqliteStore({ dataDir })

    const executionOrder: string[] = []
    const queue = new JobQueue({
      store,
      now: () => '2026-07-09T00:10:00.000Z',
      runJob: async (job) => {
        expect(store.getJob('running')?.status).toBe('failed')
        executionOrder.push(job.id)
        return { outputAssetIds: [`${job.id}-output`] }
      },
    })

    recoverInterruptedJobs({
      store,
      queue,
      now: () => '2026-07-09T00:05:00.000Z',
    })

    expect(store.getJob('running')).toMatchObject({
      status: 'failed',
      progress: 100,
      statusText: RESTART_INTERRUPTION_MESSAGE,
      error: RESTART_INTERRUPTION_MESSAGE,
      finishedAt: '2026-07-09T00:05:00.000Z',
      metrics: { comfyPromptId: 'prompt-1' },
    })
    expect(store.getJob('succeeded')).toEqual(succeeded)

    await queue.waitForIdle()

    expect(executionOrder).toEqual(['queued-first', 'queued-later'])
    expect(store.getJob('queued-first')?.status).toBe('succeeded')
    expect(store.getJob('queued-later')?.status).toBe('succeeded')
  })
})

function createJob(id: string, status: Job['status'], createdAt: string): Job {
  return {
    id,
    pipeline: 'image-to-splat',
    status,
    progress: status === 'queued' ? 0 : 1,
    params: { numGaussians: 65536, seed: 1 },
    inputAssetIds: ['input'],
    outputAssetIds: [],
    createdAt,
  }
}

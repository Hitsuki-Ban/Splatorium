import type { Asset, Job, JobStatus } from '@splatorium/shared'
import { describe, expect, it } from 'vitest'
import {
  hasEveryOutputAsset,
  isVisibleJob,
  replaceJobAfterCreate,
  type JobEntry,
} from './jobs'

describe('job presentation state', () => {
  it.each<JobStatus>(['queued', 'running', 'succeeded', 'failed'])(
    'keeps %s jobs visible until promotion or dismissal',
    (status) => {
      expect(isVisibleJob(makeJob('job-1', status))).toBe(true)
    },
  )

  it('does not retain canceled jobs', () => {
    expect(isVisibleJob(makeJob('job-1', 'canceled'))).toBe(false)
  })

  it('requires every declared output before promotion', () => {
    const job = { ...makeJob('job-1', 'succeeded'), outputAssetIds: ['asset-a', 'asset-b'] }

    expect(hasEveryOutputAsset(job, [makeAsset('asset-a')])).toBe(false)
    expect(hasEveryOutputAsset(job, [makeAsset('asset-a'), makeAsset('asset-b')])).toBe(true)
    expect(hasEveryOutputAsset({ ...job, outputAssetIds: [] }, [])).toBe(false)
  })

  it('replaces a failed job only after the new job exists', () => {
    const failed: JobEntry = { job: makeJob('job-failed', 'failed'), label: 'input.png' }
    const unrelated: JobEntry = { job: makeJob('job-other', 'running'), label: 'other.png' }
    const created: JobEntry = { job: makeJob('job-retry', 'queued'), label: 'input.png' }

    expect(replaceJobAfterCreate([failed, unrelated], created, failed.job.id)).toEqual([
      created,
      unrelated,
    ])
  })
})

function makeJob(id: string, status: JobStatus): Job {
  return {
    id,
    pipeline: 'image-to-splat',
    status,
    progress: status === 'succeeded' ? 100 : 25,
    inputAssetIds: ['input-asset'],
    outputAssetIds: [],
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function makeAsset(id: string): Asset {
  return {
    id,
    kind: 'splat',
    name: `${id}.spz`,
    tags: [],
    files: { main: { path: `${id}.spz`, size: 1 } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

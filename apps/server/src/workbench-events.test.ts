import type { Asset, Job, WorkbenchEvent } from '@splatorium/shared'
import { describe, expect, it } from 'vitest'
import { WorkbenchEventHub } from './workbench-events.js'

describe('WorkbenchEventHub', () => {
  it('sends a fresh sync watermark first and assigns one global sequence', async () => {
    const hub = new WorkbenchEventHub({
      serverId: 'server-a',
      now: () => '2026-07-12T00:00:00.000Z',
    })
    hub.publishJob(createJob('old-job'))

    const events: WorkbenchEvent[] = []
    hub.subscribe((event) => {
      events.push(event)
    })
    hub.publishAsset(createAsset('asset-1'))
    hub.publishAssetDeleted('asset-1')
    hub.publishJob(createJob('job-2'))
    await waitFor(() => events.length === 4)

    expect(events).toEqual([
      { type: 'sync', serverId: 'server-a', seq: 1 },
      {
        type: 'asset.upserted',
        serverId: 'server-a',
        seq: 2,
        occurredAt: '2026-07-12T00:00:00.000Z',
        asset: createAsset('asset-1'),
      },
      {
        type: 'asset.deleted',
        serverId: 'server-a',
        seq: 3,
        occurredAt: '2026-07-12T00:00:00.000Z',
        assetId: 'asset-1',
      },
      {
        type: 'job.upserted',
        serverId: 'server-a',
        seq: 4,
        occurredAt: '2026-07-12T00:00:00.000Z',
        job: createJob('job-2'),
      },
    ])
  })

  it('keeps each slow subscriber FIFO ordered and stops after unsubscribe', async () => {
    const hub = new WorkbenchEventHub({ serverId: 'server-a' })
    const observed: number[] = []
    let releaseFirst!: () => void
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const unsubscribe = hub.subscribe(async (event) => {
      if (event.seq === 0) await firstCanFinish
      observed.push(event.seq)
    })

    hub.publishJob(createJob('job-1'))
    hub.publishJob(createJob('job-2'))
    releaseFirst()
    await waitFor(() => observed.length === 3)
    unsubscribe()
    hub.publishJob(createJob('job-3'))
    await Promise.resolve()

    expect(observed).toEqual([0, 1, 2])
  })
})

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('event condition was not reached')
}

function createJob(id: string): Job {
  return {
    id,
    pipeline: 'image-to-splat',
    status: 'queued',
    progress: 0,
    inputAssetIds: ['input'],
    outputAssetIds: [],
    createdAt: '2026-07-12T00:00:00.000Z',
  }
}

function createAsset(id: string): Asset {
  return {
    id,
    kind: 'splat',
    name: `${id}.spz`,
    tags: [],
    files: { main: { path: `${id}.spz`, size: 1 } },
    createdAt: '2026-07-12T00:00:00.000Z',
  }
}

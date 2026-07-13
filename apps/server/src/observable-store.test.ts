import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Asset, Job, WorkbenchEvent } from '@splatorium/shared'
import { describe, expect, it } from 'vitest'
import { JobQueue } from './job-queue.js'
import { createObservableWorkbenchStore } from './observable-store.js'
import { createSqliteStore } from './store.js'
import { WorkbenchEventHub } from './workbench-events.js'

describe('createObservableWorkbenchStore', () => {
  it('publishes every committed mutation and orders output asset before terminal job', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'splatorium-observable-store-'))
    const hub = new WorkbenchEventHub({
      serverId: 'server-a',
      now: () => '2026-07-12T00:00:00.000Z',
    })
    const store = createObservableWorkbenchStore(createSqliteStore({ dataDir }), hub)
    const events: WorkbenchEvent[] = []
    hub.subscribe((event) => {
      events.push(event)
    })
    const output = createAsset('asset-output')
    const queue = new JobQueue({
      store,
      now: () => '2026-07-12T00:01:00.000Z',
      runJob: async () => {
        store.saveAsset(output)
        return { outputAssetIds: [output.id] }
      },
    })

    queue.enqueue(createJob('job-1'))
    await queue.waitForIdle()
    await waitFor(() => events.length === 4)

    expect(store.getAsset(output.id)).toEqual(output)
    expect(store.getJob('job-1')?.status).toBe('succeeded')
    expect(events.map((event) => event.type)).toEqual([
      'sync',
      'job.upserted',
      'asset.upserted',
      'job.upserted',
    ])
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3])

    store.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('publishes an asset deletion only after metadata was deleted', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'splatorium-observable-store-'))
    const hub = new WorkbenchEventHub({
      serverId: 'server-a',
      now: () => '2026-07-12T00:00:00.000Z',
    })
    const store = createObservableWorkbenchStore(createSqliteStore({ dataDir }), hub)
    const events: WorkbenchEvent[] = []
    hub.subscribe((event) => {
      events.push(event)
    })
    const asset = createAsset('asset-output')
    store.saveAsset(asset)

    expect(store.deleteAsset(asset.id)).toBe(true)
    expect(store.getAsset(asset.id)).toBeUndefined()
    expect(store.deleteAsset(asset.id)).toBe(false)
    await waitFor(() => events.length === 3)

    expect(events).toEqual([
      { type: 'sync', serverId: 'server-a', seq: 0 },
      {
        type: 'asset.upserted',
        serverId: 'server-a',
        seq: 1,
        occurredAt: '2026-07-12T00:00:00.000Z',
        asset,
      },
      {
        type: 'asset.deleted',
        serverId: 'server-a',
        seq: 2,
        occurredAt: '2026-07-12T00:00:00.000Z',
        assetId: asset.id,
      },
    ])

    store.close()
    await rm(dataDir, { recursive: true, force: true })
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
    sourceJobId: 'job-1',
    files: { main: { path: `${id}.spz`, size: 1 } },
    createdAt: '2026-07-12T00:00:30.000Z',
  }
}

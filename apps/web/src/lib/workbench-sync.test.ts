import type { Asset, Job, WorkbenchEvent } from '@splatorium/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkbenchSyncCoordinator,
  reconcileAssetReference,
  reconcileJobEntries,
  snapshotAssetRevisions,
  upsertAssetRevision,
} from './workbench-sync'

describe('WorkbenchSyncCoordinator', () => {
  it('buffers pre-sync and in-flight events, then replays only seq above the watermark', async () => {
    const pending = deferred<{ assets: Asset[]; jobs: Job[] }>()
    const applySnapshot = vi.fn()
    const applyEvent = vi.fn()
    const coordinator = new WorkbenchSyncCoordinator({
      loadSnapshot: () => pending.promise,
      applySnapshot,
      applyEvent,
      onError: vi.fn(),
    })
    coordinator.receive(jobEvent('server-a', 4, 'running'))
    coordinator.receive(syncEvent('server-a', 5))
    coordinator.receive(jobEvent('server-a', 7, 'succeeded'))
    coordinator.receive(jobEvent('server-a', 6, 'running'))
    coordinator.receive(jobEvent('server-b', 100, 'failed'))

    pending.resolve({ assets: [], jobs: [] })
    await pending.promise
    await Promise.resolve()

    expect(applySnapshot).toHaveBeenCalledWith({
      assets: [],
      jobs: [],
      serverId: 'server-a',
      watermark: 5,
    })
    expect(applyEvent.mock.calls.map(([event]) => event.seq)).toEqual([6, 7])
  })

  it('ignores duplicate, reverse-order, old-server, and stale snapshot results', async () => {
    const first = deferred<{ assets: Asset[]; jobs: Job[] }>()
    const second = deferred<{ assets: Asset[]; jobs: Job[] }>()
    const loadSnapshot = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const applySnapshot = vi.fn()
    const applyEvent = vi.fn()
    const coordinator = new WorkbenchSyncCoordinator({
      loadSnapshot,
      applySnapshot,
      applyEvent,
      onError: vi.fn(),
    })
    coordinator.receive(syncEvent('old', 1))
    coordinator.beginReconnect()
    coordinator.receive(syncEvent('new', 10))
    first.resolve({ assets: [asset('stale')], jobs: [] })
    second.resolve({ assets: [asset('current')], jobs: [] })
    await Promise.all([first.promise, second.promise])
    await Promise.resolve()
    coordinator.receive(jobEvent('new', 12, 'running'))
    coordinator.receive(jobEvent('new', 12, 'failed'))
    coordinator.receive(jobEvent('new', 11, 'failed'))
    coordinator.receive(jobEvent('old', 99, 'failed'))

    expect(applySnapshot).toHaveBeenCalledTimes(1)
    expect(applySnapshot.mock.calls[0][0].assets[0].id).toBe('current')
    expect(applyEvent).toHaveBeenCalledTimes(1)
    expect(applyEvent.mock.calls[0][0].seq).toBe(12)
  })

  it('keeps events buffered after repeated disconnect notifications until sync arrives', async () => {
    const applyEvent = vi.fn()
    const coordinator = new WorkbenchSyncCoordinator({
      loadSnapshot: async () => ({ assets: [], jobs: [] }),
      applySnapshot: vi.fn(),
      applyEvent,
      onError: vi.fn(),
    })
    coordinator.beginReconnect()
    coordinator.receive(jobEvent('server', 2, 'running'))
    coordinator.beginReconnect()
    coordinator.receive(syncEvent('server', 1))
    await Promise.resolve()
    await Promise.resolve()
    expect(applyEvent).toHaveBeenCalledWith(expect.objectContaining({ seq: 2 }))
  })

  it('retries a failed snapshot against the same watermark without losing buffered events', async () => {
    const loadSnapshot = vi.fn()
      .mockRejectedValueOnce(new Error('temporary snapshot failure'))
      .mockResolvedValueOnce({ assets: [], jobs: [] })
    const applyEvent = vi.fn()
    const onError = vi.fn()
    const coordinator = new WorkbenchSyncCoordinator({
      loadSnapshot,
      applySnapshot: vi.fn(),
      applyEvent,
      onError,
    })
    coordinator.receive(syncEvent('server', 5))
    coordinator.receive(jobEvent('server', 6, 'running'))
    await Promise.resolve()
    await Promise.resolve()
    expect(onError).toHaveBeenCalledOnce()

    coordinator.retrySnapshot()
    await Promise.resolve()
    await Promise.resolve()
    expect(loadSnapshot).toHaveBeenCalledTimes(2)
    expect(applyEvent).toHaveBeenCalledWith(expect.objectContaining({ seq: 6 }))
  })
})

describe('workbench reconciliation', () => {
  it('rebuilds labels from input assets and promotes succeeded jobs once outputs exist', () => {
    const input = asset('input', 'source.png', 'image')
    const output = asset('output', 'result', 'splat')
    const active = job('active', 'running', ['input'])
    const succeeded = { ...job('done', 'succeeded', ['missing']), outputAssetIds: ['output'] }
    expect(reconcileJobEntries([active, succeeded], [input, output], [])).toEqual([
      { job: active, label: 'source.png' },
    ])
    expect(reconcileJobEntries([active], [], [])[0].label).toBe('入力アセット不明')
  })

  it('does not resurrect an old succeeded job after its output asset was deleted', () => {
    const succeeded = { ...job('done', 'succeeded'), outputAssetIds: ['deleted-output'] }

    expect(reconcileJobEntries([succeeded], [], [])).toEqual([])
    expect(reconcileJobEntries(
      [succeeded],
      [],
      [{ job: job('done', 'running'), label: 'source.png' }],
    )).toEqual([{ job: succeeded, label: '入力アセット不明' }])
  })

  it('reconciles references and revisions from snapshots and upserts', () => {
    const old = asset('asset-1', 'old')
    const updated = asset('asset-1', 'updated')
    expect(reconcileAssetReference(old, [updated])).toBe(updated)
    expect(reconcileAssetReference(old, [])).toBeNull()
    const snapshot = snapshotAssetRevisions([updated], 'server', 8)
    expect(snapshot.get(updated.id)).toBe('server:8')
    expect(upsertAssetRevision(snapshot, updated.id, 'server', 9).get(updated.id)).toBe('server:9')
  })
})

function syncEvent(serverId: string, seq: number): WorkbenchEvent {
  return { type: 'sync', serverId, seq }
}

function jobEvent(serverId: string, seq: number, status: Job['status']): WorkbenchEvent {
  return { type: 'job.upserted', serverId, seq, occurredAt: '2026-07-12T00:00:00Z', job: job('job', status) }
}

function job(id: string, status: Job['status'], inputAssetIds: string[] = []): Job {
  return {
    id,
    pipeline: 'image-to-splat',
    status,
    progress: status === 'succeeded' ? 100 : 50,
    inputAssetIds,
    outputAssetIds: [],
    createdAt: '2026-07-12T00:00:00Z',
  }
}

function asset(id: string, name = id, kind: Asset['kind'] = 'scene'): Asset {
  return {
    id,
    kind,
    name,
    tags: [],
    files: { main: { path: 'main', size: 1 } },
    createdAt: '2026-07-12T00:00:00Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

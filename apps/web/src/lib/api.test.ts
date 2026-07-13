import type { Asset } from '@splatorium/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteAsset,
  fetchAssetReferences,
  fetchJobs,
  fetchSceneDocument,
  parseWorkbenchEvent,
  renameAsset,
  subscribeWorkbenchEvents,
  uploadAssetThumbnail,
} from './api'

describe('asset API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads a thumbnail as multipart form data and returns the updated asset', async () => {
    const asset = makeAsset('asset-1')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(asset), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const blob = new Blob(['thumbnail'], { type: 'image/webp' })
    const controller = new AbortController()

    await expect(uploadAssetThumbnail(asset.id, blob, controller.signal)).resolves.toEqual(asset)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/assets/asset-1/thumbnail')
    expect(init.method).toBe('POST')
    expect(init.signal).toBe(controller.signal)
    expect(init.body).toBeInstanceOf(FormData)
    const uploaded = (init.body as FormData).get('thumbnail')
    expect(uploaded).toBeInstanceOf(File)
    expect(uploaded).toMatchObject({ size: blob.size, type: 'image/webp' })
  })

  it('renames an asset with a JSON PATCH and returns the updated asset', async () => {
    const asset = { ...makeAsset('asset-1'), name: 'Mana Potion' }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(asset), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(renameAsset(asset.id, asset.name)).resolves.toEqual(asset)

    expect(fetchMock).toHaveBeenCalledWith('/api/assets/asset-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mana Potion' }),
    })
  })

  it('fetches referencing scenes without cache and deletes without parsing a body', async () => {
    const references = [{ sceneId: 'scene-1', sceneName: '参照シーン', nodeCount: 2 }]
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(references), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchAssetReferences('asset-1')).resolves.toEqual(references)
    await expect(deleteAsset('asset-1')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/assets/asset-1/references', {
      cache: 'no-store',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/assets/asset-1', {
      method: 'DELETE',
    })
  })

  it('bypasses caches when fetching a scene snapshot', async () => {
    const document = { schemaVersion: 2, nodes: [] }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(document), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchSceneDocument('scene-1')).resolves.toEqual(document)

    expect(fetchMock).toHaveBeenCalledWith('/api/assets/scene-1/files/main', {
      cache: 'no-store',
    })
  })
})

describe('Workbench sync API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests repeatable job statuses with an explicit limit and no-store cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    await fetchJobs(['queued', 'running'], 100)
    expect(fetch).toHaveBeenCalledWith(
      '/api/jobs?status=queued&status=running&limit=100',
      { cache: 'no-store' },
    )
  })

  it('opens the global stream without disabling browser reconnect', () => {
    const instances: FakeEventSource[] = []
    class FakeEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      onerror: (() => void) | null = null
      close = vi.fn()
      constructor(public readonly url: string) {
        instances.push(this)
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn()
    const onDisconnect = vi.fn()
    const close = subscribeWorkbenchEvents(onEvent, vi.fn(), onDisconnect)
    const source = instances[0]
    source.onmessage?.({
      data: JSON.stringify({ type: 'sync', serverId: 'server', seq: 3 }),
    } as MessageEvent<string>)
    source.onerror?.()

    expect(source.url).toBe('/api/events')
    expect(onEvent).toHaveBeenCalledWith({ type: 'sync', serverId: 'server', seq: 3 })
    expect(onDisconnect).toHaveBeenCalledOnce()
    expect(source.close).not.toHaveBeenCalled()
    close()
    expect(source.close).toHaveBeenCalledOnce()
  })

  it('rejects malformed and future event variants', () => {
    expect(parseWorkbenchEvent(JSON.stringify({
      type: 'asset.deleted',
      serverId: 'server',
      seq: 1,
      occurredAt: '2026-07-12T00:00:00.000Z',
      assetId: 'asset-1',
    }))).toEqual({
      type: 'asset.deleted',
      serverId: 'server',
      seq: 1,
      occurredAt: '2026-07-12T00:00:00.000Z',
      assetId: 'asset-1',
    })
    expect(() =>
      parseWorkbenchEvent('{"type":"sync","serverId":"server","seq":-1}'),
    ).toThrow()
    expect(() =>
      parseWorkbenchEvent('{"type":"asset.deleted","serverId":"server","seq":1}'),
    ).toThrow()
  })
})

function makeAsset(id: string): Asset {
  return {
    id,
    kind: 'splat',
    name: `${id}.spz`,
    tags: [],
    files: {
      main: { path: `${id}.spz`, size: 1 },
      thumbnail: { path: 'thumbnail.webp', size: 9, mime: 'image/webp' },
    },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

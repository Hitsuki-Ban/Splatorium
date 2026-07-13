import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ASSET_NAME_MAX_LENGTH,
  type Asset,
  type AssetKind,
  type Job,
  type SceneDocument,
  type WorkbenchEvent,
} from '@splatorium/shared'
import { createServerApp } from './app.js'
import { createObservableWorkbenchStore } from './observable-store.js'
import { createSqliteStore, type WorkbenchStore } from './store.js'
import { WorkbenchEventHub } from './workbench-events.js'

describe('createServerApp', () => {
  let dataDir: string
  let store: WorkbenchStore
  const enqueuedJobs: Job[] = []

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'splatorium-app-'))
    store = createSqliteStore({ dataDir })
    enqueuedJobs.length = 0
  })

  afterEach(async () => {
    store.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  function createApp(ids: string[] = []) {
    return createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      createId: createIdSequence(ids),
      now: () => '2026-07-09T00:00:00.000Z',
    })
  }

  it('lists jobs with repeatable statuses, a strict limit, and stable descending order', async () => {
    const jobs: Job[] = [
      createJob('job-a', 'queued', '2026-07-09T00:00:00.000Z'),
      createJob('job-b', 'running', '2026-07-09T00:00:01.000Z'),
      createJob('job-c', 'failed', '2026-07-09T00:00:02.000Z'),
      createJob('job-d', 'queued', '2026-07-09T00:00:01.000Z'),
    ]
    for (const job of jobs) store.saveJob(job)
    const app = createApp()

    const response = await app.request('/api/jobs?status=queued&status=running&limit=2')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(((await response.json()) as Job[]).map((job) => job.id)).toEqual(['job-d', 'job-b'])
  })

  it.each([
    ['/api/jobs?status=unknown', 'invalid job status: unknown'],
    ['/api/jobs?status=', 'invalid job status: '],
    ['/api/jobs?limit=0', 'limit must be an integer from 1 to 100'],
    ['/api/jobs?limit=101', 'limit must be an integer from 1 to 100'],
    ['/api/jobs?limit=1.5', 'limit must be an integer from 1 to 100'],
    ['/api/jobs?limit=1&limit=2', 'limit must be specified once'],
    ['/api/jobs?offset=1', 'unknown query parameter: offset'],
  ])('rejects an invalid job list query: %s', async (url, error) => {
    const response = await createApp().request(url)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
  })

  it('serves a fresh global sync event and removes the per-job event route', async () => {
    const hub = new WorkbenchEventHub({ serverId: 'server-a' })
    hub.publishJob(createJob('old-job', 'queued', '2026-07-09T00:00:00.000Z'))
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: hub,
    })
    const controller = new AbortController()
    const response = await app.request('/api/events', { signal: controller.signal })
    const reader = response.body?.getReader()
    if (!reader) throw new Error('SSE response has no body')

    const firstChunk = await reader.read()
    controller.abort()
    const text = new TextDecoder().decode(firstChunk.value)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(text).not.toContain('event:')
    expect(text).toContain('id: server-a:1')
    expect(text).toContain('retry: 2000')
    expect(text).toContain('"type":"sync"')
    expect(text).not.toContain('old-job')

    const removed = await app.request('/api/jobs/old-job/events')
    expect(removed.status).toBe(404)
  })

  it('publishes job creation and every route-owned asset mutation through the store', async () => {
    const hub = new WorkbenchEventHub({
      serverId: 'server-a',
      now: () => '2026-07-09T00:00:00.000Z',
    })
    store = createObservableWorkbenchStore(store, hub)
    const events: WorkbenchEvent[] = []
    hub.subscribe((event) => {
      events.push(event)
    })
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: hub,
      createId: createIdSequence(['asset-image', 'job-1', 'scene-asset']),
      now: () => '2026-07-09T00:00:00.000Z',
    })
    const jobBody = new FormData()
    jobBody.set('image', new File([new Uint8Array([1])], 'source.png', { type: 'image/png' }))
    expect((await app.request('/api/jobs', { method: 'POST', body: jobBody })).status).toBe(202)
    expect((await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Scene', document: createSceneDocument() }),
    })).status).toBe(201)
    expect((await app.request('/api/assets/scene-asset', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })).status).toBe(200)
    const thumbnail = new FormData()
    thumbnail.set('thumbnail', new File([new Uint8Array([2])], 'preview.webp', { type: 'image/webp' }))
    expect((await app.request('/api/assets/scene-asset/thumbnail', {
      method: 'POST',
      body: thumbnail,
    })).status).toBe(200)
    expect((await app.request('/api/scenes/scene-asset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: createSceneDocument() }),
    })).status).toBe(200)
    await waitFor(() => events.length === 7)

    expect(events.map((event) => event.type)).toEqual([
      'sync',
      'asset.upserted',
      'job.upserted',
      'asset.upserted',
      'asset.upserted',
      'asset.upserted',
      'asset.upserted',
    ])
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('lists nested model and imported scene references with per-scene counts', async () => {
    const modelAsset = createSplatAsset('asset-model')
    const importedScene = createSceneAsset('scene-source', 'Source Scene', createSceneDocument())
    const modelDocument: SceneDocument = {
      schemaVersion: 2,
      nodes: [{
        id: '00000000-0000-4000-8000-000000000010',
        kind: 'group',
        name: 'Models',
        visible: true,
        transform: identityTransform(),
        children: [
          ...createSceneDocument([{ assetId: modelAsset.id }, { assetId: modelAsset.id }]).nodes,
        ],
      }],
    }
    const modelScene = createSceneAsset('scene-models', 'Model Scene', modelDocument)
    const importedDocument: SceneDocument = {
      schemaVersion: 2,
      nodes: [
        importedGroup('00000000-0000-4000-8000-000000000020', importedScene.id),
        {
          id: '00000000-0000-4000-8000-000000000021',
          kind: 'group',
          name: 'Nested',
          visible: true,
          transform: identityTransform(),
          children: [importedGroup(
            '00000000-0000-4000-8000-000000000022',
            importedScene.id,
          )],
        },
      ],
    }
    const importingScene = createSceneAsset('scene-imports', 'Importing Scene', importedDocument)
    for (const asset of [modelAsset, importedScene, modelScene, importingScene]) {
      store.saveAsset(asset)
      if (asset.kind === 'scene') {
        await writeAssetFile(
          dataDir,
          asset,
          Buffer.from(JSON.stringify(
            asset.id === importedScene.id
              ? createSceneDocument()
              : asset.id === modelScene.id
                ? modelDocument
                : importedDocument,
          )),
        )
      }
    }
    const app = createApp()

    const modelResponse = await app.request(`/api/assets/${modelAsset.id}/references`)
    expect(modelResponse.status).toBe(200)
    expect(modelResponse.headers.get('cache-control')).toBe('no-store')
    expect(await modelResponse.json()).toEqual([
      { sceneId: modelScene.id, sceneName: modelScene.name, nodeCount: 2 },
    ])

    const sceneResponse = await app.request(`/api/assets/${importedScene.id}/references`)
    expect(sceneResponse.status).toBe(200)
    expect(await sceneResponse.json()).toEqual([
      { sceneId: importingScene.id, sceneName: importingScene.name, nodeCount: 2 },
    ])
  })

  it('fails reference inspection when a stored scene document is missing or malformed', async () => {
    const target = createSplatAsset('asset-model')
    const brokenScene = createSceneAsset('scene-broken', 'Broken', createSceneDocument())
    store.saveAsset(target)
    store.saveAsset(brokenScene)
    const app = createApp()

    expect((await app.request(`/api/assets/${target.id}/references`)).status).toBe(500)
    await writeAssetFile(dataDir, brokenScene, Buffer.from('{'))
    expect((await app.request(`/api/assets/${target.id}/references`)).status).toBe(500)
  })

  it('deletes the whole asset directory and metadata, retains jobs, and publishes deletion', async () => {
    const hub = new WorkbenchEventHub({
      serverId: 'server-a',
      now: () => '2026-07-09T00:00:00.000Z',
    })
    store = createObservableWorkbenchStore(store, hub)
    const events: WorkbenchEvent[] = []
    hub.subscribe((event) => {
      events.push(event)
    })
    const asset = createSplatAsset('asset-delete')
    const job = createJob('job-delete', 'succeeded', '2026-07-09T00:00:00.000Z')
    job.outputAssetIds = [asset.id]
    store.saveAsset(asset)
    store.saveJob(job)
    await writeAssetFile(dataDir, asset, new Uint8Array([1, 2, 3]))
    await mkdir(join(dataDir, 'assets', asset.id, 'nested'), { recursive: true })
    await writeFile(join(dataDir, 'assets', asset.id, 'nested', 'source.bin'), 'source')
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (queued) => enqueuedJobs.push(queued) },
      events: hub,
    })

    const response = await app.request(`/api/assets/${asset.id}`, { method: 'DELETE' })

    expect(response.status).toBe(204)
    expect(store.getAsset(asset.id)).toBeUndefined()
    expect(store.getJob(job.id)).toEqual(job)
    await expect(readFile(join(dataDir, 'assets', asset.id, 'nested', 'source.bin'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
    await waitFor(() => events.length === 4)
    expect(events.at(-1)).toEqual({
      type: 'asset.deleted',
      serverId: 'server-a',
      seq: 3,
      occurredAt: '2026-07-09T00:00:00.000Z',
      assetId: asset.id,
    })
    expect((await app.request(`/api/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('keeps metadata when the asset directory cannot be deleted', async () => {
    const asset = createSplatAsset('asset-without-directory')
    store.saveAsset(asset)
    const app = createApp()

    const response = await app.request(`/api/assets/${asset.id}`, { method: 'DELETE' })

    expect(response.status).toBe(500)
    expect(store.getAsset(asset.id)).toEqual(asset)
  })

  it('allows saving an existing broken model reference but rejects increasing it', async () => {
    const modelAsset = createSplatAsset('asset-model')
    store.saveAsset(modelAsset)
    await writeAssetFile(dataDir, modelAsset, new Uint8Array([1]))
    const app = createApp(['scene-asset'])
    const document = createSceneDocument([{ assetId: modelAsset.id }])
    expect((await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Scene', document }),
    })).status).toBe(201)
    expect((await app.request(`/api/assets/${modelAsset.id}`, { method: 'DELETE' })).status).toBe(204)

    const preserved = {
      ...document,
      nodes: document.nodes.map((node) => ({ ...node, name: 'Broken but retained' })),
    }
    expect((await app.request('/api/scenes/scene-asset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: preserved }),
    })).status).toBe(200)
    expect(JSON.parse(await readFile(
      join(dataDir, 'assets', 'scene-asset', 'scene.json'),
      'utf8',
    ))).toEqual(preserved)

    const increased = { ...preserved, nodes: [...preserved.nodes, {
      ...preserved.nodes[0],
      id: '00000000-0000-4000-8000-000000000099',
    }] }
    const rejected = await app.request('/api/scenes/scene-asset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: increased }),
    })
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toEqual({
      error: `scene references unknown asset: ${modelAsset.id}`,
    })
  })

  it('does not grandfather an existing reference to a non-model asset', async () => {
    const image: Asset = {
      id: 'asset-image',
      kind: 'image',
      name: 'Image',
      tags: [],
      files: { main: { path: 'image.png', size: 1, mime: 'image/png' } },
      createdAt: '2026-07-09T00:00:00.000Z',
    }
    const document = createSceneDocument([{ assetId: image.id }])
    const scene = createSceneAsset('scene-invalid', 'Invalid Scene', document)
    store.saveAsset(image)
    store.saveAsset(scene)
    await writeAssetFile(dataDir, scene, Buffer.from(JSON.stringify(document)))

    const response = await createApp().request(`/api/scenes/${scene.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: `scene references non-model asset: ${image.id}`,
    })
  })

  it('creates an image-to-splat job from multipart upload and exposes assets as bare JSON', async () => {
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      createId: createIdSequence(['asset-image', 'job-1']),
      now: () => '2026-07-09T00:00:00.000Z',
    })
    const body = new FormData()
    body.set('image', new File([new Uint8Array([1, 2, 3])], 'マナポーション.png', { type: 'image/png' }))
    body.set('numGaussians', '131072')
    body.set('seed', '99')

    const response = await app.request('/api/jobs', { method: 'POST', body })

    expect(response.status).toBe(202)
    const job = (await response.json()) as Job
    expect(job).toEqual({
      id: 'job-1',
      pipeline: 'image-to-splat',
      status: 'queued',
      progress: 0,
      statusText: 'Queued',
      params: { numGaussians: 131072, seed: 99 },
      inputAssetIds: ['asset-image'],
      outputAssetIds: [],
      createdAt: '2026-07-09T00:00:00.000Z',
    })
    expect(enqueuedJobs).toEqual([job])

    const storedPath = `${'_'.repeat('マナポーション'.length)}.png`
    const storedFile = await readFile(join(dataDir, 'assets', 'asset-image', storedPath))
    expect([...storedFile]).toEqual([1, 2, 3])

    const assetsResponse = await app.request('/api/assets')
    expect(assetsResponse.status).toBe(200)
    const assets = await assetsResponse.json()
    expect(assets).toEqual([
      {
        id: 'asset-image',
        kind: 'image',
        name: 'マナポーション.png',
        tags: [],
        files: {
          main: { path: storedPath, size: 3, mime: 'image/png' },
        },
        createdAt: '2026-07-09T00:00:00.000Z',
      },
    ])

    const fileResponse = await app.request('/api/assets/asset-image/files/main')
    expect(fileResponse.status).toBe(200)
    expect(fileResponse.headers.get('content-type')).toContain('image/png')
    expect([...new Uint8Array(await fileResponse.arrayBuffer())]).toEqual([1, 2, 3])
  })

  it('accepts a 255-character image name and rejects longer names without writing', async () => {
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      createId: createIdSequence(['asset-image', 'job-1']),
      now: () => '2026-07-09T00:00:00.000Z',
    })
    const originalName = `${'名'.repeat(ASSET_NAME_MAX_LENGTH - 4)}.png`
    const body = new FormData()
    body.set('image', new File([new Uint8Array([1])], originalName, { type: 'image/png' }))

    const response = await app.request('/api/jobs', { method: 'POST', body })

    expect(response.status).toBe(202)
    const imageAsset = store.getAsset('asset-image')
    expect(imageAsset?.name).toBe(originalName)
    expect(imageAsset?.name).toHaveLength(ASSET_NAME_MAX_LENGTH)
    expect(imageAsset?.files.main.path).toBe(`${'_'.repeat(ASSET_NAME_MAX_LENGTH - 4)}.png`)
    expect(imageAsset?.files.main.path).not.toBe(imageAsset?.name)

    const tooLongBody = new FormData()
    tooLongBody.set('image', new File([new Uint8Array([2])], `${'名'.repeat(ASSET_NAME_MAX_LENGTH)}.png`))
    const rejected = await app.request('/api/jobs', { method: 'POST', body: tooLongBody })
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toEqual({
      error: `image filename must be at most ${ASSET_NAME_MAX_LENGTH} characters`,
    })
    expect(enqueuedJobs).toHaveLength(1)
  })

  it('rejects a blank image filename before allocating or writing', async () => {
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      createId: createIdSequence([]),
      now: () => '2026-07-09T00:00:00.000Z',
    })
    const body = new FormData()
    body.set('image', new File([new Uint8Array([1])], '   '))

    const response = await app.request('/api/jobs', { method: 'POST', body })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'image filename must not be empty' })
    expect(store.listAssets()).toEqual([])
    expect(enqueuedJobs).toEqual([])
  })

  it('returns 404 when asset metadata references a missing file', async () => {
    const asset: Asset = {
      id: 'asset-missing-file',
      kind: 'image',
      name: 'missing.png',
      tags: [],
      files: { main: { path: 'missing.png', size: 3, mime: 'image/png' } },
      createdAt: '2026-07-09T00:00:00.000Z',
    }
    store.saveAsset(asset)
    const app = createApp()

    const response = await app.request('/api/assets/asset-missing-file/files/main')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'asset file not found' })
  })

  it('returns 400 when the multipart upload has no image file', async () => {
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      createId: createIdSequence([]),
      now: () => '2026-07-09T00:00:00.000Z',
    })
    const body = new FormData()
    body.set('numGaussians', '65536')

    const response = await app.request('/api/jobs', { method: 'POST', body })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'image file is required' })
    expect(enqueuedJobs).toEqual([])
  })

  it('returns 400 when numGaussians is not a positive integer', async () => {
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      createId: createIdSequence(['asset-image', 'job-1']),
      now: () => '2026-07-09T00:00:00.000Z',
    })
    const body = new FormData()
    body.set('image', new File([new Uint8Array([1])], 'source.png', { type: 'image/png' }))
    body.set('numGaussians', '0')

    const response = await app.request('/api/jobs', { method: 'POST', body })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'numGaussians must be a positive safe integer' })
    expect(enqueuedJobs).toEqual([])
  })

  it.each<AssetKind>(['image', 'splat', 'mesh', 'scene'])(
    'renames a %s asset while preserving every other field',
    async (kind) => {
      const asset: Asset = {
        ...createSplatAsset(`asset-${kind}`),
        kind,
        tags: ['favorite'],
        sourceJobId: 'job-source',
        files: {
          main: { path: 'original-file.bin', size: 3, mime: 'application/octet-stream' },
          thumbnail: { path: 'thumbnail.webp', size: 2, mime: 'image/webp' },
        },
      }
      store.saveAsset(asset)
      const app = createApp()

      const response = await app.request(`/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '  Mana Potion  ' }),
      })

      expect(response.status).toBe(200)
      const updated = (await response.json()) as Asset
      expect(updated).toEqual({ ...asset, name: 'Mana Potion' })
      expect(store.getAsset(asset.id)).toEqual(updated)
    },
  )

  it('rejects invalid asset rename bodies without changing the asset', async () => {
    const asset = createSplatAsset('asset-splat')
    store.saveAsset(asset)
    const app = createApp()
    const cases: Array<{ body: string; error: string }> = [
      { body: '{', error: 'request body must be JSON' },
      { body: '[]', error: 'request body must be an object' },
      { body: '{}', error: 'request body must contain only name' },
      {
        body: JSON.stringify({ name: 'valid', tags: [] }),
        error: 'request body must contain only name',
      },
      { body: JSON.stringify({ name: 42 }), error: 'name must be a string' },
      { body: JSON.stringify({ name: '   ' }), error: 'name must not be empty' },
      {
        body: JSON.stringify({ name: 'x'.repeat(ASSET_NAME_MAX_LENGTH + 1) }),
        error: `name must be at most ${ASSET_NAME_MAX_LENGTH} characters`,
      },
    ]

    for (const entry of cases) {
      const response = await app.request('/api/assets/asset-splat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: entry.body,
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: entry.error })
    }
    expect(store.getAsset(asset.id)).toEqual(asset)
  })

  it('returns 404 when renaming an unknown asset', async () => {
    const response = await createApp().request('/api/assets/missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Missing' }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'asset not found' })
  })

  it('accepts an asset name at the 255 character boundary', async () => {
    const asset = createSplatAsset('asset-splat')
    store.saveAsset(asset)
    const name = 'x'.repeat(ASSET_NAME_MAX_LENGTH)

    const response = await createApp().request('/api/assets/asset-splat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })

    expect(response.status).toBe(200)
    expect(((await response.json()) as Asset).name).toBe(name)
  })

  it('preserves a concurrent thumbnail update when renaming', async () => {
    const asset = createSplatAsset('asset-splat')
    store.saveAsset(asset)
    const app = createApp()
    const thumbnailBody = new FormData()
    thumbnailBody.set(
      'thumbnail',
      new File([new Uint8Array([1, 2])], 'preview.webp', { type: 'image/webp' }),
    )

    const responses = await Promise.all([
      app.request('/api/assets/asset-splat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
      app.request('/api/assets/asset-splat/thumbnail', {
        method: 'POST',
        body: thumbnailBody,
      }),
    ])

    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(store.getAsset(asset.id)).toEqual({
      ...asset,
      name: 'Renamed',
      files: {
        ...asset.files,
        thumbnail: { path: 'thumbnail.webp', size: 2, mime: 'image/webp' },
      },
    })
  })

  it('does not roll back a concurrent scene rename when PUT omits the name', async () => {
    const app = createApp(['scene-asset'])
    const createResponse = await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Before', document: createSceneDocument() }),
    })
    expect(createResponse.status).toBe(201)

    const responses = await Promise.all([
      app.request('/api/assets/scene-asset', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
      app.request('/api/scenes/scene-asset', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: createSceneDocument() }),
      }),
    ])

    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(store.getAsset('scene-asset')?.name).toBe('Renamed')
  })

  it('uploads a canonical WebP thumbnail and serves the new file', async () => {
    const splatAsset = createSplatAsset('asset-splat')
    store.saveAsset(splatAsset)
    const app = createApp()
    const body = new FormData()
    body.set(
      'thumbnail',
      new File([new Uint8Array([1, 2, 3, 4])], 'preview.anything', { type: 'image/webp' }),
    )

    const response = await app.request('/api/assets/asset-splat/thumbnail', {
      method: 'POST',
      body,
    })

    expect(response.status).toBe(200)
    const asset = (await response.json()) as Asset
    expect(asset).toEqual({
      ...splatAsset,
      files: {
        ...splatAsset.files,
        thumbnail: { path: 'thumbnail.webp', size: 4, mime: 'image/webp' },
      },
    })
    expect(store.getAsset('asset-splat')).toEqual(asset)
    expect([
      ...(await readFile(join(dataDir, 'assets', 'asset-splat', 'thumbnail.webp'))),
    ]).toEqual([1, 2, 3, 4])

    const fileResponse = await app.request('/api/assets/asset-splat/files/thumbnail')
    expect(fileResponse.status).toBe(200)
    expect(fileResponse.headers.get('content-type')).toContain('image/webp')
    expect([...new Uint8Array(await fileResponse.arrayBuffer())]).toEqual([1, 2, 3, 4])
  })

  it('replaces a WebP thumbnail with PNG and removes the stale extension', async () => {
    const splatAsset = createSplatAsset('asset-splat')
    store.saveAsset(splatAsset)
    const app = createApp()
    const webpBody = new FormData()
    webpBody.set('thumbnail', new File([new Uint8Array([1])], 'first.webp', { type: 'image/webp' }))
    await app.request('/api/assets/asset-splat/thumbnail', { method: 'POST', body: webpBody })
    const pngBody = new FormData()
    pngBody.set(
      'thumbnail',
      new File([new Uint8Array([7, 8])], 'replacement.png', { type: 'image/png' }),
    )

    const response = await app.request('/api/assets/asset-splat/thumbnail', {
      method: 'POST',
      body: pngBody,
    })

    expect(response.status).toBe(200)
    const asset = (await response.json()) as Asset
    expect(asset.files.thumbnail).toEqual({
      path: 'thumbnail.png',
      size: 2,
      mime: 'image/png',
    })
    await expect(
      readFile(join(dataDir, 'assets', 'asset-splat', 'thumbnail.webp')),
    ).rejects.toThrow()
    expect([...(await readFile(join(dataDir, 'assets', 'asset-splat', 'thumbnail.png')))]).toEqual([
      7, 8,
    ])
    expect(store.getAsset('asset-splat')).toEqual(asset)
  })

  it('keeps the stored thumbnail file valid across concurrent MIME replacements', async () => {
    const splatAsset = createSplatAsset('asset-splat')
    store.saveAsset(splatAsset)
    const app = createApp()
    const webpBody = new FormData()
    webpBody.set(
      'thumbnail',
      new File([new Uint8Array([1])], 'concurrent.webp', { type: 'image/webp' }),
    )
    const pngBody = new FormData()
    pngBody.set(
      'thumbnail',
      new File([new Uint8Array([2])], 'concurrent.png', { type: 'image/png' }),
    )

    const responses = await Promise.all([
      app.request('/api/assets/asset-splat/thumbnail', { method: 'POST', body: webpBody }),
      app.request('/api/assets/asset-splat/thumbnail', { method: 'POST', body: pngBody }),
    ])

    expect(responses.map((response) => response.status)).toEqual([200, 200])
    const asset = store.getAsset('asset-splat')
    if (!asset?.files.thumbnail) {
      throw new Error('stored thumbnail is missing')
    }
    const currentPath = asset.files.thumbnail.path
    const stalePath = currentPath === 'thumbnail.webp' ? 'thumbnail.png' : 'thumbnail.webp'
    expect((await readFile(join(dataDir, 'assets', 'asset-splat', currentPath))).byteLength).toBe(1)
    await expect(readFile(join(dataDir, 'assets', 'asset-splat', stalePath))).rejects.toThrow()
  })

  it('returns 404 when uploading a thumbnail for an unknown asset', async () => {
    const app = createApp()
    const body = new FormData()
    body.set('thumbnail', new File([new Uint8Array([1])], 'preview.webp', { type: 'image/webp' }))

    const response = await app.request('/api/assets/missing/thumbnail', {
      method: 'POST',
      body,
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'asset not found' })
  })

  it('returns 400 when the thumbnail multipart field is missing', async () => {
    const splatAsset = createSplatAsset('asset-splat')
    store.saveAsset(splatAsset)
    const app = createApp()

    const response = await app.request('/api/assets/asset-splat/thumbnail', {
      method: 'POST',
      body: new FormData(),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'thumbnail file is required' })
    expect(store.getAsset('asset-splat')).toEqual(splatAsset)
  })

  it('returns 400 when the thumbnail MIME type is not WebP or PNG', async () => {
    const splatAsset = createSplatAsset('asset-splat')
    store.saveAsset(splatAsset)
    const app = createApp()
    const body = new FormData()
    body.set('thumbnail', new File([new Uint8Array([1])], 'preview.jpg', { type: 'image/jpeg' }))

    const response = await app.request('/api/assets/asset-splat/thumbnail', {
      method: 'POST',
      body,
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'thumbnail must be image/webp or image/png' })
    expect(store.getAsset('asset-splat')).toEqual(splatAsset)
  })

  it('accepts exactly 1 MiB and rejects a thumbnail one byte over the limit', async () => {
    const splatAsset = createSplatAsset('asset-splat')
    store.saveAsset(splatAsset)
    const app = createApp()
    const boundaryBody = new FormData()
    boundaryBody.set(
      'thumbnail',
      new File([new Uint8Array(1_048_576)], 'boundary.png', { type: 'image/png' }),
    )

    const boundaryResponse = await app.request('/api/assets/asset-splat/thumbnail', {
      method: 'POST',
      body: boundaryBody,
    })

    expect(boundaryResponse.status).toBe(200)
    const boundaryAsset = (await boundaryResponse.json()) as Asset
    expect(boundaryAsset.files.thumbnail).toEqual({
      path: 'thumbnail.png',
      size: 1_048_576,
      mime: 'image/png',
    })

    const oversizedBody = new FormData()
    oversizedBody.set(
      'thumbnail',
      new File([new Uint8Array(1_048_577)], 'oversized.webp', { type: 'image/webp' }),
    )
    const oversizedResponse = await app.request('/api/assets/asset-splat/thumbnail', {
      method: 'POST',
      body: oversizedBody,
    })

    expect(oversizedResponse.status).toBe(400)
    expect(await oversizedResponse.json()).toEqual({
      error: 'thumbnail must be at most 1048576 bytes',
    })
    expect(store.getAsset('asset-splat')).toEqual(boundaryAsset)
    expect(
      (await readFile(join(dataDir, 'assets', 'asset-splat', 'thumbnail.png'))).byteLength,
    ).toBe(1_048_576)
  })

  it('returns 400 when uploading a thumbnail for an image asset', async () => {
    const imageAsset: Asset = {
      id: 'asset-image',
      kind: 'image',
      name: 'source.png',
      tags: [],
      files: { main: { path: 'source.png', size: 1, mime: 'image/png' } },
      createdAt: '2026-07-09T00:00:00.000Z',
    }
    store.saveAsset(imageAsset)
    const app = createApp()
    const body = new FormData()
    body.set('thumbnail', new File([new Uint8Array([1])], 'preview.png', { type: 'image/png' }))

    const response = await app.request('/api/assets/asset-image/thumbnail', {
      method: 'POST',
      body,
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'asset kind does not support thumbnails' })
    expect(store.getAsset('asset-image')).toEqual(imageAsset)
  })

  it('creates a scene asset and serves its scene.json as application/json', async () => {
    const splatAsset = createSplatAsset('asset-splat')
    store.saveAsset(splatAsset)
    await writeAssetFile(dataDir, splatAsset, new Uint8Array([1, 2, 3]))
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      createId: createIdSequence(['scene-asset']),
      now: () => '2026-07-09T00:00:00.000Z',
    })
    const document = createSceneDocument([
      {
        assetId: 'asset-splat',
        position: [1, 2, 3],
        rotation: [0, 1.5, 0],
        scale: [2, 2, 2],
      },
    ])

    const response = await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Scene A', document }),
    })

    expect(response.status).toBe(201)
    const asset = (await response.json()) as Asset
    expect(asset).toEqual({
      id: 'scene-asset',
      kind: 'scene',
      name: 'Scene A',
      tags: [],
      files: {
        main: { path: 'scene.json', size: asset.files.main.size, mime: 'application/json' },
      },
      createdAt: '2026-07-09T00:00:00.000Z',
    })

    const fileBytes = await readFile(join(dataDir, 'assets', 'scene-asset', 'scene.json'))
    expect(asset.files.main.size).toBe(fileBytes.byteLength)
    expect(JSON.parse(fileBytes.toString('utf8'))).toEqual(document)
    expect(store.getAsset('scene-asset')).toEqual(asset)

    const fileResponse = await app.request('/api/assets/scene-asset/files/main')
    expect(fileResponse.status).toBe(200)
    expect(fileResponse.headers.get('content-type')).toContain('application/json')
    expect(await fileResponse.json()).toEqual(document)
  })

  it('accepts 255-character scene names and rejects longer names on POST without writing', async () => {
    const app = createApp(['scene-asset'])
    const document = createSceneDocument()
    const tooLongName = 'x'.repeat(ASSET_NAME_MAX_LENGTH + 1)

    const rejectedResponse = await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tooLongName, document }),
    })

    expect(rejectedResponse.status).toBe(400)
    expect(await rejectedResponse.json()).toEqual({
      error: `name must be at most ${ASSET_NAME_MAX_LENGTH} characters`,
    })
    expect(store.getAsset('scene-asset')).toBeUndefined()
    await expect(
      readFile(join(dataDir, 'assets', 'scene-asset', 'scene.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' })

    const boundaryName = 'x'.repeat(ASSET_NAME_MAX_LENGTH)
    const paddedBoundaryName = `  ${boundaryName}  `
    const acceptedResponse = await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: paddedBoundaryName, document }),
    })

    expect(acceptedResponse.status).toBe(201)
    expect(((await acceptedResponse.json()) as Asset).name).toBe(boundaryName)
    expect(store.getAsset('scene-asset')?.name).toBe(boundaryName)
  })

  it('returns 400 when a scene references an unknown asset', async () => {
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      createId: createIdSequence(['scene-asset']),
      now: () => '2026-07-09T00:00:00.000Z',
    })

    const response = await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Broken Scene',
        document: createSceneDocument([{ assetId: 'missing' }]),
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'scene references unknown asset: missing' })
    expect(store.getAsset('scene-asset')).toBeUndefined()
  })

  it.each([
    { placements: [] },
    { schemaVersion: 1, nodes: [] },
    { schemaVersion: 2, nodes: [], placements: [] },
  ])('accepts only strict version 2 documents on write', async (document) => {
    const app = createApp(['scene-asset'])

    const response = await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Invalid Scene', document }),
    })

    expect(response.status).toBe(400)
    expect(store.getAsset('scene-asset')).toBeUndefined()
  })

  it.each([
    { placements: [] },
    { schemaVersion: 99, nodes: [] },
    { schemaVersion: 2, nodes: [], placements: [] },
  ])('rejects non-v2 documents on PUT as well as POST', async (document) => {
    const app = createApp(['scene-asset'])
    const createResponse = await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Existing Scene', document: createSceneDocument() }),
    })
    expect(createResponse.status).toBe(201)

    const response = await app.request('/api/scenes/scene-asset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document }),
    })

    expect(response.status).toBe(400)
    expect(
      JSON.parse(await readFile(join(dataDir, 'assets', 'scene-asset', 'scene.json'), 'utf8')),
    ).toEqual(createSceneDocument())
  })

  it('validates model assets recursively and accepts splat and mesh nodes', async () => {
    const splat = createSplatAsset('asset-splat')
    const mesh: Asset = {
      ...createSplatAsset('asset-mesh'),
      kind: 'mesh',
      name: 'asset-mesh.glb',
      files: { main: { path: 'asset-mesh.glb', size: 3, mime: 'model/gltf-binary' } },
    }
    store.saveAsset(splat)
    store.saveAsset(mesh)
    const app = createApp(['scene-asset'])
    const document: SceneDocument = {
      schemaVersion: 2,
      nodes: [
        {
          id: '00000000-0000-4000-8000-000000000100',
          kind: 'group',
          name: 'Models',
          visible: true,
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          children: [
            createSceneDocument([{ assetId: splat.id }]).nodes[0],
            {
              ...createSceneDocument([{ assetId: mesh.id }]).nodes[0],
              id: '00000000-0000-4000-8000-000000000002',
            },
          ],
        },
      ],
    }

    const response = await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nested Scene', document }),
    })

    expect(response.status).toBe(201)
    expect(JSON.parse(await readFile(join(dataDir, 'assets', 'scene-asset', 'scene.json'), 'utf8')))
      .toEqual(document)
  })

  it('rejects an image referenced as a nested model node', async () => {
    const image: Asset = {
      id: 'asset-image',
      kind: 'image',
      name: 'image.png',
      tags: [],
      files: { main: { path: 'image.png', size: 3, mime: 'image/png' } },
      createdAt: '2026-07-09T00:00:00.000Z',
    }
    store.saveAsset(image)
    const app = createApp(['scene-asset'])

    const invalidNode = createSceneDocument([{ assetId: image.id }]).nodes[0]
    const response = await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Invalid Scene',
        document: {
          schemaVersion: 2,
          nodes: [
            {
              id: '00000000-0000-4000-8000-000000000100',
              kind: 'group',
              name: 'Nested',
              visible: true,
              transform: {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
              },
              children: [invalidNode],
            },
          ],
        },
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'scene references non-model asset: asset-image',
    })
  })

  it('updates an existing scene asset and preserves its creation time', async () => {
    const splatAsset = createSplatAsset('asset-splat')
    store.saveAsset(splatAsset)
    await writeAssetFile(dataDir, splatAsset, new Uint8Array([1, 2, 3]))
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      createId: createIdSequence(['scene-asset']),
      now: () => '2026-07-09T00:00:00.000Z',
    })
    const initialDocument = createSceneDocument([{ assetId: 'asset-splat' }])
    await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Scene A', document: initialDocument }),
    })
    const updatedDocument = createSceneDocument([
      {
        assetId: 'asset-splat',
        position: [4, 5, 6],
        rotation: [0.1, 0.2, 0.3],
        scale: [3, 3, 3],
      },
    ])

    const response = await app.request('/api/scenes/scene-asset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Scene B', document: updatedDocument }),
    })

    expect(response.status).toBe(200)
    const asset = (await response.json()) as Asset
    expect(asset.name).toBe('Scene B')
    expect(asset.createdAt).toBe('2026-07-09T00:00:00.000Z')
    const fileBytes = await readFile(join(dataDir, 'assets', 'scene-asset', 'scene.json'))
    expect(asset.files.main.size).toBe(fileBytes.byteLength)
    expect(JSON.parse(fileBytes.toString('utf8'))).toEqual(updatedDocument)
    expect(store.getAsset('scene-asset')).toEqual(asset)
  })

  it('accepts 255-character scene names and rejects longer names on PUT without modifying', async () => {
    const app = createApp(['scene-asset'])
    const initialDocument = createSceneDocument()
    const createResponse = await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Original Scene', document: initialDocument }),
    })
    expect(createResponse.status).toBe(201)
    const originalAsset = store.getAsset('scene-asset')
    const changedDocument: SceneDocument = {
      schemaVersion: 2,
      nodes: [
        {
          id: '00000000-0000-4000-8000-000000000100',
          kind: 'group',
          name: 'Changed',
          visible: true,
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          children: [],
        },
      ],
    }

    const rejectedResponse = await app.request('/api/scenes/scene-asset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'x'.repeat(ASSET_NAME_MAX_LENGTH + 1),
        document: changedDocument,
      }),
    })

    expect(rejectedResponse.status).toBe(400)
    expect(await rejectedResponse.json()).toEqual({
      error: `name must be at most ${ASSET_NAME_MAX_LENGTH} characters`,
    })
    expect(store.getAsset('scene-asset')).toEqual(originalAsset)
    expect(
      JSON.parse(await readFile(join(dataDir, 'assets', 'scene-asset', 'scene.json'), 'utf8')),
    ).toEqual(initialDocument)

    const boundaryName = 'x'.repeat(ASSET_NAME_MAX_LENGTH)
    const paddedBoundaryName = `  ${boundaryName}  `
    const acceptedResponse = await app.request('/api/scenes/scene-asset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: paddedBoundaryName, document: changedDocument }),
    })

    expect(acceptedResponse.status).toBe(200)
    expect(((await acceptedResponse.json()) as Asset).name).toBe(boundaryName)
    expect(store.getAsset('scene-asset')?.name).toBe(boundaryName)
    expect(
      JSON.parse(await readFile(join(dataDir, 'assets', 'scene-asset', 'scene.json'), 'utf8')),
    ).toEqual(changedDocument)
  })

  it('preserves a scene thumbnail when updating the scene document', async () => {
    const splatAsset = createSplatAsset('asset-splat')
    store.saveAsset(splatAsset)
    const app = createApp(['scene-asset'])
    const createResponse = await app.request('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Scene A', document: createSceneDocument() }),
    })
    expect(createResponse.status).toBe(201)
    const thumbnailBody = new FormData()
    thumbnailBody.set(
      'thumbnail',
      new File([new Uint8Array([9, 8, 7])], 'scene.png', { type: 'image/png' }),
    )
    const thumbnailResponse = await app.request('/api/assets/scene-asset/thumbnail', {
      method: 'POST',
      body: thumbnailBody,
    })
    expect(thumbnailResponse.status).toBe(200)

    const response = await app.request('/api/scenes/scene-asset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Scene B',
        document: createSceneDocument([
          { assetId: 'asset-splat', position: [1, 2, 3] },
        ]),
      }),
    })

    expect(response.status).toBe(200)
    const asset = (await response.json()) as Asset
    expect(asset.files.thumbnail).toEqual({
      path: 'thumbnail.png',
      size: 3,
      mime: 'image/png',
    })
    expect(store.getAsset('scene-asset')).toEqual(asset)
    const fileResponse = await app.request('/api/assets/scene-asset/files/thumbnail')
    expect(fileResponse.status).toBe(200)
    expect([...new Uint8Array(await fileResponse.arrayBuffer())]).toEqual([9, 8, 7])
  })

  it('returns 404 when updating a non-scene asset id', async () => {
    const splatAsset = createSplatAsset('asset-splat')
    store.saveAsset(splatAsset)
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      createId: createIdSequence([]),
      now: () => '2026-07-09T00:00:00.000Z',
    })

    const response = await app.request('/api/scenes/asset-splat', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Nope',
        document: createSceneDocument([{ assetId: 'asset-splat' }]),
      }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'scene asset not found' })
  })

  it('serves production web files without routing API misses to the SPA fallback', async () => {
    const staticDir = join(dataDir, 'web-dist')
    await mkdir(join(staticDir, 'assets'), { recursive: true })
    await writeFile(join(staticDir, 'index.html'), '<div id="root">Workbench</div>')
    await writeFile(join(staticDir, 'assets', 'index.js'), 'console.log("workbench")')

    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      staticDir,
      createId: createIdSequence([]),
      now: () => '2026-07-09T00:00:00.000Z',
    })

    const rootResponse = await app.request('/')
    expect(rootResponse.status).toBe(200)
    expect(rootResponse.headers.get('content-type')).toContain('text/html')
    expect(await rootResponse.text()).toContain('Workbench')

    const assetResponse = await app.request('/assets/index.js')
    expect(assetResponse.status).toBe(200)
    expect(assetResponse.headers.get('content-type')).toContain('text/javascript')
    expect(await assetResponse.text()).toContain('workbench')

    const fallbackResponse = await app.request('/scene/asset-splat')
    expect(fallbackResponse.status).toBe(200)
    expect(fallbackResponse.headers.get('content-type')).toContain('text/html')
    expect(await fallbackResponse.text()).toContain('Workbench')

    const apiMissResponse = await app.request('/api/not-found')
    expect(apiMissResponse.status).toBe(404)
    expect(await apiMissResponse.json()).toEqual({ error: 'api route not found' })

    const missingAssetResponse = await app.request('/assets/missing.js')
    expect(missingAssetResponse.status).toBe(404)
    expect(await missingAssetResponse.json()).toEqual({ error: 'static file not found' })
  })

  it('rejects path traversal attempts without leaking files outside staticDir', async () => {
    const staticDir = join(dataDir, 'web-dist')
    await mkdir(join(staticDir, 'assets'), { recursive: true })
    await writeFile(join(staticDir, 'index.html'), '<div id="root">Workbench</div>')
    await writeFile(join(staticDir, 'assets', 'index.js'), 'console.log("workbench")')
    await writeFile(join(dataDir, 'package.json'), '{"secret":"do-not-leak"}')

    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      staticDir,
      createId: createIdSequence([]),
      now: () => '2026-07-09T00:00:00.000Z',
    })

    // 拒否ステータスは経路と OS で 400/404 に分かれる（バックスラッシュが
    // セパレータ扱いかは platform 依存）。主張すべきは「外のファイルが漏れない」こと
    const traversalPaths = [
      '/../package.json',
      '/%2e%2e%2fpackage.json',
      '/assets/..%5c..%5cpackage.json',
      '/assets/%00index.js',
    ]

    for (const path of traversalPaths) {
      const response = await app.request(path)
      expect([400, 404]).toContain(response.status)
      const body = await response.text()
      expect(body).not.toContain('do-not-leak')
    }
  })

  it('serves the health API route ahead of the SPA fallback when staticDir is configured', async () => {
    const staticDir = join(dataDir, 'web-dist')
    await mkdir(staticDir, { recursive: true })
    await writeFile(join(staticDir, 'index.html'), '<div id="root">Workbench</div>')

    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      staticDir,
      createId: createIdSequence([]),
      now: () => '2026-07-09T00:00:00.000Z',
    })

    const response = await app.request('/api/health')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'splatorium-server',
      time: '2026-07-09T00:00:00.000Z',
    })
  })

  it('returns a JSON 404 explaining the missing web build when staticDir has no index.html', async () => {
    const staticDir = join(dataDir, 'web-dist-missing')
    const app = createServerApp({
      dataDir,
      store,
      queue: { enqueue: (job) => enqueuedJobs.push(job) },
      events: { subscribe: () => () => {} },
      staticDir,
      createId: createIdSequence([]),
      now: () => '2026-07-09T00:00:00.000Z',
    })

    const response = await app.request('/')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'web assets are not built (run: pnpm --filter @splatorium/web build)',
    })
  })
})

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

function createSplatAsset(id: string): Asset {
  return {
    id,
    kind: 'splat',
    name: `${id}.spz`,
    tags: [],
    files: { main: { path: `${id}.spz`, size: 3, mime: 'model/vnd.spz' } },
    createdAt: '2026-07-09T00:00:00.000Z',
  }
}

function createJob(id: string, status: Job['status'], createdAt: string): Job {
  return {
    id,
    pipeline: 'image-to-splat',
    status,
    progress: status === 'queued' ? 0 : 1,
    inputAssetIds: ['asset-image'],
    outputAssetIds: [],
    createdAt,
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('condition was not reached')
}

function createSceneDocument(
  placements: Array<{
    assetId: string
    position?: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number]
  }> = [],
): SceneDocument {
  return {
    schemaVersion: 2,
    nodes: placements.map((placement, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      kind: 'model',
      name: `Model ${index + 1}`,
      visible: true,
      transform: {
        position: placement.position ?? [0, 0, 0],
        rotation: placement.rotation ?? [0, 0, 0],
        scale: placement.scale ?? [1, 1, 1],
      },
      assetId: placement.assetId,
    })),
  }
}

function createSceneAsset(id: string, name: string, document: SceneDocument): Asset {
  return {
    id,
    kind: 'scene',
    name,
    tags: [],
    files: {
      main: {
        path: 'scene.json',
        size: Buffer.byteLength(JSON.stringify(document)),
        mime: 'application/json',
      },
    },
    createdAt: '2026-07-09T00:00:00.000Z',
  }
}

function identityTransform() {
  return {
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  }
}

function importedGroup(id: string, sceneId: string): SceneDocument['nodes'][number] {
  return {
    id,
    kind: 'group',
    name: 'Imported',
    visible: true,
    transform: identityTransform(),
    children: [],
    importedFrom: {
      sceneId,
      sourceHash: '0'.repeat(64),
      contentHash: '1'.repeat(64),
    },
  }
}

async function writeAssetFile(dataDir: string, asset: Asset, bytes: Uint8Array): Promise<void> {
  await mkdir(join(dataDir, 'assets', asset.id), { recursive: true })
  await writeFile(join(dataDir, 'assets', asset.id, asset.files.main.path), bytes)
}

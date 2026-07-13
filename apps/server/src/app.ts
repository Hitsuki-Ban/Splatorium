import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  ASSET_NAME_MAX_LENGTH,
  type Asset,
  type AssetFileRef,
  type AssetSceneReference,
  type Job,
  type JobStatus,
  type SceneDocument,
  type SceneNode,
  parseStoredSceneDocument,
  parseWritableSceneDocument,
} from '@splatorium/shared'
import type { WorkbenchEventHub } from './workbench-events.js'
import { registerStaticFiles } from './static-files.js'
import type { WorkbenchStore } from './store.js'

export interface QueueLike {
  enqueue(job: Job): void
}

export interface ServerAppOptions {
  dataDir: string
  store: WorkbenchStore
  queue: QueueLike
  events: Pick<WorkbenchEventHub, 'subscribe'>
  staticDir?: string
  createId?: () => string
  now?: () => string
}

type AssetFileRole = 'main' | 'thumbnail' | 'source'

const DEFAULT_NUM_GAUSSIANS = 65536
const SCENE_FILE_NAME = 'scene.json'
const MAX_THUMBNAIL_BYTES = 1_048_576
const THUMBNAIL_FILE_NAMES = {
  'image/webp': 'thumbnail.webp',
  'image/png': 'thumbnail.png',
} as const

type ThumbnailMime = keyof typeof THUMBNAIL_FILE_NAMES

export function createServerApp(options: ServerAppOptions): Hono {
  const app = new Hono()
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date().toISOString())
  const assetMutationTails = new Map<string, Promise<void>>()

  app.get('/api/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'splatorium-server',
      time: now(),
    })
  })

  app.post('/api/jobs', async (c) => {
    const body = await c.req.parseBody()
    const image = body.image
    if (!isFile(image)) {
      return c.json({ error: 'image file is required' }, 400)
    }
    const assetName = basename(image.name)
    if (assetName.trim().length === 0) {
      return c.json({ error: 'image filename must not be empty' }, 400)
    }
    if (assetName.length > ASSET_NAME_MAX_LENGTH) {
      return c.json({ error: `image filename must be at most ${ASSET_NAME_MAX_LENGTH} characters` }, 400)
    }

    let numGaussians: number
    let seed: number
    try {
      numGaussians = parseIntegerField(body.numGaussians, DEFAULT_NUM_GAUSSIANS, 'numGaussians')
      seed = parseIntegerField(body.seed, createSeed(), 'seed')
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
    }

    const createdAt = now()
    const imageAssetId = createId()
    const jobId = createId()
    const fileName = sanitizeFileName(assetName)
    const fileBytes = new Uint8Array(await image.arrayBuffer())
    const assetDir = join(options.dataDir, 'assets', imageAssetId)
    await mkdir(assetDir, { recursive: true })
    await writeFile(join(assetDir, fileName), fileBytes)

    const mainFile: AssetFileRef = {
      path: fileName,
      size: fileBytes.byteLength,
      mime: image.type || 'application/octet-stream',
    }
    const imageAsset: Asset = {
      id: imageAssetId,
      kind: 'image',
      name: assetName,
      tags: [],
      files: { main: mainFile },
      createdAt,
    }
    const job: Job = {
      id: jobId,
      pipeline: 'image-to-splat',
      status: 'queued',
      progress: 0,
      statusText: 'Queued',
      params: {
        numGaussians,
        seed,
      },
      inputAssetIds: [imageAssetId],
      outputAssetIds: [],
      createdAt,
    }

    options.store.saveAsset(imageAsset)
    options.store.saveJob(job)
    options.queue.enqueue(job)

    return c.json(job, 202)
  })

  app.get('/api/jobs/:id', (c) => {
    const job = options.store.getJob(c.req.param('id'))
    if (!job) {
      return c.json({ error: 'job not found' }, 404)
    }
    return c.json(job)
  })

  app.get('/api/jobs', (c) => {
    const parsed = parseJobListQuery(c.req.url)
    if ('error' in parsed) {
      return c.json({ error: parsed.error }, 400)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(options.store.listJobs({ statuses: parsed.statuses, limit: parsed.limit }))
  })

  app.get('/api/events', (c) => {
    c.header('Cache-Control', 'no-cache')
    return streamSSE(c, async (stream) => {
      let writeTail = Promise.resolve<void>(undefined)
      const enqueueWrite = (write: () => Promise<void>): Promise<void> => {
        const result = writeTail.then(write)
        writeTail = result.catch(() => {})
        return result
      }
      await new Promise<void>((resolve) => {
        const unsubscribe = options.events.subscribe((event) => {
          return enqueueWrite(() => stream.writeSSE({
            data: JSON.stringify(event),
            id: `${event.serverId}:${event.seq}`,
            ...(event.type === 'sync' ? { retry: 2_000 } : {}),
          }))
        })
        const heartbeat = setInterval(() => {
          void enqueueWrite(async () => {
            await stream.write(': heartbeat\n\n')
          })
        }, 15_000)

        stream.onAbort(() => {
          clearInterval(heartbeat)
          unsubscribe()
          resolve()
        })
      })
    })
  })

  app.post('/api/scenes', async (c) => {
    const parsed = await parseSceneBody(c.req, { requireName: true })
    if ('error' in parsed) {
      return c.json({ error: parsed.error }, parsed.status)
    }

    const invalidAsset = findInvalidSceneAssetReference(parsed.document, options.store)
    if (invalidAsset) {
      const reason = invalidAsset.kind === 'missing' ? 'unknown' : 'non-model'
      return c.json({ error: `scene references ${reason} asset: ${invalidAsset.assetId}` }, 400)
    }

    const sceneAsset = await saveSceneAsset({
      dataDir: options.dataDir,
      store: options.store,
      id: createId(),
      name: parsed.name,
      document: parsed.document,
      createdAt: now(),
    })

    return c.json(sceneAsset, 201)
  })

  app.put('/api/scenes/:id', async (c) => {
    const existing = options.store.getAsset(c.req.param('id'))
    if (!existing || existing.kind !== 'scene') {
      return c.json({ error: 'scene asset not found' }, 404)
    }

    const parsed = await parseSceneBody(c.req)
    if ('error' in parsed) {
      return c.json({ error: parsed.error }, parsed.status)
    }

    const result = await runAssetMutation(assetMutationTails, existing.id, async () => {
      const current = options.store.getAsset(existing.id)
      if (!current || current.kind !== 'scene') {
        throw new Error(`scene asset disappeared during update: ${existing.id}`)
      }
      const storedDocument = await readStoredSceneDocument(options.dataDir, current, options.store)
      const invalidAsset = findInvalidSceneAssetReference(
        parsed.document,
        options.store,
        countModelAssetReferences(storedDocument),
      )
      if (invalidAsset) return { invalidAsset } as const

      const sceneAsset = await saveSceneAsset({
        dataDir: options.dataDir,
        store: options.store,
        id: current.id,
        name: parsed.name ?? current.name,
        document: parsed.document,
        createdAt: current.createdAt,
        thumbnail: current.files.thumbnail,
      })
      return { sceneAsset } as const
    })

    if ('invalidAsset' in result && result.invalidAsset) {
      const reason = result.invalidAsset.kind === 'missing' ? 'unknown' : 'non-model'
      return c.json(
        { error: `scene references ${reason} asset: ${result.invalidAsset.assetId}` },
        400,
      )
    }
    return c.json(result.sceneAsset)
  })

  app.get('/api/assets', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(options.store.listAssets())
  })

  app.patch('/api/assets/:id', async (c) => {
    const assetId = c.req.param('id')
    if (!options.store.getAsset(assetId)) {
      return c.json({ error: 'asset not found' }, 404)
    }

    const parsed = await parseAssetRenameBody(c.req)
    if ('error' in parsed) {
      return c.json({ error: parsed.error }, parsed.status)
    }

    const updatedAsset = await runAssetMutation(assetMutationTails, assetId, async () => {
      const current = options.store.getAsset(assetId)
      if (!current) {
        throw new Error(`asset disappeared during rename: ${assetId}`)
      }
      const result: Asset = { ...current, name: parsed.name }
      options.store.saveAsset(result)
      return result
    })

    return c.json(updatedAsset)
  })

  app.post('/api/assets/:id/thumbnail', async (c) => {
    const assetId = c.req.param('id')
    const asset = options.store.getAsset(assetId)
    if (!asset) {
      return c.json({ error: 'asset not found' }, 404)
    }
    if (asset.kind !== 'splat' && asset.kind !== 'scene') {
      return c.json({ error: 'asset kind does not support thumbnails' }, 400)
    }

    const body = await c.req.parseBody()
    const thumbnail = body.thumbnail
    if (!isFile(thumbnail)) {
      return c.json({ error: 'thumbnail file is required' }, 400)
    }
    if (!isThumbnailMime(thumbnail.type)) {
      return c.json({ error: 'thumbnail must be image/webp or image/png' }, 400)
    }
    const thumbnailMime = thumbnail.type
    if (thumbnail.size > MAX_THUMBNAIL_BYTES) {
      return c.json({ error: `thumbnail must be at most ${MAX_THUMBNAIL_BYTES} bytes` }, 400)
    }

    const fileBytes = new Uint8Array(await thumbnail.arrayBuffer())
    if (fileBytes.byteLength > MAX_THUMBNAIL_BYTES) {
      return c.json({ error: `thumbnail must be at most ${MAX_THUMBNAIL_BYTES} bytes` }, 400)
    }

    const updatedAsset = await runAssetMutation(assetMutationTails, assetId, async () => {
      const current = options.store.getAsset(assetId)
      if (!current || (current.kind !== 'splat' && current.kind !== 'scene')) {
        throw new Error(`thumbnail asset disappeared during update: ${assetId}`)
      }

      const fileName = THUMBNAIL_FILE_NAMES[thumbnailMime]
      const staleFileName =
        fileName === THUMBNAIL_FILE_NAMES['image/webp']
          ? THUMBNAIL_FILE_NAMES['image/png']
          : THUMBNAIL_FILE_NAMES['image/webp']
      const assetDir = join(options.dataDir, 'assets', assetId)
      await mkdir(assetDir, { recursive: true })
      await writeFile(join(assetDir, fileName), fileBytes)

      const result: Asset = {
        ...current,
        files: {
          ...current.files,
          thumbnail: {
            path: fileName,
            size: fileBytes.byteLength,
            mime: thumbnailMime,
          },
        },
      }
      options.store.saveAsset(result)
      await rm(join(assetDir, staleFileName), { force: true })
      return result
    })

    return c.json(updatedAsset)
  })

  app.get('/api/assets/:id/references', async (c) => {
    const target = options.store.getAsset(c.req.param('id'))
    if (!target) {
      return c.json({ error: 'asset not found' }, 404)
    }

    const references: AssetSceneReference[] = []
    for (const scene of options.store.listAssets()) {
      if (scene.kind !== 'scene') continue
      const reference = await runAssetMutation(assetMutationTails, scene.id, async () => {
        const current = options.store.getAsset(scene.id)
        if (!current || current.kind !== 'scene') return null
        const document = await readStoredSceneDocument(options.dataDir, current, options.store)
        const nodeCount = countReferencesToAsset(document.nodes, target)
        return nodeCount > 0
          ? { sceneId: current.id, sceneName: current.name, nodeCount }
          : null
      })
      if (reference) references.push(reference)
    }
    c.header('Cache-Control', 'no-store')
    return c.json(references)
  })

  app.delete('/api/assets/:id', async (c) => {
    const assetId = c.req.param('id')
    const deleted = await runAssetMutation(assetMutationTails, assetId, async () => {
      const current = options.store.getAsset(assetId)
      if (!current) return false

      await rm(resolveAssetDirectory(options.dataDir, current.id), { recursive: true })
      if (!options.store.deleteAsset(current.id)) {
        throw new Error(`asset metadata disappeared during deletion: ${current.id}`)
      }
      return true
    })
    if (!deleted) {
      return c.json({ error: 'asset not found' }, 404)
    }
    return c.body(null, 204)
  })

  app.get('/api/assets/:id', (c) => {
    const asset = options.store.getAsset(c.req.param('id'))
    if (!asset) {
      return c.json({ error: 'asset not found' }, 404)
    }
    return c.json(asset)
  })

  app.get('/api/assets/:id/files/:role', async (c) => {
    const asset = options.store.getAsset(c.req.param('id'))
    if (!asset) {
      return c.json({ error: 'asset not found' }, 404)
    }

    const role = c.req.param('role')
    if (!isAssetFileRole(role)) {
      return c.json({ error: 'asset file role not found' }, 404)
    }

    const file = asset.files[role]
    if (!file) {
      return c.json({ error: 'asset file not found' }, 404)
    }

    const bytes = await readFile(join(options.dataDir, 'assets', asset.id, file.path)).catch(
      (error: unknown) => {
        if (isMissingAssetFileError(error)) {
          return null
        }
        throw error
      },
    )
    if (bytes === null) {
      return c.json({ error: 'asset file not found' }, 404)
    }
    return c.body(bytes, 200, {
      'Content-Type': file.mime ?? 'application/octet-stream',
      'Content-Length': String(file.size),
    })
  })

  if (options.staticDir) {
    registerStaticFiles(app, { root: options.staticDir })
  }

  return app
}

interface ParsedSceneBody {
  name?: string
  document: SceneDocument
}

interface ParsedNewSceneBody extends ParsedSceneBody {
  name: string
}

interface ParsedAssetRenameBody {
  name: string
}

interface ParseError {
  status: 400
  error: string
}

const JOB_STATUSES: readonly JobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
]

function parseJobListQuery(url: string):
  | { statuses: JobStatus[] | undefined; limit: number }
  | { error: string } {
  const parameters = new URL(url).searchParams
  for (const key of parameters.keys()) {
    if (key !== 'status' && key !== 'limit') {
      return { error: `unknown query parameter: ${key}` }
    }
  }

  const statusValues = parameters.getAll('status')
  const statuses: JobStatus[] = []
  for (const status of statusValues) {
    if (!isJobStatus(status)) {
      return { error: `invalid job status: ${status}` }
    }
    statuses.push(status)
  }

  const limitValues = parameters.getAll('limit')
  if (limitValues.length > 1) {
    return { error: 'limit must be specified once' }
  }
  const limitText = limitValues[0]
  if (limitText !== undefined && !/^[1-9]\d*$/.test(limitText)) {
    return { error: 'limit must be an integer from 1 to 100' }
  }
  const limit = limitText === undefined ? 50 : Number(limitText)
  if (limit > 100) {
    return { error: 'limit must be an integer from 1 to 100' }
  }

  return { statuses: statuses.length > 0 ? statuses : undefined, limit }
}

function isJobStatus(value: string): value is JobStatus {
  return JOB_STATUSES.some((status) => status === value)
}

function parseSceneBody(
  request: { json(): Promise<unknown> },
  options: { requireName: true },
): Promise<ParsedNewSceneBody | ParseError>
function parseSceneBody(
  request: { json(): Promise<unknown> },
): Promise<ParsedSceneBody | ParseError>
async function parseSceneBody(
  request: { json(): Promise<unknown> },
  options?: { requireName: true },
): Promise<ParsedSceneBody | ParseError> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { status: 400, error: 'request body must be JSON' }
  }
  if (!isRecord(body)) {
    return { status: 400, error: 'request body must be an object' }
  }

  const name = typeof body.name === 'string' ? body.name.trim() : body.name
  if (name === undefined && options?.requireName) {
    return { status: 400, error: 'name must be a non-empty string' }
  }
  if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
    return { status: 400, error: 'name must be a non-empty string' }
  }
  if (typeof name === 'string' && name.length > ASSET_NAME_MAX_LENGTH) {
    return {
      status: 400,
      error: `name must be at most ${ASSET_NAME_MAX_LENGTH} characters`,
    }
  }
  const document = parseWritableSceneDocument(body.document)
  if (!document.ok) {
    return { status: 400, error: document.error }
  }

  return { name, document: document.value }
}

async function parseAssetRenameBody(
  request: { json(): Promise<unknown> },
): Promise<ParsedAssetRenameBody | ParseError> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { status: 400, error: 'request body must be JSON' }
  }
  if (!isRecord(body)) {
    return { status: 400, error: 'request body must be an object' }
  }
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'name')) {
    return { status: 400, error: 'request body must contain only name' }
  }
  if (typeof body.name !== 'string') {
    return { status: 400, error: 'name must be a string' }
  }

  const name = body.name.trim()
  if (name.length === 0) {
    return { status: 400, error: 'name must not be empty' }
  }
  if (name.length > ASSET_NAME_MAX_LENGTH) {
    return {
      status: 400,
      error: `name must be at most ${ASSET_NAME_MAX_LENGTH} characters`,
    }
  }
  return { name }
}

function findInvalidSceneAssetReference(
  document: SceneDocument,
  store: WorkbenchStore,
  allowedMissingReferences: ReadonlyMap<string, number> = new Map(),
): { assetId: string; kind: 'missing' | 'non-model' } | undefined {
  const remainingMissingReferences = new Map(allowedMissingReferences)
  const visit = (nodes: SceneNode[]): { assetId: string; kind: 'missing' | 'non-model' } | undefined => {
    for (const node of nodes) {
      if (node.kind === 'group') {
        const invalidChild = visit(node.children)
        if (invalidChild) return invalidChild
        continue
      }
      const asset = store.getAsset(node.assetId)
      if (!asset) {
        const remaining = remainingMissingReferences.get(node.assetId) ?? 0
        if (remaining === 0) return { assetId: node.assetId, kind: 'missing' }
        remainingMissingReferences.set(node.assetId, remaining - 1)
        continue
      }
      if (asset.kind !== 'splat' && asset.kind !== 'mesh') {
        return { assetId: node.assetId, kind: 'non-model' }
      }
    }
    return undefined
  }
  return visit(document.nodes)
}

async function readStoredSceneDocument(
  dataDir: string,
  scene: Asset,
  store: WorkbenchStore,
): Promise<SceneDocument> {
  const raw = await readFile(
    join(resolveAssetDirectory(dataDir, scene.id), scene.files.main.path),
    'utf8',
  )
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(`invalid scene document JSON: ${scene.id}`, { cause: error })
  }
  const parsed = parseStoredSceneDocument(value, {
    resolveAssetName: (assetId) => store.getAsset(assetId)?.name,
    createNodeId: randomUUID,
  })
  if (!parsed.ok) {
    throw new Error(`invalid stored scene document: ${scene.id}: ${parsed.error}`)
  }
  return parsed.value
}

function countReferencesToAsset(nodes: readonly SceneNode[], target: Asset): number {
  let count = 0
  for (const node of nodes) {
    if (node.kind === 'model') {
      if (target.kind !== 'scene' && node.assetId === target.id) count += 1
      continue
    }
    if (target.kind === 'scene' && node.importedFrom?.sceneId === target.id) count += 1
    count += countReferencesToAsset(node.children, target)
  }
  return count
}

function countModelAssetReferences(document: SceneDocument): Map<string, number> {
  const counts = new Map<string, number>()
  const visit = (nodes: readonly SceneNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'group') {
        visit(node.children)
        continue
      }
      counts.set(node.assetId, (counts.get(node.assetId) ?? 0) + 1)
    }
  }
  visit(document.nodes)
  return counts
}

function resolveAssetDirectory(dataDir: string, assetId: string): string {
  const assetsDirectory = resolve(dataDir, 'assets')
  const assetDirectory = resolve(assetsDirectory, assetId)
  if (dirname(assetDirectory) !== assetsDirectory) {
    throw new Error(`asset id does not resolve to a direct asset directory: ${assetId}`)
  }
  return assetDirectory
}

async function saveSceneAsset({
  dataDir,
  store,
  id,
  name,
  document,
  createdAt,
  thumbnail,
}: {
  dataDir: string
  store: WorkbenchStore
  id: string
  name: string
  document: SceneDocument
  createdAt: string
  thumbnail?: AssetFileRef
}): Promise<Asset> {
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
  const assetDir = join(dataDir, 'assets', id)
  await mkdir(assetDir, { recursive: true })
  await writeFile(join(assetDir, SCENE_FILE_NAME), bytes)

  const asset: Asset = {
    id,
    kind: 'scene',
    name,
    tags: [],
    files: {
      main: { path: SCENE_FILE_NAME, size: bytes.byteLength, mime: 'application/json' },
      ...(thumbnail ? { thumbnail } : {}),
    },
    createdAt,
  }
  store.saveAsset(asset)
  return asset
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFile(value: unknown): value is File {
  return value instanceof File
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function parseIntegerField(value: unknown, defaultValue: number, fieldName: string): number {
  if (value === undefined) {
    return defaultValue
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive safe integer`)
  }
  return parsed
}

function createSeed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1
}

function isAssetFileRole(role: string): role is AssetFileRole {
  return role === 'main' || role === 'thumbnail' || role === 'source'
}

function isMissingAssetFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isThumbnailMime(value: string): value is ThumbnailMime {
  return value === 'image/webp' || value === 'image/png'
}

async function runAssetMutation<T>(
  mutationTails: Map<string, Promise<void>>,
  assetId: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const previousTail = mutationTails.get(assetId) ?? Promise.resolve()
  let release!: () => void
  const currentMutation = new Promise<void>((resolve) => {
    release = resolve
  })
  const currentTail = previousTail.then(() => currentMutation)
  mutationTails.set(assetId, currentTail)

  await previousTail
  try {
    return await mutate()
  } finally {
    release()
    if (mutationTails.get(assetId) === currentTail) {
      mutationTails.delete(assetId)
    }
  }
}

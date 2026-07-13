import type {
  Asset,
  AssetSceneReference,
  HealthResponse,
  Job,
  JobStatus,
  SceneDocument,
  WorkbenchEvent,
} from '@splatorium/shared'

/**
 * Workbench サーバー API クライアント。
 * エンドポイント契約は docs/api.md に合わせ、非 2xx 応答は ApiError として返す。
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    throw new ApiError(res.status, `${init?.method ?? 'GET'} ${path} -> ${res.status}`)
  }
  return (await res.json()) as T
}

async function requestNoContent(path: string, init: RequestInit): Promise<void> {
  const res = await fetch(path, init)
  if (!res.ok) {
    throw new ApiError(res.status, `${init.method ?? 'GET'} ${path} -> ${res.status}`)
  }
}

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health')
}

export function fetchAssets(): Promise<Asset[]> {
  return request<Asset[]>('/api/assets', { cache: 'no-store' })
}

export function fetchJobs(statuses: readonly JobStatus[], limit: number): Promise<Job[]> {
  const query = new URLSearchParams()
  for (const status of statuses) query.append('status', status)
  query.set('limit', String(limit))
  return request<Job[]>(`/api/jobs?${query.toString()}`, { cache: 'no-store' })
}

export function renameAsset(assetId: string, name: string): Promise<Asset> {
  return request<Asset>(`/api/assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function fetchAssetReferences(assetId: string): Promise<AssetSceneReference[]> {
  return request<AssetSceneReference[]>(`/api/assets/${assetId}/references`, {
    cache: 'no-store',
  })
}

export function deleteAsset(assetId: string): Promise<void> {
  return requestNoContent(`/api/assets/${assetId}`, { method: 'DELETE' })
}

export function uploadAssetThumbnail(
  assetId: string,
  blob: Blob,
  signal: AbortSignal,
): Promise<Asset> {
  const form = new FormData()
  form.append('thumbnail', blob)
  return request<Asset>(`/api/assets/${assetId}/thumbnail`, {
    method: 'POST',
    body: form,
    signal,
  })
}

export interface CreateJobOptions {
  numGaussians: number
  seed?: number
}

export function createJob(image: File, opts: CreateJobOptions): Promise<Job> {
  const form = new FormData()
  form.append('image', image)
  form.append('numGaussians', String(opts.numGaussians))
  if (opts.seed !== undefined) form.append('seed', String(opts.seed))
  return request<Job>('/api/jobs', { method: 'POST', body: form })
}

export function fetchJob(id: string): Promise<Job> {
  return request<Job>(`/api/jobs/${id}`)
}

/** App lifetime に 1 本だけ開く Workbench 全体の mutation stream。 */
export function subscribeWorkbenchEvents(
  onEvent: (event: WorkbenchEvent) => void,
  onProtocolError: (error: unknown) => void,
  onDisconnect: () => void,
): () => void {
  const source = new EventSource('/api/events')
  source.onmessage = (event) => {
    try {
      onEvent(parseWorkbenchEvent(event.data))
    } catch (error) {
      onProtocolError(error)
    }
  }
  source.onerror = () => {
    onDisconnect()
  }
  return () => source.close()
}

export function parseWorkbenchEvent(data: string): WorkbenchEvent {
  const value: unknown = JSON.parse(data)
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('Workbench event must be an object with a type')
  }
  if (
    typeof value.serverId !== 'string' ||
    !Number.isSafeInteger(value.seq) ||
    (value.seq as number) < 0
  ) {
    throw new Error('Workbench event has an invalid cursor')
  }
  if (value.type === 'sync') return value as WorkbenchEvent
  if (
    value.type === 'job.upserted' &&
    typeof value.occurredAt === 'string' &&
    isRecord(value.job)
  ) {
    return value as unknown as WorkbenchEvent
  }
  if (
    value.type === 'asset.upserted' &&
    typeof value.occurredAt === 'string' &&
    isRecord(value.asset)
  ) {
    return value as unknown as WorkbenchEvent
  }
  if (
    value.type === 'asset.deleted' &&
    typeof value.occurredAt === 'string' &&
    typeof value.assetId === 'string'
  ) {
    return value as unknown as WorkbenchEvent
  }
  throw new Error(`Unknown Workbench event type: ${value.type}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** シーンを kind:scene Asset として保存する。 */
export function saveScene(name: string, document: SceneDocument): Promise<Asset> {
  return request<Asset>('/api/scenes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, document }),
  })
}

/** 既存シーンを上書き保存する。 */
export function updateScene(id: string, document: SceneDocument, name?: string): Promise<Asset> {
  return request<Asset>(`/api/scenes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, document }),
  })
}

/** kind:scene アセットの本体 JSON を読み出す */
export function fetchSceneDocument(assetId: string): Promise<unknown> {
  return request<unknown>(assetFileUrl(assetId, 'main'), { cache: 'no-store' })
}

/** Asset file の配信 URL を返す。 */
export function assetFileUrl(assetId: string, role: 'main' | 'thumbnail' | 'source'): string {
  return `/api/assets/${assetId}/files/${role}`
}

export function assetThumbnailUrl(assetId: string, revision: string): string {
  const query = new URLSearchParams({ revision })
  return `${assetFileUrl(assetId, 'thumbnail')}?${query.toString()}`
}

/** 生成画面に表示する num_gaussians の選択肢。 */
export const GAUSSIAN_PRESETS = [65_536, 131_072, 262_144] as const
export const DEFAULT_GAUSSIANS = 65_536

import { hasEveryOutputAsset, isVisibleJob, type JobEntry } from '@/lib/jobs'
import type { Asset, Job, WorkbenchEvent } from '@splatorium/shared'

export type WorkbenchMutationEvent = Exclude<WorkbenchEvent, { type: 'sync' }>

export interface WorkbenchSnapshot {
  assets: Asset[]
  jobs: Job[]
}

export interface ReconciledWorkbenchSnapshot extends WorkbenchSnapshot {
  serverId: string
  watermark: number
}

interface WorkbenchSyncCallbacks {
  loadSnapshot: () => Promise<WorkbenchSnapshot>
  applySnapshot: (snapshot: ReconciledWorkbenchSnapshot) => void
  applyEvent: (event: WorkbenchMutationEvent) => void
  onError: (error: unknown) => void
}

/**
 * Coordinates the sync-watermark handshake. Events are buffered before and while
 * snapshots load, then only mutations newer than the authoritative watermark are
 * replayed. A reconnect invalidates every in-flight snapshot request.
 */
export class WorkbenchSyncCoordinator {
  private phase: 'awaiting-sync' | 'loading' | 'ready' = 'awaiting-sync'
  private buffered: WorkbenchMutationEvent[] = []
  private generation = 0
  private serverId: string | null = null
  private cursor = -1
  private lastSync: Extract<WorkbenchEvent, { type: 'sync' }> | null = null

  constructor(private readonly callbacks: WorkbenchSyncCallbacks) {}

  beginReconnect(): void {
    if (this.phase === 'awaiting-sync') return
    this.generation += 1
    this.phase = 'awaiting-sync'
    this.buffered = []
    this.serverId = null
    this.cursor = -1
    this.lastSync = null
  }

  retrySnapshot(): void {
    if (this.phase === 'awaiting-sync' && this.lastSync) this.startSnapshot(this.lastSync)
  }

  receive(event: WorkbenchEvent): void {
    if (event.type === 'sync') {
      this.startSnapshot(event)
      return
    }
    if (this.phase !== 'ready') {
      this.buffered.push(event)
      return
    }
    this.applyIfNew(event)
  }

  private startSnapshot(sync: Extract<WorkbenchEvent, { type: 'sync' }>): void {
    const generation = ++this.generation
    this.phase = 'loading'
    this.serverId = sync.serverId
    this.cursor = sync.seq
    this.lastSync = sync

    void this.callbacks.loadSnapshot().then(
      (snapshot) => {
        if (this.generation !== generation) return
        this.callbacks.applySnapshot({
          ...snapshot,
          serverId: sync.serverId,
          watermark: sync.seq,
        })
        this.phase = 'ready'
        const replay = this.buffered
          .filter((event) => event.serverId === sync.serverId && event.seq > sync.seq)
          .sort((left, right) => left.seq - right.seq)
        this.buffered = []
        for (const event of replay) this.applyIfNew(event)
      },
      (error: unknown) => {
        if (this.generation !== generation) return
        this.phase = 'awaiting-sync'
        this.callbacks.onError(error)
      },
    )
  }

  private applyIfNew(event: WorkbenchMutationEvent): void {
    if (event.serverId !== this.serverId || event.seq <= this.cursor) return
    this.cursor = event.seq
    this.callbacks.applyEvent(event)
  }
}

export function deduplicateJobs(...groups: readonly Job[][]): Job[] {
  const jobs = new Map<string, Job>()
  for (const group of groups) {
    for (const job of group) jobs.set(job.id, job)
  }
  return [...jobs.values()]
}

export function reconcileJobEntries(
  snapshot: readonly Job[],
  assets: Asset[],
  previous: readonly JobEntry[],
): JobEntry[] {
  const previousById = new Map(previous.map((entry) => [entry.job.id, entry]))
  return snapshot.flatMap((job) => {
    const previousEntry = previousById.get(job.id)
    if (
      !isVisibleJob(job) ||
      (job.status === 'succeeded' && (hasEveryOutputAsset(job, assets) || !previousEntry))
    ) {
      return []
    }
    return [
      {
        job,
        label: resolveJobLabel(job, assets),
        ...(previousEntry?.promotionError
          ? { promotionError: previousEntry.promotionError }
          : {}),
      },
    ]
  })
}

export function upsertJobEntry(
  entries: readonly JobEntry[],
  job: Job,
  assets: Asset[],
): JobEntry[] {
  const snapshot = [job, ...entries.filter((entry) => entry.job.id !== job.id).map((entry) => entry.job)]
  return reconcileJobEntries(snapshot, assets, entries)
}

export function resolveJobLabel(job: Job, assets: readonly Asset[]): string {
  const inputId = job.inputAssetIds[0]
  return assets.find((asset) => asset.id === inputId)?.name ?? '入力アセット不明'
}

export function reconcileAssetReference(
  current: Asset | null,
  assets: readonly Asset[],
): Asset | null {
  if (!current) return null
  return assets.find((asset) => asset.id === current.id) ?? null
}

export function snapshotAssetRevisions(
  assets: readonly Asset[],
  serverId: string,
  watermark: number,
): ReadonlyMap<string, string> {
  const revision = `${serverId}:${watermark}`
  return new Map(assets.map((asset) => [asset.id, revision]))
}

export function upsertAssetRevision(
  revisions: ReadonlyMap<string, string>,
  assetId: string,
  serverId: string,
  seq: number,
): ReadonlyMap<string, string> {
  const next = new Map(revisions)
  next.set(assetId, `${serverId}:${seq}`)
  return next
}

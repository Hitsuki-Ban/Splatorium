import { randomUUID } from 'node:crypto'
import type { Asset, Job, WorkbenchEvent } from '@splatorium/shared'

export type WorkbenchEventListener = (event: WorkbenchEvent) => void | Promise<void>

interface Subscriber {
  active: boolean
  tail: Promise<void>
  listener: WorkbenchEventListener
}

export interface WorkbenchEventHubOptions {
  serverId?: string
  now?: () => string
}

/**
 * Process-local ordered mutation stream. This is deliberately not a replay log:
 * every subscription starts with a fresh sync watermark and clients reconcile
 * against authoritative snapshots.
 */
export class WorkbenchEventHub {
  readonly serverId: string
  private readonly now: () => string
  private readonly subscribers = new Set<Subscriber>()
  private sequence = 0

  constructor(options: WorkbenchEventHubOptions = {}) {
    this.serverId = options.serverId ?? randomUUID()
    this.now = options.now ?? (() => new Date().toISOString())
  }

  get currentSequence(): number {
    return this.sequence
  }

  subscribe(listener: WorkbenchEventListener): () => void {
    const subscriber: Subscriber = {
      active: true,
      tail: Promise.resolve(),
      listener,
    }
    this.subscribers.add(subscriber)
    this.enqueue(subscriber, {
      type: 'sync',
      serverId: this.serverId,
      seq: this.sequence,
    })

    return () => {
      subscriber.active = false
      this.subscribers.delete(subscriber)
    }
  }

  publishAsset(asset: Asset): void {
    this.publish({
      type: 'asset.upserted',
      serverId: this.serverId,
      seq: ++this.sequence,
      occurredAt: this.now(),
      asset,
    })
  }

  publishAssetDeleted(assetId: string): void {
    this.publish({
      type: 'asset.deleted',
      serverId: this.serverId,
      seq: ++this.sequence,
      occurredAt: this.now(),
      assetId,
    })
  }

  publishJob(job: Job): void {
    this.publish({
      type: 'job.upserted',
      serverId: this.serverId,
      seq: ++this.sequence,
      occurredAt: this.now(),
      job,
    })
  }

  private publish(event: WorkbenchEvent): void {
    for (const subscriber of this.subscribers) {
      this.enqueue(subscriber, event)
    }
  }

  private enqueue(subscriber: Subscriber, event: WorkbenchEvent): void {
    subscriber.tail = subscriber.tail
      .then(async () => {
        if (subscriber.active) {
          await subscriber.listener(event)
        }
      })
      .catch(() => {
        // A broken subscriber must not interrupt persistence or other streams.
      })
  }
}

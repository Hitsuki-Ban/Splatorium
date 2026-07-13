import type { Job, JobMetrics } from '@splatorium/shared'
import type { WorkbenchStore } from './store.js'

export interface JobRunResult {
  outputAssetIds: string[]
  metrics?: JobMetrics
}

export interface JobRunContext {
  updateJob(update: Partial<Job>): Job
}

export type JobRunner = (job: Job, context: JobRunContext) => Promise<JobRunResult>

export interface JobQueueOptions {
  store: WorkbenchStore
  runJob: JobRunner
  now?: () => string
}

export class JobQueue {
  private readonly store: WorkbenchStore
  private readonly runJob: JobRunner
  private readonly now: () => string
  private readonly pending: Job[] = []
  private idleResolvers: Array<() => void> = []
  private running = false

  constructor(options: JobQueueOptions) {
    this.store = options.store
    this.runJob = options.runJob
    this.now = options.now ?? (() => new Date().toISOString())
  }

  enqueue(job: Job): void {
    this.enqueueAll([job])
  }

  enqueueAll(jobs: readonly Job[]): void {
    this.pending.push(...jobs)
    void this.drain()
  }

  waitForIdle(): Promise<void> {
    if (!this.running && this.pending.length === 0) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      this.idleResolvers.push(resolve)
    })
  }

  private async drain(): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true
    while (this.pending.length > 0) {
      const job = this.pending.shift()
      if (job) {
        await this.runOne(job)
      }
    }
    this.running = false
    this.resolveIdle()
  }

  private async runOne(initialJob: Job): Promise<void> {
    let currentJob = this.persist({
      ...initialJob,
      status: 'running',
      progress: Math.max(initialJob.progress, 1),
      startedAt: this.now(),
      statusText: 'Running',
    })

    const context: JobRunContext = {
      updateJob: (update) => {
        currentJob = this.persist({ ...currentJob, ...update })
        return currentJob
      },
    }

    try {
      const result = await this.runJob(currentJob, context)
      this.persist({
        ...currentJob,
        status: 'succeeded',
        progress: 100,
        statusText: 'Completed',
        outputAssetIds: result.outputAssetIds,
        metrics: result.metrics,
        finishedAt: this.now(),
      })
    } catch (error) {
      this.persist({
        ...currentJob,
        status: 'failed',
        progress: 100,
        statusText: 'Failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: this.now(),
      })
    }
  }

  private persist(job: Job): Job {
    this.store.saveJob(job)
    return job
  }

  private resolveIdle(): void {
    const resolvers = this.idleResolvers
    this.idleResolvers = []
    for (const resolve of resolvers) {
      resolve()
    }
  }
}

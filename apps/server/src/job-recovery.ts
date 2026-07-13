import type { Job } from '@splatorium/shared'
import type { WorkbenchStore } from './store.js'

export const RESTART_INTERRUPTION_MESSAGE =
  'サーバー再起動により中断されました。もう一度実行してください'

interface RecoveryQueue {
  enqueueAll(jobs: readonly Job[]): void
}

export function recoverInterruptedJobs({
  store,
  queue,
  now = () => new Date().toISOString(),
}: {
  store: WorkbenchStore
  queue: RecoveryQueue
  now?: () => string
}): void {
  const activeJobs = store
    .listJobs()
    .filter((job) => job.status === 'queued' || job.status === 'running')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  const queuedJobs: Job[] = []

  for (const job of activeJobs) {
    if (job.status === 'queued') {
      queuedJobs.push(job)
      continue
    }

    const failed: Job = {
      ...job,
      status: 'failed',
      progress: 100,
      statusText: RESTART_INTERRUPTION_MESSAGE,
      error: RESTART_INTERRUPTION_MESSAGE,
      finishedAt: now(),
    }
    store.saveJob(failed)
  }

  queue.enqueueAll(queuedJobs)
}

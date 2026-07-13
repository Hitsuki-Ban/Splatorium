import type { Asset, Job, JobStatus } from '@splatorium/shared'

export interface JobEntry {
  job: Job
  /** アップロードした画像ファイル名（表示用） */
  label: string
  /** 完了ジョブをアセット表示へ昇格できなかった場合の同期エラー */
  promotionError?: string
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: '待機中',
  running: '生成中',
  succeeded: '完了',
  failed: '失敗',
  canceled: '中止',
}

export function isActiveJob(job: Job): boolean {
  return job.status === 'queued' || job.status === 'running'
}

export function isVisibleJob(job: Job): boolean {
  return isActiveJob(job) || job.status === 'succeeded' || job.status === 'failed'
}

export function hasEveryOutputAsset(job: Job, assets: Asset[]): boolean {
  if (job.outputAssetIds.length === 0) return false
  const assetIds = new Set(assets.map((asset) => asset.id))
  return job.outputAssetIds.every((id) => assetIds.has(id))
}

export function replaceJobAfterCreate(
  entries: JobEntry[],
  created: JobEntry,
  replacedJobId?: string,
): JobEntry[] {
  return [
    created,
    ...entries.filter(
      (entry) => entry.job.id !== created.job.id && entry.job.id !== replacedJobId,
    ),
  ]
}

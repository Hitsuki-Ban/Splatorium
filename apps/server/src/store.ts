import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { Asset, Job, JobStatus } from '@splatorium/shared'

export interface SqliteStoreOptions {
  dataDir: string
}

export interface WorkbenchStore {
  saveAsset(asset: Asset): void
  getAsset(id: string): Asset | undefined
  listAssets(): Asset[]
  deleteAsset(id: string): boolean
  saveJob(job: Job): void
  getJob(id: string): Job | undefined
  listJobs(options?: JobListOptions): Job[]
  close(): void
}

export interface JobListOptions {
  statuses?: readonly JobStatus[]
  limit?: number
}

interface AssetRow {
  id: string
  kind: Asset['kind']
  name: string
  tags_json: string
  source_job_id: string | null
  files_json: string
  created_at: string
}

interface JobRow {
  id: string
  pipeline: Job['pipeline']
  status: Job['status']
  progress: number
  params_json: string | null
  status_text: string | null
  input_asset_ids_json: string
  output_asset_ids_json: string
  error: string | null
  metrics_json: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export function createSqliteStore(options: SqliteStoreOptions): WorkbenchStore {
  mkdirSync(options.dataDir, { recursive: true })
  const db = new Database(join(options.dataDir, 'workbench.sqlite'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      source_job_id TEXT,
      files_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      pipeline TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL,
      params_json TEXT,
      status_text TEXT,
      input_asset_ids_json TEXT NOT NULL,
      output_asset_ids_json TEXT NOT NULL,
      error TEXT,
      metrics_json TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
  `)

  const saveAssetStatement = db.prepare(`
    INSERT INTO assets (
      id, kind, name, tags_json, source_job_id, files_json, created_at
    ) VALUES (
      @id, @kind, @name, @tagsJson, @sourceJobId, @filesJson, @createdAt
    )
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      name = excluded.name,
      tags_json = excluded.tags_json,
      source_job_id = excluded.source_job_id,
      files_json = excluded.files_json,
      created_at = excluded.created_at
  `)
  const getAssetStatement = db.prepare<string, AssetRow>('SELECT * FROM assets WHERE id = ?')
  const listAssetsStatement = db.prepare<[], AssetRow>(
    'SELECT * FROM assets ORDER BY created_at ASC, id ASC',
  )
  const deleteAssetStatement = db.prepare<string>('DELETE FROM assets WHERE id = ?')
  const saveJobStatement = db.prepare(`
    INSERT INTO jobs (
      id, pipeline, status, progress, params_json, status_text,
      input_asset_ids_json, output_asset_ids_json, error, metrics_json,
      created_at, started_at, finished_at
    ) VALUES (
      @id, @pipeline, @status, @progress, @paramsJson, @statusText,
      @inputAssetIdsJson, @outputAssetIdsJson, @error, @metricsJson,
      @createdAt, @startedAt, @finishedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      pipeline = excluded.pipeline,
      status = excluded.status,
      progress = excluded.progress,
      params_json = excluded.params_json,
      status_text = excluded.status_text,
      input_asset_ids_json = excluded.input_asset_ids_json,
      output_asset_ids_json = excluded.output_asset_ids_json,
      error = excluded.error,
      metrics_json = excluded.metrics_json,
      created_at = excluded.created_at,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at
  `)
  const getJobStatement = db.prepare<string, JobRow>('SELECT * FROM jobs WHERE id = ?')

  return {
    saveAsset(asset) {
      saveAssetStatement.run({
        id: asset.id,
        kind: asset.kind,
        name: asset.name,
        tagsJson: JSON.stringify(asset.tags),
        sourceJobId: asset.sourceJobId ?? null,
        filesJson: JSON.stringify(asset.files),
        createdAt: asset.createdAt,
      })
    },
    getAsset(id) {
      const row = getAssetStatement.get(id)
      return row ? assetFromRow(row) : undefined
    },
    listAssets() {
      return listAssetsStatement.all().map(assetFromRow)
    },
    deleteAsset(id) {
      return deleteAssetStatement.run(id).changes > 0
    },
    saveJob(job) {
      saveJobStatement.run({
        id: job.id,
        pipeline: job.pipeline,
        status: job.status,
        progress: job.progress,
        paramsJson: job.params ? JSON.stringify(job.params) : null,
        statusText: job.statusText ?? null,
        inputAssetIdsJson: JSON.stringify(job.inputAssetIds),
        outputAssetIdsJson: JSON.stringify(job.outputAssetIds),
        error: job.error ?? null,
        metricsJson: job.metrics ? JSON.stringify(job.metrics) : null,
        createdAt: job.createdAt,
        startedAt: job.startedAt ?? null,
        finishedAt: job.finishedAt ?? null,
      })
    },
    getJob(id) {
      const row = getJobStatement.get(id)
      return row ? jobFromRow(row) : undefined
    },
    listJobs(options) {
      const statuses = options?.statuses
      const where = statuses && statuses.length > 0
        ? ` WHERE status IN (${statuses.map(() => '?').join(', ')})`
        : ''
      const limit = options?.limit === undefined ? '' : ' LIMIT ?'
      const statement = db.prepare<unknown[], JobRow>(
        `SELECT * FROM jobs${where} ORDER BY created_at DESC, id DESC${limit}`,
      )
      const parameters: Array<string | number> = [...(statuses ?? [])]
      if (options?.limit !== undefined) parameters.push(options.limit)
      return statement.all(...parameters).map(jobFromRow)
    },
    close() {
      db.close()
    },
  }
}

function assetFromRow(row: AssetRow): Asset {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    tags: JSON.parse(row.tags_json) as Asset['tags'],
    sourceJobId: row.source_job_id ?? undefined,
    files: JSON.parse(row.files_json) as Asset['files'],
    createdAt: row.created_at,
  }
}

function jobFromRow(row: JobRow): Job {
  return {
    id: row.id,
    pipeline: row.pipeline,
    status: row.status,
    progress: row.progress,
    params: row.params_json ? (JSON.parse(row.params_json) as Job['params']) : undefined,
    statusText: row.status_text ?? undefined,
    inputAssetIds: JSON.parse(row.input_asset_ids_json) as Job['inputAssetIds'],
    outputAssetIds: JSON.parse(row.output_asset_ids_json) as Job['outputAssetIds'],
    error: row.error ?? undefined,
    metrics: row.metrics_json ? (JSON.parse(row.metrics_json) as Job['metrics']) : undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
  }
}

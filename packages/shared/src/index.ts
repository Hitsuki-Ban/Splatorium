/** Splatorium の中核データモデル。Job は pipeline、Asset は kind で種別を表す。 */

/** 生成パイプライン種別。 */
export type PipelineId = 'image-to-splat'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface ImageToSplatJobParams {
  numGaussians: number
  seed: number
}

export interface JobMetrics {
  durationMs?: number
  outputBytes?: number
  comfyPromptId?: string
}

export interface Job {
  id: string
  pipeline: PipelineId
  status: JobStatus
  /** 0-100 */
  progress: number
  params?: ImageToSplatJobParams
  /** 現在の処理ステップの表示用テキスト */
  statusText?: string
  inputAssetIds: string[]
  outputAssetIds: string[]
  error?: string
  metrics?: JobMetrics
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

export type AssetKind = 'image' | 'splat' | 'mesh' | 'scene'

/** 倉庫で管理するアセット表示名の最大長。 */
export const ASSET_NAME_MAX_LENGTH = 255

/** 倉庫内のファイル参照。path は data/assets/<id>/ からの相対パス。 */
export interface AssetFileRef {
  path: string
  size: number
  mime?: string
}

export interface Asset {
  id: string
  kind: AssetKind
  name: string
  tags: string[]
  /** 生成元ジョブ。手動インポート品には無い。 */
  sourceJobId?: string
  files: {
    main: AssetFileRef
    thumbnail?: AssetFileRef
    /** 生成元の入力（例: ソース画像） */
    source?: AssetFileRef
  }
  createdAt: string
}

export interface AssetSceneReference {
  sceneId: string
  sceneName: string
  nodeCount: number
}

/** Server snapshot reconciliation and live mutation stream contract. */
export type WorkbenchEvent =
  | {
      type: 'sync'
      serverId: string
      seq: number
    }
  | {
      type: 'job.upserted'
      serverId: string
      seq: number
      occurredAt: string
      job: Job
    }
  | {
      type: 'asset.upserted'
      serverId: string
      seq: number
      occurredAt: string
      asset: Asset
    }
  | {
      type: 'asset.deleted'
      serverId: string
      seq: number
      occurredAt: string
      assetId: string
    }

export {
  SCENE_DOCUMENT_MAX_CHILDREN,
  SCENE_DOCUMENT_MAX_DEPTH,
  SCENE_DOCUMENT_MAX_NODES,
  SCENE_NODE_NAME_MAX_LENGTH,
  SCENE_SCHEMA_VERSION,
  canonicalizeSceneNodes,
  createSceneNodeId,
  hashSceneNodes,
  parseStoredSceneDocument,
  parseWritableSceneDocument,
  type ImportedSceneOrigin,
  type ParseSceneDocumentResult,
  type ParseStoredSceneDocumentOptions,
  type SceneDocument,
  type SceneGroupNode,
  type SceneModelNode,
  type SceneNode,
  type SceneNodeBase,
  type SceneTransform,
  type Vector3,
} from './scene-document.js'

export interface HealthResponse {
  status: 'ok'
  service: string
  time: string
}

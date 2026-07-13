import { ApiError } from '@/lib/api'
import { createSceneImportWrapper } from '@/lib/scene-import'
import {
  hashSceneNodes,
  type Asset,
  type SceneGroupNode,
  type SceneNode,
} from '@splatorium/shared'

const SOURCE_CHECK_CONCURRENCY = 4

export type ImportedSceneUpdateStatus =
  | 'current'
  | 'locallyModified'
  | 'updateAvailable'
  | 'updateAvailableAndModified'
  | 'sourceMissing'
  | 'checkFailed'

export type ImportedSceneUpdate =
  | { status: Exclude<ImportedSceneUpdateStatus, 'checkFailed'> }
  | { status: 'checkFailed'; error: string }

export type SceneSourceOutcome =
  | { kind: 'available'; sourceHash: string }
  | { kind: 'sourceMissing' }
  | { kind: 'checkFailed'; error: string }

export type LoadedImportedSceneSource =
  | { kind: 'available'; wrapper: SceneGroupNode }
  | { kind: 'sourceMissing' }
  | { kind: 'checkFailed'; error: string }

export type FetchSceneDocument = (sceneId: string) => Promise<unknown>

export function collectImportedSceneGroups(nodes: readonly SceneNode[]): SceneGroupNode[] {
  const groups: SceneGroupNode[] = []
  for (const node of nodes) {
    if (node.kind !== 'group') continue
    if (node.importedFrom) groups.push(node)
    groups.push(...collectImportedSceneGroups(node.children))
  }
  return groups
}

export async function loadImportedSceneSource(
  sceneId: string,
  assets: readonly Asset[],
  fetchSceneDocument: FetchSceneDocument,
  createNodeId: () => string,
): Promise<LoadedImportedSceneSource> {
  const sourceAsset = assets.find((asset) => asset.id === sceneId)
  if (!sourceAsset) return { kind: 'sourceMissing' }
  if (sourceAsset.kind !== 'scene') {
    return {
      kind: 'checkFailed',
      error: `取込元アセットは scene ではありません: ${sceneId}`,
    }
  }

  try {
    const storedDocument = await fetchSceneDocument(sceneId)
    const wrapper = await createSceneImportWrapper(
      sourceAsset,
      storedDocument,
      assets,
      createNodeId,
    )
    return { kind: 'available', wrapper }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { kind: 'sourceMissing' }
    }
    return {
      kind: 'checkFailed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function checkImportedSceneSources(
  groups: readonly SceneGroupNode[],
  assets: readonly Asset[],
  fetchSceneDocument: FetchSceneDocument,
  createNodeId: () => string,
): Promise<ReadonlyMap<string, SceneSourceOutcome>> {
  const sceneIds = [
    ...new Set(groups.flatMap((group) => (group.importedFrom ? [group.importedFrom.sceneId] : []))),
  ]
  const outcomes = new Map<string, SceneSourceOutcome>()
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < sceneIds.length) {
      const index = nextIndex
      nextIndex += 1
      const sceneId = sceneIds[index]
      const source = await loadImportedSceneSource(
        sceneId,
        assets,
        fetchSceneDocument,
        createNodeId,
      )
      outcomes.set(sceneId, sourceOutcome(source))
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(SOURCE_CHECK_CONCURRENCY, sceneIds.length) },
      () => worker(),
    ),
  )
  return outcomes
}

export async function deriveImportedSceneUpdates(
  nodes: readonly SceneNode[],
  sourceOutcomes: ReadonlyMap<string, SceneSourceOutcome>,
): Promise<ReadonlyMap<string, ImportedSceneUpdate>> {
  const updates = new Map<string, ImportedSceneUpdate>()
  await Promise.all(
    collectImportedSceneGroups(nodes).map(async (group) => {
      const origin = group.importedFrom
      if (!origin) return
      const source = sourceOutcomes.get(origin.sceneId)
      if (!source) return
      if (source.kind === 'sourceMissing') {
        updates.set(group.id, { status: 'sourceMissing' })
        return
      }
      if (source.kind === 'checkFailed') {
        updates.set(group.id, { status: 'checkFailed', error: source.error })
        return
      }

      const childrenHash = await hashSceneNodes(group.children)
      const sourceChanged = source.sourceHash !== origin.sourceHash
      const locallyModified = childrenHash !== origin.contentHash
      updates.set(group.id, {
        status: sourceChanged
          ? locallyModified
            ? 'updateAvailableAndModified'
            : 'updateAvailable'
          : locallyModified
            ? 'locallyModified'
            : 'current',
      })
    }),
  )
  return updates
}

function sourceOutcome(source: LoadedImportedSceneSource): SceneSourceOutcome {
  if (source.kind !== 'available') return source
  const sourceHash = source.wrapper.importedFrom?.sourceHash
  if (!sourceHash) {
    throw new Error('prepared source wrapper is missing importedFrom')
  }
  return { kind: 'available', sourceHash }
}

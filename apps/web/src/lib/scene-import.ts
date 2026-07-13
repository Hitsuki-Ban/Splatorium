import {
  hashSceneNodes,
  parseStoredSceneDocument,
  parseWritableSceneDocument,
  type Asset,
  type SceneGroupNode,
  type SceneNode,
} from '@splatorium/shared'

const IDENTITY_TRANSFORM = {
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
}

/**
 * 保存済み scene snapshot を自己完結した wrapper group へ変換する。
 * schemaVersion 1 は読み込み時に正規化する。
 */
export async function createSceneImportWrapper(
  sourceAsset: Asset,
  storedDocument: unknown,
  assets: readonly Asset[],
  createNodeId: () => string,
): Promise<SceneGroupNode> {
  if (sourceAsset.kind !== 'scene') {
    throw new Error(`取込元アセットは scene ではありません: ${sourceAsset.id}`)
  }

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const parsed = parseStoredSceneDocument(storedDocument, {
    resolveAssetName: (assetId) => assetsById.get(assetId)?.name,
    createNodeId,
  })
  if (!parsed.ok) throw new Error(`シーン文書が不正です: ${parsed.error}`)

  validateModelReferences(parsed.value.nodes, assetsById)
  const sourceIds = collectNodeIds(parsed.value.nodes)
  const generatedIds = new Set<string>()
  const createFreshNodeId = () => {
    const id = createNodeId()
    const key = id.toLowerCase()
    if (sourceIds.has(key)) throw new Error(`取込先 ID が source と重複しています: ${id}`)
    if (generatedIds.has(key)) throw new Error(`取込先 ID が重複しています: ${id}`)
    generatedIds.add(key)
    return id
  }
  const sourceHash = await hashSceneNodes(parsed.value.nodes)
  const children = cloneWithFreshIds(parsed.value.nodes, createFreshNodeId)
  const contentHash = await hashSceneNodes(children)
  const wrapper: SceneGroupNode = {
    id: createFreshNodeId(),
    kind: 'group',
    name: sourceAsset.name,
    visible: true,
    transform: {
      position: [...IDENTITY_TRANSFORM.position],
      rotation: [...IDENTITY_TRANSFORM.rotation],
      scale: [...IDENTITY_TRANSFORM.scale],
    },
    children,
    importedFrom: {
      sceneId: sourceAsset.id,
      sourceHash,
      contentHash,
    },
  }

  const validated = parseWritableSceneDocument({ schemaVersion: 2, nodes: [wrapper] })
  if (!validated.ok) throw new Error(`取込結果がシーン制約を超えています: ${validated.error}`)
  const validatedWrapper = validated.value.nodes[0]
  if (!validatedWrapper || validatedWrapper.kind !== 'group') {
    throw new Error('取込結果に wrapper group がありません')
  }
  return validatedWrapper
}

function collectNodeIds(nodes: readonly SceneNode[]): Set<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    ids.add(node.id.toLowerCase())
    if (node.kind === 'group') {
      for (const id of collectNodeIds(node.children)) ids.add(id)
    }
  }
  return ids
}

function validateModelReferences(
  nodes: readonly SceneNode[],
  assetsById: ReadonlyMap<string, Asset>,
): void {
  for (const node of nodes) {
    if (node.kind === 'group') {
      validateModelReferences(node.children, assetsById)
      continue
    }
    const asset = assetsById.get(node.assetId)
    if (!asset) throw new Error(`参照モデルが見つかりません: ${node.assetId}`)
    if (asset.kind !== 'splat' && asset.kind !== 'mesh') {
      throw new Error(`参照アセットはモデルではありません: ${node.assetId}`)
    }
  }
}

function cloneWithFreshIds(
  nodes: readonly SceneNode[],
  createNodeId: () => string,
): SceneNode[] {
  return nodes.map((node) => ({
    ...node,
    id: createNodeId(),
    transform: {
      position: [...node.transform.position],
      rotation: [...node.transform.rotation],
      scale: [...node.transform.scale],
    },
    ...(node.kind === 'group'
      ? {
          children: cloneWithFreshIds(node.children, createNodeId),
          ...(node.importedFrom ? { importedFrom: { ...node.importedFrom } } : {}),
        }
      : {}),
  }))
}

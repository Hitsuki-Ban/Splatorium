import { cloneSceneNodes, findSceneNode } from '@/lib/scene-tree'
import { matrixFromSceneTransform } from '@/lib/scene-transform'
import {
  createSceneNodeId,
  parseStoredSceneDocument,
  type Asset,
  type SceneDocument,
  type SceneModelNode,
  type SceneNode,
} from '@splatorium/shared'
import { Matrix4 } from 'three'

export interface FlattenedSceneModel {
  modelNode: SceneModelNode
  worldMatrix: Matrix4
  effectiveVisible: boolean
  ancestorIds: readonly string[]
}

export interface ThumbnailPlacement {
  nodeId: string
  assetId: string
  worldMatrix: Matrix4
}

export function toSceneDocument(nodes: readonly SceneNode[]): SceneDocument {
  return { schemaVersion: 2, nodes: cloneSceneNodes(nodes) }
}

/** 保存済み file の v1/v2 判別と v1 の一度限りの変換を行う。 */
export function readStoredSceneDocument(value: unknown, assets: Asset[]): SceneDocument {
  const names = new Map(assets.map((asset) => [asset.id, asset.name]))
  const result = parseStoredSceneDocument(value, {
    resolveAssetName: (assetId) => names.get(assetId),
    createNodeId: createSceneNodeId,
  })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

export function flattenSceneModels(nodes: readonly SceneNode[]): FlattenedSceneModel[] {
  const flattened: FlattenedSceneModel[] = []
  appendFlattenedModels(nodes, new Matrix4(), true, [], flattened)
  return flattened
}

export function getRenderableSceneModels(
  flattened: readonly FlattenedSceneModel[],
  availableAssetIds: ReadonlySet<string>,
): FlattenedSceneModel[] {
  return flattened.filter(
    ({ modelNode, effectiveVisible }) =>
      effectiveVisible && availableAssetIds.has(modelNode.assetId),
  )
}

export function getRenderableModelsForNode(
  renderable: readonly FlattenedSceneModel[],
  nodeId: string,
): FlattenedSceneModel[] {
  return renderable.filter(
    ({ modelNode, ancestorIds }) => modelNode.id === nodeId || ancestorIds.includes(nodeId),
  )
}

export function toThumbnailPlacements(
  flattened: readonly FlattenedSceneModel[],
  availableAssetIds: ReadonlySet<string>,
): ThumbnailPlacement[] {
  return getRenderableSceneModels(flattened, availableAssetIds).map(
    ({ modelNode, worldMatrix }) => ({
      nodeId: modelNode.id,
      assetId: modelNode.assetId,
      worldMatrix: worldMatrix.clone(),
    }),
  )
}

export function hasInvertibleSceneNodeParent(
  nodes: readonly SceneNode[],
  nodeId: string,
): boolean {
  const location = findSceneNode(nodes, nodeId)
  if (!location) return false
  const parentWorld = location.ancestors.reduce(
    (world, ancestor) => world.multiply(matrixFromSceneTransform(ancestor.transform)),
    new Matrix4(),
  )
  const determinant = parentWorld.determinant()
  return Number.isFinite(determinant) && determinant !== 0
}

function appendFlattenedModels(
  nodes: readonly SceneNode[],
  parentWorld: Matrix4,
  parentVisible: boolean,
  ancestorIds: readonly string[],
  flattened: FlattenedSceneModel[],
): void {
  for (const node of nodes) {
    const worldMatrix = parentWorld.clone().multiply(matrixFromSceneTransform(node.transform))
    const effectiveVisible = parentVisible && node.visible
    if (node.kind === 'model') {
      flattened.push({
        modelNode: node,
        worldMatrix,
        effectiveVisible,
        ancestorIds: [...ancestorIds],
      })
      continue
    }
    appendFlattenedModels(
      node.children,
      worldMatrix,
      effectiveVisible,
      [...ancestorIds, node.id],
      flattened,
    )
  }
}

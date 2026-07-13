import {
  containsSceneNode,
  findSceneNode,
  moveSceneNode,
  type SceneTreeError,
} from '@/lib/scene-tree'
import type { SceneNode } from '@splatorium/shared'

/** コンテンツブラウザのアセットをツリー/ビューポートへ運ぶ DataTransfer type */
export const ASSET_DRAG_MIME = 'application/x-splatorium-asset'
/** ツリー内ノードの並び替え/reparent 用 DataTransfer type */
export const NODE_DRAG_MIME = 'application/x-splatorium-node'

export interface AssetDragPayload {
  assetId: string
}

export function readAssetDragPayload(data: string): AssetDragPayload | null {
  try {
    const parsed = JSON.parse(data) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'assetId' in parsed &&
      typeof (parsed as { assetId: unknown }).assetId === 'string'
    ) {
      return { assetId: (parsed as { assetId: string }).assetId }
    }
  } catch {
    // 不正ペイロードは無視
  }
  return null
}

export type TreeDropMode = 'before' | 'after' | 'into'

export interface TreeDropPlan {
  targetParentId: string | null
  /** moveSceneNode の契約どおり「移動元を除去した後」の children に対する index */
  targetIndex: number
}

/**
 * D&D preview でも store と同じ reparent 制約を評価する。
 * moveSceneNode は純関数なので、shear / singular parent を drop 前に安全に検出できる。
 */
export function validateTreeDrop(
  nodes: readonly SceneNode[],
  draggedId: string,
  plan: TreeDropPlan,
): SceneTreeError | null {
  const result = moveSceneNode(nodes, draggedId, plan.targetParentId, plan.targetIndex)
  return result.ok ? null : result.error
}

/**
 * ノードドラッグのドロップ先を moveSceneNode の引数へ変換する。
 * 自身/子孫への drop など不正な組合せは null（UI は禁止表示、store 側でも拒否される）
 */
export function planNodeDrop(
  nodes: readonly SceneNode[],
  draggedId: string,
  targetNodeId: string,
  mode: TreeDropMode,
): TreeDropPlan | null {
  if (draggedId === targetNodeId) return null
  const dragged = findSceneNode(nodes, draggedId)
  const target = findSceneNode(nodes, targetNodeId)
  if (!dragged || !target) return null
  if (containsSceneNode(dragged.node, targetNodeId)) return null

  if (mode === 'into') {
    if (target.node.kind !== 'group') return null
    const length = target.node.children.length
    return {
      targetParentId: targetNodeId,
      targetIndex: dragged.parentId === targetNodeId ? length - 1 : length,
    }
  }

  const targetParentId = target.parentId
  let index = target.index + (mode === 'after' ? 1 : 0)
  // 同一親内の後方への移動は、除去による前詰めぶんだけ index が繰り上がる
  if (dragged.parentId === targetParentId && dragged.index < target.index) {
    index -= 1
  }
  return { targetParentId, targetIndex: index }
}

/** ルート末尾へのドロップ（ツリーの余白へ落とした時） */
export function planRootDrop(
  nodes: readonly SceneNode[],
  draggedId: string,
): TreeDropPlan | null {
  const dragged = findSceneNode(nodes, draggedId)
  if (!dragged) return null
  return {
    targetParentId: null,
    targetIndex: dragged.parentId === null ? nodes.length - 1 : nodes.length,
  }
}

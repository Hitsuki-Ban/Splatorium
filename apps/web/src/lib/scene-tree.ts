import {
  parseWritableSceneDocument,
  type SceneGroupNode,
  type SceneModelNode,
  type SceneNode,
  type SceneTransform,
} from '@splatorium/shared'
import { matrixFromSceneTransform } from '@/lib/scene-transform'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

export const SCENE_REPARENT_SHEAR_TOLERANCE = 1e-6

export type SceneTreeErrorCode =
  | 'node-not-found'
  | 'parent-not-found'
  | 'parent-not-group'
  | 'invalid-index'
  | 'cycle'
  | 'singular-parent'
  | 'decompose-failed'
  | 'shear'
  | 'invalid-asset-kind'
  | 'stale-destination'
  | 'not-imported-scene'
  | 'node-not-model'
  | 'same-asset'
  | 'document-invalid'

export type ModelReferenceScope = 'scene' | 'group' | 'node'

export interface SceneTreeError {
  code: SceneTreeErrorCode
  message: string
}

export type SceneTreeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SceneTreeError }

export interface SceneNodeLocation {
  node: SceneNode
  parentId: string | null
  index: number
  ancestors: readonly SceneGroupNode[]
}

export interface SceneTreeMutation {
  nodes: SceneNode[]
}

export function findSceneNode(
  nodes: readonly SceneNode[],
  nodeId: string,
): SceneNodeLocation | undefined {
  return findInChildren(nodes, nodeId, [])
}

export function getSceneChildren(
  nodes: readonly SceneNode[],
  parentId: string | null,
): SceneTreeResult<readonly SceneNode[]> {
  if (parentId === null) return success(nodes)
  const location = findSceneNode(nodes, parentId)
  if (!location) return failure('parent-not-found', `parent node not found: ${parentId}`)
  if (location.node.kind !== 'group') {
    return failure('parent-not-group', `parent node is not a group: ${parentId}`)
  }
  return success(location.node.children)
}

export function appendSceneNode(
  nodes: readonly SceneNode[],
  parentId: string | null,
  node: SceneNode,
): SceneTreeResult<SceneTreeMutation> {
  const children = getSceneChildren(nodes, parentId)
  if (!children.ok) return children
  return insertAndValidate(nodes, parentId, children.value.length, node)
}

export function updateSceneNode(
  nodes: readonly SceneNode[],
  nodeId: string,
  update: (node: SceneNode) => SceneNode,
): SceneTreeResult<SceneTreeMutation> {
  const location = findSceneNode(nodes, nodeId)
  if (!location) return failure('node-not-found', `scene node not found: ${nodeId}`)
  const replacement = update(cloneSceneNodes([location.node])[0])
  if (replacement.id !== nodeId || replacement.kind !== location.node.kind) {
    return failure('document-invalid', 'node update must preserve id and kind')
  }
  if (sceneNodeEqual(location.node, replacement)) return success({ nodes: [...nodes] })

  const next = replaceNode(nodes, nodeId, replacement)
  if (!next) return failure('node-not-found', `scene node not found: ${nodeId}`)
  return validateMutation(next)
}

export function redirectSceneModelAsset(
  nodes: readonly SceneNode[],
  nodeId: string,
  targetAssetId: string,
  scope: ModelReferenceScope,
): SceneTreeResult<SceneTreeMutation> {
  const source = findSceneNode(nodes, nodeId)
  if (!source) return failure('node-not-found', `scene node not found: ${nodeId}`)
  if (source.node.kind !== 'model') {
    return failure('node-not-model', `scene node is not a model: ${nodeId}`)
  }
  const sourceAssetId = source.node.assetId
  if (sourceAssetId === targetAssetId) {
    return failure('same-asset', `replacement asset is unchanged: ${targetAssetId}`)
  }
  const groupId = source.parentId

  const rewrite = (
    children: readonly SceneNode[],
    insideGroup: boolean,
  ): { nodes: SceneNode[]; changed: boolean } => {
    let changed = false
    const next = children.map((node): SceneNode => {
      if (node.kind === 'group') {
        const rewritten = rewrite(
          node.children,
          insideGroup || scope !== 'group' || groupId === null || node.id === groupId,
        )
        if (!rewritten.changed) return node
        changed = true
        return { ...node, children: rewritten.nodes }
      }
      const inScope =
        scope === 'scene' ||
        (scope === 'node' && node.id === nodeId) ||
        (scope === 'group' && insideGroup)
      if (!inScope || node.assetId !== sourceAssetId || node.assetId === targetAssetId) return node
      changed = true
      return { ...node, assetId: targetAssetId } satisfies SceneModelNode
    })
    return { nodes: next, changed }
  }

  const rewritten = rewrite(nodes, scope !== 'group' || groupId === null)
  if (!rewritten.changed) return success({ nodes: [...nodes] })
  return validateMutation(rewritten.nodes)
}

export function deleteSceneNode(
  nodes: readonly SceneNode[],
  nodeId: string,
): SceneTreeResult<SceneTreeMutation & { removed: SceneNode }> {
  const removed = removeNode(nodes, nodeId)
  if (!removed) return failure('node-not-found', `scene node not found: ${nodeId}`)
  const validated = validateMutation(removed.nodes)
  if (!validated.ok) return validated
  return success({ nodes: validated.value.nodes, removed: removed.node })
}

/** targetIndex は移動元を除去した後の target children に対する最終 index。 */
export function moveSceneNode(
  nodes: readonly SceneNode[],
  nodeId: string,
  targetParentId: string | null,
  targetIndex: number,
): SceneTreeResult<SceneTreeMutation> {
  const source = findSceneNode(nodes, nodeId)
  if (!source) return failure('node-not-found', `scene node not found: ${nodeId}`)

  let targetParent: SceneNodeLocation | undefined
  if (targetParentId !== null) {
    targetParent = findSceneNode(nodes, targetParentId)
    if (!targetParent) {
      return failure('parent-not-found', `parent node not found: ${targetParentId}`)
    }
    if (targetParent.node.kind !== 'group') {
      return failure('parent-not-group', `parent node is not a group: ${targetParentId}`)
    }
    if (containsSceneNode(source.node, targetParentId)) {
      return failure('cycle', 'cannot move a node into itself or its descendant')
    }
  }

  const removed = removeNode(nodes, nodeId)
  if (!removed) return failure('node-not-found', `scene node not found: ${nodeId}`)
  const targetChildren = getSceneChildren(removed.nodes, targetParentId)
  if (!targetChildren.ok) return targetChildren
  if (
    !Number.isSafeInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex > targetChildren.value.length
  ) {
    return failure('invalid-index', `target index is out of range: ${targetIndex}`)
  }

  if (source.parentId === targetParentId && source.index === targetIndex) {
    return success({ nodes: [...nodes] })
  }

  let movedNode = source.node
  if (source.parentId !== targetParentId) {
    const oldWorld = worldMatrixForLocation(source)
    const parentWorld = targetParent ? worldMatrixForLocation(targetParent) : new Matrix4()
    const determinant = parentWorld.determinant()
    if (!Number.isFinite(determinant) || determinant === 0) {
      return failure('singular-parent', 'target parent world transform is not invertible')
    }
    const localMatrix = parentWorld.clone().invert().multiply(oldWorld)
    const transform = decomposeSceneTransform(localMatrix)
    if (!transform.ok) return transform
    movedNode = { ...source.node, transform: transform.value }
  }

  const inserted = insertNode(removed.nodes, targetParentId, targetIndex, movedNode)
  if (!inserted) {
    return failure('parent-not-found', `parent node not found: ${targetParentId}`)
  }
  return validateMutation(inserted)
}

export function nextSceneGroupName(siblings: readonly SceneNode[]): string {
  const names = new Set(siblings.map((node) => node.name))
  let sequence = 1
  while (names.has(`グループ ${sequence}`)) sequence += 1
  return `グループ ${sequence}`
}

export function containsSceneNode(node: SceneNode, nodeId: string): boolean {
  if (node.id === nodeId) return true
  return node.kind === 'group' && node.children.some((child) => containsSceneNode(child, nodeId))
}

export function countSceneNodes(nodes: readonly SceneNode[]): number {
  let count = 0
  for (const node of nodes) {
    count += 1
    if (node.kind === 'group') count += countSceneNodes(node.children)
  }
  return count
}

export function cloneSceneNodes(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.map((node) => ({
    ...node,
    transform: cloneTransform(node.transform),
    ...(node.kind === 'group'
      ? {
          children: cloneSceneNodes(node.children),
          ...(node.importedFrom ? { importedFrom: { ...node.importedFrom } } : {}),
        }
      : {}),
  }))
}

export function sceneNodesEqual(a: readonly SceneNode[], b: readonly SceneNode[]): boolean {
  return a.length === b.length && a.every((node, index) => sceneNodeEqual(node, b[index]))
}

export function sceneTransformEqual(a: SceneTransform, b: SceneTransform): boolean {
  return (
    vectorEqual(a.position, b.position) &&
    vectorEqual(a.rotation, b.rotation) &&
    vectorEqual(a.scale, b.scale)
  )
}

function findInChildren(
  nodes: readonly SceneNode[],
  nodeId: string,
  ancestors: readonly SceneGroupNode[],
): SceneNodeLocation | undefined {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node.id === nodeId) {
      return {
        node,
        parentId: ancestors.at(-1)?.id ?? null,
        index,
        ancestors,
      }
    }
    if (node.kind === 'group') {
      const found = findInChildren(node.children, nodeId, [...ancestors, node])
      if (found) return found
    }
  }
  return undefined
}

function insertAndValidate(
  nodes: readonly SceneNode[],
  parentId: string | null,
  index: number,
  node: SceneNode,
): SceneTreeResult<SceneTreeMutation> {
  const inserted = insertNode(nodes, parentId, index, node)
  if (!inserted) return failure('parent-not-found', `parent node not found: ${parentId}`)
  return validateMutation(inserted)
}

function insertNode(
  nodes: readonly SceneNode[],
  parentId: string | null,
  index: number,
  node: SceneNode,
): SceneNode[] | undefined {
  if (parentId === null) {
    const next = [...nodes]
    next.splice(index, 0, node)
    return next
  }

  for (let childIndex = 0; childIndex < nodes.length; childIndex += 1) {
    const candidate = nodes[childIndex]
    if (candidate.id === parentId) {
      if (candidate.kind !== 'group') return undefined
      const children = [...candidate.children]
      children.splice(index, 0, node)
      const next = [...nodes]
      next[childIndex] = { ...candidate, children }
      return next
    }
    if (candidate.kind === 'group') {
      const children = insertNode(candidate.children, parentId, index, node)
      if (children) {
        const next = [...nodes]
        next[childIndex] = { ...candidate, children }
        return next
      }
    }
  }
  return undefined
}

function replaceNode(
  nodes: readonly SceneNode[],
  nodeId: string,
  replacement: SceneNode,
): SceneNode[] | undefined {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node.id === nodeId) {
      const next = [...nodes]
      next[index] = replacement
      return next
    }
    if (node.kind === 'group') {
      const children = replaceNode(node.children, nodeId, replacement)
      if (children) {
        const next = [...nodes]
        next[index] = { ...node, children }
        return next
      }
    }
  }
  return undefined
}

function removeNode(
  nodes: readonly SceneNode[],
  nodeId: string,
): { nodes: SceneNode[]; node: SceneNode } | undefined {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node.id === nodeId) {
      return { nodes: [...nodes.slice(0, index), ...nodes.slice(index + 1)], node }
    }
    if (node.kind === 'group') {
      const removed = removeNode(node.children, nodeId)
      if (removed) {
        const next = [...nodes]
        next[index] = { ...node, children: removed.nodes }
        return { nodes: next, node: removed.node }
      }
    }
  }
  return undefined
}

function validateMutation(nodes: SceneNode[]): SceneTreeResult<SceneTreeMutation> {
  const parsed = parseWritableSceneDocument({ schemaVersion: 2, nodes })
  if (!parsed.ok) return failure('document-invalid', parsed.error)
  return success({ nodes })
}

function worldMatrixForLocation(location: SceneNodeLocation): Matrix4 {
  const world = new Matrix4()
  for (const ancestor of location.ancestors) {
    world.multiply(matrixFromSceneTransform(ancestor.transform))
  }
  return world.multiply(matrixFromSceneTransform(location.node.transform))
}

function decomposeSceneTransform(matrix: Matrix4): SceneTreeResult<SceneTransform> {
  const elements = matrix.elements
  const axes: [Vector3, Vector3, Vector3] = [
    new Vector3(elements[0], elements[1], elements[2]),
    new Vector3(elements[4], elements[5], elements[6]),
    new Vector3(elements[8], elements[9], elements[10]),
  ]
  const scale: [number, number, number] = axes.map((axis) => axis.length()) as [
    number,
    number,
    number,
  ]
  const nonZeroAxes = scale.flatMap((value, index) => (value === 0 ? [] : [index]))

  if (nonZeroAxes.length === 3 && matrix.determinant() < 0) scale[0] = -scale[0]
  for (const index of nonZeroAxes) axes[index].divideScalar(scale[index])

  if (nonZeroAxes.length === 2) {
    const missing = [0, 1, 2].find((index) => !nonZeroAxes.includes(index))!
    const completed = completeMissingAxis(axes, missing)
    if (!completed) {
      return failure('shear', 'reparent matrix has parallel transform axes')
    }
    axes[missing] = completed
  } else if (nonZeroAxes.length === 1) {
    completeSingleAxisBasis(axes, nonZeroAxes[0])
  } else if (nonZeroAxes.length === 0) {
    axes[0].set(1, 0, 0)
    axes[1].set(0, 1, 0)
    axes[2].set(0, 0, 1)
  }

  const position = new Vector3().setFromMatrixPosition(matrix)
  const quaternion = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(axes[0], axes[1], axes[2]),
  )
  const rotation = new Euler().setFromQuaternion(quaternion, 'XYZ')
  const transform: SceneTransform = {
    position: position.toArray(),
    rotation: [rotation.x, rotation.y, rotation.z],
    scale,
  }
  const values = [...transform.position, ...transform.rotation, ...transform.scale]
  if (!values.every(Number.isFinite)) {
    return failure('decompose-failed', 'local transform could not be decomposed into finite TRS')
  }

  const recomposed = matrixFromSceneTransform(transform)
  const error = Math.max(
    ...matrix.elements.map((value, index) => Math.abs(value - recomposed.elements[index])),
  )
  if (!Number.isFinite(error) || error > SCENE_REPARENT_SHEAR_TOLERANCE) {
    return failure(
      'shear',
      `reparent would introduce unsupported shear (matrix error ${String(error)})`,
    )
  }
  return success(transform)
}

function completeMissingAxis(
  axes: [Vector3, Vector3, Vector3],
  missing: number,
): Vector3 | undefined {
  const completed =
    missing === 0
      ? new Vector3().crossVectors(axes[1], axes[2])
      : missing === 1
        ? new Vector3().crossVectors(axes[2], axes[0])
        : new Vector3().crossVectors(axes[0], axes[1])
  return completed.lengthSq() === 0 ? undefined : completed.normalize()
}

function completeSingleAxisBasis(axes: [Vector3, Vector3, Vector3], known: number): void {
  if (known === 0) {
    axes[1] = perpendicularUnitVector(axes[0])
    axes[2] = new Vector3().crossVectors(axes[0], axes[1]).normalize()
    return
  }
  if (known === 1) {
    axes[2] = perpendicularUnitVector(axes[1])
    axes[0] = new Vector3().crossVectors(axes[1], axes[2]).normalize()
    return
  }
  axes[0] = perpendicularUnitVector(axes[2])
  axes[1] = new Vector3().crossVectors(axes[2], axes[0]).normalize()
}

function perpendicularUnitVector(axis: Vector3): Vector3 {
  const absolute = [Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z)]
  const smallest = absolute.indexOf(Math.min(...absolute))
  const reference =
    smallest === 0
      ? new Vector3(1, 0, 0)
      : smallest === 1
        ? new Vector3(0, 1, 0)
        : new Vector3(0, 0, 1)
  return reference.addScaledVector(axis, -reference.dot(axis)).normalize()
}

function cloneTransform(transform: SceneTransform): SceneTransform {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  }
}

function sceneNodeEqual(a: SceneNode, b: SceneNode): boolean {
  if (
    a.id !== b.id ||
    a.kind !== b.kind ||
    a.name !== b.name ||
    a.visible !== b.visible ||
    !sceneTransformEqual(a.transform, b.transform)
  ) {
    return false
  }
  if (a.kind === 'model' && b.kind === 'model') return a.assetId === b.assetId
  if (a.kind !== 'group' || b.kind !== 'group') return false
  return originEqual(a.importedFrom, b.importedFrom) && sceneNodesEqual(a.children, b.children)
}

function originEqual(
  a: SceneGroupNode['importedFrom'],
  b: SceneGroupNode['importedFrom'],
): boolean {
  return (
    a === b ||
    (a !== undefined &&
      b !== undefined &&
      a.sceneId === b.sceneId &&
      a.sourceHash === b.sourceHash &&
      a.contentHash === b.contentHash)
  )
}

function vectorEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function success<T>(value: T): SceneTreeResult<T> {
  return { ok: true, value }
}

function failure(code: SceneTreeErrorCode, message: string): { ok: false; error: SceneTreeError } {
  return { ok: false, error: { code, message } }
}

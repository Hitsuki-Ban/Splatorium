import type { SceneGroupNode, SceneModelNode, SceneNode, SceneTransform } from '@splatorium/shared'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  appendSceneNode,
  cloneSceneNodes,
  countSceneNodes,
  deleteSceneNode,
  findSceneNode,
  moveSceneNode,
  nextSceneGroupName,
  redirectSceneModelAsset,
  sceneNodesEqual,
  updateSceneNode,
} from './scene-tree'

const IDENTITY: SceneTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
}

describe('scene tree helpers', () => {
  it('finds nested nodes with parent and ancestor context', () => {
    const child = model(3)
    const inner = group(2, [child])
    const outer = group(1, [inner])

    const location = findSceneNode([outer], child.id)

    expect(location).toMatchObject({ node: child, parentId: inner.id, index: 0 })
    expect(location?.ancestors.map((node) => node.id)).toEqual([outer.id, inner.id])
  })

  it('appends, updates, and deletes a nested subtree immutably', () => {
    const root = group(1, [])
    const appended = appendSceneNode([root], root.id, model(2))
    expect(appended.ok).toBe(true)
    if (!appended.ok) return
    expect(root.children).toEqual([])

    const renamed = updateSceneNode(appended.value.nodes, uuid(2), (node) => ({
      ...node,
      name: 'Renamed',
    }))
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(findSceneNode(renamed.value.nodes, uuid(2))?.node.name).toBe('Renamed')

    const deleted = deleteSceneNode(renamed.value.nodes, root.id)
    expect(deleted.ok).toBe(true)
    if (deleted.ok) {
      expect(deleted.value.nodes).toEqual([])
      expect(countSceneNodes([deleted.value.removed])).toBe(2)
    }
  })

  it('does not let an updater mutate the source tree in place', () => {
    const source = model(1)
    const updated = updateSceneNode([source], source.id, (node) => {
      node.name = 'Mutated callback value'
      return node
    })

    expect(updated.ok).toBe(true)
    expect(source.name).toBe('Model 1')
    if (updated.ok) expect(updated.value.nodes[0].name).toBe('Mutated callback value')
  })

  it('rejects duplicate IDs and child limit overflow before mutating', () => {
    const duplicate = appendSceneNode([model(1)], null, model(1))
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.error.code).toBe('document-invalid')

    const full = group(
      10_001,
      Array.from({ length: 2_000 }, (_, index) => model(index + 1)),
    )
    const overflow = appendSceneNode([full], full.id, model(10_002))
    expect(overflow.ok).toBe(false)
    if (!overflow.ok) expect(overflow.error.message).toContain('at most 2000')
  })

  it('reorders within one parent without changing the local transform', () => {
    const first = model(1, { position: [1, 2, 3] })
    const second = model(2)
    const third = model(3)

    const result = moveSceneNode([first, second, third], first.id, null, 2)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.nodes.map((node) => node.id)).toEqual([second.id, third.id, first.id])
      expect(result.value.nodes[2].transform).toEqual(first.transform)
    }
  })

  it('preserves world position when reparenting', () => {
    const child = model(3, { position: [2, 0, 0] })
    const source = group(1, [child], { position: [10, 0, 0] })
    const target = group(2, [], { position: [-5, 0, 0] })

    const result = moveSceneNode([source, target], child.id, target.id, 0)

    expect(result.ok).toBe(true)
    if (result.ok) {
      const moved = findSceneNode(result.value.nodes, child.id)?.node
      expect(moved?.transform.position[0]).toBeCloseTo(17)
      expect(findSceneNode(result.value.nodes, source.id)?.node).toMatchObject({ children: [] })
    }
  })

  it('preserves the full world matrix across decomposable rotated parents', () => {
    const child = model(3, {
      position: [1, 2, -1],
      rotation: [-0.3, 0.5, 0.1],
      scale: [1.2, 0.8, 1.1],
    })
    const source = group(1, [child], {
      position: [3, -2, 1],
      rotation: [0.2, -0.4, 0.6],
      scale: [2, 2, 2],
    })
    const target = group(2, [], {
      position: [-4, 1, 2],
      rotation: [-0.1, 0.3, -0.2],
      scale: [0.5, 0.5, 0.5],
    })
    const oldWorld = matrix(source.transform).multiply(matrix(child.transform))

    const result = moveSceneNode([source, target], child.id, target.id, 0)

    expect(result.ok).toBe(true)
    if (result.ok) {
      const moved = findSceneNode(result.value.nodes, child.id)!.node
      const newWorld = matrix(target.transform).multiply(matrix(moved.transform))
      expect(matrixError(oldWorld, newWorld)).toBeLessThanOrEqual(1e-6)
    }
  })

  it('reparents a zero-scale source when its world matrix is still representable', () => {
    const source = model(1, { position: [5, 0, 0], scale: [0, 2, 3] })
    const target = group(2, [], { position: [2, 0, 0] })
    const oldWorld = matrix(source.transform)

    const result = moveSceneNode([source, target], source.id, target.id, 0)

    expect(result.ok).toBe(true)
    if (result.ok) {
      const moved = findSceneNode(result.value.nodes, source.id)!.node
      expect(moved.transform.position).toEqual([3, 0, 0])
      expect(moved.transform.scale).toEqual([0, 2, 3])
      const newWorld = matrix(target.transform).multiply(matrix(moved.transform))
      expect(matrixError(oldWorld, newWorld)).toBeLessThanOrEqual(1e-6)
    }
  })

  it('preserves a negative-scale source across decomposable parents', () => {
    const child = model(3, {
      position: [1, -2, 3],
      rotation: [0.2, -0.3, 0.4],
      scale: [-1.5, 0.75, 2],
    })
    const source = group(1, [child], { position: [4, 0, 0], scale: [2, 2, 2] })
    const target = group(2, [], {
      position: [-3, 1, 0],
      rotation: [0.1, 0.2, -0.2],
      scale: [0.5, 0.5, 0.5],
    })
    const oldWorld = matrix(source.transform).multiply(matrix(child.transform))

    const result = moveSceneNode([source, target], child.id, target.id, 0)

    expect(result.ok).toBe(true)
    if (result.ok) {
      const moved = findSceneNode(result.value.nodes, child.id)!.node
      const newWorld = matrix(target.transform).multiply(matrix(moved.transform))
      expect(matrixError(oldWorld, newWorld)).toBeLessThanOrEqual(1e-6)
    }
  })

  it('rejects self and descendant targets without changing the tree', () => {
    const child = group(2, [])
    const root = group(1, [child])

    for (const targetId of [root.id, child.id]) {
      const result = moveSceneNode([root], root.id, targetId, 0)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('cycle')
    }
  })

  it('rejects singular target parents and shear-producing reparent', () => {
    const source = group(
      1,
      [model(3)],
      { rotation: [0, 0, Math.PI / 4], scale: [2, 1, 1] },
    )
    const singular = group(2, [], { scale: [0, 1, 1] })
    const singularResult = moveSceneNode([source, singular], uuid(3), singular.id, 0)
    expect(singularResult.ok).toBe(false)
    if (!singularResult.ok) expect(singularResult.error.code).toBe('singular-parent')

    const target = group(
      4,
      [],
      { rotation: [0, 0, Math.PI / 6], scale: [3, 1, 1] },
    )
    const shearResult = moveSceneNode([source, target], uuid(3), target.id, 0)
    expect(shearResult.ok).toBe(false)
    if (!shearResult.ok) expect(shearResult.error.code).toBe('shear')
  })

  it('redirects exactly 5, 3, and 1 matching references for scene, group, and node scopes', () => {
    const rootModel = model(1)
    rootModel.assetId = 'old-asset'
    const direct = model(2)
    direct.assetId = 'old-asset'
    const nested = model(3)
    nested.assetId = 'old-asset'
    const importedModel = model(4)
    importedModel.assetId = 'old-asset'
    const imported = group(5, [importedModel])
    imported.importedFrom = {
      sceneId: 'source-scene',
      sourceHash: 'a'.repeat(64),
      contentHash: 'b'.repeat(64),
    }
    const outer = group(6, [direct, group(7, [nested]), imported, model(8)])
    const sibling = model(9)
    sibling.assetId = 'old-asset'
    const nodes = [rootModel, outer, group(10, [sibling])]

    const scene = redirectSceneModelAsset(nodes, direct.id, 'new-asset', 'scene')
    const sameGroup = redirectSceneModelAsset(nodes, direct.id, 'new-asset', 'group')
    const single = redirectSceneModelAsset(nodes, direct.id, 'new-asset', 'node')

    expect(scene.ok && countAssetReferences(scene.value.nodes, 'new-asset')).toBe(5)
    expect(sameGroup.ok && countAssetReferences(sameGroup.value.nodes, 'new-asset')).toBe(3)
    expect(single.ok && countAssetReferences(single.value.nodes, 'new-asset')).toBe(1)
    expect(nodes).toEqual([rootModel, outer, group(10, [sibling])])
  })

  it('uses the nearest parent group as the group boundary and scene root as a pseudo-group', () => {
    const nestedTarget = model(20)
    nestedTarget.assetId = 'old-asset'
    const outerPeer = model(21)
    outerPeer.assetId = 'old-asset'
    const outside = model(22)
    outside.assetId = 'old-asset'
    const nestedGroup = group(23, [nestedTarget])
    const nodes = [group(24, [outerPeer, nestedGroup]), outside]

    const nearest = redirectSceneModelAsset(nodes, nestedTarget.id, 'new-asset', 'group')
    expect(nearest.ok && countAssetReferences(nearest.value.nodes, 'new-asset')).toBe(1)
    if (nearest.ok) {
      expect((findSceneNode(nearest.value.nodes, outerPeer.id)?.node as SceneModelNode).assetId)
        .toBe('old-asset')
    }

    const rootGroup = redirectSceneModelAsset(nodes, outside.id, 'new-asset', 'group')
    const wholeScene = redirectSceneModelAsset(nodes, outside.id, 'new-asset', 'scene')
    expect(rootGroup.ok && countAssetReferences(rootGroup.value.nodes, 'new-asset')).toBe(3)
    expect(wholeScene.ok && countAssetReferences(wholeScene.value.nodes, 'new-asset')).toBe(3)
  })

  it('rejects an unchanged target and a non-model source without changing the tree', () => {
    const source = model(30)
    const sourceGroup = group(31, [source])

    const unchanged = redirectSceneModelAsset([sourceGroup], source.id, source.assetId, 'scene')
    const nonModel = redirectSceneModelAsset([sourceGroup], sourceGroup.id, 'new-asset', 'node')

    expect(unchanged.ok).toBe(false)
    if (!unchanged.ok) expect(unchanged.error.code).toBe('same-asset')
    expect(nonModel.ok).toBe(false)
    if (!nonModel.ok) expect(nonModel.error.code).toBe('node-not-model')
    expect(sourceGroup.children[0]).toEqual(source)
  })

  it('clones the complete tree and compares semantic store state', () => {
    const imported = group(1, [model(2)])
    imported.importedFrom = {
      sceneId: 'scene-source',
      sourceHash: 'a'.repeat(64),
      contentHash: 'b'.repeat(64),
    }
    const nodes = [imported]
    const cloned = cloneSceneNodes(nodes)

    expect(cloned).toEqual(nodes)
    expect(cloned).not.toBe(nodes)
    expect((cloned[0] as SceneGroupNode).children).not.toBe(nodes[0].children)
    expect(sceneNodesEqual(nodes, cloned)).toBe(true)
    ;(cloned[0] as SceneGroupNode).children[0].visible = false
    expect(sceneNodesEqual(nodes, cloned)).toBe(false)

    const originChanged = cloneSceneNodes(nodes)
    ;(originChanged[0] as SceneGroupNode).importedFrom!.contentHash = 'c'.repeat(64)
    expect(sceneNodesEqual(nodes, originChanged)).toBe(false)
  })

  it('generates a sibling-unique default group name', () => {
    expect(nextSceneGroupName([])).toBe('グループ 1')
    expect(
      nextSceneGroupName([
        model(1, undefined, 'グループ 1'),
        model(2, undefined, 'グループ 2'),
        model(3, undefined, 'Other'),
      ]),
    ).toBe('グループ 3')
  })
})

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

function model(
  sequence: number,
  transform?: Partial<SceneTransform>,
  name = `Model ${sequence}`,
): SceneModelNode {
  return {
    id: uuid(sequence),
    kind: 'model',
    name,
    visible: true,
    transform: mergeTransform(transform),
    assetId: `asset-${sequence}`,
  }
}

function group(
  sequence: number,
  children: SceneNode[],
  transform?: Partial<SceneTransform>,
): SceneGroupNode {
  return {
    id: uuid(sequence),
    kind: 'group',
    name: `Group ${sequence}`,
    visible: true,
    transform: mergeTransform(transform),
    children,
  }
}

function countAssetReferences(nodes: readonly SceneNode[], assetId: string): number {
  return nodes.reduce(
    (count, node) =>
      count +
      (node.kind === 'model'
        ? Number(node.assetId === assetId)
        : countAssetReferences(node.children, assetId)),
    0,
  )
}

function mergeTransform(transform?: Partial<SceneTransform>): SceneTransform {
  return {
    position: transform?.position ?? IDENTITY.position,
    rotation: transform?.rotation ?? IDENTITY.rotation,
    scale: transform?.scale ?? IDENTITY.scale,
  }
}

function matrix(transform: SceneTransform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion().setFromEuler(new Euler(...transform.rotation, 'XYZ')),
    new Vector3(...transform.scale),
  )
}

function matrixError(a: Matrix4, b: Matrix4): number {
  return Math.max(...a.elements.map((value, index) => Math.abs(value - b.elements[index])))
}

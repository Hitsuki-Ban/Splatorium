import { describe, expect, it } from 'vitest'
import {
  planNodeDrop,
  planRootDrop,
  readAssetDragPayload,
  validateTreeDrop,
} from './scene-dnd'
import type { SceneGroupNode, SceneModelNode, SceneNode } from '@splatorium/shared'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const identity = {
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
}

function model(n: number): SceneModelNode {
  return {
    id: uuid(n),
    kind: 'model',
    name: `model-${n}`,
    visible: true,
    transform: identity,
    assetId: 'asset',
  }
}

function group(n: number, children: SceneNode[]): SceneGroupNode {
  return {
    id: uuid(n),
    kind: 'group',
    name: `group-${n}`,
    visible: true,
    transform: identity,
    children,
  }
}

// root: [m1, g2[m3, m4], m5]
const nodes: SceneNode[] = [model(1), group(2, [model(3), model(4)]), model(5)]

describe('planNodeDrop', () => {
  it('drops into a group at its end (accounting for same-parent removal)', () => {
    expect(planNodeDrop(nodes, uuid(1), uuid(2), 'into')).toEqual({
      targetParentId: uuid(2),
      targetIndex: 2,
    })
    expect(planNodeDrop(nodes, uuid(3), uuid(2), 'into')).toEqual({
      targetParentId: uuid(2),
      targetIndex: 1,
    })
  })

  it('computes before/after indices with same-parent shift', () => {
    // m1 を m5 の後ろへ（同一親・後方移動: 除去で 1 つ前詰め）
    expect(planNodeDrop(nodes, uuid(1), uuid(5), 'after')).toEqual({
      targetParentId: null,
      targetIndex: 2,
    })
    // m5 を m1 の前へ（前方移動は補正なし）
    expect(planNodeDrop(nodes, uuid(5), uuid(1), 'before')).toEqual({
      targetParentId: null,
      targetIndex: 0,
    })
    // 別親からの before/after は補正なし
    expect(planNodeDrop(nodes, uuid(3), uuid(5), 'before')).toEqual({
      targetParentId: null,
      targetIndex: 2,
    })
  })

  it('rejects self, descendants, and into-model drops', () => {
    expect(planNodeDrop(nodes, uuid(2), uuid(2), 'into')).toBeNull()
    expect(planNodeDrop(nodes, uuid(2), uuid(3), 'before')).toBeNull()
    expect(planNodeDrop(nodes, uuid(1), uuid(5), 'into')).toBeNull()
    expect(planNodeDrop(nodes, uuid(99), uuid(1), 'before')).toBeNull()
  })
})

describe('planRootDrop', () => {
  it('appends to root end, adjusting when already at root', () => {
    expect(planRootDrop(nodes, uuid(1))).toEqual({ targetParentId: null, targetIndex: 2 })
    expect(planRootDrop(nodes, uuid(3))).toEqual({ targetParentId: null, targetIndex: 3 })
    expect(planRootDrop(nodes, uuid(99))).toBeNull()
  })
})

describe('validateTreeDrop', () => {
  it('previews valid moves and rejects shear-producing reparent before drop', () => {
    const source = group(10, [model(11)])
    source.transform = {
      ...identity,
      rotation: [0, 0, Math.PI / 4],
      scale: [2, 1, 1],
    }
    const target = group(12, [])
    target.transform = {
      ...identity,
      rotation: [0, 0, Math.PI / 6],
      scale: [3, 1, 1],
    }
    const previewNodes: SceneNode[] = [source, target]
    const plan = planNodeDrop(previewNodes, uuid(11), target.id, 'into')

    expect(plan).not.toBeNull()
    expect(validateTreeDrop(previewNodes, uuid(11), plan!)).toMatchObject({ code: 'shear' })

    const rootPlan = planRootDrop(nodes, uuid(3))
    expect(rootPlan).not.toBeNull()
    expect(validateTreeDrop(nodes, uuid(3), rootPlan!)).toBeNull()
  })
})

describe('readAssetDragPayload', () => {
  it('parses valid payloads and rejects malformed ones', () => {
    expect(readAssetDragPayload(JSON.stringify({ assetId: 'a' }))).toEqual({ assetId: 'a' })
    expect(readAssetDragPayload('not json')).toBeNull()
    expect(readAssetDragPayload(JSON.stringify({ id: 'a' }))).toBeNull()
  })
})

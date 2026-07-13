import type {
  Asset,
  SceneDocument,
  SceneGroupNode,
  SceneModelNode,
  SceneNode,
} from '@splatorium/shared'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flattenSceneModels,
  getRenderableModelsForNode,
  getRenderableSceneModels,
  hasInvertibleSceneNodeParent,
  readStoredSceneDocument,
  toSceneDocument,
  toThumbnailPlacements,
} from './scene'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('scene document bridge', () => {
  it('deep-clones the complete tree for saving, including importedFrom', () => {
    const child = model(2)
    const source: SceneDocument = {
      schemaVersion: 2,
      nodes: [
        {
          ...group(1, [child]),
          importedFrom: {
            sceneId: 'source-scene',
            sourceHash: 'a'.repeat(64),
            contentHash: 'b'.repeat(64),
          },
        },
      ],
    }

    const saved = toSceneDocument(source.nodes)

    expect(saved).toEqual(source)
    expect(saved.nodes).not.toBe(source.nodes)
    expect((saved.nodes[0] as SceneGroupNode).children).not.toBe(
      (source.nodes[0] as SceneGroupNode).children,
    )
    ;(saved.nodes[0] as SceneGroupNode).children[0].name = 'Changed clone'
    expect(child.name).toBe('Model 2')
  })

  it('flattens nested models in stable DFS order with composed world matrices', () => {
    const rootModel = model(1)
    const nestedModel = model(3)
    nestedModel.transform.position = [1, 0, 0]
    nestedModel.transform.rotation = [0, 0, Math.PI / 4]
    const parent = group(2, [nestedModel])
    parent.transform.position = [10, 0, 0]
    parent.transform.rotation = [0, 0, Math.PI / 2]
    parent.transform.scale = [2, 1, 1]
    const deepModel = model(5)
    const nestedGroup = group(4, [deepModel])
    parent.children.push(nestedGroup)

    const flattened = flattenSceneModels([rootModel, parent])

    expect(flattened.map(({ modelNode }) => modelNode.id)).toEqual([
      rootModel.id,
      nestedModel.id,
      deepModel.id,
    ])
    expect(flattened[0].ancestorIds).toEqual([])
    expect(flattened[1].ancestorIds).toEqual([parent.id])
    expect(flattened[2].ancestorIds).toEqual([parent.id, nestedGroup.id])
    expect(new Vector3().setFromMatrixPosition(flattened[1].worldMatrix).toArray()).toEqual([
      10, 2, 0,
    ])

    const expected = new Matrix4()
      .compose(
        new Vector3(10, 0, 0),
        // Matrix multiplication is asserted independently by the final element comparison.
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
        new Vector3(2, 1, 1),
      )
      .multiply(
        new Matrix4().compose(
          new Vector3(1, 0, 0),
          new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4),
          new Vector3(1, 1, 1),
        ),
      )
    expect(flattened[1].worldMatrix.elements).toEqual(expected.elements)
  })

  it('keeps hidden models in the projection while inheriting ancestor visibility', () => {
    const hiddenByParent = model(2)
    const hiddenSelf = model(3)
    hiddenSelf.visible = false
    const hiddenGroup = group(1, [hiddenByParent])
    hiddenGroup.visible = false

    const flattened = flattenSceneModels([hiddenGroup, hiddenSelf])

    expect(flattened.map(({ effectiveVisible }) => effectiveVisible)).toEqual([false, false])
    expect(getRenderableSceneModels(flattened, new Set(['asset-2', 'asset-3']))).toEqual([])
  })

  it('selects only a node model or its renderable descendants for bounds and focus', () => {
    const direct = model(2)
    const nested = model(4)
    const childGroup = group(3, [nested])
    const rootGroup = group(1, [direct, childGroup])
    const outside = model(5)
    const renderable = getRenderableSceneModels(
      flattenSceneModels([rootGroup, outside]),
      new Set(['asset-2', 'asset-4', 'asset-5']),
    )

    expect(
      getRenderableModelsForNode(renderable, rootGroup.id).map(({ modelNode }) => modelNode.id),
    ).toEqual([direct.id, nested.id])
    expect(
      getRenderableModelsForNode(renderable, childGroup.id).map(({ modelNode }) => modelNode.id),
    ).toEqual([nested.id])
    expect(
      getRenderableModelsForNode(renderable, outside.id).map(({ modelNode }) => modelNode.id),
    ).toEqual([outside.id])
  })

  it('disables transform controls below a singular parent world matrix', () => {
    const child = model(2)
    const singularParent = group(1, [child])
    singularParent.transform.scale = [0, 1, 1]

    expect(hasInvertibleSceneNodeParent([singularParent], singularParent.id)).toBe(true)
    expect(hasInvertibleSceneNodeParent([singularParent], child.id)).toBe(false)
    expect(hasInvertibleSceneNodeParent([singularParent], uuid(99))).toBe(false)
  })

  it('converts a legacy stored document without dropping a missing model', () => {
    let value = 1
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(value)
        value += 1
        return bytes
      },
    })

    const document = readStoredSceneDocument(
      {
        placements: [
          { assetId: 'known', position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
          { assetId: 'missing', position: [4, 5, 6], rotation: [0, 0, 0], scale: [2, 2, 2] },
        ],
      },
      [makeAsset('known')],
    )

    expect(document.nodes).toHaveLength(2)
    expect(document.nodes[0]).toMatchObject({ name: 'known.spz', assetId: 'known' })
    expect(document.nodes[1]).toMatchObject({ name: '不明なモデル', assetId: 'missing' })
  })

  it('uses the same flattened matrices for render and thumbnail projections', () => {
    const visible = model(2)
    visible.transform.position = [2, 3, 4]
    const missing = model(3)
    const hidden = model(4)
    hidden.visible = false
    const nodes = [group(1, [visible, missing, hidden])]
    const flattened = flattenSceneModels(nodes)
    const available = new Set(['asset-2', 'asset-4'])
    const renderable = getRenderableSceneModels(flattened, available)
    const thumbnails = toThumbnailPlacements(flattened, available)

    expect(renderable.map(({ modelNode }) => modelNode.id)).toEqual([visible.id])
    expect(thumbnails).toHaveLength(1)
    expect(thumbnails[0]).toMatchObject({ nodeId: visible.id, assetId: visible.assetId })
    expect(thumbnails[0].worldMatrix.elements).toEqual(renderable[0].worldMatrix.elements)
    expect(thumbnails[0].worldMatrix).not.toBe(renderable[0].worldMatrix)
  })
})

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

function model(sequence: number): SceneModelNode {
  return {
    id: uuid(sequence),
    kind: 'model',
    name: `Model ${sequence}`,
    visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    assetId: `asset-${sequence}`,
  }
}

function group(sequence: number, children: SceneNode[]): SceneGroupNode {
  return {
    id: uuid(sequence),
    kind: 'group',
    name: `Group ${sequence}`,
    visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    children,
  }
}

function makeAsset(id: string): Asset {
  return {
    id,
    kind: 'splat',
    name: `${id}.spz`,
    tags: [],
    files: { main: { path: `${id}.spz`, size: 1 } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

import {
  hashSceneNodes,
  type Asset,
  type SceneDocument,
  type SceneNode,
} from '@splatorium/shared'
import { describe, expect, it } from 'vitest'
import { createSceneImportWrapper } from './scene-import'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

describe('createSceneImportWrapper', () => {
  it('deep-copies nested scenes with fresh IDs and preserves imported origins', async () => {
    const source = sceneAsset('scene-source', 'Nested source')
    const document: SceneDocument = {
      schemaVersion: 2,
      nodes: [
        group(1, [
          model(2, 'model-a'),
          {
            ...group(3, [model(4, 'model-b')]),
            importedFrom: { sceneId: 'inner-scene', sourceHash: HASH_A, contentHash: HASH_B },
          },
        ]),
      ],
    }
    const original = structuredClone(document)
    const wrapper = await createSceneImportWrapper(
      source,
      document,
      [source, modelAsset('model-a'), modelAsset('model-b', 'mesh')],
      sequentialIds(100),
    )

    const sourceIds = collectIds(document.nodes)
    const importedIds = collectIds([wrapper])
    expect(importedIds).toHaveLength(5)
    expect(new Set(importedIds).size).toBe(importedIds.length)
    expect(importedIds.every((id) => !sourceIds.includes(id))).toBe(true)
    expect(wrapper).toMatchObject({
      kind: 'group',
      name: source.name,
      visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      importedFrom: { sceneId: source.id },
    })
    expect((wrapper.children[0] as Extract<SceneNode, { kind: 'group' }>).children[1]).toMatchObject({
      kind: 'group',
      importedFrom: { sceneId: 'inner-scene', sourceHash: HASH_A, contentHash: HASH_B },
    })
    expect(wrapper.importedFrom?.sourceHash).toBe(await hashSceneNodes(document.nodes))
    expect(wrapper.importedFrom?.contentHash).toBe(wrapper.importedFrom?.sourceHash)

    const importedRoot = wrapper.children[0] as Extract<SceneNode, { kind: 'group' }>
    importedRoot.transform.position[0] = 99
    const importedInner = importedRoot.children[1] as Extract<SceneNode, { kind: 'group' }>
    importedInner.importedFrom!.sourceHash = 'c'.repeat(64)
    importedInner.children.splice(0)
    expect(document).toEqual(original)
  })

  it('converts stored v1 and completes self/empty imports without reference edges', async () => {
    const source = sceneAsset('scene-self', 'Self')
    const v1 = {
      placements: [
        {
          assetId: 'model-a',
          position: [1, 2, 3],
          rotation: [0, 0.5, 0],
          scale: [-1, 0, 2],
        },
      ],
    }
    const wrapper = await createSceneImportWrapper(
      source,
      v1,
      [source, modelAsset('model-a', 'splat', 'Resolved model')],
      sequentialIds(200),
    )
    expect(wrapper.children).toEqual([
      expect.objectContaining({
        kind: 'model',
        name: 'Resolved model',
        assetId: 'model-a',
        transform: { position: [1, 2, 3], rotation: [0, 0.5, 0], scale: [-1, 0, 2] },
      }),
    ])
    expect(wrapper.importedFrom?.sceneId).toBe(source.id)

    const empty = await createSceneImportWrapper(
      source,
      { schemaVersion: 2, nodes: [] },
      [source],
      sequentialIds(300),
    )
    expect(empty.children).toEqual([])
    expect(empty.importedFrom?.sourceHash).toBe(await hashSceneNodes([]))
  })

  it('fails before mutation for broken models and wrapper-induced limit overflow', async () => {
    const source = sceneAsset('scene-source', 'Source')
    await expect(
      createSceneImportWrapper(
        source,
        { schemaVersion: 2, nodes: [model(1, 'missing')] },
        [source],
        sequentialIds(400),
      ),
    ).rejects.toThrow('参照モデルが見つかりません: missing')

    await expect(
      createSceneImportWrapper(
        source,
        { schemaVersion: 2, nodes: [model(2, 'not-model')] },
        [source, sceneAsset('not-model', 'Not a model')],
        sequentialIds(450),
      ),
    ).rejects.toThrow('参照アセットはモデルではありません: not-model')

    const deepest = group(1, [])
    let root = deepest
    for (let depth = 1; depth <= 32; depth += 1) root = group(depth + 1, [root])
    await expect(
      createSceneImportWrapper(
        source,
        { schemaVersion: 2, nodes: [root] },
        [source],
        sequentialIds(500),
      ),
    ).rejects.toThrow('取込結果がシーン制約を超えています')
  })

  it('fails fast when generated IDs reuse source or imported IDs', async () => {
    const source = sceneAsset('scene-source', 'Source')
    const document = { schemaVersion: 2, nodes: [model(1, 'model-a')] }
    const assets = [source, modelAsset('model-a')]

    await expect(
      createSceneImportWrapper(source, document, assets, () => uuid(1)),
    ).rejects.toThrow('取込先 ID が source と重複しています')

    const ids = [uuid(100), uuid(100)]
    await expect(
      createSceneImportWrapper(source, document, assets, () => ids.shift()!),
    ).rejects.toThrow('取込先 ID が重複しています')
  })
})

function collectIds(nodes: readonly SceneNode[]): string[] {
  return nodes.flatMap((node) => [
    node.id,
    ...(node.kind === 'group' ? collectIds(node.children) : []),
  ])
}

function sequentialIds(start: number): () => string {
  let sequence = start
  return () => uuid(sequence++)
}

function sceneAsset(id: string, name: string): Asset {
  return {
    id,
    kind: 'scene',
    name,
    tags: [],
    files: { main: { path: 'scene.json', size: 1, mime: 'application/json' } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function modelAsset(
  id: string,
  kind: 'splat' | 'mesh' = 'splat',
  name = `${id}.spz`,
): Asset {
  return {
    id,
    kind,
    name,
    tags: [],
    files: { main: { path: name, size: 1 } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

function model(sequence: number, assetId: string): SceneNode {
  return {
    id: uuid(sequence),
    kind: 'model',
    name: `Model ${sequence}`,
    visible: true,
    transform: identity(),
    assetId,
  }
}

function group(
  sequence: number,
  children: SceneNode[],
): Extract<SceneNode, { kind: 'group' }> {
  return {
    id: uuid(sequence),
    kind: 'group',
    name: `Group ${sequence}`,
    visible: true,
    transform: identity(),
    children,
  }
}

function identity() {
  return {
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  }
}

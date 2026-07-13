import {
  SCENE_DOCUMENT_MAX_CHILDREN,
  SCENE_DOCUMENT_MAX_DEPTH,
  SCENE_DOCUMENT_MAX_NODES,
  canonicalizeSceneNodes,
  hashSceneNodes,
  parseStoredSceneDocument,
  parseWritableSceneDocument,
  type SceneDocument,
  type SceneGroupNode,
  type SceneModelNode,
  type SceneNode,
} from '../src/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

const TRANSFORM = {
  position: [0, 1.25, -2] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

function model(sequence: number, overrides: Partial<SceneModelNode> = {}): SceneModelNode {
  return {
    id: uuid(sequence),
    kind: 'model',
    name: `Model ${sequence}`,
    visible: true,
    transform: TRANSFORM,
    assetId: `asset-${sequence}`,
    ...overrides,
  }
}

function document(nodes: SceneNode[]): SceneDocument {
  return { schemaVersion: 2, nodes }
}

describe('SceneDocument version 2 validation', () => {
  it('reconstructs a valid nested document without sharing transform arrays', () => {
    const input = document([
      {
        id: uuid(1),
        kind: 'group',
        name: 'Group',
        visible: true,
        transform: TRANSFORM,
        importedFrom: {
          sceneId: 'scene-1',
          sourceHash: 'a'.repeat(64),
          contentHash: 'b'.repeat(64),
        },
        children: [model(2)],
      },
    ])

    const result = parseWritableSceneDocument(input)

    expect(result).toEqual({ ok: true, value: input })
    if (result.ok) {
      expect(result.value).not.toBe(input)
      expect(result.value.nodes[0].transform.position).not.toBe(input.nodes[0].transform.position)
    }
  })

  it.each([
    [{ ...document([]), placements: [] }, 'unknown field: placements'],
    [{ placements: [] }, 'unknown field: placements'],
    [{ schemaVersion: 1, nodes: [] }, 'schemaVersion must be 2'],
    [document([{ ...model(1), unexpected: true } as SceneModelNode]), 'unknown field'],
    [document([model(1), model(1)]), 'must be unique'],
    [
      document([
        model(1, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
        model(2, { id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }),
      ]),
      'must be unique',
    ],
    [document([model(1, { name: '   ' })]), 'name must be'],
    [document([model(1, { id: 'not-a-uuid' })]), 'must be a UUID'],
    [
      document([
        model(1, {
          transform: { ...TRANSFORM, position: [0, Number.POSITIVE_INFINITY, 0] },
        }),
      ]),
      'finite numbers',
    ],
  ])('rejects invalid writable input %#', (input, message) => {
    const result = parseWritableSceneDocument(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(message)
  })

  it('enforces the maximum depth with document roots at depth zero', () => {
    let accepted: SceneNode = model(1)
    for (let depth = SCENE_DOCUMENT_MAX_DEPTH - 1; depth >= 0; depth -= 1) {
      accepted = group(depth + 2, [accepted])
    }
    expect(parseWritableSceneDocument(document([accepted])).ok).toBe(true)

    const rejected = group(100, [accepted])
    const result = parseWritableSceneDocument(document([rejected]))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('depth')
  })

  it('enforces direct child and total node limits', () => {
    const tooManyChildren = group(
      1,
      Array.from({ length: SCENE_DOCUMENT_MAX_CHILDREN + 1 }, (_, index) => model(index + 2)),
    )
    expect(parseWritableSceneDocument(document([tooManyChildren])).ok).toBe(false)

    const tooManyNodes = Array.from({ length: SCENE_DOCUMENT_MAX_NODES + 1 }, (_, index) =>
      model(index + 1),
    )
    expect(parseWritableSceneDocument(document(tooManyNodes)).ok).toBe(false)
  })
})

describe('stored SceneDocument parsing', () => {
  it('converts legacy placements in order and preserves a missing asset as unknown', () => {
    let nextId = 1
    const result = parseStoredSceneDocument(
      {
        placements: [
          { assetId: 'known', position: [1, 2, 3], rotation: [4, 5, 6], scale: [7, 8, 9] },
          { assetId: 'missing', position: [9, 8, 7], rotation: [6, 5, 4], scale: [3, 2, 1] },
        ],
      },
      {
        resolveAssetName: (assetId) => (assetId === 'known' ? 'Known asset' : undefined),
        createNodeId: () => uuid(nextId++),
      },
    )

    expect(result).toEqual({
      ok: true,
      value: document([
        model(1, {
          name: 'Known asset',
          assetId: 'known',
          transform: { position: [1, 2, 3], rotation: [4, 5, 6], scale: [7, 8, 9] },
        }),
        model(2, {
          name: '不明なモデル',
          assetId: 'missing',
          transform: { position: [9, 8, 7], rotation: [6, 5, 4], scale: [3, 2, 1] },
        }),
      ]),
    })
  })

  it('preserves zero and negative legacy scales without correction', () => {
    // schemaVersion 1 の zero/negative scale は値を変えずに読み取る。
    let nextId = 1
    const result = parseStoredSceneDocument(
      {
        placements: [
          { assetId: 'a', position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] },
          { assetId: 'a', position: [0, 0, 0], rotation: [0, 0, 0], scale: [-1, 2, -0.5] },
        ],
      },
      {
        resolveAssetName: () => 'asset',
        createNodeId: () => uuid(nextId++),
      },
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      const scales = result.value.nodes.map(
        (node) => (node.kind === 'model' ? node.transform.scale : null),
      )
      expect(scales).toEqual([
        [0, 0, 0],
        [-1, 2, -0.5],
      ])
    }
  })

  it('rejects ambiguous legacy fields and invalid generated IDs', () => {
    const options = { resolveAssetName: () => undefined, createNodeId: () => 'invalid' }
    expect(parseStoredSceneDocument({ placements: [], nodes: [] }, options).ok).toBe(false)
    expect(
      parseStoredSceneDocument(
        { placements: [{ assetId: 'a', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] },
        options,
      ).ok,
    ).toBe(false)
  })

  it('rejects resolved names that cannot pass version 2 validation', () => {
    const result = parseStoredSceneDocument(
      {
        placements: [
          { assetId: 'a', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        ],
      },
      {
        resolveAssetName: () => 'x'.repeat(256),
        createNodeId: () => uuid(1),
      },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('resolved asset name')
  })
})

describe('scene semantic hash', () => {
  const first = model(1, {
    name: 'Chair',
    assetId: 'chair',
    transform: {
      position: [-0, 1.0000004, 2],
      rotation: [0, 0.25, 0],
      scale: [1, 1, 1],
    },
  })
  const second = model(2, { name: 'Table', assetId: 'table' })

  it('has a stable RFC 8785 test vector', async () => {
    expect(canonicalizeSceneNodes([first])).toBe(
      '[{"assetId":"chair","kind":"model","name":"Chair","transform":{"position":[0,1,2],"rotation":[0,0.25,0],"scale":[1,1,1]},"visible":true}]',
    )
    expect(await hashSceneNodes([first])).toBe(
      'a5917a27946931fb841381ff9da1a8d7e1fbed65b7cc2c217f6326f197043f0b',
    )
  })

  it('hashes without SubtleCrypto on a LAN HTTP browser origin', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(1),
    })

    expect(await hashSceneNodes([first])).toBe(
      'a5917a27946931fb841381ff9da1a8d7e1fbed65b7cc2c217f6326f197043f0b',
    )
  })

  it('ignores IDs and sub-micro transform noise', async () => {
    const changedId = { ...first, id: uuid(999) }
    const changedNoise = {
      ...changedId,
      transform: { ...changedId.transform, position: [0, 1.00000049, 2] as [number, number, number] },
    }
    expect(await hashSceneNodes([changedNoise])).toBe(await hashSceneNodes([first]))
  })

  it('ignores object key order and source JSON whitespace', async () => {
    const reordered = JSON.parse(`
      [{
        "visible": true,
        "transform": { "scale": [1, 1, 1], "rotation": [0, 0.25, 0], "position": [0, 1, 2] },
        "name": "Chair",
        "kind": "model",
        "id": "${uuid(987)}",
        "assetId": "chair"
      }]
    `) as SceneNode[]

    expect(await hashSceneNodes(reordered)).toBe(await hashSceneNodes([first]))
  })

  it('changes for semantic values and node order', async () => {
    const baseHash = await hashSceneNodes([first, second])
    expect(await hashSceneNodes([{ ...first, visible: false }, second])).not.toBe(baseHash)
    expect(await hashSceneNodes([{ ...first, name: 'Renamed' }, second])).not.toBe(baseHash)
    expect(await hashSceneNodes([{ ...first, assetId: 'other' }, second])).not.toBe(baseHash)
    expect(await hashSceneNodes([second, first])).not.toBe(baseHash)
    expect(
      await hashSceneNodes([
        {
          ...first,
          transform: {
            ...first.transform,
            position: [0, 1.0000014, 2],
          },
        },
        second,
      ]),
    ).not.toBe(baseHash)
  })

  it('changes for child order and imported scene origin', async () => {
    const imported = {
      ...group(3, [first, second]),
      importedFrom: {
        sceneId: 'scene-a',
        sourceHash: 'a'.repeat(64),
        contentHash: 'b'.repeat(64),
      },
    }
    const baseHash = await hashSceneNodes([imported])

    expect(await hashSceneNodes([{ ...imported, children: [second, first] }])).not.toBe(baseHash)
    expect(
      await hashSceneNodes([
        { ...imported, importedFrom: { ...imported.importedFrom, sceneId: 'scene-b' } },
      ]),
    ).not.toBe(baseHash)
  })
})

function group(sequence: number, children: SceneNode[]): SceneGroupNode {
  return {
    id: uuid(sequence),
    kind: 'group',
    name: `Group ${sequence}`,
    visible: true,
    transform: TRANSFORM,
    children,
  }
}

import { ApiError } from '@/lib/api'
import { redirectSceneModelAsset } from '@/lib/scene-tree'
import {
  checkImportedSceneSources,
  collectImportedSceneGroups,
  deriveImportedSceneUpdates,
  loadImportedSceneSource,
  type SceneSourceOutcome,
} from '@/lib/scene-update'
import {
  hashSceneNodes,
  type Asset,
  type SceneGroupNode,
  type SceneNode,
} from '@splatorium/shared'
import { describe, expect, it, vi } from 'vitest'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

describe('scene update state', () => {
  it('derives the four hash states independently for each wrapper', async () => {
    const cleanChildren = [model(1, 'Original')]
    const contentHash = await hashSceneNodes(cleanChildren)
    const nodes = [
      importedGroup(10, 'source-current', HASH_A, contentHash, cleanChildren),
      importedGroup(20, 'source-local', HASH_A, contentHash, [model(2, 'Edited')]),
      importedGroup(30, 'source-update', HASH_A, contentHash, cleanChildren),
      importedGroup(40, 'source-both', HASH_A, contentHash, [model(4, 'Edited')]),
    ]
    const outcomes = new Map<string, SceneSourceOutcome>([
      ['source-current', { kind: 'available', sourceHash: HASH_A }],
      ['source-local', { kind: 'available', sourceHash: HASH_A }],
      ['source-update', { kind: 'available', sourceHash: HASH_B }],
      ['source-both', { kind: 'available', sourceHash: HASH_B }],
    ])

    const updates = await deriveImportedSceneUpdates(nodes, outcomes)

    expect([...updates.values()].map((update) => update.status)).toEqual([
      'current',
      'locallyModified',
      'updateAvailable',
      'updateAvailableAndModified',
    ])
  })

  it('derives sourceMissing and checkFailed without treating failures as missing', async () => {
    const nodes = [
      importedGroup(1, 'missing', HASH_A, HASH_A, []),
      importedGroup(2, 'failed', HASH_A, HASH_A, []),
    ]
    const updates = await deriveImportedSceneUpdates(
      nodes,
      new Map<string, SceneSourceOutcome>([
        ['missing', { kind: 'sourceMissing' }],
        ['failed', { kind: 'checkFailed', error: 'network failed' }],
      ]),
    )

    expect(updates.get(nodes[0].id)).toEqual({ status: 'sourceMissing' })
    expect(updates.get(nodes[1].id)).toEqual({
      status: 'checkFailed',
      error: 'network failed',
    })
  })

  it('marks an imported group locally modified after a model reference redirect', async () => {
    const child = model(50, 'Imported model')
    const contentHash = await hashSceneNodes([child])
    const wrapper = importedGroup(51, 'source-scene', HASH_A, contentHash, [child])
    const redirected = redirectSceneModelAsset(
      [wrapper],
      child.id,
      'replacement-asset',
      'node',
    )
    expect(redirected.ok).toBe(true)
    if (!redirected.ok) return

    const updates = await deriveImportedSceneUpdates(
      redirected.value.nodes,
      new Map<string, SceneSourceOutcome>([
        ['source-scene', { kind: 'available', sourceHash: HASH_A }],
      ]),
    )

    expect(updates.get(wrapper.id)).toEqual({ status: 'locallyModified' })
    expect((redirected.value.nodes[0] as SceneGroupNode).importedFrom).toEqual(
      wrapper.importedFrom,
    )
  })

  it('collects nested imported groups and fetches each scene once per check session', async () => {
    const inner = importedGroup(2, 'same-source', HASH_A, HASH_A, [])
    const outer = importedGroup(1, 'same-source', HASH_A, HASH_A, [inner])
    const fetchSceneDocument = vi.fn().mockResolvedValue({ schemaVersion: 2, nodes: [] })

    expect(collectImportedSceneGroups([outer]).map((group) => group.id)).toEqual([
      outer.id,
      inner.id,
    ])
    const outcomes = await checkImportedSceneSources(
      [outer, inner],
      [sceneAsset('same-source')],
      fetchSceneDocument,
      sequentialIds(100),
    )

    expect(fetchSceneDocument).toHaveBeenCalledTimes(1)
    expect(outcomes.get('same-source')).toEqual({
      kind: 'available',
      sourceHash: await hashSceneNodes([]),
    })
  })

  it('classifies absent assets and HTTP 404 as missing, but other failures as checkFailed', async () => {
    const createId = sequentialIds(200)
    const missingAsset = await loadImportedSceneSource(
      'missing',
      [],
      vi.fn(),
      createId,
    )
    const missingFile = await loadImportedSceneSource(
      'scene',
      [sceneAsset('scene')],
      vi.fn().mockRejectedValue(new ApiError(404, 'not found')),
      createId,
    )
    const serverFailure = await loadImportedSceneSource(
      'scene',
      [sceneAsset('scene')],
      vi.fn().mockRejectedValue(new ApiError(500, 'server failed')),
      createId,
    )
    const invalidDocument = await loadImportedSceneSource(
      'scene',
      [sceneAsset('scene')],
      vi.fn().mockResolvedValue({ schemaVersion: 99, nodes: [] }),
      createId,
    )

    expect(missingAsset).toEqual({ kind: 'sourceMissing' })
    expect(missingFile).toEqual({ kind: 'sourceMissing' })
    expect(serverFailure).toEqual({ kind: 'checkFailed', error: 'server failed' })
    expect(invalidDocument).toMatchObject({ kind: 'checkFailed' })
  })
})

function importedGroup(
  sequence: number,
  sceneId: string,
  sourceHash: string,
  contentHash: string,
  children: SceneNode[],
): SceneGroupNode {
  return {
    id: uuid(sequence),
    kind: 'group',
    name: `Imported ${sequence}`,
    visible: true,
    transform: identity(),
    children,
    importedFrom: { sceneId, sourceHash, contentHash },
  }
}

function model(sequence: number, name: string): SceneNode {
  return {
    id: uuid(sequence),
    kind: 'model',
    name,
    visible: true,
    transform: identity(),
    assetId: `asset-${sequence}`,
  }
}

function sceneAsset(id: string): Asset {
  return {
    id,
    kind: 'scene',
    name: id,
    tags: [],
    files: { main: { path: 'scene.json', size: 1, mime: 'application/json' } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function sequentialIds(start: number): () => string {
  let sequence = start
  return () => uuid(sequence++)
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

function identity() {
  return {
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  }
}

import type { PlacementTransform } from '@/components/scene-viewer'
import { readStoredSceneDocument } from '@/lib/scene'
import { findSceneNode, sceneNodesEqual } from '@/lib/scene-tree'
import type {
  Asset,
  SceneDocument,
  SceneGroupNode,
  SceneModelNode,
  SceneNode,
  SceneTransform,
} from '@splatorium/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { selectHasUnsavedSceneChanges, useSceneStore } from './scene-store'

const MOVED: PlacementTransform = {
  position: [2, 3, 4],
  rotation: [0, Math.PI / 2, 0],
  scale: [1.5, 1.5, 1.5],
}

beforeEach(resetStore)

describe('scene tree store', () => {
  it('creates a model and undoes its selection and node as one entry', () => {
    const result = useSceneStore.getState().addModel(makeAsset('a'), null)
    const added = useSceneStore.getState().nodes[0]

    expect(result.ok).toBe(true)
    expect(added).toMatchObject({ kind: 'model', assetId: 'a', name: 'a.spz' })
    expect(useSceneStore.getState().selectedNodeId).toBe(added.id)
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)

    useSceneStore.temporal.getState().undo()
    expect(useSceneStore.getState().nodes).toEqual([])
    expect(useSceneStore.getState().selectedNodeId).toBeNull()

    useSceneStore.temporal.getState().redo()
    expect(useSceneStore.getState().nodes).toEqual([added])
    expect(useSceneStore.getState().selectedNodeId).toBe(added.id)
  })

  it('places a model at the requested drop position', () => {
    const result = useSceneStore.getState().addModel(makeAsset('a'), null, [1.5, 0, -2.25])

    expect(result.ok).toBe(true)
    expect(useSceneStore.getState().nodes[0].transform.position).toEqual([1.5, 0, -2.25])
    // 位置指定なしの追加は従来どおり横並びの既定位置
    useSceneStore.getState().addModel(makeAsset('b'), null)
    expect(useSceneStore.getState().nodes[1].transform.position).toEqual([1.2, 0, 0])
  })

  it('imports a prepared scene wrapper as one atomic undo entry', () => {
    const original = group(1, [])
    replaceScene([original])
    useSceneStore.getState().selectNode(original.id)
    const wrapper = group(10, [model(11)])
    wrapper.importedFrom = {
      sceneId: 'scene-source',
      sourceHash: 'a'.repeat(64),
      contentHash: 'a'.repeat(64),
    }
    const expectedWrapper = structuredClone(wrapper)

    const result = useSceneStore.getState().importScene(wrapper, null, currentImportDestination())
    expect(result.ok).toBe(true)
    expect(useSceneStore.getState().nodes).toEqual([original, expectedWrapper])
    expect(useSceneStore.getState().selectedNodeId).toBe(wrapper.id)
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)

    wrapper.name = 'mutated outside the store'
    wrapper.children.splice(0)
    expect(useSceneStore.getState().nodes[1]).toEqual(expectedWrapper)

    useSceneStore.temporal.getState().undo()
    expect(useSceneStore.getState().nodes).toEqual([original])
    expect(useSceneStore.getState().selectedNodeId).toBe(original.id)

    useSceneStore.temporal.getState().redo()
    expect(useSceneStore.getState().nodes).toEqual([original, expectedWrapper])
    expect(useSceneStore.getState().selectedNodeId).toBe(expectedWrapper.id)
  })

  it('rejects an import that exceeds the destination children limit without history', () => {
    const full = group(
      20,
      Array.from({ length: 2_000 }, (_, index) => model(index + 100)),
    )
    replaceScene([full])
    const before = structuredClone(useSceneStore.getState().nodes)
    const wrapper = group(3_000, [])
    wrapper.importedFrom = {
      sceneId: 'scene-source',
      sourceHash: 'b'.repeat(64),
      contentHash: 'b'.repeat(64),
    }

    const result = useSceneStore
      .getState()
      .importScene(wrapper, full.id, currentImportDestination())
    expect(result.ok).toBe(false)
    expect(useSceneStore.getState().nodes).toEqual(before)
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('rejects an import whose async destination was removed before commit', () => {
    const wrapper = group(4_000, [])
    wrapper.importedFrom = {
      sceneId: 'scene-source',
      sourceHash: 'c'.repeat(64),
      contentHash: 'c'.repeat(64),
    }

    const result = useSceneStore
      .getState()
      .importScene(wrapper, uuid(9_999), currentImportDestination())
    expect(result.ok).toBe(false)
    expect(useSceneStore.getState().nodes).toEqual([])
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('rejects a root import when another scene replaces the async destination', () => {
    const sceneA = group(5_000, [])
    const sceneB = group(5_001, [])
    expect(
      useSceneStore
        .getState()
        .replaceScene({ schemaVersion: 2, nodes: [sceneA] }, { id: 'scene-a', name: 'A' }).ok,
    ).toBe(true)
    const destination = currentImportDestination()

    expect(
      useSceneStore
        .getState()
        .replaceScene({ schemaVersion: 2, nodes: [sceneB] }, { id: 'scene-b', name: 'B' }).ok,
    ).toBe(true)
    const wrapper = group(5_002, [])
    wrapper.importedFrom = {
      sceneId: 'scene-source',
      sourceHash: 'd'.repeat(64),
      contentHash: 'd'.repeat(64),
    }

    const result = useSceneStore.getState().importScene(wrapper, null, destination)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('stale-destination')
    expect(useSceneStore.getState().activeScene?.id).toBe('scene-b')
    expect(useSceneStore.getState().nodes).toEqual([sceneB])
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('reimports children and origin as one undo entry while preserving the wrapper', () => {
    const wrapper = group(6_000, [model(6_001)], { position: [4, 5, 6] })
    wrapper.name = 'ローカル名'
    wrapper.visible = false
    wrapper.importedFrom = {
      sceneId: 'scene-source',
      sourceHash: 'a'.repeat(64),
      contentHash: 'a'.repeat(64),
    }
    replaceScene([wrapper])
    useSceneStore.getState().selectNode(wrapper.children[0].id)
    const before = structuredClone(useSceneStore.getState().nodes)
    const sourceWrapper = group(7_000, [model(7_001)])
    sourceWrapper.name = '更新された元シーン名'
    sourceWrapper.importedFrom = {
      sceneId: 'scene-source',
      sourceHash: 'b'.repeat(64),
      contentHash: 'b'.repeat(64),
    }

    const result = useSceneStore
      .getState()
      .reimportScene(wrapper.id, sourceWrapper, currentImportDestination())

    expect(result.ok).toBe(true)
    const refreshed = useSceneStore.getState().nodes[0] as SceneGroupNode
    expect(refreshed).toMatchObject({
      id: wrapper.id,
      name: 'ローカル名',
      visible: false,
      transform: wrapper.transform,
      importedFrom: sourceWrapper.importedFrom,
    })
    expect(refreshed.children).toEqual(sourceWrapper.children)
    expect(useSceneStore.getState().selectedNodeId).toBe(wrapper.id)
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)

    sourceWrapper.children.splice(0)
    expect((useSceneStore.getState().nodes[0] as SceneGroupNode).children).toHaveLength(1)

    useSceneStore.temporal.getState().undo()
    expect(useSceneStore.getState().nodes).toEqual(before)
    expect(useSceneStore.getState().selectedNodeId).toBe(wrapper.children[0].id)
    useSceneStore.temporal.getState().redo()
    expect((useSceneStore.getState().nodes[0] as SceneGroupNode).importedFrom?.sourceHash)
      .toBe('b'.repeat(64))
    expect(useSceneStore.getState().selectedNodeId).toBe(wrapper.id)
  })

  it('rejects stale or mismatched reimports without mutation or history', () => {
    const wrapper = group(8_000, [])
    wrapper.importedFrom = {
      sceneId: 'scene-source',
      sourceHash: 'a'.repeat(64),
      contentHash: 'a'.repeat(64),
    }
    replaceScene([wrapper])
    const staleDestination = currentImportDestination()
    expect(useSceneStore.getState().renameNode(wrapper.id, 'changed').ok).toBe(true)
    useSceneStore.temporal.getState().clear()
    const sourceWrapper = group(8_100, [])
    sourceWrapper.importedFrom = {
      sceneId: 'scene-source',
      sourceHash: 'b'.repeat(64),
      contentHash: 'b'.repeat(64),
    }
    const before = structuredClone(useSceneStore.getState().nodes)

    const stale = useSceneStore
      .getState()
      .reimportScene(wrapper.id, sourceWrapper, staleDestination)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error.code).toBe('stale-destination')

    sourceWrapper.importedFrom.sceneId = 'another-source'
    const mismatch = useSceneStore
      .getState()
      .reimportScene(wrapper.id, sourceWrapper, currentImportDestination())
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) expect(mismatch.error.code).toBe('stale-destination')
    expect(useSceneStore.getState().nodes).toEqual(before)
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('unlinks only importedFrom and restores it with one undo', () => {
    const wrapper = group(9_000, [model(9_001)], { scale: [2, 3, 4] })
    wrapper.name = '保持する名前'
    wrapper.visible = false
    wrapper.importedFrom = {
      sceneId: 'scene-source',
      sourceHash: 'c'.repeat(64),
      contentHash: 'd'.repeat(64),
    }
    replaceScene([wrapper])
    const before = structuredClone(wrapper)

    const result = useSceneStore.getState().unlinkImportedScene(wrapper.id)

    expect(result.ok).toBe(true)
    const unlinked = useSceneStore.getState().nodes[0] as SceneGroupNode
    expect(unlinked.importedFrom).toBeUndefined()
    expect(unlinked).toEqual({ ...before, importedFrom: undefined })
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)
    useSceneStore.temporal.getState().undo()
    expect(useSceneStore.getState().nodes[0]).toEqual(before)
  })

  it('rejects reimport and unlink for a regular group without history', () => {
    const regular = group(9_100, [])
    replaceScene([regular])
    const sourceWrapper = group(9_101, [])
    sourceWrapper.importedFrom = {
      sceneId: 'scene-source',
      sourceHash: 'e'.repeat(64),
      contentHash: 'e'.repeat(64),
    }

    const reimport = useSceneStore
      .getState()
      .reimportScene(regular.id, sourceWrapper, currentImportDestination())
    const unlink = useSceneStore.getState().unlinkImportedScene(regular.id)

    expect(reimport.ok).toBe(false)
    expect(unlink.ok).toBe(false)
    expect(useSceneStore.getState().nodes).toEqual([regular])
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('creates sibling-unique groups and a nested group', () => {
    expect(useSceneStore.getState().createGroup(null).ok).toBe(true)
    const firstId = useSceneStore.getState().nodes[0].id
    expect(useSceneStore.getState().createGroup(null).ok).toBe(true)
    expect(useSceneStore.getState().createGroup(firstId).ok).toBe(true)

    expect(useSceneStore.getState().nodes.map((node) => node.name)).toEqual([
      'グループ 1',
      'グループ 2',
    ])
    const first = findSceneNode(useSceneStore.getState().nodes, firstId)?.node
    expect(first).toMatchObject({ kind: 'group', children: [{ name: 'グループ 1' }] })
  })

  it('records rename, transform, and visibility commands one at a time', () => {
    useSceneStore.getState().createGroup(null)
    const nodeId = useSceneStore.getState().nodes[0].id
    const history = useSceneStore.temporal.getState()
    history.clear()

    expect(useSceneStore.getState().renameNode(nodeId, 'Display').ok).toBe(true)
    expect(history.pastStates).toHaveLength(1)
    history.undo()
    expect(findSceneNode(useSceneStore.getState().nodes, nodeId)?.node.name).toBe('グループ 1')
    history.clear()

    expect(useSceneStore.getState().commitNodeTransform(nodeId, MOVED).ok).toBe(true)
    expect(findSceneNode(useSceneStore.getState().nodes, nodeId)?.node.transform).toEqual(MOVED)
    expect(history.pastStates).toHaveLength(1)
    history.undo()
    expect(findSceneNode(useSceneStore.getState().nodes, nodeId)?.node.transform.position).toEqual([
      0, 0, 0,
    ])
    history.clear()

    expect(useSceneStore.getState().toggleNodeVisibility(nodeId).ok).toBe(true)
    expect(findSceneNode(useSceneStore.getState().nodes, nodeId)?.node.visible).toBe(false)
    expect(history.pastStates).toHaveLength(1)
  })

  it('keeps gizmo previews transient and clears them on the final commit', () => {
    useSceneStore.getState().createGroup(null)
    const node = useSceneStore.getState().nodes[0]
    const history = useSceneStore.temporal.getState()
    history.clear()
    const preview = structuredClone(MOVED)

    expect(useSceneStore.getState().previewNodeTransform(node.id, preview).ok).toBe(true)
    preview.position[0] = 99
    expect(useSceneStore.getState().transformPreview).toEqual({
      nodeId: node.id,
      transform: MOVED,
    })
    expect(useSceneStore.getState().nodes[0].transform.position).toEqual([0, 0, 0])
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])

    expect(useSceneStore.getState().commitNodeTransform(node.id, MOVED).ok).toBe(true)
    expect(useSceneStore.getState().transformPreview).toBeNull()
    expect(useSceneStore.getState().nodes[0].transform).toEqual(MOVED)
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)
  })

  it('commits a group gizmo transform without rewriting descendant local transforms', () => {
    const child = model(2, {
      position: [3, 4, 5],
      rotation: [0.1, 0.2, 0.3],
      scale: [2, 3, 4],
    })
    const parent = group(1, [child])
    replaceScene([parent])

    expect(useSceneStore.getState().commitNodeTransform(parent.id, MOVED).ok).toBe(true)

    const updated = findSceneNode(useSceneStore.getState().nodes, parent.id)?.node
    expect(updated?.transform).toEqual(MOVED)
    expect(updated).toMatchObject({ kind: 'group', children: [child] })
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)
  })

  it('rejects invalid rename and no-op transform without history', () => {
    useSceneStore.getState().addModel(makeAsset('a'), null)
    const node = useSceneStore.getState().nodes[0]
    const history = useSceneStore.temporal.getState()
    history.clear()

    const invalid = useSceneStore.getState().renameNode(node.id, '   ')
    expect(invalid.ok).toBe(false)
    expect(useSceneStore.getState().nodes[0].name).toBe('a.spz')

    const noOp = useSceneStore.getState().commitNodeTransform(node.id, node.transform)
    expect(noOp.ok).toBe(true)
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('deletes a selected subtree atomically and restores it with Undo', () => {
    const child = model(2)
    const parent = group(1, [child])
    replaceScene([parent])
    useSceneStore.getState().selectNode(child.id)
    useSceneStore.temporal.getState().clear()

    expect(useSceneStore.getState().deleteNode(parent.id).ok).toBe(true)
    expect(useSceneStore.getState().nodes).toEqual([])
    expect(useSceneStore.getState().selectedNodeId).toBeNull()
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)

    useSceneStore.temporal.getState().undo()
    expect(useSceneStore.getState().nodes).toEqual([parent])
    expect(useSceneStore.getState().selectedNodeId).toBe(child.id)
  })

  it('reparents with world transform preservation as one history entry', () => {
    const child = model(3, { position: [2, 0, 0] })
    const source = group(1, [child], { position: [10, 0, 0] })
    const target = group(2, [], { position: [-5, 0, 0] })
    replaceScene([source, target])

    const result = useSceneStore.getState().moveNode(child.id, target.id, 0)

    expect(result.ok).toBe(true)
    expect(findSceneNode(useSceneStore.getState().nodes, child.id)?.node.transform.position[0])
      .toBeCloseTo(17)
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)
    useSceneStore.temporal.getState().undo()
    expect(findSceneNode(useSceneStore.getState().nodes, child.id)?.parentId).toBe(source.id)
    expect(findSceneNode(useSceneStore.getState().nodes, child.id)?.node.transform.position).toEqual([
      2, 0, 0,
    ])
  })

  it('reorders siblings as one history entry without changing transforms', () => {
    const first = model(1, { position: [1, 2, 3] })
    const second = model(2)
    const third = model(3)
    replaceScene([first, second, third])

    const result = useSceneStore.getState().moveNode(first.id, null, 2)

    expect(result.ok).toBe(true)
    expect(useSceneStore.getState().nodes.map((node) => node.id)).toEqual([
      second.id,
      third.id,
      first.id,
    ])
    expect(useSceneStore.getState().nodes[2].transform).toEqual(first.transform)
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)
    useSceneStore.temporal.getState().undo()
    expect(useSceneStore.getState().nodes.map((node) => node.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ])
  })

  it('does not mutate or create history for cycle and shear rejection', () => {
    const child = group(2, [])
    const source = group(
      1,
      [child, model(3)],
      { rotation: [0, 0, Math.PI / 4], scale: [2, 1, 1] },
    )
    const target = group(
      4,
      [],
      { rotation: [0, 0, Math.PI / 6], scale: [3, 1, 1] },
    )
    replaceScene([source, target])
    const before = useSceneStore.getState().nodes

    const cycle = useSceneStore.getState().moveNode(source.id, child.id, 0)
    expect(cycle.ok).toBe(false)
    if (!cycle.ok) expect(cycle.error.code).toBe('cycle')

    const shear = useSceneStore.getState().moveNode(uuid(3), target.id, 0)
    expect(shear.ok).toBe(false)
    if (!shear.ok) expect(shear.error.code).toBe('shear')

    expect(sceneNodesEqual(useSceneStore.getState().nodes, before)).toBe(true)
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('preflights child limits in the store command', () => {
    const full = group(
      3_000,
      Array.from({ length: 2_000 }, (_, index) => model(index + 1)),
    )
    replaceScene([full])

    const result = useSceneStore.getState().createGroup(full.id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('document-invalid')
    expect((useSceneStore.getState().nodes[0] as SceneGroupNode).children).toHaveLength(2_000)
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('preflights depth limits before reparenting', () => {
    let deepest = group(1_032, [])
    const targetId = deepest.id
    for (let depth = 31; depth >= 0; depth -= 1) {
      deepest = group(1_000 + depth, [deepest])
    }
    const moving = model(2_000)
    replaceScene([deepest, moving])

    const result = useSceneStore.getState().moveNode(moving.id, targetId, 0)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('document-invalid')
      expect(result.error.message).toContain('depth')
    }
    expect(findSceneNode(useSceneStore.getState().nodes, moving.id)?.parentId).toBeNull()
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('keeps selection, gizmo modes, and save metadata out of history', () => {
    useSceneStore.getState().addModel(makeAsset('a'), null)
    const nodeId = useSceneStore.getState().nodes[0].id
    useSceneStore.temporal.getState().clear()

    useSceneStore.getState().selectNode(null)
    useSceneStore.getState().selectNode(nodeId)
    useSceneStore.getState().setGizmoMode('rotate')
    useSceneStore.getState().setScaleMode('axis')
    useSceneStore
      .getState()
      .markSaved(makeAsset('scene-1', 'scene'), currentDocument(), currentNameDraft())

    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
    expect(useSceneStore.getState()).toMatchObject({
      selectedNodeId: nodeId,
      gizmoMode: 'rotate',
      scaleMode: 'axis',
      activeScene: { id: 'scene-1', name: 'scene-1.spz' },
    })
  })

  it('tracks the persisted snapshot independently across save, undo, and redo', () => {
    const original = group(10_000, [])
    replaceScene([original])
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(false)

    expect(useSceneStore.getState().renameNode(original.id, 'Saved name').ok).toBe(true)
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(true)
    const savedDocument = currentDocument()
    useSceneStore
      .getState()
      .markSaved(makeAsset('saved-scene', 'scene'), savedDocument, currentNameDraft())

    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(false)
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)

    expect(useSceneStore.getState().renameNode(original.id, 'Unsaved name').ok).toBe(true)
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(true)
    useSceneStore.temporal.getState().undo()
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(false)
    useSceneStore.temporal.getState().redo()
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(true)
  })

  it('keeps edits made while a save request is in flight dirty after the response', () => {
    const original = group(11_000, [])
    replaceScene([original])
    const requestDocument = currentDocument()

    expect(useSceneStore.getState().renameNode(original.id, 'Edited during save').ok).toBe(true)
    useSceneStore
      .getState()
      .markSaved(makeAsset('saved-scene', 'scene'), requestDocument, currentNameDraft())

    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(true)
    expect(useSceneStore.getState().savedNodes[0].name).toBe(original.name)
    requestDocument.nodes[0].name = 'Mutated request object'
    expect(useSceneStore.getState().savedNodes[0].name).toBe(original.name)
  })

  it('normalizes blank and trimmed drafts to the persisted server name', () => {
    replaceScene([group(11_100, [])])
    useSceneStore.getState().setSceneNameDraft('   ')
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(true)
    const blankRequest = currentNameDraft()
    useSceneStore.getState().markSaved(
      { ...makeAsset('generated-scene', 'scene'), name: 'Generated scene' },
      currentDocument(),
      blankRequest,
    )
    expect(useSceneStore.getState()).toMatchObject({
      sceneNameDraft: 'Generated scene',
      savedSceneName: 'Generated scene',
    })
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(false)

    useSceneStore.getState().setSceneNameDraft('  Trimmed scene  ')
    const trimmedRequest = currentNameDraft()
    useSceneStore.getState().markSaved(
      { ...makeAsset('generated-scene', 'scene'), name: 'Trimmed scene' },
      currentDocument(),
      trimmedRequest,
    )
    expect(useSceneStore.getState()).toMatchObject({
      sceneNameDraft: 'Trimmed scene',
      savedSceneName: 'Trimmed scene',
    })
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(false)
  })

  it('preserves a name draft changed while the save request is in flight', () => {
    replaceScene([group(11_200, [])])
    useSceneStore.getState().setSceneNameDraft('Requested name')
    const requestNameDraft = currentNameDraft()
    const requestDocument = currentDocument()
    useSceneStore.getState().setSceneNameDraft('Edited during save')

    useSceneStore.getState().markSaved(
      { ...makeAsset('saved-scene', 'scene'), name: 'Requested name' },
      requestDocument,
      requestNameDraft,
    )

    expect(useSceneStore.getState()).toMatchObject({
      sceneNameDraft: 'Edited during save',
      savedSceneName: 'Requested name',
    })
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(true)
  })

  it('follows remote scene names only while the local name draft is clean', () => {
    replaceScene([group(11_300, [])])
    useSceneStore.getState().reconcileActiveScene({
      ...makeAsset('scene', 'scene'),
      name: 'Remote clean name',
    })
    expect(useSceneStore.getState()).toMatchObject({
      sceneNameDraft: 'Remote clean name',
      savedSceneName: 'Remote clean name',
    })
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(false)

    useSceneStore.getState().setSceneNameDraft('Local draft')
    useSceneStore.getState().reconcileActiveScene({
      ...makeAsset('scene', 'scene'),
      name: 'Another remote name',
    })
    expect(useSceneStore.getState()).toMatchObject({
      sceneNameDraft: 'Local draft',
      savedSceneName: 'Another remote name',
    })
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(true)

    useSceneStore.getState().reconcileActiveScene({
      ...makeAsset('scene', 'scene'),
      name: 'Local draft',
    })
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(false)
  })

  it('keeps name drafts outside history and transform previews', () => {
    const node = group(11_400, [])
    replaceScene([node])
    useSceneStore.getState().setSceneNameDraft('Persistent draft')
    expect(useSceneStore.getState().previewNodeTransform(node.id, MOVED).ok).toBe(true)
    expect(useSceneStore.getState().sceneNameDraft).toBe('Persistent draft')
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])

    expect(useSceneStore.getState().renameNode(node.id, 'Edited node').ok).toBe(true)
    useSceneStore.temporal.getState().undo()
    expect(useSceneStore.getState().sceneNameDraft).toBe('Persistent draft')
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(true)
  })

  it('uses replacement and the empty untitled document as clean baselines', () => {
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(false)
    useSceneStore.getState().addModel(makeAsset('untitled'), null)
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(true)

    const loaded = group(12_000, [])
    const sourceDocument: SceneDocument = { schemaVersion: 2, nodes: [loaded] }
    const result = useSceneStore.getState().replaceScene(sourceDocument, {
      id: 'loaded-scene',
      name: 'Loaded',
    })
    expect(result.ok).toBe(true)
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(false)
    const loadedName = loaded.name
    sourceDocument.nodes[0].name = 'External mutation'
    expect(useSceneStore.getState().nodes[0].name).toBe(loadedName)
    expect(useSceneStore.getState().savedNodes[0].name).toBe(loadedName)
  })

  it('clears the full tree in one entry while preserving active scene metadata', () => {
    const nodes = [group(1, [model(2)]), model(3)]
    replaceScene(nodes)
    useSceneStore
      .getState()
      .markSaved(makeAsset('saved-scene', 'scene'), currentDocument(), currentNameDraft())

    useSceneStore.getState().clearScene()

    expect(useSceneStore.getState().nodes).toEqual([])
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(true)
    expect(useSceneStore.getState().activeScene?.id).toBe('saved-scene')
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)
    useSceneStore.temporal.getState().undo()
    expect(useSceneStore.getState().nodes).toEqual(nodes)
    expect(selectHasUnsavedSceneChanges(useSceneStore.getState())).toBe(false)
    expect(useSceneStore.getState().activeScene?.id).toBe('saved-scene')
  })

  it('loads a legacy document as a history boundary without dropping a broken model', () => {
    useSceneStore.getState().addModel(makeAsset('old'), null)
    const document = readStoredSceneDocument(
      {
        placements: [
          { assetId: 'known', position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
          { assetId: 'missing', position: [4, 5, 6], rotation: [0, 0, 0], scale: [2, 2, 2] },
        ],
      },
      [makeAsset('known')],
    )

    const result = useSceneStore.getState().replaceScene(document, {
      id: 'legacy-scene',
      name: 'Legacy',
    })

    expect(result.ok).toBe(true)
    expect(useSceneStore.getState().nodes).toHaveLength(2)
    expect(useSceneStore.getState().nodes[1]).toMatchObject({
      kind: 'model',
      assetId: 'missing',
      name: '不明なモデル',
    })
    expect(useSceneStore.getState().selectedNodeId).toBeNull()
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
    expect(useSceneStore.temporal.getState().futureStates).toEqual([])
  })

  it('redirects a group batch as one undo while preserving names, transforms, tree, and selection', () => {
    const first = model(12_000, { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3] })
    first.assetId = 'deleted-asset'
    first.name = '以前の表示名'
    first.visible = false
    const second = model(12_001, { scale: [2, 3, 4] })
    second.assetId = 'deleted-asset'
    second.name = 'ユーザー名'
    const wrapper = group(12_002, [first, group(12_003, [second])])
    wrapper.importedFrom = {
      sceneId: 'source-scene',
      sourceHash: 'a'.repeat(64),
      contentHash: 'b'.repeat(64),
    }
    const outside = model(12_004)
    outside.assetId = 'deleted-asset'
    replaceScene([wrapper, outside])
    useSceneStore.getState().selectNode(second.id)
    useSceneStore.temporal.getState().clear()
    const before = structuredClone(useSceneStore.getState().nodes)

    const result = useSceneStore
      .getState()
      .redirectModelAsset(first.id, makeAsset('replacement', 'mesh'), 'group')

    expect(result.ok).toBe(true)
    const state = useSceneStore.getState()
    expect((findSceneNode(state.nodes, first.id)?.node as SceneModelNode).assetId)
      .toBe('replacement')
    expect((findSceneNode(state.nodes, second.id)?.node as SceneModelNode).assetId)
      .toBe('replacement')
    expect((findSceneNode(state.nodes, outside.id)?.node as SceneModelNode).assetId)
      .toBe('deleted-asset')
    expect(findSceneNode(state.nodes, first.id)?.node).toMatchObject({
      name: '以前の表示名',
      visible: false,
      transform: first.transform,
    })
    expect(findSceneNode(state.nodes, second.id)?.node).toMatchObject({
      name: 'ユーザー名',
      transform: second.transform,
    })
    expect((state.nodes[0] as SceneGroupNode).importedFrom).toEqual(wrapper.importedFrom)
    expect(state.selectedNodeId).toBe(second.id)
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)

    useSceneStore.temporal.getState().undo()
    expect(useSceneStore.getState().nodes).toEqual(before)
    expect(useSceneStore.getState().selectedNodeId).toBe(second.id)
  })

  it('rejects same-target, non-model source, and invalid target asset without history', () => {
    const source = model(12_100)
    source.assetId = 'current'
    const sourceGroup = group(12_101, [source])
    replaceScene([sourceGroup])
    const before = structuredClone(useSceneStore.getState().nodes)

    const same = useSceneStore
      .getState()
      .redirectModelAsset(source.id, makeAsset('current'), 'node')
    const nonModel = useSceneStore
      .getState()
      .redirectModelAsset(sourceGroup.id, makeAsset('replacement'), 'node')
    const invalidTarget = useSceneStore
      .getState()
      .redirectModelAsset(source.id, makeAsset('scene-target', 'scene'), 'scene')

    expect(same.ok).toBe(false)
    if (!same.ok) expect(same.error.code).toBe('same-asset')
    expect(nonModel.ok).toBe(false)
    if (!nonModel.ok) expect(nonModel.error.code).toBe('node-not-model')
    expect(invalidTarget.ok).toBe(false)
    if (!invalidTarget.ok) expect(invalidTarget.error.code).toBe('invalid-asset-kind')
    expect(useSceneStore.getState().nodes).toEqual(before)
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('rejects non-model assets without mutation', () => {
    const result = useSceneStore.getState().addModel(makeAsset('image', 'image'), null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-asset-kind')
    expect(useSceneStore.getState().nodes).toEqual([])
  })
})

function resetStore() {
  const history = useSceneStore.temporal.getState()
  history.pause()
  useSceneStore.setState(useSceneStore.getInitialState(), true)
  history.clear()
  history.resume()
}

function currentImportDestination() {
  const state = useSceneStore.getState()
  return {
    nodes: state.nodes,
    activeSceneId: state.activeScene?.id ?? null,
  }
}

function currentDocument(): SceneDocument {
  return { schemaVersion: 2, nodes: structuredClone(useSceneStore.getState().nodes) }
}

function currentNameDraft(): string {
  return useSceneStore.getState().sceneNameDraft
}

function replaceScene(nodes: SceneNode[]): void {
  const document: SceneDocument = { schemaVersion: 2, nodes }
  const result = useSceneStore.getState().replaceScene(document, { id: 'scene', name: 'Scene' })
  if (!result.ok) throw new Error(result.error.message)
  useSceneStore.temporal.getState().clear()
}

function makeAsset(id: string, kind: Asset['kind'] = 'splat'): Asset {
  return {
    id,
    kind,
    name: `${id}.spz`,
    tags: [],
    files: { main: { path: `${id}.spz`, size: 1 } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

function model(sequence: number, transform?: Partial<SceneTransform>): SceneModelNode {
  return {
    id: uuid(sequence),
    kind: 'model',
    name: `Model ${sequence}`,
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

function mergeTransform(transform?: Partial<SceneTransform>): SceneTransform {
  return {
    position: transform?.position ?? [0, 0, 0],
    rotation: transform?.rotation ?? [0, 0, 0],
    scale: transform?.scale ?? [1, 1, 1],
  }
}

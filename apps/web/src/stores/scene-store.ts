import type { GizmoMode, PlacementTransform, ScaleMode } from '@/components/scene-viewer'
import {
  appendSceneNode,
  cloneSceneNodes,
  containsSceneNode,
  deleteSceneNode,
  findSceneNode,
  getSceneChildren,
  moveSceneNode,
  nextSceneGroupName,
  redirectSceneModelAsset,
  sceneNodesEqual,
  sceneTransformEqual,
  updateSceneNode,
  type SceneTreeResult,
  type SceneTreeErrorCode,
  type ModelReferenceScope,
} from '@/lib/scene-tree'
import {
  createSceneNodeId,
  parseWritableSceneDocument,
  type Asset,
  type SceneDocument,
  type SceneGroupNode,
  type SceneModelNode,
  type SceneNode,
} from '@splatorium/shared'
import { create, useStore } from 'zustand'
import { temporal } from 'zundo'

export interface ActiveScene {
  id: string
  name: string
}

export type SceneCommandResult = SceneTreeResult<void>

export interface SceneImportDestination {
  nodes: readonly SceneNode[]
  activeSceneId: string | null
}

export interface NodeTransformPreview {
  nodeId: string
  transform: PlacementTransform
}

interface SceneHistorySlice {
  nodes: SceneNode[]
  selectedNodeId: string | null
}

interface SceneStore extends SceneHistorySlice {
  /** Last document snapshot confirmed persisted by the server. Never enters zundo history. */
  savedNodes: SceneNode[]
  sceneNameDraft: string
  savedSceneName: string
  activeScene: ActiveScene | null
  gizmoMode: GizmoMode
  scaleMode: ScaleMode
  transformPreview: NodeTransformPreview | null
  addModel: (
    asset: Asset,
    parentId: string | null,
    position?: readonly [number, number, number],
  ) => SceneCommandResult
  importScene: (
    wrapper: SceneGroupNode,
    parentId: string | null,
    destination: SceneImportDestination,
  ) => SceneCommandResult
  reimportScene: (
    nodeId: string,
    sourceWrapper: SceneGroupNode,
    destination: SceneImportDestination,
  ) => SceneCommandResult
  unlinkImportedScene: (nodeId: string) => SceneCommandResult
  redirectModelAsset: (
    nodeId: string,
    asset: Asset,
    scope: ModelReferenceScope,
  ) => SceneCommandResult
  createGroup: (parentId: string | null) => SceneCommandResult
  renameNode: (nodeId: string, name: string) => SceneCommandResult
  commitNodeTransform: (nodeId: string, transform: PlacementTransform) => SceneCommandResult
  previewNodeTransform: (nodeId: string, transform: PlacementTransform) => SceneCommandResult
  toggleNodeVisibility: (nodeId: string) => SceneCommandResult
  deleteNode: (nodeId: string) => SceneCommandResult
  moveNode: (
    nodeId: string,
    targetParentId: string | null,
    targetIndex: number,
  ) => SceneCommandResult
  clearScene: () => void
  replaceScene: (
    document: SceneDocument,
    scene: ActiveScene,
  ) => SceneCommandResult
  selectNode: (nodeId: string | null) => SceneCommandResult
  setGizmoMode: (mode: GizmoMode) => void
  setScaleMode: (mode: ScaleMode) => void
  setSceneNameDraft: (name: string) => void
  markSaved: (asset: Asset, document: SceneDocument, requestNameDraft: string) => void
  reconcileActiveScene: (asset: Asset | null) => void
}

function historyEqual(a: SceneHistorySlice, b: SceneHistorySlice): boolean {
  return a.selectedNodeId === b.selectedNodeId && sceneNodesEqual(a.nodes, b.nodes)
}

export interface SceneDirtyState {
  nodes: readonly SceneNode[]
  savedNodes: readonly SceneNode[]
  sceneNameDraft: string
  savedSceneName: string
}

export function selectHasUnsavedSceneChanges(state: SceneDirtyState): boolean {
  return (
    !sceneNodesEqual(state.nodes, state.savedNodes) ||
    state.sceneNameDraft !== state.savedSceneName
  )
}

export const useSceneStore = create<SceneStore>()(
  temporal(
    (set, get) => ({
      nodes: [],
      selectedNodeId: null,
      savedNodes: [],
      sceneNameDraft: '',
      savedSceneName: '',
      activeScene: null,
      gizmoMode: 'translate',
      scaleMode: 'uniform',
      transformPreview: null,

      addModel: (asset, parentId, position) => {
        if (asset.kind !== 'splat' && asset.kind !== 'mesh') {
          return commandFailure('invalid-asset-kind', `asset is not a model: ${asset.id}`)
        }
        const siblings = getSceneChildren(get().nodes, parentId)
        if (!siblings.ok) return siblings
        const node: SceneModelNode = {
          id: createSceneNodeId(),
          kind: 'model',
          name: asset.name,
          visible: true,
          transform: {
            // 位置指定（ビューポート drop 等）が無ければ横並びの既定配置
            position: position ? [...position] : [siblings.value.length * 1.2, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          assetId: asset.id,
        }
        const result = appendSceneNode(get().nodes, parentId, node)
        if (!result.ok) return result
        set({ nodes: result.value.nodes, selectedNodeId: node.id, transformPreview: null })
        return commandSuccess()
      },

      importScene: (wrapper, parentId, destination) => {
        const current = get()
        if (
          current.nodes !== destination.nodes ||
          (current.activeScene?.id ?? null) !== destination.activeSceneId
        ) {
          return commandFailure(
            'stale-destination',
            'scene changed while the import was being prepared',
          )
        }
        if (!wrapper.importedFrom) {
          return commandFailure('document-invalid', 'import wrapper must include importedFrom')
        }
        const ownedWrapper = cloneSceneNodes([wrapper])[0]
        if (!ownedWrapper || ownedWrapper.kind !== 'group') {
          return commandFailure('document-invalid', 'import wrapper must be a group')
        }
        const result = appendSceneNode(current.nodes, parentId, ownedWrapper)
        if (!result.ok) return result
        set({ nodes: result.value.nodes, selectedNodeId: ownedWrapper.id, transformPreview: null })
        return commandSuccess()
      },

      reimportScene: (nodeId, sourceWrapper, destination) => {
        const current = get()
        if (
          current.nodes !== destination.nodes ||
          (current.activeScene?.id ?? null) !== destination.activeSceneId
        ) {
          return commandFailure(
            'stale-destination',
            'scene changed while the reimport was being prepared',
          )
        }
        const location = findSceneNode(current.nodes, nodeId)
        if (
          !location ||
          location.node.kind !== 'group' ||
          !location.node.importedFrom
        ) {
          return commandFailure('not-imported-scene', `node is not an imported scene: ${nodeId}`)
        }
        if (
          !sourceWrapper.importedFrom ||
          sourceWrapper.importedFrom.sceneId !== location.node.importedFrom.sceneId
        ) {
          return commandFailure(
            'stale-destination',
            'imported scene source changed while the reimport was being prepared',
          )
        }

        const result = updateSceneNode(current.nodes, nodeId, (node) => {
          if (node.kind !== 'group') {
            throw new Error(`imported scene node changed kind: ${nodeId}`)
          }
          return {
            ...node,
            children: cloneSceneNodes(sourceWrapper.children),
            importedFrom: { ...sourceWrapper.importedFrom! },
          }
        })
        if (!result.ok) return result
        const selectedInsideReplacedChildren =
          current.selectedNodeId !== null &&
          current.selectedNodeId !== nodeId &&
          containsSceneNode(location.node, current.selectedNodeId)
        set({
          nodes: result.value.nodes,
          selectedNodeId: selectedInsideReplacedChildren ? nodeId : current.selectedNodeId,
          transformPreview: null,
        })
        return commandSuccess()
      },

      unlinkImportedScene: (nodeId) => {
        const location = findSceneNode(get().nodes, nodeId)
        if (
          !location ||
          location.node.kind !== 'group' ||
          !location.node.importedFrom
        ) {
          return commandFailure('not-imported-scene', `node is not an imported scene: ${nodeId}`)
        }
        const result = updateSceneNode(get().nodes, nodeId, (node) => {
          if (node.kind !== 'group') {
            throw new Error(`imported scene node changed kind: ${nodeId}`)
          }
          const { importedFrom: _origin, ...unlinked } = node
          return unlinked
        })
        return commitMutation(result, get().nodes, set)
      },

      redirectModelAsset: (nodeId, asset, scope) => {
        if (asset.kind !== 'splat' && asset.kind !== 'mesh') {
          return commandFailure('invalid-asset-kind', `asset is not a model: ${asset.id}`)
        }
        const current = get()
        const result = redirectSceneModelAsset(current.nodes, nodeId, asset.id, scope)
        return commitMutation(result, current.nodes, set)
      },

      createGroup: (parentId) => {
        const siblings = getSceneChildren(get().nodes, parentId)
        if (!siblings.ok) return siblings
        const node: SceneGroupNode = {
          id: createSceneNodeId(),
          kind: 'group',
          name: nextSceneGroupName(siblings.value),
          visible: true,
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          children: [],
        }
        const result = appendSceneNode(get().nodes, parentId, node)
        if (!result.ok) return result
        set({ nodes: result.value.nodes, selectedNodeId: node.id, transformPreview: null })
        return commandSuccess()
      },

      renameNode: (nodeId, name) => {
        const result = updateSceneNode(get().nodes, nodeId, (node) => ({ ...node, name }))
        return commitMutation(result, get().nodes, set)
      },

      commitNodeTransform: (nodeId, transform) => {
        const result = updateSceneNode(get().nodes, nodeId, (node) =>
          sceneTransformEqual(node.transform, transform)
            ? node
            : {
                ...node,
                transform: {
                  position: [...transform.position],
                  rotation: [...transform.rotation],
                  scale: [...transform.scale],
                },
              },
        )
        const committed = commitMutation(result, get().nodes, set)
        if (committed.ok && get().transformPreview !== null) {
          setTransient(set, { transformPreview: null })
        }
        return committed
      },

      previewNodeTransform: (nodeId, transform) => {
        if (!findSceneNode(get().nodes, nodeId)) {
          return commandFailure('node-not-found', `scene node not found: ${nodeId}`)
        }
        setTransient(set, {
          transformPreview: {
            nodeId,
            transform: {
              position: [...transform.position],
              rotation: [...transform.rotation],
              scale: [...transform.scale],
            },
          },
        })
        return commandSuccess()
      },

      toggleNodeVisibility: (nodeId) => {
        const result = updateSceneNode(get().nodes, nodeId, (node) => ({
          ...node,
          visible: !node.visible,
        }))
        return commitMutation(result, get().nodes, set)
      },

      deleteNode: (nodeId) => {
        const current = get()
        const result = deleteSceneNode(current.nodes, nodeId)
        if (!result.ok) return result
        set({
          nodes: result.value.nodes,
          selectedNodeId:
            current.selectedNodeId && containsSceneNode(result.value.removed, current.selectedNodeId)
              ? null
              : current.selectedNodeId,
          transformPreview: null,
        })
        return commandSuccess()
      },

      moveNode: (nodeId, targetParentId, targetIndex) => {
        const result = moveSceneNode(get().nodes, nodeId, targetParentId, targetIndex)
        return commitMutation(result, get().nodes, set)
      },

      clearScene: () => {
        if (get().nodes.length === 0) return
        set({ nodes: [], selectedNodeId: null, transformPreview: null })
      },

      replaceScene: (document, scene) => {
        const parsed = parseWritableSceneDocument(document)
        if (!parsed.ok) return commandFailure('document-invalid', parsed.error)
        const loadedNodes = cloneSceneNodes(parsed.value.nodes)
        const history = useSceneStore.temporal.getState()
        history.pause()
        try {
          set({
            nodes: loadedNodes,
            selectedNodeId: null,
            savedNodes: cloneSceneNodes(loadedNodes),
            sceneNameDraft: scene.name,
            savedSceneName: scene.name,
            activeScene: scene,
            transformPreview: null,
          })
          history.clear()
        } finally {
          history.resume()
        }
        return commandSuccess()
      },

      selectNode: (nodeId) => {
        if (nodeId !== null && !findSceneNode(get().nodes, nodeId)) {
          return commandFailure('node-not-found', `scene node not found: ${nodeId}`)
        }
        const history = useSceneStore.temporal.getState()
        history.pause()
        try {
          set({ selectedNodeId: nodeId, transformPreview: null })
        } finally {
          history.resume()
        }
        return commandSuccess()
      },

      setGizmoMode: (mode) => {
        set({ gizmoMode: mode })
      },

      setScaleMode: (mode) => {
        set({ scaleMode: mode })
      },

      setSceneNameDraft: (name) => {
        setTransient(set, { sceneNameDraft: name })
      },

      markSaved: (asset, document, requestNameDraft) => {
        const parsed = parseWritableSceneDocument(document)
        if (!parsed.ok) {
          throw new Error(`cannot mark invalid scene document as saved: ${parsed.error}`)
        }
        const currentDraft = get().sceneNameDraft
        setTransient(set, {
          activeScene: { id: asset.id, name: asset.name },
          savedNodes: cloneSceneNodes(parsed.value.nodes),
          savedSceneName: asset.name,
          sceneNameDraft: currentDraft === requestNameDraft ? asset.name : currentDraft,
        })
      },

      reconcileActiveScene: (asset) => {
        const current = get().activeScene
        if (!current) return
        const nameWasClean = get().sceneNameDraft === get().savedSceneName
        setTransient(set, {
          activeScene: asset ? { id: asset.id, name: asset.name } : null,
          ...(asset
            ? {
                savedSceneName: asset.name,
                sceneNameDraft: nameWasClean ? asset.name : get().sceneNameDraft,
              }
            : {}),
        })
      },
    }),
    {
      limit: 100,
      partialize: (state): SceneHistorySlice => ({
        nodes: state.nodes,
        selectedNodeId: state.selectedNodeId,
      }),
      equality: historyEqual,
    },
  ),
)

export function useSceneHistory() {
  const undo = useStore(useSceneStore.temporal, (state) => state.undo)
  const redo = useStore(useSceneStore.temporal, (state) => state.redo)
  const canUndo = useStore(useSceneStore.temporal, (state) => state.pastStates.length > 0)
  const canRedo = useStore(useSceneStore.temporal, (state) => state.futureStates.length > 0)
  return { undo, redo, canUndo, canRedo }
}

function setTransient(
  set: (partial: Partial<SceneStore>) => void,
  partial: Partial<SceneStore>,
): void {
  const history = useSceneStore.temporal.getState()
  const wasTracking = history.isTracking
  if (wasTracking) history.pause()
  try {
    set(partial)
  } finally {
    if (wasTracking) history.resume()
  }
}

function commitMutation(
  result: ReturnType<typeof updateSceneNode> | ReturnType<typeof moveSceneNode>,
  currentNodes: SceneNode[],
  set: (partial: Partial<SceneStore>) => void,
): SceneCommandResult {
  if (!result.ok) return result
  if (!sceneNodesEqual(currentNodes, result.value.nodes)) {
    set({ nodes: result.value.nodes, transformPreview: null })
  }
  return commandSuccess()
}

function commandSuccess(): SceneCommandResult {
  return { ok: true, value: undefined }
}

function commandFailure(
  code: SceneTreeErrorCode,
  message: string,
): SceneCommandResult {
  return { ok: false, error: { code, message } }
}

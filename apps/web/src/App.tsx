import { AboutDialog } from '@/components/about-dialog'
import { ContentBrowser } from '@/components/content-browser'
import { AssetDeleteDialog } from '@/components/asset-delete-dialog'
import { InspectorPanel } from '@/components/inspector-panel'
import { NodeInspector } from '@/components/node-inspector'
import { PreviewPane } from '@/components/preview-pane'
import { SceneReimportDialog } from '@/components/scene-reimport-dialog'
import { SceneSelfImportDialog } from '@/components/scene-self-import-dialog'
import { SceneDiscardDialog } from '@/components/scene-discard-dialog'
import { SceneWorkspace } from '@/components/scene-workspace'
import { ThemeMenu } from '@/components/theme-menu'
import { UploadDialog } from '@/components/upload-dialog'
import { Badge } from '@/components/ui/badge'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Toaster } from '@/components/ui/sonner'
import * as api from '@/lib/api'
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/product-info'
import { readStoredSceneDocument } from '@/lib/scene'
import { createSceneImportWrapper } from '@/lib/scene-import'
import { findSceneNode } from '@/lib/scene-tree'
import {
  isUnsupportedWorkbenchWidth,
  useUnsupportedWorkbenchWidth,
} from '@/lib/minimum-width'
import {
  checkImportedSceneSources,
  collectImportedSceneGroups,
  deriveImportedSceneUpdates,
  loadImportedSceneSource,
  type ImportedSceneUpdate,
  type SceneSourceOutcome,
} from '@/lib/scene-update'
import {
  hasEveryOutputAsset,
  replaceJobAfterCreate,
  type JobEntry,
} from '@/lib/jobs'
import {
  WorkbenchSyncCoordinator,
  deduplicateJobs,
  reconcileAssetReference,
  reconcileJobEntries,
  snapshotAssetRevisions,
  upsertAssetRevision,
  upsertJobEntry,
  type ReconciledWorkbenchSnapshot,
  type WorkbenchMutationEvent,
} from '@/lib/workbench-sync'
import {
  selectHasUnsavedSceneChanges,
  useSceneStore,
  type SceneImportDestination,
} from '@/stores/scene-store'
import {
  createSceneNodeId,
  hashSceneNodes,
  type Asset,
  type AssetSceneReference,
  type Job,
  type SceneDocument,
  type SceneGroupNode,
} from '@splatorium/shared'
import { ArrowLeft, ImageDown, Plus, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import { toast } from 'sonner'

type ServerState = 'checking' | 'ok' | 'offline'

interface PendingSceneReimport {
  nodeId: string
  nodeName: string
  sourceWrapper: SceneGroupNode
  destination: SceneImportDestination
  sourceRequestToken: number
}

interface PendingSceneImport {
  asset: Asset
  parentId: string | null
  destination: SceneImportDestination
  position?: readonly [number, number, number]
}

type PendingDiscardAction =
  | { kind: 'open'; assetId: string }
  | { kind: 'clear' }

export default function App() {
  const unsupportedWidth = useUnsupportedWorkbenchWidth()
  const [server, setServer] = useState<ServerState>('checking')
  const [apiReady, setApiReady] = useState(true)
  const [assets, setAssets] = useState<Asset[]>([])
  const [selected, setSelected] = useState<Asset | null>(null)
  const [jobs, setJobs] = useState<JobEntry[]>([])
  const [submitting, setSubmitting] = useState(false)
  /** 開いているモデル（プレビューモード）。null ならシーン編集モード */
  const [openedModel, setOpenedModel] = useState<Asset | null>(null)
  const nodes = useSceneStore((state) => state.nodes)
  const selectedNodeId = useSceneStore((state) => state.selectedNodeId)
  const gizmoMode = useSceneStore((state) => state.gizmoMode)
  const scaleMode = useSceneStore((state) => state.scaleMode)
  const activeScene = useSceneStore((state) => state.activeScene)
  const addModel = useSceneStore((state) => state.addModel)
  const importScene = useSceneStore((state) => state.importScene)
  const reimportScene = useSceneStore((state) => state.reimportScene)
  const unlinkImportedScene = useSceneStore((state) => state.unlinkImportedScene)
  const commitNodeTransform = useSceneStore((state) => state.commitNodeTransform)
  const previewNodeTransform = useSceneStore((state) => state.previewNodeTransform)
  const toggleNodeVisibility = useSceneStore((state) => state.toggleNodeVisibility)
  const deleteNode = useSceneStore((state) => state.deleteNode)
  const clearScene = useSceneStore((state) => state.clearScene)
  const replaceScene = useSceneStore((state) => state.replaceScene)
  const selectNode = useSceneStore((state) => state.selectNode)
  const setGizmoMode = useSceneStore((state) => state.setGizmoMode)
  const setScaleMode = useSceneStore((state) => state.setScaleMode)
  const markSceneSaved = useSceneStore((state) => state.markSaved)
  const reconcileActiveScene = useSceneStore((state) => state.reconcileActiveScene)
  const [uploadOpen, setUploadOpen] = useState(false)
  /** 画面全体へのドロップで受けたファイル。ダイアログに初期値として渡す */
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [draggingFile, setDraggingFile] = useState(false)
  /** 生成完了直後にグリッドでハイライトするアセット id（数秒で自動解除） */
  const [highlightIds, setHighlightIds] = useState<ReadonlySet<string>>(new Set())
  const [assetRevisions, setAssetRevisions] = useState<ReadonlyMap<string, string>>(new Map())
  const highlightTimers = useRef<Map<string, number>>(new Map())
  const jobsRef = useRef<JobEntry[]>([])
  const assetRevisionsRef = useRef<ReadonlyMap<string, string>>(new Map())
  const ownedJobIds = useRef(new Set<string>())
  const settledJobIds = useRef(new Set<string>())
  const terminalJobsRef = useRef(new Map<string, Job>())
  const pendingCreateRequests = useRef(0)
  const localRevisionSequence = useRef(0)
  const localRevisionSession = useRef(crypto.randomUUID())
  const dragDepth = useRef(0)
  const contentBrowserPanelRef = usePanelRef()

  const markHighlights = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setHighlightIds((prev) => new Set([...prev, ...ids]))
    for (const id of ids) {
      const existing = highlightTimers.current.get(id)
      if (existing !== undefined) window.clearTimeout(existing)
      highlightTimers.current.set(
        id,
        window.setTimeout(() => {
          highlightTimers.current.delete(id)
          setHighlightIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }, 5000),
      )
    }
  }, [])

  // 画面全体を画像ドロップの受け口にする（1 スクリーン原則: 専用の常設
  // ドロップ領域を持たず、ドラッグ開始時だけオーバーレイを出す）
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e) || isUnsupportedWorkbenchWidth()) return
      dragDepth.current += 1
      setDraggingFile(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      if (isUnsupportedWorkbenchWidth()) {
        dragDepth.current = 0
        setDraggingFile(false)
        return
      }
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDraggingFile(false)
    }
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      dragDepth.current = 0
      setDraggingFile(false)
      if (!hasFiles(e)) return
      e.preventDefault()
      if (isUnsupportedWorkbenchWidth()) return
      const file = e.dataTransfer?.files[0]
      if (file?.type.startsWith('image/')) {
        setPendingFile(file)
        setUploadOpen(true)
      }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    // Development builds expose the selection marker for visual checks.
    const target = window as unknown as Record<string, unknown>
    target.__markHighlights = markHighlights
    return () => {
      delete target.__markHighlights
    }
  }, [markHighlights])

  const openUpload = useCallback(() => {
    setPendingFile(null)
    setUploadOpen(true)
  }, [])

  const toggleContentBrowser = useCallback(() => {
    const panel = contentBrowserPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }, [contentBrowserPanelRef])

  const addToScene = useCallback((asset: Asset) => {
    const result = addModel(asset, null)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setOpenedModel(null)
  }, [addModel])

  const selectAsset = useCallback(
    (asset: Asset) => {
      selectNode(null)
      setSelected(asset)
    },
    [selectNode],
  )

  useEffect(() => {
    if (selectedNodeId) setSelected(null)
  }, [selectedNodeId])

  const assetsRef = useRef<Asset[]>([])
  assetsRef.current = assets
  jobsRef.current = jobs
  assetRevisionsRef.current = assetRevisions
  const [sourceOutcomes, setSourceOutcomes] = useState<ReadonlyMap<string, SceneSourceOutcome>>(
    new Map(),
  )
  const [importedSceneUpdates, setImportedSceneUpdates] = useState<
    ReadonlyMap<string, ImportedSceneUpdate>
  >(new Map())
  const [checkingImportedSceneIds, setCheckingImportedSceneIds] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const [reimportingImportedNodeIds, setReimportingImportedNodeIds] = useState<
    ReadonlySet<string>
  >(new Set())
  const [pendingSceneReimport, setPendingSceneReimport] =
    useState<PendingSceneReimport | null>(null)
  const [pendingSceneImport, setPendingSceneImport] = useState<PendingSceneImport | null>(null)
  const [pendingDiscardAction, setPendingDiscardAction] =
    useState<PendingDiscardAction | null>(null)
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState<Asset | null>(null)
  const [deleteReferences, setDeleteReferences] = useState<AssetSceneReference[] | null>(null)
  const [loadingDeleteReferences, setLoadingDeleteReferences] = useState(false)
  const [deletingAsset, setDeletingAsset] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteReferenceRequestRef = useRef(0)
  const sourceRequestTokensRef = useRef(new Map<string, number>())
  const reimportRequestTokensRef = useRef(new Map<string, number>())
  const requestSequenceRef = useRef(0)
  const deriveGenerationRef = useRef(0)
  const sceneSessionRef = useRef(0)
  const openSceneRequestRef = useRef(0)
  const importedSceneGroups = useMemo(() => collectImportedSceneGroups(nodes), [nodes])
  const checkingImportedNodeIds = useMemo(
    () =>
      new Set(
        importedSceneGroups.flatMap((group) =>
          group.importedFrom && checkingImportedSceneIds.has(group.importedFrom.sceneId)
            ? [group.id]
            : [],
        ),
      ),
    [checkingImportedSceneIds, importedSceneGroups],
  )

  useEffect(() => {
    const generation = ++deriveGenerationRef.current
    void deriveImportedSceneUpdates(nodes, sourceOutcomes).then(
      (updates) => {
        if (deriveGenerationRef.current === generation) setImportedSceneUpdates(updates)
      },
      (error: unknown) => {
        if (deriveGenerationRef.current !== generation) return
        const message = error instanceof Error ? error.message : String(error)
        setImportedSceneUpdates(
          new Map(
            collectImportedSceneGroups(nodes).map((group) => [
              group.id,
              { status: 'checkFailed', error: message } as const,
            ]),
          ),
        )
      },
    )
  }, [nodes, sourceOutcomes])

  const recordSourceOutcome = useCallback((sceneId: string, outcome: SceneSourceOutcome) => {
    setSourceOutcomes((previous) => {
      const next = new Map(previous)
      next.set(sceneId, outcome)
      return next
    })
  }, [])

  const resetImportedSceneChecks = useCallback(() => {
    sourceRequestTokensRef.current.clear()
    reimportRequestTokensRef.current.clear()
    deriveGenerationRef.current += 1
    sceneSessionRef.current += 1
    setSourceOutcomes(new Map())
    setImportedSceneUpdates(new Map())
    setCheckingImportedSceneIds(new Set())
    setReimportingImportedNodeIds(new Set())
    setPendingSceneReimport(null)
  }, [])

  useEffect(
    () => () => {
      sourceRequestTokensRef.current.clear()
      reimportRequestTokensRef.current.clear()
      deriveGenerationRef.current += 1
      openSceneRequestRef.current += 1
    },
    [],
  )

  const checkImportedGroups = useCallback(async (groups: readonly SceneGroupNode[]) => {
    const sceneIds = new Set(
      groups.flatMap((group) => (group.importedFrom ? [group.importedFrom.sceneId] : [])),
    )
    if (sceneIds.size === 0) return
    const requestTokens = new Map<string, number>()
    for (const sceneId of sceneIds) {
      const token = ++requestSequenceRef.current
      sourceRequestTokensRef.current.set(sceneId, token)
      requestTokens.set(sceneId, token)
    }
    setCheckingImportedSceneIds((previous) => new Set([...previous, ...sceneIds]))
    try {
      const outcomes = await checkImportedSceneSources(
        groups,
        assetsRef.current,
        api.fetchSceneDocument,
        createSceneNodeId,
      )
      setSourceOutcomes((previous) => {
        const next = new Map(previous)
        for (const sceneId of sceneIds) {
          if (sourceRequestTokensRef.current.get(sceneId) !== requestTokens.get(sceneId)) continue
          const outcome = outcomes.get(sceneId)
          if (outcome) next.set(sceneId, outcome)
        }
        return next
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const hasCurrentRequest = [...sceneIds].some(
        (sceneId) => sourceRequestTokensRef.current.get(sceneId) === requestTokens.get(sceneId),
      )
      setSourceOutcomes((previous) => {
        const next = new Map(previous)
        for (const sceneId of sceneIds) {
          if (sourceRequestTokensRef.current.get(sceneId) === requestTokens.get(sceneId)) {
            next.set(sceneId, { kind: 'checkFailed', error: message })
          }
        }
        return next
      })
      if (hasCurrentRequest) {
        toast.error('元シーンの更新確認に失敗しました', { description: message })
      }
    } finally {
      setCheckingImportedSceneIds((previous) => {
        const next = new Set(previous)
        for (const sceneId of sceneIds) {
          if (sourceRequestTokensRef.current.get(sceneId) === requestTokens.get(sceneId)) {
            next.delete(sceneId)
          }
        }
        return next
      })
    }
  }, [])

  const checkAllImportedScenes = useCallback(() => {
    void checkImportedGroups(collectImportedSceneGroups(useSceneStore.getState().nodes))
  }, [checkImportedGroups])

  const checkImportedScene = useCallback(
    (nodeId: string) => {
      const groups = collectImportedSceneGroups(useSceneStore.getState().nodes)
      const target = groups.find((group) => group.id === nodeId)
      if (!target?.importedFrom) return
      void checkImportedGroups(
        groups.filter((group) => group.importedFrom?.sceneId === target.importedFrom?.sceneId),
      )
    },
    [checkImportedGroups],
  )

  const commitPreparedReimport = useCallback(
    (prepared: PendingSceneReimport) => {
      const result = reimportScene(
        prepared.nodeId,
        prepared.sourceWrapper,
        prepared.destination,
      )
      setPendingSceneReimport(null)
      if (!result.ok) {
        toast.error('元シーンを再取込できませんでした', { description: result.error.message })
        return
      }
      const origin = prepared.sourceWrapper.importedFrom
      if (!origin) throw new Error('prepared source wrapper is missing importedFrom')
      if (
        sourceRequestTokensRef.current.get(origin.sceneId) === prepared.sourceRequestToken
      ) {
        recordSourceOutcome(origin.sceneId, { kind: 'available', sourceHash: origin.sourceHash })
      }
    },
    [recordSourceOutcome, reimportScene],
  )

  const handleReimportScene = useCallback(
    async (nodeId: string) => {
      if (reimportRequestTokensRef.current.has(nodeId)) return
      const initialState = useSceneStore.getState()
      const initialLocation = findSceneNode(initialState.nodes, nodeId)
      if (
        !initialLocation ||
        initialLocation.node.kind !== 'group' ||
        !initialLocation.node.importedFrom
      ) {
        toast.error('取込済みシーンが見つかりません')
        return
      }
      const sceneId = initialLocation.node.importedFrom.sceneId
      const sceneSession = sceneSessionRef.current
      const reimportRequestToken = ++requestSequenceRef.current
      const sourceRequestToken = ++requestSequenceRef.current
      reimportRequestTokensRef.current.set(nodeId, reimportRequestToken)
      sourceRequestTokensRef.current.set(sceneId, sourceRequestToken)
      setReimportingImportedNodeIds((previous) => new Set(previous).add(nodeId))
      setCheckingImportedSceneIds((previous) => {
        const next = new Set(previous)
        next.delete(sceneId)
        return next
      })
      setSourceOutcomes((previous) => {
        const next = new Map(previous)
        next.delete(sceneId)
        return next
      })
      try {
        const source = await loadImportedSceneSource(
          sceneId,
          assetsRef.current,
          api.fetchSceneDocument,
          createSceneNodeId,
        )
        if (
          sceneSessionRef.current !== sceneSession ||
          reimportRequestTokensRef.current.get(nodeId) !== reimportRequestToken
        ) {
          return
        }
        if (source.kind === 'sourceMissing') {
          if (sourceRequestTokensRef.current.get(sceneId) === sourceRequestToken) {
            recordSourceOutcome(sceneId, source)
          }
          toast.error('元シーンが見つかりません')
          return
        }
        if (source.kind === 'checkFailed') {
          if (sourceRequestTokensRef.current.get(sceneId) === sourceRequestToken) {
            recordSourceOutcome(sceneId, source)
          }
          toast.error('元シーンを確認できませんでした', { description: source.error })
          return
        }
        const sourceOrigin = source.wrapper.importedFrom
        if (!sourceOrigin) throw new Error('prepared source wrapper is missing importedFrom')
        if (sourceRequestTokensRef.current.get(sceneId) === sourceRequestToken) {
          recordSourceOutcome(sceneId, {
            kind: 'available',
            sourceHash: sourceOrigin.sourceHash,
          })
        }

        const current = useSceneStore.getState()
        const location = findSceneNode(current.nodes, nodeId)
        if (
          !location ||
          location.node.kind !== 'group' ||
          location.node.importedFrom?.sceneId !== sceneId
        ) {
          toast.error('確認中に取込済みシーンが変更されました。もう一度実行してください。')
          return
        }
        const destination: SceneImportDestination = {
          nodes: current.nodes,
          activeSceneId: current.activeScene?.id ?? null,
        }
        const childrenHash = await hashSceneNodes(location.node.children)
        if (
          sceneSessionRef.current !== sceneSession ||
          reimportRequestTokensRef.current.get(nodeId) !== reimportRequestToken ||
          useSceneStore.getState().nodes !== destination.nodes
        ) {
          toast.error('確認中にシーンが変更されました。もう一度実行してください。')
          return
        }
        const prepared: PendingSceneReimport = {
          nodeId,
          nodeName: location.node.name,
          sourceWrapper: source.wrapper,
          destination,
          sourceRequestToken,
        }
        if (childrenHash !== location.node.importedFrom.contentHash) {
          setPendingSceneReimport(prepared)
          return
        }
        commitPreparedReimport(prepared)
      } finally {
        if (reimportRequestTokensRef.current.get(nodeId) === reimportRequestToken) {
          reimportRequestTokensRef.current.delete(nodeId)
          setReimportingImportedNodeIds((previous) => {
            const next = new Set(previous)
            next.delete(nodeId)
            return next
          })
        }
      }
    },
    [commitPreparedReimport, recordSourceOutcome],
  )

  const handleUnlinkImportedScene = useCallback(
    (nodeId: string) => {
      const result = unlinkImportedScene(nodeId)
      if (!result.ok) toast.error(result.error.message)
    },
    [unlinkImportedScene],
  )

  const performClearScene = useCallback(() => {
    clearScene()
    resetImportedSceneChecks()
    toast.success('シーンをクリアしました', { description: 'Ctrl+Z で戻せます' })
  }, [clearScene, resetImportedSceneChecks])

  const handleClearScene = useCallback(() => {
    if (selectHasUnsavedSceneChanges(useSceneStore.getState())) {
      setPendingDiscardAction({ kind: 'clear' })
      return
    }
    performClearScene()
  }, [performClearScene])

  const performSceneImport = useCallback(
    async (
      asset: Asset,
      parentId: string | null,
      destination: SceneImportDestination,
      position?: readonly [number, number, number],
    ) => {
      try {
        const storedDocument = await api.fetchSceneDocument(asset.id)
        const wrapper = await createSceneImportWrapper(
          asset,
          storedDocument,
          assetsRef.current,
          createSceneNodeId,
        )
        if (position) {
          // ビューポート drop の着地点。wrapper の transform は contentHash の
          // 対象外なので、初回一致（sourceHash === contentHash）を壊さない
          wrapper.transform = { ...wrapper.transform, position: [...position] }
        }
        const result = importScene(wrapper, parentId, {
          nodes: destination.nodes,
          activeSceneId: destination.activeSceneId,
        })
        if (!result.ok) throw new Error(result.error.message)
        if (!wrapper.importedFrom) throw new Error('import wrapper is missing importedFrom')
        const sourceRequestToken = ++requestSequenceRef.current
        sourceRequestTokensRef.current.set(asset.id, sourceRequestToken)
        setCheckingImportedSceneIds((previous) => {
          const next = new Set(previous)
          next.delete(asset.id)
          return next
        })
        recordSourceOutcome(wrapper.importedFrom.sceneId, {
          kind: 'available',
          sourceHash: wrapper.importedFrom.sourceHash,
        })
        const nestedImports = collectImportedSceneGroups(wrapper.children)
        if (nestedImports.length > 0) void checkImportedGroups(nestedImports)
        setOpenedModel(null)
      } catch (error) {
        toast.error('シーンを取り込めませんでした', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [checkImportedGroups, importScene, recordSourceOutcome],
  )

  const requestSceneImport = useCallback(
    (
      asset: Asset,
      parentId: string | null,
      position?: readonly [number, number, number],
    ) => {
      const current = useSceneStore.getState()
      const destination: SceneImportDestination = {
        nodes: current.nodes,
        activeSceneId: current.activeScene?.id ?? null,
      }
      if (destination.activeSceneId === asset.id) {
        setPendingSceneImport({ asset, parentId, destination, ...(position ? { position } : {}) })
        return
      }
      void performSceneImport(asset, parentId, destination, position)
    },
    [performSceneImport],
  )

  /** ビューポートまたは空のシーンへ Asset を直接追加する。 */
  const handleViewportDropAsset = useCallback(
    (assetId: string, position: [number, number, number]) => {
      const asset = assetsRef.current.find((candidate) => candidate.id === assetId)
      if (!asset) return
      if (asset.kind === 'scene') {
        requestSceneImport(asset, null, position)
        return
      }
      const result = addModel(asset, null, position)
      if (!result.ok) toast.error(result.error.message)
    },
    [addModel, requestSceneImport],
  )

  const performOpenScene = useCallback(
    async (assetId: string) => {
      const request = ++openSceneRequestRef.current
      try {
        const storedDocument = await api.fetchSceneDocument(assetId)
        if (openSceneRequestRef.current !== request) return
        const asset = assetsRef.current.find(
          (candidate) => candidate.id === assetId && candidate.kind === 'scene',
        )
        if (!asset) throw new Error('シーンアセットが見つかりません')
        const document = readStoredSceneDocument(storedDocument, assetsRef.current)
        const result = replaceScene(document, { id: asset.id, name: asset.name })
        if (!result.ok) throw new Error(result.error.message)
        resetImportedSceneChecks()
        setOpenedModel(null)
        const importedGroups = collectImportedSceneGroups(document.nodes)
        if (importedGroups.length > 0) void checkImportedGroups(importedGroups)
      } catch (err) {
        if (openSceneRequestRef.current === request) {
          toast.error('シーンの読み込みに失敗しました', { description: String(err) })
        }
      }
    },
    [checkImportedGroups, replaceScene, resetImportedSceneChecks],
  )

  const openScene = useCallback(
    (asset: Asset) => {
      if (selectHasUnsavedSceneChanges(useSceneStore.getState())) {
        setPendingDiscardAction({ kind: 'open', assetId: asset.id })
        return
      }
      void performOpenScene(asset.id)
    },
    [performOpenScene],
  )

  /** ブラウザ/インスペクタの「開く」: シーンはロード、モデルはプレビューモードへ */
  const openAsset = useCallback(
    (asset: Asset) => {
      if (asset.kind === 'scene') {
        void openScene(asset)
        return
      }
      selectAsset(asset)
      setOpenedModel(asset)
    },
    [openScene, selectAsset],
  )

  const handleAssetUpdated = useCallback((asset: Asset) => {
    const previous = assetsRef.current
    const exists = previous.some((candidate) => candidate.id === asset.id)
    const nextAssets = exists
      ? previous.map((candidate) => (candidate.id === asset.id ? asset : candidate))
      : [asset, ...previous]
    assetsRef.current = nextAssets
    setAssets(nextAssets)
    setSelected((previous) => (previous?.id === asset.id ? asset : previous))
    setOpenedModel((previous) => (previous?.id === asset.id ? asset : previous))
    const nextRevisions = new Map(assetRevisionsRef.current)
    nextRevisions.set(
      asset.id,
      `local:${localRevisionSession.current}:${++localRevisionSequence.current}`,
    )
    assetRevisionsRef.current = nextRevisions
    setAssetRevisions(nextRevisions)
  }, [])

  const reconcileAssetDeleted = useCallback(
    (assetId: string) => {
      const nextAssets = assetsRef.current.filter((asset) => asset.id !== assetId)
      assetsRef.current = nextAssets
      setAssets(nextAssets)
      setSelected((current) => (current?.id === assetId ? null : current))
      setOpenedModel((current) => (current?.id === assetId ? null : current))
      if (useSceneStore.getState().activeScene?.id === assetId) {
        reconcileActiveScene(null)
      }

      const nextRevisions = new Map(assetRevisionsRef.current)
      nextRevisions.delete(assetId)
      assetRevisionsRef.current = nextRevisions
      setAssetRevisions(nextRevisions)

      const timer = highlightTimers.current.get(assetId)
      if (timer !== undefined) window.clearTimeout(timer)
      highlightTimers.current.delete(assetId)
      setHighlightIds((current) => {
        if (!current.has(assetId)) return current
        const next = new Set(current)
        next.delete(assetId)
        return next
      })
      setPendingDeleteAsset((current) => (current?.id === assetId ? null : current))
    },
    [reconcileActiveScene],
  )

  const requestAssetDelete = useCallback((asset: Asset) => {
    const request = ++deleteReferenceRequestRef.current
    setPendingDeleteAsset(asset)
    setDeleteReferences(null)
    setDeleteError(null)
    setDeletingAsset(false)
    setLoadingDeleteReferences(true)
    void api.fetchAssetReferences(asset.id).then(
      (references) => {
        if (deleteReferenceRequestRef.current !== request) return
        setDeleteReferences(references)
        setLoadingDeleteReferences(false)
      },
      (error: unknown) => {
        if (deleteReferenceRequestRef.current !== request) return
        const detail = error instanceof Error ? error.message : String(error)
        setDeleteError(`参照情報を取得できませんでした。${detail}`)
        setLoadingDeleteReferences(false)
      },
    )
  }, [])

  const cancelAssetDelete = useCallback(() => {
    deleteReferenceRequestRef.current += 1
    setPendingDeleteAsset(null)
    setDeleteReferences(null)
    setDeleteError(null)
    setLoadingDeleteReferences(false)
    setDeletingAsset(false)
  }, [])

  const confirmAssetDelete = useCallback(() => {
    const asset = pendingDeleteAsset
    if (!asset || !deleteReferences || deletingAsset) return
    setDeletingAsset(true)
    setDeleteError(null)
    void api.deleteAsset(asset.id).then(
      () => {
        reconcileAssetDeleted(asset.id)
        setDeleteReferences(null)
        setDeletingAsset(false)
        toast.success(`「${asset.name}」を削除しました`)
      },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        setDeleteError(`削除に失敗しました。${detail}`)
        setDeletingAsset(false)
      },
    )
  }, [deleteReferences, deletingAsset, pendingDeleteAsset, reconcileAssetDeleted])

  const handleSceneSaved = useCallback(
    (asset: Asset, document: SceneDocument, requestNameDraft: string) => {
      markSceneSaved(asset, document, requestNameDraft)
      handleAssetUpdated(asset)
    },
    [handleAssetUpdated, markSceneSaved],
  )

  const handleAssetRenamed = useCallback(
    (asset: Asset) => {
      handleAssetUpdated(asset)
      if (asset.kind === 'scene' && activeScene?.id === asset.id) {
        reconcileActiveScene(asset)
      }
    },
    [activeScene?.id, handleAssetUpdated, reconcileActiveScene],
  )

  const notifyOwnedTerminal = useCallback((job: Job, label: string) => {
    if (job.status === 'succeeded') {
      toast.success(`「${label}」の 3D 生成が完了しました`)
    } else if (job.status === 'failed') {
      toast.error(`「${label}」の生成に失敗しました`, { description: job.error })
    }
  }, [])

  const releaseJobLifecycle = useCallback((jobId: string) => {
    ownedJobIds.current.delete(jobId)
    terminalJobsRef.current.delete(jobId)
    settledJobIds.current.delete(jobId)
  }, [])

  const releaseUnclaimedTerminalJobs = useCallback(() => {
    if (pendingCreateRequests.current > 0) return
    for (const jobId of terminalJobsRef.current.keys()) {
      if (!ownedJobIds.current.has(jobId)) releaseJobLifecycle(jobId)
    }
  }, [releaseJobLifecycle])

  const settleJobTransition = useCallback(
    (job: Job, snapshotAssets: readonly Asset[]) => {
      if (settledJobIds.current.has(job.id)) return
      settledJobIds.current.add(job.id)
      const label =
        snapshotAssets.find((asset) => asset.id === job.inputAssetIds[0])?.name ??
        '入力アセット不明'
      if (job.status === 'succeeded') {
        markHighlights(job.outputAssetIds)
        if (ownedJobIds.current.has(job.id)) {
          notifyOwnedTerminal(job, label)
        }
      } else if (job.status === 'failed' && ownedJobIds.current.has(job.id)) {
        notifyOwnedTerminal(job, label)
      }
      if (ownedJobIds.current.has(job.id) || pendingCreateRequests.current === 0) {
        releaseJobLifecycle(job.id)
      }
    },
    [markHighlights, notifyOwnedTerminal, releaseJobLifecycle],
  )

  const applyAssetSnapshot = useCallback(
    (nextAssets: Asset[], serverId: string, watermark: number) => {
      const nextAssetIds = new Set(nextAssets.map((asset) => asset.id))
      for (const [assetId, timer] of highlightTimers.current) {
        if (nextAssetIds.has(assetId)) continue
        window.clearTimeout(timer)
        highlightTimers.current.delete(assetId)
      }
      setHighlightIds((current) => new Set([...current].filter((id) => nextAssetIds.has(id))))
      setPendingDeleteAsset((current) =>
        current && !nextAssetIds.has(current.id) ? null : current,
      )
      assetsRef.current = nextAssets
      setAssets(nextAssets)
      setSelected((previous) => reconcileAssetReference(previous, nextAssets))
      setOpenedModel((previous) => reconcileAssetReference(previous, nextAssets))
      const currentScene = useSceneStore.getState().activeScene
      if (currentScene) {
        const sceneAsset = nextAssets.find((asset) => asset.id === currentScene.id) ?? null
        reconcileActiveScene(sceneAsset)
      }
      const revisions = snapshotAssetRevisions(nextAssets, serverId, watermark)
      assetRevisionsRef.current = revisions
      setAssetRevisions(revisions)
    },
    [reconcileActiveScene],
  )

  const applyWorkbenchSnapshot = useCallback(
    (snapshot: ReconciledWorkbenchSnapshot) => {
      const previousJobs = jobsRef.current
      applyAssetSnapshot(snapshot.assets, snapshot.serverId, snapshot.watermark)
      for (const job of snapshot.jobs) {
        const previous = previousJobs.find((entry) => entry.job.id === job.id)?.job
        if (job.status === 'succeeded' || job.status === 'failed') {
          terminalJobsRef.current.set(job.id, job)
          const transitioned = previous?.status === 'queued' || previous?.status === 'running'
          if (transitioned || ownedJobIds.current.has(job.id)) {
            settleJobTransition(job, snapshot.assets)
          } else {
            releaseUnclaimedTerminalJobs()
          }
        }
      }
      const nextJobs = reconcileJobEntries(snapshot.jobs, snapshot.assets, previousJobs)
      jobsRef.current = nextJobs
      setJobs(nextJobs)
      setApiReady(true)
    },
    [applyAssetSnapshot, releaseUnclaimedTerminalJobs, settleJobTransition],
  )

  const applyWorkbenchEvent = useCallback(
    (event: WorkbenchMutationEvent) => {
      if (event.type === 'asset.upserted') {
        const previous = assetsRef.current
        const nextAssets = previous.some((asset) => asset.id === event.asset.id)
          ? previous.map((asset) => (asset.id === event.asset.id ? event.asset : asset))
          : [event.asset, ...previous]
        assetsRef.current = nextAssets
        setAssets(nextAssets)
        setSelected((current) => (current?.id === event.asset.id ? event.asset : current))
        setOpenedModel((current) => (current?.id === event.asset.id ? event.asset : current))
        const currentScene = useSceneStore.getState().activeScene
        if (currentScene?.id === event.asset.id && event.asset.kind === 'scene') {
          reconcileActiveScene(event.asset)
        }
        const revisions = upsertAssetRevision(
          assetRevisionsRef.current,
          event.asset.id,
          event.serverId,
          event.seq,
        )
        assetRevisionsRef.current = revisions
        setAssetRevisions(revisions)
        const nextJobs = reconcileJobEntries(
          jobsRef.current.map((entry) => entry.job),
          nextAssets,
          jobsRef.current,
        )
        jobsRef.current = nextJobs
        setJobs(nextJobs)
        return
      }

      if (event.type === 'asset.deleted') {
        reconcileAssetDeleted(event.assetId)
        return
      }

      const previous = jobsRef.current.find((entry) => entry.job.id === event.job.id)?.job
      if (event.job.status === 'succeeded' || event.job.status === 'failed') {
        terminalJobsRef.current.set(event.job.id, event.job)
        const transitioned = previous?.status === 'queued' || previous?.status === 'running'
        if (transitioned || ownedJobIds.current.has(event.job.id)) {
          settleJobTransition(event.job, assetsRef.current)
        } else {
          releaseUnclaimedTerminalJobs()
        }
      }
      const nextJobs = upsertJobEntry(jobsRef.current, event.job, assetsRef.current)
      jobsRef.current = nextJobs
      setJobs(nextJobs)
    },
    [reconcileActiveScene, reconcileAssetDeleted, releaseUnclaimedTerminalJobs, settleJobTransition],
  )

  useEffect(() => {
    api.fetchHealth().then(() => setServer('ok'), () => setServer('offline'))
    let snapshotRetry: number | undefined
    const coordinator = new WorkbenchSyncCoordinator({
      loadSnapshot: async () => {
        const ownedRequests = [...ownedJobIds.current].map(async (id) => {
          try {
            return await api.fetchJob(id)
          } catch (error) {
            if (error instanceof api.ApiError && error.status === 404) {
              releaseJobLifecycle(id)
              return null
            }
            throw error
          }
        })
        const [nextAssets, activeJobs, terminalJobs, ...ownedJobs] = await Promise.all([
          api.fetchAssets(),
          api.fetchJobs(['queued', 'running'], 100),
          api.fetchJobs(['succeeded', 'failed'], 20),
          ...ownedRequests,
        ])
        return {
          assets: nextAssets,
          jobs: deduplicateJobs(
            activeJobs,
            terminalJobs,
            ownedJobs.filter((job): job is Job => job !== null),
          ),
        }
      },
      applySnapshot: applyWorkbenchSnapshot,
      applyEvent: applyWorkbenchEvent,
      onError: () => {
        setApiReady(false)
        if (snapshotRetry !== undefined) window.clearTimeout(snapshotRetry)
        snapshotRetry = window.setTimeout(() => coordinator.retrySnapshot(), 2_000)
      },
    })
    const close = api.subscribeWorkbenchEvents(
      (event) => coordinator.receive(event),
      () => setApiReady(false),
      () => {
        setApiReady(false)
        coordinator.beginReconnect()
      },
    )
    const timers = highlightTimers.current
    return () => {
      close()
      if (snapshotRetry !== undefined) window.clearTimeout(snapshotRetry)
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
    }
  }, [applyWorkbenchEvent, applyWorkbenchSnapshot, releaseJobLifecycle])

  const syncSucceededJob = useCallback(async (job: Job, label: string) => {
    try {
      const refreshed = await api.fetchAssets()
      if (!hasEveryOutputAsset(job, refreshed)) throw new Error('完成アセットが見つかりません')
      for (const asset of refreshed) handleAssetUpdated(asset)
      const nextJobs = jobsRef.current.filter((entry) => entry.job.id !== job.id)
      jobsRef.current = nextJobs
      setJobs(nextJobs)
    } catch (error) {
      toast.error(`「${label}」の完成アセットを同期できませんでした`, {
        description: String(error),
      })
    }
  }, [handleAssetUpdated])

  const handleSubmit = async (
    file: File,
    opts: { numGaussians: number; seed?: number },
    replacedJobId?: string,
  ) => {
    setSubmitting(true)
    pendingCreateRequests.current += 1
    try {
      const job = await api.createJob(file, opts)
      ownedJobIds.current.add(job.id)
      if (replacedJobId) releaseJobLifecycle(replacedJobId)
      toast.success('生成を開始しました', { description: file.name })
      const observedTerminal = terminalJobsRef.current.get(job.id)
      if (observedTerminal) {
        if (settledJobIds.current.has(job.id)) {
          notifyOwnedTerminal(observedTerminal, file.name)
          releaseJobLifecycle(job.id)
        } else {
          settleJobTransition(observedTerminal, assetsRef.current)
        }
        const nextJobs = observedTerminal.status === 'failed'
          ? replaceJobAfterCreate(
              jobsRef.current,
              { job: observedTerminal, label: file.name },
              replacedJobId,
            )
          : jobsRef.current.filter(
              (entry) => entry.job.id !== job.id && entry.job.id !== replacedJobId,
            )
        jobsRef.current = nextJobs
        setJobs(nextJobs)
        return
      }
      const observedEntry = jobsRef.current.find((entry) => entry.job.id === job.id)
      const nextJobs = replaceJobAfterCreate(
        jobsRef.current,
        observedEntry ? { ...observedEntry, label: file.name } : { job, label: file.name },
        replacedJobId,
      )
      jobsRef.current = nextJobs
      setJobs(nextJobs)
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 404) {
        setApiReady(false)
      }
      if (replacedJobId) {
        toast.error(`「${file.name}」を再試行できませんでした`, {
          description: String(err),
        })
      } else if (!(err instanceof api.ApiError && err.status === 404)) {
        setJobs((prev) => [
          {
            label: file.name,
            job: {
              id: `local-${Date.now()}`,
              pipeline: 'image-to-splat',
              status: 'failed',
              progress: 0,
              inputAssetIds: [],
              outputAssetIds: [],
              error: String(err),
              createdAt: new Date().toISOString(),
            },
          },
          ...prev,
        ])
      }
    } finally {
      pendingCreateRequests.current -= 1
      releaseUnclaimedTerminalJobs()
      setSubmitting(false)
    }
  }

  /** 失敗ジョブの再試行: 入力画像アセットを取得し直し、同パラメータで再投入する */
  const retryJob = async (entry: JobEntry) => {
    const inputId = entry.job.inputAssetIds[0]
    const params = entry.job.params
    if (!inputId || !params) return
    try {
      const res = await fetch(api.assetFileUrl(inputId, 'main'))
      if (!res.ok) throw new Error(`入力画像の取得に失敗しました (HTTP ${res.status})`)
      const blob = await res.blob()
      const file = new File([blob], entry.label, { type: blob.type || 'image/png' })
      await handleSubmit(
        file,
        { numGaussians: params.numGaussians, seed: params.seed },
        entry.job.id,
      )
    } catch (err) {
      toast.error(`再試行できませんでした: ${String(err)}`)
    }
  }

  const dismissJob = (jobId: string) => {
    setJobs((prev) => prev.filter((e) => e.job.id !== jobId))
  }

  return (
    <>
    <div
      className="workbench-shell flex h-dvh min-w-[900px] flex-col"
      aria-hidden={unsupportedWidth || undefined}
      inert={unsupportedWidth || undefined}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="font-semibold">{PRODUCT_NAME}</h1>
        <Badge variant={server === 'ok' ? 'secondary' : 'destructive'}>
          server: {server === 'checking' ? '確認中…' : server}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {PRODUCT_TAGLINE}
        </span>
        <ThemeMenu />
        <AboutDialog />
      </header>

      {!apiReady && (
        <div className="flex items-center gap-2 border-b bg-accent/50 px-4 py-2 text-sm">
          <TriangleAlert className="size-4 shrink-0" />
          生成 API に接続できません。サーバーの状態を確認してから操作を再試行してください。
        </div>
      )}

      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="70%" minSize="40%">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="78%" minSize="50%">
              <main className="flex h-full min-w-0 flex-col">
                {openedModel ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    {/* モデルプレビューモード（Unity Prefab Mode 相当）。
                        シーン編集の状態は保持したまま一時的に切り替わる */}
                    <div className="flex shrink-0 items-center gap-2 border-b p-2">
                      <Button size="sm" variant="ghost" onClick={() => setOpenedModel(null)}>
                        <ArrowLeft />
                        シーン編集へ戻る
                      </Button>
                      <Separator orientation="vertical" className="mx-1 !h-5" />
                      <span className="min-w-0 truncate text-sm font-medium" title={openedModel.name}>
                        {openedModel.name}
                      </span>
                      <Badge variant="outline">{openedModel.kind}</Badge>
                      {openedModel.kind === 'splat' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto"
                          onClick={() => addToScene(openedModel)}
                        >
                          <Plus />
                          シーンへ追加
                        </Button>
                      )}
                    </div>
                    <PreviewPane asset={openedModel} onAssetUpdated={handleAssetUpdated} />
                  </div>
                ) : (
                  <SceneWorkspace
                    nodes={nodes}
                    assets={assets}
                    selectedNodeId={selectedNodeId}
                    mode={gizmoMode}
                    scaleMode={scaleMode}
                    activeScene={activeScene}
                    onModeChange={setGizmoMode}
                    onScaleModeChange={setScaleMode}
                    onSelect={selectNode}
                    onCommit={commitNodeTransform}
                    onTransformPreview={previewNodeTransform}
                    onToggleVisible={toggleNodeVisibility}
                    onRemove={deleteNode}
                    onClear={handleClearScene}
                    onSaved={handleSceneSaved}
                    onImportScene={requestSceneImport}
                    onViewportDropAsset={handleViewportDropAsset}
                    importedSceneUpdates={importedSceneUpdates}
                    checkingImportedNodeIds={checkingImportedNodeIds}
                    onCheckAllImportedScenes={checkAllImportedScenes}
                  />
                )}
              </main>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel className="min-w-60" defaultSize="22%" minSize="240px">
              <aside className="h-full min-w-60">
                {/* シーン編集中にノードを選択している間はノードインスペクタを優先する
                    （Unity Inspector と同じ「選択対象に応じて切り替わる 1 枚のパネル」） */}
                {!openedModel && selectedNodeId ? (
                  <NodeInspector
                    nodes={nodes}
                    nodeId={selectedNodeId}
                    assets={assets}
                    importedSceneUpdate={importedSceneUpdates.get(selectedNodeId)}
                    checkingImportedScene={checkingImportedNodeIds.has(selectedNodeId)}
                    reimportingImportedScene={reimportingImportedNodeIds.has(selectedNodeId)}
                    onCheckImportedScene={checkImportedScene}
                    onReimportScene={(nodeId) => void handleReimportScene(nodeId)}
                    onUnlinkImportedScene={handleUnlinkImportedScene}
                  />
                ) : (
                  <InspectorPanel
                    asset={selected}
                    onAddToScene={addToScene}
                    onOpenAsset={openAsset}
                    onAssetUpdated={handleAssetRenamed}
                    onRequestDelete={requestAssetDelete}
                  />
                )}
              </aside>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle
          withHandle
          disableDoubleClick
          title="ダブルクリックでコンテンツブラウザを折りたたみ／展開"
          onDoubleClick={toggleContentBrowser}
        />
        {/* 畳んでもツールバー 1 行分は残し、検索・取込の導線を失わない */}
        <ResizablePanel
          panelRef={contentBrowserPanelRef}
          defaultSize="30%"
          minSize="130px"
          collapsible
          collapsedSize="46px"
        >
          <ContentBrowser
            assets={assets}
            assetRevisions={assetRevisions}
            jobs={jobs}
            highlightIds={highlightIds}
            selectedId={selected?.id ?? null}
            onSelect={selectAsset}
            onAddToScene={addToScene}
            onImportScene={(asset) => requestSceneImport(asset, null)}
            onOpenAsset={openAsset}
            onRequestDelete={requestAssetDelete}
            onRequestUpload={openUpload}
            onRetryJob={(entry) => void retryJob(entry)}
            onSyncJob={(entry) => void syncSucceededJob(entry.job, entry.label)}
            onDismissJob={dismissJob}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <SceneDiscardDialog
        action={pendingDiscardAction?.kind ?? 'open'}
        open={pendingDiscardAction !== null}
        onCancel={() => setPendingDiscardAction(null)}
        onConfirm={() => {
          const action = pendingDiscardAction
          setPendingDiscardAction(null)
          if (!action) return
          if (action.kind === 'clear') performClearScene()
          else void performOpenScene(action.assetId)
        }}
      />

      <AssetDeleteDialog
        asset={pendingDeleteAsset}
        references={deleteReferences}
        loading={loadingDeleteReferences}
        deleting={deletingAsset}
        error={deleteError}
        onCancel={cancelAssetDelete}
        onConfirm={confirmAssetDelete}
      />

      <SceneReimportDialog
        open={pendingSceneReimport !== null}
        nodeName={pendingSceneReimport?.nodeName ?? ''}
        onCancel={() => setPendingSceneReimport(null)}
        onConfirm={() => {
          if (pendingSceneReimport) commitPreparedReimport(pendingSceneReimport)
        }}
      />

      <SceneSelfImportDialog
        open={pendingSceneImport !== null}
        onCancel={() => setPendingSceneImport(null)}
        onConfirm={() => {
          const pending = pendingSceneImport
          setPendingSceneImport(null)
          if (pending) {
            void performSceneImport(
              pending.asset,
              pending.parentId,
              pending.destination,
              pending.position,
            )
          }
        }}
      />

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        submitting={submitting}
        initialFile={pendingFile}
        onSubmit={handleSubmit}
      />

      {draggingFile && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-ring px-16 py-12 text-center">
            <ImageDown className="size-10 text-muted-foreground" />
            <p className="font-medium">画像をドロップして 3D 生成</p>
          </div>
        </div>
      )}

      <Toaster />
    </div>
      <div
        role="status"
        className="minimum-width-notice fixed inset-0 z-[100] items-center justify-center bg-background p-6 text-center"
      >
        <div className="max-w-lg space-y-3 rounded-xl border bg-card p-6 shadow-lg">
          <TriangleAlert className="mx-auto size-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">ウィンドウ幅が不足しています</h2>
          <p className="text-sm text-muted-foreground">
            {PRODUCT_NAME} はデスクトップ向けです。ウィンドウ幅 900px 以上でご利用ください。
          </p>
        </div>
      </div>
    </>
  )
}

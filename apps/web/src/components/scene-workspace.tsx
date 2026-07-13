import type { GizmoMode, PlacementTransform, ScaleMode } from '@/components/scene-viewer'
import { SceneTreePanel } from '@/components/scene-tree-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Separator } from '@/components/ui/separator'
import * as api from '@/lib/api'
import {
  flattenSceneModels,
  getRenderableModelsForNode,
  getRenderableSceneModels,
  toSceneDocument,
  toThumbnailPlacements,
  type ThumbnailPlacement,
} from '@/lib/scene'
import { ASSET_DRAG_MIME, readAssetDragPayload } from '@/lib/scene-dnd'
import { isUnsupportedWorkbenchWidth } from '@/lib/minimum-width'
import {
  collectImportedSceneGroups,
  type ImportedSceneUpdate,
} from '@/lib/scene-update'
import { useSceneHistory, useSceneStore } from '@/stores/scene-store'
import { cn } from '@/lib/utils'
import {
  Boxes,
  Focus,
  Loader2,
  Move3d,
  Rotate3d,
  RotateCcw,
  Redo2,
  RefreshCw,
  Save,
  Scaling,
  Trash2,
  Undo2,
} from 'lucide-react'
import {
  ASSET_NAME_MAX_LENGTH,
  type Asset,
  type SceneDocument,
  type SceneNode,
} from '@splatorium/shared'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SceneViewer = lazy(() =>
  import('@/components/scene-viewer').then((module) => ({ default: module.SceneViewer })),
)
const ThumbnailCapture = lazy(() =>
  import('@/components/thumbnail-capture').then((module) => ({
    default: module.ThumbnailCapture,
  })),
)

const MODES: { mode: GizmoMode; icon: typeof Move3d; label: string; key: string }[] = [
  { mode: 'translate', icon: Move3d, label: '移動', key: 'W' },
  { mode: 'rotate', icon: Rotate3d, label: '回転', key: 'E' },
  { mode: 'scale', icon: Scaling, label: '拡縮', key: 'R' },
]

const THUMBNAIL_CAPTURE_TIMEOUT_MS = 5_000

/** ツールバーのキー併記（移動 (W) 等）。プロツール共通の学習導線 */
function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground">
      {children}
    </kbd>
  )
}

/** キーボード操作を無効にすべき入力要素上のイベントか */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest('input, textarea, select, [contenteditable="true"]')
  )
}

type SaveState =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | {
      phase: 'saved'
      name: string
      thumbnail: 'capturing' | 'ready' | { error: string }
    }
  | { phase: 'unavailable' }
  | { phase: 'error'; message: string }

interface CaptureRequest {
  id: number
  asset: Asset
  document: SceneDocument
  requestNameDraft: string
  placements: ThumbnailPlacement[]
}

export function SceneWorkspace({
  nodes,
  assets,
  selectedNodeId,
  mode,
  scaleMode,
  activeScene,
  onModeChange,
  onScaleModeChange,
  onSelect,
  onCommit,
  onTransformPreview,
  onToggleVisible,
  onRemove,
  onClear,
  onSaved,
  onImportScene,
  onViewportDropAsset,
  importedSceneUpdates,
  checkingImportedNodeIds,
  onCheckAllImportedScenes,
}: {
  nodes: SceneNode[]
  assets: Asset[]
  selectedNodeId: string | null
  mode: GizmoMode
  scaleMode: ScaleMode
  /** 開いている既存シーン。指定時は保存が PUT 上書きになる */
  activeScene: { id: string; name: string } | null
  onModeChange: (mode: GizmoMode) => void
  onScaleModeChange: (mode: ScaleMode) => void
  onSelect: (nodeId: string | null) => void
  onCommit: (nodeId: string, transform: PlacementTransform) => void
  onTransformPreview: (nodeId: string, transform: PlacementTransform) => void
  onToggleVisible: (nodeId: string) => void
  onRemove: (nodeId: string) => void
  onClear: () => void
  onSaved: (asset: Asset, document: SceneDocument, requestNameDraft: string) => void
  onImportScene: (asset: Asset, parentId: string | null) => void
  /** ビューポート/空シーン placeholder への直接 drop（地面交点座標付き） */
  onViewportDropAsset: (assetId: string, position: [number, number, number]) => void
  importedSceneUpdates: ReadonlyMap<string, ImportedSceneUpdate>
  checkingImportedNodeIds: ReadonlySet<string>
  onCheckAllImportedScenes: () => void
}) {
  const renderableAssetIds = useMemo(
    () => new Set(assets.flatMap((asset) => (asset.kind === 'splat' ? [asset.id] : []))),
    [assets],
  )
  const modelAssetIds = useMemo(
    () =>
      new Set(
        assets.flatMap((asset) =>
          asset.kind === 'splat' || asset.kind === 'mesh' ? [asset.id] : [],
        ),
      ),
    [assets],
  )
  const flattened = useMemo(() => flattenSceneModels(nodes), [nodes])
  const renderable = useMemo(
    () => getRenderableSceneModels(flattened, renderableAssetIds),
    [renderableAssetIds, flattened],
  )
  const canFocusSelection = useMemo(
    () =>
      selectedNodeId !== null &&
      getRenderableModelsForNode(renderable, selectedNodeId).length > 0,
    [renderable, selectedNodeId],
  )
  const sceneName = useSceneStore((state) => state.sceneNameDraft)
  const setSceneNameDraft = useSceneStore((state) => state.setSceneNameDraft)
  const [save, setSave] = useState<SaveState>({ phase: 'idle' })
  const [captureRequest, setCaptureRequest] = useState<CaptureRequest | null>(null)
  const nextSaveId = useRef(0)
  const activeSaveId = useRef<number | null>(null)
  const activeSaveSceneId = useRef<string | null>(null)
  const nextCaptureId = useRef(0)
  const activeCaptureId = useRef<number | null>(null)
  const thumbnailUploadController = useRef<AbortController | null>(null)
  const selfSavedScene = useRef<{ id: string; name: string } | null>(null)
  /** Ctrl 押下中のみ true（一時スナップ。プロツール共通の modifier-held 方式） */
  const [snapping, setSnapping] = useState(false)
  const [focusSignal, setFocusSignal] = useState(0)
  const [resetSignal, setResetSignal] = useState(0)
  const [emptyDropActive, setEmptyDropActive] = useState(false)
  const importedSceneCount = useMemo(() => collectImportedSceneGroups(nodes).length, [nodes])
  const { undo, redo, canUndo, canRedo } = useSceneHistory()

  const abortThumbnailUpload = useCallback(() => {
    thumbnailUploadController.current?.abort()
    thumbnailUploadController.current = null
  }, [])

  const selectGizmoMode = useCallback(
    (nextMode: GizmoMode) => {
      if (nextMode !== 'scale' || mode !== 'scale') {
        onModeChange(nextMode)
        return
      }
      onScaleModeChange(scaleMode === 'uniform' ? 'axis' : 'uniform')
    },
    [mode, onModeChange, onScaleModeChange, scaleMode],
  )

  // ビューポート操作のキーボードショートカット。SceneWorkspace はシーンタブが
  // アクティブな時だけマウントされるため、リスナーの寿命がタブと一致する
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isUnsupportedWorkbenchWidth()) {
        if (e.key === 'Control') setSnapping(false)
        return
      }
      if (e.key === 'Control') {
        setSnapping(true)
        return
      }
      if (isEditableTarget(e.target)) return
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'z') {
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
          return
        }
        if (key === 'y' && !e.shiftKey) {
          e.preventDefault()
          redo()
          return
        }
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      switch (e.key) {
        case 'w':
        case 'W':
          onModeChange('translate')
          break
        case 'e':
        case 'E':
          onModeChange('rotate')
          break
        case 'r':
        case 'R':
          selectGizmoMode('scale')
          break
        case 'f':
        case 'F':
          if (canFocusSelection) setFocusSignal((n) => n + 1)
          break
        case 'Home':
          setResetSignal((n) => n + 1)
          break
        case 'Escape':
          onSelect(null)
          break
        case 'Delete':
          if (selectedNodeId) onRemove(selectedNodeId)
          break
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setSnapping(false)
    }
    // Ctrl を押したままウィンドウ外へ出た場合などの取り残しを防ぐ
    const onWindowBlur = () => setSnapping(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [
    canFocusSelection,
    selectedNodeId,
    selectGizmoMode,
    onModeChange,
    onSelect,
    onRemove,
    undo,
    redo,
  ])

  // 別のシーンを開いた時と、Inspector から現在のシーン名を変更した時に同期する。
  // 自身の保存で更新された名前は入力済みなのでリセットしない。
  const activeSceneId = activeScene?.id ?? null
  const activeSceneName = activeScene?.name ?? ''
  useEffect(() => {
    // The global event stream can deliver this page's scene upsert before the
    // matching PUT response resolves. Keep that in-flight save alive when the
    // event still refers to the same scene; the response remains authoritative
    // for completing the local save UI.
    if (activeSaveId.current !== null && activeSaveSceneId.current === activeSceneId) return
    const saved = selfSavedScene.current
    if (activeSceneId !== null && saved?.id === activeSceneId && saved.name === activeSceneName) {
      selfSavedScene.current = null
      return
    }
    selfSavedScene.current = null
    setSave({ phase: 'idle' })
    activeSaveId.current = null
    activeSaveSceneId.current = null
    abortThumbnailUpload()
    activeCaptureId.current = null
    setCaptureRequest(null)
  }, [abortThumbnailUpload, activeSceneId, activeSceneName])

  useEffect(
    () => () => {
      activeSaveId.current = null
      abortThumbnailUpload()
      activeCaptureId.current = null
    },
    [abortThumbnailUpload],
  )

  useEffect(() => {
    if (!captureRequest) return
    const request = captureRequest
    const timeout = window.setTimeout(() => {
      if (activeCaptureId.current !== request.id) return
      abortThumbnailUpload()
      activeCaptureId.current = null
      setCaptureRequest(null)
      setSave({
        phase: 'saved',
        name: request.asset.name,
        thumbnail: { error: 'サムネイルの生成がタイムアウトしました。' },
      })
    }, THUMBNAIL_CAPTURE_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [abortThumbnailUpload, captureRequest])

  const handleSave = async () => {
    abortThumbnailUpload()
    activeCaptureId.current = null
    setCaptureRequest(null)
    const requestNameDraft = sceneName
    const name = requestNameDraft.trim() || `scene-${new Date().toISOString().slice(0, 16)}`
    const saveId = ++nextSaveId.current
    activeSaveId.current = saveId
    activeSaveSceneId.current = activeScene?.id ?? null
    setSave({ phase: 'saving' })
    try {
      const document = toSceneDocument(nodes)
      const saved = activeScene
        ? await api.updateScene(activeScene.id, document, name)
        : await api.saveScene(name, document)
      if (activeSaveId.current !== saveId) return
      activeSaveId.current = null
      activeSaveSceneId.current = null
      selfSavedScene.current = { id: saved.id, name: saved.name }
      const thumbnailPlacements = toThumbnailPlacements(flattened, renderableAssetIds)
      if (thumbnailPlacements.length > 0) {
        const captureId = ++nextCaptureId.current
        activeCaptureId.current = captureId
        setSave({ phase: 'saved', name: saved.name, thumbnail: 'capturing' })
        setCaptureRequest({
          id: captureId,
          asset: saved,
          document,
          requestNameDraft,
          placements: thumbnailPlacements,
        })
      } else {
        activeCaptureId.current = null
        setSave({ phase: 'saved', name: saved.name, thumbnail: 'ready' })
        setCaptureRequest(null)
      }
      onSaved(saved, document, requestNameDraft)
    } catch (err) {
      if (activeSaveId.current !== saveId) return
      activeSaveId.current = null
      activeSaveSceneId.current = null
      if (err instanceof api.ApiError && err.status === 404) {
        setSave({ phase: 'unavailable' })
      } else {
        setSave({ phase: 'error', message: String(err) })
      }
    }
  }

  const handleThumbnailCapture = useCallback(
    async (blob: Blob) => {
      const request = captureRequest
      if (!request || activeCaptureId.current !== request.id) return
      abortThumbnailUpload()
      const controller = new AbortController()
      thumbnailUploadController.current = controller
      try {
        const updated = await api.uploadAssetThumbnail(request.asset.id, blob, controller.signal)
        if (activeCaptureId.current !== request.id) return
        setSave({ phase: 'saved', name: updated.name, thumbnail: 'ready' })
        onSaved(updated, request.document, request.requestNameDraft)
      } catch (error) {
        if (activeCaptureId.current !== request.id) return
        setSave({
          phase: 'saved',
          name: request.asset.name,
          thumbnail: { error: error instanceof Error ? error.message : String(error) },
        })
      } finally {
        if (thumbnailUploadController.current === controller) {
          thumbnailUploadController.current = null
        }
        if (activeCaptureId.current === request.id) {
          activeCaptureId.current = null
          setCaptureRequest(null)
        }
      }
    },
    [abortThumbnailUpload, captureRequest, onSaved],
  )

  const handleThumbnailCaptureError = useCallback(
    (error: unknown) => {
      const request = captureRequest
      if (!request || activeCaptureId.current !== request.id) return
      abortThumbnailUpload()
      activeCaptureId.current = null
      setSave({
        phase: 'saved',
        name: request.asset.name,
        thumbnail: { error: error instanceof Error ? error.message : String(error) },
      })
      setCaptureRequest(null)
    },
    [abortThumbnailUpload, captureRequest],
  )
  const captureSource = useMemo(
    () =>
      captureRequest
        ? ({ kind: 'scene', placements: captureRequest.placements } as const)
        : null,
    [captureRequest],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <Button
          size="icon"
          variant="outline"
          className="size-8"
          disabled={!canUndo}
          aria-label="元に戻す"
          title="元に戻す (Ctrl+Z)"
          onClick={() => undo()}
        >
          <Undo2 />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="size-8"
          disabled={!canRedo}
          aria-label="やり直す"
          title="やり直す (Ctrl+Shift+Z / Ctrl+Y)"
          onClick={() => redo()}
        >
          <Redo2 />
        </Button>
        <Separator orientation="vertical" className="mx-1 !h-5" />
        {MODES.map(({ mode: m, icon: Icon, label, key }) => {
          const displayedLabel =
            m === 'scale' ? `拡縮（${scaleMode === 'uniform' ? '等比' : '軸別'}）` : label
          return (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? 'default' : 'outline'}
              title={`${displayedLabel} (${key})`}
              onClick={() => selectGizmoMode(m)}
            >
              <Icon />
              {displayedLabel}
              <Kbd>{key}</Kbd>
            </Button>
          )
        })}
        <Separator orientation="vertical" className="mx-1 !h-5" />
        <Button
          size="sm"
          variant="outline"
          disabled={!canFocusSelection}
          title="選択中の配置にフォーカス (F)"
          onClick={() => setFocusSignal((n) => n + 1)}
        >
          <Focus />
          フォーカス
          <Kbd>F</Kbd>
        </Button>
        <Button
          size="sm"
          variant="outline"
          title="視点を初期位置へ戻す (Home)"
          onClick={() => setResetSignal((n) => n + 1)}
        >
          <RotateCcw />
          視点リセット
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={importedSceneCount === 0 || checkingImportedNodeIds.size > 0}
          title="取込済みシーンの更新をまとめて確認"
          onClick={onCheckAllImportedScenes}
        >
          <RefreshCw className={checkingImportedNodeIds.size > 0 ? 'animate-spin' : undefined} />
          シーン更新を確認
        </Button>
        <span
          className={cn(
            'shrink-0 whitespace-nowrap text-xs transition-colors',
            snapping ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
          title="Ctrl を押している間だけ 0.1 グリッド / 15° 単位にスナップ"
        >
          {snapping ? 'スナップ中' : 'Ctrl: スナップ'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Input
            className="h-8 w-44"
            aria-label="シーン名"
            placeholder="シーン名"
            value={sceneName}
            maxLength={ASSET_NAME_MAX_LENGTH}
            onChange={(e) => setSceneNameDraft(e.target.value)}
          />
          <Button
            size="sm"
            // disabled 中も title ツールチップを出すため hover を受ける（disabled 属性でクリックは無効のまま）
            className="disabled:pointer-events-auto"
            disabled={
              nodes.length === 0 ||
              save.phase === 'saving' ||
              (save.phase === 'saved' && save.thumbnail === 'capturing')
            }
            title={
              nodes.length === 0
                ? '保存するシーンにノードがありません。'
                : save.phase === 'saving'
                  ? 'シーンの保存処理が完了するまで利用できません。'
                  : save.phase === 'saved' && save.thumbnail === 'capturing'
                    ? 'サムネイルの更新が完了するまで利用できません。'
                    : undefined
            }
            onClick={handleSave}
          >
            {save.phase === 'saving' ? <Loader2 className="animate-spin" /> : <Save />}
            {activeScene ? '上書き保存' : '保存'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={nodes.length === 0}
            onClick={onClear}
          >
            <Trash2 />
            クリア
          </Button>
        </div>
      </div>
      {save.phase === 'unavailable' && (
        <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
          シーン保存 API に接続できません。サーバーの状態を確認してください。
        </p>
      )}
      {save.phase === 'saved' && typeof save.thumbnail === 'string' && (
        <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
          「{save.name}」を倉庫に保存しました。
          {save.thumbnail === 'capturing' && ' サムネイルを更新しています。'}
        </p>
      )}
      {save.phase === 'saved' && typeof save.thumbnail === 'object' && (
        <p className="border-b px-3 py-1.5 text-xs text-destructive">
          「{save.name}」は保存しましたが、サムネイル更新に失敗しました:{' '}
          {save.thumbnail.error}
        </p>
      )}
      {save.phase === 'error' && (
        <p className="border-b px-3 py-1.5 text-xs text-destructive">
          保存に失敗しました: {save.message}
        </p>
      )}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="78%" minSize="50%">
          <div className="h-full min-w-0 p-3">
            {nodes.length === 0 ? (
              /* 空シーンはビューポートが無いので、この placeholder が drop を受ける */
              <div
                className={cn(
                  'flex size-full items-center justify-center rounded-lg border border-dashed transition-colors',
                  emptyDropActive && 'border-primary/60 bg-primary/5',
                )}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(ASSET_DRAG_MIME)) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                  setEmptyDropActive(true)
                }}
                onDragLeave={() => setEmptyDropActive(false)}
                onDrop={(event) => {
                  if (!event.dataTransfer.types.includes(ASSET_DRAG_MIME)) return
                  event.preventDefault()
                  event.stopPropagation()
                  setEmptyDropActive(false)
                  const payload = readAssetDragPayload(
                    event.dataTransfer.getData(ASSET_DRAG_MIME),
                  )
                  if (payload) onViewportDropAsset(payload.assetId, [0, 0, 0])
                }}
              >
                <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
                  <Boxes className="size-10" />
                  <p className="text-sm">
                    倉庫のモデルをドラッグ、または「＋」でシーンに追加できます。
                  </p>
                </div>
              </div>
            ) : (
              <Suspense fallback={<SceneLoading />}>
                <SceneViewer
                  nodes={nodes}
                  availableAssetIds={renderableAssetIds}
                  selectedNodeId={selectedNodeId}
                  mode={mode}
                  scaleMode={scaleMode}
                  snapping={snapping}
                  focusSignal={focusSignal}
                  resetSignal={resetSignal}
                  onCommit={onCommit}
                  onTransformPreview={onTransformPreview}
                  onSelect={onSelect}
                  onDropAsset={onViewportDropAsset}
                />
              </Suspense>
            )}
          </div>
        </ResizablePanel>
        <ResizableHandle />
        {/* 配置ツリー。幅はリサイズできる。 */}
        <ResizablePanel className="min-w-60" defaultSize="22%" minSize="240px">
          <SceneTreePanel
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            availableAssetIds={modelAssetIds}
            assets={assets}
            onImportScene={onImportScene}
            importedSceneUpdates={importedSceneUpdates}
            checkingImportedNodeIds={checkingImportedNodeIds}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      {captureSource && (
        <Suspense fallback={null}>
          <ThumbnailCapture
            source={captureSource}
            onCapture={handleThumbnailCapture}
            onError={handleThumbnailCaptureError}
          />
        </Suspense>
      )}
    </div>
  )
}

function SceneLoading() {
  return (
    <div className="flex size-full items-center justify-center rounded-lg border text-sm text-muted-foreground">
      シーンビューアを読み込み中…
    </div>
  )
}

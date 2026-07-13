import { Badge } from '@/components/ui/badge'
import { ImportedSceneStatusBadges } from '@/components/imported-scene-status'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ASSET_DRAG_MIME,
  NODE_DRAG_MIME,
  planNodeDrop,
  planRootDrop,
  readAssetDragPayload,
  validateTreeDrop,
  type TreeDropMode,
} from '@/lib/scene-dnd'
import { countSceneNodes } from '@/lib/scene-tree'
import type { ImportedSceneUpdate } from '@/lib/scene-update'
import type { SceneCommandResult } from '@/stores/scene-store'
import { useSceneStore } from '@/stores/scene-store'
import { cn } from '@/lib/utils'
import {
  SCENE_NODE_NAME_MAX_LENGTH,
  type Asset,
  type SceneNode,
} from '@splatorium/shared'
import {
  Ban,
  Box,
  Boxes,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Trash2,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { toast } from 'sonner'

/** 深いツリーでも操作領域を保てるよう、視覚インデントは 6 段で止める。 */
const INDENT_PER_DEPTH = 14
const MAX_VISUAL_DEPTH = 6

interface TreeRow {
  node: SceneNode
  depth: number
  parentId: string | null
  index: number
  siblingCount: number
  inheritedHidden: boolean
}

function buildRows(
  nodes: readonly SceneNode[],
  collapsed: ReadonlySet<string>,
  depth: number,
  parentId: string | null,
  inheritedHidden: boolean,
  out: TreeRow[],
): void {
  nodes.forEach((node, index) => {
    out.push({ node, depth, parentId, index, siblingCount: nodes.length, inheritedHidden })
    if (node.kind === 'group' && !collapsed.has(node.id)) {
      buildRows(
        node.children,
        collapsed,
        depth + 1,
        node.id,
        inheritedHidden || !node.visible,
        out,
      )
    }
  })
}

/** Store のエラーを、理由と対処を含むユーザー向け文言へ変換する。 */
function commandErrorMessage(error: { code: string; message: string }): string {
  switch (error.code) {
    case 'shear':
      return '回転と非一様スケールの組合せのため、見た目の位置を保ったまま移動できません。スケールを揃えるか、移動先を変えてください。'
    case 'cycle':
      return 'グループを自身の中や子孫の中へ移動することはできません。'
    case 'singular-parent':
      return '移動先グループのスケールが 0 のため、位置を保ったまま移動できません。'
    default:
      return error.message
  }
}

type DropIndicator =
  | { kind: 'node'; nodeId: string; mode: TreeDropMode; invalid: boolean }
  | { kind: 'root'; invalid: boolean; operation: 'move' | 'copy' }

export function SceneTreePanel({
  nodes,
  selectedNodeId,
  availableAssetIds,
  assets,
  onImportScene,
  importedSceneUpdates,
  checkingImportedNodeIds,
}: {
  nodes: SceneNode[]
  selectedNodeId: string | null
  availableAssetIds: ReadonlySet<string>
  assets: Asset[]
  onImportScene: (asset: Asset, parentId: string | null) => void
  importedSceneUpdates: ReadonlyMap<string, ImportedSceneUpdate>
  checkingImportedNodeIds: ReadonlySet<string>
}) {
  const createGroup = useSceneStore((state) => state.createGroup)
  const renameNode = useSceneStore((state) => state.renameNode)
  const toggleNodeVisibility = useSceneStore((state) => state.toggleNodeVisibility)
  const deleteNode = useSceneStore((state) => state.deleteNode)
  const moveNode = useSceneStore((state) => state.moveNode)
  const addModel = useSceneStore((state) => state.addModel)
  const selectNode = useSceneStore((state) => state.selectNode)

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [indicator, setIndicator] = useState<DropIndicator | null>(null)
  const draggingIdRef = useRef<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const focusAfterRenameRef = useRef<string | null>(null)
  const treeRef = useRef<HTMLUListElement>(null)

  const rows = useMemo(() => {
    const out: TreeRow[] = []
    buildRows(nodes, collapsed, 0, null, false, out)
    return out
  }, [nodes, collapsed])

  const tabStopNodeId = rows.some(({ node }) => node.id === selectedNodeId)
    ? selectedNodeId
    : rows[0]?.node.id

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
      return
    }

    const nodeId = focusAfterRenameRef.current
    if (!nodeId) return
    focusAfterRenameRef.current = null
    const rowIndex = rows.findIndex(({ node }) => node.id === nodeId)
    treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[rowIndex]?.focus()
  }, [renamingId, rows])

  const run = useCallback((result: SceneCommandResult) => {
    if (!result.ok) toast.error(commandErrorMessage(result.error))
    return result.ok
  }, [])

  const toggleCollapsed = useCallback((nodeId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  const startRename = useCallback((node: SceneNode) => {
    setRenamingId(node.id)
    setDraftName(node.name)
  }, [])

  const finishRename = useCallback((nodeId: string, restoreFocus: boolean) => {
    focusAfterRenameRef.current = restoreFocus ? nodeId : null
    setRenamingId(null)
  }, [])

  const submitRename = useCallback((restoreFocus: boolean) => {
    if (!renamingId) return
    const nodeId = renamingId
    const name = draftName.trim()
    if (name.length > SCENE_NODE_NAME_MAX_LENGTH) {
      toast.error(`ノード名は ${SCENE_NODE_NAME_MAX_LENGTH} 文字以内で入力してください。`)
      return
    }
    if (name.length > 0 && !run(renameNode(nodeId, name))) return
    finishRename(nodeId, restoreFocus)
  }, [renamingId, draftName, renameNode, run, finishRename])

  const handleCreateGroup = useCallback(() => {
    // 選択中がグループならその中へ、それ以外はルートへ作成する
    const selected = selectedNodeId
      ? rows.find((row) => row.node.id === selectedNodeId)
      : undefined
    const parentId = selected?.node.kind === 'group' ? selected.node.id : null
    run(createGroup(parentId))
  }, [selectedNodeId, rows, createGroup, run])

  const dropModeForRow = (row: TreeRow, event: DragEvent): TreeDropMode => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientY - rect.top) / rect.height
    if (row.node.kind === 'group' && ratio >= 0.3 && ratio <= 0.7) return 'into'
    return ratio < 0.5 ? 'before' : 'after'
  }

  const handleRowDragOver = (row: TreeRow, event: DragEvent) => {
    if (event.dataTransfer.types.includes(NODE_DRAG_MIME)) {
      const draggedId = draggingIdRef.current
      if (!draggedId) return
      const mode = dropModeForRow(row, event)
      const plan = planNodeDrop(nodes, draggedId, row.node.id, mode)
      if (!plan) {
        setIndicator(null)
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setIndicator({
        kind: 'node',
        nodeId: row.node.id,
        mode,
        invalid: validateTreeDrop(nodes, draggedId, plan) !== null,
      })
      return
    }
    if (event.dataTransfer.types.includes(ASSET_DRAG_MIME)) {
      // アセットはグループ行（＝その中へ追加）だけを受け付ける
      if (row.node.kind !== 'group') {
        setIndicator(null)
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setIndicator({ kind: 'node', nodeId: row.node.id, mode: 'into', invalid: false })
    }
  }

  const handleRowDrop = (row: TreeRow, event: DragEvent) => {
    const hasNodePayload = event.dataTransfer.types.includes(NODE_DRAG_MIME)
    const hasAssetPayload = event.dataTransfer.types.includes(ASSET_DRAG_MIME)
    // OS の画像 file drop は App の global handler へ bubble させる。
    if (!hasNodePayload && !hasAssetPayload) return
    event.preventDefault()
    event.stopPropagation()
    setIndicator(null)
    const nodeData = event.dataTransfer.getData(NODE_DRAG_MIME)
    if (nodeData) {
      const mode = dropModeForRow(row, event)
      const plan = planNodeDrop(nodes, nodeData, row.node.id, mode)
      if (plan) run(moveNode(nodeData, plan.targetParentId, plan.targetIndex))
      return
    }
    const payload = readAssetDragPayload(event.dataTransfer.getData(ASSET_DRAG_MIME))
    if (payload && row.node.kind === 'group') {
      const asset = assets.find((candidate) => candidate.id === payload.assetId)
      if (asset?.kind === 'scene') onImportScene(asset, row.node.id)
      else if (asset?.kind === 'splat') run(addModel(asset, row.node.id))
    }
  }

  const handleRootDragOver = (event: DragEvent) => {
    if (event.dataTransfer.types.includes(NODE_DRAG_MIME)) {
      const draggedId = draggingIdRef.current
      if (!draggedId) return
      const plan = planRootDrop(nodes, draggedId)
      if (!plan) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setIndicator({
        kind: 'root',
        invalid: validateTreeDrop(nodes, draggedId, plan) !== null,
        operation: 'move',
      })
      return
    }
    if (event.dataTransfer.types.includes(ASSET_DRAG_MIME)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setIndicator({ kind: 'root', invalid: false, operation: 'copy' })
    }
  }

  const handleRootDrop = (event: DragEvent) => {
    const hasNodePayload = event.dataTransfer.types.includes(NODE_DRAG_MIME)
    const hasAssetPayload = event.dataTransfer.types.includes(ASSET_DRAG_MIME)
    if (!hasNodePayload && !hasAssetPayload) return
    event.preventDefault()
    event.stopPropagation()
    setIndicator(null)
    const nodeData = event.dataTransfer.getData(NODE_DRAG_MIME)
    if (nodeData) {
      const plan = planRootDrop(nodes, nodeData)
      if (plan) run(moveNode(nodeData, plan.targetParentId, plan.targetIndex))
      return
    }
    const payload = readAssetDragPayload(event.dataTransfer.getData(ASSET_DRAG_MIME))
    if (payload) {
      const asset = assets.find((candidate) => candidate.id === payload.assetId)
      if (asset?.kind === 'scene') onImportScene(asset, null)
      else if (asset?.kind === 'splat') run(addModel(asset, null))
    }
  }

  const focusTreeItem = (rowIndex: number) => {
    const target = rows[rowIndex]
    const item = treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[rowIndex]
    if (!target || !item) return
    item.focus()
    run(selectNode(target.node.id))
  }

  const handleTreeItemKeyDown = (
    row: TreeRow,
    rowIndex: number,
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.target !== event.currentTarget) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusTreeItem(Math.min(rowIndex + 1, rows.length - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        focusTreeItem(Math.max(rowIndex - 1, 0))
        break
      case 'Home':
        event.preventDefault()
        focusTreeItem(0)
        break
      case 'End':
        event.preventDefault()
        focusTreeItem(rows.length - 1)
        break
      case 'ArrowRight':
        if (row.node.kind !== 'group') break
        event.preventDefault()
        if (collapsed.has(row.node.id)) toggleCollapsed(row.node.id)
        else if (rows[rowIndex + 1]?.parentId === row.node.id) focusTreeItem(rowIndex + 1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        if (row.node.kind === 'group' && !collapsed.has(row.node.id)) {
          toggleCollapsed(row.node.id)
        } else if (row.parentId) {
          const parentIndex = rows.findIndex(({ node }) => node.id === row.parentId)
          if (parentIndex >= 0) focusTreeItem(parentIndex)
        }
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        run(selectNode(selectedNodeId === row.node.id ? null : row.node.id))
        break
      case 'F2':
        event.preventDefault()
        startRename(row.node)
        break
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 p-2">
        <h3 className="text-sm font-semibold">ツリー</h3>
        <Badge variant="secondary">{countSceneNodes(nodes)}</Badge>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-7"
          aria-label="グループを作成"
          title="グループを作成（グループ選択中はその中へ）"
          onClick={handleCreateGroup}
        >
          <FolderPlus />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul ref={treeRef} role="tree" aria-label="シーンツリー" className="p-1.5">
          {rows.map((row, rowIndex) => {
            const { node } = row
            const isGroup = node.kind === 'group'
            const isBroken = node.kind === 'model' && !availableAssetIds.has(node.assetId)
            const selected = selectedNodeId === node.id
            const hidden = !node.visible
            const rowIndicator =
              indicator?.kind === 'node' && indicator.nodeId === node.id ? indicator.mode : null
            const rowDropInvalid =
              indicator?.kind === 'node' && indicator.nodeId === node.id && indicator.invalid
            return (
              <li key={node.id} role="none">
                <div
                  role="treeitem"
                  aria-label={node.name}
                  aria-level={row.depth + 1}
                  aria-posinset={row.index + 1}
                  aria-setsize={row.siblingCount}
                  aria-selected={selected}
                  aria-expanded={isGroup ? !collapsed.has(node.id) : undefined}
                  tabIndex={node.id === tabStopNodeId ? 0 : -1}
                  onKeyDown={(event) => handleTreeItemKeyDown(row, rowIndex, event)}
                  draggable={renamingId !== node.id}
                  onDragStart={(event) => {
                    draggingIdRef.current = node.id
                    event.dataTransfer.setData(NODE_DRAG_MIME, node.id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => {
                    draggingIdRef.current = null
                    setIndicator(null)
                  }}
                  onDragOver={(event) => handleRowDragOver(row, event)}
                  onDragLeave={() => setIndicator(null)}
                  onDrop={(event) => handleRowDrop(row, event)}
                  className={cn(
                    'group/row relative flex h-8 items-center gap-1 rounded-md border border-transparent pr-1 text-sm transition-colors',
                    selected ? 'border-ring bg-accent' : 'hover:bg-accent/50',
                    rowDropInvalid && 'ring-2 ring-destructive/80',
                    !rowDropInvalid && rowIndicator === 'into' && 'ring-2 ring-primary/60',
                    !rowDropInvalid && rowIndicator === 'before' &&
                      'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary',
                    !rowDropInvalid && rowIndicator === 'after' &&
                      'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary',
                    (hidden || row.inheritedHidden) && 'opacity-60',
                  )}
                  style={{
                    paddingLeft: 4 + Math.min(row.depth, MAX_VISUAL_DEPTH) * INDENT_PER_DEPTH,
                  }}
                >
                  {isGroup ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-5 shrink-0"
                      aria-label={collapsed.has(node.id) ? '展開' : '折りたたみ'}
                      onClick={() => toggleCollapsed(node.id)}
                    >
                      <ChevronRight
                        className={cn(
                          'size-3.5 transition-transform',
                          !collapsed.has(node.id) && 'rotate-90',
                        )}
                      />
                    </Button>
                  ) : (
                    <span className="size-5 shrink-0" />
                  )}
                  {isGroup ? (
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Box className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  {renamingId === node.id ? (
                    <Input
                      ref={renameInputRef}
                      value={draftName}
                      maxLength={SCENE_NODE_NAME_MAX_LENGTH}
                      className="h-6 flex-1 px-1 text-sm"
                      aria-label="ノード名"
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => submitRename(false)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          submitRename(true)
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          finishRename(node.id, true)
                        }
                      }}
                    />
                  ) : (
                    <span
                      className="min-w-0 flex-1 truncate text-left"
                      title={`${node.name}（ダブルクリックまたは F2 で名前変更）`}
                      onClick={() => selectNode(selected ? null : node.id)}
                      onDoubleClick={() => startRename(node)}
                    >
                      {node.name}
                      {isGroup && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {node.children.length}
                        </span>
                      )}
                    </span>
                  )}
                  {isBroken && (
                    <Badge
                      variant="destructive"
                      className="shrink-0 px-1 text-[10px]"
                      title={`参照アセットが見つかりません: ${node.kind === 'model' ? node.assetId : ''}`}
                    >
                      参照切れ
                    </Badge>
                  )}
                  {isGroup && node.importedFrom && (
                    <span className="flex shrink-0 items-center gap-1">
                      <ImportedSceneStatusBadges
                        update={importedSceneUpdates.get(node.id)}
                        checking={checkingImportedNodeIds.has(node.id)}
                      />
                    </span>
                  )}
                  {rowDropInvalid && (
                    <Ban className="pointer-events-none size-4 shrink-0 text-destructive" />
                  )}
                  <span
                    className={cn(
                      'flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100',
                      selected && 'opacity-100',
                    )}
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      aria-label={node.visible ? '非表示にする' : '表示する'}
                      title={
                        row.inheritedHidden
                          ? '親グループが非表示のため描画されません'
                          : node.visible
                            ? '非表示にする'
                            : '表示する'
                      }
                      onClick={() => run(toggleNodeVisibility(node.id))}
                    >
                      {node.visible && !row.inheritedHidden ? <Eye /> : <EyeOff />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      aria-label="ノードを削除"
                      title={isGroup ? 'グループと中身をまとめて削除' : 'シーンから削除'}
                      onClick={() => run(deleteNode(node.id))}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
        {/* ルート末尾へのドロップ受け（余白） */}
        <div
          className={cn(
            'mx-1.5 mb-1.5 flex min-h-16 items-center justify-center rounded-md border border-dashed border-transparent text-xs text-muted-foreground',
            indicator?.kind === 'root' &&
              (indicator.invalid
                ? 'border-destructive/80 bg-destructive/5 text-destructive'
                : 'border-primary/60 bg-primary/5'),
          )}
          onDragOver={handleRootDragOver}
          onDragLeave={() => setIndicator(null)}
          onDrop={handleRootDrop}
        >
          {rows.length === 0 ? (
            <span className="flex items-center gap-1.5 px-3 py-4 text-center">
              <Boxes className="size-4" />
              モデルをここへドラッグ、または倉庫の「＋」で追加
            </span>
          ) : (
            indicator?.kind === 'root' && (
              <span className="flex items-center gap-1.5">
                {indicator.invalid && <Ban className="size-4" />}
                {indicator.invalid
                  ? 'ここへは移動できません'
                  : indicator.operation === 'copy'
                    ? 'ルートへ追加'
                    : 'ルートへ移動'}
              </span>
            )
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

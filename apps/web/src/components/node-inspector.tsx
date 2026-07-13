import { NodeTransformFields } from '@/components/node-transform-fields'
import { ModelReferenceDialog } from '@/components/model-reference-dialog'
import {
  ImportedSceneStatusBadges,
  importedSceneStatusText,
} from '@/components/imported-scene-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { findSceneNode } from '@/lib/scene-tree'
import type { ImportedSceneUpdate } from '@/lib/scene-update'
import { useSceneStore } from '@/stores/scene-store'
import {
  SCENE_NODE_NAME_MAX_LENGTH,
  type Asset,
  type SceneNode,
} from '@splatorium/shared'
import {
  Check,
  Download,
  Eye,
  EyeOff,
  Folder,
  Pencil,
  RefreshCw,
  TriangleAlert,
  Unlink,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

/**
 * シーンノード（モデルインスタンス / グループ）用インスペクタ。
 * ノード名はアセット名と独立。
 */
export function NodeInspector({
  nodes,
  nodeId,
  assets,
  importedSceneUpdate,
  checkingImportedScene,
  reimportingImportedScene,
  onCheckImportedScene,
  onReimportScene,
  onUnlinkImportedScene,
}: {
  nodes: SceneNode[]
  nodeId: string
  assets: Asset[]
  importedSceneUpdate: ImportedSceneUpdate | undefined
  checkingImportedScene: boolean
  reimportingImportedScene: boolean
  onCheckImportedScene: (nodeId: string) => void
  onReimportScene: (nodeId: string) => void
  onUnlinkImportedScene: (nodeId: string) => void
}) {
  const renameNode = useSceneStore((state) => state.renameNode)
  const toggleNodeVisibility = useSceneStore((state) => state.toggleNodeVisibility)
  const redirectModelAsset = useSceneStore((state) => state.redirectModelAsset)
  const selectNode = useSceneStore((state) => state.selectNode)

  const location = useMemo(() => findSceneNode(nodes, nodeId), [nodes, nodeId])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(location?.node.name ?? '')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [redirectOpen, setRedirectOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditing(false)
    setDraft(location?.node.name ?? '')
    setRenameError(null)
    setRedirectOpen(false)
  }, [nodeId, location?.node.name])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  if (!location) return null
  const { node } = location
  const parent = location.ancestors.at(-1) ?? null
  const asset = node.kind === 'model' ? assets.find((a) => a.id === node.assetId) : undefined
  const sourceAsset =
    node.kind === 'group' && node.importedFrom
      ? assets.find((candidate) => candidate.id === node.importedFrom?.sceneId)
      : undefined
  const canReimport =
    importedSceneUpdate?.status === 'locallyModified' ||
    importedSceneUpdate?.status === 'updateAvailable' ||
    importedSceneUpdate?.status === 'updateAvailableAndModified'

  const submit = () => {
    const name = draft.trim()
    if (name.length > SCENE_NODE_NAME_MAX_LENGTH) {
      setRenameError(`ノード名は ${SCENE_NODE_NAME_MAX_LENGTH} 文字以内で入力してください。`)
      return
    }
    if (name.length > 0 && name !== node.name) {
      const result = renameNode(node.id, name)
      if (!result.ok) {
        setRenameError(result.error.message)
        return
      }
    }
    setRenameError(null)
    setEditing(false)
  }

  const cancelRename = () => {
    setDraft(node.name)
    setRenameError(null)
    setEditing(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">インスペクタ</h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          <div>
            {editing ? (
              <div className="flex items-center gap-1">
                <Input
                  ref={inputRef}
                  value={draft}
                  maxLength={SCENE_NODE_NAME_MAX_LENGTH}
                  className="h-8"
                  aria-label="ノード名"
                  aria-invalid={renameError ? true : undefined}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submit()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelRename()
                    }
                  }}
                  onBlur={(event) => {
                    if (
                      event.relatedTarget instanceof HTMLElement &&
                      event.relatedTarget.closest('[data-node-name-action]')
                    ) {
                      return
                    }
                    submit()
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="確定"
                  data-node-name-action
                  onClick={submit}
                >
                  <Check />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="キャンセル"
                  data-node-name-action
                  onMouseDown={(event) => {
                    // blur の submit より先にキャンセルを効かせる
                    event.preventDefault()
                    cancelRename()
                  }}
                  onClick={cancelRename}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <div className="flex items-start gap-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-sm font-semibold break-all hover:underline"
                  title="ノード名を編集"
                  onClick={() => setEditing(true)}
                >
                  {node.name}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 shrink-0"
                  aria-label="ノード名を編集"
                  onClick={() => setEditing(true)}
                >
                  <Pencil />
                </Button>
              </div>
            )}
            {renameError && (
              <p role="alert" className="mt-1.5 text-xs text-destructive">
                {renameError}
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              <Badge variant="outline">{node.kind === 'group' ? 'グループ' : 'モデル'}</Badge>
              {node.kind === 'group' && (
                <span className="text-xs text-muted-foreground">{node.children.length} 個の子</span>
              )}
            </div>
          </div>
          <Separator />
          <dl className="space-y-1.5 text-xs">
            {node.kind === 'model' && (
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">参照アセット</dt>
                <dd className="min-w-0 truncate" title={asset?.name ?? node.assetId}>
                  {asset ? (
                    asset.name
                  ) : (
                    <span className="flex items-center gap-1 text-destructive">
                      <TriangleAlert className="size-3.5 shrink-0" />
                      見つかりません
                    </span>
                  )}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <dt className="shrink-0 text-muted-foreground">所属グループ</dt>
              <dd className="min-w-0 truncate">
                {parent ? (
                  <button
                    type="button"
                    className="flex max-w-full items-center gap-1 truncate hover:underline"
                    title={`「${parent.name}」を選択`}
                    onClick={() => selectNode(parent.id)}
                  >
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{parent.name}</span>
                  </button>
                ) : (
                  <span className="text-muted-foreground">ルート</span>
                )}
              </dd>
            </div>
          </dl>
          {node.kind === 'model' && (
            <Button size="sm" variant="outline" onClick={() => setRedirectOpen(true)}>
              参照先を変更…
            </Button>
          )}
          {node.kind === 'model' && !asset && (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-2.5"
            >
              <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <TriangleAlert className="size-4 shrink-0" />
                参照先のアセットが削除されています。
              </p>
              <p className="break-all text-xs text-muted-foreground">Asset ID: {node.assetId}</p>
            </div>
          )}
          {node.kind === 'group' && node.importedFrom && (
            <>
              <Separator />
              <section className="space-y-2" aria-label="元シーン更新">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="mr-auto text-xs font-medium">元シーン</p>
                  <ImportedSceneStatusBadges
                    update={importedSceneUpdate}
                    checking={checkingImportedScene}
                    detailed
                  />
                </div>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0 text-muted-foreground">取込元</dt>
                    <dd className="min-w-0 truncate" title={sourceAsset?.name ?? node.importedFrom.sceneId}>
                      {sourceAsset?.name ?? node.importedFrom.sceneId}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">状態</dt>
                    <dd>{importedSceneStatusText(importedSceneUpdate, checkingImportedScene)}</dd>
                  </div>
                </dl>
                {importedSceneUpdate?.status === 'checkFailed' && (
                  <p role="alert" className="text-xs text-destructive">
                    {importedSceneUpdate.error}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={checkingImportedScene || reimportingImportedScene}
                    onClick={() => onCheckImportedScene(node.id)}
                  >
                    <RefreshCw className={checkingImportedScene ? 'animate-spin' : undefined} />
                    更新を確認
                  </Button>
                  {canReimport && (
                    <Button
                      size="sm"
                      disabled={checkingImportedScene || reimportingImportedScene}
                      onClick={() => onReimportScene(node.id)}
                    >
                      <Download className={reimportingImportedScene ? 'animate-pulse' : undefined} />
                      {reimportingImportedScene ? '取込中' : '最新を取り込む'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={reimportingImportedScene}
                    onClick={() => onUnlinkImportedScene(node.id)}
                  >
                    <Unlink />
                    リンク解除
                  </Button>
                </div>
              </section>
            </>
          )}
          <Separator />
          <NodeTransformFields node={node} />
          <Separator />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const result = toggleNodeVisibility(node.id)
              if (!result.ok) toast.error(result.error.message)
            }}
          >
            {node.visible ? <Eye /> : <EyeOff />}
            {node.visible ? '表示中' : '非表示'}
          </Button>
        </div>
      </ScrollArea>
      {node.kind === 'model' && (
        <ModelReferenceDialog
          open={redirectOpen}
          currentAssetId={node.assetId}
          assets={assets}
          onCancel={() => setRedirectOpen(false)}
          onApply={(replacement, scope) => {
            const result = redirectModelAsset(node.id, replacement, scope)
            if (!result.ok) {
              toast.error(result.error.message)
              return
            }
            setRedirectOpen(false)
          }}
        />
      )}
    </div>
  )
}

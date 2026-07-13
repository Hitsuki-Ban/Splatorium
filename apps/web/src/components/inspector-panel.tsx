import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import * as api from '@/lib/api'
import { isUnsupportedWorkbenchWidth } from '@/lib/minimum-width'
import { ASSET_NAME_MAX_LENGTH, type Asset } from '@splatorium/shared'
import { Check, Eye, FolderOpen, Info, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  return `${(bytes / 1024).toFixed(1)} KiB`
}

/**
 * 右固定のインスペクタ（Unity Inspector / Unreal Details 相当）。
 * 選択対象の詳細と操作をここに集約する。
 */
export function InspectorPanel({
  asset,
  onAddToScene,
  onOpenAsset,
  onAssetUpdated,
  onRequestDelete,
}: {
  asset: Asset | null
  onAddToScene: (asset: Asset) => void
  /** モデル=プレビューで開く、シーン=ロード（App の openAsset） */
  onOpenAsset: (asset: Asset) => void
  onAssetUpdated: (asset: Asset) => void
  onRequestDelete: (asset: Asset) => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(asset?.name ?? '')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameControlsRef = useRef<HTMLDivElement>(null)
  const currentAssetIdRef = useRef(asset?.id ?? null)
  const renameInFlightIdsRef = useRef(new Set<string>())
  currentAssetIdRef.current = asset?.id ?? null

  useEffect(() => {
    setDraftName(asset?.name ?? '')
    setEditingName(false)
    setRenaming(asset ? renameInFlightIdsRef.current.has(asset.id) : false)
    setRenameError(null)
  }, [asset?.id, asset?.name])

  useEffect(() => {
    if (!editingName) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editingName])

  const startEditingName = useCallback(() => {
    if (!asset || renameInFlightIdsRef.current.has(asset.id)) return
    setDraftName(asset.name)
    setRenameError(null)
    setEditingName(true)
  }, [asset])

  const cancelEditingName = useCallback(() => {
    if (renaming) return
    setDraftName(asset?.name ?? '')
    setRenameError(null)
    setEditingName(false)
  }, [asset?.name, renaming])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        isUnsupportedWorkbenchWidth() ||
        event.key !== 'F2' ||
        isEditableTarget(event.target)
      ) return
      event.preventDefault()
      startEditingName()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [startEditingName])

  const submitRename = () => {
    if (!asset || renameInFlightIdsRef.current.has(asset.id)) return
    const name = draftName.trim()
    if (name.length === 0) {
      setRenameError('名前を入力してください。')
      return
    }
    if (name.length > ASSET_NAME_MAX_LENGTH) {
      setRenameError(`名前は ${ASSET_NAME_MAX_LENGTH} 文字以内で入力してください。`)
      return
    }
    if (name === asset.name) {
      cancelEditingName()
      return
    }

    setRenaming(true)
    setRenameError(null)
    renameInFlightIdsRef.current.add(asset.id)
    void api.renameAsset(asset.id, name).then(
      (updated) => {
        renameInFlightIdsRef.current.delete(asset.id)
        if (currentAssetIdRef.current === asset.id) {
          setDraftName(updated.name)
          setEditingName(false)
          setRenaming(false)
        }
        onAssetUpdated(updated)
      },
      (error: unknown) => {
        renameInFlightIdsRef.current.delete(asset.id)
        if (currentAssetIdRef.current === asset.id) {
          setRenameError(error instanceof Error ? error.message : String(error))
          setRenaming(false)
        }
      },
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">インスペクタ</h2>
      </div>
      <div className="min-h-0 flex-1">
        {asset ? (
          <ScrollArea className="h-full">
            <div className="space-y-3 p-3">
              <div>
                {editingName ? (
                  <div ref={renameControlsRef} className="flex items-center gap-1">
                    <Input
                      ref={inputRef}
                      value={draftName}
                      maxLength={ASSET_NAME_MAX_LENGTH}
                      disabled={renaming}
                      aria-label="アセット名"
                      aria-invalid={renameError ? true : undefined}
                      className="h-8"
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={(event) => {
                        const next = event.relatedTarget
                        if (!(next instanceof Node) || !renameControlsRef.current?.contains(next)) {
                          cancelEditingName()
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          submitRename()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelEditingName()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={renaming}
                      aria-label="名前変更を確定"
                      title="確定 (Enter)"
                      onClick={submitRename}
                    >
                      {renaming ? <Loader2 className="animate-spin" /> : <Check />}
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={renaming}
                      aria-label="名前変更をキャンセル"
                      title="キャンセル (Esc)"
                      onClick={cancelEditingName}
                    >
                      <X />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left text-sm font-semibold break-all hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="名前を編集 (F2)"
                      onClick={startEditingName}
                    >
                      {asset.name}
                    </button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      className="shrink-0"
                      aria-label="アセット名を編集"
                      title="名前を編集 (F2)"
                      onClick={startEditingName}
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
                  <Badge variant="outline">{asset.kind}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(asset.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
              <Separator />
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">ファイル</dt>
                  <dd className="truncate" title={asset.files.main.path}>
                    {asset.files.main.path}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">サイズ</dt>
                  <dd>{formatSize(asset.files.main.size)}</dd>
                </div>
                {asset.sourceJobId && (
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0 text-muted-foreground">生成ジョブ</dt>
                    <dd className="truncate" title={asset.sourceJobId}>
                      {asset.sourceJobId}
                    </dd>
                  </div>
                )}
              </dl>
              {/* 画像は倉庫の管理対象ではなくモデルの付属情報。
                  生成元の入力画像はここで見せる */}
              {asset.kind === 'splat' && asset.files.source && (
                <>
                  <Separator />
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">元画像</p>
                    <img
                      src={api.assetFileUrl(asset.id, 'source')}
                      alt={`${asset.name} の生成元画像`}
                      loading="lazy"
                      className="max-h-40 w-full rounded-md border object-contain"
                    />
                  </div>
                </>
              )}
              <Separator />
              <div className="flex flex-col gap-2">
                {(asset.kind === 'splat' || asset.kind === 'image') && (
                  <Button size="sm" variant="outline" onClick={() => onOpenAsset(asset)}>
                    <Eye />
                    プレビューで開く
                  </Button>
                )}
                {asset.kind === 'splat' && (
                  <Button size="sm" onClick={() => onAddToScene(asset)}>
                    <Plus />
                    シーンへ追加
                  </Button>
                )}
                {asset.kind === 'scene' && (
                  <Button size="sm" onClick={() => onOpenAsset(asset)}>
                    <FolderOpen />
                    シーンを開く
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={renaming}
                  onClick={() => onRequestDelete(asset)}
                >
                  <Trash2 />
                  アセットを削除
                </Button>
              </div>
            </div>
          </ScrollArea>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
            <Info className="size-8" />
            <p>アセットを選択すると詳細が表示されます。</p>
          </div>
        )}
      </div>
    </div>
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

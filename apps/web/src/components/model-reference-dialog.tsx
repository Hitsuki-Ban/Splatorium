import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ModelReferenceScope } from '@/lib/scene-tree'
import type { Asset } from '@splatorium/shared'
import { useEffect, useMemo, useState } from 'react'

const SCOPES: ReadonlyArray<{ value: ModelReferenceScope; label: string; description: string }> = [
  {
    value: 'scene',
    label: 'シーン内のすべて',
    description: '現在のシーンにある同じ参照をすべて変更します。',
  },
  {
    value: 'group',
    label: '同じグループ内のみ',
    description: '所属グループ配下にある同じ参照を変更します。',
  },
  {
    value: 'node',
    label: 'このノードのみ',
    description: '選択中のインスタンスだけを変更します。',
  },
]

export function ModelReferenceDialog({
  open,
  currentAssetId,
  assets,
  onCancel,
  onApply,
}: {
  open: boolean
  currentAssetId: string
  assets: readonly Asset[]
  onCancel: () => void
  onApply: (asset: Asset, scope: ModelReferenceScope) => void
}) {
  const [query, setQuery] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [scope, setScope] = useState<ModelReferenceScope>('node')
  const candidates = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return assets
      .filter(
        (asset) =>
          (asset.kind === 'splat' || asset.kind === 'mesh') &&
          asset.id !== currentAssetId &&
          (term.length === 0 ||
            asset.name.toLocaleLowerCase().includes(term) ||
            asset.id.toLocaleLowerCase().includes(term)),
      )
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  }, [assets, currentAssetId, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedAssetId(null)
    setScope('node')
  }, [currentAssetId, open])

  const selectedAsset = candidates.find((asset) => asset.id === selectedAssetId)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>参照先を変更</DialogTitle>
          <DialogDescription>
            新しいモデルと、同じ参照を変更する範囲を選択してください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            aria-label="モデルを検索"
            placeholder="モデル名または Asset ID で検索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ScrollArea className="h-48 rounded-md border">
            <fieldset className="space-y-1 p-2" aria-label="変更先モデル">
              {candidates.length === 0 ? (
                <p className="p-3 text-center text-sm text-muted-foreground">
                  選択できるモデルがありません。
                </p>
              ) : (
                candidates.map((asset) => (
                  <label
                    key={asset.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
                  >
                    <input
                      type="radio"
                      name="replacement-model"
                      value={asset.id}
                      checked={selectedAssetId === asset.id}
                      onChange={() => setSelectedAssetId(asset.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                    <span className="text-xs text-muted-foreground">{asset.kind}</span>
                  </label>
                ))
              )}
            </fieldset>
          </ScrollArea>

          <fieldset className="space-y-2" aria-label="適用範囲">
            <legend className="mb-2 text-sm font-medium">適用範囲</legend>
            {SCOPES.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="reference-scope"
                  value={option.value}
                  checked={scope === option.value}
                  onChange={() => setScope(option.value)}
                />
                <span>
                  <span className="block font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>キャンセル</Button>
          <Button
            disabled={!selectedAsset}
            onClick={() => {
              if (selectedAsset) onApply(selectedAsset, scope)
            }}
          >
            変更を適用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

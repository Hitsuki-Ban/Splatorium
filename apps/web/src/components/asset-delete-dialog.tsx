import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import type { Asset, AssetSceneReference } from '@splatorium/shared'
import { Loader2 } from 'lucide-react'

export function AssetDeleteDialog({
  asset,
  references,
  loading,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  asset: Asset | null
  references: readonly AssetSceneReference[] | null
  loading: boolean
  deleting: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const hasReferences = (references?.length ?? 0) > 0

  return (
    <AlertDialog
      open={asset !== null}
      onOpenChange={(open) => {
        if (!open && !deleting) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>「{asset?.name ?? ''}」を削除しますか？</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {loading ? (
                <p className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  参照中のシーンを確認しています…
                </p>
              ) : error ? (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              ) : hasReferences ? (
                <>
                  <p>
                    削除すると、次のシーンでは該当配置が参照切れになります。参照切れは後から
                    「参照先の付け替え」で復旧できます。
                  </p>
                  <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-foreground">
                    {references?.map((reference) => (
                      <li key={reference.sceneId}>
                        {reference.sceneName}（{reference.nodeCount} 個）
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>このアセットを削除します。元に戻せません。</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            disabled={loading || deleting || references === null || error !== null}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {deleting && <Loader2 className="animate-spin" />}
            削除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
